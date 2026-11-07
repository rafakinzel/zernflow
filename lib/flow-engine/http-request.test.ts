import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/messaging", () => ({ createMessagingProvider: () => ({}) }));
import { refuseHttpTarget } from "./engine";

describe("refuseHttpTarget", () => {
  it("lets public http(s) hosts through", () => {
    expect(refuseHttpTarget("https://api.example.com/hook?x=1")).toBeNull();
    expect(refuseHttpTarget("http://example.org")).toBeNull();
  });

  it("refuses our own network and the metadata service", () => {
    for (const url of [
      "http://localhost:3000/api",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://[::1]/",
      "http://db.internal/",
    ]) {
      expect(refuseHttpTarget(url), url).not.toBeNull();
    }
  });

  it("refuses other protocols and broken URLs", () => {
    expect(refuseHttpTarget("file:///etc/passwd")).not.toBeNull();
    expect(refuseHttpTarget("not a url")).not.toBeNull();
  });

  it("narrows to listed hosts when HTTP_REQUEST_ALLOWED_HOSTS is set", () => {
    process.env.HTTP_REQUEST_ALLOWED_HOSTS = "example.com";
    try {
      expect(refuseHttpTarget("https://api.example.com/x")).toBeNull();
      expect(refuseHttpTarget("https://evil.com/x")).not.toBeNull();
    } finally {
      delete process.env.HTTP_REQUEST_ALLOWED_HOSTS;
    }
  });
});
