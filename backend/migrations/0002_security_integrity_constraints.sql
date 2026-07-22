-- Protect new writes without rewriting or rejecting historical rows during
-- adoption. Run `npm run db:integrity-report`, remediate confirmed legacy
-- issues, and validate each constraint in a separately reviewed migration.
DO $$
DECLARE
  invariant RECORD;
BEGIN
  FOR invariant IN
    SELECT * FROM (VALUES
      ('scope_terms', 'scope_terms_identifiers_valid', $check$BTRIM(term_code) <> ''$check$),
      ('scope_roles', 'scope_roles_identity_valid', $check$BTRIM(employee_id) <> '' AND BTRIM(division) <> '' AND role = LOWER(BTRIM(role)) AND role IN ('admin', 'chair', 'dean', 'faculty')$check$),
      ('scope_users', 'scope_users_role_valid', $check$role = LOWER(BTRIM(role)) AND role IN ('admin', 'chair', 'dean', 'faculty')$check$),
      ('scope_pt_faculty', 'scope_pt_faculty_identity_valid', $check$BTRIM(employee_id) <> '' AND BTRIM(division) <> ''$check$),
      ('scope_sections', 'scope_sections_identifiers_valid', $check$BTRIM(term_code) <> '' AND BTRIM(division) <> '' AND BTRIM(assignment_group_id) <> ''$check$),
      ('scope_preferences', 'scope_preferences_identifiers_valid', $check$BTRIM(term_code) <> '' AND BTRIM(faculty_id) <> '' AND BTRIM(assignment_group_id) <> ''$check$),
      ('scope_faculty_availability', 'scope_faculty_availability_identifiers_valid', $check$BTRIM(term_code) <> '' AND BTRIM(faculty_id) <> ''$check$),
      ('scope_preference_submissions', 'scope_preference_submissions_integrity_valid', $check$BTRIM(term_code) <> '' AND BTRIM(faculty_id) <> '' AND BTRIM(division) <> '' AND status = LOWER(BTRIM(status)) AND status IN ('draft', 'submitted', 'frozen', 'superseded', 'corrected')$check$),
      ('scope_preference_submission_items', 'scope_preference_submission_items_identifiers_valid', $check$BTRIM(term_code) <> '' AND BTRIM(faculty_id) <> '' AND BTRIM(assignment_group_id) <> ''$check$),
      ('scope_assignments', 'scope_assignments_integrity_valid', $check$BTRIM(term_code) <> '' AND BTRIM(assignment_group_id) <> '' AND BTRIM(employee_id) <> '' AND status = LOWER(BTRIM(status)) AND status IN ('tentative', 'chair_submitted', 'dean_approved', 'approved', 'assigned', 'released', 'deleted', 'void', 'withdrawn', 'returned_for_revision')$check$),
      ('scope_chair_decisions', 'scope_chair_decisions_integrity_valid', $check$BTRIM(term_code) <> '' AND BTRIM(division) <> '' AND BTRIM(assignment_group_id) <> '' AND BTRIM(selected_employee_id) <> '' AND decision_status = LOWER(BTRIM(decision_status)) AND decision_status IN ('recommended', 'tentative', 'bypassed', 'released', 'chair_finalized', 'dean_approved', 'returned_for_revision')$check$)
    ) AS configured(table_name, constraint_name, check_expression)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = invariant.constraint_name
        AND conrelid = TO_REGCLASS(invariant.table_name)
    ) THEN
      EXECUTE FORMAT(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        invariant.table_name,
        invariant.constraint_name,
        invariant.check_expression
      );
    END IF;
  END LOOP;
END $$;
