import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { PROVIDER_LABELS, devLoginEnabled, emailCodeEnabled, enabledProviders, safeNext, supabaseConfigured } from "@/lib/auth/env";
import { devSignIn, sendEmailCode, signInWithProvider, verifyEmailCode } from "./actions";

export const dynamic = "force-dynamic";

type Search = { error?: string; step?: string; email?: string; next?: string; deleted?: string; out?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getSessionUser()) redirect(next);

  const codeStep = query.step === "code" && !!query.email;
  const inputCls = "w-full rounded-md border border-line bg-white px-3 py-2 text-ink";
  const btnCls = "w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90";

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 pt-10">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-ink/40">College Navigator</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{codeStep ? "Check your email" : "Sign in"}</h1>
        <p className="mt-1 text-ink/60">
          {codeStep
            ? emailCodeEnabled
              ? `We sent a code to ${query.email}. Type it below.`
              : `We sent a sign-in link to ${query.email}. Open it on this same device and browser to finish signing in.`
            : "Sign in or create your family plan. Signing in never gives us access to your inbox."}
        </p>
      </header>

      {query.deleted && (
        <p className="rounded-md border border-line bg-ink/5 p-3 text-sm text-ink/70">Your account and family data were deleted.</p>
      )}
      {query.error && (
        <p role="alert" className="rounded-md border border-urgent/30 bg-urgent/10 p-3 text-sm text-urgent">
          {query.error}
        </p>
      )}

      {!supabaseConfigured && !devLoginEnabled && (
        <p className="rounded-md border border-warn/30 bg-warn/10 p-3 text-sm text-ink/80">
          Sign-in is not switched on for this site yet.
        </p>
      )}

      {codeStep ? (
        <div className="flex flex-col gap-3">
          {emailCodeEnabled ? (
            <form action={verifyEmailCode} className="flex flex-col gap-3">
              <input type="hidden" name="email" value={query.email} />
              <input type="hidden" name="next" value={next} />
              <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor="code">
                6-digit code
                <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required className={inputCls} />
              </label>
              <button type="submit" className={btnCls}>
                Sign in
              </button>
            </form>
          ) : (
            <p className="text-sm text-ink/60">
              It can take a minute to arrive. Check your spam or junk folder if you do not see it. The link works once.
            </p>
          )}
          <a href={`/login?next=${encodeURIComponent(next)}`} className="text-center text-sm text-ink/50 underline">
            Use a different email
          </a>
        </div>
      ) : (
        <>
          {supabaseConfigured && enabledProviders.length > 0 && (
            <div className="flex flex-col gap-2">
              {enabledProviders.map((p) => (
                <form key={p} action={signInWithProvider}>
                  <input type="hidden" name="provider" value={p} />
                  <input type="hidden" name="next" value={next} />
                  <button
                    type="submit"
                    className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-ink/30"
                  >
                    Continue with {PROVIDER_LABELS[p]}
                  </button>
                </form>
              ))}
              <p className="pt-1 text-center text-xs text-ink/40">or use your email</p>
            </div>
          )}

          {supabaseConfigured && (
            <form action={sendEmailCode} className="flex flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <label className="flex flex-col gap-1 text-sm text-ink/70" htmlFor="email">
                Email address
                <input id="email" name="email" type="email" autoComplete="email" required className={inputCls} />
              </label>
              <button type="submit" className={btnCls}>
                {emailCodeEnabled ? "Email me a sign-in code" : "Email me a sign-in link"}
              </button>
            </form>
          )}

          {devLoginEnabled && (
            <form action={devSignIn} className="flex flex-col gap-3 rounded-md border border-dashed border-line p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink/40">Local testing only</p>
              <input type="hidden" name="next" value={next} />
              <input id="dev-email" name="email" type="email" required placeholder="test@example.com" className={inputCls} aria-label="Test email" />
              <button type="submit" className={btnCls}>
                Sign in (test)
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
