import { describe, expect, it } from "vitest";
import { pricingSnapshotSchema, publishVariantPriceSchema, quoteOrderPricingSchema } from "@/server/pricing/validation";

describe("pricing validation", () => {
  it("accepts bounded integer-minor-unit prices and quote inputs", () => {
    const ids = {
      productId: "11111111-1111-4111-8111-111111111111",
      variantId: "22222222-2222-4222-8222-222222222222",
      buyerUserId: "33333333-3333-4333-8333-333333333333",
    };
    expect(publishVariantPriceSchema.safeParse({
      ...ids,
      market: "retail",
      currency: "USD",
      unitPriceMinor: 12500,
      reason: "Initial catalog price",
    }).success).toBe(true);
    expect(quoteOrderPricingSchema.safeParse({
      ...ids,
      market: "retail",
      currency: "USD",
      items: [{ productId: ids.productId, variantId: ids.variantId, quantity: 2 }],
    }).success).toBe(true);
  });

  it("requires explicit base-merchandise pricing provenance", () => {
    expect(pricingSnapshotSchema.safeParse({
      quoteId: "44444444-4444-4444-8444-444444444444",
      version: 1,
      coverage: "base_merchandise_only",
      evaluatedAt: "2026-10-02T00:00:00.000Z",
      market: "retail",
      currency: "USD",
      items: [{
        variantId: "22222222-2222-4222-8222-222222222222",
        priceId: "55555555-5555-4555-8555-555555555555",
        quantity: 1,
        unitPriceMinor: 5000,
        lineTotalMinor: 5000,
      }],
      subtotalMinor: 5000,
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
      totalMinor: 5000,
    }).success).toBe(true);
  });
});
