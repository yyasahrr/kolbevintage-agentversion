import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/server/db/transaction";
import {
  InvalidPriceError,
  PriceNotAvailableError,
  PriceNotFoundError,
  PricingIntegrityError,
} from "@/server/pricing/errors";
import type {
  PricingSnapshot,
  PublishVariantPriceInput,
  QuoteOrderPricingInput,
} from "@/server/pricing/validation";

export type VariantPrice = {
  id: string;
  productId: string;
  variantId: string;
  market: "retail" | "wholesale";
  currency: string;
  unitPriceMinor: number;
  validFrom: string;
  validUntil: string | null;
  status: "active" | "retired";
};

export type PricingQuoteItem = {
  productId: string;
  variantId: string;
  sellerType: "platform" | "supplier";
  sellerId: string | null;
  sellerDisplayName: string;
  title: string;
  sku: string;
  attributes: Record<string, unknown>;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: 0;
  taxMinor: 0;
  lineTotalMinor: number;
};

export type PricingQuote = {
  snapshot: PricingSnapshot;
  items: PricingQuoteItem[];
};

type PriceRow = {
  id: string;
  product_id: string;
  variant_id: string;
  market_type: "retail" | "wholesale";
  currency: string;
  unit_price_minor: number | string;
  valid_from: Date;
  valid_until: Date | null;
  status: VariantPrice["status"];
};

