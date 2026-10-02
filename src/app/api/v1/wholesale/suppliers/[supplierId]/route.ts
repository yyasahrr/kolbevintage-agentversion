import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { getWholesaleEligibility } from "@/server/wholesale/eligibility";
import { getApprovedPublicSupplier } from "@/server/supplier/public-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ supplierId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    const eligibility = await getWholesaleEligibility(user.id);
    if (!eligibility.eligible) {
      return jsonError(403, "FORBIDDEN", "An active wholesale membership is required.", requestId);
    }

    const { supplierId } = await context.params;
    const supplier = await getApprovedPublicSupplier(supplierId);
    if (!supplier) {
      return jsonError(404, "NOT_FOUND", "Supplier not found.", requestId);
    }

    return jsonNoStore({ supplier }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Wholesale supplier data is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "Supplier data could not be loaded.", requestId);
  }
}
