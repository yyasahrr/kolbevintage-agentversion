import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "@/server/db/pool";
import { withTransaction } from "@/server/db/transaction";
import {
  InventoryIdempotencyConflictError,
  InventoryInsufficientError,
  InventoryIntegrityError,
  InventoryNotAvailableError,
  InventoryNotFoundError,
  InventorySourceMismatchError,
  InventoryStateError,
} from "@/server/inventory/errors";
import type {
  AdjustInventoryInput,
  CreateInboundShipmentInput,
  InspectInventoryReceiptInput,
  PlaceInventoryHoldInput,
  ReceiveInventoryInput,
  ReleaseInventoryHoldInput,
  ReleaseInventoryInput,
  ReserveInventoryInput,
  TransferInventoryInput,
} from "@/server/inventory/validation";

export type InventoryBalance = {
  onHandQuantity: number;
  reservedQuantity: number;
  unavailableQuantity: number;
  availableQuantity: number;
};

export type InventoryMovement = {
  id: string;
  movementType: string;
  idempotencyKey: string;
};

export type InventoryHold = {
  id: string;
  variantId: string;
  locationId: string;
  sourceSupplierId: string | null;
  quantity: number;
  status: "active" | "released";
  idempotencyKey: string;
  releaseIdempotencyKey: string | null;
};

export type InventoryReservation = {
  id: string;
  variantId: string;
  locationId: string;
  sourceSupplierId: string | null;
  quantity: number;
  status: "active" | "released" | "consumed" | "cancelled";
  idempotencyKey: string;
};

export type InventoryReceipt = {
  id: string;
  variantId: string;
  locationId: string;
  sourceSupplierId: string | null;
  shipmentId: string | null;
  shipmentItemId: string | null;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  status: "pending_qc" | "accepted" | "partially_rejected" | "rejected";
  idempotencyKey: string;
  qcIdempotencyKey: string | null;
};

export type InventoryOperationResult = {
  movement: InventoryMovement;
  movements: InventoryMovement[];
  reservation: InventoryReservation | null;
  receipt: InventoryReceipt | null;
  hold: InventoryHold | null;
  balance: InventoryBalance;
  idempotentReplay: boolean;
};

type InventoryContext = {
  productId: string;
  variantId: string;
  ownerType: "platform" | "supplier";
  productStatus: "draft" | "active" | "archived" | "suspended";
  productSupplierId: string | null;
  supplierStatus: string | null;
};

type BalanceRow = {
  id: string;
  on_hand_quantity: number;
  reserved_quantity: number;
  unavailable_quantity: number;
};

type MovementRow = {
  id: string;
  product_id: string;
  variant_id: string;
  location_id: string;
  source_supplier_id: string | null;
  movement_type: string;
  quantity_delta: number;
  reserved_delta: number;
  unavailable_delta: number;
  idempotency_key: string;
};

type ReservationRow = {
  id: string;
  product_id: string;
  variant_id: string;
  location_id: string;
  source_supplier_id: string | null;
  quantity: number;
  status: InventoryReservation["status"];
  idempotency_key: string;
};

export type InboundShipmentItem = {
  id: string;
  variantId: string;
  expectedQuantity: number;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  status: "expected" | "partially_received" | "received" | "completed";
};

export type InboundShipmentRecord = {
  id: string;
  sourceSupplierId: string | null;
  referenceCode: string;
  status: "expected" | "partially_received" | "received" | "cancelled";
  expectedAt: string | null;
  items: InboundShipmentItem[];
};

export type InventoryTransferResult = {
  transferId: string;
  idempotentReplay: boolean;
  sourceBalance: InventoryBalance;
  destinationBalance: InventoryBalance;
  movements: InventoryMovement[];
};

type ShipmentItemRow = {
  id: string;
  shipment_id: string;
  product_id: string;
  variant_id: string;
  source_supplier_id: string | null;
  shipment_status: InboundShipmentRecord["status"];
  expected_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  status: InboundShipmentItem["status"];
};

type ShipmentRow = {
  id: string;
  source_supplier_id: string | null;
  reference_code: string;
  status: InboundShipmentRecord["status"];
  expected_at: Date | null;
};

type HoldRow = {
  id: string;
  product_id: string;
  variant_id: string;
  location_id: string;
  source_supplier_id: string | null;
  quantity: number;
  status: InventoryHold["status"];
  idempotency_key: string;
  release_idempotency_key: string | null;
};

type TransferRow = {
  id: string;
  product_id: string;
  variant_id: string;
  source_location_id: string;
  destination_location_id: string;
  source_supplier_id: string | null;
  quantity: number;
  idempotency_key: string;
};

type ReceiptRow = {
  id: string;
  product_id: string;
  variant_id: string;
  location_id: string;
  source_supplier_id: string | null;
  shipment_id: string | null;
  shipment_item_id: string | null;
  quantity_received: number;
  quantity_accepted: number;
  quantity_rejected: number;
  status: InventoryReceipt["status"];
  idempotency_key: string;
  qc_idempotency_key: string | null;
};

export async function createInboundShipment(input: CreateInboundShipmentInput): Promise<InboundShipmentRecord> {
  return withTransaction(async (client) => {
    const shipmentId = randomUUID();
    const itemRows: Array<{ id: string; productId: string; variantId: string; expectedQuantity: number }> = [];

    for (const item of input.items) {
      const result = await client.query<{
        product_id: string;
        owner_type: "platform" | "supplier";
        supplier_id: string | null;
        supplier_status: string | null;
      }>(
        `SELECT p.id AS product_id, p.owner_type, p.supplier_id, s.status AS supplier_status
           FROM product_variants v
           INNER JOIN products p ON p.id = v.product_id
           LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE v.id = $1
          LIMIT 1`,
        [item.variantId],
      );
      const product = result.rows[0];
      if (!product) throw new InventoryNotFoundError();
      if (
        (product.owner_type === "platform" && input.sourceSupplierId !== null)
        || (product.owner_type === "supplier" && product.supplier_id !== input.sourceSupplierId)
      ) {
        throw new InventorySourceMismatchError();
      }
      if (product.owner_type === "supplier" && product.supplier_status !== "approved") {
        throw new InventoryNotAvailableError();
      }
      itemRows.push({
        id: randomUUID(),
        productId: product.product_id,
        variantId: item.variantId,
        expectedQuantity: item.expectedQuantity,
      });
    }

    await client.query(
      `INSERT INTO inbound_shipments
         (id, source_supplier_id, reference_code, expected_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [shipmentId, input.sourceSupplierId, input.referenceCode, input.expectedAt ?? null, input.actorUserId],
    );
    for (const item of itemRows) {
      await client.query(
        `INSERT INTO inbound_shipment_items
           (id, shipment_id, product_id, variant_id, expected_quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.id, shipmentId, item.productId, item.variantId, item.expectedQuantity],
      );
    }
    await client.query(
      `INSERT INTO inbound_shipment_events
         (id, shipment_id, actor_user_id, to_status, reason, metadata)
       VALUES ($1, $2, $3, 'expected', 'Inbound shipment created', $4::jsonb)`,
      [randomUUID(), shipmentId, input.actorUserId, JSON.stringify({ requestId: input.requestId })],
    );
    await appendSimpleAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.inbound_shipment.created",
      resourceType: "inbound_shipment",
      resourceId: shipmentId,
      requestId: input.requestId,
      afterState: { status: "expected", itemCount: itemRows.length },
    });

    return {
      id: shipmentId,
      sourceSupplierId: input.sourceSupplierId,
      referenceCode: input.referenceCode,
      status: "expected",
      expectedAt: input.expectedAt ?? null,
      items: itemRows.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        expectedQuantity: item.expectedQuantity,
        receivedQuantity: 0,
        acceptedQuantity: 0,
        rejectedQuantity: 0,
        status: "expected" as const,
      })),
    };
  });
}

