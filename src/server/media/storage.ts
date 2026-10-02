import type { SupportedMediaType } from "@/server/media/validation";

export type MediaUploadIntent = {
  storageKey: string;
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
};

export type CreateUploadIntentInput = {
  storageKey: string;
  mimeType: SupportedMediaType;
  byteSize: number;
  checksumSha256: string;
};

export interface MediaStorageAdapter {
  createUploadIntent(input: CreateUploadIntentInput): Promise<MediaUploadIntent>;
  createReadIntent(storageKey: string, expiresInSeconds: number): Promise<string>;
  deleteObject(storageKey: string): Promise<void>;
}

export class MediaStorageNotConfiguredError extends Error {
  constructor() {
    super("A media storage provider is not configured.");
    this.name = "MediaStorageNotConfiguredError";
  }
}

/**
 * The catalog never accepts a client-provided public URL. A real provider
 * adapter must implement signed upload/read intents before media endpoints are
 * enabled. This explicit failure is safer than silently storing fake URLs.
 */
export function getMediaStorageAdapter(): MediaStorageAdapter {
  throw new MediaStorageNotConfiguredError();
}
