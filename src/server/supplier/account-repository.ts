import { query } from "@/server/db/pool";

export type SupplierAccountForOwner = {
  id: string;
  status: "approved" | "suspended" | "disabled";
};

export async function getSupplierAccountForOwner(
  ownerUserId: string,
): Promise<SupplierAccountForOwner | null> {
  const result = await query<SupplierAccountForOwner>(
    `SELECT id, status
     FROM suppliers
     WHERE owner_user_id = $1
     LIMIT 1`,
    [ownerUserId],
  );

  return result.rows[0] ?? null;
}
