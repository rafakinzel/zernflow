import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * The key the Central TB's cloud routines present.
 *
 * It is not tied to a person: it opens only the routes under
 * app/api/v1/central, and those can prepare a draft and nothing more.
 */
export const AGENT_KEY_ENV = "CENTRAL_AGENT_KEY";

/**
 * A second key, kept only on Rafa's Mac, so a Reel edited there can go to
 * the public link the same way the cloud routine's does. It opens the Reels
 * route (upload and delete) and nothing else: the cloud key above keeps
 * every other route to itself.
 */
export const REELS_MAC_KEY_ENV = "CENTRAL_REELS_MAC_KEY";

/** Shorter than this is a typo or a placeholder, not a generated key. */
const MIN_KEY_LENGTH = 32;

/**
 * True when the presented key matches the configured one.
 *
 * Both sides are hashed before comparing so the comparison always runs over
 * the same length: `timingSafeEqual` throws on unequal lengths, and checking
 * the length first would leak it. An unset or too-short configured key
 * refuses everyone, so forgetting the variable closes the door rather than
 * leaving it open.
 */
export function isAgentKeyValid(
  presented: string | null | undefined,
  configured: string | null | undefined
): boolean {
  if (!configured || configured.length < MIN_KEY_LENGTH) return false;
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}

/** Reads `Authorization: Bearer <key>`, or `x-central-agent-key`. */
export function presentedKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return headers.get("x-central-agent-key")?.trim() || null;
}

/**
 * Null when the caller may go on, otherwise the 401 to return.
 *
 * Nothing about the key is logged, neither what was sent nor what was
 * expected: a log line is read by more people than the key should be.
 */
export function refuseUnlessAgent(request: Request): NextResponse | null {
  if (isAgentKeyValid(presentedKey(request.headers), process.env[AGENT_KEY_ENV])) {
    return null;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Like `refuseUnlessAgent`, but also lets the Mac's own key in. Only the
 * Reels route uses this. Both comparisons always run, so the answer takes
 * the same time whichever key (if any) matched.
 */
export function refuseUnlessAgentOrReelsMac(request: Request): NextResponse | null {
  const presented = presentedKey(request.headers);
  const cloud = isAgentKeyValid(presented, process.env[AGENT_KEY_ENV]);
  const mac = isAgentKeyValid(presented, process.env[REELS_MAC_KEY_ENV]);
  if (cloud || mac) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
