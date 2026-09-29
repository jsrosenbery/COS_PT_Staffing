ALTER TABLE scope_email_deliveries
  ADD COLUMN message_body TEXT NOT NULL DEFAULT '',
  ADD COLUMN recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0);
-- Existing failed notices lack a saved body/recipient list. Recovery requires an
-- operator to provide the original notice; never silently invent its contents.
