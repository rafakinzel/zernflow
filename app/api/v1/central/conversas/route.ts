import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { dmErrorResponse } from "@/lib/central-agent/respond";
import { resolveWorkspaceId } from "@/lib/central-agent/store";
import { lerParametros } from "@/lib/central-agent/dm";
import { listarConversas } from "@/lib/central-agent/dm-store";

/** Each thread is one Zernio call; the listing stops calling at 40 s. */
export const maxDuration = 60;

/**
 * GET /api/v1/central/conversas?dias=2&limite=50
 *
 * Recent Instagram direct conversations, newest first, each with its latest
 * messages labelled contato / automacao / pessoa, whether Meta's 24-hour
 * window is open, and whether a person has taken it over. Read-only.
 *
 * Nothing that identifies the contact leaves: no username, name, avatar,
 * phone, email or platform id. The only id is our own conversation id,
 * which is what POST /responder takes.
 */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const { dias, limite } = lerParametros(new URL(request.url).searchParams);
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    return NextResponse.json(await listarConversas(db, workspaceId, { dias, limite }));
  } catch (error) {
    return dmErrorResponse(error, "list conversations");
  }
}
