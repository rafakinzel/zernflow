"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Post {
  id: string;
  caption: string;
  thumbnail: string | null;
  permalink: string | null;
  createdAt: string | null;
  commentCount: number;
}

interface PostPickerProps {
  selected: string[];
  onChange: (postIds: string[]) => void;
}

function postDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Thumbnail grid for scoping a comment trigger to specific posts. Zernio
 * surfaces published posts through the comments inbox, so a post shows up
 * here once it exists in that inbox; anything missing can still be pinned by
 * pasting its id.
 */
export function PostPicker({ selected, onChange }: PostPickerProps) {
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (after?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = after
        ? `/api/v1/posts?cursor=${encodeURIComponent(after)}`
        : "/api/v1/posts";
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not load your posts.");
        return;
      }
      setPosts((prev) =>
        after ? [...prev, ...(body.posts ?? [])] : (body.posts ?? [])
      );
      setCursor(body.nextCursor ?? null);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && posts.length === 0 && !error) load();
  }, [open, posts.length, error, load]);

  const toggle = useCallback(
    (id: string) => {
      onChange(
        selected.includes(id)
          ? selected.filter((s) => s !== id)
          : [...selected, id]
      );
    },
    [selected, onChange]
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-emerald-400 hover:text-emerald-500"
      >
        {selected.length > 0 ? "Change posts" : "Pick from your posts"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          Your posts
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            title="Reload"
            className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            Done
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-border bg-muted p-3">
          <p className="text-xs text-foreground">{error}</p>
          <button
            type="button"
            onClick={() => load()}
            className="mt-2 text-xs font-medium text-emerald-500 hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {!error && loading && posts.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading your posts
        </div>
      )}

      {!error && !loading && posts.length === 0 && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No posts came back yet. A post appears here once it is in your
          comments inbox, so a brand new one can take a moment.
        </p>
      )}

      {posts.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {posts.map((post) => {
            const isSelected = selected.includes(post.id);
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => toggle(post.id)}
                title={post.caption || post.id}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-md border-2 bg-muted text-left transition-colors",
                  isSelected
                    ? "border-emerald-500"
                    : "border-transparent hover:border-border"
                )}
              >
                {post.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center px-1 text-center text-[9px] leading-tight text-muted-foreground">
                    {post.caption.slice(0, 40) || "No preview"}
                  </span>
                )}

                {isSelected && (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500">
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                  </span>
                )}

                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-[9px] text-white/90">
                  {postDate(post.createdAt)}
                  {post.commentCount > 0 && ` · ${post.commentCount}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {cursor && (
        <button
          type="button"
          onClick={() => load(cursor)}
          disabled={loading}
          className="mt-2 w-full rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
        >
          {loading ? "Loading" : "Show older posts"}
        </button>
      )}
    </div>
  );
}
