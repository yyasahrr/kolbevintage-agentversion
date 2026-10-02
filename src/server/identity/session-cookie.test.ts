import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  getSessionToken,
} from "@/server/identity/session-cookie";

describe("session cookies", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("uses an HttpOnly same-site cookie and never serializes a session in JSON", () => {
    const cookie = buildSessionCookie("safe_token-123");

    expect(cookie).toContain("kolbe_session=safe_token-123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("parses only the expected cookie token", () => {
    const request = new Request("http://localhost", {
      headers: { cookie: "other=value; kolbe_session=safe_token-123" },
    });

    expect(getSessionToken(request)).toBe("safe_token-123");
    expect(getSessionToken(new Request("http://localhost", { headers: { cookie: "kolbe_session=x.y" } }))).toBeNull();
  });

  it("clears the session cookie with Max-Age zero", () => {
    expect(buildClearedSessionCookie()).toContain("Max-Age=0");
  });
});
