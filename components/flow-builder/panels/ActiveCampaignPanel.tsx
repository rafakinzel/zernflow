"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, RefreshCw, X } from "lucide-react";

interface ACList {
  id: string;
  name: string;
}

interface ACField {
  id: string;
  title: string;
  type: string;
}

interface FieldValue {
  field: string;
  value: string;
}

interface ACTag {
  id: string;
  name: string;
}

interface PanelData {
  listId?: string;
  tagIds?: string[];
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  fieldValues?: FieldValue[];
  responseVariable?: string;
  [key: string]: unknown;
}

interface Props {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

/**
 * Configures the ActiveCampaign node.
 *
 * Lists and custom fields are read from the connected account, so the person
 * picks "Nome do produto" from a menu instead of digging a numeric id out of
 * an ActiveCampaign URL.
 */
export function ActiveCampaignPanel({ data: rawData, onChange }: Props) {
  const data = rawData as PanelData;
  // Memoized so the empty-array fallback does not produce a new reference on
  // every render and invalidate the callbacks that depend on it.
  const fieldValues = useMemo(() => data.fieldValues ?? [], [data.fieldValues]);

  const tagIds = useMemo(() => data.tagIds ?? [], [data.tagIds]);

  const [lists, setLists] = useState<ACList[]>([]);
  const [fields, setFields] = useState<ACField[]>([]);
  const [tags, setTags] = useState<ACTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/integrations/activecampaign/metadata");
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "Não consegui carregar sua conta.");
        return;
      }
      setLists(body.lists ?? []);
      setFields(body.fields ?? []);
      setTags(body.tags ?? []);
    } catch {
      setError("Não consegui falar com o servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    (patch: Partial<PanelData>) => onChange({ ...data, ...patch }),
    [data, onChange]
  );

  const setFieldValue = useCallback(
    (index: number, patch: Partial<FieldValue>) => {
      const next = fieldValues.map((fv, i) =>
        i === index ? { ...fv, ...patch } : fv
      );
      update({ fieldValues: next });
    },
    [fieldValues, update]
  );

  const unusedField = fields.find(
    (f) => !fieldValues.some((fv) => fv.field === f.id)
  );

  return (
    <div className="space-y-4">
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

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-foreground">Lista</label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            title="Recarregar listas e campos"
            className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
          >
            <RefreshCw className={loading ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
          </button>
        </div>
        <select
          value={data.listId ?? ""}
          onChange={(e) => update({ listId: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Só criar o contato, sem lista</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-foreground">E-mail</label>
        <input
          type="text"
          value={data.email ?? ""}
          onChange={(e) => update({ email: e.target.value })}
          placeholder="{{email}}"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Obrigatório. É por ele que o ActiveCampaign reconhece quem já existe,
          então rodar o fluxo duas vezes atualiza em vez de duplicar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-foreground">Nome</label>
          <input
            type="text"
            value={data.firstName ?? ""}
            onChange={(e) => update({ firstName: e.target.value })}
            placeholder="{{first_name}}"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground">
            Sobrenome
          </label>
          <input
            type="text"
            value={data.lastName ?? ""}
            onChange={(e) => update({ lastName: e.target.value })}
            placeholder="opcional"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-foreground">Tags</label>
        <p className="mt-1 text-xs text-muted-foreground">
          Tags que já existem na sua conta. Clique para marcar.
        </p>

        {tags.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {loading
              ? "Carregando suas tags."
              : "Nenhuma tag encontrada na sua conta."}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const on = tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() =>
                    update({
                      tagIds: on
                        ? tagIds.filter((id) => id !== tag.id)
                        : [...tagIds, tag.id],
                    })
                  }
                  className={
                    on
                      ? "rounded-full border border-emerald-500 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-500"
                      : "rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-emerald-400 hover:text-emerald-500"
                  }
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-foreground">
          Campos personalizados
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          É aqui que entram os UTMs. Os campos vêm da sua conta.
        </p>

        <div className="mt-2 space-y-2">
          {fieldValues.map((fv, index) => (
            <div key={index} className="flex gap-2">
              <select
                value={fv.field}
                onChange={(e) => setFieldValue(index, { field: e.target.value })}
                className="w-1/2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Escolha o campo</option>
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={fv.value}
                onChange={(e) => setFieldValue(index, { value: e.target.value })}
                placeholder="{{utm_source}}"
                className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() =>
                  update({
                    fieldValues: fieldValues.filter((_, i) => i !== index),
                  })
                }
                className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground"
                aria-label="Remover campo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            update({
              fieldValues: [
                ...fieldValues,
                { field: unusedField?.id ?? "", value: "" },
              ],
            })
          }
          disabled={loading}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-emerald-400 hover:text-emerald-500 disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          Adicionar campo
        </button>
      </div>

      <div>
        <label className="text-xs font-medium text-foreground">
          Guardar o id do contato em
        </label>
        <input
          type="text"
          value={data.responseVariable ?? ""}
          onChange={(e) => update({ responseVariable: e.target.value })}
          placeholder="ac_contact_id"
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Opcional. Útil se um nó depois precisar falar do mesmo contato.
        </p>
      </div>
    </div>
  );
}