export async function receiveInventory(input: ReceiveInventoryInput): Promise<InventoryOperationResult> {
  const movementKey = `inventory:receive:${input.idempotencyKey}`;

  return withTransaction(async (client) => {
    await lockCommand(client, movementKey);
    const context = await loadContext(client, input.variantId, input.locationId);
    assertSource(context, input.sourceSupplierId);
    if (context.ownerType === "supplier" && context.supplierStatus !== "approved") {
      throw new InventoryNotAvailableError();
    }
    const balance = await lockOrCreateBalance(client, context, input.locationId, input.sourceSupplierId);
    const existing = await findMovement(client, movementKey);
    const existingReceipt = await findReceiptByKey(client, input.idempotencyKey);
    if (existing) {
      assertMovementMatches(existing, context, input.locationId, input.sourceSupplierId, "receive", input.quantity);
      if (!existingReceipt) {
        throw new InventoryIntegrityError();
      }
      assertReceiptMatches(existingReceipt, context, input.locationId, input.sourceSupplierId, input.quantity, input.shipmentId);
      return buildResult(existing, null, toBalance(balance), true, existingReceipt);
    }
    if (existingReceipt) {
      throw new InventoryIntegrityError();
    }
    const shipmentItem = input.shipmentId
      ? await lockShipmentItemForReceive(client, input.shipmentId, context.variantId, input.sourceSupplierId, input.quantity)
      : null;

    const receipt = await insertReceipt(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      shipmentId: input.shipmentId,
      shipmentItemId: shipmentItem?.id ?? null,
    });
    const nextOnHand = balance.on_hand_quantity + input.quantity;
    const nextBalance = assertBalance({
      onHandQuantity: nextOnHand,
      reservedQuantity: balance.reserved_quantity,
      unavailableQuantity: balance.unavailable_quantity + input.quantity,
    });
    await updateBalance(client, balance.id, nextBalance);
    if (shipmentItem) {
      await markShipmentItemReceived(client, shipmentItem.id, input.quantity);
      await refreshShipmentStatus(client, input.shipmentId);
    }
    const movement = await insertMovement(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      movementType: "receive",
      quantityDelta: input.quantity,
      reservedDelta: 0,
      unavailableDelta: input.quantity,
      balance: nextBalance,
      idempotencyKey: movementKey,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      referenceType: "inventory_receipt",
      referenceId: receipt.id,
      requestId: input.requestId,
    });
    await appendInventoryAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.received",
      resourceType: "inventory_movement",
      resourceId: movement.id,
      reason: input.reason ?? null,
      requestId: input.requestId,
      afterState: nextBalance,
    });

    return buildResult(movement, null, nextBalance, false, receipt);
  });
}

export async function transferInventory(input: TransferInventoryInput): Promise<InventoryTransferResult> {
  const transferKey = `inventory:transfer:${input.idempotencyKey}`;
  const outboundKey = `${transferKey}:out`;
  const inboundKey = `${transferKey}:in`;

  return withTransaction(async (client) => {
    await lockCommand(client, transferKey);
    const existing = await findTransfer(client, input.idempotencyKey);
    const sourceContext = await loadContext(client, input.variantId, input.sourceLocationId);
    const destinationContext = await loadContext(client, input.variantId, input.destinationLocationId);
    assertSource(sourceContext, input.sourceSupplierId);
    assertSource(destinationContext, input.sourceSupplierId);
    if (sourceContext.productId !== destinationContext.productId) {
      throw new InventoryNotAvailableError();
    }

    const locations = [
      { locationId: input.sourceLocationId, context: sourceContext },
      { locationId: input.destinationLocationId, context: destinationContext },
    ].sort((left, right) => left.locationId.localeCompare(right.locationId));
    const lockedBalances = new Map<string, BalanceRow>();
    for (const location of locations) {
      lockedBalances.set(
        location.locationId,
        await lockOrCreateBalance(client, location.context, location.locationId, input.sourceSupplierId),
      );
    }
    const sourceBalance = lockedBalances.get(input.sourceLocationId);
    const destinationBalance = lockedBalances.get(input.destinationLocationId);
    if (!sourceBalance || !destinationBalance) throw new InventoryIntegrityError();

    if (existing) {
      assertTransferMatches(existing, input);
      const movements = await findMovements(client, [outboundKey, inboundKey]);
      if (movements.length !== 2) throw new InventoryIntegrityError();
      return {
        transferId: existing.id,
        idempotentReplay: true,
        sourceBalance: toBalance(sourceBalance),
        destinationBalance: toBalance(destinationBalance),
        movements: movements.map(toMovement),
      };
    }
    if (sourceContext.productStatus === "archived" || destinationContext.productStatus === "archived") {
      throw new InventoryNotAvailableError();
    }

    const available = sourceBalance.on_hand_quantity
      - sourceBalance.reserved_quantity
      - sourceBalance.unavailable_quantity;
    if (available < input.quantity) {
      throw new InventoryInsufficientError(input.quantity, available);
    }
    const nextSourceBalance = assertBalance({
      onHandQuantity: sourceBalance.on_hand_quantity - input.quantity,
      reservedQuantity: sourceBalance.reserved_quantity,
      unavailableQuantity: sourceBalance.unavailable_quantity,
    });
    const nextDestinationBalance = assertBalance({
      onHandQuantity: destinationBalance.on_hand_quantity + input.quantity,
      reservedQuantity: destinationBalance.reserved_quantity,
      unavailableQuantity: destinationBalance.unavailable_quantity,
    });
    await updateBalance(client, sourceBalance.id, nextSourceBalance);
    await updateBalance(client, destinationBalance.id, nextDestinationBalance);
    const outboundMovement = await insertMovement(client, {
      productId: sourceContext.productId,
      variantId: sourceContext.variantId,
      locationId: input.sourceLocationId,
      sourceSupplierId: input.sourceSupplierId,
      movementType: "transfer_out",
      quantityDelta: -input.quantity,
      reservedDelta: 0,
      unavailableDelta: 0,
      balance: nextSourceBalance,
      idempotencyKey: outboundKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
      referenceType: "inventory_transfer",
      referenceId: input.idempotencyKey,
      requestId: input.requestId,
    });
    const inboundMovement = await insertMovement(client, {
      productId: destinationContext.productId,
      variantId: destinationContext.variantId,
      locationId: input.destinationLocationId,
      sourceSupplierId: input.sourceSupplierId,
      movementType: "transfer_in",
      quantityDelta: input.quantity,
      reservedDelta: 0,
      unavailableDelta: 0,
      balance: nextDestinationBalance,
      idempotencyKey: inboundKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
      referenceType: "inventory_transfer",
      referenceId: input.idempotencyKey,
      requestId: input.requestId,
    });
    const transfer = await insertTransfer(client, {
      productId: sourceContext.productId,
      variantId: sourceContext.variantId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      sourceSupplierId: input.sourceSupplierId,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
    });
    await appendSimpleAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.transferred",
      resourceType: "inventory_transfer",
      resourceId: transfer.id,
      requestId: input.requestId,
      afterState: {
        quantity: input.quantity,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
      },
    });

    return {
      transferId: transfer.id,
      idempotentReplay: false,
      sourceBalance: nextSourceBalance,
      destinationBalance: nextDestinationBalance,
      movements: [toMovement(outboundMovement), toMovement(inboundMovement)],
    };
  });
}

