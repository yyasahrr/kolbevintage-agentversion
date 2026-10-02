import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET } from "@/app/api/v1/wholesale/eligibility/route";

describe("GET /api/v1/wholesale/eligibility", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("requires authentication", async () => {
    const response = await GET(new Request("http://localhost/api/v1/wholesale/eligibility"));
    expect(response.status).toBe(401);
  });
});
