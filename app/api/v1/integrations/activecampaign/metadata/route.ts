import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ActiveCampaignError,
  getWorkspaceCredentials,
  listFields,
  listLists,
  listTags,
} from "@/lib/activecampaign";

/**
 * GET /api/v1/integrations/activecampaign/metadata
 *
 * The lists and custom fields of the connected account, so the flow builder
 * can offer them as menus. This is what spares the user from copying field
 * ids out of ActiveCampaign URLs one by one.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const credentials = await getWorkspaceCredentials(
    supabase,
    membership.workspace_id
  );

  if (!credentials) {
    return NextResponse.json(
      { error: "Conecte o ActiveCampaign em Configurações primeiro." },
      { status: 400 }
    );
  }

  try {
    // The three calls are independent, so pay for one round trip, not three.
    const [lists, fields, tags] = await Promise.all([
      listLists(credentials),
      listFields(credentials),
      listTags(credentials),
    ]);
    return NextResponse.json({ lists, fields, tags });
  } catch (err) {
    const message =
      err instanceof ActiveCampaignError
        ? err.message
        : "Não consegui carregar listas e campos do ActiveCampaign.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
