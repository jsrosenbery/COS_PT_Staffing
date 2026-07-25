CREATE TABLE IF NOT EXISTS scope_faculty_load_status (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  faculty_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  actor_user_id INTEGER,
  actor_email TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (term_code, division, employee_id),
  CHECK (status IN ('active', 'complete'))
);

CREATE INDEX IF NOT EXISTS idx_scope_faculty_load_status_scope
ON scope_faculty_load_status (term_code, division, status);
