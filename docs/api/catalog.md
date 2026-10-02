# Catalog API

**Status:** Foundation partial. This batch establishes Product/Variant ownership and market visibility plus secured media metadata constraints. Pricing, stock, inventory reservation, checkout, and provider-backed media upload are not part of this contract yet.

## Ownership rules

- Platform-owned products may enable Retail and/or Wholesale visibility.
- Supplier-owned products are Wholesale-only. The API rejects `retailEnabled: true`, and the database check constraint also prevents it.
- Supplier products can be created or published only by an approved Supplier owner with the `supplier:products:manage` permission.
- Platform product creation/publishing requires `catalog:manage` or `catalog:publish` respectively.
- New products start as `draft` and are not returned by public catalog queries.
- Product status transitions are explicit and append a `product_events` record plus an audit record.

## Product shape

Product attributes and variant attributes are extensible JSON objects. They are intentionally kept separate from the core identity of a product/variant.

```json
{
  "title": "Studio Jacket",
  "slug": "studio-jacket",
  "description": "A buyer-facing description.",
  "brandName": "Brand A",
  "categoryId": null,
  "attributes": {
    "material": "cotton",
    "fit": "regular",
    "season": "fall"
  },
  "retailEnabled": false,
  "wholesaleEnabled": true,
  "variants": [
    {
      "sku": "JACKET-BLACK-M",
      "barcode": null,
      "sizeLabel": "M",
      "colorLabel": "Black",
      "attributes": {
        "fabricWeight": "midweight"
      },
      "weightGrams": 800
    }
  ]
}
```

SKU is globally unique. Variant count is bounded at 100 per request. Stock, price, and availability are not stored in the catalog tables; those belong to the pricing and inventory domains.

## Supplier product endpoints

```text
GET  /api/v1/supplier/products
POST /api/v1/supplier/products
POST /api/v1/supplier/products/:productId/publish
```

Supplier creation always persists `retail_enabled = false`, even if a malicious client tries to change the request. A non-approved/suspended Supplier cannot create or publish products.

## Platform Admin endpoints

```text
POST /api/v1/admin/products
POST /api/v1/admin/products/:productId/publish
```

## Public catalog endpoints

### Retail

```text
GET /api/v1/catalog/products?market=retail&limit=24&offset=0
GET /api/v1/catalog/products/:productId?market=retail
```

Retail queries return only active Platform-owned products with Retail visibility enabled. Supplier products cannot appear in Retail results.

### Wholesale

```text
GET /api/v1/catalog/products?market=wholesale&limit=24&offset=0
GET /api/v1/catalog/products/:productId?market=wholesale
```

Wholesale queries require an authenticated user with an active server-evaluated Wholesale membership. Supplier products are returned only while the Supplier account is approved.

Public responses contain a buyer-safe Supplier projection only:

```json
{
  "id": "supplier-id",
  "displayName": "Studio A",
  "brandName": "Brand A"
}
```

Private supplier profile fields are never joined by the public catalog query.

## Known limitations before production

- Category administration and category APIs are not implemented yet.
- Binary media upload, content scanning, thumbnails, signed URLs, provider retention, and media metadata create/update APIs are not enabled. A provider-neutral adapter contract and bounded metadata validation exist; no fake public URL flow is used.
- Pricing, price snapshots, order-linked reservations, and customer-facing availability remain separate domains; the initial central inventory integrity service is documented in `docs/api/inventory.md`.
- Search/filter/sort is intentionally limited to bounded list pagination until real access patterns are measured.
- Full PostgreSQL catalog integration and concurrency tests run in CI when the database service is available; the current local environment has no PostgreSQL service.
