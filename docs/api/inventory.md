# Warehouse and Inventory API

**Status:** Phase 4 inventory foundation. Inventory persistence and server-side movement services are implemented; receiving, QC, inbound shipment records, transfers, authorized adjustments, holds, and transactional multi-line reservation batches are available to authorized/internal services. Checkout, shipping, and customer-facing reservation routes remain intentionally out of scope.

## Invariants

- Inventory belongs to a shared product variant and a central warehouse location; Retail and Wholesale do not have duplicate stock systems.
- Supplier-owned product inventory must carry the owning Supplier as its source. Platform-owned inventory must have no supplier source.
- Supplier receiving requires the Supplier account to be approved. There is no Supplier endpoint that directly increments stock.
- Every balance mutation appends an immutable `inventory_movements` record with actor, reason/reference, idempotency key, and post-movement quantities.
- Receipt quantities enter `unavailable` stock first and cannot become available until final QC.
- Reservations lock the balance row in a transaction and calculate availability as `on hand - reserved - unavailable`.
- A reservation batch carries an idempotency key and SHA-256 command fingerprint. Reusing its key with different references, reason, explicit lines, source, location, or quantity returns a conflict.
- Batch lines must name their location and source supplier explicitly; no warehouse or supplier source is selected implicitly.
- Batch balance locks are acquired in deterministic variant/location/source order. A failed line rolls back the entire batch, so no partial reservation remains.
- Receive, reserve, adjustment, hold, and release commands are idempotent. Reusing a key with different command data returns a conflict.
- Holds do not change on-hand quantity; they increase `unavailable_quantity`. Releasing a hold appends a compensating movement and returns that quantity to available stock.
- PostgreSQL advisory transaction locks serialize creation and mutation of the same variant/location/source balance; row locks protect existing balances.

## `POST /api/v1/warehouse/receipts`

Requires an active authenticated user with `inventory:receive` permission. Warehouse operators receive stock into a central active warehouse location.

Request:

```json
{
  "variantId": "uuid",
  "locationId": "uuid",
  "sourceSupplierId": null,
  "shipmentId": "shipment-uuid-or-null",
  "quantity": 12,
  "idempotencyKey": "receipt-2026-0001",
  "reason": "QC passed"
}
```

Responses:

- `201` — receipt movement and current balance were recorded; the receipt is `pending_qc` and received units are unavailable.
- `200` — the same idempotent receipt was replayed; no second movement was created.
- `400` — malformed JSON or bounded validation failure.
- `401` — authentication is required.
- `403` — the user lacks warehouse receiving permission.
- `409` — source mismatch, unavailable product/Supplier, or idempotency conflict.
- `503` — database or migration is unavailable.

## `POST /api/v1/warehouse/receipts/:receiptId/qc`

Requires an active authenticated user with `inventory:qc` permission. QC is a final split of the receipt into accepted and rejected quantities; the two quantities must equal the received quantity.

Request:

```json
{
  "acceptedQuantity": 10,
  "rejectedQuantity": 2,
  "idempotencyKey": "qc-2026-0001",
  "reason": "Two items damaged on arrival"
}
```

Responses:

- `201` — QC movements were appended and the receipt was finalized.
- `200` — the same QC command was replayed idempotently.
- `400` — malformed JSON or bounded validation failure.
- `401` — authentication is required.
- `403` — the user lacks QC permission.
- `404` — receipt does not exist.
- `409` — receipt state, quantity split, or idempotency conflict.
- `503` — database or migration is unavailable.

Accepted units become available; rejected units are removed from on-hand and unavailable quantities. Both outcomes remain in the movement ledger.

## `POST /api/v1/warehouse/inbound-shipments`

Requires `inventory:shipments:manage`. This creates an expected inbound shipment with bounded variant quantities. Supplier-owned items must match the approved Supplier source; platform-owned shipments use a null source Supplier.

```json
{
  "sourceSupplierId": "supplier-uuid-or-null",
  "referenceCode": "ASN-2026-0001",
  "expectedAt": "2026-10-10T09:00:00.000Z",
  "items": [
    { "variantId": "variant-uuid", "expectedQuantity": 24 }
  ]
}
```

Receipt commands may reference the shipment. Over-receiving a shipment item is rejected transactionally, and receipt/QC quantities update shipment item and shipment state.

## `POST /api/v1/warehouse/transfers`

Requires `inventory:transfer`. A transfer atomically appends paired `transfer_out` and `transfer_in` movements and updates two central warehouse balances. Locations are locked in deterministic order to avoid opposite-direction deadlocks.

