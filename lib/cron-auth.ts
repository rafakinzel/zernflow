import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Whether a cron call carries CRON_SECRET, in the header only:
 * `Authorization: Bearer <secret>` (what cron-job.org is set to send, and what
 * Vercel Cron sends). A secret in the URL (`?key=`) is refused: it lands in
 * access and proxy logs. cron-job.org was moved to the header on 08/11/2026.
 * Compared in constant time; an unset secret refuses everyone.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const presented = header.replace(/^Bearer /, "");
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}
