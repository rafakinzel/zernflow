import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/v1/flows/{flowId}/duplicate
 *
 * Copies a flow, nodes and wiring included, as a fresh draft.
 *
 * The copy is always a draft, never published, and no `triggers` rows are
 * written for it. Two published flows answering the same keyword would both
 * fire on the same comment, so the copy stays inert until someone opens it,
 * changes what needs changing and publishes on purpose.
 *
 * Node ids are kept as they are: they only have to be unique inside one
 * flow's graph, and rewriting them would mean rewriting every edge for no
 * gain.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: source, error: readError } = await supabase
    .from("flows")
    .select("workspace_id, name, description, nodes, edges, viewport")
    .eq("id", flowId)
    .single();

  if (readError || !source) {
    return NextResponse.json({ error: "Flow not found" }, { status: 404 });
  }

  // Membership is what authorizes the copy; RLS covers the read above but the
  // insert names the workspace explicitly, so check it here too.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("workspace_id", source.workspace_id)
    .limit(1)
    .single();

  if (!membership)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: created, error: insertError } = await supabase
    .from("flows")
    .insert({
      workspace_id: source.workspace_id,
      name: `${source.name} (cópia)`,
      description: source.description,
      nodes: source.nodes,
      edges: source.edges,
      viewport: source.viewport,
      status: "draft",
      version: 1,
    })
    .select("id, name")
    .single();

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? "Could not duplicate the flow" },
      { status: 500 }
    );
  }

  return NextResponse.json({ id: created.id, name: created.name });
}
