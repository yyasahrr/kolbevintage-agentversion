export const supplierApplicationStatuses = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "suspended",
  "disabled",
] as const;

export type SupplierApplicationStatus = (typeof supplierApplicationStatuses)[number];

const allowedTransitions: Record<SupplierApplicationStatus, readonly SupplierApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "changes_requested", "rejected"],
  under_review: ["changes_requested", "approved", "rejected"],
  changes_requested: ["submitted", "rejected"],
  approved: ["suspended", "disabled"],
  rejected: [],
  suspended: ["approved", "disabled"],
  disabled: [],
};

export class InvalidSupplierApplicationTransitionError extends Error {
  constructor(from: SupplierApplicationStatus, to: SupplierApplicationStatus) {
    super(`Supplier application cannot transition from ${from} to ${to}.`);
    this.name = "InvalidSupplierApplicationTransitionError";
  }
}

export function canTransitionSupplierApplication(
  from: SupplierApplicationStatus,
  to: SupplierApplicationStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertSupplierApplicationTransition(
  from: SupplierApplicationStatus,
  to: SupplierApplicationStatus,
): void {
  if (!canTransitionSupplierApplication(from, to)) {
    throw new InvalidSupplierApplicationTransitionError(from, to);
  }
}

export function requiresSupplierDecisionReason(status: SupplierApplicationStatus): boolean {
  return ["changes_requested", "rejected", "suspended", "disabled"].includes(status);
}
