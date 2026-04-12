ALTER TABLE scope_pt_faculty
ADD COLUMN IF NOT EXISTS seniority_rank TEXT DEFAULT '';

ALTER TABLE scope_pt_faculty
ADD COLUMN IF NOT EXISTS seniority_value TEXT DEFAULT '';

UPDATE scope_pt_faculty
SET seniority_rank = COALESCE(NULLIF(seniority_rank, ''), seniority_value, '')
WHERE COALESCE(seniority_rank, '') = '';

UPDATE scope_pt_faculty
SET seniority_value = COALESCE(NULLIF(seniority_value, ''), seniority_rank, '')
WHERE COALESCE(seniority_value, '') = '';
