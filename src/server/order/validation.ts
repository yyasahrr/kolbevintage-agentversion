import { z } from "zod";
import type { OrderStatus } from "@/server/order/order-state";
import { pricingSnapshotSchema } from "@/server/pricing/validation";

const uuid = z.string().uuid();
const moneyMinor = z.number().int().nonnegative().max(9_000_000_000_000);
const quantity = z.number().int().positive().max(1_000_000);
const currency = z.string().regex(/^[A-Z]{3}$/);
const attributes = z.record(z.string().trim().min(1).max(80), z.unknown()).default({});

export const orderMarketSchema = z.enum(["retail", "wholesale"]);
export const orderStatusSchema = z.enum([
  "draft",
  "pending_payment",
  "confirmed",
  "processing",
  "fulfilled",
  "cancelled",
]);

export const orderItemSnapshotSchema = z.object({
  productId: uuid,
  variantId: uuid,
  sellerType: z.enum(["platform", "supplier"]),
  sellerId: uuid.nullable(),
  sellerDisplayName: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  sku: z.string().trim().min(1).max(80),
  attributes,
  quantity,
  unitPriceMinor: moneyMinor,
  discountMinor: moneyMinor,
  taxMinor: moneyMinor,
  lineTotalMinor: moneyMinor,
}).superRefine((item, context) => {
  const expected = item.quantity * item.unitPriceMinor - item.discountMinor + item.taxMinor;
  if (!Number.isSafeInteger(expected) || expected < 0 || item.lineTotalMinor !== expected) {
    context.addIssue({
      code: "custom",
      path: ["lineTotalMinor"],
      message: "Line total must equal quantity times unit price minus discount plus tax.",
    });
  }
  if ((item.sellerType === "platform" && item.sellerId !== null)
    || (item.sellerType === "supplier" && item.sellerId === null)) {
    context.addIssue({
      code: "custom",
      path: ["sellerId"],
      message: "Seller identifier must match seller type.",
    });
  }
});

export const createOrderSchema = z.object({
  market: orderMarketSchema,
  wholesaleMembershipId: uuid.nullable().optional(),
  currency,
  shippingMinor: moneyMinor,
  subtotalMinor: moneyMinor,
  discountMinor: moneyMinor,
  taxMinor: moneyMinor,
  totalMinor: moneyMinor,
  pricingSnapshot: pricingSnapshotSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  items: z.array(orderItemSnapshotSchema).min(1).max(100),
}).superRefine((order, context) => {
  const expectedTotal = order.subtotalMinor - order.discountMinor + order.taxMinor + order.shippingMinor;
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal !== order.totalMinor) {
    context.addIssue({
      code: "custom",
      path: ["totalMinor"],
      message: "Total must equal subtotal minus discount plus tax plus shipping.",
    });
  }
  const pricing = order.pricingSnapshot;
  if (pricing.market !== order.market
    || pricing.currency !== order.currency
    || pricing.subtotalMinor !== order.subtotalMinor
    || pricing.discountMinor !== order.discountMinor
    || pricing.taxMinor !== order.taxMinor
    || pricing.shippingMinor !== order.shippingMinor
    || pricing.totalMinor !== order.totalMinor) {
    context.addIssue({
      code: "custom",
      path: ["pricingSnapshot"],
      message: "Pricing snapshot totals must match the order totals.",
    });
  }
  const priceByVariant = new Map(pricing.items.map((item) => [item.variantId, item]));
  if (pricing.items.length !== order.items.length) {
    context.addIssue({
      code: "custom",
      path: ["pricingSnapshot", "items"],
      message: "Pricing snapshot item count must match the order item count.",
    });
  }
  for (const item of order.items) {
    const pricedItem = priceByVariant.get(item.variantId);
    if (!pricedItem
      || pricedItem.quantity !== item.quantity
      || pricedItem.unitPriceMinor !== item.unitPriceMinor
      || pricedItem.lineTotalMinor !== item.lineTotalMinor) {
      context.addIssue({
        code: "custom",
        path: ["pricingSnapshot"],
        message: "Pricing snapshot items must match order item prices and quantities.",
      });
      break;
    }
  }
  if ((order.market === "retail" && order.wholesaleMembershipId !== null && order.wholesaleMembershipId !== undefined)
    || (order.market === "wholesale" && !order.wholesaleMembershipId)) {
    context.addIssue({
      code: "custom",
      path: ["wholesaleMembershipId"],
      message: "Wholesale orders require a membership and Retail orders cannot carry one.",
    });
  }
  const variants = new Set<string>();
  for (const item of order.items) {
    if (variants.has(item.variantId)) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each variant may appear only once per order.",
      });
    }
    variants.add(item.variantId);
  }
});

export const transitionOrderSchema = z.object({
  orderId: uuid,
  toStatus: orderStatusSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000),
  metadata: attributes,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema> & {
  buyerUserId: string;
  actorUserId: string;
  requestId: string;
};

export type TransitionOrderInput = z.infer<typeof transitionOrderSchema> & {
  actorUserId: string | null;
  requestId: string;
};

export type ValidatedOrderStatus = OrderStatus;
