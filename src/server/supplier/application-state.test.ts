import { describe, expect, it } from "vitest";
import {
  assertSupplierApplicationTransition,
  canTransitionSupplierApplication,
  requiresSupplierDecisionReason,
} from "@/server/supplier/application-state";

describe("supplier application state machine", () => {
  it("allows the intended applicant and review transitions", () => {
    expect(canTransitionSupplierApplication("draft", "submitted")).toBe(true);
    expect(canTransitionSupplierApplication("changes_requested", "submitted")).toBe(true);
    expect(canTransitionSupplierApplication("under_review", "approved")).toBe(true);
    expect(canTransitionSupplierApplication("approved", "suspended")).toBe(true);
  });

  it("rejects invalid transitions and terminal states", () => {
    expect(canTransitionSupplierApplication("draft", "approved")).toBe(false);
    expect(canTransitionSupplierApplication("rejected", "submitted")).toBe(false);
    expect(() => assertSupplierApplicationTransition("approved", "draft")).toThrow(
      "cannot transition",
    );
  });

  it("requires reasons for negative review decisions", () => {
    expect(requiresSupplierDecisionReason("changes_requested")).toBe(true);
    expect(requiresSupplierDecisionReason("rejected")).toBe(true);
    expect(requiresSupplierDecisionReason("approved")).toBe(false);
  });
});
