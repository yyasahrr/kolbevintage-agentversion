export type OrderStatus =
  | "draft"
  | "pending_payment"
  | "confirmed"
  | "processing"
  | "fulfilled"
  | "cancelled";

const allowedTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

export class InvalidOrderTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Order cannot transition from ${from} to ${to}.`);
    this.name = "InvalidOrderTransitionError";
  }
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidOrderTransitionError(from, to);
  }
}

export function getAllowedOrderTransitions(status: OrderStatus): readonly OrderStatus[] {
  return allowedTransitions[status];
}
