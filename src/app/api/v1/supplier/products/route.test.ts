import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { GET, POST } from "@/app/api/v1/supplier/products/route";

describe("supplier product routes", () => {
  beforeEach(() => {
    resetEnvironmentForTests();
  });

  it("requires authentication to list supplier products", async () => {
    const response = await GET(new Request("http://localhost/api/v1/supplier/products"));
    expect(response.status).toBe(401);
  });

  it("requires authentication before accepting product input", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/supplier/products", {
        method: "POST",
        body: JSON.stringify({ retailEnabled: true }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
