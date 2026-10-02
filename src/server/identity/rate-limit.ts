import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { getEnvironment } from "@/lib/env";
import { withTransaction } from "@/server/db/transaction";

const developmentSecret = "kolbe-vintage-development-rate-limit-secret";

type RateLimitBucket = {
  bucket_key: string;
  window_started_at: Date;
  attempts: number;
  blocked_until: Date | null;
};

export type RateLimitRule = {
  key: string;
  maxAttempts: number;
  windowSeconds: number;
  blockSeconds: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

function getRateLimitSecret(): string {
  const configured = process.env.AUTH_RATE_LIMIT_SECRET?.trim();
  if (configured && configured.length >= 32) {
    return configured;
  }

  if (getEnvironment().NODE_ENV === "production") {
    throw new Error("AUTH_RATE_LIMIT_SECRET must be configured in production.");
  }

  return developmentSecret;
}

export function rateLimitKey(scope: string, value: string): string {
  return createHmac("sha256", getRateLimitSecret())
    .update(`${scope}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

export function getClientAddress(request: Request): string {
  const directAddress = request.headers.get("x-real-ip")?.trim();
  if (directAddress && directAddress.length <= 255) {
    return directAddress;
  }

  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedAddress && forwardedAddress.length <= 255) {
    return forwardedAddress;
  }

  return "unknown";
}

export function retryAfterSeconds(until: Date, now = new Date()): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

export async function consumeRateLimits(rules: readonly RateLimitRule[]): Promise<RateLimitDecision> {
  if (rules.length === 0) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return withTransaction(async (client) => {
    const now = new Date();
    const buckets: Array<{
      rule: RateLimitRule;
      bucket: RateLimitBucket;
      nextAttempts: number;
      nextWindowStartedAt: Date;
    }> = [];

    for (const rule of rules) {
      if (
        !Number.isInteger(rule.maxAttempts) || rule.maxAttempts < 1
        || !Number.isInteger(rule.windowSeconds) || rule.windowSeconds < 1
        || !Number.isInteger(rule.blockSeconds) || rule.blockSeconds < 1
      ) {
        throw new Error("Invalid rate-limit rule.");
      }

      await client.query(
        `INSERT INTO auth_rate_limit_buckets (bucket_key, window_started_at)
         VALUES ($1, $2)
         ON CONFLICT (bucket_key) DO NOTHING`,
        [rule.key, now],
      );
      const result = await client.query<RateLimitBucket>(
        `SELECT bucket_key, window_started_at, attempts, blocked_until
         FROM auth_rate_limit_buckets
         WHERE bucket_key = $1
         FOR UPDATE`,
        [rule.key],
      );
      const bucket = result.rows[0];
      if (!bucket) {
        throw new Error("Rate-limit bucket could not be loaded.");
      }

      const windowExpired = bucket.window_started_at.getTime() + rule.windowSeconds * 1000 <= now.getTime();
      buckets.push({
        rule,
        bucket,
        nextAttempts: windowExpired ? 1 : bucket.attempts + 1,
        nextWindowStartedAt: windowExpired ? now : bucket.window_started_at,
      });
    }

    let retryAfter = 0;
    for (const { rule, bucket, nextAttempts, nextWindowStartedAt } of buckets) {
      const currentBlock = bucket.blocked_until && bucket.blocked_until.getTime() > now.getTime()
        ? retryAfterSeconds(bucket.blocked_until, now)
        : 0;
      const exceeded = !currentBlock && nextAttempts > rule.maxAttempts;
      const candidateRetryAfter = currentBlock || (exceeded ? rule.blockSeconds : 0);
      retryAfter = Math.max(retryAfter, candidateRetryAfter);

      const blockedUntil = candidateRetryAfter
        ? new Date(now.getTime() + candidateRetryAfter * 1000)
        : null;
      await updateBucket(client, {
        key: bucket.bucket_key,
        windowStartedAt: nextWindowStartedAt,
        attempts: nextAttempts,
        blockedUntil,
      });
    }

    return {
      allowed: retryAfter === 0,
      retryAfterSeconds: retryAfter,
    };
  });
}

export async function clearRateLimit(key: string): Promise<void> {
  await withTransaction(async (client) => {
    await updateBucket(client, {
      key,
      windowStartedAt: new Date(),
      attempts: 0,
      blockedUntil: null,
    });
  });
}

async function updateBucket(
  client: PoolClient,
  input: {
    key: string;
    windowStartedAt: Date;
    attempts: number;
    blockedUntil: Date | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE auth_rate_limit_buckets
     SET window_started_at = $2,
         attempts = $3,
         blocked_until = $4,
         updated_at = now()
     WHERE bucket_key = $1`,
    [input.key, input.windowStartedAt, input.attempts, input.blockedUntil],
  );
}
