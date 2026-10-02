import { getEnvironment } from "@/lib/env";
import { jsonNoStore } from "@/lib/http";
import { log } from "@/lib/logger";
import { getRequestId } from "@/lib/request-context";
import { buildReadinessStatus } from "@/lib/service-status";
import { checkDatabase } from "@/server/db/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const environment = getEnvironment();
  const database = await checkDatabase();
  const status = buildReadinessStatus(environment.APP_NAME, database);

  log(status.status === "ok" ? "info" : "warn", "readiness check completed", {
    requestId,
    status: status.status,
    database: database.status,
  });

  return jsonNoStore(status, requestId, status.status === "ok" ? 200 : 503);
}