export async function adjustInventory(input: AdjustInventoryInput): Promise<InventoryOperationResult> {
  const movementKey = `inventory:adjust:${input.idempotencyKey}`;

  return withTransaction(async (client) => {
    await lockCommand(client, movementKey);
    const context = await loadContext(client, input.variantId, input.locationId);
    assertSource(context, input.sourceSupplierId);
    const balance = await lockOrCreateBalance(client, context, input.locationId, input.sourceSupplierId);
    const existing = await findMovement(client, movementKey);
    if (existing) {
      assertMovementMatches(existing, context, input.locationId, input.sourceSupplierId, "adjust", input.quantityDelta);
      return buildResult(existing, null, balance, true);
    }

    if (input.quantityDelta < 0) {
      const available = balance.on_hand_quantity
        - balance.reserved_quantity
        - balance.unavailable_quantity;
      if (available < -input.quantityDelta) {
        throw new InventoryInsufficientError(-input.quantityDelta, available);
      }
    }
    const nextBalance = assertBalance({
      onHandQuantity: balance.on_hand_quantity + input.quantityDelta,
      reservedQuantity: balance.reserved_quantity,
      unavailableQuantity: balance.unavailable_quantity,
    });
    await updateBalance(client, balance.id, nextBalance);
    const movement = await insertMovement(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      movementType: "adjust",
      quantityDelta: input.quantityDelta,
      reservedDelta: 0,
      unavailableDelta: 0,
      balance: nextBalance,
      idempotencyKey: movementKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
      referenceType: "inventory_adjustment",
      referenceId: input.idempotencyKey,
      requestId: input.requestId,
    });
    await appendInventoryAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.adjusted",
      resourceType: "inventory_movement",
      resourceId: movement.id,
      reason: input.reason,
      requestId: input.requestId,
      afterState: nextBalance,
    });
    return buildResult(movement, null, nextBalance, false);
  });
}

export async function placeInventoryHold(input: PlaceInventoryHoldInput): Promise<InventoryOperationResult> {
  const movementKey = `inventory:hold:${input.idempotencyKey}`;

  return withTransaction(async (client) => {
    await lockCommand(client, movementKey);
    const context = await loadContext(client, input.variantId, input.locationId);
    assertSource(context, input.sourceSupplierId);
    const balance = await lockOrCreateBalance(client, context, input.locationId, input.sourceSupplierId);
    const existingHold = await findHoldByKey(client, input.idempotencyKey);
    if (existingHold) {
      assertHoldMatches(existingHold, context, input.locationId, input.sourceSupplierId, input.quantity);
      const existingMovement = await findMovement(client, movementKey);
      if (!existingMovement) throw new InventoryIntegrityError();
      return buildResult(existingMovement, null, balance, true, null, existingHold);
    }
    if (context.productStatus !== "active"
      || (context.ownerType === "supplier" && context.supplierStatus !== "approved")) {
      throw new InventoryNotAvailableError();
    }

    const available = balance.on_hand_quantity - balance.reserved_quantity - balance.unavailable_quantity;
    if (available < input.quantity) {
      throw new InventoryInsufficientError(input.quantity, available);
    }
    const nextBalance = assertBalance({
      onHandQuantity: balance.on_hand_quantity,
      reservedQuantity: balance.reserved_quantity,
      unavailableQuantity: balance.unavailable_quantity + input.quantity,
    });
    await updateBalance(client, balance.id, nextBalance);
    const movement = await insertMovement(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      movementType: "hold",
      quantityDelta: 0,
      reservedDelta: 0,
      unavailableDelta: input.quantity,
      balance: nextBalance,
      idempotencyKey: movementKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
      referenceType: "inventory_hold",
      referenceId: input.idempotencyKey,
      requestId: input.requestId,
    });
    const hold = await insertHold(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      reason: input.reason,
    });
    await appendInventoryAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.held",
      resourceType: "inventory_hold",
      resourceId: hold.id,
      reason: input.reason,
      requestId: input.requestId,
      afterState: nextBalance,
    });
    return buildResult(movement, null, nextBalance, false, null, hold);
  });
}

export async function releaseInventoryHold(input: ReleaseInventoryHoldInput): Promise<InventoryOperationResult> {
  const movementKey = `inventory:release-hold:${input.idempotencyKey}`;

  return withTransaction(async (client) => {
    await lockCommand(client, movementKey);
    const holdUsingReleaseKey = await findHoldByReleaseKey(client, input.idempotencyKey);
    if (holdUsingReleaseKey && holdUsingReleaseKey.id !== input.holdId) {
      throw new InventoryIdempotencyConflictError();
    }
    const hold = await findHoldById(client, input.holdId, true);
    if (!hold) throw new InventoryNotFoundError();
    const existingMovement = await findMovement(client, movementKey);
    const context = await loadContext(client, hold.variant_id, hold.location_id);
    assertSource(context, hold.source_supplier_id);
    const balance = await lockOrCreateBalance(client, context, hold.location_id, hold.source_supplier_id);

    if (hold.status !== "active") {
      if (hold.status === "released" && existingMovement?.id) {
        return buildResult(existingMovement, null, balance, true, null, hold);
      }
      throw new InventoryStateError();
    }
    if (existingMovement) throw new InventoryIntegrityError();
    if (balance.unavailable_quantity < hold.quantity) throw new InventoryIntegrityError();

    const nextBalance = assertBalance({
      onHandQuantity: balance.on_hand_quantity,
      reservedQuantity: balance.reserved_quantity,
      unavailableQuantity: balance.unavailable_quantity - hold.quantity,
    });
    await updateBalance(client, balance.id, nextBalance);
    const movement = await insertMovement(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: hold.location_id,
      sourceSupplierId: hold.source_supplier_id,
      movementType: "release_hold",
      quantityDelta: 0,
      reservedDelta: 0,
      unavailableDelta: -hold.quantity,
      balance: nextBalance,
      idempotencyKey: movementKey,
      actorUserId: input.actorUserId,
      reason: input.reason ?? "Inventory hold released",
      referenceType: "inventory_hold",
      referenceId: hold.id,
      requestId: input.requestId,
    });
    const updatedHold = await updateHoldReleased(client, hold.id, input);
    await appendInventoryAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.hold_released",
      resourceType: "inventory_hold",
      resourceId: hold.id,
      reason: input.reason ?? "Inventory hold released",
      requestId: input.requestId,
      afterState: nextBalance,
    });
    return buildResult(movement, null, nextBalance, false, null, updatedHold);
  });
}

