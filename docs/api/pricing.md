# Pricing Foundation Contract

**Status:** Phase 7 pricing foundation started. Versioned base variant prices and deterministic base-merchandise quotes are implemented as internal server services. No public pricing administration, checkout, discount, tax, shipping, or payment route is exposed.

## Invariants

- Retail and Wholesale use the same versioned `variant_prices` table and pricing service.
- All amounts are integer minor units with an explicit three-letter currency.
- Publishing a new price retires the previous effective price under a transaction/advisory lock and preserves its validity interval.
- A quote records the exact price row, quantity, unit amount, line total, evaluated time, market, and currency.
- Wholesale quotes require an active, time-valid membership belonging to the buyer.
- Supplier prices are available only for approved Supplier-owned products; Retail prices are only valid for platform-owned Retail-enabled products.
- Supplier private fields are never included in quote or order snapshots.

## Internal services

### `publishVariantPrice`

This server-only command creates or replaces the current price for a product variant, market, and currency. It requires an actor and a reason, writes an audit record, and retains the retired price history. Authorization for a future admin route must enforce `pricing:manage`; there is intentionally no public route yet.

### `quoteOrderPricing`

This command accepts a buyer, market, currency, and explicit variant/quantity lines. It reads effective prices under one transaction and returns an immutable `base_merchandise_only` snapshot.

The current quote deliberately sets the following to zero:

- discounts
- tax
- shipping

Those values are not silently guessed. A later pricing/tax/shipping phase must extend the quote version and provenance before checkout is exposed.

`createPricedOrder` uses the pricing service and order creation in one transaction, so a price cannot change between quote and the stored order snapshot. It remains an internal boundary and does not reserve inventory or authorize payment.

## Database contract

Migration `0013_pricing_foundation.sql` adds versioned `variant_prices`, a pricing snapshot column on `orders`, the `pricing:manage` permission, and admin role grants. Price history is retained; business operations do not hard-delete old price rows.

## Explicit next dependencies

Before exposing checkout, implement deterministic discount/tax/shipping policies, transactional order inventory allocation/reservation, payment-provider adapters, callback replay protection, and the relevant authorization/read projections.
