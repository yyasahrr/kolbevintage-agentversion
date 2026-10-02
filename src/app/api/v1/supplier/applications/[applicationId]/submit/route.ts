import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { submitSupplierApplication } from "@/server/supplier/application-repository";
import { InvalidSupplierApplicationTransitionError } from "@/server/supplier/application-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ applicationId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    const { applicationId } = await context.params;
    const application = await submitSupplierApplication(applicationId, user.id, requestId);
    return jsonNoStore({ application }, requestId);
  } catch (error) {
    if (error instanceof InvalidSupplierApplicationTransitionError) {
      return jsonError(409, "CONFLICT", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier applications are temporarily unavailable.", requestId);
    }
    if (error instanceof Error && error.message === "Supplier application was not found.") {
      return jsonError(404, "NOT_FOUND", "Supplier application not found.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The supplier application could not be submitted.", requestId);
  }
}
