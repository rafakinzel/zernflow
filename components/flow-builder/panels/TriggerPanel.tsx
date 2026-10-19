"use client";

import { useCallback, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriggerType } from "@/lib/types/database";
import { PostPicker } from "./PostPicker";

interface Keyword {
  value: string;
  matchType: "exact" | "contains" | "startsWith";
}

interface TriggerPanelData {
  triggerType?: string;
  keywords?: Keyword[];
  payload?: string;
  alsoMatchInDms?: boolean;
  commentReplies?: string[];
  postIds?: string[];
  [key: string]: unknown;
}

interface TriggerPanelProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const triggerTypes: Array<{ value: TriggerType; label: string; description: string }> = [
  { value: "keyword", label: "Keyword", description: "Triggered when a user sends a matching keyword" },
  { value: "postback", label: "Button Click", description: "Triggered when a user clicks a button" },
  { value: "quick_reply", label: "Quick Reply", description: "Triggered when a user taps a quick reply" },
  { value: "welcome", label: "Welcome Message", description: "Triggered when a user starts a conversation" },
  { value: "default", label: "Default Reply", description: "Triggered when no other trigger matches" },
  { value: "comment_keyword", label: "Comment Keyword", description: "Triggered by keywords in post comments" },
];

const matchTypes: Array<{ value: "exact" | "contains" | "startsWith"; label: string }> = [
  { value: "exact", label: "Exact match" },
  { value: "contains", label: "Contains" },
  { value: "startsWith", label: "Starts with" },
];

