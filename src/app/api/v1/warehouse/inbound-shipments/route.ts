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
import { InventoryError } from "@/server/inventory/errors";
import { createInboundShipment } from "@/server/inventory/inventory-repository";
import { createInboundShipmentSchema } from "@/server/inventory/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }
    if (!(await userHasPermission(user.id, "inventory:shipments:manage"))) {
      return jsonError(403, "FORBIDDEN", "You cannot create inbound shipments.", requestId);
    }

    const body = createInboundShipmentSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The inbound shipment payload is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const shipment = await createInboundShipment({
      ...body.data,
      actorUserId: user.id,
      requestId,
    });
    return jsonNoStore({ shipment }, requestId, 201);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (error instanceof InventoryError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "INTEGRITY_ERROR" ? 500 : 409;
      return jsonError(status, status === 500 ? "INTERNAL_ERROR" : "CONFLICT", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Inbound shipment creation is temporarily unavailable.", requestId);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return jsonError(409, "CONFLICT", "The shipment reference already exists.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The inbound shipment could not be created.", requestId);
  }
}
