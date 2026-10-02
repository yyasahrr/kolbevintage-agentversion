import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { POST } from "@/app/api/v1/auth/login/route";

describe("POST /api/v1/auth/login", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetEnvironmentForTests();
  });

  it("rejects malformed credentials before opening a database connection", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "buyer@example.com", password: "short" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
