"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";

interface FlowOption {
  id: string;
  name: string;
  status: string;
}

interface Props {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/**
 * Picks the flow to hand the contact over to.
 *
 * The flows come from the workspace, by name: this used to be a text box for
 * a raw UUID, which meant opening the other flow in a tab and copying its id
 * out of the address bar.
 */
export function GoToFlowPanel({ data, onChange }: Props) {
  const pathname = usePathname();
  const currentFlowId = pathname?.split("/").filter(Boolean).pop() ?? "";
  const flowId = (data.flowId as string) ?? "";

  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/flows");
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Não consegui carregar seus fluxos.");
        return;
      }
      setFlows(Array.isArray(body) ? body : []);
    } catch {
      setError("Não consegui falar com o servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A flow cannot hand over to itself: that is an immediate loop.
  const options = flows.filter((f) => f.id !== currentFlowId);
  const chosen = flows.find((f) => f.id === flowId);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">
            Levar para o fluxo
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            title="Recarregar"
            className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
          >
            <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          </button>
        </div>

        <select
          value={flowId}
          onChange={(e) => onChange({ ...data, flowId: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">Escolha um fluxo</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.status === "published" ? "" : " (rascunho)"}
            </option>
          ))}
        </select>

        <p className="mt-1.5 text-xs text-muted-foreground">
          A pessoa entra nesse fluxo pelo começo dele, levando junto o que já
          foi capturado aqui, como nome e e-mail.
        </p>
      </div>

      {chosen && chosen.status !== "published" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-xs text-foreground">
            Esse fluxo está em rascunho. Enquanto estiver assim, quem chegar
            aqui não recebe nada. Publique ele antes de usar este nó.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="text-xs">
            <p className="text-foreground">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-1 font-medium text-emerald-500 hover:underline"
            >
              Tentar de novo
            </button>
          </div>
        </div>
      )}

      {loading && flows.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Carregando seus fluxos.
        </p>
      )}

      <p className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
        Este nó encerra o fluxo atual. O que vier depois dele no desenho não é
        executado, então deixe-o como último passo do caminho.
      </p>
    </div>
  );
}
