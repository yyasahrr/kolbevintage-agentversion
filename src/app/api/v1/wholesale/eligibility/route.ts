import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { getWholesaleEligibility } from "@/server/wholesale/eligibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    const eligibility = await getWholesaleEligibility(user.id);
    return jsonNoStore({ eligibility }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Wholesale eligibility is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "Wholesale eligibility could not be loaded.", requestId);
  }
}
