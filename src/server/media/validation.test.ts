import { describe, expect, it } from "vitest";
import {
  buildMediaStorageKey,
  mediaExtension,
  mediaUploadRequestSchema,
} from "@/server/media/validation";

describe("catalog media boundary", () => {
  it("accepts bounded image metadata and rejects unsafe file names", () => {
    const valid = mediaUploadRequestSchema.safeParse({
      productId: "11111111-1111-4111-8111-111111111111",
      fileName: "front-view.png",
      mimeType: "image/png",
      byteSize: 120_000,
      checksumSha256: "a".repeat(64),
      altText: "Front view of the jacket",
    });
    const unsafe = mediaUploadRequestSchema.safeParse({
      productId: "11111111-1111-4111-8111-111111111111",
      fileName: "../private.txt",
      mimeType: "image/png",
      byteSize: 120_000,
      checksumSha256: "a".repeat(64),
      altText: "Unsafe",
    });

    expect(valid.success).toBe(true);
    expect(unsafe.success).toBe(false);
  });

  it("creates a provider-neutral key without using the client file name", () => {
    const key = buildMediaStorageKey({
      mediaId: "22222222-2222-4222-8222-222222222222",
      productId: "11111111-1111-4111-8111-111111111111",
      mimeType: "image/jpeg",
    });

    expect(key).toBe("products/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg");
    expect(mediaExtension("image/webp")).toBe("webp");
  });
});
