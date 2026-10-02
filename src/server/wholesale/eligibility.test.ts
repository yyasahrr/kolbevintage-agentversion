import { describe, expect, it } from "vitest";
import { isMembershipActiveWindow } from "@/server/wholesale/eligibility";

describe("wholesale membership eligibility", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");

  it("requires active status and an inclusive start/exclusive end window", () => {
    expect(
      isMembershipActiveWindow(
        "active",
        new Date("2026-10-01T12:00:00.000Z"),
        new Date("2026-11-01T12:00:00.000Z"),
        now,
      ),
    ).toBe(true);
    expect(
      isMembershipActiveWindow(
        "active",
        new Date("2026-09-01T12:00:00.000Z"),
        new Date("2026-10-01T12:00:00.000Z"),
        now,
      ),
    ).toBe(false);
  });

  it("rejects pending, expired, suspended, and cancelled memberships", () => {
    for (const status of ["pending", "expired", "suspended", "cancelled"] as const) {
      expect(
        isMembershipActiveWindow(
          status,
          new Date("2026-09-01T12:00:00.000Z"),
          new Date("2026-11-01T12:00:00.000Z"),
          now,
        ),
      ).toBe(false);
    }
  });
});
