import { describe, expect, it } from "vitest";
import { buildLivenessStatus, buildReadinessStatus } from "@/lib/service-status";

describe("service status", () => {
  it("reports an application that is alive", () => {
    const status = buildLivenessStatus("test-service");

    expect(status.status).toBe("ok");
    expect(status.service).toBe("test-service");
    expect(status.checks.application.status).toBe("ok");
    expect(Number.isNaN(Date.parse(status.timestamp))).toBe(false);
  });

  it("does not claim readiness when the database is not configured", () => {
    const status = buildReadinessStatus("test-service", {
      status: "not_configured",
      detail: "DATABASE_URL is not configured.",
    });

    expect(status.status).toBe("not_ready");
    expect(status.checks.database.status).toBe("not_configured");
  });
});
