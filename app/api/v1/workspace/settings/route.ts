import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/secrets";

/**
 * Saves the workspace settings.
 *
 * Credentials go through the server for one reason: the browser cannot
 * encrypt them. The settings screen used to write straight to the table from
 * the client, which meant the Zernio key landed in a column called
 * `late_api_key_encrypted` as plain text. Nothing broke, because reading a
 * stored secret passes a non-envelope value through untouched, so the key sat
 * unencrypted and the app went on working, which is exactly why nobody would
 * notice.
 *
 * An empty credential means "leave the stored one alone", so saving the name
 * does not wipe the key.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const workspaceId = String(body?.workspaceId ?? "");

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!membership)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const update: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim();
  }

  if (Array.isArray(body.globalKeywords)) {
    update.global_keywords = body.globalKeywords
      .filter((k: unknown) => typeof k === "string")
      .map((k: string) => k.trim())
      .filter(Boolean);
  }

  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    update.late_api_key_encrypted = encryptSecret(body.apiKey.trim());
  }

  if (typeof body.aiKey === "string" && body.aiKey.trim()) {
    update.ai_api_key = encryptSecret(body.aiKey.trim());
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase
    .from("workspaces")
    .update(update)
    .eq("id", workspaceId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
