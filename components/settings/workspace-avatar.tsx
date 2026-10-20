"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import { ImageCropper } from "./image-cropper";

/** A photo straight off a camera, not what gets uploaded. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

/** The generated picture, used until someone uploads one of their own. */
function fallbackUrl(seed: string, size = 96) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(
    seed
  )}&size=${size}`;
}

export function WorkspaceAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown while the upload is in flight, so the new picture appears the
  // moment it is picked rather than after the round trip.
  const [preview, setPreview] = useState<string | null>(null);
  // The file waiting to be framed. The cropper is what actually produces
  // the upload, so nothing leaves the browser until it is confirmed.
  const [pending, setPending] = useState<File | null>(null);

  const shown = preview ?? avatarUrl ?? fallbackUrl(name);
  const hasOwn = Boolean(preview ?? avatarUrl);

  async function upload(blob: Blob) {
    setBusy(true);
    setError(null);
    const localPreview = URL.createObjectURL(blob);
    setPreview(localPreview);

    try {
      const extension = blob.type === "image/png" ? "png" : "webp";
      const body = new FormData();
      body.append("file", blob, `avatar.${extension}`);
      const res = await fetch("/api/v1/workspace/avatar", {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Could not upload that image.");
        setPreview(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setPreview(null);
    } finally {
      setBusy(false);
      URL.revokeObjectURL(localPreview);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/workspace/avatar", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not remove the picture.");
        return;
      }
      setPreview(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="mb-2 block text-xs text-muted-foreground">Picture</label>

      <div className="flex items-center gap-4">
        {/* Not next/image: the file lives on a storage host and the fallback
            on another, and neither is worth adding to the image config for a
            48-pixel square. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shown}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {hasOwn ? "Change" : "Upload"}
          </button>

          {hasOwn && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-red-500 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file twice still fires a change.
          e.target.value = "";
          if (!file) return;
          // Only a guard against a video or a RAW file picked by mistake.
          // The upload itself is the cropped 512px square, not this.
          if (file.size > MAX_SOURCE_BYTES) {
            setError(
              `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. Pick one under 40 MB.`
            );
            return;
          }
          setError(null);
          setPending(file);
        }}
      />

      <p className="mt-2 text-xs text-muted-foreground">
        Use the original photo, the bigger the better. You crop it here and
        it is resized for you. Anyone with the link can view it.
      </p>

      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}

      {pending && (
        <ImageCropper
          file={pending}
          onCancel={() => setPending(null)}
          onDone={(blob) => {
            setPending(null);
            upload(blob);
          }}
        />
      )}
    </div>
  );
}
