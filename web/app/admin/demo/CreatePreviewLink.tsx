"use client";

import { useActionState } from "react";
import { makeDemoInvite, type CreatePreviewState } from "./actions";

const initialState: CreatePreviewState = { url: null, error: null };

export function CreatePreviewLink() {
  const [state, action, pending] = useActionState(makeDemoInvite, initialState);

  return (
    <section className="flex flex-col gap-3">
      <form action={action}>
        <button
          disabled={pending}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Creating secure link…" : "Create preview link"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="rounded-xl border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">
          {state.error}
        </p>
      )}
      {state.url && (
        <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4" role="status">
          <p className="font-medium text-ink">New private-preview link — copy it now.</p>
          <p className="mt-1 break-all rounded-lg bg-white/70 p-3 font-mono text-xs text-ink/75">{state.url}</p>
          <p className="mt-2 text-xs text-ink/55">For security, this single-use link is not stored and cannot be shown again.</p>
        </div>
      )}
    </section>
  );
}
