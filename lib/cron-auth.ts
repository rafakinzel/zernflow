import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Whether a cron call carries CRON_SECRET.
 *
 * The header (`Authorization: Bearer <secret>`, what Vercel Cron sends) is the
 * way to call. `?key=` still works for whatever scheduler was set up with it,
 * but a secret in a URL lands in access and proxy logs, so move callers to
 * the header and then drop the query form. Compared in constant time; an unset
 * secret refuses everyone.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const header = request.headers.get("authorization");
  // Same forms as before: "Bearer <secret>", a bare header, or ?key=.
  const presented = header
    ? header.replace(/^Bearer /, "")
    : request.nextUrl.searchParams.get("key");
  if (!presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}
