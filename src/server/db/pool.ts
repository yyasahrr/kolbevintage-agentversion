import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { getDatabaseConfig, DatabaseNotConfiguredError } from "@/server/db/config";

const globalForDatabase = globalThis as unknown as {
  kolbeDatabasePool?: Pool;
};

export function getPool(): Pool {
  if (globalForDatabase.kolbeDatabasePool) {
    return globalForDatabase.kolbeDatabasePool;
  }

  const config = getDatabaseConfig();
  if (!config) {
    throw new DatabaseNotConfiguredError();
  }

  const pool = new Pool({
    connectionString: config.connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: config.ssl,
  });

  globalForDatabase.kolbeDatabasePool = pool;
  return pool;
}

export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(text, [...values]);
}

export type DatabaseHealth =
  | { status: "ok" }
  | { status: "not_configured"; detail: string }
  | { status: "unavailable"; detail: string };

const latestMigrationVersion = "0012_order_foundation";

export async function checkDatabase(): Promise<DatabaseHealth> {
  let config: ReturnType<typeof getDatabaseConfig>;
  try {
    config = getDatabaseConfig();
  } catch {
    return {
      status: "unavailable",
      detail: "The database configuration is invalid.",
    };
  }

  if (!config) {
    return {
      status: "not_configured",
      detail: "DATABASE_URL is not configured.",
    };
  }

  try {
    const result = await query<{ schema_migrations: string | null; current: boolean }>(
      `SELECT
         to_regclass('public.schema_migrations') AS schema_migrations,
         EXISTS (
           SELECT 1
           FROM schema_migrations
           WHERE version = $1
         ) AS current`,
      [latestMigrationVersion],
    );

    if (!result.rows[0]?.schema_migrations || !result.rows[0].current) {
      return {
        status: "unavailable",
        detail: "Database migrations are missing or out of date.",
      };
    }

    return { status: "ok" };
  } catch {
    return {
      status: "unavailable",
      detail: "The configured database did not respond to the migration health check.",
    };
  }
}
