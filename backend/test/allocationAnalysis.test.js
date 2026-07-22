import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAllocation } from "../domain/allocationAnalysis.js";

const faculty = [
  { employee_id: "F1", first_name: "Ava", last_name: "Andrews", division: "Science", discipline: "BIOL", seniority_rank: "1" },
  { employee_id: "F2", first_name: "Ben", last_name: "Baker", division: "Science", discipline: "BIOL", seniority_rank: "2" },
  { employee_id: "F3", first_name: "Cam", last_name: "Chen", division: "Science", discipline: "BIOL", seniority_rank: "3" },
  { employee_id: "F4", first_name: "Dee", last_name: "Diaz", division: "Science", discipline: "BIOL", seniority_rank: "4" },
  { employee_id: "F5", first_name: "Eli", last_name: "Evans", division: "Science", discipline: "BIOL", seniority_rank: "5" },
];

const sections = [
  { assignment_group_id: "S1", primary_subject_course: "BIOL 001", discipline_code: "BIOL" },
  { assignment_group_id: "S2", primary_subject_course: "BIOL 002", discipline_code: "BIOL" },
  { assignment_group_id: "S3", primary_subject_course: "BIOL 003", discipline_code: "BIOL" },
  { assignment_group_id: "S4", primary_subject_course: "BIOL 004", discipline_code: "BIOL" },
  { assignment_group_id: "S5", primary_subject_course: "BIOL 005", discipline_code: "BIOL" },
  { assignment_group_id: "S6", primary_subject_course: "BIOL 006", discipline_code: "BIOL" },
];

function pref(employeeId, assignmentGroupId, preferenceRank) {
  return {
    employee_id: employeeId,
    faculty_id: employeeId,
    faculty_name: employeeId,
    assignment_group_id: assignmentGroupId,
    discipline_code: "BIOL",
    preference_rank: preferenceRank,
  };
}

test("concurrent submissions are analyzed without mutating or collapsing original rows", () => {
  const preferences = [pref("F2", "S1", 1), pref("F1", "S1", 1), pref("F3", "S2", 1)];
  const original = JSON.parse(JSON.stringify(preferences));
  const result = analyzeAllocation({ faculty, sections, preferences });

  assert.deepEqual(preferences, original);
  assert.deepEqual(result.originalSubmissions, original);
  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S1").candidates.length, 2);
});

test("seniority ordering is deterministic ahead of preference rank", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F3", "S1", 1), pref("F1", "S1", 3), pref("F2", "S1", 2)],
  });

  const queue = result.sections.find((section) => section.assignmentGroupId === "S1").candidates;
  assert.deepEqual(queue.map((candidate) => candidate.employeeId), ["F1", "F2", "F3"]);
  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S1").nextEligibleCandidate.employeeId, "F1");
});

test("ranked preferences are retained on candidate rows", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F1", "S2", 2), pref("F1", "S1", 1)],
  });

  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S1").candidates[0].preferenceRank, 1);
  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S2").candidates[0].preferenceRank, 2);
});

test("duplicate ranks and missing seniority are reported", () => {
  const result = analyzeAllocation({
    faculty: [...faculty, { employee_id: "F6", first_name: "Fran", last_name: "Fox", discipline: "BIOL" }],
    sections,
    preferences: [pref("F2", "S1", 1), pref("F2", "S2", 1), pref("F6", "S1", 2)],
  });

  assert.ok(result.findings.some((finding) => finding.code === "duplicate_preference_rank" && finding.employeeId === "F2"));
  assert.ok(result.findings.some((finding) => finding.code === "missing_seniority" && finding.employeeId === "F6"));
});

test("section awarded to a senior candidate is reflected as awarded", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F1", "S1", 1), pref("F2", "S1", 1)],
    assignments: [{ assignment_group_id: "S1", employee_id: "F1", status: "tentative" }],
  });
  const s1 = result.sections.find((section) => section.assignmentGroupId === "S1");

  assert.equal(s1.assignment.employeeId, "F1");
  assert.equal(s1.assignedCandidate.employeeId, "F1");
  assert.equal(s1.candidates.find((candidate) => candidate.employeeId === "F1").status, "awarded");
});

test("section passes to next-highest interested candidate when senior candidate is unavailable elsewhere", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F1", "S1", 2), pref("F2", "S1", 1), pref("F1", "S2", 1)],
    assignments: [{ assignment_group_id: "S2", employee_id: "F1", status: "tentative" }],
  });
  const s1 = result.sections.find((section) => section.assignmentGroupId === "S1");

  assert.equal(s1.candidates.find((candidate) => candidate.employeeId === "F1").status, "candidate_awarded_elsewhere");
  assert.equal(s1.nextEligibleCandidate.employeeId, "F2");
});

test("a senior candidate selecting every section remains first only where still available", () => {
  const preferences = sections.flatMap((section, index) => [
    pref("F1", section.assignment_group_id, index + 1),
    pref("F2", section.assignment_group_id, index + 1),
  ]);
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences,
    assignments: [{ assignment_group_id: "S1", employee_id: "F1", status: "tentative" }],
  });

  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S1").assignedCandidate.employeeId, "F1");
  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S2").nextEligibleCandidate.employeeId, "F2");
});

test("tied and malformed preference ranks are deterministic and flagged", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F4", "S1", "not-a-rank"), pref("F5", "S1", 1), pref("F5", "S2", 1)],
  });
  const s1 = result.sections.find((section) => section.assignmentGroupId === "S1");

  assert.ok(result.findings.some((finding) => finding.code === "malformed_preference_rank" && finding.employeeId === "F4"));
  assert.ok(result.findings.some((finding) => finding.code === "duplicate_preference_rank" && finding.employeeId === "F5"));
  assert.deepEqual(s1.candidates.map((candidate) => candidate.employeeId), ["F4", "F5"]);
});

test("contractual exception recommendation requires code and written justification", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F1", "S3", 1), pref("F4", "S3", 1)],
    assignments: [{
      assignment_group_id: "S3",
      employee_id: "F4",
      status: "tentative",
      reason_code: "dual_enrollment_positioned",
      justification: "Instructor is assigned to the partner high school site.",
    }],
  });
  const s3 = result.sections.find((section) => section.assignmentGroupId === "S3");

  assert.equal(s3.exceptionRequired, true);
  assert.equal(s3.exceptionSupported, true);
  assert.equal(s3.recommendation.action, "documented_exception");
  assert.equal(s3.bypassedCandidate.employeeId, "F1");
});

test("unsupported bypass remains an exception-required recommendation", () => {
  const result = analyzeAllocation({
    faculty,
    sections,
    preferences: [pref("F1", "S4", 1), pref("F3", "S4", 1)],
    assignments: [{ assignment_group_id: "S4", employee_id: "F3", status: "tentative", reason: "Because." }],
  });

  assert.equal(result.sections.find((section) => section.assignmentGroupId === "S4").recommendation.action, "exception_required");
});

test("repeat execution produces identical results", () => {
  const input = {
    faculty,
    sections,
    preferences: [pref("F1", "S1", 1), pref("F2", "S1", 1), pref("F2", "S2", 2)],
    assignments: [{ assignment_group_id: "S2", employee_id: "F2", status: "chair_submitted" }],
  };

  assert.deepEqual(analyzeAllocation(input), analyzeAllocation(input));
});
