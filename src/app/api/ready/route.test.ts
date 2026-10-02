import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET } from "@/app/api/ready/route";

describe("GET /api/ready", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SSL;
    resetEnvironmentForTests();
  });

  it("does not report readiness while persistence is unconfigured", async () => {
    const response = await GET(new Request("http://localhost/api/ready"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.checks.database.status).toBe("not_configured");
    expect(body.checks.database.detail).toBe("DATABASE_URL is not configured.");
  });
});
