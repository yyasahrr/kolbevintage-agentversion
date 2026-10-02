import { z } from "zod";
export const supplierApplicationInputSchema = z.object({
  publicDisplayName: z.string().trim().min(1).max(120),
  publicBrandName: z.string().trim().min(1).max(120).nullable().optional(),
  publicBio: z.string().trim().max(2000).nullable().optional(),
  legalName: z.string().trim().min(1).max(240),
  contactEmail: z.string().trim().email().max(320),
  contactPhone: z.string().trim().min(1).max(40),
  businessAddress: z.string().trim().min(1).max(1000),
});

export const supplierReviewDecisionSchema = z.object({
  status: z.enum([
    "under_review",
    "changes_requested",
    "approved",
    "rejected",
    "suspended",
    "disabled",
  ]),
  reason: z.string().trim().max(1000).nullable().optional(),
});

export type SupplierApplicationInput = z.infer<typeof supplierApplicationInputSchema>;
