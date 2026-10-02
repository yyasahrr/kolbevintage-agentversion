import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/server/db/transaction";
import {
  InvalidOrderStateError,
  OrderIdempotencyConflictError,
  OrderIntegrityError,
  OrderNotFoundError,
  OrderSnapshotMismatchError,
  WholesaleOrderNotEligibleError,
} from "@/server/order/errors";
import { assertOrderTransition } from "@/server/order/order-state";
import type { OrderStatus } from "@/server/order/order-state";
import type {
  CreateOrderInput,
  ReleaseOrderInventoryInput,
  ReserveOrderInventoryInput,
  TransitionOrderInput,
  orderItemSnapshotSchema,
} from "@/server/order/validation";
import {
  quoteOrderPricingWithClient,
} from "@/server/pricing/pricing-repository";
import type {
  InventoryReservationBatchResult,
} from "@/server/inventory/inventory-repository";
import {
  releaseInventoryBatchWithClient,
  reserveInventoryBatchWithClient,
} from "@/server/inventory/inventory-repository";
import type {
  PricingSnapshot,
  QuoteOrderPricingInput,
} from "@/server/pricing/validation";
import type { z } from "zod";

export type OrderMarket = "retail" | "wholesale";
export type OrderItemSnapshot = z.infer<typeof orderItemSnapshotSchema>;

export type OrderItemRecord = {
  id: string;
  lineNumber: number;
  productId: string;
  variantId: string;
  quantity: number;
  lineTotalMinor: number;
  snapshot: OrderItemSnapshot;
};

export type OrderRecord = {
  id: string;
  orderNumber: string;
  buyerUserId: string;
  market: OrderMarket;
  wholesaleMembershipId: string | null;
  status: OrderStatus;
  reservationStatus: "not_started" | "reserved" | "released";
  reservationBatchId: string | null;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  pricingSnapshot: PricingSnapshot;
  snapshotVersion: number;
  items: OrderItemRecord[];
  createdAt: string;
  updatedAt: string;
};