export async function inspectInventoryReceipt(input: InspectInventoryReceiptInput): Promise<InventoryOperationResult> {
  const qcKey = `inventory:qc:${input.idempotencyKey}`;
  const passKey = `${qcKey}:pass`;
  const failKey = `${qcKey}:fail`;

  return withTransaction(async (client) => {
    await lockCommand(client, qcKey);
    const receiptUsingKey = await findReceiptByQcKey(client, input.idempotencyKey);
    if (receiptUsingKey && receiptUsingKey.id !== input.receiptId) {
      throw new InventoryIdempotencyConflictError();
    }
    const receipt = await findReceiptById(client, input.receiptId, true);
    if (!receipt) {
      throw new InventoryNotFoundError();
    }

    if (receipt.qc_idempotency_key === input.idempotencyKey) {
      if (
        receipt.quantity_accepted !== input.acceptedQuantity
        || receipt.quantity_rejected !== input.rejectedQuantity
      ) {
        throw new InventoryIdempotencyConflictError();
      }
      const replayMovements = await findMovements(client, [
        input.acceptedQuantity > 0 ? passKey : null,
        input.rejectedQuantity > 0 ? failKey : null,
      ]);
      if (replayMovements.length !== Number(input.acceptedQuantity > 0) + Number(input.rejectedQuantity > 0)) {
        throw new InventoryIntegrityError();
      }
      const context = await loadContext(client, receipt.variant_id, receipt.location_id);
      const balance = await lockOrCreateBalance(
        client,
        context,
        receipt.location_id,
        receipt.source_supplier_id,
      );
      return buildResult(replayMovements, null, balance, true, receipt);
    }
    if (receipt.status !== "pending_qc") {
      throw new InventoryStateError();
    }
    if (input.acceptedQuantity + input.rejectedQuantity !== receipt.quantity_received) {
      throw new InventoryStateError();
    }

    const context = await loadContext(client, receipt.variant_id, receipt.location_id);
    assertSource(context, receipt.source_supplier_id);
    const balance = await lockOrCreateBalance(
      client,
      context,
      receipt.location_id,
      receipt.source_supplier_id,
    );
    if (balance.unavailable_quantity < receipt.quantity_received) {
      throw new InventoryIntegrityError();
    }

    const nextBalance = assertBalance({
      onHandQuantity: balance.on_hand_quantity - input.rejectedQuantity,
      reservedQuantity: balance.reserved_quantity,
      unavailableQuantity: balance.unavailable_quantity - receipt.quantity_received,
    });
    await updateBalance(client, balance.id, nextBalance);
    const acceptedBalance = input.acceptedQuantity > 0
      ? assertBalance({
        onHandQuantity: balance.on_hand_quantity,
        reservedQuantity: balance.reserved_quantity,
        unavailableQuantity: balance.unavailable_quantity - input.acceptedQuantity,
      })
      : nextBalance;
    const movements: MovementRow[] = [];
    if (input.acceptedQuantity > 0) {
      movements.push(await insertMovement(client, {
        productId: context.productId,
        variantId: context.variantId,
        locationId: receipt.location_id,
        sourceSupplierId: receipt.source_supplier_id,
        movementType: "qc_pass",
        quantityDelta: 0,
        reservedDelta: 0,
        unavailableDelta: -input.acceptedQuantity,
        balance: acceptedBalance,
        idempotencyKey: passKey,
        actorUserId: input.actorUserId,
        reason: input.reason ?? "Quality inspection accepted inventory",
        referenceType: "inventory_receipt",
        referenceId: receipt.id,
        requestId: input.requestId,
      }));
    }
    if (input.rejectedQuantity > 0) {
      movements.push(await insertMovement(client, {
        productId: context.productId,
        variantId: context.variantId,
        locationId: receipt.location_id,
        sourceSupplierId: receipt.source_supplier_id,
        movementType: "qc_fail",
        quantityDelta: -input.rejectedQuantity,
        reservedDelta: 0,
        unavailableDelta: -input.rejectedQuantity,
        balance: nextBalance,
        idempotencyKey: failKey,
        actorUserId: input.actorUserId,
        reason: input.reason ?? "Quality inspection rejected inventory",
        referenceType: "inventory_receipt",
        referenceId: receipt.id,
        requestId: input.requestId,
      }));
    }

    const status: InventoryReceipt["status"] = input.rejectedQuantity === 0
      ? "accepted"
      : input.acceptedQuantity === 0
        ? "rejected"
        : "partially_rejected";
    const updatedReceipt = await updateReceiptQc(client, receipt.id, {
      status,
      acceptedQuantity: input.acceptedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      qcIdempotencyKey: input.idempotencyKey,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
    });
    if (updatedReceipt.shipment_item_id) {
      await markShipmentItemQc(
        client,
        updatedReceipt.shipment_item_id,
        input.acceptedQuantity,
        input.rejectedQuantity,
      );
      await refreshShipmentStatus(client, updatedReceipt.shipment_id);
    }
    for (const movement of movements) {
      await appendInventoryAudit(client, {
        actorUserId: input.actorUserId,
        action: movement.movement_type === "qc_pass" ? "inventory.qc_passed" : "inventory.qc_failed",
        resourceType: "inventory_movement",
        resourceId: movement.id,
        reason: input.reason ?? null,
        requestId: input.requestId,
        afterState: movement.movement_type === "qc_pass" ? acceptedBalance : nextBalance,
      });
    }

    return buildResult(movements, null, nextBalance, false, updatedReceipt);
  });
}

