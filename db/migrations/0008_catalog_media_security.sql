-- Secure catalog media metadata boundary.
-- Binary upload and signed delivery remain provider-adapter responsibilities.

ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS byte_size bigint,
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS width_pixels integer,
  ADD COLUMN IF NOT EXISTS height_pixels integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_scan',
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS scanned_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_media_storage_key_safe_check'
       AND conrelid = 'product_media'::regclass
  ) THEN
    ALTER TABLE product_media
      ADD CONSTRAINT product_media_storage_key_safe_check
      CHECK (
        storage_key ~ '^[a-z0-9][a-z0-9/_-]{0,499}$'
        AND storage_key NOT LIKE '%..%'
        AND storage_key NOT LIKE '/%'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_media_metadata_check'
       AND conrelid = 'product_media'::regclass
  ) THEN
    ALTER TABLE product_media
      ADD CONSTRAINT product_media_metadata_check
      CHECK (
        (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
        AND (byte_size IS NULL OR byte_size > 0)
        AND (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$')
        AND (width_pixels IS NULL OR width_pixels > 0)
        AND (height_pixels IS NULL OR height_pixels > 0)
        AND status IN ('pending_scan', 'available', 'quarantined', 'deleted')
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS product_media_status_idx
  ON product_media (product_id, status, sort_order, created_at);
