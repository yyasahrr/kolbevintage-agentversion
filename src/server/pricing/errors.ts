export class PricingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "NOT_AVAILABLE"
      | "INVALID_PRICE"
      | "INTEGRITY_ERROR",
  ) {
    super(message);
    this.name = "PricingError";
  }
}

export class PriceNotFoundError extends PricingError {
  constructor() {
    super("No effective price exists for this variant and market.", "NOT_FOUND");
  }
}

export class PriceNotAvailableError extends PricingError {
  constructor() {
    super("The variant is not available in this market.", "NOT_AVAILABLE");
  }
}

export class InvalidPriceError extends PricingError {
  constructor() {
    super("The price is outside the supported integer minor-unit range.", "INVALID_PRICE");
  }
}

export class PricingIntegrityError extends PricingError {
  constructor() {
    super("The pricing record is internally inconsistent.", "INTEGRITY_ERROR");
  }
}