export async function reserveInventory(input: ReserveInventoryInput): Promise<InventoryOperationResult> {
  return withTransaction(async (client) => {
    await lockCommand(client, `inventory:reserve:${input.idempotencyKey}`);
    const existingReservation = await findReservation(client, input.idempotencyKey);
    const context = await loadContext(client, input.variantId, input.locationId);
    assertSource(context, input.sourceSupplierId);
    const balance = await lockOrCreateBalance(client, context, input.locationId, input.sourceSupplierId);
    if (existingReservation) {
      assertReservationMatches(existingReservation, context, input.locationId, input.sourceSupplierId, input.quantity);
      const existingMovement = await findMovement(client, `inventory:reserve:${input.idempotencyKey}`);
      if (!existingMovement) {
        throw new InventoryIntegrityError();
      }
      return buildResult(existingMovement, existingReservation, balance, true);
    }
    if (context.productStatus !== "active" || (context.ownerType === "supplier" && context.supplierStatus !== "approved")) {
      throw new InventoryNotAvailableError();
    }

    const available = balance.on_hand_quantity - balance.reserved_quantity - balance.unavailable_quantity;
    if (available < input.quantity) {
      throw new InventoryInsufficientError(input.quantity, available);
    }

    const nextBalance = assertBalance({
      onHandQuantity: balance.on_hand_quantity,
      reservedQuantity: balance.reserved_quantity + input.quantity,
      unavailableQuantity: balance.unavailable_quantity,
    });
    await updateBalance(client, balance.id, nextBalance);
    const movement = await insertMovement(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      movementType: "reserve",
      quantityDelta: 0,
      reservedDelta: input.quantity,
      unavailableDelta: 0,
      balance: nextBalance,
      idempotencyKey: `inventory:reserve:${input.idempotencyKey}`,
      actorUserId: input.actorUserId,
      reason: "Inventory reservation",
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      requestId: input.requestId,
    });
    const reservation = await insertReservation(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: input.locationId,
      sourceSupplierId: input.sourceSupplierId,
      quantity: input.quantity,
      idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      actorUserId: input.actorUserId,
    });
    await appendInventoryAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.reserved",
      resourceType: "inventory_reservation",
      resourceId: reservation.id,
      reason: "Inventory reservation",
      requestId: input.requestId,
      afterState: nextBalance,
    });

    return buildResult(movement, reservation, nextBalance, false);
  });
}

export async function releaseInventoryReservation(input: ReleaseInventoryInput): Promise<InventoryOperationResult> {
  const movementKey = `inventory:release:${input.idempotencyKey}`;

  return withTransaction(async (client) => {
    await lockCommand(client, movementKey);
    const existingMovement = await findMovement(client, movementKey);
    const reservation = await findReservationById(client, input.reservationId, true);
    if (!reservation) {
      throw new InventoryNotFoundError();
    }
    if (reservation.status !== "active") {
      if (existingMovement && reservation.status === "released") {
        const context = await loadContext(client, reservation.variant_id, reservation.location_id);
        const balance = await lockOrCreateBalance(
          client,
          context,
          reservation.location_id,
          reservation.source_supplier_id,
        );
        return buildResult(existingMovement, reservation, balance, true);
      }
      throw new InventoryStateError();
    }

    const context = await loadContext(client, reservation.variant_id, reservation.location_id);
    assertSource(context, reservation.source_supplier_id);
    const balance = await lockOrCreateBalance(client, context, reservation.location_id, reservation.source_supplier_id);
    if (balance.reserved_quantity < reservation.quantity) {
      throw new InventoryIntegrityError();
    }

    if (existingMovement) {
      throw new InventoryIntegrityError();
    }

    const nextBalance = assertBalance({
      onHandQuantity: balance.on_hand_quantity,
      reservedQuantity: balance.reserved_quantity - reservation.quantity,
      unavailableQuantity: balance.unavailable_quantity,
    });
    await updateBalance(client, balance.id, nextBalance);
    const movement = await insertMovement(client, {
      productId: context.productId,
      variantId: context.variantId,
      locationId: reservation.location_id,
      sourceSupplierId: reservation.source_supplier_id,
      movementType: "release",
      quantityDelta: 0,
      reservedDelta: -reservation.quantity,
      unavailableDelta: 0,
      balance: nextBalance,
      idempotencyKey: movementKey,
      actorUserId: input.actorUserId,
      reason: input.reason ?? "Inventory reservation released",
      referenceType: "inventory_reservation",
      referenceId: reservation.id,
      requestId: input.requestId,
    });
    await client.query(
      `UPDATE inventory_reservations
          SET status = 'released', released_at = now(), updated_at = now()
        WHERE id = $1`,
      [reservation.id],
    );
    await appendInventoryAudit(client, {
      actorUserId: input.actorUserId,
      action: "inventory.reservation_released",
      resourceType: "inventory_reservation",
      resourceId: reservation.id,
      reason: input.reason ?? "Inventory reservation released",
      requestId: input.requestId,
      afterState: nextBalance,
    });

    return buildResult(
      movement,
      { ...reservation, status: "released" },
      nextBalance,
      false,
    );
  });
}

async function lockShipmentItemForReceive(
  client: PoolClient,
  shipmentId: string,
  variantId: string,
  sourceSupplierId: string | null,
  quantity: number,
): Promise<ShipmentItemRow> {
  const result = await client.query<ShipmentItemRow>(
    `SELECT i.id, i.shipment_id, i.product_id, i.variant_id,
            s.source_supplier_id, s.status AS shipment_status,
            i.expected_quantity, i.received_quantity,
            i.accepted_quantity, i.rejected_quantity, i.status
       FROM inbound_shipment_items i
       INNER JOIN inbound_shipments s ON s.id = i.shipment_id
      WHERE i.shipment_id = $1
        AND i.variant_id = $2
      FOR UPDATE`,
    [shipmentId, variantId],
  );
  const item = result.rows[0];
  if (!item || item.source_supplier_id !== sourceSupplierId) {
    throw new InventorySourceMismatchError();
  }
  if (item.shipment_status === "cancelled") {
    throw new InventoryStateError();
  }
  if (item.status === "completed") {
    throw new InventoryStateError();
  }
  if (item.received_quantity + quantity > item.expected_quantity) {
    throw new InventoryInsufficientError(quantity, item.expected_quantity - item.received_quantity);
  }
  return item;
}

async function markShipmentItemReceived(client: PoolClient, itemId: string, quantity: number): Promise<void> {
  await client.query(
    `UPDATE inbound_shipment_items
        SET received_quantity = received_quantity + $2,
            status = CASE
              WHEN received_quantity + $2 = expected_quantity THEN 'received'
              ELSE 'partially_received'
            END,
            updated_at = now()
      WHERE id = $1`,
    [itemId, quantity],
  );
}

async function markShipmentItemQc(
  client: PoolClient,
  itemId: string,
  acceptedQuantity: number,
  rejectedQuantity: number,
): Promise<void> {
  await client.query(
    `UPDATE inbound_shipment_items
        SET accepted_quantity = accepted_quantity + $2,
            rejected_quantity = rejected_quantity + $3,
            status = CASE
              WHEN accepted_quantity + $2 + rejected_quantity + $3 = expected_quantity THEN 'completed'
              ELSE status
            END,
            updated_at = now()
      WHERE id = $1`,
    [itemId, acceptedQuantity, rejectedQuantity],
  );
}

