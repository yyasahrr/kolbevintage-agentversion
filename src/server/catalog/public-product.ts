export type PublicProductVariant = {
  id: string;
  sku: string;
  barcode: string | null;
  sizeLabel: string | null;
  colorLabel: string | null;
  attributes: Record<string, unknown>;
  weightGrams: number | null;
  status: "active" | "archived";
};

export type PublicProduct = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  brandName: string | null;
  categoryId: string | null;
  attributes: Record<string, unknown>;
  status: "active";
  sellerType: "platform" | "supplier";
  supplier: {
    id: string;
    displayName: string;
    brandName: string | null;
  } | null;
  variants: PublicProductVariant[];
};

export type PublicProductRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  brand_name: string | null;
  category_id: string | null;
  attributes: Record<string, unknown>;
  status: string;
  owner_type: "platform" | "supplier";
  supplier_id: string | null;
  supplier_display_name: string | null;
  supplier_brand_name: string | null;
};

export function toPublicProduct(row: PublicProductRow, variants: PublicProductVariant[]): PublicProduct {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    brandName: row.brand_name,
    categoryId: row.category_id,
    attributes: row.attributes,
    status: "active",
    sellerType: row.owner_type,
    supplier:
      row.owner_type === "supplier" && row.supplier_id && row.supplier_display_name
        ? {
            id: row.supplier_id,
            displayName: row.supplier_display_name,
            brandName: row.supplier_brand_name,
          }
        : null,
    variants,
  };
}
