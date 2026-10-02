export type ServiceCheckStatus = "ok" | "not_configured" | "unavailable";

export type ServiceCheck = {
  status: ServiceCheckStatus;
  detail?: string;
};

export type ServiceStatus = {
  status: "ok" | "not_ready";
  service: string;
  timestamp: string;
  checks: Record<string, ServiceCheck>;
};

export function buildLivenessStatus(service: string): ServiceStatus {
  return {
    status: "ok",
    service,
    timestamp: new Date().toISOString(),
    checks: {
      application: { status: "ok" },
    },
  };
}

export function buildReadinessStatus(
  service: string,
  database: { status: ServiceCheckStatus; detail?: string },
): ServiceStatus {
  return {
    status: database.status === "ok" ? "ok" : "not_ready",
    service,
    timestamp: new Date().toISOString(),
    checks: {
      application: { status: "ok" },
      database,
    },
  };
}
