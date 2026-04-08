CREATE TABLE IF NOT EXISTS terms (
  id SERIAL PRIMARY KEY,
  term_code TEXT UNIQUE NOT NULL,
  term_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disciplines (
  id SERIAL PRIMARY KEY,
  discipline_code TEXT UNIQUE NOT NULL,
  discipline_name TEXT NOT NULL,
  division_name TEXT,
  chair_name TEXT,
  dean_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discipline_subject_coverage (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  subject_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS faculty (
  id SERIAL PRIMARY KEY,
  employee_id TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discipline_seniority (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  seniority_date DATE,
  seniority_rank INTEGER NOT NULL,
  active_flag BOOLEAN DEFAULT TRUE,
  covered_subject_codes TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignment_groups (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  assignment_group_id TEXT NOT NULL,
  primary_subject_course TEXT,
  primary_crn TEXT,
  all_crns TEXT,
  title TEXT,
  division TEXT,
  modality TEXT,
  campus TEXT,
  units TEXT,
  pt_eligible BOOLEAN DEFAULT TRUE,
  is_grouped BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignment_group_meetings (
  id SERIAL PRIMARY KEY,
  assignment_group_id TEXT NOT NULL,
  days TEXT,
  start_time TEXT,
  end_time TEXT,
  building TEXT,
  room TEXT
);

CREATE TABLE IF NOT EXISTS discipline_windows (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  opens_at TIMESTAMP,
  closes_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faculty_submissions (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  submitted BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMP,
  general_interests TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faculty_ranked_preferences (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER REFERENCES faculty_submissions(id) ON DELETE CASCADE,
  assignment_group_id TEXT NOT NULL,
  preference_rank INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  assignment_group_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  assigned_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS decision_logs (
  id SERIAL PRIMARY KEY,
  term_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS subject_mappings (
  id SERIAL PRIMARY KEY,
  term_code TEXT,
  subject_code TEXT NOT NULL,
  discipline_code TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subject_mappings_unique_global
  ON subject_mappings (subject_code, COALESCE(term_code, ''));

CREATE INDEX IF NOT EXISTS subject_mappings_term_subject_idx
  ON subject_mappings (term_code, subject_code);

