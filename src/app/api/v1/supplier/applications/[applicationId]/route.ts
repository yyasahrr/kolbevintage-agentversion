import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { getSupplierApplicationForOwner } from "@/server/supplier/application-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    const { applicationId } = await context.params;
    const application = await getSupplierApplicationForOwner(applicationId, user.id);
    if (!application) {
      return jsonError(404, "NOT_FOUND", "Supplier application not found.", requestId);
    }

    return jsonNoStore({ application }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier applications are temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "Supplier application could not be loaded.", requestId);
  }
}
