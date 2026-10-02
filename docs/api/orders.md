# Order Foundation API Contract

**Status:** Phase 5 foundation. The shared order snapshot and state-transition service exist as internal server capabilities. No public checkout, payment, reservation, or order UI is exposed yet.

## Scope and boundaries

- Retail and Wholesale use one `orders` model and one state machine; `market` is a policy context, not a second backend.
- Order items persist immutable product, variant, seller, quantity, price, discount, tax, line-total, SKU, title, and attribute snapshots.
- Money is represented in integer minor units with an explicit three-letter currency.
- Wholesale order creation requires the buyer's active, time-valid server-side membership and stores its membership identifier as an order snapshot reference.
- Catalog and supplier public fields are revalidated server-side before an order is created. Supplier private fields are never copied into an order item snapshot.
- Every creation and state transition has an idempotency key, an append-only event, and an audit record.
- Inventory reservations, pricing calculation, payment authorization, shipping, and fulfillment provider calls are not faked by this foundation. Future checkout must call their explicit adapters/services before transitioning the order.

## Internal `createOrder`

`createOrder` is intentionally not a public route. It is the boundary for a future server-owned checkout service after pricing and reservation contracts are available.

The command contains:

- `market`: `retail` or `wholesale`.
- `wholesaleMembershipId`: required for Wholesale and checked against the buyer, account status, membership status, and active time window.
- `currency` plus integer-minor-unit subtotal, discount, tax, shipping, and total values.
- An idempotency key.
- One or more item snapshots. A variant may appear only once, and the line total must equal quantity times unit price minus discount plus tax.

Creation always starts at `draft` and appends a `draft` event. Replaying the same key and identical command returns the original snapshot; reusing it with another buyer or command fingerprint returns a conflict.

`createPricedOrder` is the stronger internal boundary: it calculates a versioned base-merchandise quote and creates the order in the same transaction. It currently records zero discount, tax, and shipping because those policies are not implemented; it does not reserve stock or authorize payment.

## Internal `transitionOrder`

A transition locks the order row, checks the current state, validates the allowed transition, updates the current status projection, appends an `order_events` record, and writes an audit record in one transaction.

Allowed transitions:

```text
draft -> pending_payment | cancelled
pending_payment -> confirmed | cancelled
confirmed -> processing | cancelled
processing -> fulfilled | cancelled
fulfilled -> terminal
cancelled -> terminal
```

`confirmed` is a state boundary for a future payment/checkout adapter; this foundation does not claim that a payment was made. A transition can be replayed by its order-scoped idempotency key without appending a second event. Reusing that key for a different target state or reason returns a conflict.

## Database contract

Migration `0012_order_foundation.sql` adds `orders`, `order_items`, and `order_events`. The current order row is a query projection; the event timeline is the audit history. Order and order-event rows use restrictive deletion behavior so business operations cannot silently remove historical order state.

## Explicit next dependencies

Before exposing checkout or payment routes, implement and connect:

1. Discount, tax, and shipping pricing policies with explicit provenance/versioning.
2. Transactional multi-line inventory allocation/reservation references and cancellation/expiry behavior.
3. Payment-provider adapters with authenticated, replay-protected, idempotent callbacks.
4. Authorization and customer/order read projections with buyer, Wholesale, Supplier, warehouse, finance, and admin scopes.
