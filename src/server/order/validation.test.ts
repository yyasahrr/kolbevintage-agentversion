import { describe, expect, it } from "vitest";
import { createOrderSchema, transitionOrderSchema } from "@/server/order/validation";

const ids = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  sellerId: "33333333-3333-4333-8333-333333333333",
  membershipId: "44444444-4444-4444-8444-444444444444",
  orderId: "55555555-5555-4555-8555-555555555555",
};

const item = {
  productId: ids.productId,
  variantId: ids.variantId,
  sellerType: "platform" as const,
  sellerId: null,
  sellerDisplayName: "Platform",
  title: "Vintage Jacket",
  sku: "JACKET-01",
  attributes: { size: "M" },
  quantity: 2,
  unitPriceMinor: 5000,
  discountMinor: 500,
  taxMinor: 450,
  lineTotalMinor: 9950,
};

describe("order validation", () => {
  it("accepts an explicit Retail snapshot with integer money", () => {
    const result = createOrderSchema.safeParse({
      market: "retail",
      currency: "USD",
      shippingMinor: 1000,
      subtotalMinor: 10000,
      discountMinor: 500,
      taxMinor: 450,
      totalMinor: 10950,
      idempotencyKey: "order-1",
      items: [item],
    });
    expect(result.success).toBe(true);
  });

  it("requires an active Wholesale membership identifier and consistent totals", () => {
    expect(createOrderSchema.safeParse({
      market: "wholesale",
      currency: "USD",
      shippingMinor: 0,
      subtotalMinor: 10000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 9999,
      idempotencyKey: "order-2",
      items: [item],
    }).success).toBe(false);
    expect(createOrderSchema.safeParse({
      market: "wholesale",
      wholesaleMembershipId: ids.membershipId,
      currency: "USD",
      shippingMinor: 0,
      subtotalMinor: 10000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 10000,
      idempotencyKey: "order-3",
      items: [{ ...item, discountMinor: 0, taxMinor: 0, lineTotalMinor: 10000 }],
    }).success).toBe(true);
  });

  it("validates transition commands", () => {
    expect(transitionOrderSchema.safeParse({
      orderId: ids.orderId,
      toStatus: "confirmed",
      idempotencyKey: "transition-1",
      reason: "Payment authorization confirmed",
      metadata: { provider: "adapter-placeholder" },
    }).success).toBe(true);
  });
});
