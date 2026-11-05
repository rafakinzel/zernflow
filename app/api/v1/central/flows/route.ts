import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { createDraftFlow, resolveWorkspaceId } from "@/lib/central-agent/store";
import { InputError } from "@/lib/central-agent/flow-template";

/**
 * POST /api/v1/central/flows
 *
 * Prepares a comment-to-DM flow for one keyword, switched off: the flow is a
 * draft and its trigger inactive. Rafa reviews it and publishes it in the
 * builder, which is what puts it on the air.
 *
 * Only the fields below are read. Anything else in the body (a `status`, an
 * `is_active`, a `matchType`) is ignored, not honoured: there is no way to ask this route
 * for a live flow.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const body = await request.json().catch(() => {
      throw new InputError("O corpo precisa ser JSON.");
    });

    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    const created = await createDraftFlow(db, workspaceId, {
      keyword: body?.keyword,
      message: body?.message,
      pdfUrl: body?.pdfUrl,
      name: body?.name,
      commentReplies: body?.commentReplies,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return errorResponse(error, "create flow");
  }
}
