import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET } from "@/app/api/v1/wholesale/suppliers/[supplierId]/route";

describe("GET /api/v1/wholesale/suppliers/:supplierId", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("requires authentication before exposing even public supplier data", async () => {
    const response = await GET(new Request("http://localhost/api/v1/wholesale/suppliers/supplier-a"), {
      params: Promise.resolve({ supplierId: "supplier-a" }),
    });
    expect(response.status).toBe(401);
  });
});
