"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Plug,
} from "lucide-react";

interface Status {
  connected: boolean;
  url: string;
  encryptionAvailable: boolean;
}

const ENDPOINT = "/api/v1/integrations/activecampaign";

/**
 * Connects ActiveCampaign once per workspace, so flow nodes reference the
 * integration instead of carrying a copy of the API key each.
 */
export function ActiveCampaignSection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) return;
      const body: Status = await res.json();
      setStatus(body);
      setUrl(body.url);
    } catch {
      // Status is a convenience; the form still works without it.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, apiKey }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Não consegui conectar.");
        return;
      }
      setStatus(body);
      setUrl(body.url);
      setApiKey("");
      setSaved(true);
    } catch {
      setError("Não consegui falar com o servidor.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await fetch(ENDPOINT, { method: "DELETE" });
      setStatus({ connected: false, url: "", encryptionAvailable: status?.encryptionAvailable ?? false });
      setUrl("");
      setApiKey("");
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">ActiveCampaign</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Conecte uma vez aqui e os fluxos passam a oferecer suas listas e campos
        num menu, sem chave de API em cada nó.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-foreground">
            URL da conta
          </label>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://suaconta.api-us1.com"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Em Settings, Developer, no ActiveCampaign. Pode colar a URL inteira.
          </p>
        </div>

        <div>
          <label className="text-xs font-medium text-foreground">
            Chave da API
          </label>
          <div className="mt-1 flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  status?.connected ? "Chave salva. Cole uma nova para trocar." : "Api-Token"
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-muted-foreground"
                aria-label={showKey ? "Esconder a chave" : "Mostrar a chave"}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={busy || !url.trim() || !apiKey.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              {status?.connected ? "Reconectar" : "Conectar"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-border bg-muted p-3 text-xs text-foreground">
          {error}
        </p>
      )}

      {saved && !error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-500">
          <Check className="h-3 w-3" />
          Conectado. A chave foi testada antes de ser salva.
        </p>
      )}

      {status?.connected && !saved && (
        <div className="mt-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs text-emerald-500">
            <Check className="h-3 w-3" />
            Conectado a {status.url}
          </p>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Desconectar
          </button>
        </div>
      )}

      {status && !status.encryptionAvailable && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
          <span>
            A variável ENCRYPTION_KEY não está configurada neste deploy, então
            as chaves ficam salvas em texto puro no banco. Funciona, mas quem
            tiver acesso ao banco consegue lê-las.
          </span>
        </p>
      )}
    </section>
  );
}
