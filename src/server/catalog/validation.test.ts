import { describe, expect, it } from "vitest";
import { productInputSchema } from "@/server/catalog/validation";

describe("catalog input validation", () => {
  it("accepts an extensible fashion product with variants", () => {
    const result = productInputSchema.safeParse({
      title: "Studio Jacket",
      slug: "studio-jacket",
      description: "A jacket.",
      brandName: "Brand A",
      categoryId: null,
      attributes: { material: "cotton", fit: "regular" },
      retailEnabled: false,
      wholesaleEnabled: true,
      variants: [
        {
          sku: "JACKET-BLACK-M",
          barcode: null,
          sizeLabel: "M",
          colorLabel: "Black",
          attributes: { season: "fall" },
          weightGrams: 800,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects products without variants or unsafe slugs", () => {
    expect(
      productInputSchema.safeParse({
        title: "No variants",
        slug: "No Spaces",
        retailEnabled: false,
        wholesaleEnabled: true,
        variants: [],
      }).success,
    ).toBe(false);
  });
});
