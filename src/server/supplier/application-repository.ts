import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "@/server/db/transaction";
import { query } from "@/server/db/pool";
import {
  assertSupplierApplicationTransition,
  type SupplierApplicationStatus,
} from "@/server/supplier/application-state";

export type SupplierApplicationRecord = {
  id: string;
  applicantUserId: string;
  status: SupplierApplicationStatus;
  publicDisplayName: string;
  publicBrandName: string | null;
  publicBio: string | null;
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type SupplierApplicationRow = {
  id: string;
  applicant_user_id: string;
  status: SupplierApplicationStatus;
  public_display_name: string;
  public_brand_name: string | null;
  public_bio: string | null;
  legal_name: string;
  contact_email: string;
  contact_phone: string;
  business_address: string;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  review_reason: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapApplication(row: SupplierApplicationRow): SupplierApplicationRecord {
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    status: row.status,
    publicDisplayName: row.public_display_name,
    publicBrandName: row.public_brand_name,
    publicBio: row.public_bio,
    legalName: row.legal_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    businessAddress: row.business_address,
    submittedAt: row.submitted_at?.toISOString() ?? null,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewedBy: row.reviewed_by,
    reviewReason: row.review_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const applicationColumns = `
  id,
  applicant_user_id,
  status,
  public_display_name,
  public_brand_name,
  public_bio,
  legal_name,
  contact_email,
  contact_phone,
  business_address,
  submitted_at,
  reviewed_at,
  reviewed_by,
  review_reason,
  created_at,
  updated_at
`;

export type CreateSupplierApplicationInput = {
  applicantUserId: string;
  publicDisplayName: string;
  publicBrandName: string | null;
  publicBio: string | null;
  legalName: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  requestId: string;
};

export async function createSupplierApplication(
  input: CreateSupplierApplicationInput,
): Promise<SupplierApplicationRecord> {
  return withTransaction(async (client) => {
    const result = await client.query<SupplierApplicationRow>(
      `INSERT INTO supplier_applications
         (id, applicant_user_id, public_display_name, public_brand_name, public_bio,
          legal_name, contact_email, contact_phone, business_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${applicationColumns}`,
      [
        randomUUID(),
        input.applicantUserId,
        input.publicDisplayName,
        input.publicBrandName,
        input.publicBio,
        input.legalName,
        input.contactEmail,
        input.contactPhone,
        input.businessAddress,
      ],
    );
    const application = result.rows[0];
    await appendApplicationEvent(client, {
      applicationId: application.id,
      actorUserId: input.applicantUserId,
      fromStatus: null,
      toStatus: "draft",
      reason: null,
    });
    await appendAuditLog(client, {
      actorUserId: input.applicantUserId,
      action: "supplier.application.created",
      resourceId: application.id,
      afterState: { status: "draft" },
      requestId: input.requestId,
    });

    return mapApplication(application);
  });
}

export async function getSupplierApplicationForOwner(
  applicationId: string,
  applicantUserId: string,
): Promise<SupplierApplicationRecord | null> {
  const result = await query<SupplierApplicationRow>(
    `SELECT ${applicationColumns}
     FROM supplier_applications
     WHERE id = $1 AND applicant_user_id = $2
     LIMIT 1`,
    [applicationId, applicantUserId],
  );
  return result.rows[0] ? mapApplication(result.rows[0]) : null;
}

export async function listSupplierApplicationsForOwner(
  applicantUserId: string,
  limit = 20,
): Promise<SupplierApplicationRecord[]> {
  const result = await query<SupplierApplicationRow>(
    `SELECT ${applicationColumns}
     FROM supplier_applications
     WHERE applicant_user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [applicantUserId, limit],
  );
  return result.rows.map(mapApplication);
}

export async function submitSupplierApplication(
  applicationId: string,
  applicantUserId: string,
  requestId: string,
): Promise<SupplierApplicationRecord> {
  return withTransaction(async (client) => {
    const application = await getApplicationForUpdate(client, applicationId, applicantUserId);
    assertSupplierApplicationTransition(application.status, "submitted");

    const result = await client.query<SupplierApplicationRow>(
      `UPDATE supplier_applications
       SET status = 'submitted', submitted_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING ${applicationColumns}`,
      [applicationId],
    );
    const updated = result.rows[0];
    await appendApplicationEvent(client, {
      applicationId,
      actorUserId: applicantUserId,
      fromStatus: application.status,
      toStatus: "submitted",
      reason: null,
    });
    await appendAuditLog(client, {
      actorUserId: applicantUserId,
      action: "supplier.application.submitted",
      resourceId: applicationId,
      beforeState: { status: application.status },
      afterState: { status: "submitted" },
      requestId,
    });

    return mapApplication(updated);
  });
}

export async function listSupplierApplicationsForReview(
  status: SupplierApplicationStatus | null,
  limit: number,
): Promise<SupplierApplicationRecord[]> {
  const result = status
    ? await query<SupplierApplicationRow>(
        `SELECT ${applicationColumns}
         FROM supplier_applications
         WHERE status = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [status, limit],
      )
    : await query<SupplierApplicationRow>(
        `SELECT ${applicationColumns}
         FROM supplier_applications
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );

  return result.rows.map(mapApplication);
}

export async function decideSupplierApplication(input: {
  applicationId: string;
  actorUserId: string;
  nextStatus: SupplierApplicationStatus;
  reason: string | null;
  requestId: string;
}): Promise<SupplierApplicationRecord> {
  return withTransaction(async (client) => {
    const application = await getApplicationForUpdate(client, input.applicationId);
    assertSupplierApplicationTransition(application.status, input.nextStatus);

    const result = await client.query<SupplierApplicationRow>(
      `UPDATE supplier_applications
       SET status = $2,
           reviewed_at = now(),
           reviewed_by = $3,
           review_reason = $4,
           updated_at = now()
       WHERE id = $1
       RETURNING ${applicationColumns}`,
      [input.applicationId, input.nextStatus, input.actorUserId, input.reason],
    );
    const updated = result.rows[0];

    await appendApplicationEvent(client, {
      applicationId: input.applicationId,
      actorUserId: input.actorUserId,
      fromStatus: application.status,
      toStatus: input.nextStatus,
      reason: input.reason,
    });
    await appendAuditLog(client, {
      actorUserId: input.actorUserId,
      action: `supplier.application.${input.nextStatus}`,
      resourceId: input.applicationId,
      beforeState: { status: application.status },
      afterState: { status: input.nextStatus },
      reason: input.reason,
      requestId: input.requestId,
    });

    if (input.nextStatus === "approved") {
      await upsertSupplierAccount(client, updated);
    } else if (input.nextStatus === "suspended" || input.nextStatus === "disabled") {
      await client.query(
        `UPDATE suppliers
         SET status = $2, updated_at = now()
         WHERE application_id = $1`,
        [updated.id, input.nextStatus],
      );
    }

    return mapApplication(updated);
  });
}

async function getApplicationForUpdate(
  client: PoolClient,
  applicationId: string,
  applicantUserId?: string,
): Promise<SupplierApplicationRow> {
  const result = applicantUserId
    ? await client.query<SupplierApplicationRow>(
        `SELECT ${applicationColumns}
         FROM supplier_applications
         WHERE id = $1 AND applicant_user_id = $2
         FOR UPDATE`,
        [applicationId, applicantUserId],
      )
    : await client.query<SupplierApplicationRow>(
        `SELECT ${applicationColumns}
         FROM supplier_applications
         WHERE id = $1
         FOR UPDATE`,
        [applicationId],
      );

  if (!result.rows[0]) {
    throw new Error("Supplier application was not found.");
  }
  return result.rows[0];
}

async function appendApplicationEvent(
  client: PoolClient,
  input: {
    applicationId: string;
    actorUserId: string | null;
    fromStatus: SupplierApplicationStatus | null;
    toStatus: SupplierApplicationStatus;
    reason: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO supplier_application_events
       (id, application_id, actor_user_id, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      input.applicationId,
      input.actorUserId,
      input.fromStatus,
      input.toStatus,
      input.reason,
    ],
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
    reason?: string | null;
    requestId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (id, actor_user_id, action, resource_type, resource_id,
        before_state, after_state, reason, request_id)
     VALUES ($1, $2, $3, 'supplier_application', $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.resourceId,
      input.beforeState ? JSON.stringify(input.beforeState) : null,
      input.afterState ? JSON.stringify(input.afterState) : null,
      input.reason ?? null,
      input.requestId,
    ],
  );
}

async function upsertSupplierAccount(
  client: PoolClient,
  application: SupplierApplicationRow,
): Promise<void> {
  const supplier = await client.query<{ id: string }>(
    `INSERT INTO suppliers
       (id, owner_user_id, application_id, public_display_name, public_brand_name, public_bio, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'approved')
     ON CONFLICT (owner_user_id) DO UPDATE
       SET application_id = EXCLUDED.application_id,
           public_display_name = EXCLUDED.public_display_name,
           public_brand_name = EXCLUDED.public_brand_name,
           public_bio = EXCLUDED.public_bio,
           status = 'approved',
           updated_at = now()
     RETURNING id`,
    [
      randomUUID(),
      application.applicant_user_id,
      application.id,
      application.public_display_name,
      application.public_brand_name,
      application.public_bio,
    ],
  );
  const supplierId = supplier.rows[0].id;

  await client.query(
    `INSERT INTO supplier_private_profiles
       (supplier_id, legal_name, contact_email, contact_phone, business_address)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (supplier_id) DO UPDATE
       SET legal_name = EXCLUDED.legal_name,
           contact_email = EXCLUDED.contact_email,
           contact_phone = EXCLUDED.contact_phone,
           business_address = EXCLUDED.business_address,
           updated_at = now()`,
    [
      supplierId,
      application.legal_name,
      application.contact_email,
      application.contact_phone,
      application.business_address,
    ],
  );

  const role = await client.query<{ id: string }>("SELECT id FROM roles WHERE key = 'supplier' LIMIT 1");
  if (!role.rows[0]) {
    throw new Error("The supplier system role is missing. Apply access migrations first.");
  }

  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [application.applicant_user_id, role.rows[0].id],
  );
}
