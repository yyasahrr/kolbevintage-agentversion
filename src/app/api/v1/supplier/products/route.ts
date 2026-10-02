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
import { getSupplierAccountForOwner } from "@/server/supplier/account-repository";
import { createCatalogProduct, listOwnedSupplierProducts } from "@/server/catalog/product-repository";
import { ProductOwnershipError } from "@/server/catalog/product-state";
import { productInputSchema } from "@/server/catalog/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getApprovedSupplier(request: Request, requestId: string) {
  const user = await getAuthenticatedUser(request);
  if (!user || user.status !== "active") {
    return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
  }
  if (!(await userHasPermission(user.id, "supplier:products:manage"))) {
    return jsonError(403, "FORBIDDEN", "You cannot manage supplier products.", requestId);
  }

  const supplier = await getSupplierAccountForOwner(user.id);
  if (!supplier || supplier.status !== "approved") {
    return jsonError(403, "FORBIDDEN", "An approved supplier account is required.", requestId);
  }

  return { user, supplier } as const;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const result = await getApprovedSupplier(request, requestId);
    if (result instanceof Response) return result;

    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
    const products = await listOwnedSupplierProducts(result.supplier.id, limit);
    return jsonNoStore({ products, limit }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier products are temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "Supplier products could not be loaded.", requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const result = await getApprovedSupplier(request, requestId);
    if (result instanceof Response) return result;

    const body = productInputSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The product payload is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    if (body.data.retailEnabled) {
      return jsonError(403, "FORBIDDEN", "Suppliers can create Wholesale products only.", requestId);
    }

    const product = await createCatalogProduct({
      ...body.data,
      retailEnabled: false,
      ownerType: "supplier",
      supplierId: result.supplier.id,
      actorUserId: result.user.id,
      requestId,
    });
    return jsonNoStore({ product }, requestId, 201);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (error instanceof ProductOwnershipError) {
      return jsonError(403, "FORBIDDEN", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier products are temporarily unavailable.", requestId);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return jsonError(409, "CONFLICT", "The product slug, SKU, or barcode already exists.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The supplier product could not be created.", requestId);
  }
}
