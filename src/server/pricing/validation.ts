import { z } from "zod";

const uuid = z.string().uuid();
const moneyMinor = z.number().int().nonnegative().max(9_000_000_000_000);
const currency = z.string().regex(/^[A-Z]{3}$/);
const quantity = z.number().int().positive().max(1_000_000);

export const pricingMarketSchema = z.enum(["retail", "wholesale"]);

export const publishVariantPriceSchema = z.object({
  productId: uuid,
  variantId: uuid,
  market: pricingMarketSchema,
  currency,
  unitPriceMinor: moneyMinor,
  reason: z.string().trim().min(1).max(1000),
});

export const quoteOrderPricingSchema = z.object({
  buyerUserId: uuid,
  market: pricingMarketSchema,
  wholesaleMembershipId: uuid.nullable().optional(),
  currency,
  items: z.array(z.object({
    productId: uuid,
    variantId: uuid,
    quantity,
  })).min(1).max(100),
});

export const pricingSnapshotSchema = z.object({
  quoteId: uuid,
  version: z.literal(1),
  coverage: z.literal("base_merchandise_only"),
  evaluatedAt: z.string().datetime({ offset: true }),
  market: pricingMarketSchema,
  currency,
  items: z.array(z.object({
    variantId: uuid,
    priceId: uuid,
    quantity,
    unitPriceMinor: moneyMinor,
    lineTotalMinor: moneyMinor,
  })).min(1).max(100),
  subtotalMinor: moneyMinor,
  discountMinor: moneyMinor,
  taxMinor: moneyMinor,
  shippingMinor: moneyMinor,
  totalMinor: moneyMinor,
}).superRefine((snapshot, context) => {
  if (snapshot.coverage === "base_merchandise_only"
    && (snapshot.discountMinor !== 0 || snapshot.taxMinor !== 0 || snapshot.shippingMinor !== 0)) {
    context.addIssue({
      code: "custom",
      path: ["coverage"],
      message: "Base-merchandise pricing cannot claim discounts, tax, or shipping calculations.",
    });
  }
});

export type PublishVariantPriceInput = z.infer<typeof publishVariantPriceSchema> & {
  actorUserId: string;
  requestId: string;
};

export type QuoteOrderPricingInput = z.infer<typeof quoteOrderPricingSchema>;
export type PricingSnapshot = z.infer<typeof pricingSnapshotSchema>;
