import { z } from "zod";

const attributeObjectSchema = z.record(z.string().trim().min(1).max(80), z.unknown()).default({});

export const productVariantInputSchema = z.object({
  sku: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  barcode: z.string().trim().min(1).max(80).nullable().optional(),
  sizeLabel: z.string().trim().max(80).nullable().optional(),
  colorLabel: z.string().trim().max(80).nullable().optional(),
  attributes: attributeObjectSchema,
  weightGrams: z.number().int().positive().max(1_000_000).nullable().optional(),
});

export const productInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(20_000).nullable().optional(),
  brandName: z.string().trim().max(160).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  attributes: attributeObjectSchema,
  retailEnabled: z.boolean(),
  wholesaleEnabled: z.boolean(),
  variants: z.array(productVariantInputSchema).min(1).max(100),
});

export const productMarketSchema = z.enum(["retail", "wholesale"]);

export type ProductInput = z.infer<typeof productInputSchema>;
