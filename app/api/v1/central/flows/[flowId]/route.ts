import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { getAgentFlowState, resolveWorkspaceId } from "@/lib/central-agent/store";

/**
 * GET /api/v1/central/flows/:flowId
 *
 * Whether a flow the routines made is still waiting for Rafa or already on.
 * Only flows made through this door are visible here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const { flowId } = await params;
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    return NextResponse.json(await getAgentFlowState(db, workspaceId, flowId));
  } catch (error) {
    return errorResponse(error, "flow state");
  }
}
