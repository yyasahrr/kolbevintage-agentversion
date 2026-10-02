import { randomUUID } from "node:crypto";
import { z } from "zod";

export const supportedMediaTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedMediaType = (typeof supportedMediaTypes)[number];

const mediaType = z.enum(supportedMediaTypes);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const mediaUploadRequestSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  fileName: z.string().trim().min(1).max(180).regex(/^[^\\/]+$/),
  mimeType: mediaType,
  byteSize: z.number().int().positive().max(10 * 1024 * 1024),
  checksumSha256: sha256,
  altText: z.string().trim().min(1).max(240),
});

export type MediaUploadRequest = z.infer<typeof mediaUploadRequestSchema>;

export type MediaObjectIdentity = {
  mediaId?: string;
  productId: string;
  variantId?: string | null;
  mimeType: SupportedMediaType;
};

export function mediaExtension(mimeType: SupportedMediaType): "jpg" | "png" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

export function buildMediaStorageKey(input: MediaObjectIdentity): string {
  const mediaId = input.mediaId ?? randomUUID();
  const variantSegment = input.variantId ? `variants/${input.variantId}/` : "";
  return `products/${input.productId}/${variantSegment}${mediaId}.${mediaExtension(input.mimeType)}`;
}
