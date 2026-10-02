import { describe, expect, it } from "vitest";
import { toPublicSupplierProfile } from "@/server/supplier/public-profile";

describe("supplier public profile projection", () => {
  it("returns only buyer-safe public fields", () => {
    const profile = toPublicSupplierProfile({
      id: "supplier-a",
      public_display_name: "Studio A",
      public_brand_name: "Brand A",
      public_bio: "A public description.",
    });

    expect(profile).toEqual({
      id: "supplier-a",
      displayName: "Studio A",
      brandName: "Brand A",
      bio: "A public description.",
      status: "approved",
    });
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("phone");
    expect(profile).not.toHaveProperty("businessAddress");
    expect(profile).not.toHaveProperty("internalNotes");
  });
});
