import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { POST } from "@/app/api/v1/auth/register/route";

describe("POST /api/v1/auth/register", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetEnvironmentForTests();
  });

  it("rejects a weak or incomplete credential payload before touching the database", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: "not-an-email", password: "short" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
