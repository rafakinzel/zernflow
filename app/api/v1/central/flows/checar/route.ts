import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { listKeywords, resolveWorkspaceId } from "@/lib/central-agent/store";
import { checarPalavra } from "@/lib/central-agent/mapa";
import { InputError, cleanKeyword } from "@/lib/central-agent/flow-template";

/**
 * POST /api/v1/central/flows/checar
 *
 * A dry run of `POST /flows`: would this keyword collide with a flow that
 * already exists, and does the flow named in `levaPara` answer today? Writes
 * nothing. Body: `{ keyword, levaPara? }`.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const body = await request.json().catch(() => {
      throw new InputError("O corpo precisa ser JSON.");
    });
    if (typeof body?.keyword !== "string" || !cleanKeyword(body.keyword)) {
      throw new InputError("keyword é obrigatório.");
    }
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    const existentes = await listKeywords(db, workspaceId);
    return NextResponse.json(checarPalavra(body.keyword, existentes, body?.levaPara));
  } catch (error) {
    return errorResponse(error, "check keyword");
  }
}
