import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { listKeywords, resolveWorkspaceId } from "@/lib/central-agent/store";

/**
 * GET /api/v1/central/keywords
 *
 * Every comment and DM keyword the workspace has, with its flow, whether it
 * answers today, and who made it. Read-only. `?keyword=SS` narrows to one,
 * ignoring case and a leading `#`.
 */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const db = await createServiceClient();
    const workspaceId = await resolveWorkspaceId(db);
    let keywords = await listKeywords(db, workspaceId);

    const wanted = request.nextUrl.searchParams.get("keyword");
    if (wanted) {
      const key = wanted.trim().replace(/^#+/, "").trim().toLowerCase();
      keywords = keywords.filter((k) => k.keyword.toLowerCase() === key);
    }

    return NextResponse.json({ keywords });
  } catch (error) {
    return errorResponse(error, "list keywords");
  }
}
