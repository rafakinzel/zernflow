import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cacheContactAvatar,
  isCachedAvatar,
  shouldCacheAvatar,
} from "./contact-avatar";

afterEach(() => vi.unstubAllGlobals());

/** Records what reached storage, and answers like Supabase would. */
function fakeStorage(uploadError: { message: string } | null = null) {
  const uploads: { bucket: string; path: string; bytes: number }[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, body: Uint8Array) {
            uploads.push({ bucket, path, bytes: body.byteLength });
            return Promise.resolve({ error: uploadError });
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, uploads };
}

function imageResponse(
  contentType: string,
  bytes: number,
  headers: Record<string, string> = {}
) {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": contentType, ...headers },
  });
}

describe("isCachedAvatar", () => {
  it("recognises our own bucket and nothing else", () => {
    expect(isCachedAvatar("https://x.supabase.co/x/contact-avatars/a/1.jpg")).toBe(true);
    expect(isCachedAvatar("https://scontent.cdninstagram.com/pic.jpg")).toBe(false);
    expect(isCachedAvatar(null)).toBe(false);
    expect(isCachedAvatar("")).toBe(false);
  });
});

describe("shouldCacheAvatar", () => {
  it("fetches when there is a remote picture and no copy yet", () => {
    expect(shouldCacheAvatar("https://cdn/pic.jpg", null)).toBe(true);
    expect(shouldCacheAvatar("https://cdn/pic.jpg", "https://cdn/old.jpg")).toBe(true);
  });

  it("leaves a contact alone once the copy exists", () => {
    // The platform's link changes every sync; the face does not.
    expect(
      shouldCacheAvatar("https://cdn/pic.jpg", "https://x/contact-avatars/a/1.jpg")
    ).toBe(false);
  });

  it("ignores anything that is not an http url", () => {
    expect(shouldCacheAvatar(null, null)).toBe(false);
    expect(shouldCacheAvatar("", null)).toBe(false);
    expect(shouldCacheAvatar("data:image/png;base64,AAAA", null)).toBe(false);
    expect(shouldCacheAvatar("javascript:alert(1)", null)).toBe(false);
  });
});

describe("cacheContactAvatar", () => {
  it("stores the bytes and returns the public url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("image/jpeg", 4096)));
    const { client, uploads } = fakeStorage();

    const url = await cacheContactAvatar(client, "contact-9", "https://cdn/pic.jpg");

    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe("contact-avatars");
    expect(uploads[0].path).toMatch(/^contact-9\/\d+\.jpg$/);
    expect(url).toContain("/contact-avatars/contact-9/");
  });

  it("takes the extension from the content type, not the url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse("image/webp; charset=binary", 1024))
    );
    const { client, uploads } = fakeStorage();

    await cacheContactAvatar(client, "contact-9", "https://cdn/pic.jpg?x=1");

    expect(uploads[0].path).toMatch(/\.webp$/);
  });

  it("refuses anything that is not an image we serve", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("text/html", 512)));
    const { client, uploads } = fakeStorage();

    expect(await cacheContactAvatar(client, "c", "https://cdn/pic.jpg")).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("refuses a file over the bucket's limit, by header or by body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        imageResponse("image/jpeg", 16, { "content-length": "99999999" })
      )
    );
    const big = fakeStorage();
    expect(await cacheContactAvatar(big.client, "c", "https://cdn/p.jpg")).toBeNull();
    expect(big.uploads).toHaveLength(0);

    // Content-Length is advisory, so an honest-looking header with a huge body
    // has to be caught after reading.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse("image/jpeg", 2 * 1024 * 1024))
    );
    const lying = fakeStorage();
    expect(await cacheContactAvatar(lying.client, "c", "https://cdn/p.jpg")).toBeNull();
    expect(lying.uploads).toHaveLength(0);
  });

  it("refuses an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("image/png", 0)));
    const { client, uploads } = fakeStorage();

    expect(await cacheContactAvatar(client, "c", "https://cdn/p.png")).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("returns null rather than throwing when the fetch or the upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const down = fakeStorage();
    expect(await cacheContactAvatar(down.client, "c", "https://cdn/p.jpg")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => imageResponse("image/jpeg", 2048)));
    const refused = fakeStorage({ message: "bucket not found" });
    expect(
      await cacheContactAvatar(refused.client, "c", "https://cdn/p.jpg")
    ).toBeNull();
  });

  it("returns null on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 410 }))
    );
    const { client } = fakeStorage();
    expect(await cacheContactAvatar(client, "c", "https://cdn/p.jpg")).toBeNull();
  });
});
