import { describe, expect, it } from "vitest";
import {
  getClientAddress,
  rateLimitKey,
  retryAfterSeconds,
} from "@/server/identity/rate-limit";

describe("authentication rate-limit helpers", () => {
  it("hashes scopes and values without exposing the raw identifier", () => {
    const key = rateLimitKey("auth:login:email", "Buyer@Example.com");

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("buyer@example.com");
    expect(key).toBe(rateLimitKey("auth:login:email", "buyer@example.com"));
  });

  it("prefers the direct proxy address and safely falls back to forwarded address", () => {
    expect(getClientAddress(new Request("http://localhost", {
      headers: {
        "x-real-ip": "203.0.113.8",
        "x-forwarded-for": "198.51.100.4, 203.0.113.8",
      },
    }))).toBe("203.0.113.8");
    expect(getClientAddress(new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.4, 203.0.113.8" },
    }))).toBe("198.51.100.4");
  });

  it("returns a positive retry duration", () => {
    const now = new Date("2026-10-02T00:00:00.000Z");
    expect(retryAfterSeconds(new Date("2026-10-02T00:00:02.100Z"), now)).toBe(3);
    expect(retryAfterSeconds(new Date("2026-10-01T23:59:59.000Z"), now)).toBe(1);
  });
});
