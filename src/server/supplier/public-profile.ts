export type PublicSupplierProfile = {
  id: string;
  displayName: string;
  brandName: string | null;
  bio: string | null;
  status: "approved";
};

type PublicSupplierRow = {
  id: string;
  public_display_name: string;
  public_brand_name: string | null;
  public_bio: string | null;
};

/**
 * Explicitly projects the buyer-safe supplier shape. Do not replace this with
 * a spread of a database row; private supplier fields must not cross the DTO boundary.
 */
export function toPublicSupplierProfile(row: PublicSupplierRow): PublicSupplierProfile {
  return {
    id: row.id,
    displayName: row.public_display_name,
    brandName: row.public_brand_name,
    bio: row.public_bio,
    status: "approved",
  };
}
