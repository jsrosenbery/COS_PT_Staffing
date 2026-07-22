CREATE TABLE IF NOT EXISTS scope_terms (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL UNIQUE,
  term_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_roles (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  active_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_users (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'faculty',
  division TEXT NOT NULL DEFAULT '',
  active_status TEXT NOT NULL DEFAULT 'invited',
  password_hash TEXT,
  password_salt TEXT,
  password_set_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('admin', 'chair', 'dean', 'faculty')),
  CHECK (active_status IN ('invited', 'active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS scope_user_invites (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES scope_users(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'faculty',
  division TEXT NOT NULL DEFAULT '',
  invite_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('admin', 'chair', 'dean', 'faculty'))
);

CREATE TABLE IF NOT EXISTS scope_account_requests (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  requested_role TEXT NOT NULL DEFAULT 'faculty',
  division TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (requested_role IN ('admin', 'chair', 'dean', 'faculty')),
  CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS scope_password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES scope_users(id) ON DELETE CASCADE,
  reset_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES scope_users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_pt_faculty (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  discipline TEXT NOT NULL DEFAULT '',
  seniority_rank TEXT NOT NULL DEFAULT '',
  seniority_value TEXT NOT NULL DEFAULT '',
  qualified_disciplines TEXT NOT NULL DEFAULT '',
  active_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, division, discipline)
);

CREATE TABLE IF NOT EXISTS scope_staffing_windows (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closes_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  section_key TEXT NOT NULL DEFAULT '',
  instructor_name TEXT NOT NULL DEFAULT '',
  old_value TEXT,
  new_value TEXT,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_subject_mappings (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  term_code TEXT,
  subject_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope, term_code, subject_code)
);

CREATE TABLE IF NOT EXISTS scope_sections (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '',
  assignment_group_id TEXT NOT NULL,
  primary_subject_course TEXT NOT NULL DEFAULT '',
  primary_crn TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  campus TEXT NOT NULL DEFAULT '',
  subject_code TEXT NOT NULL DEFAULT '',
  course_number TEXT NOT NULL DEFAULT '',
  discipline_code TEXT NOT NULL DEFAULT '',
  instructional_method TEXT NOT NULL DEFAULT '',
  display_modality TEXT NOT NULL DEFAULT '',
  modality TEXT NOT NULL DEFAULT '',
  meetings JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (term_code, assignment_group_id)
);

CREATE TABLE IF NOT EXISTS scope_preferences (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  faculty_id TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  faculty_name TEXT NOT NULL DEFAULT '',
  assignment_group_id TEXT NOT NULL DEFAULT '',
  discipline_code TEXT NOT NULL DEFAULT '',
  preference_rank INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_faculty_availability (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  faculty_id TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  faculty_name TEXT NOT NULL DEFAULT '',
  availability_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  availability_time_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (term_code, faculty_id)
);

CREATE TABLE IF NOT EXISTS scope_assignments (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL DEFAULT '',
  assignment_group_id TEXT NOT NULL DEFAULT '',
  employee_id TEXT NOT NULL DEFAULT '',
  faculty_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'tentative',
  actor_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  reason_code TEXT NOT NULL DEFAULT '',
  justification TEXT NOT NULL DEFAULT '',
  recommendation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_contract_exception_reasons (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  requires_explanation BOOLEAN NOT NULL DEFAULT TRUE,
  active_status TEXT NOT NULL DEFAULT 'active',
  display_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_chair_decisions (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '',
  discipline_code TEXT NOT NULL DEFAULT '',
  assignment_group_id TEXT NOT NULL DEFAULT '',
  recommended_employee_id TEXT NOT NULL DEFAULT '',
  selected_employee_id TEXT NOT NULL DEFAULT '',
  selected_faculty_name TEXT NOT NULL DEFAULT '',
  decision_status TEXT NOT NULL DEFAULT 'tentative',
  exception_reason_code TEXT NOT NULL DEFAULT '',
  exception_explanation TEXT NOT NULL DEFAULT '',
  recommendation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_by_user_id INTEGER,
  decided_by_email TEXT NOT NULL DEFAULT '',
  decided_by_name TEXT NOT NULL DEFAULT '',
  decided_by_role TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (decision_status IN ('recommended', 'tentative', 'bypassed', 'released', 'chair_finalized', 'dean_approved', 'returned_for_revision'))
);

ALTER TABLE scope_pt_faculty
ADD COLUMN IF NOT EXISTS seniority_rank TEXT DEFAULT '';

ALTER TABLE scope_pt_faculty
ADD COLUMN IF NOT EXISTS seniority_value TEXT DEFAULT '';

ALTER TABLE scope_users
ADD COLUMN IF NOT EXISTS employee_id TEXT DEFAULT '';

ALTER TABLE scope_user_invites
ADD COLUMN IF NOT EXISTS employee_id TEXT DEFAULT '';

ALTER TABLE scope_assignments
ADD COLUMN IF NOT EXISTS reason_code TEXT DEFAULT '';

ALTER TABLE scope_assignments
ADD COLUMN IF NOT EXISTS justification TEXT DEFAULT '';

ALTER TABLE scope_assignments
ADD COLUMN IF NOT EXISTS recommendation_snapshot JSONB DEFAULT '{}'::jsonb;

ALTER TABLE scope_assignments
ADD COLUMN IF NOT EXISTS decision_snapshot JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_scope_roles_active ON scope_roles (active_status);
CREATE INDEX IF NOT EXISTS idx_scope_users_active ON scope_users (active_status);
CREATE INDEX IF NOT EXISTS idx_scope_users_employee_id ON scope_users (employee_id);
CREATE INDEX IF NOT EXISTS idx_scope_user_invites_email ON scope_user_invites (email);
CREATE INDEX IF NOT EXISTS idx_scope_user_invites_expiry ON scope_user_invites (expires_at);
CREATE INDEX IF NOT EXISTS idx_scope_account_requests_status ON scope_account_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_scope_account_requests_email ON scope_account_requests (email);
CREATE INDEX IF NOT EXISTS idx_scope_password_resets_user ON scope_password_resets (user_id);
CREATE INDEX IF NOT EXISTS idx_scope_password_resets_expiry ON scope_password_resets (expires_at);
CREATE INDEX IF NOT EXISTS idx_scope_user_sessions_user ON scope_user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_scope_user_sessions_expiry ON scope_user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_scope_pt_faculty_lookup ON scope_pt_faculty (division, discipline, active_status);
CREATE INDEX IF NOT EXISTS idx_scope_sections_term_division ON scope_sections (term_code, division);
CREATE INDEX IF NOT EXISTS idx_scope_preferences_term_faculty ON scope_preferences (term_code, faculty_id);
CREATE INDEX IF NOT EXISTS idx_scope_preferences_term_section ON scope_preferences (term_code, assignment_group_id);
CREATE INDEX IF NOT EXISTS idx_scope_faculty_availability_term_faculty ON scope_faculty_availability (term_code, faculty_id);
CREATE INDEX IF NOT EXISTS idx_scope_assignments_term_section ON scope_assignments (term_code, assignment_group_id);
CREATE INDEX IF NOT EXISTS idx_scope_audit_term_section ON scope_audit_log (term, section_key);
CREATE INDEX IF NOT EXISTS idx_scope_chair_decisions_term_section ON scope_chair_decisions (term_code, assignment_group_id, decided_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_assignments_one_active_section
ON scope_assignments (term_code, assignment_group_id)
WHERE COALESCE(status, 'tentative') NOT IN ('released', 'deleted', 'void', 'returned_for_revision');

INSERT INTO scope_contract_exception_reasons (code, label, description, requires_explanation, display_order)
VALUES
  ('COURSE_CONTINUITY', 'Course continuity', 'Continuity with an instructor who recently taught the course.', TRUE, 10),
  ('DUAL_ENROLLMENT_SITE_POSITION', 'Dual-enrollment site position', 'Instructor is specially positioned for a dual-enrollment site assignment.', TRUE, 20),
  ('SPECIALIZED_QUALIFICATION', 'Specialized qualification', 'Instructor has a specialized qualification needed for the section.', TRUE, 30),
  ('AVAILABILITY_OR_SCHEDULE_CONFLICT', 'Availability or schedule conflict', 'A senior candidate is unavailable due to documented availability or schedule conflict.', TRUE, 40),
  ('LOAD_OR_ASSIGNMENT_LIMIT', 'Load or assignment limit', 'A senior candidate is unavailable due to load or assignment limits.', TRUE, 50),
  ('OTHER_CONTRACTUAL_EXCEPTION', 'Other contractual exception', 'Another approved contractual exception.', TRUE, 60)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  requires_explanation = EXCLUDED.requires_explanation,
  display_order = EXCLUDED.display_order,
  updated_at = NOW();

UPDATE scope_pt_faculty
SET seniority_rank = COALESCE(NULLIF(seniority_rank, ''), seniority_value, '')
WHERE COALESCE(seniority_rank, '') = '';

UPDATE scope_pt_faculty
SET seniority_value = COALESCE(NULLIF(seniority_value, ''), seniority_rank, '')
WHERE COALESCE(seniority_value, '') = '';
