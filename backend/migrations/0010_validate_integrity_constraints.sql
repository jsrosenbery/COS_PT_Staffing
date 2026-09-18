-- Run `npm run db:integrity-precheck` before applying this migration. If any
-- legacy row violates an invariant, migration execution stops without changing
-- validation state or deleting historical data.
ALTER TABLE scope_terms VALIDATE CONSTRAINT scope_terms_identifiers_valid;
ALTER TABLE scope_roles VALIDATE CONSTRAINT scope_roles_identity_valid;
ALTER TABLE scope_users VALIDATE CONSTRAINT scope_users_role_valid;
ALTER TABLE scope_pt_faculty VALIDATE CONSTRAINT scope_pt_faculty_identity_valid;
ALTER TABLE scope_sections VALIDATE CONSTRAINT scope_sections_identifiers_valid;
ALTER TABLE scope_preferences VALIDATE CONSTRAINT scope_preferences_identifiers_valid;
ALTER TABLE scope_faculty_availability VALIDATE CONSTRAINT scope_faculty_availability_identifiers_valid;
ALTER TABLE scope_preference_submissions VALIDATE CONSTRAINT scope_preference_submissions_integrity_valid;
ALTER TABLE scope_preference_submission_items VALIDATE CONSTRAINT scope_preference_submission_items_identifiers_valid;
ALTER TABLE scope_assignments VALIDATE CONSTRAINT scope_assignments_integrity_valid;
ALTER TABLE scope_chair_decisions VALIDATE CONSTRAINT scope_chair_decisions_integrity_valid;
