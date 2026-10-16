import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, encryptionAvailable } from "@/lib/secrets";
import {
  ActiveCampaignError,
  normalizeBaseUrl,
  testCredentials,
} from "@/lib/activecampaign";

/** Resolves the caller's workspace, or null when they have none. */
async function currentWorkspace(supabase: Awaited<ReturnType<typeof createClient>>) {
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

  return membership?.workspace_id ?? null;
}

/**
 * GET /api/v1/integrations/activecampaign
 *
 * Connection status for the Settings panel. Never returns the API key.
 */
export async function GET() {
  const supabase = await createClient();
  const workspaceId = await currentWorkspace(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("activecampaign_url, activecampaign_api_key_encrypted")
    .eq("id", workspaceId)
    .single();

  return NextResponse.json({
    connected: Boolean(
      workspace?.activecampaign_url && workspace.activecampaign_api_key_encrypted
    ),
    url: workspace?.activecampaign_url ?? "",
    encryptionAvailable: encryptionAvailable(),
  });
}

/**
 * POST /api/v1/integrations/activecampaign
 *
 * Saves the credentials, but only after they answer. Storing an untested key
 * would turn a typo into a flow that fails silently at 2am.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const workspaceId = await currentWorkspace(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const baseUrl = normalizeBaseUrl(String(body?.url ?? ""));
  const apiKey = String(body?.apiKey ?? "").trim();

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: "Informe a URL da conta e a chave da API." },
      { status: 400 }
    );
  }

  try {
    await testCredentials({ baseUrl, apiKey });
  } catch (err) {
    const message =
      err instanceof ActiveCampaignError
        ? err.message
        : "Não consegui falar com o ActiveCampaign.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error } = await supabase
    .from("workspaces")
    .update({
      activecampaign_url: baseUrl,
      activecampaign_api_key_encrypted: encryptSecret(apiKey),
    })
    .eq("id", workspaceId);

  if (error) {
    return NextResponse.json(
      { error: `Credenciais válidas, mas não consegui salvar: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    connected: true,
    url: baseUrl,
    encryptionAvailable: encryptionAvailable(),
  });
}

/** DELETE /api/v1/integrations/activecampaign — disconnects the integration. */
export async function DELETE() {
  const supabase = await createClient();
  const workspaceId = await currentWorkspace(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("workspaces")
    .update({
      activecampaign_url: null,
      activecampaign_api_key_encrypted: null,
    })
    .eq("id", workspaceId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connected: false });
}
