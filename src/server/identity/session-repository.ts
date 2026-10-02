import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query } from "@/server/db/pool";
import { findUserBySessionId, type UserRecord } from "@/server/identity/user-repository";

export const sessionLifetimeSeconds = 60 * 60 * 24 * 30;

export type CreatedSession = {
  token: string;
  expiresAt: string;
};

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  metadata: { userAgent: string | null; ipHash: string | null },
): Promise<CreatedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);

  await query(
    `INSERT INTO auth_sessions
       (id, user_id, token_hash, expires_at, user_agent, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      userId,
      hashSessionToken(token),
      expiresAt,
      metadata.userAgent,
      metadata.ipHash,
    ],
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

export async function findUserBySessionToken(token: string): Promise<UserRecord | null> {
  const result = await query<{ id: string }>(
    `UPDATE auth_sessions
     SET last_seen_at = now()
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()
     RETURNING id`,
    [hashSessionToken(token)],
  );

  if (!result.rows[0]) {
    return null;
  }

  return findUserBySessionId(result.rows[0].id);
}

export async function revokeSessionToken(token: string): Promise<void> {
  await query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE token_hash = $1`,
    [hashSessionToken(token)],
  );
}
