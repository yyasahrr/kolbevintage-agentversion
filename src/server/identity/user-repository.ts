import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query } from "@/server/db/pool";
import { withTransaction } from "@/server/db/transaction";

export type UserStatus = "pending" | "active" | "suspended" | "disabled";

export type UserRecord = {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string | null;
  status: UserStatus;
  emailVerifiedAt: string | null;
  roles: string[];
};

type UserRow = {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string | null;
  status: UserStatus;
  email_verified_at: Date | null;
  roles: string[] | null;
};

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.email_normalized,
    passwordHash: row.password_hash,
    status: row.status,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    roles: row.roles ?? [],
  };
}

const userSelect = `
  SELECT
    u.id,
    u.email,
    u.email_normalized,
    u.password_hash,
    u.status,
    u.email_verified_at,
    COALESCE(
      array_agg(r.key) FILTER (WHERE r.key IS NOT NULL),
      ARRAY[]::text[]
    ) AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
`;

export async function findUserByEmail(emailNormalized: string): Promise<UserRecord | null> {
  const result = await query<UserRow>(
    `${userSelect} WHERE u.email_normalized = $1 GROUP BY u.id LIMIT 1`,
    [emailNormalized],
  );

  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findUserBySessionId(sessionId: string): Promise<UserRecord | null> {
  const result = await query<UserRow>(
    `SELECT
       u.id,
       u.email,
       u.email_normalized,
       u.password_hash,
       u.status,
       u.email_verified_at,
       COALESCE(
         array_agg(r.key) FILTER (WHERE r.key IS NOT NULL),
         ARRAY[]::text[]
       ) AS roles
     FROM users u
     INNER JOIN auth_sessions session ON session.user_id = u.id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE session.id = $1
       AND session.revoked_at IS NULL
       AND session.expires_at > now()
     GROUP BY u.id
     LIMIT 1`,
    [sessionId],
  );

  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export type CreateUserInput = {
  email: string;
  emailNormalized: string;
  passwordHash: string;
  requestId: string;
};

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  return withTransaction(async (client) => {
    const user = await client.query<UserRow>(
      `INSERT INTO users (id, email, email_normalized, password_hash, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, email, email_normalized, password_hash, status, email_verified_at,
         NULL::text[] AS roles`,
      [randomUUID(), input.email, input.emailNormalized, input.passwordHash],
    );

    const createdUser = user.rows[0];
    await assignCustomerRole(client, createdUser.id);
    await client.query(
      `INSERT INTO audit_log
         (id, actor_user_id, action, resource_type, resource_id, after_state, request_id)
       VALUES ($1, $2, 'identity.user.registered', 'user', $2, $3::jsonb, $4)`,
      [
        randomUUID(),
        createdUser.id,
        JSON.stringify({ status: createdUser.status }),
        input.requestId,
      ],
    );

    return mapUser({ ...createdUser, roles: ["customer"] });
  });
}

async function assignCustomerRole(client: PoolClient, userId: string): Promise<void> {
  const role = await client.query<{ id: string }>(
    "SELECT id FROM roles WHERE key = 'customer' LIMIT 1",
  );
  if (!role.rows[0]) {
    throw new Error("The customer system role is missing. Apply access migrations first.");
  }

  await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, role.rows[0].id],
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
