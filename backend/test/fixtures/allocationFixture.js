export const fixtureSections = [
  { term_code: "SP27", assignment_group_id: "S1", primary_subject_course: "BIOL 001", primary_crn: "10001", division: "Science", subject_code: "BIOL", discipline_code: "BIOL", raw_row: { bundle_type: "single", staff_eligible: true } },
  { term_code: "SP27", assignment_group_id: "S2", primary_subject_course: "BIOL 002", primary_crn: "10002", division: "Science", subject_code: "BIOL", discipline_code: "BIOL", raw_row: { bundle_type: "single", staff_eligible: true } },
  { term_code: "SP27", assignment_group_id: "S3", primary_subject_course: "BIOL 003", primary_crn: "10003", division: "Science", subject_code: "BIOL", discipline_code: "BIOL", raw_row: { bundle_type: "single", staff_eligible: true } },
  { term_code: "SP27", assignment_group_id: "S4", primary_subject_course: "BIOL 004", primary_crn: "10004 / 10005", division: "Science", subject_code: "BIOL", discipline_code: "BIOL", raw_row: { bundle_type: "cross_listed", staff_eligible: true, linked_sections: [{ primary_crn: "10004" }, { primary_crn: "10005" }] } },
  { term_code: "SP27", assignment_group_id: "S5", primary_subject_course: "BIOL 005", primary_crn: "10006", division: "Science", subject_code: "BIOL", discipline_code: "BIOL", raw_row: { bundle_type: "single", staff_eligible: true } },
  { term_code: "SP27", assignment_group_id: "S6", primary_subject_course: "BIOL 006", primary_crn: "10007", division: "Science", subject_code: "BIOL", discipline_code: "BIOL", raw_row: { bundle_type: "corequisite_bundle", staff_eligible: true } },
];

export const fixtureFaculty = [
  { employee_id: "F1", first_name: "Ava", last_name: "Andrews", division: "Science", discipline: "BIOL", seniority_rank: "1", qualified_disciplines: "BIOL" },
  { employee_id: "F2", first_name: "Ben", last_name: "Baker", division: "Science", discipline: "BIOL", seniority_rank: "2", qualified_disciplines: "BIOL" },
  { employee_id: "F3", first_name: "Cam", last_name: "Chen", division: "Science", discipline: "BIOL", seniority_rank: "3", qualified_disciplines: "BIOL" },
  { employee_id: "F4", first_name: "Dee", last_name: "Diaz", division: "Science", discipline: "BIOL", seniority_rank: "4", qualified_disciplines: "BIOL|DE" },
  { employee_id: "F5", first_name: "Eli", last_name: "Evans", division: "Science", discipline: "BIOL", seniority_rank: "5", qualified_disciplines: "BIOL" },
  { employee_id: "F6", first_name: "Fran", last_name: "Fox", division: "Science", discipline: "CHEM", seniority_rank: "6", qualified_disciplines: "CHEM" },
];

export function preference(employeeId, assignmentGroupId, preferenceRank, extras = {}) {
  return {
    term_code: "SP27",
    faculty_id: employeeId,
    employee_id: employeeId,
    faculty_name: employeeId,
    assignment_group_id: assignmentGroupId,
    discipline_code: "BIOL",
    preference_rank: preferenceRank,
    ...extras,
  };
}

export const fixturePreferences = [
  preference("F1", "S2", 1),
  preference("F1", "S1", 2),
  preference("F1", "S3", 3),
  preference("F1", "S4", 4),
  preference("F2", "S1", 1),
  preference("F2", "S3", 2),
  preference("F2", "S4", 3),
  preference("F3", "S1", 1),
  preference("F3", "S2", 2),
  preference("F3", "S5", 3),
  preference("F4", "S4", 1),
  preference("F4", "S1", 2),
  preference("F4", "S6", 3),
  preference("F5", "S5", 1),
  preference("F5", "S6", 2),
];

export function allocationFixture(overrides = {}) {
  return {
    termCode: "SP27",
    division: "Science",
    disciplineCode: "BIOL",
    sections: fixtureSections,
    faculty: fixtureFaculty,
    preferences: fixturePreferences,
    assignments: [],
    ...overrides,
  };
}