export type OrderEventRecord = {
  id: string;
  orderId: string;
  actorUserId: string | null;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateOrderResult = {
  order: OrderRecord;
  initialEvent: OrderEventRecord;
  idempotentReplay: boolean;
};

export type TransitionOrderResult = {
  order: OrderRecord;
  event: OrderEventRecord;
  idempotentReplay: boolean;
};

type MoneyValue = number | string;

type OrderRow = {
  id: string;
  order_number: string;
  buyer_user_id: string;
  market_type: OrderMarket;
  wholesale_membership_id: string | null;
  status: OrderStatus;
  reservation_status: "not_started" | "reserved" | "released";
  reservation_batch_id: string | null;
  currency: string;
  subtotal_minor: MoneyValue;
  discount_minor: MoneyValue;
  tax_minor: MoneyValue;
  shipping_minor: MoneyValue;
  total_minor: MoneyValue;
  pricing_snapshot: PricingSnapshot;
  snapshot_version: number;
  created_at: Date;
  updated_at: Date;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  line_number: number;
  product_id: string;
  variant_id: string;
  quantity: number;
  line_total_minor: MoneyValue;
  snapshot: OrderItemSnapshot;
};

type OrderEventRow = {
  id: string;
  order_id: string;
  actor_user_id: string | null;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  reason: string;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type CatalogSnapshotRow = {
  product_id: string;
  variant_id: string;
  product_owner_type: "platform" | "supplier";
  product_supplier_id: string | null;
  product_status: "draft" | "active" | "archived" | "suspended";
  retail_enabled: boolean;
  wholesale_enabled: boolean;
  product_title: string;
  variant_sku: string;
  variant_attributes: Record<string, unknown>;
  variant_status: "active" | "archived";
  supplier_display_name: string | null;
  supplier_status: string | null;
};

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  return withTransaction((client) => createOrderWithClient(client, input));
}

export type CreatePricedOrderInput = QuoteOrderPricingInput & {
  idempotencyKey: string;
  actorUserId: string;
  requestId: string;
};

export async function createPricedOrder(input: CreatePricedOrderInput): Promise<CreateOrderResult> {
  return withTransaction(async (client) => {
    const existing = await findOrderByIdempotencyKey(client, input.idempotencyKey, true);
    if (existing) {
      const order = await loadOrder(client, existing.id);
      assertPricedReplayMatches(order, input);
      const initialEvent = await findOrderEventByKey(client, existing.id, input.idempotencyKey);
      if (!initialEvent) throw new OrderIntegrityError();
      return { order, initialEvent: toOrderEvent(initialEvent), idempotentReplay: true };
    }
    const quote = await quoteOrderPricingWithClient(client, {
      buyerUserId: input.buyerUserId,
      market: input.market,
      wholesaleMembershipId: input.wholesaleMembershipId ?? null,
      currency: input.currency,
      items: input.items,
    });
    return createOrderWithClient(client, {
      buyerUserId: input.buyerUserId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      market: input.market,
      wholesaleMembershipId: input.wholesaleMembershipId ?? null,
      currency: input.currency,
      shippingMinor: quote.snapshot.shippingMinor,
      subtotalMinor: quote.snapshot.subtotalMinor,
      discountMinor: quote.snapshot.discountMinor,
      taxMinor: quote.snapshot.taxMinor,
      totalMinor: quote.snapshot.totalMinor,
      pricingSnapshot: quote.snapshot,
      idempotencyKey: input.idempotencyKey,
      items: quote.items,
    });
  });
}

async function createOrderWithClient(
  client: PoolClient,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const commandFingerprint = fingerprintCreateCommand(input);
    const existing = await findOrderByIdempotencyKey(client, input.idempotencyKey, true);
    if (existing) {
      if (existing.buyer_user_id !== input.buyerUserId
        || existing.command_fingerprint !== commandFingerprint) {
        throw new OrderIdempotencyConflictError();
      }
      const order = await loadOrder(client, existing.id);
      const initialEvent = await findOrderEventByKey(client, existing.id, input.idempotencyKey);
      if (!initialEvent) throw new OrderIntegrityError();
      return { order, initialEvent: toOrderEvent(initialEvent), idempotentReplay: true };
    }

    assertOrderTotals(input);
    const wholesaleMembershipId = input.wholesaleMembershipId ?? null;
    if (input.market === "wholesale") {
      await assertActiveWholesaleMembership(client, input.buyerUserId, wholesaleMembershipId);
    }
    if (input.market === "retail" && wholesaleMembershipId !== null) {
      throw new WholesaleOrderNotEligibleError();
    }

    for (const item of input.items) {
      await assertCatalogSnapshot(client, input.market, item);
    }

    const orderId = randomUUID();
    const orderNumber = `KV-${orderId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    await client.query(
      `INSERT INTO orders
         (id, order_number, buyer_user_id, market_type, wholesale_membership_id,
          status, currency, subtotal_minor, discount_minor, tax_minor, shipping_minor,
          total_minor, pricing_snapshot, snapshot_version, idempotency_key, command_fingerprint)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11, $12::jsonb, 1, $13, $14)`,
      [
        orderId,
        orderNumber,
        input.buyerUserId,
        input.market,
        wholesaleMembershipId,
        input.currency,
        input.subtotalMinor,
        input.discountMinor,
        input.taxMinor,
        input.shippingMinor,
        input.totalMinor,
        JSON.stringify(input.pricingSnapshot),
        input.idempotencyKey,
        commandFingerprint,
      ],
    );

    for (const [index, item] of input.items.entries()) {
      await client.query(
        `INSERT INTO order_items
           (id, order_id, line_number, product_id, variant_id, quantity, line_total_minor, snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          randomUUID(),
          orderId,
          index + 1,
          item.productId,
          item.variantId,
          item.quantity,
          item.lineTotalMinor,
          JSON.stringify(item),
        ],
      );
    }

    const initialEvent = await insertOrderEvent(client, {
      orderId,
      actorUserId: input.actorUserId,
      fromStatus: null,
      toStatus: "draft",
      reason: "Order snapshot created",
      idempotencyKey: input.idempotencyKey,
      metadata: { requestId: input.requestId, snapshotVersion: 1 },
    });
    const order = await loadOrder(client, orderId);
    await appendOrderAudit(client, {
      actorUserId: input.actorUserId,
      action: "order.created",
      orderId,
      requestId: input.requestId,
      afterState: { status: order.status, market: order.market, totalMinor: order.totalMinor },
    });

    return { order, initialEvent: toOrderEvent(initialEvent), idempotentReplay: false };
}

