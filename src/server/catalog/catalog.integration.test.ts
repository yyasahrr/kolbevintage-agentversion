import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import {
  createCatalogProduct,
  listPublicProducts,
  publishOwnedCatalogProduct,
} from "@/server/catalog/product-repository";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
const createdProductIds: string[] = [];
const createdSupplierIds: string[] = [];
const createdApplicationIds: string[] = [];
const createdUserIds: string[] = [];

describeDatabase("catalog ownership integration", () => {
  afterEach(async () => {
    if (createdProductIds.length) {
      await query("DELETE FROM products WHERE id = ANY($1::uuid[])", [createdProductIds]);
    }
    if (createdSupplierIds.length) {
      await query("DELETE FROM suppliers WHERE id = ANY($1::uuid[])", [createdSupplierIds]);
    }
    if (createdApplicationIds.length) {
      await query("DELETE FROM supplier_applications WHERE id = ANY($1::uuid[])", [createdApplicationIds]);
    }
    if (createdUserIds.length) {
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUserIds]);
    }
    createdProductIds.length = 0;
    createdSupplierIds.length = 0;
    createdApplicationIds.length = 0;
    createdUserIds.length = 0;
  });

  it("keeps supplier products out of Retail while allowing approved Wholesale visibility", async () => {
    const platformUserId = randomUUID();
    const supplierUserId = randomUUID();
    const applicationId = randomUUID();
    const supplierId = randomUUID();
    createdUserIds.push(platformUserId, supplierUserId);
    createdApplicationIds.push(applicationId);
    createdSupplierIds.push(supplierId);

    await query(
      `INSERT INTO users (id, email, email_normalized, status)
       VALUES ($1, $2, $2, 'active'), ($3, $4, $4, 'active')`,
      [
        platformUserId,
        `${platformUserId}@example.com`,
        supplierUserId,
        `${supplierUserId}@example.com`,
      ],
    );
    await query(
      `INSERT INTO supplier_applications
         (id, applicant_user_id, status, public_display_name, legal_name,
          contact_email, contact_phone, business_address)
       VALUES ($1, $2, 'approved', 'Public Studio', 'Private Studio',
          'private@example.com', '+1 555 0100', 'Private address')`,
      [applicationId, supplierUserId],
    );
    await query(
      `INSERT INTO suppliers
         (id, owner_user_id, application_id, public_display_name, public_brand_name, status)
       VALUES ($1, $2, $3, 'Public Studio', 'Public Brand', 'approved')`,
      [supplierId, supplierUserId, applicationId],
    );

    const platformProduct = await createCatalogProduct({
      ownerType: "platform",
      supplierId: null,
      actorUserId: platformUserId,
      requestId: "catalog-integration",
      title: "Platform Tee",
      slug: `platform-tee-${platformUserId}`,
      description: null,
      brandName: "Platform Brand",
      categoryId: null,
      attributes: { fabric: "cotton" },
      retailEnabled: true,
      wholesaleEnabled: false,
      variants: [{
        sku: `PLATFORM-${platformUserId}`,
        barcode: null,
        sizeLabel: "M",
        colorLabel: "Black",
        attributes: {},
        weightGrams: null,
      }],
    });
    createdProductIds.push(platformProduct.id);
    await publishOwnedCatalogProduct({
      productId: platformProduct.id,
      actorUserId: platformUserId,
      ownerType: "platform",
      supplierId: null,
      requestId: "catalog-integration",
    });

    const supplierProduct = await createCatalogProduct({
      ownerType: "supplier",
      supplierId,
      actorUserId: supplierUserId,
      requestId: "catalog-integration",
      title: "Supplier Jacket",
      slug: `supplier-jacket-${supplierUserId}`,
      description: null,
      brandName: "Public Brand",
      categoryId: null,
      attributes: { material: "wool" },
      retailEnabled: false,
      wholesaleEnabled: true,
      variants: [{
        sku: `SUPPLIER-${supplierUserId}`,
        barcode: null,
        sizeLabel: "L",
        colorLabel: "Navy",
        attributes: {},
        weightGrams: null,
      }],
    });
    createdProductIds.push(supplierProduct.id);
    await publishOwnedCatalogProduct({
      productId: supplierProduct.id,
      actorUserId: supplierUserId,
      ownerType: "supplier",
      supplierId,
      requestId: "catalog-integration",
    });

    const retailProducts = await listPublicProducts("retail", 100, 0);
    const wholesaleProducts = await listPublicProducts("wholesale", 100, 0);
    expect(retailProducts.some((product) => product.id === platformProduct.id)).toBe(true);
    expect(retailProducts.some((product) => product.id === supplierProduct.id)).toBe(false);
    expect(wholesaleProducts.find((product) => product.id === supplierProduct.id)?.supplier).toEqual({
      id: supplierId,
      displayName: "Public Studio",
      brandName: "Public Brand",
    });
  });
});
