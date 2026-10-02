import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import { hashPassword } from "@/server/identity/password";
import { createUser } from "@/server/identity/user-repository";
import {
  createSupplierApplication,
  decideSupplierApplication,
  getSupplierApplicationForOwner,
  submitSupplierApplication,
} from "@/server/supplier/application-repository";
import { getApprovedPublicSupplier } from "@/server/supplier/public-repository";
import { getWholesaleEligibility } from "@/server/wholesale/eligibility";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
const createdUserIds: string[] = [];
const createdPlanCodes: string[] = [];

describeDatabase("supplier privacy and wholesale membership integration", () => {
  afterEach(async () => {
    for (const userId of createdUserIds) {
      await query("DELETE FROM suppliers WHERE owner_user_id = $1", [userId]);
      await query("DELETE FROM supplier_applications WHERE applicant_user_id = $1", [userId]);
      await query("DELETE FROM wholesale_accounts WHERE user_id = $1", [userId]);
    }
    for (const code of createdPlanCodes) {
      await query("DELETE FROM wholesale_membership_plans WHERE code = $1", [code]);
    }
    if (createdUserIds.length) {
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUserIds]);
    }
    createdUserIds.length = 0;
    createdPlanCodes.length = 0;
  });

  it("keeps private supplier data out of the buyer projection and enforces owner isolation", async () => {
    const applicantEmail = `${randomUUID()}@example.com`;
    const otherEmail = `${randomUUID()}@example.com`;
    const adminEmail = `${randomUUID()}@example.com`;
    const passwordHash = await hashPassword("A secure password with 12+ chars");
    const applicant = await createUser({
      email: applicantEmail,
      emailNormalized: applicantEmail,
      passwordHash,
      requestId: "supplier-integration",
    });
    const otherUser = await createUser({
      email: otherEmail,
      emailNormalized: otherEmail,
      passwordHash,
      requestId: "supplier-integration",
    });
    const admin = await createUser({
      email: adminEmail,
      emailNormalized: adminEmail,
      passwordHash,
      requestId: "supplier-integration",
    });
    createdUserIds.push(applicant.id, otherUser.id, admin.id);

    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE key = 'admin'`,
      [admin.id],
    );

    const draft = await createSupplierApplication({
      applicantUserId: applicant.id,
      publicDisplayName: "Public Studio",
      publicBrandName: "Public Brand",
      publicBio: "Buyer-safe description",
      legalName: "Private Legal Entity",
      contactEmail: "private@example.com",
      contactPhone: "+1 555 0100",
      businessAddress: "Private business address",
      requestId: "supplier-integration",
    });
    await submitSupplierApplication(draft.id, applicant.id, "supplier-integration");
    await decideSupplierApplication({
      applicationId: draft.id,
      actorUserId: admin.id,
      nextStatus: "under_review",
      reason: null,
      requestId: "supplier-integration",
    });
    const approved = await decideSupplierApplication({
      applicationId: draft.id,
      actorUserId: admin.id,
      nextStatus: "approved",
      reason: null,
      requestId: "supplier-integration",
    });

    await expect(getSupplierApplicationForOwner(draft.id, otherUser.id)).resolves.toBeNull();
    const supplierResult = await query<{ id: string }>(
      "SELECT id FROM suppliers WHERE application_id = $1",
      [approved.id],
    );
    const supplier = await getApprovedPublicSupplier(supplierResult.rows[0].id);

    expect(supplier).toEqual({
      id: supplierResult.rows[0].id,
      displayName: "Public Studio",
      brandName: "Public Brand",
      bio: "Buyer-safe description",
      status: "approved",
    });
    expect(supplier).not.toHaveProperty("contactEmail");
    expect(supplier).not.toHaveProperty("contactPhone");
    expect(supplier).not.toHaveProperty("businessAddress");
    expect(supplier).not.toHaveProperty("legalName");
  });

  it("only grants wholesale eligibility inside an active membership window", async () => {
    const email = `${randomUUID()}@example.com`;
    const user = await createUser({
      email,
      emailNormalized: email,
      passwordHash: await hashPassword("A secure password with 12+ chars"),
      requestId: "membership-integration",
    });
    createdUserIds.push(user.id);

    const planCode = `integration-${randomUUID()}`;
    createdPlanCodes.push(planCode);
    const planId = randomUUID();
    await query(
      `INSERT INTO wholesale_membership_plans
         (id, code, name, duration_days, price_minor, currency, wholesale_price_visibility)
       VALUES ($1, $2, 'Integration plan', 30, 1000, 'USD', true)`,
      [planId, planCode],
    );
    const accountId = randomUUID();
    await query(
      "INSERT INTO wholesale_accounts (id, user_id) VALUES ($1, $2)",
      [accountId, user.id],
    );
    await query(
      `INSERT INTO wholesale_memberships
         (id, wholesale_account_id, plan_id, status, starts_at, ends_at)
       VALUES ($1, $2, $3, 'active', now() - interval '1 day', now() + interval '1 day')`,
      [randomUUID(), accountId, planId],
    );

    await expect(getWholesaleEligibility(user.id)).resolves.toMatchObject({
      eligible: true,
      status: "active",
      planCode,
    });
  });
});
