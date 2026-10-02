import { query } from "@/server/db/pool";

export type WholesaleEligibility = {
  eligible: boolean;
  status: "none" | "pending" | "active" | "expired" | "suspended" | "cancelled";
  wholesaleAccountId: string | null;
  membershipId: string | null;
  planCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

type WholesaleEligibilityRow = {
  account_id: string | null;
  membership_id: string | null;
  membership_status: WholesaleEligibility["status"] | null;
  plan_code: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
};

export function isMembershipActiveWindow(
  status: WholesaleEligibility["status"] | null,
  startsAt: Date | null,
  endsAt: Date | null,
  now = new Date(),
): boolean {
  return (
    status === "active" &&
    startsAt !== null &&
    endsAt !== null &&
    startsAt.getTime() <= now.getTime() &&
    endsAt.getTime() > now.getTime()
  );
}

export async function getWholesaleEligibility(userId: string): Promise<WholesaleEligibility> {
  const result = await query<WholesaleEligibilityRow>(
    `SELECT
       account.id AS account_id,
       membership.id AS membership_id,
       membership.status AS membership_status,
       plan.code AS plan_code,
       membership.starts_at,
       membership.ends_at
     FROM wholesale_accounts account
     LEFT JOIN LATERAL (
       SELECT *
       FROM wholesale_memberships membership_item
       WHERE membership_item.wholesale_account_id = account.id
       ORDER BY membership_item.ends_at DESC, membership_item.created_at DESC
       LIMIT 1
     ) membership ON true
     LEFT JOIN wholesale_membership_plans plan ON plan.id = membership.plan_id
     WHERE account.user_id = $1
       AND account.status = 'active'
     LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row || !row.membership_id) {
    return {
      eligible: false,
      status: "none",
      wholesaleAccountId: row?.account_id ?? null,
      membershipId: null,
      planCode: null,
      startsAt: null,
      endsAt: null,
    };
  }

  const isActiveWindow = isMembershipActiveWindow(
    row.membership_status,
    row.starts_at,
    row.ends_at,
  );

  return {
    eligible: isActiveWindow,
    status: row.membership_status ?? "none",
    wholesaleAccountId: row.account_id,
    membershipId: row.membership_id,
    planCode: row.plan_code,
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
  };
}
