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
import { InventoryError, InventoryInsufficientError } from "@/server/inventory/errors";
import { placeInventoryHold } from "@/server/inventory/inventory-repository";
import { placeInventoryHoldSchema } from "@/server/inventory/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }
    if (!(await userHasPermission(user.id, "inventory:hold"))) {
      return jsonError(403, "FORBIDDEN", "You cannot place inventory holds.", requestId);
    }
    const body = placeInventoryHoldSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The inventory hold payload is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const hold = await placeInventoryHold({ ...body.data, actorUserId: user.id, requestId });
    return jsonNoStore({ hold }, requestId, hold.idempotentReplay ? 200 : 201);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (error instanceof InventoryInsufficientError) {
      return jsonError(409, "CONFLICT", error.message, requestId, {
        requested: error.requested,
        available: error.available,
      });
    }
    if (error instanceof InventoryError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "INTEGRITY_ERROR" ? 500 : 409;
      return jsonError(status, status === 500 ? "INTERNAL_ERROR" : "CONFLICT", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Inventory hold is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The inventory hold could not be recorded.", requestId);
  }
}
