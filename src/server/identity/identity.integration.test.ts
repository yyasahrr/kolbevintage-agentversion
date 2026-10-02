import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hashPassword } from "@/server/identity/password";
import {
  createUser,
  findUserByEmail,
} from "@/server/identity/user-repository";
import {
  createSession,
  findUserBySessionToken,
  revokeSessionToken,
} from "@/server/identity/session-repository";
import { query } from "@/server/db/pool";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const describeDatabase = describe.skipIf(!databaseConfigured);

let createdUserId: string | undefined;

describeDatabase("identity persistence", () => {
  afterEach(async () => {
    if (createdUserId) {
      await query("DELETE FROM users WHERE id = $1", [createdUserId]);
      createdUserId = undefined;
    }
  });

  it("creates a customer, reads it through a session, and revokes the session", async () => {
    const email = `${randomUUID()}@example.com`;
    const user = await createUser({
      email,
      emailNormalized: email,
      passwordHash: await hashPassword("A secure password with 12+ chars"),
      requestId: "integration-test",
    });
    createdUserId = user.id;

    expect(user.status).toBe("active");
    expect(user.roles).toContain("customer");
    await expect(findUserByEmail(email)).resolves.toMatchObject({ id: user.id, email });

    const session = await createSession(user.id, { userAgent: "integration-test", ipHash: null });
    await expect(findUserBySessionToken(session.token)).resolves.toMatchObject({ id: user.id });

    await revokeSessionToken(session.token);
    await expect(findUserBySessionToken(session.token)).resolves.toBeNull();
  });
});
