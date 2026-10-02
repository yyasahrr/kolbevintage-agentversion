import { getSessionToken } from "@/server/identity/session-cookie";
import { findUserBySessionToken } from "@/server/identity/session-repository";
import type { UserRecord } from "@/server/identity/user-repository";

export async function getAuthenticatedUser(request: Request): Promise<UserRecord | null> {
  const token = getSessionToken(request);
  if (!token) {
    return null;
  }

  return findUserBySessionToken(token);
}

export function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    roles: user.roles,
  };
}
