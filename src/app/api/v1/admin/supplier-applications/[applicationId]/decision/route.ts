import { jsonError, jsonNoStore } from "@/lib/http";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readJsonBody,
} from "@/lib/request-body";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { userHasPermission } from "@/server/identity/access-control";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { decideSupplierApplication } from "@/server/supplier/application-repository";
import {
  InvalidSupplierApplicationTransitionError,
  requiresSupplierDecisionReason,
} from "@/server/supplier/application-state";
import { supplierReviewDecisionSchema } from "@/server/supplier/validation";

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
    if (!(await userHasPermission(user.id, "supplier:review"))) {
      return jsonError(403, "FORBIDDEN", "You cannot review supplier applications.", requestId);
    }

    const body = supplierReviewDecisionSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The supplier review decision is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const reason = body.data.reason ?? null;
    if (requiresSupplierDecisionReason(body.data.status) && !reason) {
      return jsonError(400, "BAD_REQUEST", "A reason is required for this decision.", requestId);
    }

    const { applicationId } = await context.params;
    const application = await decideSupplierApplication({
      applicationId,
      actorUserId: user.id,
      nextStatus: body.data.status,
      reason,
      requestId,
    });

    return jsonNoStore({ application }, requestId);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (error instanceof InvalidSupplierApplicationTransitionError) {
      return jsonError(409, "CONFLICT", error.message, requestId);
    }
    if (error instanceof Error && error.message === "Supplier application was not found.") {
      return jsonError(404, "NOT_FOUND", "Supplier application not found.", requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier review is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The supplier decision could not be saved.", requestId);
  }
}
