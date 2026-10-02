import { z } from "zod";

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(1).max(200);
const quantity = z.number().int().positive().max(1_000_000);

export const receiveInventorySchema = z.object({
  variantId: uuid,
  locationId: uuid,
  sourceSupplierId: uuid.nullable().default(null),
  shipmentId: uuid.nullable().default(null),
  quantity,
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const reserveInventorySchema = z.object({
  variantId: uuid,
  locationId: uuid,
  sourceSupplierId: uuid.nullable().default(null),
  quantity,
  idempotencyKey,
  referenceType: z.string().trim().min(1).max(80).nullable().optional(),
  referenceId: z.string().trim().min(1).max(200).nullable().optional(),
});

export const reserveInventoryBatchSchema = z.object({
  idempotencyKey,
  referenceType: z.string().trim().min(1).max(80).nullable().optional(),
  referenceId: z.string().trim().min(1).max(200).nullable().optional(),
  reason: z.string().trim().min(1).max(1000),
  lines: z.array(z.object({
    variantId: uuid,
    locationId: uuid,
    sourceSupplierId: uuid.nullable(),
    lineReference: z.string().trim().min(1).max(200).nullable().default(null),
    quantity,
  })).min(1).max(100).superRefine((lines, context) => {
    const keys = new Set<string>();
    for (const line of lines) {
      const key = `${line.variantId}:${line.locationId}:${line.sourceSupplierId ?? "platform"}`;
      if (keys.has(key)) {
        context.addIssue({ code: "custom", message: "Each inventory balance may appear only once per batch." });
      }
      keys.add(key);
    }
  }),
});

export const releaseInventoryBatchSchema = z.object({
  batchId: uuid,
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const createInboundShipmentSchema = z.object({
  sourceSupplierId: uuid.nullable().default(null),
  referenceCode: z.string().trim().min(1).max(120),
  expectedAt: z.string().datetime({ offset: true }).nullable().optional(),
  items: z.array(z.object({
    variantId: uuid,
    expectedQuantity: quantity,
  })).min(1).max(100).superRefine((items, context) => {
    const variants = new Set<string>();
    for (const item of items) {
      if (variants.has(item.variantId)) {
        context.addIssue({ code: "custom", message: "Each variant may appear only once per shipment." });
      }
      variants.add(item.variantId);
    }
  }),
});

export const adjustInventorySchema = z.object({
  variantId: uuid,
  locationId: uuid,
  sourceSupplierId: uuid.nullable().default(null),
  quantityDelta: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, "Quantity delta cannot be zero."),
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000),
});

export const placeInventoryHoldSchema = z.object({
  variantId: uuid,
  locationId: uuid,
  sourceSupplierId: uuid.nullable().default(null),
  quantity,
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000),
});

export const releaseInventoryHoldSchema = z.object({
  holdId: uuid,
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const transferInventorySchema = z.object({
  variantId: uuid,
  sourceLocationId: uuid,
  destinationLocationId: uuid,
  sourceSupplierId: uuid.nullable().default(null),
  quantity,
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000),
}).refine((value) => value.sourceLocationId !== value.destinationLocationId, {
  message: "Source and destination locations must differ.",
  path: ["destinationLocationId"],
});

export const inspectInventoryReceiptSchema = z.object({
  receiptId: uuid,
  acceptedQuantity: z.number().int().nonnegative().max(1_000_000),
  rejectedQuantity: z.number().int().nonnegative().max(1_000_000),
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const releaseInventorySchema = z.object({
  reservationId: uuid,
  idempotencyKey,
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
});

export type ReceiveInventoryInput = z.infer<typeof receiveInventorySchema> & {
  actorUserId: string;
  requestId: string;
};

export type ReserveInventoryInput = z.infer<typeof reserveInventorySchema> & {
  actorUserId: string;
  requestId: string;
};

export type ReserveInventoryBatchInput = z.infer<typeof reserveInventoryBatchSchema> & {
  actorUserId: string;
  requestId: string;
};

export type ReleaseInventoryBatchInput = z.infer<typeof releaseInventoryBatchSchema> & {
  actorUserId: string;
  requestId: string;
};

export type CreateInboundShipmentInput = z.infer<typeof createInboundShipmentSchema> & {
  actorUserId: string;
  requestId: string;
};

export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema> & {
  actorUserId: string;
  requestId: string;
};

export type PlaceInventoryHoldInput = z.infer<typeof placeInventoryHoldSchema> & {
  actorUserId: string;
  requestId: string;
};

export type ReleaseInventoryHoldInput = z.infer<typeof releaseInventoryHoldSchema> & {
  actorUserId: string;
  requestId: string;
};

export type TransferInventoryInput = z.infer<typeof transferInventorySchema> & {
  actorUserId: string;
  requestId: string;
};

export type InspectInventoryReceiptInput = z.infer<typeof inspectInventoryReceiptSchema> & {
  actorUserId: string;
  requestId: string;
};

export type ReleaseInventoryInput = z.infer<typeof releaseInventorySchema> & {
  actorUserId: string;
  requestId: string;
};
