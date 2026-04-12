CREATE TABLE IF NOT EXISTS scope_roles (
  id SERIAL PRIMARY KEY,
  employee_id TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  division TEXT NOT NULL,
  active_status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scope_roles_division ON scope_roles (division);
CREATE INDEX IF NOT EXISTS idx_scope_roles_role ON scope_roles (role);

CREATE TABLE IF NOT EXISTS scope_pt_faculty (
  id SERIAL PRIMARY KEY,
  employee_id TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  division TEXT NOT NULL,
  discipline TEXT NOT NULL,
  seniority_rank TEXT DEFAULT '',
  qualified_disciplines TEXT DEFAULT '',
  active_status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scope_pt_faculty_employee_division_discipline_key'
  ) THEN
    ALTER TABLE scope_pt_faculty
    ADD CONSTRAINT scope_pt_faculty_employee_division_discipline_key
    UNIQUE (employee_id, division, discipline);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_scope_pt_division ON scope_pt_faculty (division);
CREATE INDEX IF NOT EXISTS idx_scope_pt_discipline ON scope_pt_faculty (discipline);
CREATE INDEX IF NOT EXISTS idx_scope_pt_active_status ON scope_pt_faculty (active_status);

CREATE TABLE IF NOT EXISTS scope_staffing_windows (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  division TEXT NOT NULL,
  sender_email TEXT DEFAULT '',
  opened_at TIMESTAMP DEFAULT NOW(),
  closes_at TIMESTAMP,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_name TEXT DEFAULT '',
  actor_role TEXT DEFAULT '',
  division TEXT DEFAULT '',
  term TEXT DEFAULT '',
  section_key TEXT DEFAULT '',
  instructor_name TEXT DEFAULT '',
  old_value JSONB,
  new_value JSONB,
  note TEXT DEFAULT '',
  source TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scope_audit_event_type ON scope_audit_log (event_type);
CREATE INDEX IF NOT EXISTS idx_scope_audit_created_at ON scope_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scope_audit_division ON scope_audit_log (division);

CREATE TABLE IF NOT EXISTS scope_terms (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL UNIQUE,
  term_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_subject_mappings (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  term_code TEXT,
  subject_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_sections (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  division TEXT NOT NULL,
  assignment_group_id TEXT NOT NULL,
  primary_subject_course TEXT DEFAULT '',
  primary_crn TEXT DEFAULT '',
  title TEXT DEFAULT '',
  campus TEXT DEFAULT '',
  subject_code TEXT DEFAULT '',
  course_number TEXT DEFAULT '',
  discipline_code TEXT DEFAULT '',
  instructional_method TEXT DEFAULT '',
  display_modality TEXT DEFAULT '',
  modality TEXT DEFAULT '',
  meetings JSONB DEFAULT '[]'::jsonb,
  raw_row JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scope_sections_term_assignment_group_key'
  ) THEN
    ALTER TABLE scope_sections
    ADD CONSTRAINT scope_sections_term_assignment_group_key
    UNIQUE (term_code, assignment_group_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS scope_preferences (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  faculty_id TEXT DEFAULT '',
  employee_id TEXT DEFAULT '',
  faculty_name TEXT DEFAULT '',
  assignment_group_id TEXT NOT NULL,
  discipline_code TEXT DEFAULT '',
  preference_rank INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scope_assignments (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT DEFAULT '',
  assignment_group_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  faculty_name TEXT DEFAULT '',
  status TEXT DEFAULT 'tentative',
  actor_name TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO scope_terms (term_code, term_name, is_active)
SELECT 'SP27', 'Spring 2027', TRUE
WHERE NOT EXISTS (SELECT 1 FROM scope_terms);
