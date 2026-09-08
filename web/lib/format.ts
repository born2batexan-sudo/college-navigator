export function formatMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "No date yet";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-urgent/10 text-urgent border-urgent/30",
  high: "bg-warn/10 text-warn border-warn/30",
  normal: "bg-ink/5 text-ink/70 border-ink/10",
  low: "bg-ink/5 text-ink/40 border-ink/10",
};

export const STATE_LABELS: Record<string, string> = {
  not_started: "Not started",
  started: "Started",
  submitted: "Submitted",
  received: "Received by school",
  complete: "Complete",
  blocked: "Blocked",
  waived: "Waived",
  missed: "Missed",
  not_applicable: "Not applicable",
};

export const STATE_STYLES: Record<string, string> = {
  not_started: "bg-ink/5 text-ink/60",
  started: "bg-blue-50 text-blue-700",
  submitted: "bg-amber-50 text-amber-700",
  received: "bg-amber-100 text-amber-800",
  complete: "bg-ok/10 text-ok",
  blocked: "bg-urgent/10 text-urgent",
  waived: "bg-ink/5 text-ink/40",
  missed: "bg-urgent/10 text-urgent",
  not_applicable: "bg-ink/5 text-ink/30",
};

export const COVERAGE_LABELS: Record<string, string> = {
  certified: "Certified",
  beta: "Beta",
  research: "Research",
  unsupported: "Not yet supported",
};

export const COVERAGE_STYLES: Record<string, string> = {
  certified: "bg-ok/10 text-ok",
  beta: "bg-blue-50 text-blue-700",
  research: "bg-warn/10 text-warn",
  unsupported: "bg-ink/5 text-ink/40",
};
