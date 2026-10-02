-- Transactional multi-line inventory reservation batches for shared orders.
-- Allocation locations and supplier sources are explicit; no hidden warehouse selection is performed.

CREATE TABLE IF NOT EXISTS inventory_reservation_batches (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  reference_type text,
  reference_id text,
  command_fingerprint text NOT NULL CHECK (char_length(command_fingerprint) = 64),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released')),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  release_idempotency_key text UNIQUE
    CHECK (release_idempotency_key IS NULL OR char_length(release_idempotency_key) BETWEEN 1 AND 200),
  release_command_fingerprint text
    CHECK (release_command_fingerprint IS NULL OR char_length(release_command_fingerprint) = 64),
  released_by uuid REFERENCES users (id) ON DELETE SET NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND release_idempotency_key IS NULL AND release_command_fingerprint IS NULL AND released_at IS NULL)
    OR (status = 'released' AND release_idempotency_key IS NOT NULL AND release_command_fingerprint IS NOT NULL AND released_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS inventory_reservation_batches_reference_idx
  ON inventory_reservation_batches (reference_type, reference_id, created_at DESC);

ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS reservation_batch_id uuid REFERENCES inventory_reservation_batches (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS inventory_reservations_batch_idx
  ON inventory_reservations (reservation_batch_id, status);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reservation_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS reservation_batch_id uuid REFERENCES inventory_reservation_batches (id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_reservation_status_check'
       AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_reservation_status_check
      CHECK (reservation_status IN ('not_started', 'reserved', 'released'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS orders_reservation_status_idx
  ON orders (reservation_status, updated_at DESC);
