import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "@/server/db/pool";
import { withTransaction } from "@/server/db/transaction";
import {
  assertProductTransition,
  ProductNotFoundError,
  ProductOwnershipError,
  type ProductStatus,
} from "@/server/catalog/product-state";
import { toPublicProduct, type PublicProduct } from "@/server/catalog/public-product";
import type { ProductInput } from "@/server/catalog/validation";

export type CatalogProductRecord = {
  id: string;
  supplierId: string | null;
  ownerType: "platform" | "supplier";
  status: ProductStatus;
  slug: string;
  title: string;
  description: string | null;
  brandName: string | null;
  categoryId: string | null;
  attributes: Record<string, unknown>;
  retailEnabled: boolean;
  wholesaleEnabled: boolean;
  variants: CatalogVariantRecord[];
};

export type CatalogVariantRecord = {
  id: string;
  sku: string;
  barcode: string | null;
  sizeLabel: string | null;
  colorLabel: string | null;
  attributes: Record<string, unknown>;
  weightGrams: number | null;
  status: "active" | "archived";
};

type ProductRow = {
  id: string;
  supplier_id: string | null;
  owner_type: "platform" | "supplier";
  status: ProductStatus;
  slug: string;
  title: string;
  description: string | null;
  brand_name: string | null;
  category_id: string | null;
  attributes: Record<string, unknown>;
  retail_enabled: boolean;
  wholesale_enabled: boolean;
  supplier_display_name: string | null;
  supplier_brand_name: string | null;
};

type VariantRow = {
  id: string;
  sku: string;
  barcode: string | null;
  size_label: string | null;
  color_label: string | null;
  attributes: Record<string, unknown>;
  weight_grams: number | null;
  status: "active" | "archived";
};

const productColumns = `
  p.id,
  p.supplier_id,
  p.owner_type,
  p.status,
  p.slug,
  p.title,
  p.description,
  p.brand_name,
  p.category_id,
  p.attributes,
  p.retail_enabled,
  p.wholesale_enabled,
  s.public_display_name AS supplier_display_name,
  s.public_brand_name AS supplier_brand_name
`;

function mapVariant(row: VariantRow): CatalogVariantRecord {
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    sizeLabel: row.size_label,
    colorLabel: row.color_label,
    attributes: row.attributes,
    weightGrams: row.weight_grams,
    status: row.status,
  };
}

function mapProduct(row: ProductRow, variants: CatalogVariantRecord[]): CatalogProductRecord {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    ownerType: row.owner_type,
    status: row.status,
    slug: row.slug,
    title: row.title,
    description: row.description,
    brandName: row.brand_name,
    categoryId: row.category_id,
    attributes: row.attributes,
    retailEnabled: row.retail_enabled,
    wholesaleEnabled: row.wholesale_enabled,
    variants,
  };
}

export type CreateCatalogProductInput = ProductInput & {
  ownerType: "platform" | "supplier";
  supplierId: string | null;
  actorUserId: string;
  requestId: string;
};

