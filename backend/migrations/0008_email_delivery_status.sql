CREATE TABLE IF NOT EXISTS scope_email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  staffing_window_id INTEGER NOT NULL REFERENCES scope_staffing_windows(id),
  recipient_count INTEGER NOT NULL CHECK (recipient_count > 0),
  subject TEXT NOT NULL CHECK (BTRIM(subject) <> ''),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  requested_by TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  provider_message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT,
  UNIQUE (staffing_window_id)
);

CREATE INDEX IF NOT EXISTS idx_scope_email_deliveries_status
  ON scope_email_deliveries (status, requested_at);
