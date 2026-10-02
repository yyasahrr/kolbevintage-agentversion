import { describe, expect, it } from "vitest";
import { supplierApplicationInputSchema, supplierReviewDecisionSchema } from "@/server/supplier/validation";

describe("supplier application validation", () => {
  it("accepts required application fields and optional public fields", () => {
    const result = supplierApplicationInputSchema.safeParse({
      publicDisplayName: "Studio A",
      publicBrandName: null,
      publicBio: "Public description",
      legalName: "Studio A LLC",
      contactEmail: "owner@example.com",
      contactPhone: "+1 555 0100",
      businessAddress: "100 Market Street",
    });

    expect(result.success).toBe(true);
  });

  it("does not allow an applicant to submit an approval decision", () => {
    const result = supplierReviewDecisionSchema.safeParse({ status: "approved" });
    expect(result.success).toBe(true);
    expect(supplierReviewDecisionSchema.safeParse({ status: "draft" }).success).toBe(false);
  });
});
