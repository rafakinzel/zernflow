import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { dmErrorResponse } from "@/lib/central-agent/respond";
import { resolveWorkspaceId } from "@/lib/central-agent/store";
import { Recusa, validarPedido } from "@/lib/central-agent/dm";
import { responder } from "@/lib/central-agent/dm-store";

/**
 * POST /api/v1/central/responder
 *
 * `{ "conversa": "<id de GET /conversas>", "texto": "…", "chave": "…"? }`
 *
 * Sends one reply Rafa or Thiago approved in the Central, through the same
 * Zernio call the inbox uses. Refused (4xx, with `erro` in Portuguese) when
 * the conversation is not Instagram or not in the workspace, a person has
 * taken it over, the 24-hour window is shut, somebody already answered the
 * person's last message, the text is empty or over 1000 characters, or the
 * same `chave` was used in the last 24 hours.
 *
 * Sends a message and nothing else: no flow, trigger, tag or contact field
 * is touched, and the automation pause is never changed.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const body = await request.json().catch(() => {
      throw new Recusa(400, "json_invalido", "Mande JSON: { conversa, texto, chave? }.");
    });
    const pedido = validarPedido(body);
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    return NextResponse.json(await responder(db, workspaceId, pedido), { status: 201 });
  } catch (error) {
    return dmErrorResponse(error, "send reply");
  }
}
