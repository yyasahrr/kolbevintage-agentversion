-- Supplier onboarding, public/private supplier data, and wholesale entitlement foundations.
-- This migration intentionally contains no product, inventory, payment, or settlement tables.

CREATE TABLE IF NOT EXISTS wholesale_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wholesale_membership_plans (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  currency char(3) NOT NULL,
  wholesale_price_visibility boolean NOT NULL DEFAULT false,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wholesale_memberships (
  id uuid PRIMARY KEY,
  wholesale_account_id uuid NOT NULL REFERENCES wholesale_accounts (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES wholesale_membership_plans (id) ON DELETE RESTRICT,
  status text NOT NULL
    CHECK (status IN ('pending', 'active', 'expired', 'suspended', 'cancelled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS wholesale_memberships_account_idx
  ON wholesale_memberships (wholesale_account_id, ends_at DESC);
CREATE INDEX IF NOT EXISTS wholesale_memberships_active_idx
  ON wholesale_memberships (wholesale_account_id, starts_at, ends_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS supplier_applications (
  id uuid PRIMARY KEY,
  applicant_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'suspended', 'disabled')),
  public_display_name text NOT NULL CHECK (char_length(public_display_name) BETWEEN 1 AND 120),
  public_brand_name text CHECK (public_brand_name IS NULL OR char_length(public_brand_name) BETWEEN 1 AND 120),
  public_bio text CHECK (public_bio IS NULL OR char_length(public_bio) <= 2000),
  legal_name text NOT NULL CHECK (char_length(legal_name) BETWEEN 1 AND 240),
  contact_email text NOT NULL CHECK (char_length(contact_email) <= 320),
  contact_phone text NOT NULL CHECK (char_length(contact_phone) <= 40),
  business_address text NOT NULL CHECK (char_length(business_address) BETWEEN 1 AND 1000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  review_reason text CHECK (review_reason IS NULL OR char_length(review_reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_applications_applicant_idx
  ON supplier_applications (applicant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_applications_status_idx
  ON supplier_applications (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_one_open_application_idx
  ON supplier_applications (applicant_user_id)
  WHERE status IN ('draft', 'submitted', 'under_review', 'changes_requested');

CREATE TABLE IF NOT EXISTS supplier_application_documents (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES supplier_applications (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  original_file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_application_documents_application_idx
  ON supplier_application_documents (application_id, created_at);

CREATE TABLE IF NOT EXISTS supplier_application_events (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES supplier_applications (id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  from_status text,
  to_status text NOT NULL,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_application_events_timeline_idx
  ON supplier_application_events (application_id, created_at ASC);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  application_id uuid NOT NULL UNIQUE REFERENCES supplier_applications (id) ON DELETE RESTRICT,
  public_display_name text NOT NULL CHECK (char_length(public_display_name) BETWEEN 1 AND 120),
  public_brand_name text CHECK (public_brand_name IS NULL OR char_length(public_brand_name) BETWEEN 1 AND 120),
  public_bio text CHECK (public_bio IS NULL OR char_length(public_bio) <= 2000),
  status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'suspended', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS suppliers_public_status_idx
  ON suppliers (status, public_display_name);

CREATE TABLE IF NOT EXISTS supplier_private_profiles (
  supplier_id uuid PRIMARY KEY REFERENCES suppliers (id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  business_address text NOT NULL,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
