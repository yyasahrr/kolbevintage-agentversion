-- Inbound receipt and quality-control state for central warehouse inventory.

ALTER TABLE inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (movement_type IN (
    'receive', 'qc_pass', 'qc_fail', 'reserve', 'release', 'ship', 'return',
    'adjust', 'hold', 'release_hold', 'transfer_in', 'transfer_out'
  ));

CREATE TABLE IF NOT EXISTS inventory_receipts (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  quantity_received integer NOT NULL CHECK (quantity_received > 0),
  quantity_accepted integer NOT NULL DEFAULT 0 CHECK (quantity_accepted >= 0),
  quantity_rejected integer NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0),
  status text NOT NULL DEFAULT 'pending_qc'
    CHECK (status IN ('pending_qc', 'accepted', 'partially_rejected', 'rejected')),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  qc_idempotency_key text UNIQUE CHECK (qc_idempotency_key IS NULL OR char_length(qc_idempotency_key) BETWEEN 1 AND 220),
  received_by uuid REFERENCES users (id) ON DELETE SET NULL,
  qc_by uuid REFERENCES users (id) ON DELETE SET NULL,
  qc_reason text CHECK (qc_reason IS NULL OR char_length(qc_reason) BETWEEN 1 AND 1000),
  received_at timestamptz NOT NULL DEFAULT now(),
  inspected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT,
  CHECK (quantity_accepted + quantity_rejected <= quantity_received)
);

CREATE INDEX IF NOT EXISTS inventory_receipts_pending_idx
  ON inventory_receipts (location_id, status, received_at)
  WHERE status = 'pending_qc';
CREATE INDEX IF NOT EXISTS inventory_receipts_variant_idx
  ON inventory_receipts (variant_id, location_id, received_at DESC);

DROP TRIGGER IF EXISTS inventory_receipts_source_supplier_trigger ON inventory_receipts;
CREATE TRIGGER inventory_receipts_source_supplier_trigger
  BEFORE INSERT OR UPDATE ON inventory_receipts
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_source_supplier();

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000118', 'inventory:qc', 'Inspect and accept or reject received inventory')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('warehouse_operator', 'admin', 'super_admin')
  AND permission.key = 'inventory:qc'
ON CONFLICT DO NOTHING;