async function refreshShipmentStatus(client: PoolClient, shipmentId: string | null): Promise<void> {
  if (!shipmentId) return;
  const result = await client.query<{ status: InboundShipmentRecord["status"] }>(
    `SELECT CASE
       WHEN bool_and(status = 'completed') THEN 'received'
       WHEN bool_or(received_quantity > 0) THEN 'partially_received'
       ELSE 'expected'
     END AS status
       FROM inbound_shipment_items
      WHERE shipment_id = $1`,
    [shipmentId],
  );
  const status = result.rows[0]?.status ?? "expected";
  await client.query(
    `UPDATE inbound_shipments SET status = $2, updated_at = now() WHERE id = $1`,
    [shipmentId, status],
  );
}

async function loadContext(
  client: PoolClient,
  variantId: string,
  locationId: string,
): Promise<InventoryContext> {
  const result = await client.query<InventoryContext>(
    `SELECT
       p.id AS "productId",
       v.id AS "variantId",
       p.owner_type AS "ownerType",
       p.status AS "productStatus",
       p.supplier_id AS "productSupplierId",
       s.status AS "supplierStatus"
     FROM product_variants v
     INNER JOIN products p ON p.id = v.product_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     INNER JOIN warehouse_locations l ON l.id = $2
     INNER JOIN warehouses w ON w.id = l.warehouse_id
     WHERE v.id = $1
       AND l.status = 'active'
       AND w.status = 'active'
     LIMIT 1`,
    [variantId, locationId],
  );
  const context = result.rows[0];
  if (!context) {
    throw new InventoryNotFoundError();
  }
  return context;
}

function assertSource(context: InventoryContext, sourceSupplierId: string | null): void {
  if (
    (context.ownerType === "platform" && sourceSupplierId !== null)
    || (context.ownerType === "supplier" && sourceSupplierId !== context.productSupplierId)
  ) {
    throw new InventorySourceMismatchError();
  }
}

async function lockCommand(client: PoolClient, key: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
}

