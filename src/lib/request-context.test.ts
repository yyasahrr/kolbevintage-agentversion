import { describe, expect, it } from "vitest";
import { getRequestId } from "@/lib/request-context";

describe("request correlation", () => {
  it("preserves a safe caller request id", () => {
    const request = new Request("http://localhost/api/health", {
      headers: { "x-request-id": "checkout-123" },
    });

    expect(getRequestId(request)).toBe("checkout-123");
  });

  it("replaces an invalid request id", () => {
    const request = new Request("http://localhost/api/health", {
      headers: { "x-request-id": "<script>alert(1)</script>" },
    });

    const requestId = getRequestId(request);
    expect(requestId).not.toContain("<");
    expect(requestId.length).toBeGreaterThan(10);
  });
});
