import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { userHasPermission } from "@/server/identity/access-control";
import {
  listSupplierApplicationsForReview,
} from "@/server/supplier/application-repository";
import { supplierApplicationStatuses } from "@/server/supplier/application-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }
    if (!(await userHasPermission(user.id, "supplier:review"))) {
      return jsonError(403, "FORBIDDEN", "You cannot review supplier applications.", requestId);
    }

    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus && supplierApplicationStatuses.includes(rawStatus as (typeof supplierApplicationStatuses)[number])
      ? (rawStatus as (typeof supplierApplicationStatuses)[number])
      : null;
    const parsedLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;

    const applications = await listSupplierApplicationsForReview(status, limit);
    return jsonNoStore({ applications, limit }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier review is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "Supplier applications could not be loaded.", requestId);
  }
}
