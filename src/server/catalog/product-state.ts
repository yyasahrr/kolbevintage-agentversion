export type ProductStatus = "draft" | "active" | "archived" | "suspended";

const allowedTransitions: Record<ProductStatus, readonly ProductStatus[]> = {
  draft: ["active", "archived"],
  active: ["archived", "suspended"],
  suspended: ["active", "archived"],
  archived: [],
};

export class InvalidProductTransitionError extends Error {
  constructor(from: ProductStatus, to: ProductStatus) {
    super(`Product cannot transition from ${from} to ${to}.`);
    this.name = "InvalidProductTransitionError";
  }
}

export class ProductOwnershipError extends Error {
  constructor() {
    super("The authenticated actor does not own this product.");
    this.name = "ProductOwnershipError";
  }
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("Product was not found.");
    this.name = "ProductNotFoundError";
  }
}

export function assertProductTransition(from: ProductStatus, to: ProductStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidProductTransitionError(from, to);
  }
}
