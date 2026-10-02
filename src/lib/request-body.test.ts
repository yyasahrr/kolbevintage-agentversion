import { describe, expect, it } from "vitest";
import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  readJsonBody,
} from "@/lib/request-body";

describe("JSON request body handling", () => {
  it("parses bounded JSON bodies", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost/api", {
          method: "POST",
          body: JSON.stringify({ email: "buyer@example.com" }),
        }),
      ),
    ).resolves.toEqual({ email: "buyer@example.com" });
  });

  it("rejects malformed JSON", async () => {
    await expect(
      readJsonBody(new Request("http://localhost/api", { method: "POST", body: "{" })),
    ).rejects.toBeInstanceOf(InvalidJsonBodyError);
  });

  it("rejects a declared oversized body before reading it", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost/api", {
          method: "POST",
          headers: { "content-length": "70000" },
          body: "{}",
        }),
      ),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
