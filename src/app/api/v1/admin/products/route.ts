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
import { createCatalogProduct } from "@/server/catalog/product-repository";
import { productInputSchema } from "@/server/catalog/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }
    if (!(await userHasPermission(user.id, "catalog:manage"))) {
      return jsonError(403, "FORBIDDEN", "You cannot manage platform catalog products.", requestId);
    }

    const body = productInputSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The product payload is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const product = await createCatalogProduct({
      ...body.data,
      ownerType: "platform",
      supplierId: null,
      actorUserId: user.id,
      requestId,
    });
    return jsonNoStore({ product }, requestId, 201);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Catalog is temporarily unavailable.", requestId);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return jsonError(409, "CONFLICT", "The product slug, SKU, or barcode already exists.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The platform product could not be created.", requestId);
  }
}
