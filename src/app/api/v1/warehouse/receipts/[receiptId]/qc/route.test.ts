import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvironmentForTests } from "@/lib/env";
import { POST } from "@/app/api/v1/warehouse/receipts/[receiptId]/qc/route";

describe("POST /api/v1/warehouse/receipts/:receiptId/qc", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetEnvironmentForTests();
  });

  it("requires an authenticated warehouse operator", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/warehouse/receipts/33333333-3333-4333-8333-333333333333/qc", {
        method: "POST",
        body: JSON.stringify({
          acceptedQuantity: 1,
          rejectedQuantity: 0,
          idempotencyKey: "qc-1",
        }),
      }),
      { params: Promise.resolve({ receiptId: "33333333-3333-4333-8333-333333333333" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
