import { getEnvironment } from "@/lib/env";
import { sessionLifetimeSeconds } from "@/server/identity/session-repository";

export const sessionCookieName = "kolbe_session";

function cookieAttributes(maxAge: number): string {
  const secure = getEnvironment().NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function buildSessionCookie(token: string): string {
  return `${sessionCookieName}=${token}; ${cookieAttributes(sessionLifetimeSeconds)}`;
}

export function buildClearedSessionCookie(): string {
  return `${sessionCookieName}=; ${cookieAttributes(0)}`;
}

export function getSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    if (name === sessionCookieName && /^[A-Za-z0-9_-]+$/.test(value)) {
      return value;
    }
  }

  return null;
}
