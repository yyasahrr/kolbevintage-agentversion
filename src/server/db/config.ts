import { z } from "zod";

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.string().trim().startsWith("postgresql://"),
  DATABASE_SSL: z.enum(["true", "false"]).default("false"),
});

export type DatabaseConfig = {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
};

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getDatabaseConfig(): DatabaseConfig | null {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl) {
    return null;
  }

  const parsed = databaseEnvironmentSchema.safeParse({
    DATABASE_URL: rawDatabaseUrl,
    DATABASE_SSL: process.env.DATABASE_SSL ?? "false",
  });

  if (!parsed.success) {
    throw new Error(`Invalid database configuration: ${parsed.error.message}`);
  }

  return {
    connectionString: parsed.data.DATABASE_URL,
    ssl: parsed.data.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : false,
  };
}