type CatalogPriceRow = PriceRow & {
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

export async function publishVariantPrice(input: PublishVariantPriceInput): Promise<VariantPrice> {
  return withTransaction(async (client) => {
    if (!Number.isSafeInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
      throw new InvalidPriceError();
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`variant-price:${input.variantId}:${input.market}:${input.currency}`],
    );
    const catalog = await findCatalogPriceContext(client, input.productId, input.variantId);
    assertPriceMarketAvailable(catalog, input.market);

    await client.query(
      `UPDATE variant_prices
          SET status = 'retired', valid_until = now()
        WHERE variant_id = $1
          AND market_type = $2
          AND currency = $3
          AND status = 'active'
          AND valid_until IS NULL`,
      [input.variantId, input.market, input.currency],
    );
    const result = await client.query<PriceRow>(
      `INSERT INTO variant_prices
         (id, product_id, variant_id, market_type, currency, unit_price_minor, created_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, product_id, variant_id, market_type, currency, unit_price_minor,
         valid_from, valid_until, status`,
      [
        randomUUID(),
        input.productId,
        input.variantId,
        input.market,
        input.currency,
        input.unitPriceMinor,
        input.actorUserId,
        input.reason,
      ],
    );
    const price = result.rows[0];
    if (!price) throw new PricingIntegrityError();
    await client.query(
      `INSERT INTO audit_log
         (id, actor_user_id, action, resource_type, resource_id, after_state, reason, request_id, metadata)
       VALUES ($1, $2, 'pricing.variant_price_published', 'variant_price', $3, $4::jsonb, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        input.actorUserId,
        price.id,
        JSON.stringify({
          productId: price.product_id,
          variantId: price.variant_id,
          market: price.market_type,
          currency: price.currency,
          unitPriceMinor: toSafeMoney(price.unit_price_minor),
        }),
        input.reason,
        input.requestId,
        JSON.stringify({ source: "pricing-repository" }),
      ],
    );
    return toVariantPrice(price);
  });
}

export async function quoteOrderPricing(input: QuoteOrderPricingInput): Promise<PricingQuote> {
  return withTransaction(async (client) => quoteOrderPricingWithClient(client, input));
}

export async function quoteOrderPricingWithClient(
  client: PoolClient,
  input: QuoteOrderPricingInput,
): Promise<PricingQuote> {
  const uniqueVariants = new Set<string>();
  if (input.market === "wholesale") {
    await assertActiveWholesaleMembership(client, input.buyerUserId, input.wholesaleMembershipId ?? null);
  }

  const evaluatedAt = new Date();
  const items: PricingQuoteItem[] = [];
  const pricingItems: PricingSnapshot["items"] = [];
  let subtotalMinor = 0;

  for (const requestedItem of input.items) {
    if (uniqueVariants.has(requestedItem.variantId)) {
      throw new PricingIntegrityError();
    }
    uniqueVariants.add(requestedItem.variantId);
    const result = await client.query<CatalogPriceRow>(
      `SELECT
         price.id, price.product_id, price.variant_id, price.market_type,
         price.currency, price.unit_price_minor, price.valid_from, price.valid_until, price.status,
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
       INNER JOIN variant_prices price
         ON price.variant_id = v.id
        AND price.product_id = p.id
        AND price.market_type = $3
        AND price.currency = $4
        AND price.valid_from <= $5
        AND (price.valid_until IS NULL OR price.valid_until > $5)
      WHERE p.id = $1
        AND v.id = $2
        AND price.status IN ('active', 'retired')
       ORDER BY price.valid_from DESC
       LIMIT 1`,
      [requestedItem.productId, requestedItem.variantId, input.market, input.currency, evaluatedAt],
    );
    const row = result.rows[0];
    if (!row) throw new PriceNotFoundError();
    assertCatalogAvailable(row, input.market);
    if (row.currency !== input.currency) throw new PricingIntegrityError();

    const unitPriceMinor = toSafeMoney(row.unit_price_minor);
    const lineTotalMinor = safeMultiply(unitPriceMinor, requestedItem.quantity);
    subtotalMinor = safeAdd(subtotalMinor, lineTotalMinor);
    items.push({
      productId: row.product_id,
      variantId: row.variant_id,
      sellerType: row.product_owner_type,
      sellerId: row.product_owner_type === "supplier" ? row.product_supplier_id : null,
      sellerDisplayName: row.product_owner_type === "supplier"
        ? row.supplier_display_name ?? ""
        : "Platform",
      title: row.product_title,
      sku: row.variant_sku,
      attributes: row.variant_attributes,
      quantity: requestedItem.quantity,
      unitPriceMinor,
      discountMinor: 0,
      taxMinor: 0,
      lineTotalMinor,
    });
    pricingItems.push({
      variantId: row.variant_id,
      priceId: row.id,
      quantity: requestedItem.quantity,
      unitPriceMinor,
      lineTotalMinor,
    });
  }

  const snapshot: PricingSnapshot = {
    quoteId: randomUUID(),
    version: 1,
    coverage: "base_merchandise_only",
    evaluatedAt: evaluatedAt.toISOString(),
    market: input.market,
    currency: input.currency,
    items: pricingItems,
    subtotalMinor,
    discountMinor: 0,
    taxMinor: 0,
    shippingMinor: 0,
    totalMinor: subtotalMinor,
  };
  return { snapshot, items };
}

async function findCatalogPriceContext(
  client: PoolClient,
  productId: string,
  variantId: string,
): Promise<CatalogPriceRow> {
  const result = await client.query<CatalogPriceRow>(
    `SELECT
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
    [productId, variantId],
  );
  const row = result.rows[0];
  if (!row) throw new PriceNotAvailableError();
  return row;
}

function assertPriceMarketAvailable(
  row: CatalogPriceRow,
  market: "retail" | "wholesale",
): void {
  if (row.product_owner_type === "supplier" && row.supplier_status !== "approved") {
    throw new PriceNotAvailableError();
  }
  if (market === "retail"
    ? row.product_owner_type !== "platform" || !row.retail_enabled
    : !row.wholesale_enabled) {
    throw new PriceNotAvailableError();
  }
}

function assertCatalogAvailable(
  row: CatalogPriceRow,
  market: "retail" | "wholesale",
): void {
  if (row.product_status !== "active" || row.variant_status !== "active") {
    throw new PriceNotAvailableError();
  }
  assertPriceMarketAvailable(row, market);
}

async function assertActiveWholesaleMembership(
  client: PoolClient,
  buyerUserId: string,
  membershipId: string | null,
): Promise<void> {
  if (!membershipId) throw new PriceNotAvailableError();
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
  if (result.rowCount !== 1) throw new PriceNotAvailableError();
}

function toVariantPrice(row: PriceRow): VariantPrice {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    market: row.market_type,
    currency: row.currency,
    unitPriceMinor: toSafeMoney(row.unit_price_minor),
    validFrom: row.valid_from.toISOString(),
    validUntil: row.valid_until?.toISOString() ?? null,
    status: row.status,
  };
}

function toSafeMoney(value: number | string): number {
  const result = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result < 0) throw new PricingIntegrityError();
  return result;
}

function safeMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) throw new PricingIntegrityError();
  return result;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new PricingIntegrityError();
  return result;
}
