import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET } from "@/app/api/v1/auth/me/route";

describe("GET /api/v1/auth/me", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetEnvironmentForTests();
  });

  it("denies unauthenticated access without opening a database connection", async () => {
    const response = await GET(new Request("http://localhost/api/v1/auth/me"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
