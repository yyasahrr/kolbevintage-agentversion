import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import { InvalidOrderTransitionError } from "@/server/order/order-state";
import { createOrder, transitionOrder } from "@/server/order/order-repository";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
let userId: string | undefined;
let productId: string | undefined;
let variantId: string | undefined;
let orderId: string | undefined;

describeDatabase("order foundation", () => {
  afterEach(async () => {
    if (orderId) {
      await query("DELETE FROM order_items WHERE order_id = $1", [orderId]);
      await query("DELETE FROM order_events WHERE order_id = $1", [orderId]);
      await query("DELETE FROM orders WHERE id = $1", [orderId]);
      orderId = undefined;
    }
    if (productId) {
      await query("DELETE FROM products WHERE id = $1", [productId]);
      productId = undefined;
      variantId = undefined;
    }
    if (userId) {
      await query("DELETE FROM users WHERE id = $1", [userId]);
      userId = undefined;
    }
  });

  it("creates one shared Retail snapshot and transitions it idempotently", async () => {
    userId = randomUUID();
    productId = randomUUID();
    variantId = randomUUID();
    const email = `${userId}@example.com`;
    await query(
      `INSERT INTO users (id, email, email_normalized, status)
       VALUES ($1, $2, $2, 'active')`,
      [userId, email],
    );
    await query(
      `INSERT INTO products
         (id, owner_type, status, slug, title, retail_enabled, wholesale_enabled)
       VALUES ($1, 'platform', 'active', $2, 'Order Test Product', true, false)`,
      [productId, `order-test-${productId}`],
    );
    await query(
      `INSERT INTO product_variants (id, product_id, sku, attributes)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [variantId, productId, `ORDER-${variantId}`],
    );

    const created = await createOrder({
      buyerUserId: userId,
      actorUserId: userId,
      requestId: "order-integration-create",
      market: "retail",
      currency: "USD",
      shippingMinor: 0,
      subtotalMinor: 2000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 2000,
      pricingSnapshot: {
        quoteId: "66666666-6666-4666-8666-666666666666",
        version: 1,
        coverage: "base_merchandise_only",
        evaluatedAt: "2026-10-02T00:00:00.000Z",
        market: "retail",
        currency: "USD",
        items: [{
          variantId,
          priceId: "77777777-7777-4777-8777-777777777777",
          quantity: 1,
          unitPriceMinor: 2000,
          lineTotalMinor: 2000,
        }],
        subtotalMinor: 2000,
        discountMinor: 0,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 2000,
      },
      idempotencyKey: `order-${randomUUID()}`,
      items: [{
        productId,
        variantId,
        sellerType: "platform",
        sellerId: null,
        sellerDisplayName: "Platform",
        title: "Order Test Product",
        sku: `ORDER-${variantId}`,
        attributes: {},
        quantity: 1,
        unitPriceMinor: 2000,
        discountMinor: 0,
        taxMinor: 0,
        lineTotalMinor: 2000,
      }],
    });
    orderId = created.order.id;
    expect(created.order.status).toBe("draft");
    expect(created.order.items[0]?.snapshot.title).toBe("Order Test Product");

    const replay = await createOrder({
      buyerUserId: userId,
      actorUserId: userId,
      requestId: "order-integration-replay",
      market: "retail",
      currency: "USD",
      shippingMinor: 0,
      subtotalMinor: 2000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 2000,
      pricingSnapshot: {
        quoteId: "66666666-6666-4666-8666-666666666666",
        version: 1,
        coverage: "base_merchandise_only",
        evaluatedAt: "2026-10-02T00:00:00.000Z",
        market: "retail",
        currency: "USD",
        items: [{
          variantId,
          priceId: "77777777-7777-4777-8777-777777777777",
          quantity: 1,
          unitPriceMinor: 2000,
          lineTotalMinor: 2000,
        }],
        subtotalMinor: 2000,
        discountMinor: 0,
        taxMinor: 0,
        shippingMinor: 0,
        totalMinor: 2000,
      },
      idempotencyKey: created.initialEvent.idempotencyKey,
      items: [{
        productId,
        variantId,
        sellerType: "platform",
        sellerId: null,
        sellerDisplayName: "Platform",
        title: "Order Test Product",
        sku: `ORDER-${variantId}`,
        attributes: {},
        quantity: 1,
        unitPriceMinor: 2000,
        discountMinor: 0,
        taxMinor: 0,
        lineTotalMinor: 2000,
      }],
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.order.id).toBe(created.order.id);

    const pending = await transitionOrder({
      orderId: created.order.id,
      toStatus: "pending_payment",
      idempotencyKey: `transition-${randomUUID()}`,
      reason: "Ready for an external payment adapter",
      metadata: {},
      actorUserId: userId,
      requestId: "order-integration-transition",
    });
    expect(pending.order.status).toBe("pending_payment");
    await expect(transitionOrder({
      orderId: created.order.id,
      toStatus: "fulfilled",
      idempotencyKey: `invalid-${randomUUID()}`,
      reason: "Invalid direct fulfillment",
      metadata: {},
      actorUserId: userId,
      requestId: "order-integration-invalid-transition",
    })).rejects.toBeInstanceOf(InvalidOrderTransitionError);
  });
});
