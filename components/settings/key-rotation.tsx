"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, KeyRound, Loader2, RefreshCw } from "lucide-react";

interface Status {
  encryptionAvailable: boolean;
  rotationInProgress: boolean;
  /** Credentials still sealed with the outgoing key, by vendor name. */
  pending: string[];
}

/**
 * Finishes a key rotation.
 *
 * Swapping ENCRYPTION_KEY alone does not break anything, because reads fall
 * back to ENCRYPTION_KEY_PREVIOUS. What it leaves behind is credentials still
 * sealed with the outgoing key, which is why that variable cannot be removed
 * yet. This rewrites them under the new key and says what is left, so the
 * question "is it safe to delete the old key now" has a visible answer
 * instead of being a guess.
 */
export function KeyRotation() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    // The guard matters because this can resolve after the panel is gone:
    // the POST below triggers a reload, and the panel hides itself as soon
    // as there is nothing left to re-encrypt.
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/v1/workspace/rotate-key");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setStatus(data);
      } catch {
        // Status is a convenience; failing to read it is not worth an alarm.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloads]);

  async function rewrite() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/workspace/rotate-key", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Could not re-encrypt the stored keys.");
        return;
      }

      const parts: string[] = [];
      if (data.rewritten?.length) parts.push(`Re-encrypted: ${data.rewritten.join(", ")}`);
      if (data.skipped?.length) parts.push(`Already current: ${data.skipped.join(", ")}`);
      if (data.failed?.length) {
        parts.push(`Could not be read: ${data.failed.join(", ")}`);
      }
      setResult(parts.join(". ") || "Nothing needed rewriting.");
      refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // Nothing to say when encryption is off or no rotation is under way.
  if (!status?.encryptionAvailable) return null;
  if (!status.rotationInProgress && status.pending.length === 0) return null;

  const done = status.pending.length === 0;

  return (
    <section>
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Encryption key</h2>
      </div>

      <div className="mt-4 rounded-lg border border-border p-4">
        {done ? (
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">Every stored key is on the new one.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You can remove ENCRYPTION_KEY_PREVIOUS from the environment and
                redeploy. Nothing still needs the old key to be read.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium">
                Still sealed with the old key: {status.pending.join(", ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                These are readable, because the old key is still configured.
                Re-encrypt them before you remove it.
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={rewrite}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Re-encrypt stored keys
        </button>

        {result && <p className="mt-2 text-xs text-muted-foreground">{result}</p>}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>
    </section>
  );
}
