import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readJsonBody,
} from "@/lib/request-body";
import { log } from "@/lib/logger";
import { normalizeEmail } from "@/server/identity/credentials";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { credentialsSchema } from "@/server/identity/validation";
import { verifyPassword } from "@/server/identity/password";
import { buildSessionCookie } from "@/server/identity/session-cookie";
import { createSession } from "@/server/identity/session-repository";
import { findUserByEmail } from "@/server/identity/user-repository";
import { publicUser } from "@/server/identity/authentication";
import {
  consumeRateLimits,
  getClientAddress,
  rateLimitKey,
} from "@/server/identity/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const body = credentialsSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "Email and password are required.", requestId);
    }

    const emailNormalized = normalizeEmail(body.data.email);
    const rateLimit = await consumeRateLimits([
      {
        key: rateLimitKey("auth:login:ip", getClientAddress(request)),
        maxAttempts: 20,
        windowSeconds: 15 * 60,
        blockSeconds: 15 * 60,
      },
      {
        key: rateLimitKey("auth:login:email", emailNormalized),
        maxAttempts: 5,
        windowSeconds: 15 * 60,
        blockSeconds: 15 * 60,
      },
    ]);
    if (!rateLimit.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Too many login attempts. Try again later.",
        requestId,
        { retryAfterSeconds: rateLimit.retryAfterSeconds },
      );
      response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const user = await findUserByEmail(emailNormalized);
    const validPassword = user?.passwordHash
      ? await verifyPassword(body.data.password, user.passwordHash)
      : false;

    if (!user || !validPassword || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Email or password is incorrect.", requestId);
    }

    const session = await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipHash: null,
    });

    return jsonNoStore(
      { user: publicUser(user), session: { expiresAt: session.expiresAt } },
      requestId,
      200,
      { "set-cookie": buildSessionCookie(session.token) },
    );
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Login is temporarily unavailable.", requestId);
    }

    log("error", "login failed", { requestId, error: error instanceof Error ? error.name : "unknown" });
    return jsonError(500, "INTERNAL_ERROR", "Login could not be completed.", requestId);
  }
}
