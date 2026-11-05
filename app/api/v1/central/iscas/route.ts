import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { errorResponse } from "@/lib/central-agent/respond";
import { createIscaUploadUrl, uploadIsca } from "@/lib/central-agent/store";
import { InputError } from "@/lib/central-agent/flow-template";

/**
 * POST /api/v1/central/iscas
 *
 * Puts a lead-magnet PDF in the public `iscas` bucket and answers with its
 * link. Two ways in:
 *
 * - multipart with a `file` field: uploaded here. Up to about 4 MB, the
 *   most Vercel lets through a request.
 * - JSON `{ "fileName": "..." }`: answers with a one-time `uploadUrl` the
 *   routine PUTs the file to directly, for anything bigger.
 *
 * Either way the public link is in `publicUrl`. Files are never
 * overwritten: each upload gets a name of its own.
 */
export async function POST(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const db = await createServiceClient();
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) throw new InputError("Envie o PDF no campo file.");
      const result = await uploadIsca(db, {
        name: file.name || "isca.pdf",
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return NextResponse.json(result, { status: 201 });
    }

    const body = await request.json().catch(() => {
      throw new InputError("Envie multipart com file, ou JSON com fileName.");
    });
    const result = await createIscaUploadUrl(db, body?.fileName);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "upload isca");
  }
}
