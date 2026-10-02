import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/catalog/products/[productId]/route";

describe("GET /api/v1/catalog/products/:productId", () => {
  it("requires authentication for a wholesale product detail", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/catalog/products/product-1?market=wholesale"),
      { params: Promise.resolve({ productId: "product-1" }) },
    );

    expect(response.status).toBe(401);
  });
});