export type ReserveOrderInventoryResult = {
  order: OrderRecord;
  batch: InventoryReservationBatchResult;
  idempotentReplay: boolean;
};

export async function reserveOrderInventory(
  input: ReserveOrderInventoryInput,
): Promise<ReserveOrderInventoryResult> {
  return withTransaction(async (client) => {
    const storedOrder = await findOrderById(client, input.orderId, true);
    if (!storedOrder) throw new OrderNotFoundError();
    if (storedOrder.reservation_status === "released") throw new InvalidOrderStateError();
    if (storedOrder.reservation_status === "reserved") {
      if (!storedOrder.reservation_batch_id) throw new OrderIntegrityError();
      const batchKey = await client.query<{ idempotency_key: string }>(
        `SELECT idempotency_key
           FROM inventory_reservation_batches
          WHERE id = $1`,
        [storedOrder.reservation_batch_id],
      );
      if (batchKey.rows[0]?.idempotency_key !== input.idempotencyKey) {
        throw new OrderIdempotencyConflictError();
      }
    }

    const itemResult = await client.query<OrderItemRow>(
      `SELECT id, order_id, line_number, product_id, variant_id, quantity, line_total_minor, snapshot
         FROM order_items
        WHERE order_id = $1
        ORDER BY line_number ASC`,
      [storedOrder.id],
    );
    assertReservationPlanMatchesItems(input, itemResult.rows);

    const batch = await reserveInventoryBatchWithClient(client, {
      idempotencyKey: input.idempotencyKey,
      referenceType: "order",
      referenceId: storedOrder.id,
      reason: input.reason,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      lines: input.lines.map((line) => ({
        variantId: line.variantId,
        locationId: line.locationId,
        sourceSupplierId: line.sourceSupplierId,
        lineReference: line.orderItemId,
        quantity: line.quantity,
      })),
    });

    if (storedOrder.reservation_status === "reserved"
      && storedOrder.reservation_batch_id !== batch.batchId) {
      throw new OrderIntegrityError();
    }
    if (storedOrder.reservation_status === "not_started") {
      await client.query(
        `UPDATE orders
            SET reservation_status = 'reserved', reservation_batch_id = $2, updated_at = now()
          WHERE id = $1 AND reservation_status = 'not_started'`,
        [storedOrder.id, batch.batchId],
      );
      await appendOrderAudit(client, {
        actorUserId: input.actorUserId,
        action: "order.inventory_reserved",
        orderId: storedOrder.id,
        requestId: input.requestId,
        reason: input.reason,
        afterState: { reservationStatus: "reserved", reservationBatchId: batch.batchId },
      });
    }

    return {
      order: await loadOrder(client, storedOrder.id),
      batch,
      idempotentReplay: batch.idempotentReplay,
    };
  });
}

export async function releaseOrderInventory(
  input: ReleaseOrderInventoryInput,
): Promise<ReserveOrderInventoryResult> {
  return withTransaction(async (client) => {
    const storedOrder = await findOrderById(client, input.orderId, true);
    if (!storedOrder) throw new OrderNotFoundError();
    if (!storedOrder.reservation_batch_id) throw new InvalidOrderStateError();
    if (storedOrder.reservation_status === "not_started") throw new InvalidOrderStateError();

    const batch = await releaseInventoryBatchWithClient(client, {
      batchId: storedOrder.reservation_batch_id,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? "Order inventory released",
      actorUserId: input.actorUserId,
      requestId: input.requestId,
    });
    if (storedOrder.reservation_status === "reserved") {
      await client.query(
        `UPDATE orders
            SET reservation_status = 'released', updated_at = now()
          WHERE id = $1 AND reservation_status = 'reserved'`,
        [storedOrder.id],
      );
      await appendOrderAudit(client, {
        actorUserId: input.actorUserId,
        action: "order.inventory_released",
        orderId: storedOrder.id,
        requestId: input.requestId,
        reason: input.reason ?? "Order inventory released",
        afterState: { reservationStatus: "released", reservationBatchId: storedOrder.reservation_batch_id },
      });
    }
    return {
      order: await loadOrder(client, storedOrder.id),
      batch,
      idempotentReplay: batch.idempotentReplay,
    };
  });
}

