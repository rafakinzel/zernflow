"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * The only way into BorrelliChat.
 *
 * Everything coloured here uses the app's own primary token, which is the
 * green out of the logo file. Nothing is hardcoded, so the day the brand
 * moves this page moves with it.
 *
 * The logo sits on a white plaque in dark mode. Its wordmark is near-black
 * and would otherwise disappear into the background.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Second step: the 6-digit code from the authenticator app, asked only of
  // people who enrolled one (lib/auth-policy.ts).
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // "Forgot password?": Supabase emails a link that signs the person in and
  // lands them on Settings > Security to choose a new password.
  const [resetting, setResetting] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  /** Moves to the code step when this session still needs it; true if so. */
  async function needsCode(): Promise<boolean> {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel !== "aal2" || aal.currentLevel === "aal2") return false;
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === "verified");
    if (!totp) return false;
    setFactorId(totp.id);
    return true;
  }

  useEffect(() => {
    // Read once on arrival: the middleware sends people here with ?expirou=1
    // (session too old) or ?codigo=1 (signed in, code still missing).
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("expirou")) {
        setNotice("For your security, sessions end after 30 days. Please sign in again.");
      }
      if (params.get("codigo")) await needsCode();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (await needsCode()) {
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.replace(/\s/g, ""),
    });
    if (error) {
      setError("That code did not work. Check the app and try the current code.");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const next = encodeURIComponent("/dashboard/settings");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${next}`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setNotice(
      "If this email has an account, a link is on its way. Open it in this same browser, then choose a new password under Settings > Security."
    );
    setResetting(false);
  }

  async function startOver() {
    await supabase.auth.signOut();
    setFactorId(null);
    setCode("");
    setError(null);
  }

  const field =
    "h-11 w-full rounded-lg border border-border bg-background px-3.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/25";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F5F7F6] px-4 py-10 dark:bg-[#0D1114]">
      {/* A single soft wash of the brand green, behind the mark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 flex justify-center">
          <div className="rounded-xl dark:bg-white dark:px-5 dark:py-4">
            <Image
              src="/logo-full.png"
              alt="BorrelliChat"
              width={640}
              height={359}
              priority
              className="h-20 w-auto"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-black/5 bg-white p-7 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_16px_40px_-16px_rgba(16,24,40,0.16)] dark:border-white/10 dark:bg-[#161B20] dark:shadow-none">
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your flows, conversations and automations.
          </p>

          {notice && (
            <p className="mt-4 rounded-lg bg-primary/10 px-3 py-2 text-sm">{notice}</p>
          )}

          {resetting ? (
            <form onSubmit={sendReset} className="mt-6 space-y-4">
              <div>
                <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
                  className={field}
                  placeholder="you@example.com"
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "Sending…" : "Email me a link"}
              </button>
              <button
                type="button"
                onClick={() => setResetting(false)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Back to sign in
              </button>
            </form>
          ) : factorId ? (
            <form onSubmit={handleCode} className="mt-6 space-y-4">
              <div>
                <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
                  Authenticator code
                </label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                  className={field}
                  placeholder="123 456"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Open your authenticator app and type the 6-digit code for BorrelliChat.
                </p>
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "Checking…" : "Continue"}
              </button>
              <button
                type="button"
                onClick={startOver}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Use another account
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className={field}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={`${field} pr-11`}
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setResetting(true);
                setError(null);
              }}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
          </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Accounts are created by the workspace owner.
        </p>
      </div>
    </div>
  );
}
