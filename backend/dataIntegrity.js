const checks = Object.freeze([
  ["terms.identifiers", "scope_terms", "BTRIM(term_code) = ''"],
  ["roles.identity_or_role", "scope_roles", "BTRIM(employee_id) = '' OR BTRIM(division) = '' OR role <> LOWER(BTRIM(role)) OR role NOT IN ('admin', 'chair', 'dean', 'faculty')"],
  ["users.role", "scope_users", "role <> LOWER(BTRIM(role)) OR role NOT IN ('admin', 'chair', 'dean', 'faculty')"],
  ["pt_faculty.identity", "scope_pt_faculty", "BTRIM(employee_id) = '' OR BTRIM(division) = ''"],
  ["sections.identifiers", "scope_sections", "BTRIM(term_code) = '' OR BTRIM(division) = '' OR BTRIM(assignment_group_id) = ''"],
  ["preferences.identifiers", "scope_preferences", "BTRIM(term_code) = '' OR BTRIM(faculty_id) = '' OR BTRIM(assignment_group_id) = ''"],
  ["availability.identifiers", "scope_faculty_availability", "BTRIM(term_code) = '' OR BTRIM(faculty_id) = ''"],
  ["preference_submissions.integrity", "scope_preference_submissions", "BTRIM(term_code) = '' OR BTRIM(faculty_id) = '' OR BTRIM(division) = '' OR status <> LOWER(BTRIM(status)) OR status NOT IN ('draft', 'submitted', 'frozen', 'superseded', 'corrected')"],
  ["preference_items.identifiers", "scope_preference_submission_items", "BTRIM(term_code) = '' OR BTRIM(faculty_id) = '' OR BTRIM(assignment_group_id) = ''"],
  ["assignments.integrity", "scope_assignments", "BTRIM(term_code) = '' OR BTRIM(assignment_group_id) = '' OR BTRIM(employee_id) = '' OR status <> LOWER(BTRIM(status)) OR status NOT IN ('tentative', 'chair_submitted', 'dean_approved', 'approved', 'assigned', 'released', 'deleted', 'void', 'withdrawn', 'returned_for_revision')"],
  ["chair_decisions.integrity", "scope_chair_decisions", "BTRIM(term_code) = '' OR BTRIM(division) = '' OR BTRIM(assignment_group_id) = '' OR BTRIM(selected_employee_id) = '' OR decision_status <> LOWER(BTRIM(decision_status)) OR decision_status NOT IN ('recommended', 'tentative', 'bypassed', 'released', 'chair_finalized', 'dean_approved', 'returned_for_revision')"],
]);

export const dataIntegrityChecks = checks.map(([code, table, predicate]) => ({ code, table, predicate }));

export async function buildDataIntegrityReport(query) {
  const report = [];
  for (const check of dataIntegrityChecks) {
    const result = await query(`
      SELECT COUNT(*)::int AS violation_count,
             COALESCE(
               (SELECT JSON_AGG(sample.id) FROM (
                 SELECT id FROM ${check.table} WHERE ${check.predicate} ORDER BY id LIMIT 20
               ) sample),
               '[]'::json
             ) AS sample_ids
      FROM ${check.table}
      WHERE ${check.predicate}
    `);
    report.push({
      code: check.code,
      table: check.table,
      violationCount: result.rows[0]?.violation_count || 0,
      sampleIds: result.rows[0]?.sample_ids || [],
    });
  }
  return report;
}
