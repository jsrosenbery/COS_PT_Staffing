ALTER TABLE scope_preference_submissions
ALTER COLUMN submitted_at DROP NOT NULL;

DROP INDEX IF EXISTS idx_scope_preference_submissions_term_faculty;

CREATE INDEX IF NOT EXISTS idx_scope_preference_submissions_term_faculty
ON scope_preference_submissions (term_code, faculty_id, submitted_at DESC NULLS LAST);