function assertReservationPlanMatchesItems(
  input: ReserveOrderInventoryInput,
  items: OrderItemRow[],
): void {
  if (items.length !== input.lines.length) throw new OrderIntegrityError();
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const seenItemIds = new Set<string>();
  for (const line of input.lines) {
    if (seenItemIds.has(line.orderItemId)) throw new OrderIntegrityError();
    seenItemIds.add(line.orderItemId);
    const item = itemsById.get(line.orderItemId);
    if (!item
      || item.order_id !== input.orderId
      || item.variant_id !== line.variantId
      || item.quantity !== line.quantity) {
      throw new OrderIntegrityError();
    }
  }
  if (seenItemIds.size !== items.length) throw new OrderIntegrityError();
}

export async function transitionOrder(input: TransitionOrderInput): Promise<TransitionOrderResult> {
  return withTransaction(async (client) => {
    const order = await findOrderById(client, input.orderId, true);
    if (!order) throw new OrderNotFoundError();

    const existingEvent = await findOrderEventByKey(client, input.orderId, input.idempotencyKey);
    if (existingEvent) {
      const storedMetadata = { ...existingEvent.metadata };
      delete storedMetadata.requestId;
      if (existingEvent.to_status !== input.toStatus
        || existingEvent.reason !== input.reason
        || stableJson(storedMetadata) !== stableJson(input.metadata)) {
        throw new OrderIdempotencyConflictError();
      }
      return {
        order: await loadOrder(client, order.id),
        event: toOrderEvent(existingEvent),
        idempotentReplay: true,
      };
    }

    assertOrderTransition(order.status, input.toStatus);
    await client.query(
      `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1`,
      [order.id, input.toStatus],
    );
    const event = await insertOrderEvent(client, {
      orderId: order.id,
      actorUserId: input.actorUserId,
      fromStatus: order.status,
      toStatus: input.toStatus,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      metadata: { ...input.metadata, requestId: input.requestId },
    });
    const updatedOrder = await loadOrder(client, order.id);
    await appendOrderAudit(client, {
      actorUserId: input.actorUserId,
      action: "order.status_changed",
      orderId: order.id,
      requestId: input.requestId,
      reason: input.reason,
      beforeState: { status: order.status },
      afterState: { status: updatedOrder.status },
    });
    return { order: updatedOrder, event: toOrderEvent(event), idempotentReplay: false };
  });
}

async function assertActiveWholesaleMembership(
  client: PoolClient,
  buyerUserId: string,
  membershipId: string | null,
): Promise<void> {
  if (!membershipId) throw new WholesaleOrderNotEligibleError();
  const result = await client.query(
    `SELECT 1
       FROM wholesale_memberships membership
       INNER JOIN wholesale_accounts account ON account.id = membership.wholesale_account_id
      WHERE membership.id = $1
        AND account.user_id = $2
        AND account.status = 'active'
        AND membership.status = 'active'
        AND membership.starts_at <= now()
        AND membership.ends_at > now()
      LIMIT 1`,
    [membershipId, buyerUserId],
  );
  if (result.rowCount !== 1) throw new WholesaleOrderNotEligibleError();
}

async function assertCatalogSnapshot(
  client: PoolClient,
  market: OrderMarket,
  item: OrderItemSnapshot,
): Promise<void> {
  const result = await client.query<CatalogSnapshotRow>(
    `SELECT
       p.id AS product_id,
       v.id AS variant_id,
       p.owner_type AS product_owner_type,
       p.supplier_id AS product_supplier_id,
       p.status AS product_status,
       p.retail_enabled,
       p.wholesale_enabled,
       p.title AS product_title,
       v.sku AS variant_sku,
       v.attributes AS variant_attributes,
       v.status AS variant_status,
       s.public_display_name AS supplier_display_name,
       s.status AS supplier_status
     FROM product_variants v
     INNER JOIN products p ON p.id = v.product_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = $1 AND v.id = $2
     LIMIT 1`,
    [item.productId, item.variantId],
  );
  const catalog = result.rows[0];
  if (!catalog
    || catalog.product_status !== "active"
    || catalog.variant_status !== "active"
    || (market === "retail" && (!catalog.retail_enabled || catalog.product_owner_type !== "platform"))
    || (market === "wholesale" && !catalog.wholesale_enabled)
    || (catalog.product_owner_type === "supplier" && catalog.supplier_status !== "approved")) {
    throw new OrderSnapshotMismatchError();
  }

  const expectedSellerType = catalog.product_owner_type;
  const expectedSellerId = catalog.product_owner_type === "supplier" ? catalog.product_supplier_id : null;
  const expectedSellerDisplayName = catalog.product_owner_type === "supplier"
    ? catalog.supplier_display_name
    : "Platform";
  if (item.sellerType !== expectedSellerType
    || item.sellerId !== expectedSellerId
    || item.sellerDisplayName !== expectedSellerDisplayName
    || item.title !== catalog.product_title
    || item.sku !== catalog.variant_sku
    || stableJson(item.attributes) !== stableJson(catalog.variant_attributes)) {
    throw new OrderSnapshotMismatchError();
  }
}

