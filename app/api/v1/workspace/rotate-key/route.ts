import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  needsReencryption,
  rotationInProgress,
} from "@/lib/secrets";

/** Columns on the workspace row that hold a vendor credential. */
const SECRET_COLUMNS = [
  "late_api_key_encrypted",
  "activecampaign_api_key_encrypted",
  "ai_api_key",
] as const;

/** Names for the report, so nobody has to read a column name. */
const LABELS: Record<(typeof SECRET_COLUMNS)[number], string> = {
  late_api_key_encrypted: "Zernio",
  activecampaign_api_key_encrypted: "ActiveCampaign",
  ai_api_key: "AI",
};

async function workspaceFor(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  return membership?.workspace_id || null;
}

/** What is still sealed with the outgoing key. */
export async function GET() {
  const supabase = await createClient();
  const workspaceId = await workspaceFor(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: workspace } = await supabase
    .from("workspaces")
    .select(SECRET_COLUMNS.join(","))
    .eq("id", workspaceId)
    .single();

  const row = (workspace ?? {}) as Record<string, string | null>;
  const pending = SECRET_COLUMNS.filter((c) =>
    needsReencryption(row[c] ?? "")
  ).map((c) => LABELS[c]);

  return NextResponse.json({
    encryptionAvailable: encryptionAvailable(),
    rotationInProgress: rotationInProgress(),
    pending,
  });
}

/**
 * Rewrites every stored credential under the current key.
 *
 * Reading already falls back to the outgoing key, so this is what lets the
 * old one be removed afterwards. It is deliberately all-or-nothing per
 * credential: a value that cannot be read with either key is left exactly as
 * it was and reported, because overwriting it with something derived from a
 * failed decrypt would destroy the only copy.
 *
 * Running it twice is harmless. A credential already sealed with the current
 * key is skipped, so nothing is rewritten for the sake of it.
 */
export async function POST() {
  const supabase = await createClient();
  const workspaceId = await workspaceFor(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!encryptionAvailable()) {
    return NextResponse.json(
      { error: "No ENCRYPTION_KEY is set, so there is nothing to re-encrypt." },
      { status: 400 }
    );
  }

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select(SECRET_COLUMNS.join(","))
    .eq("id", workspaceId)
    .single();

  if (error || !workspace) {
    return NextResponse.json(
      { error: error?.message || "Workspace not found." },
      { status: 500 }
    );
  }

  const row = workspace as unknown as Record<string, string | null>;
  const update: Record<string, string> = {};
  const rewritten: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const column of SECRET_COLUMNS) {
    const stored = row[column];
    if (!stored) continue;

    if (!needsReencryption(stored)) {
      skipped.push(LABELS[column]);
      continue;
    }

    try {
      update[column] = encryptSecret(decryptSecret(stored));
      rewritten.push(LABELS[column]);
    } catch {
      // Neither key opens it. Leaving it alone keeps the ciphertext, which
      // is still recoverable if the right key turns up.
      failed.push(LABELS[column]);
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: saveError } = await supabase
      .from("workspaces")
      .update(update)
      .eq("id", workspaceId);

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ rewritten, skipped, failed });
}
