-- Central warehouse inventory foundation.
-- Inventory is separate from catalog pricing and is changed only through movements.

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL REFERENCES warehouses (id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS warehouse_locations_status_idx
  ON warehouse_locations (warehouse_id, status, code);

CREATE TABLE IF NOT EXISTS inventory_balances (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  on_hand_quantity integer NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  unavailable_quantity integer NOT NULL DEFAULT 0 CHECK (unavailable_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT,
  CHECK (reserved_quantity + unavailable_quantity <= on_hand_quantity)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_platform_balance_idx
  ON inventory_balances (variant_id, location_id)
  WHERE source_supplier_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_supplier_balance_idx
  ON inventory_balances (variant_id, location_id, source_supplier_id)
  WHERE source_supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_balances_location_idx
  ON inventory_balances (location_id, variant_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  movement_type text NOT NULL
    CHECK (movement_type IN (
      'receive', 'reserve', 'release', 'ship', 'return',
      'adjust', 'hold', 'release_hold', 'transfer_in', 'transfer_out'
    )),
  quantity_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  unavailable_delta integer NOT NULL DEFAULT 0,
  on_hand_after integer NOT NULL CHECK (on_hand_after >= 0),
  reserved_after integer NOT NULL CHECK (reserved_after >= 0),
  unavailable_after integer NOT NULL CHECK (unavailable_after >= 0),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 240),
  reference_type text,
  reference_id text,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT,
  CHECK (quantity_delta <> 0 OR reserved_delta <> 0 OR unavailable_delta <> 0),
  CHECK (on_hand_after >= reserved_after + unavailable_after)
);

CREATE INDEX IF NOT EXISTS inventory_movements_balance_timeline_idx
  ON inventory_movements (variant_id, location_id, created_at ASC);
CREATE INDEX IF NOT EXISTS inventory_movements_reference_idx
  ON inventory_movements (reference_type, reference_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released', 'consumed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  reference_type text,
  reference_id text,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_reservations_active_idx
  ON inventory_reservations (variant_id, location_id, status)
  WHERE status = 'active';

-- Enforce that a supplier-owned product can only be tracked against its own supplier
-- source, while platform-owned products must use a null source supplier. This keeps
-- central warehouse workflow integrity at the database boundary as well as in code.
CREATE OR REPLACE FUNCTION assert_inventory_source_supplier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  product_owner text;
  product_supplier_id uuid;
BEGIN
  SELECT owner_type, supplier_id
    INTO product_owner, product_supplier_id
    FROM products
   WHERE id = NEW.product_id;

  IF product_owner IS NULL THEN
    RAISE EXCEPTION 'Inventory product does not exist';
  END IF;

  IF product_owner = 'platform' AND NEW.source_supplier_id IS NOT NULL THEN
    RAISE EXCEPTION 'Platform inventory cannot have a supplier source';
  END IF;

  IF product_owner = 'supplier'
     AND (NEW.source_supplier_id IS NULL OR NEW.source_supplier_id <> product_supplier_id) THEN
    RAISE EXCEPTION 'Supplier inventory source does not match product owner';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_balances_source_supplier_trigger ON inventory_balances;
CREATE TRIGGER inventory_balances_source_supplier_trigger
  BEFORE INSERT OR UPDATE ON inventory_balances
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_source_supplier();

DROP TRIGGER IF EXISTS inventory_movements_source_supplier_trigger ON inventory_movements;
CREATE TRIGGER inventory_movements_source_supplier_trigger
  BEFORE INSERT OR UPDATE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_source_supplier();

DROP TRIGGER IF EXISTS inventory_reservations_source_supplier_trigger ON inventory_reservations;
CREATE TRIGGER inventory_reservations_source_supplier_trigger
  BEFORE INSERT OR UPDATE ON inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_source_supplier();

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000114', 'inventory:receive', 'Receive inventory through an approved warehouse workflow'),
  ('00000000-0000-0000-0000-000000000115', 'inventory:adjust', 'Apply an authorized inventory adjustment'),
  ('00000000-0000-0000-0000-000000000116', 'inventory:reserve', 'Reserve available inventory transactionally'),
  ('00000000-0000-0000-0000-000000000117', 'inventory:release', 'Release an active inventory reservation')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key = 'warehouse_operator'
  AND permission.key IN ('inventory:receive', 'inventory:adjust', 'inventory:release')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('admin', 'super_admin')
  AND permission.key IN ('inventory:receive', 'inventory:adjust', 'inventory:reserve', 'inventory:release')
ON CONFLICT DO NOTHING;
