"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Factor {
  id: string;
  friendly_name?: string | null;
  created_at: string;
}

const input =
  "mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const button =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50";
const primary =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";

/** The shortest new password accepted. */
const MIN_PASSWORD = 12;

/**
 * The signed-in person's own security: their password, their authenticator
 * apps and the other devices still signed in as them (Rafa, 08/11/2026).
 *
 * Everything here acts on the current user only, through their own session,
 * so it needs no server route. Supabase asks for a fresh code before it lets
 * a session that has an authenticator change the password or remove a factor.
 */
export function SecuritySection() {
  const supabase = createClient();

  // ── Password ────────────────────────────────────────────────────────────
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw1.length < MIN_PASSWORD) {
      setPwMsg({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
      return;
    }
    if (pw1 !== pw2) {
      setPwMsg({ ok: false, text: "The two passwords are different." });
      return;
    }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwBusy(false);
    if (error) {
      setPwMsg({ ok: false, text: error.message });
      return;
    }
    setPw1("");
    setPw2("");
    setPwMsg({
      ok: true,
      text: "Password changed. Use “Sign out other devices” below so no old session keeps working.",
    });
  }

  // ── Authenticator apps ──────────────────────────────────────────────────
  const [factors, setFactors] = useState<Factor[]>([]);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [appName, setAppName] = useState("");
  const [code, setCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (!cancelled) setFactors((data?.totp ?? []).filter((f) => f.status === "verified"));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloads]);

  async function startEnroll() {
    setMfaMsg(null);
    setMfaBusy(true);
    // A half-finished enrolment from before blocks a new one with the same
    // name; clear those first. Only unverified ones, never a working app.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const name = appName.trim() || `Authenticator ${factors.length + 1}`;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: name });
    setMfaBusy(false);
    if (error || !data) {
      setMfaMsg({ ok: false, text: error?.message ?? "Could not start. Try again." });
      return;
    }
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling) return;
    setMfaBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolling.id,
      code: code.replace(/\s/g, ""),
    });
    setMfaBusy(false);
    if (error) {
      setMfaMsg({ ok: false, text: "That code did not work. Type the current code shown in the app." });
      return;
    }
    setEnrolling(null);
    setCode("");
    setAppName("");
    setMfaMsg({
      ok: true,
      text: "Authenticator on. From now on, signing in asks for its code. Add a second one (another phone or a password manager) so losing a phone does not lock you out.",
    });
    reload();
  }

  async function cancelEnroll() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.id });
    setEnrolling(null);
    setCode("");
  }

  async function removeFactor(f: Factor) {
    const last = factors.length === 1;
    const warning = last
      ? "This is your only authenticator. Removing it turns the code step off for your account. Remove it?"
      : `Remove “${f.friendly_name || "Authenticator"}”?`;
    if (!window.confirm(warning)) return;
    setMfaBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
    setMfaBusy(false);
    setMfaMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Removed." });
    reload();
  }

  // ── Other devices ───────────────────────────────────────────────────────
  const [outBusy, setOutBusy] = useState(false);
  const [outMsg, setOutMsg] = useState<string | null>(null);

  async function signOutOthers() {
    setOutBusy(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setOutBusy(false);
    setOutMsg(error ? error.message : "Done. Every other browser and device has to sign in again.");
  }

  const msg = (m: { ok: boolean; text: string } | null) =>
    m && (
      <p className={`mt-2 text-sm ${m.ok ? "text-primary" : "text-destructive"}`} role={m.ok ? "status" : "alert"}>
        {m.text}
      </p>
    );

  return (
    <section>
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Security</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Your own login. Sessions end after 30 days, and the authenticator asks for a code at every sign-in.
      </p>

      {/* Password */}
      <form onSubmit={changePassword} className="mt-5">
        <h3 className="text-xs font-medium text-muted-foreground">Change password</h3>
        <input
          type="password"
          autoComplete="new-password"
          placeholder={`New password (at least ${MIN_PASSWORD} characters)`}
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          className={input}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Type it again"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className={input}
        />
        <div className="mt-2">
          <button type="submit" disabled={pwBusy || !pw1} className={primary}>
            {pwBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Change password
          </button>
        </div>
        {msg(pwMsg)}
      </form>

      {/* Authenticator */}
      <div className="mt-6">
        <h3 className="text-xs font-medium text-muted-foreground">Authenticator app</h3>
        {factors.length === 0 && !enrolling && (
          <p className="mt-1.5 text-sm">Off. Turn it on so a stolen password is not enough to get in.</p>
        )}
        {factors.length > 0 && (
          <ul className="mt-1.5 space-y-1.5">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-primary" />
                  {f.friendly_name || "Authenticator"}
                  <span className="text-xs text-muted-foreground">
                    since {new Date(f.created_at).toLocaleDateString()}
                  </span>
                </span>
                <button type="button" onClick={() => removeFactor(f)} disabled={mfaBusy} className={button} aria-label="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {enrolling ? (
          <form onSubmit={confirmEnroll} className="mt-3 rounded-lg border border-border p-4">
            <p className="text-sm">
              1. In Google Authenticator, Authy or 1Password, add an account and scan this code.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolling.qr} alt="QR code for the authenticator app" className="mt-3 h-44 w-44 rounded bg-white p-2" />
            <p className="mt-2 text-xs text-muted-foreground">
              Can&apos;t scan? Type this key in the app: <code className="break-all">{enrolling.secret}</code>
            </p>
            <p className="mt-3 text-sm">2. Type the 6-digit code the app shows.</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={input}
            />
            <div className="mt-2 flex gap-2">
              <button type="submit" disabled={mfaBusy || code.replace(/\s/g, "").length !== 6} className={primary}>
                {mfaBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Turn on
              </button>
              <button type="button" onClick={cancelEnroll} className={button}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              placeholder={factors.length ? "Name, e.g. 1Password" : "Name, e.g. Rafa's iPhone"}
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className={`${input} mt-0 max-w-xs`}
            />
            <button type="button" onClick={startEnroll} disabled={mfaBusy} className={primary}>
              {mfaBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {factors.length ? "Add another authenticator" : "Turn on authenticator"}
            </button>
          </div>
        )}
        {msg(mfaMsg)}
      </div>

      {/* Other devices */}
      <div className="mt-6">
        <h3 className="text-xs font-medium text-muted-foreground">Other devices</h3>
        <p className="mt-1.5 text-sm">Signs you out everywhere except this browser.</p>
        <button type="button" onClick={signOutOthers} disabled={outBusy} className={`${button} mt-2`}>
          {outBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Sign out other devices
        </button>
        {outMsg && <p className="mt-2 text-sm text-primary">{outMsg}</p>}
      </div>
    </section>
  );
}
