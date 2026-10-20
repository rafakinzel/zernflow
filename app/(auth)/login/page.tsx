"use client";

import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

/**
 * The only way into BorrelliChat.
 *
 * Colours here come from the logo rather than the app's own token set: the
 * mark is green and the dashboard's primary is still the purple it shipped
 * with, and a purple button under a green wordmark reads as a mistake on the
 * one screen where the brand is the whole picture.
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
  const router = useRouter();
  const supabase = createClient();

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

    router.push("/dashboard");
    router.refresh();
  }

  const field =
    "h-11 w-full rounded-lg border border-border bg-background px-3.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/25";

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F5F7F6] px-4 py-10 dark:bg-[#0D1114]"
      style={
        {
          "--brand": "#0F8048",
          "--brand-hover": "#0C6B3C",
        } as React.CSSProperties
      }
    >
      {/* A single soft wash of the brand green, behind the mark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-[var(--brand)]/10 blur-3xl dark:bg-[var(--brand)]/15"
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
              className="h-11 w-full rounded-lg bg-[var(--brand)] text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Accounts are created by the workspace owner.
        </p>
      </div>
    </div>
  );
}
