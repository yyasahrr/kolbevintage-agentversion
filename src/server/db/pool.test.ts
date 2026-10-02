import { beforeEach, describe, expect, it } from "vitest";
import { getDatabaseConfig } from "@/server/db/config";
import { checkDatabase } from "@/server/db/pool";

describe("database configuration", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_SSL;
  });

  it("reports an unconfigured database without opening a connection", async () => {
    expect(getDatabaseConfig()).toBeNull();
    await expect(checkDatabase()).resolves.toEqual({
      status: "not_configured",
      detail: "DATABASE_URL is not configured.",
    });
  });

  it("rejects non-PostgreSQL connection strings", async () => {
    process.env.DATABASE_URL = "mysql://localhost/test";

    expect(() => getDatabaseConfig()).toThrow("Invalid database configuration");
    await expect(checkDatabase()).resolves.toEqual({
      status: "unavailable",
      detail: "The database configuration is invalid.",
    });
  });
});
