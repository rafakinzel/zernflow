import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { refuseUnlessAgent } from "@/lib/central-agent/auth";
import { dmErrorResponse } from "@/lib/central-agent/respond";
import { lerParametrosLeads, listarLeads } from "@/lib/central-agent/leads";

/**
 * GET /api/v1/central/leads?dias=7&limite=200
 *
 * Leads from the link-in-bio quiz, newest first, each with the answers in
 * Portuguese, the recommended product, the consent and a fixed tier
 * (quente / morno / sem_contato) with the reasons. Read-only. No surname,
 * email or WhatsApp: see lib/central-agent/leads.ts.
 */
export async function GET(request: NextRequest) {
  const refused = refuseUnlessAgent(request);
  if (refused) return refused;

  try {
    const params = lerParametrosLeads(new URL(request.url).searchParams);
    const db = (await createServiceClient()) as unknown as SupabaseClient;
    return NextResponse.json(await listarLeads(db, params));
  } catch (error) {
    return dmErrorResponse(error, "list leads");
  }
}
