import { describe, expect, it } from "vitest";
import { assertProductTransition } from "@/server/catalog/product-state";

describe("product lifecycle", () => {
  it("allows draft publishing and active suspension", () => {
    expect(() => assertProductTransition("draft", "active")).not.toThrow();
    expect(() => assertProductTransition("active", "suspended")).not.toThrow();
    expect(() => assertProductTransition("suspended", "active")).not.toThrow();
  });

  it("does not reopen archived products", () => {
    expect(() => assertProductTransition("archived", "active")).toThrow("cannot transition");
    expect(() => assertProductTransition("draft", "suspended")).toThrow("cannot transition");
  });
});
