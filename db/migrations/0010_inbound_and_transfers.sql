-- Inbound shipment records and central warehouse transfers.

CREATE TABLE IF NOT EXISTS inbound_shipments (
  id uuid PRIMARY KEY,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  reference_code text NOT NULL UNIQUE CHECK (char_length(reference_code) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'partially_received', 'received', 'cancelled')),
  expected_at timestamptz,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_shipments_supplier_status_idx
  ON inbound_shipments (source_supplier_id, status, expected_at);

CREATE TABLE IF NOT EXISTS inbound_shipment_items (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES inbound_shipments (id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  expected_quantity integer NOT NULL CHECK (expected_quantity > 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  accepted_quantity integer NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity integer NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  status text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected', 'partially_received', 'received', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, variant_id),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT,
  CHECK (received_quantity <= expected_quantity),
  CHECK (accepted_quantity + rejected_quantity <= received_quantity)
);

CREATE INDEX IF NOT EXISTS inbound_shipment_items_variant_idx
  ON inbound_shipment_items (variant_id, shipment_id);

CREATE OR REPLACE FUNCTION assert_inbound_shipment_item_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  shipment_supplier_id uuid;
  product_owner text;
  product_supplier_id uuid;
BEGIN
  SELECT source_supplier_id INTO shipment_supplier_id
    FROM inbound_shipments
   WHERE id = NEW.shipment_id;
  SELECT owner_type, supplier_id INTO product_owner, product_supplier_id
    FROM products
   WHERE id = NEW.product_id;

  IF product_owner = 'platform' AND shipment_supplier_id IS NOT NULL THEN
    RAISE EXCEPTION 'Platform shipment cannot contain supplier-sourced product';
  END IF;
  IF product_owner = 'supplier'
     AND (shipment_supplier_id IS NULL OR shipment_supplier_id <> product_supplier_id) THEN
    RAISE EXCEPTION 'Shipment supplier does not match product owner';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inbound_shipment_item_owner_trigger ON inbound_shipment_items;
CREATE TRIGGER inbound_shipment_item_owner_trigger
  BEFORE INSERT OR UPDATE ON inbound_shipment_items
  FOR EACH ROW EXECUTE FUNCTION assert_inbound_shipment_item_owner();

CREATE TABLE IF NOT EXISTS inbound_shipment_events (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES inbound_shipments (id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_receipts
  ADD COLUMN IF NOT EXISTS shipment_id uuid,
  ADD COLUMN IF NOT EXISTS shipment_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_receipts_shipment_fk'
       AND conrelid = 'inventory_receipts'::regclass
  ) THEN
    ALTER TABLE inventory_receipts
      ADD CONSTRAINT inventory_receipts_shipment_fk
      FOREIGN KEY (shipment_id) REFERENCES inbound_shipments (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_receipts_shipment_item_fk'
       AND conrelid = 'inventory_receipts'::regclass
  ) THEN
    ALTER TABLE inventory_receipts
      ADD CONSTRAINT inventory_receipts_shipment_item_fk
      FOREIGN KEY (shipment_item_id) REFERENCES inbound_shipment_items (id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS inventory_receipts_shipment_idx
  ON inventory_receipts (shipment_id, received_at DESC);

CREATE TABLE IF NOT EXISTS inventory_transfers (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  source_location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  destination_location_id uuid NOT NULL REFERENCES warehouse_locations (id) ON DELETE RESTRICT,
  source_supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE RESTRICT,
  CHECK (source_location_id <> destination_location_id)
);

CREATE INDEX IF NOT EXISTS inventory_transfers_variant_timeline_idx
  ON inventory_transfers (variant_id, created_at DESC);

DROP TRIGGER IF EXISTS inventory_transfers_source_supplier_trigger ON inventory_transfers;
CREATE TRIGGER inventory_transfers_source_supplier_trigger
  BEFORE INSERT OR UPDATE ON inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION assert_inventory_source_supplier();

INSERT INTO permissions (id, key, description) VALUES
  ('00000000-0000-0000-0000-000000000119', 'inventory:transfer', 'Transfer inventory between authorized warehouse locations'),
  ('00000000-0000-0000-0000-000000000120', 'inventory:shipments:manage', 'Create and manage inbound warehouse shipment records')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.key IN ('warehouse_operator', 'admin', 'super_admin')
  AND permission.key IN ('inventory:transfer', 'inventory:shipments:manage')
ON CONFLICT DO NOTHING;