export function TriggerPanel({ data: rawData, onChange }: TriggerPanelProps) {
  const data = rawData as TriggerPanelData;
  const triggerType = data.triggerType || "keyword";
  const keywords = data.keywords || [];
  const [newKeyword, setNewKeyword] = useState("");
  const [newMatchType, setNewMatchType] = useState<"exact" | "contains" | "startsWith">("contains");
  const commentReplies = data.commentReplies || [];
  const [newReply, setNewReply] = useState("");

  const addCommentReply = useCallback(() => {
    const trimmed = newReply.trim();
    if (!trimmed) return;
    onChange({ ...data, commentReplies: [...commentReplies, trimmed] });
    setNewReply("");
  }, [data, commentReplies, newReply, onChange]);

  /**
   * Edits a saved reply in place.
   *
   * These used to render as plain text, so fixing a typo meant deleting the
   * line and retyping it. Blank is allowed while typing and cleaned up on
   * blur, because an empty reply would post an empty comment.
   */
  const updateCommentReply = useCallback(
    (index: number, value: string) => {
      onChange({
        ...data,
        commentReplies: commentReplies.map((r, i) => (i === index ? value : r)),
      });
    },
    [data, commentReplies, onChange]
  );

  const commitCommentReply = useCallback(
    (index: number) => {
      const value = (commentReplies[index] ?? "").trim();
      onChange({
        ...data,
        commentReplies: value
          ? commentReplies.map((r, i) => (i === index ? value : r))
          : commentReplies.filter((_, i) => i !== index),
      });
    },
    [data, commentReplies, onChange]
  );

  const removeCommentReply = useCallback(
    (index: number) => {
      onChange({
        ...data,
        commentReplies: commentReplies.filter((_, i) => i !== index),
      });
    },
    [data, commentReplies, onChange]
  );

  const postIds = data.postIds || [];
  const [showPostIds, setShowPostIds] = useState(false);
  const setPostIds = useCallback(
    (raw: string) => {
      const ids = raw
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      onChange({ ...data, postIds: ids });
    },
    [data, onChange]
  );

  const handleTriggerTypeChange = useCallback(
    (type: string) => {
      onChange({ ...data, triggerType: type });
    },
    [data, onChange]
  );

  const addKeyword = useCallback(() => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    const updated: Keyword[] = [...keywords, { value: trimmed, matchType: newMatchType }];
    onChange({ ...data, keywords: updated });
    setNewKeyword("");
  }, [data, keywords, newKeyword, newMatchType, onChange]);

  const removeKeyword = useCallback(
    (index: number) => {
      const updated = keywords.filter((_, i) => i !== index);
      onChange({ ...data, keywords: updated });
    },
    [data, keywords, onChange]
  );

  /** Edits a saved keyword in place; an emptied one is dropped on blur,
      because a blank keyword would match every comment. */
  const updateKeywordValue = useCallback(
    (index: number, value: string) => {
      onChange({
        ...data,
        keywords: keywords.map((k, i) => (i === index ? { ...k, value } : k)),
      });
    },
    [data, keywords, onChange]
  );

  const commitKeyword = useCallback(
    (index: number) => {
      const value = (keywords[index]?.value ?? "").trim();
      onChange({
        ...data,
        keywords: value
          ? keywords.map((k, i) => (i === index ? { ...k, value } : k))
          : keywords.filter((_, i) => i !== index),
      });
    },
    [data, keywords, onChange]
  );

  const updateKeywordMatchType = useCallback(
    (index: number, matchType: "exact" | "contains" | "startsWith") => {
      const updated = keywords.map((k, i) => (i === index ? { ...k, matchType } : k));
      onChange({ ...data, keywords: updated });
    },
    [data, keywords, onChange]
  );

  const showKeywords = triggerType === "keyword" || triggerType === "comment_keyword";
  const showPayload = triggerType === "postback" || triggerType === "quick_reply";

  return (
    <div className="space-y-5">
      {/* Trigger Type */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">
          Trigger Type
        </label>
        <div className="space-y-1.5">
          {triggerTypes.map((t) => (
            <label
              key={t.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                triggerType === t.value
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-border bg-card hover:border-input"
              )}
            >
              <input
                type="radio"
                name="triggerType"
                value={t.value}
                checked={triggerType === t.value}
                onChange={() => handleTriggerTypeChange(t.value)}
                className="mt-0.5 h-4 w-4 border-input text-emerald-500 focus:ring-emerald-500"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Keywords Section */}
      {showKeywords && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Keywords
          </label>

          {/* Existing keywords */}
          {keywords.length > 0 && (
            <div className="mb-3 space-y-2">
              {keywords.map((keyword, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <input
                    type="text"
                    value={keyword.value}
                    onChange={(e) => updateKeywordValue(index, e.target.value)}
                    onBlur={() => commitKeyword(index)}
                    placeholder="Keyword"
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-foreground focus:border-emerald-500 focus:bg-card focus:outline-none"
                  />
                  <select
                    value={keyword.matchType}
                    onChange={(e) =>
                      updateKeywordMatchType(index, e.target.value as "exact" | "contains" | "startsWith")
                    }
                    className="rounded border border-border bg-muted px-2 py-1 text-xs text-foreground"
                  >
                    {matchTypes.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeKeyword(index)}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new keyword */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="Enter keyword..."
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <select
              value={newMatchType}
              onChange={(e) => setNewMatchType(e.target.value as "exact" | "contains" | "startsWith")}
              className="rounded-lg border border-border bg-card px-2 py-2 text-xs text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {matchTypes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addKeyword}
              disabled={!newKeyword.trim()}
              className="rounded-lg bg-emerald-500 p-2 text-white transition-colors hover:bg-emerald-600 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {keywords.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Add keywords that will trigger this flow. Press Enter or click + to add.
            </p>
          )}

          {/* Comment keywords only: publish also writes a `keyword` trigger row so
              the same flow answers people who DM the keyword instead of commenting. */}
          {triggerType === "comment_keyword" && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card p-3">
              <input
                type="checkbox"
                checked={data.alsoMatchInDms === true}
                onChange={(e) => onChange({ ...data, alsoMatchInDms: e.target.checked })}
                disabled={keywords.length === 0}
                className="mt-0.5 h-4 w-4 rounded border-input text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
              />
              <div>
                <p className="text-sm font-medium text-foreground">Also match in DMs</p>
                <p className="text-xs text-muted-foreground">
                  {keywords.length === 0
                    ? "Add at least one keyword to use this."
                    : "Run this flow when someone sends a keyword as a direct message, not just as a comment."}
                </p>
                {data.alsoMatchInDms === true && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    A DM has no comment behind it, so public replies and the comment
                    variables ({"{{comment_text}}"}, {"{{post_id}}"}) are empty on that run.
                  </p>
                )}
              </div>
            </label>
          )}
        </div>
      )}

      {/* Public reply under the comment. Lives on the trigger because it only
          applies to comment-triggered runs, and takes several variations
          because Instagram throttles an identical reply posted over and over. */}
      {triggerType === "comment_keyword" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Public reply to the comment
          </label>

          {commentReplies.length > 0 && (
            <div className="mb-3 space-y-2">
              {commentReplies.map((reply, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <input
                    type="text"
                    value={reply}
                    onChange={(e) => updateCommentReply(index, e.target.value)}
                    onBlur={() => commitCommentReply(index)}
                    placeholder="Reply text"
                    className="flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm text-foreground focus:border-emerald-500 focus:bg-card focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeCommentReply(index)}
                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newReply}
              onChange={(e) => setNewReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCommentReply();
                }
              }}
              placeholder="Te mandei no direct, corre lá!"
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={addCommentReply}
              className="rounded-lg border border-border px-3 py-2 text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <p className="mt-1.5 text-xs text-muted-foreground">
            {commentReplies.length > 1
              ? `One of the ${commentReplies.length} is picked at random each time.`
              : "Optional. Add a few variations: Instagram throttles an account that keeps posting the identical reply."}
          </p>
        </div>
      )}

      {/* Post scoping. Empty means every post, which is the common case. */}
      {triggerType === "comment_keyword" && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Limit to specific posts
          </label>

          <PostPicker
            selected={postIds}
            onChange={(ids) => onChange({ ...data, postIds: ids })}
          />

          <p className="mt-2 text-xs text-muted-foreground">
            {postIds.length > 0
              ? `Only comments on ${postIds.length === 1 ? "this post" : `these ${postIds.length} posts`} run this flow.`
              : "Nothing picked, so comments on any post run this flow."}
          </p>

          <button
            type="button"
            onClick={() => setShowPostIds((v) => !v)}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {showPostIds ? "Hide post ids" : "Enter post ids instead"}
          </button>

          {showPostIds && (
            <textarea
              value={postIds.join("\n")}
              onChange={(e) => setPostIds(e.target.value)}
              placeholder="17912345678901234"
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          )}
        </div>
      )}

      {/* Payload Section */}
      {showPayload && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">
            Payload
          </label>
          <input
            type="text"
            value={data.payload || ""}
            onChange={(e) => onChange({ ...data, payload: e.target.value })}
            placeholder="Enter payload value..."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            The payload value to match when a {triggerType === "postback" ? "button is clicked" : "quick reply is tapped"}.
          </p>
        </div>
      )}
    </div>
  );
}
