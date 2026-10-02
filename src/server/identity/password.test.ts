import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/identity/password";

describe("password hashing", () => {
  it("verifies the original password without storing plaintext", async () => {
    const password = "A secure password with 12+ chars";
    const encodedHash = await hashPassword(password);

    expect(encodedHash).toMatch(/^scrypt\$/);
    expect(encodedHash).not.toContain(password);
    await expect(verifyPassword(password, encodedHash)).resolves.toBe(true);
    await expect(verifyPassword("not the password", encodedHash)).resolves.toBe(false);
  });

  it("rejects malformed or unsafe password hashes", async () => {
    await expect(verifyPassword("anything", "plaintext-password")).resolves.toBe(false);
    await expect(
      verifyPassword("anything", "scrypt$999999999$8$1$YWJj$YWJj"),
    ).resolves.toBe(false);
  });
});
