import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import { publishVariantPrice, quoteOrderPricing } from "@/server/pricing/pricing-repository";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
let userId: string | undefined;
let productId: string | undefined;
let variantId: string | undefined;

describeDatabase("pricing foundation", () => {
  afterEach(async () => {
    if (variantId) {
      await query("DELETE FROM variant_prices WHERE variant_id = $1", [variantId]);
      variantId = undefined;
    }
    if (productId) {
      await query("DELETE FROM products WHERE id = $1", [productId]);
      productId = undefined;
    }
    if (userId) {
      await query("DELETE FROM users WHERE id = $1", [userId]);
      userId = undefined;
    }
  });

  it("quotes the effective versioned base price deterministically", async () => {
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
       VALUES ($1, 'platform', 'active', $2, 'Pricing Test Product', true, false)`,
      [productId, `pricing-test-${productId}`],
    );
    await query(
      `INSERT INTO product_variants (id, product_id, sku, attributes)
       VALUES ($1, $2, $3, '{}'::jsonb)`,
      [variantId, productId, `PRICE-${variantId}`],
    );

    const firstPrice = await publishVariantPrice({
      productId,
      variantId,
      market: "retail",
      currency: "USD",
      unitPriceMinor: 1750,
      reason: "Initial price",
      actorUserId: userId,
      requestId: "pricing-integration-first",
    });
    const firstQuote = await quoteOrderPricing({
      buyerUserId: userId,
      market: "retail",
      currency: "USD",
      items: [{ productId, variantId, quantity: 2 }],
    });
    expect(firstQuote.snapshot.subtotalMinor).toBe(3500);
    expect(firstQuote.snapshot.items[0]?.priceId).toBe(firstPrice.id);
    expect(firstQuote.snapshot.coverage).toBe("base_merchandise_only");

    const secondPrice = await publishVariantPrice({
      productId,
      variantId,
      market: "retail",
      currency: "USD",
      unitPriceMinor: 2000,
      reason: "Seasonal price update",
      actorUserId: userId,
      requestId: "pricing-integration-second",
    });
    const secondQuote = await quoteOrderPricing({
      buyerUserId: userId,
      market: "retail",
      currency: "USD",
      items: [{ productId, variantId, quantity: 2 }],
    });
    expect(secondQuote.snapshot.subtotalMinor).toBe(4000);
    expect(secondQuote.snapshot.items[0]?.priceId).toBe(secondPrice.id);
  });
});
