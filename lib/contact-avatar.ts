/**
 * Keeping a copy of a lead's profile picture.
 *
 * Meta hands back a signed CDN link and documents that it expires in a few
 * days, so a link stored on the contact row is a picture with a shelf life.
 * The bytes are copied into our own bucket once, and the row points there.
 *
 * Nothing here is allowed to break the caller. A profile picture is the least
 * important thing happening on a webhook, so every failure path ends in
 * "leave the contact alone and carry on": the Inbox already falls back to the
 * person's initial.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTACT_AVATAR_BUCKET = "contact-avatars";

/** Matches the bucket's own limit, so an oversized fetch is dropped early. */
const MAX_BYTES = 1024 * 1024;

/** Long enough for a CDN, short enough not to hold up a webhook. */
const FETCH_TIMEOUT_MS = 5000;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** True when a stored value already points at our own bucket. */
export function isCachedAvatar(url: string | null | undefined): boolean {
  return Boolean(url && url.includes(`/${CONTACT_AVATAR_BUCKET}/`));
}

/**
 * Whether a remote picture is worth fetching for this contact.
 *
 * A contact whose picture is already cached is left alone: the platform's
 * link changes on every sync, and re-downloading the same face because the
 * query string moved would cost a request per contact per sync forever.
 */
export function shouldCacheAvatar(
  remoteUrl: string | null | undefined,
  storedUrl: string | null | undefined
): boolean {
  if (!remoteUrl) return false;
  if (!/^https?:\/\//i.test(remoteUrl)) return false;
  return !isCachedAvatar(storedUrl);
}

/**
 * Copies a remote picture into storage and returns the public URL, or null
 * when anything at all goes wrong.
 *
 * The caller decides what null means. On a contact with no picture it means
 * "still no picture"; on one holding an expiring platform link it means
 * "keep the link", which still renders until it expires.
 */
export async function cacheContactAvatar(
  supabase: SupabaseClient,
  contactId: string,
  remoteUrl: string
): Promise<string | null> {
  try {
    const response = await fetch(remoteUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = EXTENSIONS[contentType];
    // Not an image we can serve. Whatever it is, it is not going in a bucket
    // that the Inbox renders with an <img>.
    if (!extension) return null;

    // Content-Length is advisory, so the real size is checked after reading.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    // A fresh name per fetch. A fixed one keeps its URL, and the browser would
    // go on showing the old face out of cache after the person changed theirs.
    const path = `${contactId}/${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from(CONTACT_AVATAR_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) {
      console.error("[contact-avatar] upload failed:", error.message);
      return null;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(CONTACT_AVATAR_BUCKET).getPublicUrl(path);

    return publicUrl;
  } catch (err) {
    console.error("[contact-avatar] could not fetch the picture:", err);
    return null;
  }
}
