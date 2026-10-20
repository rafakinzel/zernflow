import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** The caller's workspace, or null when they are not signed in. */
async function getWorkspaceId(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  return membership?.workspace_id || null;
}

const BUCKET = "workspace-avatars";
const MAX_BYTES = 2 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Replaces the workspace's picture.
 *
 * The file is checked here as well as by the bucket's own limits, because a
 * rejection from storage arrives as a generic failure the person cannot act
 * on, where "that file is 4 MB, the limit is 2" tells them what to do.
 *
 * Each upload gets a fresh name rather than overwriting a fixed one. A fixed
 * name would keep its URL, and the browser would go on showing the previous
 * picture from cache long after it was replaced.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const workspaceId = await getWorkspaceId(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an image first." }, { status: 400 });
  }

  const extension = EXTENSIONS[file.type];
  if (!extension) {
    return NextResponse.json(
      { error: "Use a PNG, JPG, WEBP or GIF." },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      { error: `That image is ${mb} MB. The limit is 2 MB.` },
      { status: 400 }
    );
  }

  const path = `${workspaceId}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path);

  const { data: previous } = await supabase
    .from("workspaces")
    .select("avatar_url")
    .eq("id", workspaceId)
    .single();

  const { error: saveError } = await supabase
    .from("workspaces")
    .update({ avatar_url: publicUrl })
    .eq("id", workspaceId);

  if (saveError) {
    // The row is what the app reads, so a saved file nobody points at is
    // litter. Clear it rather than leave it behind.
    await supabase.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  await removeStored(supabase, previous?.avatar_url ?? null);

  return NextResponse.json({ avatarUrl: publicUrl });
}

/** Drops the picture and goes back to the generated one. */
export async function DELETE() {
  const supabase = await createClient();
  const workspaceId = await getWorkspaceId(supabase);
  if (!workspaceId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: previous } = await supabase
    .from("workspaces")
    .select("avatar_url")
    .eq("id", workspaceId)
    .single();

  const { error } = await supabase
    .from("workspaces")
    .update({ avatar_url: null })
    .eq("id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await removeStored(supabase, previous?.avatar_url ?? null);

  return NextResponse.json({ avatarUrl: null });
}

/**
 * Deletes the file a stored URL points at, if it is one of ours.
 *
 * Failures are swallowed: the person's picture has already changed by the
 * time this runs, and an orphaned file is a tidiness problem, not something
 * worth showing them an error over.
 */
async function removeStored(
  supabase: Awaited<ReturnType<typeof createClient>>,
  url: string | null
) {
  if (!url) return;
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return;

  const path = url.slice(at + marker.length).split("?")[0];
  if (!path) return;

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.error("[avatar] could not remove the old file:", error);
}
