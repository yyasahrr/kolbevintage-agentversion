-- Database-backed authentication abuse controls.
-- Keys are application-derived HMACs; raw email and network identifiers are never stored.

CREATE TABLE IF NOT EXISTS auth_rate_limit_buckets (
  bucket_key text PRIMARY KEY CHECK (char_length(bucket_key) = 64),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_rate_limit_buckets_updated_idx
  ON auth_rate_limit_buckets (updated_at);
