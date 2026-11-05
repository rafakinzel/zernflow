import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { resolveWorkspaceId } from "@/lib/central-agent/store";
import { buildMapa } from "@/lib/central-agent/mapa";

/**
 * GET /api/v1/central/mapa
 *
 * Every flow in the workspace, read-only: whether it answers today, its
 * triggers and keywords, each step in plain words, where it hands people on,
 * and the links it sends. What the routines read before preparing anything,
 * so a new flow never steps on one that runs every day.
 */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    return NextResponse.json(await buildMapa(db, workspaceId));
  } catch (error) {
    return errorResponse(error, "build map");
  }
}
