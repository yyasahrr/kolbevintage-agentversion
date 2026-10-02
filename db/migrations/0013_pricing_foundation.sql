-- Deterministic base pricing history for shared Retail and Wholesale order snapshots.
-- Discounts, tax, shipping rates, and payment remain separate boundaries.

CREATE TABLE IF NOT EXISTS variant_prices (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  market_type text NOT NULL CHECK (market_type IN ('retail', 'wholesale')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired')),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    (status = 'active' AND valid_until IS NULL)
    OR (status = 'retired' AND valid_until IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS variant_prices_current_idx
  ON variant_prices (variant_id, market_type, currency)
  WHERE status = 'active' AND valid_until IS NULL;
CREATE INDEX IF NOT EXISTS variant_prices_timeline_idx
  ON variant_prices (variant_id, market_type, currency, valid_from DESC);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS orders_pricing_quote_idx
  ON orders ((pricing_snapshot->>'quoteId'));

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000123', 'pricing:manage', 'Manage versioned variant prices')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('admin', 'super_admin')
  AND permission.key = 'pricing:manage'
ON CONFLICT DO NOTHING;
