"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ZoomIn } from "lucide-react";

/**
 * Square crop, done in the browser before anything is uploaded.
 *
 * The picture it produces is always OUTPUT×OUTPUT and a couple of hundred
 * kilobytes, which is what makes a large original worth keeping: the person
 * picks the photo straight off the camera and the downscale happens once,
 * from the full-resolution source. Shrinking it by hand first to clear an
 * upload limit and then cropping a region out of that is two losses, and
 * the second one is the visible one.
 */

/** Wide enough for a 48px avatar at 4x, small enough to stay under ~200 KB. */
const OUTPUT = 512;

/** On-screen size of the crop square, in CSS pixels. */
const VIEW = 288;

const MAX_ZOOM = 4;

export function ImageCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  // Top-left of the drawn image, in view pixels. The handlers below close
  // over the current render's values, so a drag reads the framing as it is
  // without a ref shadowing the state.
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  /** Scale at which the image exactly covers the square. */
  const baseScale = useCallback(() => {
    const img = bitmapRef.current;
    if (!img) return 1;
    return Math.max(VIEW / img.width, VIEW / img.height);
  }, []);

  /** Keeps the square covered: no transparent gap at any edge. */
  const clamp = useCallback(
    (x: number, y: number, z: number) => {
      const img = bitmapRef.current;
      if (!img) return { x, y };
      const s = baseScale() * z;
      const w = img.width * s;
      const h = img.height * s;
      return {
        x: Math.min(0, Math.max(VIEW - w, x)),
        y: Math.min(0, Math.max(VIEW - h, y)),
      };
    },
    [baseScale]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // from-image honours the EXIF rotation a phone writes, so a portrait
        // photo does not arrive on its side.
        const bitmap = await createImageBitmap(file, {
          imageOrientation: "from-image",
        });
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current = bitmap;

        const s = Math.max(VIEW / bitmap.width, VIEW / bitmap.height);
        setOffset({
          x: (VIEW - bitmap.width * s) / 2,
          y: (VIEW - bitmap.height * s) / 2,
        });
        setReady(true);
      } catch {
        if (!cancelled) {
          setError(
            "This browser could not read that image. JPG, PNG and WEBP always work; HEIC from an iPhone often does not."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      bitmapRef.current?.close();
      bitmapRef.current = null;
    };
  }, [file]);

  // Redraw whenever the framing changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = bitmapRef.current;
    if (!canvas || !img || !ready) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = VIEW * dpr;
    canvas.height = VIEW * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    const s = baseScale() * zoom;
    ctx.drawImage(img, offset.x, offset.y, img.width * s, img.height * s);
  }, [ready, zoom, offset, baseScale]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const from = offset;

    function move(ev: PointerEvent) {
      setOffset(
        clamp(from.x + (ev.clientX - startX), from.y + (ev.clientY - startY), zoom)
      );
    }
    function up() {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  /** Zooms around the centre of the square rather than the image's corner. */
  function changeZoom(next: number) {
    const img = bitmapRef.current;
    if (!img) return;
    const ratio = next / zoom;
    const x = VIEW / 2 - (VIEW / 2 - offset.x) * ratio;
    const y = VIEW / 2 - (VIEW / 2 - offset.y) * ratio;
    setZoom(next);
    setOffset(clamp(x, y, next));
  }

  async function save() {
    const img = bitmapRef.current;
    if (!img) return;

    const out = document.createElement("canvas");
    out.width = OUTPUT;
    out.height = OUTPUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    // Same framing as the preview, at output resolution.
    const factor = OUTPUT / VIEW;
    const s = baseScale() * zoom * factor;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      offset.x * factor,
      offset.y * factor,
      img.width * s,
      img.height * s
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      // WEBP where it is supported, which is roughly a third of the bytes at
      // the same quality. toBlob hands back a PNG when the type is refused,
      // which is larger but still correct, so there is nothing to catch.
      out.toBlob(resolve, "image/webp", 0.92)
    );
    if (blob) onDone(blob);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop picture"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl">
        <h2 className="text-sm font-semibold">Frame your picture</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag to move, slide to zoom.
        </p>

        {error ? (
          <p className="mt-4 text-sm text-red-500">{error}</p>
        ) : (
          <>
            <div
              className="relative mx-auto mt-4 overflow-hidden rounded-lg border border-border bg-muted"
              style={{ width: VIEW, height: VIEW }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                style={{ width: VIEW, height: VIEW }}
                // block, or the canvas sits on a text baseline and leaves a
                // few pixels of the container showing under it.
                className="block cursor-grab touch-none active:cursor-grabbing"
              />
              {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <ZoomIn className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                disabled={!ready}
                onChange={(e) => changeZoom(Number(e.target.value))}
                aria-label="Zoom"
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
              />
            </div>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!ready || Boolean(error)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Save picture
          </button>
        </div>
      </div>
    </div>
  );
}
