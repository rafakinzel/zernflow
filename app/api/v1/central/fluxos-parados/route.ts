import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { dmErrorResponse } from "@/lib/central-agent/respond";
import { resolveWorkspaceId } from "@/lib/central-agent/store";
import { lerParametros } from "@/lib/central-agent/dm";
import { listarFluxosParados } from "@/lib/central-agent/fluxos-parados";

/**
 * GET /api/v1/central/fluxos-parados?dias=7
 *
 * Every run the engine handed to a person (someone typed something the
 * buttons did not cover), newest first: the flow, the step it stopped on
 * with its text and buttons, what the person typed, whether the
 * conversation is still paused, whether somebody already answered by hand,
 * whether Meta's window is open, and whether it is still waiting for
 * someone. Read-only: it never resumes a run or lifts the pause. No contact
 * identifiers, as in /conversas.
 */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const { dias } = lerParametros(new URL(request.url).searchParams);
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    return NextResponse.json(await listarFluxosParados(db, workspaceId, dias));
  } catch (error) {
    return dmErrorResponse(error, "list stopped flows");
  }
}