export async function createCatalogProduct(
  input: CreateCatalogProductInput,
): Promise<CatalogProductRecord> {
  if (input.ownerType === "supplier" && input.retailEnabled) {
    throw new ProductOwnershipError();
  }

  const duplicateSkus = new Set<string>();
  for (const variant of input.variants) {
    if (duplicateSkus.has(variant.sku)) {
      throw new Error("Variant SKUs must be unique within a product.");
    }
    duplicateSkus.add(variant.sku);
  }

  const productId = await withTransaction(async (client) => {
    const product = await client.query<{ id: string }>(
      `INSERT INTO products
         (id, supplier_id, owner_type, slug, title, description, brand_name, category_id,
          attributes, retail_enabled, wholesale_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       RETURNING id`,
      [
        randomUUID(),
        input.supplierId,
        input.ownerType,
        input.slug,
        input.title,
        input.description ?? null,
        input.brandName ?? null,
        input.categoryId ?? null,
        JSON.stringify(input.attributes),
        input.retailEnabled,
        input.wholesaleEnabled,
      ],
    );
    const id = product.rows[0].id;

    for (const variant of input.variants) {
      await client.query(
        `INSERT INTO product_variants
           (id, product_id, sku, barcode, size_label, color_label, attributes, weight_grams)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          randomUUID(),
          id,
          variant.sku,
          variant.barcode ?? null,
          variant.sizeLabel ?? null,
          variant.colorLabel ?? null,
          JSON.stringify(variant.attributes),
          variant.weightGrams ?? null,
        ],
      );
    }

    await appendProductEvent(client, {
      productId: id,
      actorUserId: input.actorUserId,
      fromStatus: null,
      toStatus: "draft",
      reason: null,
    });
    await appendAuditLog(client, {
      actorUserId: input.actorUserId,
      action: "catalog.product.created",
      resourceId: id,
      afterState: { status: "draft", ownerType: input.ownerType },
      requestId: input.requestId,
    });

    return id;
  });

  const product = await getOwnedCatalogProduct(productId, input.ownerType, input.supplierId);
  if (!product) {
    throw new ProductNotFoundError();
  }
  return product;
}

export async function getOwnedCatalogProduct(
  productId: string,
  ownerType: "platform" | "supplier",
  supplierId: string | null,
): Promise<CatalogProductRecord | null> {
  const result = ownerType === "supplier"
    ? await query<ProductRow>(
        `SELECT ${productColumns}
         FROM products p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.id = $1 AND p.owner_type = 'supplier' AND p.supplier_id = $2
         LIMIT 1`,
        [productId, supplierId],
      )
    : await query<ProductRow>(
        `SELECT ${productColumns}
         FROM products p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.id = $1 AND p.owner_type = 'platform'
         LIMIT 1`,
        [productId],
      );

  if (!result.rows[0]) {
    return null;
  }

  return mapProduct(result.rows[0], await getVariants(productId));
}

export async function listOwnedSupplierProducts(
  supplierId: string,
  limit = 50,
): Promise<CatalogProductRecord[]> {
  const result = await query<ProductRow>(
    `SELECT ${productColumns}
     FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.owner_type = 'supplier' AND p.supplier_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [supplierId, limit],
  );

  return Promise.all(result.rows.map(async (row) => mapProduct(row, await getVariants(row.id))));
}

export async function publishOwnedCatalogProduct(input: {
  productId: string;
  actorUserId: string;
  ownerType: "platform" | "supplier";
  supplierId: string | null;
  requestId: string;
}): Promise<CatalogProductRecord> {
  await withTransaction(async (client) => {
    const result = input.ownerType === "supplier"
      ? await client.query<ProductRow>(
          `SELECT ${productColumns}
           FROM products p
           LEFT JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.id = $1 AND p.owner_type = 'supplier' AND p.supplier_id = $2
           FOR UPDATE OF p`,
          [input.productId, input.supplierId],
        )
      : await client.query<ProductRow>(
          `SELECT ${productColumns}
           FROM products p
           LEFT JOIN suppliers s ON s.id = p.supplier_id
           WHERE p.id = $1 AND p.owner_type = 'platform'
           FOR UPDATE OF p`,
          [input.productId],
        );

    const product = result.rows[0];
    if (!product) {
      throw new ProductOwnershipError();
    }
    if (input.ownerType === "supplier" && product.supplier_id !== input.supplierId) {
      throw new ProductOwnershipError();
    }
    assertProductTransition(product.status, "active");

    if (input.ownerType === "supplier") {
      const supplier = await client.query<{ status: string }>(
        "SELECT status FROM suppliers WHERE id = $1 LIMIT 1",
        [input.supplierId],
      );
      if (supplier.rows[0]?.status !== "approved") {
        throw new ProductOwnershipError();
      }
    }

    await client.query(
      "UPDATE products SET status = 'active', updated_at = now() WHERE id = $1",
      [input.productId],
    );
    await appendProductEvent(client, {
      productId: input.productId,
      actorUserId: input.actorUserId,
      fromStatus: product.status,
      toStatus: "active",
      reason: null,
    });
    await appendAuditLog(client, {
      actorUserId: input.actorUserId,
      action: "catalog.product.published",
      resourceId: input.productId,
      beforeState: { status: product.status },
      afterState: { status: "active" },
      requestId: input.requestId,
    });
  });

  const product = await getOwnedCatalogProduct(input.productId, input.ownerType, input.supplierId);
  if (!product) {
    throw new ProductNotFoundError();
  }
  return product;
}

export async function listPublicProducts(
  market: "retail" | "wholesale",
  limit: number,
  offset: number,
): Promise<PublicProduct[]> {
  const result = await query<ProductRow>(
    `SELECT ${productColumns}
     FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.status = 'active'
       AND (
         ($1 = 'retail' AND p.owner_type = 'platform' AND p.retail_enabled = true)
         OR ($1 = 'wholesale' AND p.wholesale_enabled = true
          AND (p.owner_type = 'platform' OR s.status = 'approved'))
       )
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [market, limit, offset],
  );

  return Promise.all(
    result.rows.map(async (row) =>
      toPublicProduct(row, (await getVariants(row.id)).map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        sizeLabel: variant.sizeLabel,
        colorLabel: variant.colorLabel,
        attributes: variant.attributes,
        weightGrams: variant.weightGrams,
        status: variant.status,
      }))),
    ),
  );
}

export async function getPublicProduct(
  productId: string,
  market: "retail" | "wholesale",
): Promise<PublicProduct | null> {
  const result = await query<ProductRow>(
    `SELECT ${productColumns}
     FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = $1
       AND p.status = 'active'
       AND (
         ($2 = 'retail' AND p.owner_type = 'platform' AND p.retail_enabled = true)
         OR ($2 = 'wholesale' AND p.wholesale_enabled = true
          AND (p.owner_type = 'platform' OR s.status = 'approved'))
       )
     LIMIT 1`,
    [productId, market],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return toPublicProduct(row, (await getVariants(productId)).map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    sizeLabel: variant.sizeLabel,
    colorLabel: variant.colorLabel,
    attributes: variant.attributes,
    weightGrams: variant.weightGrams,
    status: variant.status,
  })));
}

async function getVariants(productId: string): Promise<CatalogVariantRecord[]> {
  const result = await query<VariantRow>(
    `SELECT id, sku, barcode, size_label, color_label, attributes, weight_grams, status
     FROM product_variants
     WHERE product_id = $1
     ORDER BY created_at ASC`,
    [productId],
  );
  return result.rows.map(mapVariant);
}

async function appendProductEvent(
  client: PoolClient,
  input: {
    productId: string;
    actorUserId: string;
    fromStatus: ProductStatus | null;
    toStatus: ProductStatus;
    reason: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO product_events
       (id, product_id, actor_user_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), input.productId, input.actorUserId, input.fromStatus, input.toStatus, input.reason],
  );
}

async function appendAuditLog(
  client: PoolClient,
  input: {
    actorUserId: string;
    action: string;
    resourceId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, resource_type, resource_id, before_state, after_state, request_id)
     VALUES ($1, $2, $3, 'product', $4, $5::jsonb, $6::jsonb, $7)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.resourceId,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
      input.requestId,
    ],
  );
}
