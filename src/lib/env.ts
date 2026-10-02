import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().trim().min(1).max(80).default("kolbe-vintage"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  AUTH_RATE_LIMIT_SECRET: z.string().trim().min(32).optional(),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

let cachedEnvironment: AppEnvironment | undefined;

/**
 * Reads only the runtime variables needed by the foundation layer.
 * Database and provider secrets will be added behind domain-specific config
 * modules when those integrations are implemented.
 */
export function getEnvironment(): AppEnvironment {
  if (!cachedEnvironment) {
    const parsed = environmentSchema.safeParse({
      NODE_ENV: process.env.NODE_ENV,
      APP_NAME: process.env.APP_NAME,
      LOG_LEVEL: process.env.LOG_LEVEL,
      AUTH_RATE_LIMIT_SECRET: process.env.AUTH_RATE_LIMIT_SECRET,
    });

    if (!parsed.success) {
      throw new Error(`Invalid runtime environment: ${parsed.error.message}`);
    }

    cachedEnvironment = parsed.data;
  }

  return cachedEnvironment;
}

export function resetEnvironmentForTests(): void {
  cachedEnvironment = undefined;
}
