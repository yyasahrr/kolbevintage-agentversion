import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import { adjustInventory } from "@/server/inventory/inventory-repository";
import { InvalidOrderTransitionError } from "@/server/order/order-state";
import {
  createOrder,
  releaseOrderInventory,
  reserveOrderInventory,
  transitionOrder,
} from "@/server/order/order-repository";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
let userId: string | undefined;
let productId: string | undefined;
let variantId: string | undefined;
let orderId: string | undefined;
let warehouseId: string | undefined;
let locationId: string | undefined;
let reservationBatchId: string | undefined;

describeDatabase("order foundation", () => {
  afterEach(async () => {
    if (orderId) {
      await query("DELETE FROM order_items WHERE order_id = $1", [orderId]);
      await query("DELETE FROM order_events WHERE order_id = $1", [orderId]);
      await query("DELETE FROM orders WHERE id = $1", [orderId]);
      orderId = undefined;
    }
    if (productId) {
      await query("DELETE FROM inventory_movements WHERE product_id = $1", [productId]);
      await query("DELETE FROM inventory_reservations WHERE product_id = $1", [productId]);
      await query("DELETE FROM inventory_balances WHERE product_id = $1", [productId]);
      if (reservationBatchId) {
        await query("DELETE FROM inventory_reservation_batches WHERE id = $1", [reservationBatchId]);
        reservationBatchId = undefined;
      }
      await query("DELETE FROM products WHERE id = $1", [productId]);
      productId = undefined;
      variantId = undefined;
    }
    if (locationId) {
      await query("DELETE FROM warehouse_locations WHERE id = $1", [locationId]);
      locationId = undefined;
    }
    if (warehouseId) {
      await query("DELETE FROM warehouses WHERE id = $1", [warehouseId]);
      warehouseId = undefined;
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
    warehouseId = randomUUID();
    locationId = randomUUID();
    await query(
      `INSERT INTO warehouses (id, code, name) VALUES ($1, $2, 'Order Integration Warehouse')`,
      [warehouseId, `WH-${warehouseId.slice(0, 8).toUpperCase()}`],
    );
    await query(
      `INSERT INTO warehouse_locations (id, warehouse_id, code) VALUES ($1, $2, 'ORDER-A-01')`,
      [locationId, warehouseId],
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
    expect(created.order.reservationStatus).toBe("not_started");
    expect(created.order.items[0]?.snapshot.title).toBe("Order Test Product");

    await adjustInventory({
      variantId,
      locationId,
      sourceSupplierId: null,
      quantityDelta: 1,
      idempotencyKey: `order-stock-${randomUUID()}`,
      reason: "Order reservation integration stock",
      actorUserId: userId,
      requestId: "order-integration-stock",
    });
    const allocationKey = `order-reservation-${randomUUID()}`;
    const allocation = await reserveOrderInventory({
      orderId: created.order.id,
      idempotencyKey: allocationKey,
      reason: "Allocate explicit order inventory",
      lines: [{
        orderItemId: created.order.items[0]?.id ?? "",
        variantId,
        locationId,
        sourceSupplierId: null,
        quantity: 1,
      }],
      actorUserId: userId,
      requestId: "order-integration-reservation",
    });
    reservationBatchId = allocation.batch.batchId;
    expect(allocation.order.reservationStatus).toBe("reserved");
    expect(allocation.order.reservationBatchId).toBe(reservationBatchId);

    const replayAllocation = await reserveOrderInventory({
      orderId: created.order.id,
      idempotencyKey: allocationKey,
      reason: "Allocate explicit order inventory",
      lines: [{
        orderItemId: created.order.items[0]?.id ?? "",
        variantId,
        locationId,
        sourceSupplierId: null,
        quantity: 1,
      }],
      actorUserId: userId,
      requestId: "order-integration-reservation-replay",
    });
    expect(replayAllocation.idempotentReplay).toBe(true);

    const releaseKey = `order-release-${randomUUID()}`;
    const released = await releaseOrderInventory({
      orderId: created.order.id,
      idempotencyKey: releaseKey,
      reason: "Release order inventory",
      actorUserId: userId,
      requestId: "order-integration-release",
    });
    expect(released.order.reservationStatus).toBe("released");
    const releasedReplay = await releaseOrderInventory({
      orderId: created.order.id,
      idempotencyKey: releaseKey,
      reason: "Release order inventory",
      actorUserId: userId,
      requestId: "order-integration-release-replay",
    });
    expect(releasedReplay.idempotentReplay).toBe(true);

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
