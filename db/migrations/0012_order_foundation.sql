-- Shared Retail and Wholesale order snapshots and auditable state transitions.
-- Checkout, pricing calculation, reservations, payment, and fulfillment remain separate services.

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  order_number text NOT NULL UNIQUE CHECK (char_length(order_number) BETWEEN 8 AND 48),
  buyer_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  market_type text NOT NULL CHECK (market_type IN ('retail', 'wholesale')),
  wholesale_membership_id uuid REFERENCES wholesale_memberships (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_payment', 'confirmed', 'processing', 'fulfilled', 'cancelled')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  shipping_minor bigint NOT NULL CHECK (shipping_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  snapshot_version smallint NOT NULL DEFAULT 1 CHECK (snapshot_version > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  command_fingerprint text NOT NULL CHECK (char_length(command_fingerprint) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor + shipping_minor),
  CHECK (
    (market_type = 'retail' AND wholesale_membership_id IS NULL)
    OR (market_type = 'wholesale' AND wholesale_membership_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS orders_buyer_timeline_idx
  ON orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_timeline_idx
  ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_number),
  UNIQUE (order_id, variant_id)
);

CREATE INDEX IF NOT EXISTS order_items_variant_idx
  ON order_items (variant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  from_status text
    CHECK (from_status IS NULL OR from_status IN ('draft', 'pending_payment', 'confirmed', 'processing', 'fulfilled', 'cancelled')),
  to_status text NOT NULL
    CHECK (to_status IN ('draft', 'pending_payment', 'confirmed', 'processing', 'fulfilled', 'cancelled')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS order_events_timeline_idx
  ON order_events (order_id, created_at ASC);
