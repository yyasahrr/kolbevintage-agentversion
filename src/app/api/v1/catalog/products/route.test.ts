import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/catalog/products/route";

describe("GET /api/v1/catalog/products", () => {
  it("rejects invalid market values before querying the database", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/catalog/products?market=private"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("requires authentication for the wholesale market", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/catalog/products?market=wholesale"),
    );

    expect(response.status).toBe(401);
  });
});
