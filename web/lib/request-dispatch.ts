// Server-only best-effort wake-up. GitHub's workflow_dispatch is not a worker
// claim: the queue endpoint still enforces authorization, lease and budget.
import { recordRequestDispatch, type SchoolRequest } from "@/lib/db/requests";

export function dispatchEnabled(): boolean {
  return process.env.REQUEST_EVENT_DISPATCH_ENABLED === "1" &&
    process.env.REQUEST_QUEUE_ENABLED === "1" && process.env.REQUEST_PIPELINE_ENABLED === "1";
}

/** Call only after a committed, newly created household request. A failed wake
 * must never turn a saved request into an error; the five-minute poll recovers. */
export async function wakeSchoolRequest(result: { request: SchoolRequest; created: boolean }): Promise<void> {
  if (!result.created || !dispatchEnabled() || result.request.job?.status !== "queued") return;
  let outcome: "accepted" | "failed" = "failed";
  try {
    const token = process.env.REQUEST_DISPATCH_GITHUB_TOKEN;
    const repository = process.env.REQUEST_DISPATCH_REPOSITORY;
    const ref = process.env.REQUEST_DISPATCH_REF;
    // Fixed GitHub host, fixed workflow filename, restricted repo/ref syntax.
    // Never accept a repository, URL, token or workflow from request form data.
    if (token && repository && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository) &&
        !repository.includes("..") && ref && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(ref) &&
        !ref.includes("..") && !ref.endsWith(".") &&
        !ref.split("/").some(part => !part || part.startsWith("."))) {
      const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/school-requests.yml/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref, inputs: { task: "process the next requested school" } }),
        signal: AbortSignal.timeout(2500),
        cache: "no-store",
      });
      // GitHub returns 204 for an accepted wake-up, not a finished/claimed job.
      if (response.status === 204) outcome = "accepted";
    }
  } catch {
    // Timeout, transport failure and bad configuration all retain the request.
  }
  try { await recordRequestDispatch(result.request.id, outcome); } catch {
    // Timing telemetry is best effort; the scheduled worker is the recovery path.
  }
}
