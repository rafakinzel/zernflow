/**
 * ActiveCampaign API v3 client.
 *
 * Only the four calls the flow builder needs. Endpoints and shapes verified
 * against developers.activecampaign.com:
 *
 *  - auth is an `Api-Token` header, base URL `https://{account}.api-us1.com`
 *  - POST /api/3/contact/sync   upserts by email (201 created / 200 updated)
 *  - POST /api/3/contactLists   subscribes a contact id to a list id
 *  - GET  /api/3/lists          { lists: [{ id, name }] }
 *  - GET  /api/3/fields?all=1   { fields: [{ id, title, type }] }
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { decryptSecret } from "@/lib/secrets";

export interface ActiveCampaignCredentials {
  /** Account base URL, without a trailing slash and without /api/3. */
  baseUrl: string;
  apiKey: string;
}

export interface ACList {
  id: string;
  name: string;
}

export interface ACField {
  id: string;
  title: string;
  type: string;
}

export interface ACContactFieldValue {
  field: string;
  value: string;
}

export class ActiveCampaignError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ActiveCampaignError";
  }
}

/**
 * Normalizes whatever the user pasted into a base URL.
 * Accepts "acme", "acme.api-us1.com", "https://acme.api-us1.com" and the same
 * with a trailing slash or a trailing /api/3.
 */
export function normalizeBaseUrl(input: string): string {
  let value = input.trim();
  if (!value) return "";

  value = value.replace(/\/+$/, "").replace(/\/api\/3$/i, "");
  if (!/^https?:\/\//i.test(value)) {
    value = value.includes(".")
      ? `https://${value}`
      : `https://${value}.api-us1.com`;
  }
  return value.replace(/\/+$/, "");
}

async function request<T>(
  credentials: ActiveCampaignCredentials,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const url = `${credentials.baseUrl}/api/3/${path.replace(/^\//, "")}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        "Api-Token": credentials.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (err) {
    throw new ActiveCampaignError(
      `Could not reach ActiveCampaign at ${credentials.baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 403 here is almost always a wrong Api-Token rather than a permissions
    // problem, so say the useful thing instead of echoing the status.
    const hint =
      res.status === 403
        ? "ActiveCampaign rejected the API key."
        : `ActiveCampaign returned ${res.status}.`;
    throw new ActiveCampaignError(
      `${hint}${text ? ` ${text.slice(0, 300)}` : ""}`,
      res.status
    );
  }

  return (await res.json()) as T;
}

/** Verifies the credentials, returning the account's own user record. */
export async function testCredentials(
  credentials: ActiveCampaignCredentials
): Promise<void> {
  await request(credentials, "users/me");
}

export async function listLists(
  credentials: ActiveCampaignCredentials
): Promise<ACList[]> {
  // 100 is the endpoint's maximum page size; a workspace with more lists than
  // that can still pin one by typing the id.
  const data = await request<{ lists?: Array<{ id?: string; name?: string }> }>(
    credentials,
    "lists?limit=100"
  );
  return (data.lists ?? [])
    .filter((l) => l.id)
    .map((l) => ({ id: String(l.id), name: l.name ?? `Lista ${l.id}` }));
}

export async function listFields(
  credentials: ActiveCampaignCredentials
): Promise<ACField[]> {
  const data = await request<{
    fields?: Array<{ id?: string; title?: string; type?: string }>;
  }>(credentials, "fields?all=1");
  return (data.fields ?? [])
    .filter((f) => f.id)
    .map((f) => ({
      id: String(f.id),
      title: f.title ?? `Campo ${f.id}`,
      type: f.type ?? "text",
    }));
}

/**
 * Creates or updates a contact by email and returns its id.
 *
 * `contact/sync` is the upsert: a second run for the same email updates
 * instead of creating a duplicate, which is what a flow that can be
 * re-entered needs.
 */
export async function syncContact(
  credentials: ActiveCampaignCredentials,
  contact: {
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    fieldValues?: ACContactFieldValue[];
  }
): Promise<string> {
  const body: Record<string, unknown> = { email: contact.email };
  if (contact.firstName) body.firstName = contact.firstName;
  if (contact.lastName) body.lastName = contact.lastName;
  if (contact.phone) body.phone = contact.phone;
  if (contact.fieldValues?.length) body.fieldValues = contact.fieldValues;

  const data = await request<{ contact?: { id?: string } }>(
    credentials,
    "contact/sync",
    { method: "POST", body: { contact: body } }
  );

  const id = data.contact?.id;
  if (!id) {
    throw new ActiveCampaignError(
      "ActiveCampaign accepted the contact but returned no id."
    );
  }
  return String(id);
}

/** Subscribes a contact to a list. status 1 is subscribed, 2 unsubscribed. */
export async function addContactToList(
  credentials: ActiveCampaignCredentials,
  params: { contactId: string; listId: string; status?: 1 | 2 }
): Promise<void> {
  await request(credentials, "contactLists", {
    method: "POST",
    body: {
      contactList: {
        list: Number(params.listId),
        contact: Number(params.contactId),
        status: params.status ?? 1,
      },
    },
  });
}

/**
 * Loads a workspace's stored ActiveCampaign credentials, or null when the
 * integration has not been connected.
 */
export async function getWorkspaceCredentials(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<ActiveCampaignCredentials | null> {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("activecampaign_url, activecampaign_api_key_encrypted")
    .eq("id", workspaceId)
    .single();

  if (
    !workspace?.activecampaign_url ||
    !workspace.activecampaign_api_key_encrypted
  ) {
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(workspace.activecampaign_url),
    apiKey: decryptSecret(workspace.activecampaign_api_key_encrypted),
  };
}
