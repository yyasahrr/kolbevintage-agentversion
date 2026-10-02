-- Authorized inventory adjustments and holds.
-- Holds consume unavailable quantity without changing on-hand quantity.

CREATE TABLE IF NOT EXISTS inventory_holds (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released')),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  release_idempotency_key text UNIQUE
    CHECK (release_idempotency_key IS NULL OR char_length(release_idempotency_key) BETWEEN 1 AND 220),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  released_by uuid REFERENCES users (id) ON DELETE SET NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'active' AND release_idempotency_key IS NULL AND released_at IS NULL)
    OR (status = 'released' AND release_idempotency_key IS NOT NULL AND released_at IS NOT NULL)
  ),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_holds_active_idx
  ON inventory_holds (variant_id, location_id, status)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS inventory_holds_source_supplier_trigger ON inventory_holds;
CREATE TRIGGER inventory_holds_source_supplier_trigger
  BEFORE INSERT OR UPDATE ON inventory_holds
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_source_supplier();

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000121', 'inventory:adjust', 'Apply an authorized inventory adjustment'),
  ('00000000-0000-0000-0000-000000000122', 'inventory:hold', 'Place or release an inventory hold')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('warehouse_operator', 'admin', 'super_admin')
  AND permission.key IN ('inventory:adjust', 'inventory:hold')
ON CONFLICT DO NOTHING;
