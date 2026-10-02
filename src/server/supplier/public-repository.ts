import { query } from "@/server/db/pool";
import {
  toPublicSupplierProfile,
  type PublicSupplierProfile,
} from "@/server/supplier/public-profile";

type PublicSupplierRow = {
  id: string;
  public_display_name: string;
  public_brand_name: string | null;
  public_bio: string | null;
};

export async function getApprovedPublicSupplier(
  supplierId: string,
): Promise<PublicSupplierProfile | null> {
  const result = await query<PublicSupplierRow>(
    `SELECT id, public_display_name, public_brand_name, public_bio
     FROM suppliers
     WHERE id = $1 AND status = 'approved'
     LIMIT 1`,
    [supplierId],
  );

  return result.rows[0] ? toPublicSupplierProfile(result.rows[0]) : null;
}
