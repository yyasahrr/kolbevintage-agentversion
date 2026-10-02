import { describe, expect, it } from "vitest";
import { createCatalogProduct } from "@/server/catalog/product-repository";
import { ProductOwnershipError } from "@/server/catalog/product-state";

describe("catalog seller policy", () => {
  it("rejects a supplier attempt to create a Retail-enabled product before database access", async () => {
    await expect(
      createCatalogProduct({
        ownerType: "supplier",
        supplierId: "supplier-1",
        actorUserId: "user-1",
        requestId: "catalog-test",
        title: "Supplier product",
        slug: "supplier-product",
        description: null,
        brandName: null,
        categoryId: null,
        attributes: {},
        retailEnabled: true,
        wholesaleEnabled: true,
        variants: [
          {
            sku: "SUPPLIER-1",
            barcode: null,
            sizeLabel: "M",
            colorLabel: "Black",
            attributes: {},
            weightGrams: null,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ProductOwnershipError);
  });
});
