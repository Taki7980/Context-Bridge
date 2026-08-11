BEGIN;

CREATE TABLE IF NOT EXISTS context_bridge_active (
  subject TEXT PRIMARY KEY,
  encrypted_payload JSONB NOT NULL,
  pack_id UUID NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS context_bridge_active_expiry_idx
  ON context_bridge_active (expires_at)
  WHERE active = TRUE;

COMMIT;
