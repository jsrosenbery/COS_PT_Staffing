CREATE TABLE IF NOT EXISTS scope_rate_limits (
  limiter_name TEXT NOT NULL,
  key_hash TEXT NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (limiter_name, key_hash, window_started_at)
);

CREATE INDEX IF NOT EXISTS idx_scope_rate_limits_expiry
  ON scope_rate_limits (expires_at);
