import { describe, expect, it } from "vitest";
import { applySecurityHeaders, getSecurityHeaders } from "@/lib/security-headers";

describe("security headers", () => {
  it("returns browser hardening headers without enabling HSTS outside production", () => {
    const headers = getSecurityHeaders("development");

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  it("adds HSTS only for production responses", () => {
    const headers = new Headers();
    applySecurityHeaders(headers, "production");

    expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
