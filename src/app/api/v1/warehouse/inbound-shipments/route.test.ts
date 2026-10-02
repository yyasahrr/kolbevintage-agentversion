import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { POST } from "@/app/api/v1/warehouse/inbound-shipments/route";

describe("POST /api/v1/warehouse/inbound-shipments", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetEnvironmentForTests();
  });

  it("requires an authenticated warehouse operator", async () => {
    const response = await POST(new Request("http://localhost/api/v1/warehouse/inbound-shipments", {
      method: "POST",
      body: JSON.stringify({ referenceCode: "ASN-1", items: [] }),
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
