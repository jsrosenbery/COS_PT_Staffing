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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scope_pt_faculty
ADD COLUMN IF NOT EXISTS seniority_rank TEXT DEFAULT '';

ALTER TABLE scope_pt_faculty
ADD COLUMN IF NOT EXISTS seniority_value TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_scope_roles_active ON scope_roles (active_status);
CREATE INDEX IF NOT EXISTS idx_scope_pt_faculty_lookup ON scope_pt_faculty (division, discipline, active_status);
CREATE INDEX IF NOT EXISTS idx_scope_sections_term_division ON scope_sections (term_code, division);
CREATE INDEX IF NOT EXISTS idx_scope_preferences_term_faculty ON scope_preferences (term_code, faculty_id);
CREATE INDEX IF NOT EXISTS idx_scope_preferences_term_section ON scope_preferences (term_code, assignment_group_id);
CREATE INDEX IF NOT EXISTS idx_scope_faculty_availability_term_faculty ON scope_faculty_availability (term_code, faculty_id);
CREATE INDEX IF NOT EXISTS idx_scope_assignments_term_section ON scope_assignments (term_code, assignment_group_id);
CREATE INDEX IF NOT EXISTS idx_scope_audit_term_section ON scope_audit_log (term, section_key);

UPDATE scope_pt_faculty
SET seniority_rank = COALESCE(NULLIF(seniority_rank, ''), seniority_value, '')
WHERE COALESCE(seniority_rank, '') = '';

UPDATE scope_pt_faculty
SET seniority_value = COALESCE(NULLIF(seniority_value, ''), seniority_rank, '')
WHERE COALESCE(seniority_value, '') = '';
