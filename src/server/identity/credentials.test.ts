import { describe, expect, it } from "vitest";
import {
  isAcceptablePassword,
  maximumPasswordLength,
  minimumPasswordLength,
  normalizeEmail,
} from "@/server/identity/credentials";

describe("identity credentials", () => {
  it("normalizes email for uniqueness checks", () => {
    expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("applies bounded password policy", () => {
    expect(isAcceptablePassword("x".repeat(minimumPasswordLength))).toBe(true);
    expect(isAcceptablePassword("x".repeat(minimumPasswordLength - 1))).toBe(false);
    expect(isAcceptablePassword("x".repeat(maximumPasswordLength + 1))).toBe(false);
  });
});
