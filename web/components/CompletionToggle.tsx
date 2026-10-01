"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActionCompleted } from "@/app/actions";

/** Family self-report; independent per action ID, not a school-confirmed status. */
export function CompletionToggle({ actionId, completed, readOnly = false }: { actionId: string; completed: boolean; readOnly?: boolean }) {
  const [checked, setChecked] = useState(completed);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  return <div className="text-sm" data-completion-control>
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-ink">
      <input type="checkbox" aria-label="Completed" checked={checked} disabled={readOnly || pending} onChange={(event) => {
        const next = event.currentTarget.checked;
        setChecked(next);
        setError("");
        startTransition(async () => {
          try { await setActionCompleted(actionId, next); router.refresh(); }
          catch { setChecked(!next); setError("Completion could not be saved. Try again."); }
        });
      }} />
      Completed
    </label>
    <p className="text-xs text-ink/55">{readOnly ? "Read-only example; no change is saved." : "Your family's own completion marker; it does not confirm school receipt or act in a portal."}</p>
    {error && <p role="alert" className="text-xs text-urgent">{error}</p>}
  </div>;
}
