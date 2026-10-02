import { getRequestId } from "@/lib/request-context";
import { jsonError, jsonNoStore } from "@/lib/http";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readJsonBody,
} from "@/lib/request-body";
import { log } from "@/lib/logger";
import { normalizeEmail } from "@/server/identity/credentials";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { publicUser } from "@/server/identity/authentication";
import { credentialsSchema } from "@/server/identity/validation";
import { hashPassword } from "@/server/identity/password";
import { buildSessionCookie } from "@/server/identity/session-cookie";
import { createSession } from "@/server/identity/session-repository";
import { createUser, isUniqueViolation } from "@/server/identity/user-repository";
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
      return jsonError(400, "BAD_REQUEST", "Email and password are required.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const email = body.data.email.trim();
    const emailNormalized = normalizeEmail(email);
    const rateLimit = await consumeRateLimits([
      {
        key: rateLimitKey("auth:register:ip", getClientAddress(request)),
        maxAttempts: 5,
        windowSeconds: 60 * 60,
        blockSeconds: 60 * 60,
      },
      {
        key: rateLimitKey("auth:register:email", emailNormalized),
        maxAttempts: 3,
        windowSeconds: 60 * 60,
        blockSeconds: 60 * 60,
      },
    ]);
    if (!rateLimit.allowed) {
      const response = jsonError(
        429,
        "RATE_LIMITED",
        "Too many registration attempts. Try again later.",
        requestId,
        { retryAfterSeconds: rateLimit.retryAfterSeconds },
      );
      response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
      return response;
    }

    const user = await createUser({
      email,
      emailNormalized,
      passwordHash: await hashPassword(body.data.password),
      requestId,
    });
    const session = await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipHash: null,
    });

    return jsonNoStore(
      { user: publicUser(user), session: { expiresAt: session.expiresAt } },
      requestId,
      201,
      { "set-cookie": buildSessionCookie(session.token) },
    );
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (isUniqueViolation(error)) {
      return jsonError(409, "CONFLICT", "An account with that email already exists.", requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Account registration is temporarily unavailable.", requestId);
    }

    log("error", "registration failed", { requestId, error: error instanceof Error ? error.name : "unknown" });
    return jsonError(500, "INTERNAL_ERROR", "The account could not be created.", requestId);
  }
}
