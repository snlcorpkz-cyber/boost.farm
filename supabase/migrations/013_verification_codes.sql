CREATE TABLE IF NOT EXISTS verification_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_verification_codes_email ON verification_codes (email, created_at DESC);
