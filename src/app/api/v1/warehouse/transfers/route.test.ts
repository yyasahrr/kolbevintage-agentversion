import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { POST } from "@/app/api/v1/warehouse/transfers/route";

describe("POST /api/v1/warehouse/transfers", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetEnvironmentForTests();
  });

  it("requires an authenticated warehouse operator", async () => {
    const response = await POST(new Request("http://localhost/api/v1/warehouse/transfers", {
      method: "POST",
      body: JSON.stringify({}),
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
