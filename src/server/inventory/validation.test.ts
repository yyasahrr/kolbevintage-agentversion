import { describe, expect, it } from "vitest";
import {
  adjustInventorySchema,
  createInboundShipmentSchema,
  inspectInventoryReceiptSchema,
  placeInventoryHoldSchema,
  receiveInventorySchema,
  releaseInventoryHoldSchema,
  releaseInventorySchema,
  reserveInventorySchema,
  transferInventorySchema,
} from "@/server/inventory/validation";

describe("inventory validation", () => {
  it("accepts bounded receipt commands and defaults a platform source to null", () => {
    const result = receiveInventorySchema.safeParse({
      variantId: "11111111-1111-4111-8111-111111111111",
      locationId: "22222222-2222-4222-8222-222222222222",
      quantity: 12,
      idempotencyKey: "receipt-1",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sourceSupplierId).toBeNull();
  });

  it("rejects zero, fractional, or oversized quantities", () => {
    for (const quantity of [0, 1.5, 1_000_001]) {
      expect(reserveInventorySchema.safeParse({
        variantId: "11111111-1111-4111-8111-111111111111",
        locationId: "22222222-2222-4222-8222-222222222222",
        quantity,
        idempotencyKey: "reserve-1",
      }).success).toBe(false);
    }
  });

  it("rejects duplicate shipment variants and same-location transfers", () => {
    const variantId = "11111111-1111-4111-8111-111111111111";
    expect(createInboundShipmentSchema.safeParse({
      referenceCode: "ASN-1",
      items: [
        { variantId, expectedQuantity: 2 },
        { variantId, expectedQuantity: 3 },
      ],
    }).success).toBe(false);

    expect(transferInventorySchema.safeParse({
      variantId,
      sourceLocationId: "22222222-2222-4222-8222-222222222222",
      destinationLocationId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
      idempotencyKey: "transfer-1",
      reason: "Cycle count relocation",
    }).success).toBe(false);
  });

  it("requires a bounded final QC quantity split", () => {
    const result = inspectInventoryReceiptSchema.safeParse({
      receiptId: "33333333-3333-4333-8333-333333333333",
      acceptedQuantity: 4,
      rejectedQuantity: 1,
      idempotencyKey: "qc-1",
    });

    expect(result.success).toBe(true);
  });

  it("requires UUID reservation identifiers for release", () => {
    expect(releaseInventorySchema.safeParse({
      reservationId: "not-a-uuid",
      idempotencyKey: "release-1",
    }).success).toBe(false);
  });

  it("accepts signed adjustments and requires a reason for holds", () => {
    const base = {
      variantId: "11111111-1111-4111-8111-111111111111",
      locationId: "22222222-2222-4222-8222-222222222222",
    };
    expect(adjustInventorySchema.safeParse({
      ...base,
      quantityDelta: -3,
      idempotencyKey: "adjust-1",
      reason: "Cycle count correction",
    }).success).toBe(true);
    expect(placeInventoryHoldSchema.safeParse({
      ...base,
      quantity: 2,
      idempotencyKey: "hold-1",
    }).success).toBe(false);
    expect(releaseInventoryHoldSchema.safeParse({
      holdId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "hold-release-1",
    }).success).toBe(true);
  });
});
