import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import {
  InventoryInsufficientError,
} from "@/server/inventory/errors";
import {
  adjustInventory,
  createInboundShipment,
  inspectInventoryReceipt,
  placeInventoryHold,
  receiveInventory,
  releaseInventoryHold,
  releaseInventoryBatch,
  releaseInventoryReservation,
  reserveInventory,
  reserveInventoryBatch,
  transferInventory,
} from "@/server/inventory/inventory-repository";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
let userId: string | undefined;
let productId: string | undefined;
let warehouseId: string | undefined;
let locationId: string | undefined;
let secondLocationId: string | undefined;
let shipmentId: string | undefined;
let batchId: string | undefined;


describeDatabase("inventory integrity", () => {
  afterEach(async () => {
    if (productId) {
      await query("DELETE FROM inventory_holds WHERE product_id = $1", [productId]);
      await query("DELETE FROM inventory_movements WHERE product_id = $1", [productId]);
      await query("DELETE FROM inventory_receipts WHERE product_id = $1", [productId]);
      await query("DELETE FROM inventory_reservations WHERE product_id = $1", [productId]);
      if (batchId) {
        await query("DELETE FROM inventory_reservation_batches WHERE id = $1", [batchId]);
        batchId = undefined;
      }
      await query("DELETE FROM inventory_balances WHERE product_id = $1", [productId]);
      await query("DELETE FROM inventory_transfers WHERE product_id = $1", [productId]);
      if (shipmentId) {
        await query("DELETE FROM inbound_shipment_events WHERE shipment_id = $1", [shipmentId]);
        await query("DELETE FROM inbound_shipment_items WHERE shipment_id = $1", [shipmentId]);
        await query("DELETE FROM inbound_shipments WHERE id = $1", [shipmentId]);
        shipmentId = undefined;
      }
      await query("DELETE FROM products WHERE id = $1", [productId]);
      productId = undefined;
    }
    if (locationId) {
      await query("DELETE FROM warehouse_locations WHERE id = $1", [locationId]);
      locationId = undefined;
    }
    if (secondLocationId) {
      await query("DELETE FROM warehouse_locations WHERE id = $1", [secondLocationId]);
      secondLocationId = undefined;
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

  it("receives idempotently and prevents concurrent overselling", async () => {
    userId = randomUUID();
    productId = randomUUID();
    const variantId = randomUUID();
    warehouseId = randomUUID();
    locationId = randomUUID();
    secondLocationId = randomUUID();
    const email = `${userId}@example.com`;

    await query(
      `INSERT INTO users (id, email, email_normalized, status)
       VALUES ($1, $2, $2, 'active')`,
      [userId, email],
    );
    await query(
      `INSERT INTO products
         (id, owner_type, status, slug, title, retail_enabled, wholesale_enabled)
       VALUES ($1, 'platform', 'active', $2, 'Inventory Test Product', true, false)`,
      [productId, `inventory-test-${productId}`],
    );
    await query(
      `INSERT INTO product_variants (id, product_id, sku, attributes)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [variantId, productId, `INV-${variantId}`],
    );
    await query(
      `INSERT INTO warehouses (id, code, name) VALUES ($1, $2, 'Integration Warehouse')`,
      [warehouseId, `WH-${warehouseId.slice(0, 8).toUpperCase()}`],
    );
    await query(
      `INSERT INTO warehouse_locations (id, warehouse_id, code)
       VALUES ($1, $2, 'A-01'), ($3, $2, 'B-01')`,
      [locationId, warehouseId, secondLocationId],
    );

    const shipment = await createInboundShipment({
      sourceSupplierId: null,
      referenceCode: `ASN-${randomUUID()}`,
      expectedAt: null,
      items: [{ variantId, expectedQuantity: 5 }],
      actorUserId: userId,
      requestId: "inventory-integration-shipment",
    });
    shipmentId = shipment.id;
    const receipt = await receiveInventory({
      variantId,
      locationId,
      sourceSupplierId: null,
      shipmentId: shipment.id,
      quantity: 5,
      idempotencyKey: `receipt-${randomUUID()}`,
      reason: "Integration receipt",
      actorUserId: userId,
      requestId: "inventory-integration",
    });
    const replay = await receiveInventory({
      variantId,
      locationId,
      sourceSupplierId: null,
      shipmentId: shipment.id,
      quantity: 5,
      idempotencyKey: receipt.movement.idempotencyKey.replace("inventory:receive:", ""),
      reason: "Integration receipt",
      actorUserId: userId,
      requestId: "inventory-integration-replay",
    });

    expect(receipt.balance).toMatchObject({
      onHandQuantity: 5,
      unavailableQuantity: 5,
      availableQuantity: 0,
    });
    expect(receipt.receipt?.status).toBe("pending_qc");
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.movement.id).toBe(receipt.movement.id);

    const qc = await inspectInventoryReceipt({
      receiptId: receipt.receipt?.id ?? "",
      acceptedQuantity: 4,
      rejectedQuantity: 1,
      idempotencyKey: `qc-${randomUUID()}`,
      reason: "Integration QC passed",
      actorUserId: userId,
      requestId: "inventory-integration-qc",
    });
    expect(qc.receipt?.status).toBe("accepted");
    expect(qc.movements).toHaveLength(2);
    expect(qc.balance).toMatchObject({ onHandQuantity: 4, unavailableQuantity: 0, availableQuantity: 4 });

    const transfer = await transferInventory({
      variantId,
      sourceLocationId: locationId,
      destinationLocationId: secondLocationId,
      sourceSupplierId: null,
      quantity: 1,
      idempotencyKey: `transfer-${randomUUID()}`,
      reason: "Integration relocation",
      actorUserId: userId,
      requestId: "inventory-integration-transfer",
    });
    expect(transfer.movements).toHaveLength(2);
    expect(transfer.sourceBalance.availableQuantity).toBe(3);
    expect(transfer.destinationBalance.availableQuantity).toBe(1);

    const adjustment = await adjustInventory({
      variantId,
      locationId: secondLocationId,
      sourceSupplierId: null,
      quantityDelta: 2,
      idempotencyKey: `adjust-${randomUUID()}`,
      reason: "Integration cycle count correction",
      actorUserId: userId,
      requestId: "inventory-integration-adjustment",
    });
    expect(adjustment.balance).toMatchObject({ onHandQuantity: 3, availableQuantity: 3 });
    const adjustmentReplay = await adjustInventory({
      variantId,
      locationId: secondLocationId,
      sourceSupplierId: null,
      quantityDelta: 2,
      idempotencyKey: adjustment.movement.idempotencyKey.replace("inventory:adjust:", ""),
      reason: "Integration cycle count correction",
      actorUserId: userId,
      requestId: "inventory-integration-adjustment-replay",
    });
    expect(adjustmentReplay.idempotentReplay).toBe(true);

    const hold = await placeInventoryHold({
      variantId,
      locationId: secondLocationId,
      sourceSupplierId: null,
      quantity: 2,
      idempotencyKey: `hold-${randomUUID()}`,
      reason: "Integration quality review",
      actorUserId: userId,
      requestId: "inventory-integration-hold",
    });
    expect(hold.hold?.status).toBe("active");
    expect(hold.balance).toMatchObject({ onHandQuantity: 3, unavailableQuantity: 2, availableQuantity: 1 });
    const holdReplay = await placeInventoryHold({
      variantId,
      locationId: secondLocationId,
      sourceSupplierId: null,
      quantity: 2,
      idempotencyKey: hold.hold?.idempotencyKey ?? "",
      reason: "Integration quality review",
      actorUserId: userId,
      requestId: "inventory-integration-hold-replay",
    });
    expect(holdReplay.idempotentReplay).toBe(true);
    const releasedHold = await releaseInventoryHold({
      holdId: hold.hold?.id ?? "",
      idempotencyKey: `hold-release-${randomUUID()}`,
      reason: "Integration quality review complete",
      actorUserId: userId,
      requestId: "inventory-integration-hold-release",
    });
    expect(releasedHold.hold?.status).toBe("released");
    expect(releasedHold.balance).toMatchObject({ onHandQuantity: 3, unavailableQuantity: 0, availableQuantity: 3 });
    const releasedHoldReplay = await releaseInventoryHold({
      holdId: hold.hold?.id ?? "",
      idempotencyKey: releasedHold.hold?.releaseIdempotencyKey ?? "",
      reason: "Integration quality review complete",
      actorUserId: userId,
      requestId: "inventory-integration-hold-release-replay",
    });
    expect(releasedHoldReplay.idempotentReplay).toBe(true);

    const reservation = await reserveInventory({
      variantId,
      locationId,
      sourceSupplierId: null,
      quantity: 2,
      idempotencyKey: `reservation-${randomUUID()}`,
      referenceType: "integration",
      referenceId: productId,
      actorUserId: userId,
      requestId: "inventory-integration",
    });
    expect(reservation.balance).toMatchObject({ reservedQuantity: 2, availableQuantity: 1 });

    const reservationReplay = await reserveInventory({
      variantId,
      locationId,
      sourceSupplierId: null,
      quantity: 2,
      idempotencyKey: reservation.reservation?.idempotencyKey ?? "",
      referenceType: "integration",
      referenceId: productId,
      actorUserId: userId,
      requestId: "inventory-integration-replay",
    });
    expect(reservationReplay.idempotentReplay).toBe(true);

    const concurrent = await Promise.allSettled([
      reserveInventory({
        variantId,
        locationId,
        sourceSupplierId: null,
        quantity: 1,
        idempotencyKey: `concurrent-a-${randomUUID()}`,
        actorUserId: userId,
        requestId: "inventory-concurrency-a",
      }),
      reserveInventory({
        variantId,
        locationId,
        sourceSupplierId: null,
        quantity: 2,
        idempotencyKey: `concurrent-b-${randomUUID()}`,
        actorUserId: userId,
        requestId: "inventory-concurrency-b",
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(InventoryInsufficientError);

    const released = await releaseInventoryReservation({
      reservationId: reservation.reservation?.id ?? "",
      idempotencyKey: `release-${randomUUID()}`,
      reason: "Integration release",
      actorUserId: userId,
      requestId: "inventory-integration",
    });
    expect(released.reservation?.status).toBe("released");

    const batchIdempotencyKey = `reservation-batch-${randomUUID()}`;
    const batch = await reserveInventoryBatch({
      idempotencyKey: batchIdempotencyKey,
      referenceType: "integration",
      referenceId: productId,
      reason: "Reserve two explicit locations",
      lines: [
        {
          variantId,
          locationId,
          sourceSupplierId: null,
          lineReference: null,
          quantity: 1,
        },
        {
          variantId,
          locationId: secondLocationId,
          sourceSupplierId: null,
          lineReference: null,
          quantity: 1,
        },
      ],
      actorUserId: userId,
      requestId: "inventory-integration-batch",
    });
    batchId = batch.batchId;
    expect(batch.reservations).toHaveLength(2);
    const batchReplay = await reserveInventoryBatch({
      idempotencyKey: batchIdempotencyKey,
      referenceType: "integration",
      referenceId: productId,
      reason: "Reserve two explicit locations",
      lines: [
        { variantId, locationId, sourceSupplierId: null, lineReference: null, quantity: 1 },
        { variantId, locationId: secondLocationId, sourceSupplierId: null, lineReference: null, quantity: 1 },
      ],
      actorUserId: userId,
      requestId: "inventory-integration-batch-replay",
    });
    expect(batchReplay.idempotentReplay).toBe(true);

    const releaseBatchKey = `release-batch-${randomUUID()}`;
    const releasedBatch = await releaseInventoryBatch({
      batchId: batch.batchId,
      idempotencyKey: releaseBatchKey,
      reason: "Release explicit locations",
      actorUserId: userId,
      requestId: "inventory-integration-batch-release",
    });
    expect(releasedBatch.status).toBe("released");
    const releasedBatchReplay = await releaseInventoryBatch({
      batchId: batch.batchId,
      idempotencyKey: releaseBatchKey,
      reason: "Release explicit locations",
      actorUserId: userId,
      requestId: "inventory-integration-batch-release-replay",
    });
    expect(releasedBatchReplay.idempotentReplay).toBe(true);
  });
});
