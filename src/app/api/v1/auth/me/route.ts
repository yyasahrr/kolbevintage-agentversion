import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { getAuthenticatedUser, publicUser } from "@/server/identity/authentication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    return jsonNoStore({ user: publicUser(user) }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Authentication is temporarily unavailable.", requestId);
    }

    return jsonError(500, "INTERNAL_ERROR", "The account could not be loaded.", requestId);
  }
}
