export class InventoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "SOURCE_MISMATCH"
      | "NOT_AVAILABLE"
      | "INSUFFICIENT"
      | "IDEMPOTENCY_CONFLICT"
      | "INVALID_STATE"
      | "INTEGRITY_ERROR",
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

export class InventoryNotFoundError extends InventoryError {
  constructor() {
    super("The inventory item or warehouse location was not found.", "NOT_FOUND");
  }
}

export class InventorySourceMismatchError extends InventoryError {
  constructor() {
    super("The inventory source does not match the product owner.", "SOURCE_MISMATCH");
  }
}

export class InventoryNotAvailableError extends InventoryError {
  constructor() {
    super("The product or supplier is not available for this inventory operation.", "NOT_AVAILABLE");
  }
}

export class InventoryInsufficientError extends InventoryError {
  constructor(
    readonly requested: number,
    readonly available: number,
  ) {
    super("There is not enough available inventory.", "INSUFFICIENT");
  }
}

export class InventoryIdempotencyConflictError extends InventoryError {
  constructor() {
    super("The idempotency key was already used for a different inventory command.", "IDEMPOTENCY_CONFLICT");
  }
}

export class InventoryStateError extends InventoryError {
  constructor() {
    super("The inventory reservation is not in an operable state.", "INVALID_STATE");
  }
}

export class InventoryIntegrityError extends InventoryError {
  constructor() {
    super("The inventory balance is internally inconsistent.", "INTEGRITY_ERROR");
  }
}
