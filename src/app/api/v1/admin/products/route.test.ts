import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/admin/products/route";

describe("POST /api/v1/admin/products", () => {
  it("requires authentication before platform catalog management", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/admin/products", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });
});
