import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { createReelUploadUrl, deleteReel } from "@/lib/central-agent/store";
import { InputError } from "@/lib/central-agent/flow-template";

/**
 * POST /api/v1/central/reels
 *
 * JSON `{ "fileName": "..." }` answers with a one-time `uploadUrl` the
 * routine PUTs the MP4 to, and the `publicUrl` Metricool schedules the Reel
 * from. Files are never overwritten: each upload gets a name of its own.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const db = await createServiceClient();
    const body = await request.json().catch(() => {
      throw new InputError("Envie JSON com fileName.");
    });
    const result = await createReelUploadUrl(db, body?.fileName);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "upload reel");
  }
}

/**
 * DELETE /api/v1/central/reels?path=<path from POST>
 *
 * Removes the MP4 once the Reel is published, so the bucket only ever holds
 * what is waiting to go out.
 */
export async function DELETE(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const db = await createServiceClient();
    const path = request.nextUrl.searchParams.get("path") ?? "";
    const result = await deleteReel(db, path);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "delete reel");
  }
}
