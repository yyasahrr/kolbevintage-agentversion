import { describe, expect, it } from "vitest";
import { toPublicProduct } from "@/server/catalog/public-product";

describe("public product projection", () => {
  it("does not expose supplier private fields", () => {
    const product = toPublicProduct(
      {
        id: "product-1",
        slug: "studio-jacket",
        title: "Studio Jacket",
        description: null,
        brand_name: "Public Brand",
        category_id: null,
        attributes: { material: "cotton" },
        status: "active",
        owner_type: "supplier",
        supplier_id: "supplier-1",
        supplier_display_name: "Studio A",
        supplier_brand_name: "Brand A",
      },
      [],
    );

    expect(product.supplier).toEqual({
      id: "supplier-1",
      displayName: "Studio A",
      brandName: "Brand A",
    });
    expect(product).not.toHaveProperty("contactEmail");
    expect(product.supplier).not.toHaveProperty("legalName");
    expect(product.supplier).not.toHaveProperty("phone");
  });
});
