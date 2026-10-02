import { jsonError, jsonNoStore } from "@/lib/http";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readJsonBody,
} from "@/lib/request-body";
import { getRequestId } from "@/lib/request-context";
import { getAuthenticatedUser } from "@/server/identity/authentication";
import { isDatabaseUnavailable } from "@/server/identity/errors";
import {
  createSupplierApplication,
  listSupplierApplicationsForOwner,
} from "@/server/supplier/application-repository";
import { supplierApplicationInputSchema } from "@/server/supplier/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    const applications = await listSupplierApplicationsForOwner(user.id);
    return jsonNoStore({ applications }, requestId);
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier applications are temporarily unavailable.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "Supplier applications could not be loaded.", requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.status !== "active") {
      return jsonError(401, "UNAUTHORIZED", "Authentication is required.", requestId);
    }

    const body = supplierApplicationInputSchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return jsonError(400, "BAD_REQUEST", "The supplier application is invalid.", requestId, {
        fields: body.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const application = await createSupplierApplication({
      applicantUserId: user.id,
      publicDisplayName: body.data.publicDisplayName,
      publicBrandName: body.data.publicBrandName ?? null,
      publicBio: body.data.publicBio ?? null,
      legalName: body.data.legalName,
      contactEmail: body.data.contactEmail,
      contactPhone: body.data.contactPhone,
      businessAddress: body.data.businessAddress,
      requestId,
    });

    return jsonNoStore({ application }, requestId, 201);
  } catch (error) {
    if (error instanceof InvalidJsonBodyError || error instanceof RequestBodyTooLargeError) {
      return jsonError(400, "BAD_REQUEST", error.message, requestId);
    }
    if (isDatabaseUnavailable(error)) {
      return jsonError(503, "NOT_READY", "Supplier applications are temporarily unavailable.", requestId);
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return jsonError(409, "CONFLICT", "An open supplier application already exists.", requestId);
    }
    return jsonError(500, "INTERNAL_ERROR", "The supplier application could not be created.", requestId);
  }
}