function assertOrderTotals(input: CreateOrderInput): void {
  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
  const discount = input.items.reduce((sum, item) => sum + item.discountMinor, 0);
  const tax = input.items.reduce((sum, item) => sum + item.taxMinor, 0);
  const itemTotal = input.items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const total = input.subtotalMinor - input.discountMinor + input.taxMinor + input.shippingMinor;
  const pricing = input.pricingSnapshot;
  if (![subtotal, discount, tax, itemTotal, total].every(Number.isSafeInteger)
    || subtotal !== input.subtotalMinor
    || discount !== input.discountMinor
    || tax !== input.taxMinor
    || itemTotal + input.shippingMinor !== input.totalMinor
    || total !== input.totalMinor
    || pricing.market !== input.market
    || pricing.currency !== input.currency
    || pricing.subtotalMinor !== input.subtotalMinor
    || pricing.discountMinor !== input.discountMinor
    || pricing.taxMinor !== input.taxMinor
    || pricing.shippingMinor !== input.shippingMinor
    || pricing.totalMinor !== input.totalMinor) {
    throw new OrderIntegrityError();
  }
}

function assertPricedReplayMatches(order: OrderRecord, input: CreatePricedOrderInput): void {
  if (order.buyerUserId !== input.buyerUserId
    || order.market !== input.market
    || order.currency !== input.currency
    || order.wholesaleMembershipId !== (input.wholesaleMembershipId ?? null)
    || order.items.length !== input.items.length) {
    throw new OrderIdempotencyConflictError();
  }
  for (const requestedItem of input.items) {
    const orderItem = order.items.find((item) => item.productId === requestedItem.productId
      && item.variantId === requestedItem.variantId);
    if (!orderItem || orderItem.quantity !== requestedItem.quantity) {
      throw new OrderIdempotencyConflictError();
    }
  }
}

function fingerprintCreateCommand(input: CreateOrderInput): string {
  return createHash("sha256")
    .update(stableJson({
      buyerUserId: input.buyerUserId,
      market: input.market,
      wholesaleMembershipId: input.wholesaleMembershipId ?? null,
      currency: input.currency,
      shippingMinor: input.shippingMinor,
      subtotalMinor: input.subtotalMinor,
      discountMinor: input.discountMinor,
      taxMinor: input.taxMinor,
      totalMinor: input.totalMinor,
      items: input.items,
    }))
    .digest("hex");
}

