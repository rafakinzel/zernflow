import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isCronAuthorized } from "./cron-auth";

const req = (url: string, auth?: string) =>
  new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined);

describe("isCronAuthorized", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("takes the secret from the Authorization header", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req("https://x/api/cron/jobs", "Bearer s3cret"))).toBe(true);
    expect(isCronAuthorized(req("https://x/api/cron/jobs", "Bearer wrong"))).toBe(false);
  });

  it("refuses the secret in the URL", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req("https://x/api/cron/jobs?key=s3cret"))).toBe(false);
  });

  it("refuses everyone when no secret is configured", () => {
    expect(isCronAuthorized(req("https://x/api/cron/jobs", "Bearer "))).toBe(false);
  });
});
