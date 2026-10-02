import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { userHasPermission } from "@/server/identity/access-control";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { getSupplierAccountForOwner } from "@/server/supplier/account-repository";
import { publishOwnedCatalogProduct } from "@/server/catalog/product-repository";
import {
  InvalidProductTransitionError,
  ProductOwnershipError,
} from "@/server/catalog/product-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ productId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }
    if (!(await userHasPermission(user.id, "supplier:products:manage"))) {
      return jsonError(403, "FORBIDDEN", "You cannot publish supplier products.", requestId);
    }
    const supplier = await getSupplierAccountForOwner(user.id);
    if (!supplier || supplier.status !== "approved") {
      return jsonError(403, "FORBIDDEN", "An approved supplier account is required.", requestId);
    }

    const { productId } = await context.params;
    const product = await publishOwnedCatalogProduct({
      productId,
      actorUserId: user.id,
      ownerType: "supplier",
      supplierId: supplier.id,
      requestId,
    });
    return jsonNoStore({ product }, requestId);
  } catch (error) {
    if (error instanceof InvalidProductTransitionError) {
      return jsonError(409, "CONFLICT", error.message, requestId);
    }
    if (error instanceof ProductOwnershipError) {
      return jsonError(403, "FORBIDDEN", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier products are temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The supplier product could not be published.", requestId);
  }
}
