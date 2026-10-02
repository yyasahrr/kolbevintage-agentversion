import { getEnvironment } from "@/lib/env";
import { jsonNoStore } from "@/lib/http";
import { log } from "@/lib/logger";
import { getRequestId } from "@/lib/request-context";
import { buildLivenessStatus } from "@/lib/service-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  const requestId = getRequestId(request);
  const environment = getEnvironment();
  const status = buildLivenessStatus(environment.APP_NAME);

  log("info", "health check completed", { requestId, status: status.status });
  return jsonNoStore(status, requestId);
}
