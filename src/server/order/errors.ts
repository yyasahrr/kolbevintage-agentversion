import type { OrderStatus } from "@/server/order/order-state";

export class OrderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "INVALID_STATE"
      | "NOT_ELIGIBLE"
      | "SNAPSHOT_MISMATCH"
      | "INTEGRITY_ERROR",
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export class OrderNotFoundError extends OrderError {
  constructor() {
    super("The order was not found.", "NOT_FOUND");
  }
}

export class OrderIdempotencyConflictError extends OrderError {
  constructor() {
    super("The order idempotency key was already used for different data.", "IDEMPOTENCY_CONFLICT");
  }
}

export class InvalidOrderStateError extends OrderError {
  constructor() {
    super("The order is not in an operable state.", "INVALID_STATE");
  }
}

export class WholesaleOrderNotEligibleError extends OrderError {
  constructor() {
    super("An active Wholesale membership is required for this order.", "NOT_ELIGIBLE");
  }
}

export class OrderSnapshotMismatchError extends OrderError {
  constructor() {
    super("The order item snapshot does not match the current catalog record.", "SNAPSHOT_MISMATCH");
  }
}

export class OrderIntegrityError extends OrderError {
  constructor() {
    super("The order record is internally inconsistent.", "INTEGRITY_ERROR");
  }
}

export type OrderStatusErrorContext = {
  from: OrderStatus;
  to: OrderStatus;
};