async function lockOrCreateBalance(
  client: PoolClient,
  context: InventoryContext,
  locationId: string,
  sourceSupplierId: string | null,
): Promise<BalanceRow> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`inventory-balance:${context.variantId}:${locationId}:${sourceSupplierId ?? "platform"}`],
  );
  const existing = await selectBalance(client, context.variantId, locationId, sourceSupplierId);
  if (existing) {
    return existing;
  }

  await client.query(
    `INSERT INTO inventory_balances
       (id, product_id, variant_id, location_id, source_supplier_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), context.productId, context.variantId, locationId, sourceSupplierId],
  );
  const created = await selectBalance(client, context.variantId, locationId, sourceSupplierId);
  if (!created) {
    throw new InventoryIntegrityError();
  }
  return created;
}

async function selectBalance(
  client: PoolClient,
  variantId: string,
  locationId: string,
  sourceSupplierId: string | null,
): Promise<BalanceRow | null> {
  const result = await client.query<BalanceRow>(
    `SELECT id, on_hand_quantity, reserved_quantity, unavailable_quantity
       FROM inventory_balances
      WHERE variant_id = $1
        AND location_id = $2
        AND source_supplier_id IS NOT DISTINCT FROM $3::uuid
      FOR UPDATE`,
    [variantId, locationId, sourceSupplierId],
  );
  return result.rows[0] ?? null;
}

function assertBalance(input: Omit<InventoryBalance, "availableQuantity">): InventoryBalance {
  const available = input.onHandQuantity - input.reservedQuantity - input.unavailableQuantity;
  if (
    input.onHandQuantity < 0
    || input.reservedQuantity < 0
    || input.unavailableQuantity < 0
    || available < 0
  ) {
    throw new InventoryIntegrityError();
  }
  return { ...input, availableQuantity: available };
}

async function updateBalance(client: PoolClient, id: string, balance: InventoryBalance): Promise<void> {
  await client.query(
    `UPDATE inventory_balances
        SET on_hand_quantity = $2,
            reserved_quantity = $3,
            unavailable_quantity = $4,
            updated_at = now()
      WHERE id = $1`,
    [id, balance.onHandQuantity, balance.reservedQuantity, balance.unavailableQuantity],
  );
}

async function findMovement(client: PoolClient, idempotencyKey: string): Promise<MovementRow | null> {
  const result = await client.query<MovementRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            movement_type, quantity_delta, reserved_delta, unavailable_delta, idempotency_key
       FROM inventory_movements
      WHERE idempotency_key = $1
      LIMIT 1`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function assertMovementMatches(
  movement: MovementRow,
  context: InventoryContext,
  locationId: string,
  sourceSupplierId: string | null,
  movementType: string,
  quantity: number,
): void {
  if (
    movement.product_id !== context.productId
    || movement.variant_id !== context.variantId
    || movement.location_id !== locationId
    || movement.source_supplier_id !== sourceSupplierId
    || movement.movement_type !== movementType
    || movement.quantity_delta !== quantity
  ) {
    throw new InventoryIdempotencyConflictError();
  }
}

async function insertMovement(
  client: PoolClient,
  input: {
    productId: string;
    variantId: string;
    locationId: string;
    sourceSupplierId: string | null;
    movementType: string;
    quantityDelta: number;
    reservedDelta: number;
    unavailableDelta: number;
    balance: InventoryBalance;
    idempotencyKey: string;
    actorUserId: string;
    reason: string | null;
    referenceType: string | null;
    referenceId: string | null;
    requestId: string;
  },
): Promise<MovementRow> {
  const result = await client.query<MovementRow>(
    `INSERT INTO inventory_movements
       (id, product_id, variant_id, location_id, source_supplier_id,
        movement_type, quantity_delta, reserved_delta, unavailable_delta,
        on_hand_after, reserved_after, unavailable_after, idempotency_key,
        reference_type, reference_id, actor_user_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
     RETURNING id, product_id, variant_id, location_id, source_supplier_id,
       movement_type, quantity_delta, reserved_delta, unavailable_delta, idempotency_key`,
    [
      randomUUID(),
      input.productId,
      input.variantId,
      input.locationId,
      input.sourceSupplierId,
      input.movementType,
      input.quantityDelta,
      input.reservedDelta,
      input.unavailableDelta,
      input.balance.onHandQuantity,
      input.balance.reservedQuantity,
      input.balance.unavailableQuantity,
      input.idempotencyKey,
      input.referenceType,
      input.referenceId,
      input.actorUserId,
      input.reason,
      JSON.stringify({ requestId: input.requestId }),
    ],
  );
  return result.rows[0];
}

async function findReceiptByKey(client: PoolClient, idempotencyKey: string): Promise<ReceiptRow | null> {
  const result = await client.query<ReceiptRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id, shipment_id, shipment_item_id,
            quantity_received, quantity_accepted, quantity_rejected,
            status, idempotency_key, qc_idempotency_key
       FROM inventory_receipts
      WHERE idempotency_key = $1
      LIMIT 1
      FOR UPDATE`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findReceiptByQcKey(client: PoolClient, qcIdempotencyKey: string): Promise<ReceiptRow | null> {
  const result = await client.query<ReceiptRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id, shipment_id, shipment_item_id,
            quantity_received, quantity_accepted, quantity_rejected,
            status, idempotency_key, qc_idempotency_key
       FROM inventory_receipts
      WHERE qc_idempotency_key = $1
      LIMIT 1`,
    [qcIdempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findReceiptById(
  client: PoolClient,
  receiptId: string,
  lock: boolean,
): Promise<ReceiptRow | null> {
  const result = await client.query<ReceiptRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id, shipment_id, shipment_item_id,
            quantity_received, quantity_accepted, quantity_rejected,
            status, idempotency_key, qc_idempotency_key
       FROM inventory_receipts
      WHERE id = $1
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [receiptId],
  );
  return result.rows[0] ?? null;
}

async function findMovements(client: PoolClient, idempotencyKeys: Array<string | null>): Promise<MovementRow[]> {
  const keys = idempotencyKeys.filter((key): key is string => Boolean(key));
  if (keys.length === 0) return [];
  const result = await client.query<MovementRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            movement_type, quantity_delta, reserved_delta, unavailable_delta, idempotency_key
       FROM inventory_movements
      WHERE idempotency_key = ANY($1::text[])
      ORDER BY created_at ASC`,
    [keys],
  );
  return result.rows;
}

function assertReceiptMatches(
  receipt: ReceiptRow,
  context: InventoryContext,
  locationId: string,
  sourceSupplierId: string | null,
  quantity: number,
  shipmentId: string | null,
): void {
  if (
    receipt.product_id !== context.productId
    || receipt.variant_id !== context.variantId
    || receipt.location_id !== locationId
    || receipt.source_supplier_id !== sourceSupplierId
    || receipt.shipment_id !== shipmentId
    || receipt.quantity_received !== quantity
  ) {
    throw new InventoryIdempotencyConflictError();
  }
}

async function insertReceipt(
  client: PoolClient,
  input: {
    productId: string;
    variantId: string;
    locationId: string;
    sourceSupplierId: string | null;
    quantity: number;
    idempotencyKey: string;
    actorUserId: string;
    shipmentId: string | null;
    shipmentItemId: string | null;
  },
): Promise<ReceiptRow> {
  const result = await client.query<ReceiptRow>(
    `INSERT INTO inventory_receipts
       (id, product_id, variant_id, location_id, source_supplier_id,
        quantity_received, idempotency_key, received_by, shipment_id, shipment_item_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, product_id, variant_id, location_id, source_supplier_id, shipment_id, shipment_item_id,
       quantity_received, quantity_accepted, quantity_rejected,
       status, idempotency_key, qc_idempotency_key`,
    [
      randomUUID(),
      input.productId,
      input.variantId,
      input.locationId,
      input.sourceSupplierId,
      input.quantity,
      input.idempotencyKey,
      input.actorUserId,
      input.shipmentId,
      input.shipmentItemId,
    ],
  );
  return result.rows[0];
}

async function updateReceiptQc(
  client: PoolClient,
  receiptId: string,
  input: {
    status: InventoryReceipt["status"];
    acceptedQuantity: number;
    rejectedQuantity: number;
    qcIdempotencyKey: string;
    actorUserId: string;
    reason: string | null;
  },
): Promise<ReceiptRow> {
  const result = await client.query<ReceiptRow>(
    `UPDATE inventory_receipts
        SET quantity_accepted = $2,
            quantity_rejected = $3,
            status = $4,
            qc_idempotency_key = $5,
            qc_by = $6,
            qc_reason = $7,
            inspected_at = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING id, product_id, variant_id, location_id, source_supplier_id, shipment_id, shipment_item_id,
        quantity_received, quantity_accepted, quantity_rejected,
        status, idempotency_key, qc_idempotency_key`,
    [
      receiptId,
      input.acceptedQuantity,
      input.rejectedQuantity,
      input.status,
      input.qcIdempotencyKey,
      input.actorUserId,
      input.reason,
    ],
  );
  if (!result.rows[0]) throw new InventoryIntegrityError();
  return result.rows[0];
}

async function findTransfer(client: PoolClient, idempotencyKey: string): Promise<TransferRow | null> {
  const result = await client.query<TransferRow>(
    `SELECT id, product_id, variant_id, source_location_id,
            destination_location_id, source_supplier_id, quantity, idempotency_key
       FROM inventory_transfers
      WHERE idempotency_key = $1
      LIMIT 1
      FOR UPDATE`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function assertTransferMatches(transfer: TransferRow, input: TransferInventoryInput): void {
  if (
    transfer.variant_id !== input.variantId
    || transfer.source_location_id !== input.sourceLocationId
    || transfer.destination_location_id !== input.destinationLocationId
    || transfer.source_supplier_id !== input.sourceSupplierId
    || transfer.quantity !== input.quantity
  ) {
    throw new InventoryIdempotencyConflictError();
  }
}

async function insertTransfer(
  client: PoolClient,
  input: {
    productId: string;
    variantId: string;
    sourceLocationId: string;
    destinationLocationId: string;
    sourceSupplierId: string | null;
    quantity: number;
    idempotencyKey: string;
    actorUserId: string;
    reason: string;
  },
): Promise<TransferRow> {
  const result = await client.query<TransferRow>(
    `INSERT INTO inventory_transfers
       (id, product_id, variant_id, source_location_id, destination_location_id,
        source_supplier_id, quantity, idempotency_key, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, product_id, variant_id, source_location_id,
       destination_location_id, source_supplier_id, quantity, idempotency_key`,
    [
      randomUUID(),
      input.productId,
      input.variantId,
      input.sourceLocationId,
      input.destinationLocationId,
      input.sourceSupplierId,
      input.quantity,
      input.idempotencyKey,
      input.actorUserId,
      input.reason,
    ],
  );
  return result.rows[0];
}

async function findHoldByKey(client: PoolClient, idempotencyKey: string): Promise<HoldRow | null> {
  const result = await client.query<HoldRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            quantity, status, idempotency_key, release_idempotency_key
       FROM inventory_holds
      WHERE idempotency_key = $1
      LIMIT 1
      FOR UPDATE`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findHoldByReleaseKey(client: PoolClient, releaseIdempotencyKey: string): Promise<HoldRow | null> {
  const result = await client.query<HoldRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            quantity, status, idempotency_key, release_idempotency_key
       FROM inventory_holds
      WHERE release_idempotency_key = $1
      LIMIT 1
      FOR UPDATE`,
    [releaseIdempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findHoldById(client: PoolClient, holdId: string, lock: boolean): Promise<HoldRow | null> {
  const result = await client.query<HoldRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            quantity, status, idempotency_key, release_idempotency_key
       FROM inventory_holds
      WHERE id = $1
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [holdId],
  );
  return result.rows[0] ?? null;
}

function assertHoldMatches(
  hold: HoldRow,
  context: InventoryContext,
  locationId: string,
  sourceSupplierId: string | null,
  quantity: number,
): void {
  if (
    hold.product_id !== context.productId
    || hold.variant_id !== context.variantId
    || hold.location_id !== locationId
    || hold.source_supplier_id !== sourceSupplierId
    || hold.quantity !== quantity
  ) {
    throw new InventoryIdempotencyConflictError();
  }
}

async function insertHold(
  client: PoolClient,
  input: {
    productId: string;
    variantId: string;
    locationId: string;
    sourceSupplierId: string | null;
    quantity: number;
    idempotencyKey: string;
    actorUserId: string;
    reason: string;
  },
): Promise<HoldRow> {
  const result = await client.query<HoldRow>(
    `INSERT INTO inventory_holds
       (id, product_id, variant_id, location_id, source_supplier_id,
        quantity, idempotency_key, actor_user_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, product_id, variant_id, location_id, source_supplier_id,
       quantity, status, idempotency_key, release_idempotency_key`,
    [
      randomUUID(),
      input.productId,
      input.variantId,
      input.locationId,
      input.sourceSupplierId,
      input.quantity,
      input.idempotencyKey,
      input.actorUserId,
      input.reason,
    ],
  );
  return result.rows[0];
}

async function updateHoldReleased(client: PoolClient, holdId: string, input: ReleaseInventoryHoldInput): Promise<HoldRow> {
  const result = await client.query<HoldRow>(
    `UPDATE inventory_holds
        SET status = 'released',
            release_idempotency_key = $2,
            released_by = $3,
            released_at = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING id, product_id, variant_id, location_id, source_supplier_id,
        quantity, status, idempotency_key, release_idempotency_key`,
    [holdId, input.idempotencyKey, input.actorUserId],
  );
  if (!result.rows[0]) throw new InventoryIntegrityError();
  return result.rows[0];
}

async function findReservation(client: PoolClient, idempotencyKey: string): Promise<ReservationRow | null> {
  const result = await client.query<ReservationRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            quantity, status, idempotency_key
       FROM inventory_reservations
      WHERE idempotency_key = $1
      LIMIT 1
      FOR UPDATE`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function findReservationById(
  client: PoolClient,
  reservationId: string,
  lock: boolean,
): Promise<ReservationRow | null> {
  const result = await client.query<ReservationRow>(
    `SELECT id, product_id, variant_id, location_id, source_supplier_id,
            quantity, status, idempotency_key
       FROM inventory_reservations
      WHERE id = $1
      LIMIT 1
      ${lock ? "FOR UPDATE" : ""}`,
    [reservationId],
  );
  return result.rows[0] ?? null;
}

function assertReservationMatches(
  reservation: ReservationRow,
  context: InventoryContext,
  locationId: string,
  sourceSupplierId: string | null,
  quantity: number,
): void {
  if (
    reservation.product_id !== context.productId
    || reservation.variant_id !== context.variantId
    || reservation.location_id !== locationId
    || reservation.source_supplier_id !== sourceSupplierId
    || reservation.quantity !== quantity
  ) {
    throw new InventoryIdempotencyConflictError();
  }
}

async function insertReservation(
  client: PoolClient,
  input: {
    productId: string;
    variantId: string;
    locationId: string;
    sourceSupplierId: string | null;
    quantity: number;
    idempotencyKey: string;
    referenceType: string | null;
    referenceId: string | null;
    actorUserId: string;
  },
): Promise<ReservationRow> {
  const result = await client.query<ReservationRow>(
    `INSERT INTO inventory_reservations
       (id, product_id, variant_id, location_id, source_supplier_id,
        quantity, idempotency_key, reference_type, reference_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, product_id, variant_id, location_id, source_supplier_id,
       quantity, status, idempotency_key`,
    [
      randomUUID(),
      input.productId,
      input.variantId,
      input.locationId,
      input.sourceSupplierId,
      input.quantity,
      input.idempotencyKey,
      input.referenceType,
      input.referenceId,
      input.actorUserId,
    ],
  );
  return result.rows[0];
}

async function appendSimpleAudit(
  client: PoolClient,
  input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    requestId: string;
    afterState: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, resource_type, resource_id, after_state, request_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.afterState),
      input.requestId,
    ],
  );
}

async function appendInventoryAudit(
  client: PoolClient,
  input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    reason: string | null;
    requestId: string;
    afterState: InventoryBalance;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, resource_type, resource_id, after_state, reason, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.resourceType,
      input.resourceId,
      JSON.stringify(input.afterState),
      input.reason,
      input.requestId,
      JSON.stringify({ source: "inventory-repository" }),
    ],
  );
}

function toBalance(row: BalanceRow): InventoryBalance {
  return assertBalance({
    onHandQuantity: row.on_hand_quantity,
    reservedQuantity: row.reserved_quantity,
    unavailableQuantity: row.unavailable_quantity,
  });
}

function toMovement(row: MovementRow): InventoryMovement {
  return {
    id: row.id,
    movementType: row.movement_type,
    idempotencyKey: row.idempotency_key,
  };
}

function toHold(row: HoldRow): InventoryHold {
  return {
    id: row.id,
    variantId: row.variant_id,
    locationId: row.location_id,
    sourceSupplierId: row.source_supplier_id,
    quantity: row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    releaseIdempotencyKey: row.release_idempotency_key,
  };
}

function toReservation(row: ReservationRow): InventoryReservation {
  return {
    id: row.id,
    variantId: row.variant_id,
    locationId: row.location_id,
    sourceSupplierId: row.source_supplier_id,
    quantity: row.quantity,
    status: row.status,
    idempotencyKey: row.idempotency_key,
  };
}

function toReceipt(row: ReceiptRow): InventoryReceipt {
  return {
    id: row.id,
    variantId: row.variant_id,
    locationId: row.location_id,
    sourceSupplierId: row.source_supplier_id,
    shipmentId: row.shipment_id,
    shipmentItemId: row.shipment_item_id,
    quantityReceived: row.quantity_received,
    quantityAccepted: row.quantity_accepted,
    quantityRejected: row.quantity_rejected,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    qcIdempotencyKey: row.qc_idempotency_key,
  };
}

function buildResult(
  movements: MovementRow | MovementRow[],
  reservation: ReservationRow | null,
  balance: BalanceRow | InventoryBalance,
  idempotentReplay: boolean,
  receipt: ReceiptRow | null = null,
  hold: HoldRow | null = null,
): InventoryOperationResult {
  const movementRows = Array.isArray(movements) ? movements : [movements];
  return {
    movement: toMovement(movementRows[0]),
    movements: movementRows.map(toMovement),
    reservation: reservation ? toReservation(reservation) : null,
    receipt: receipt ? toReceipt(receipt) : null,
    hold: hold ? toHold(hold) : null,
    balance: "on_hand_quantity" in balance ? toBalance(balance) : balance,
    idempotentReplay,
  };
}
