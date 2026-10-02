import { jsonError, jsonNoStore } from "@/lib/http";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import { getWholesaleEligibility } from "@/server/wholesale/eligibility";
import { getPublicProduct } from "@/server/catalog/product-repository";
import { productMarketSchema } from "@/server/catalog/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ productId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const url = new URL(request.url);
    const parsedMarket = productMarketSchema.safeParse(url.searchParams.get("market") ?? "retail");
    if (!parsedMarket.success) {
      return jsonError(400, "BAD_REQUEST", "Market must be retail or wholesale.", requestId);
    }
    const market = parsedMarket.data;

    if (market === "wholesale") {
      const user = await getAuthenticatedUser(request);
      if (!user || user.status !== "active") {
        return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
      }
      const eligibility = await getWholesaleEligibility(user.id);
      if (!eligibility.eligible) {
        return jsonError(403, "FORBIDDEN", "An active wholesale membership is required.", requestId);
      }
    }

    const { productId } = await context.params;
    const product = await getPublicProduct(productId, market);
    if (!product) {
      return jsonError(404, "NOT_FOUND", "Product not found.", requestId);
    }
    return jsonNoStore({ product, market }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Catalog is temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The product could not be loaded.", requestId);
  }
}
