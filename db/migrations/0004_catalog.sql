-- Shared fashion catalog and seller ownership foundation.
-- Inventory and pricing are deliberately separate domains.

CREATE TABLE IF NOT EXISTS catalog_categories (
  id uuid PRIMARY KEY,
  parent_id uuid REFERENCES catalog_categories (id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_categories_parent_idx ON catalog_categories (parent_id);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  supplier_id uuid REFERENCES suppliers (id) ON DELETE RESTRICT,
  owner_type text NOT NULL CHECK (owner_type IN ('platform', 'supplier')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived', 'suspended')),
  slug text NOT NULL UNIQUE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  description text,
  brand_name text,
  category_id uuid REFERENCES catalog_categories (id) ON DELETE RESTRICT,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  retail_enabled boolean NOT NULL DEFAULT false,
  wholesale_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (owner_type = 'platform' AND supplier_id IS NULL)
    OR (owner_type = 'supplier' AND supplier_id IS NOT NULL AND retail_enabled = false)
  )
);

CREATE INDEX IF NOT EXISTS products_status_market_idx
  ON products (status, retail_enabled, wholesale_enabled, created_at DESC);
CREATE INDEX IF NOT EXISTS products_supplier_idx ON products (supplier_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  sku text NOT NULL UNIQUE,
  barcode text UNIQUE,
  size_label text,
  color_label text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  weight_grams integer CHECK (weight_grams IS NULL OR weight_grams > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, product_id)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx
  ON product_variants (product_id, status, created_at);

CREATE TABLE IF NOT EXISTS product_media (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id uuid,
  storage_key text NOT NULL UNIQUE,
  alt_text text NOT NULL CHECK (char_length(alt_text) BETWEEN 1 AND 240),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (variant_id, product_id)
    REFERENCES product_variants (id, product_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS product_media_product_idx
  ON product_media (product_id, sort_order, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS product_primary_media_idx
  ON product_media (product_id)
  WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS product_events (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_events_timeline_idx
  ON product_events (product_id, created_at ASC);
