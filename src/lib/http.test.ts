import { describe, expect, it } from "vitest";
import { jsonError, jsonNoStore } from "@/lib/http";

describe("HTTP responses", () => {
  it("returns a stable, cache-disabled error response", async () => {
    const response = jsonError(400, "BAD_REQUEST", "The request is invalid.", "request-123", {
      field: "email",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(body).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "The request is invalid.",
        requestId: "request-123",
        details: { field: "email" },
      },
    });
  });

  it("supports controlled response headers without enabling caching", () => {
    const response = jsonNoStore({ ok: true }, "request-123", 200, {
      "set-cookie": "kolbe_session=token",
    });

    expect(response.headers.get("set-cookie")).toBe("kolbe_session=token");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
