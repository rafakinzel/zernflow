import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { dmErrorResponse } from "@/lib/central-agent/respond";
import { resolveWorkspaceId } from "@/lib/central-agent/store";
import { lerParametros } from "@/lib/central-agent/dm";
import { listarPerguntasNoFluxo } from "@/lib/central-agent/perguntas-no-fluxo";

/**
 * GET /api/v1/central/perguntas-no-fluxo?dias=1
 *
 * What people typed in the middle of a flow that the flow could not read as
 * an answer, newest first, with the step they were on and whether someone has
 * answered by hand since. The flow carried on; these are for the Central to
 * answer (through /responder, approved by Rafa). Read-only: it never pauses,
 * resumes or ends a run. No contact identifiers, as in /conversas.
 */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const { dias } = lerParametros(new URL(request.url).searchParams);
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    return NextResponse.json(await listarPerguntasNoFluxo(db, workspaceId, dias));
  } catch (error) {
    return dmErrorResponse(error, "list questions typed during flows");
  }
}
