import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { query } from "@/server/db/pool";
import {
  consumeRateLimits,
  rateLimitKey,
} from "@/server/identity/rate-limit";

const describeDatabase = describe.skipIf(!process.env.DATABASE_URL);
const createdKeys: string[] = [];

describeDatabase("authentication rate-limit persistence", () => {
  afterEach(async () => {
    if (createdKeys.length) {
      await query("DELETE FROM auth_rate_limit_buckets WHERE bucket_key = ANY($1::text[])", [createdKeys]);
      createdKeys.length = 0;
    }
  });

  it("atomically allows the configured attempts and blocks the next one", async () => {
    const key = rateLimitKey("integration", randomUUID());
    createdKeys.push(key);
    const rule = {
      key,
      maxAttempts: 2,
      windowSeconds: 60,
      blockSeconds: 30,
    };

    await expect(consumeRateLimits([rule])).resolves.toMatchObject({ allowed: true });
    await expect(consumeRateLimits([rule])).resolves.toMatchObject({ allowed: true });
    await expect(consumeRateLimits([rule])).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 30,
    });
  });
});
