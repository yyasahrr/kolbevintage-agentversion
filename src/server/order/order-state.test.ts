import { describe, expect, it } from "vitest";
import { assertOrderTransition, getAllowedOrderTransitions, InvalidOrderTransitionError } from "@/server/order/order-state";

describe("order state machine", () => {
  it("allows the shared payment and fulfillment lifecycle", () => {
    expect(getAllowedOrderTransitions("draft")).toEqual(["pending_payment", "cancelled"]);
    expect(() => assertOrderTransition("draft", "pending_payment")).not.toThrow();
    expect(() => assertOrderTransition("pending_payment", "confirmed")).not.toThrow();
    expect(() => assertOrderTransition("confirmed", "processing")).not.toThrow();
    expect(() => assertOrderTransition("processing", "fulfilled")).not.toThrow();
  });

  it("does not invent a reverse or terminal transition", () => {
    expect(() => assertOrderTransition("fulfilled", "processing")).toThrow(InvalidOrderTransitionError);
    expect(() => assertOrderTransition("cancelled", "pending_payment")).toThrow(InvalidOrderTransitionError);
  });
});
