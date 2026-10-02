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
import { inspectInventoryReceipt } from "@/server/inventory/inventory-repository";
import { inspectInventoryReceiptSchema } from "@/server/inventory/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ receiptId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }
    if (!(await userHasPermission(user.id, "inventory:qc"))) {
      return jsonError(403, "FORBIDDEN", "You cannot inspect warehouse receipts.", requestId);
    }

    const { receiptId } = await context.params;
    const rawBody = await readJsonBody(request);
    const bodyValue = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody as Record<string, unknown>
      : {};
    const body = inspectInventoryReceiptSchema.safeParse({
      ...bodyValue,
      receiptId,
    });
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The quality inspection payload is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const result = await inspectInventoryReceipt({
      ...body.data,
      actorUserId: user.id,
      requestId,
    });
    return jsonNoStore({ inspection: result }, requestId, result.idempotentReplay ? 200 : 201);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (error instanceof InventoryError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "INTEGRITY_ERROR" ? 500 : 409;
      return jsonError(
        status,
        status === 500 ? "INTERNAL_ERROR" : "CONFLICT",
        error.message,
        requestId,
      );
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Receipt inspection is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The receipt inspection could not be recorded.", requestId);
  }
}