async function findOrderByIdempotencyKey(
  client: PoolClient,
  idempotencyKey: string,
  lock: boolean,
): Promise<(OrderRow & { command_fingerprint: string }) | null> {
  const result = await client.query<OrderRow & { command_fingerprint: string }>(
    `SELECT id, order_number, buyer_user_id, market_type, wholesale_membership_id,
            status, reservation_status, reservation_batch_id,
            currency, subtotal_minor, discount_minor, tax_minor, shipping_minor,
            total_minor, pricing_snapshot, snapshot_version, idempotency_key, command_fingerprint,
            created_at, updated_at
       FROM orders
      WHERE idempotency_key = $1
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findOrderById(client: PoolClient, orderId: string, lock: boolean): Promise<OrderRow | null> {
  const result = await client.query<OrderRow>(
    `SELECT id, order_number, buyer_user_id, market_type, wholesale_membership_id,
            status, reservation_status, reservation_batch_id,
            currency, subtotal_minor, discount_minor, tax_minor, shipping_minor,
            total_minor, pricing_snapshot, snapshot_version, created_at, updated_at
       FROM orders
      WHERE id = $1
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

async function loadOrder(client: PoolClient, orderId: string): Promise<OrderRecord> {
  const order = await findOrderById(client, orderId, false);
  if (!order) throw new OrderIntegrityError();
  const itemResult = await client.query<OrderItemRow>(
    `SELECT id, order_id, line_number, product_id, variant_id, quantity, line_total_minor, snapshot
       FROM order_items
      WHERE order_id = $1
      ORDER BY line_number ASC`,
    [orderId],
  );
  if (itemResult.rows.length === 0) throw new OrderIntegrityError();
  return toOrder(order, itemResult.rows);
}

async function findOrderEventByKey(
  client: PoolClient,
  orderId: string,
  idempotencyKey: string,
): Promise<OrderEventRow | null> {
  const result = await client.query<OrderEventRow>(
    `SELECT id, order_id, actor_user_id, from_status, to_status, reason,
            idempotency_key, metadata, created_at
       FROM order_events
      WHERE order_id = $1 AND idempotency_key = $2
      LIMIT 1`,
    [orderId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function insertOrderEvent(
  client: PoolClient,
  input: {
    orderId: string;
    actorUserId: string | null;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    reason: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  },
): Promise<OrderEventRow> {
  const result = await client.query<OrderEventRow>(
    `INSERT INTO order_events
       (id, order_id, actor_user_id, from_status, to_status, reason, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, order_id, actor_user_id, from_status, to_status, reason,
       idempotency_key, metadata, created_at`,
    [
      randomUUID(),
      input.orderId,
      input.actorUserId,
      input.fromStatus,
      input.toStatus,
      input.reason,
      input.idempotencyKey,
      JSON.stringify(input.metadata),
    ],
  );
  const event = result.rows[0];
  if (!event) throw new OrderIntegrityError();
  return event;
}

async function appendOrderAudit(
  client: PoolClient,
  input: {
    actorUserId: string | null;
    action: string;
    orderId: string;
    requestId: string;
    reason?: string;
    beforeState?: Record<string, unknown>;
    afterState: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, resource_type, resource_id,
        before_state, after_state, reason, request_id, metadata)
     VALUES ($1, $2, $3, 'order', $4, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.orderId,
      JSON.stringify(input.beforeState ?? null),
      JSON.stringify(input.afterState),
      input.reason ?? null,
      input.requestId,
      JSON.stringify({ source: "order-repository" }),
    ],
  );
}

function toOrder(order: OrderRow, items: OrderItemRow[]): OrderRecord {
  return {
    id: order.id,
    orderNumber: order.order_number,
    buyerUserId: order.buyer_user_id,
    market: order.market_type,
    wholesaleMembershipId: order.wholesale_membership_id,
    status: order.status,
    reservationStatus: order.reservation_status,
    reservationBatchId: order.reservation_batch_id,
    currency: order.currency,
    subtotalMinor: toSafeNumber(order.subtotal_minor),
    discountMinor: toSafeNumber(order.discount_minor),
    taxMinor: toSafeNumber(order.tax_minor),
    shippingMinor: toSafeNumber(order.shipping_minor),
    totalMinor: toSafeNumber(order.total_minor),
    pricingSnapshot: order.pricing_snapshot,
    snapshotVersion: order.snapshot_version,
    items: items.map((item) => ({
      id: item.id,
      lineNumber: item.line_number,
      productId: item.product_id,
      variantId: item.variant_id,
      quantity: item.quantity,
      lineTotalMinor: toSafeNumber(item.line_total_minor),
      snapshot: item.snapshot,
    })),
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString(),
  };
}

function toOrderEvent(event: OrderEventRow): OrderEventRecord {
  return {
    id: event.id,
    orderId: event.order_id,
    actorUserId: event.actor_user_id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    reason: event.reason,
    idempotencyKey: event.idempotency_key,
    metadata: event.metadata,
    createdAt: event.created_at.toISOString(),
  };
}

function toSafeNumber(value: MoneyValue): number {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) throw new OrderIntegrityError();
  return numberValue;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
