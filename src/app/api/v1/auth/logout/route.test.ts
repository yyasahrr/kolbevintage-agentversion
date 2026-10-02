import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { POST } from "@/app/api/v1/auth/logout/route";

describe("POST /api/v1/auth/logout", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("is idempotent for a request without a session", async () => {
    const response = await POST(new Request("http://localhost/api/v1/auth/logout", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