```json
{
  "variantId": "variant-uuid",
  "sourceLocationId": "location-a",
  "destinationLocationId": "location-b",
  "sourceSupplierId": null,
  "quantity": 4,
  "idempotencyKey": "transfer-2026-0001",
  "reason": "Rebalance picking location"
}
```

A transfer cannot reduce source available quantity below zero and replaying its key does not duplicate either movement.

## `POST /api/v1/warehouse/adjustments`

Requires `inventory:adjust`. This records an authorized manual correction as one append-only movement. A positive delta increases on-hand stock; a negative delta can remove only currently available units and cannot consume reserved or held stock.

```json
{
  "variantId": "variant-uuid",
  "locationId": "location-uuid",
  "sourceSupplierId": null,
  "quantityDelta": -2,
  "idempotencyKey": "adjust-2026-0001",
  "reason": "Cycle count correction"
}
```

Responses are `201` for a new adjustment, `200` for an identical replay, `400` for bounded validation errors, `401`/`403` for authentication or permission failures, `404` for an unknown variant/location, `409` for source or idempotency conflicts/insufficient available quantity, and `503` when the database or migration is unavailable.

## `POST /api/v1/warehouse/holds`

Requires `inventory:hold`. This places a temporary hold against available quantity without changing on-hand quantity. Holds require an active product and, for Supplier-owned products, an approved Supplier.

```json
{
  "variantId": "variant-uuid",
  "locationId": "location-uuid",
  "sourceSupplierId": null,
  "quantity": 2,
  "idempotencyKey": "hold-2026-0001",
  "reason": "Warehouse quality review"
}
```

The response is `201` for a new hold and `200` for an identical replay. A hold that exceeds available quantity returns `409` and does not change the balance.

## `POST /api/v1/warehouse/holds/:holdId/release`

Requires `inventory:hold`. The path identifies the hold and the request carries a release idempotency key. Release is a one-way transition from `active` to `released`; it appends a `release_hold` movement and decreases unavailable quantity.

```json
{
  "idempotencyKey": "hold-release-2026-0001",
  "reason": "Review completed"
}
```

A repeated release key returns `200` without a second movement. Releasing an already released hold with a new key returns `409`. Unknown holds return `404`.

## Internal inventory services

The shared server module provides `reserveInventory` and `releaseInventoryReservation` for the future checkout/order services. They are not exposed as public routes yet, so a buyer cannot manufacture reservations without a validated order/checkout reference.

- `reserveInventory` requires an active product, approved Supplier when applicable, positive bounded quantity, and a unique idempotency key.
- Concurrent reservations lock the same balance and cannot make available quantity negative.
- `releaseInventoryReservation` only releases an active reservation and appends a compensating movement.
- Repeated reservation commands return the original reservation; repeated release commands are idempotent by release key.
- `reserveInventoryBatch` and `releaseInventoryBatch` are the multi-line internal boundaries. A batch has `active`/`released` lifecycle state and each reservation references the batch.
- `reserveInventoryBatch` validates every explicit line and creates all movements/reservations in one transaction. `releaseInventoryBatch` locks and releases every line in one transaction.
- `adjustInventory` appends a signed `adjust` movement under the same balance lock and rejects a negative correction that would consume reserved or unavailable units.
- `placeInventoryHold` and `releaseInventoryHold` use `hold`/`release_hold` movements; holds are a warehouse control primitive and are not customer reservations.

## Database contract

Migrations `0007_inventory.sql` through `0011_inventory_adjustments_holds.sql` add warehouses, locations, balance projections, append-oriented movements, reservations, inbound receipts/QC, shipment records, transfers, holds, owner/source triggers, indexes, audit metadata, and inventory permissions. Migration `0014_order_inventory_reservations.sql` adds the reservation-batch aggregate, batch linkage, and order reservation lifecycle fields. Balances are projections protected by transactional movement writes; business code must not update them outside the inventory module.

## Known limitations

- Warehouse/location administration UI, shipping, returns, and consumed-reservation transitions are not implemented.
- Holds do not yet have an automatic expiry job; release is an explicit authorized operation.
- Balance-row retention and movement archival policy must be defined before high-volume production use; movements are not hard-deleted by business operations.
- PostgreSQL integration and concurrency tests are conditional and skip locally when `DATABASE_URL` is absent.
- Pricing, currency, order references, shipping, and finance remain separate domains.
