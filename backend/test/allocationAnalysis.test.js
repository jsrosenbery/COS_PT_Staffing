import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAllocation, allocationReasonCodes } from "../domain/allocationAnalysis.js";
import { allocationFixture, fixtureFaculty, fixturePreferences, fixtureSections, preference } from "./fixtures/allocationFixture.js";

function section(result, assignmentGroupId) {
  return result.sections.find((row) => row.assignmentGroupId === assignmentGroupId);
}

function faculty(result, employeeId) {
  return result.faculty.find((row) => row.employeeId === employeeId);
}

function prefDisposition(result, employeeId, assignmentGroupId) {
  return faculty(result, employeeId).rankedPreferences.find((row) => row.assignmentGroupId === assignmentGroupId);
}

test("returns ordered candidate list for every section from selected preferences only", () => {
  const result = analyzeAllocation(allocationFixture());

  assert.equal(result.sections.length, 6);
  assert.deepEqual(section(result, "S1").candidateList.map((candidate) => candidate.employeeId), ["F1", "F2", "F3", "F4"]);
  assert.equal(section(result, "S1").nonCandidateReasons.find((row) => row.employeeId === "F5").reasonCode, allocationReasonCodes.NOT_SELECTED_BY_FACULTY);
  assert.equal(section(result, "S1").nonCandidateReasons.find((row) => row.employeeId === "F6").reasonCode, allocationReasonCodes.NOT_QUALIFIED);
});

test("reports highest-seniority currently eligible candidate for open sections", () => {
  const result = analyzeAllocation(allocationFixture());

  assert.equal(section(result, "S1").highestSeniorityCurrentlyEligibleCandidate.employeeId, "F1");
  assert.equal(section(result, "S5").highestSeniorityCurrentlyEligibleCandidate.employeeId, "F3");
});

test("recommends senior faculty preferences first without a default one-assignment cap", () => {
  const result = analyzeAllocation(allocationFixture());

  assert.deepEqual(
    result.recommendedNextAssignmentSequence.map((item) => `${item.employeeId}:${item.assignmentGroupId}`),
    ["F1:S2", "F1:S1", "F1:S3", "F1:S4", "F3:S5", "F4:S6"]
  );
  assert.equal(prefDisposition(result, "F1", "S1").reasonCode, allocationReasonCodes.AWARDED);
  assert.equal(prefDisposition(result, "F2", "S1").reasonCode, allocationReasonCodes.AWARDED_TO_MORE_SENIOR_CANDIDATE);
});

test("supports configurable one-assignment-per-pass behavior", () => {
  const result = analyzeAllocation(allocationFixture({
    loadLimits: { oneAssignmentPerPass: true },
  }));

  assert.deepEqual(
    result.recommendedNextAssignmentSequence.map((item) => `${item.employeeId}:${item.assignmentGroupId}`),
    ["F1:S2", "F2:S1", "F3:S5", "F4:S4", "F5:S6"]
  );
  assert.equal(prefDisposition(result, "F3", "S1").reasonCode, allocationReasonCodes.AWARDED_TO_MORE_SENIOR_CANDIDATE);
  assert.equal(prefDisposition(result, "F1", "S1").reasonCode, allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS);
});

test("supports configurable maximum assignments instead of hard-coding one permanent policy", () => {
  const result = analyzeAllocation(allocationFixture({
    loadLimits: { oneAssignmentPerPass: false, maxAssignments: 2 },
  }));

  assert.deepEqual(
    result.recommendedNextAssignmentSequence.map((item) => `${item.employeeId}:${item.assignmentGroupId}`),
    ["F1:S2", "F1:S1", "F2:S3", "F2:S4", "F3:S5", "F4:S6"]
  );
});

test("explains unawarded preferences blocked by earlier recommendations consuming assignment caps", () => {
  const result = analyzeAllocation(allocationFixture({
    loadLimits: { oneAssignmentPerPass: false, maxAssignments: 1, maxLoad: 1 },
  }));

  assert.equal(prefDisposition(result, "F1", "S2").reasonCode, allocationReasonCodes.AWARDED);
  assert.equal(prefDisposition(result, "F1", "S1").reasonCode, allocationReasonCodes.LOAD_LIMIT_REACHED);
});

test("skips faculty marked load complete while preserving their submitted preferences", () => {
  const input = allocationFixture({
    faculty: fixtureFaculty.map((row) => row.employee_id === "F1" ? { ...row, load_status: "complete" } : row),
  });
  const originalPreferences = JSON.parse(JSON.stringify(input.preferences));
  const result = analyzeAllocation(input);

  assert.deepEqual(input.preferences, originalPreferences);
  assert.equal(section(result, "S1").highestSeniorityCurrentlyEligibleCandidate.employeeId, "F2");
  assert.equal(section(result, "S1").candidateList.find((candidate) => candidate.employeeId === "F1").reasonCode, allocationReasonCodes.LOAD_LIMIT_REACHED);
  assert.equal(prefDisposition(result, "F1", "S1").reasonCode, allocationReasonCodes.LOAD_LIMIT_REACHED);
  assert.ok(result.recommendedNextAssignmentSequence.every((item) => item.employeeId !== "F1"));
});

test("respects current assignments and marks awarded preferences without rewriting originals", () => {
  const input = allocationFixture({
    assignments: [{ assignment_group_id: "S2", employee_id: "F1", faculty_name: "Ava Andrews", status: "tentative" }],
  });
  const originalPreferences = JSON.parse(JSON.stringify(input.preferences));
  const result = analyzeAllocation(input);

  assert.deepEqual(input.preferences, originalPreferences);
  assert.deepEqual(result.originalSubmissions, originalPreferences);
  assert.equal(prefDisposition(result, "F1", "S2").reasonCode, allocationReasonCodes.AWARDED);
  assert.equal(prefDisposition(result, "F1", "S1").reasonCode, allocationReasonCodes.AWARDED);
});

test("keeps a senior candidate eligible for another preference after a current assignment by default", () => {
  const result = analyzeAllocation(allocationFixture({
    assignments: [{ assignment_group_id: "S2", employee_id: "F1", faculty_name: "Ava Andrews", status: "chair_submitted" }],
  }));

  assert.equal(section(result, "S1").highestSeniorityCurrentlyEligibleCandidate.employeeId, "F1");
  assert.equal(section(result, "S1").candidateList.find((candidate) => candidate.employeeId === "F1").reasonCode, allocationReasonCodes.NOT_YET_REACHED);
});

test("passes a section to next-highest interested candidate when one-assignment-per-pass is configured", () => {
  const result = analyzeAllocation(allocationFixture({
    assignments: [{ assignment_group_id: "S2", employee_id: "F1", faculty_name: "Ava Andrews", status: "chair_submitted" }],
    loadLimits: { oneAssignmentPerPass: true },
  }));

  assert.equal(section(result, "S1").highestSeniorityCurrentlyEligibleCandidate.employeeId, "F2");
  assert.equal(section(result, "S1").candidateList.find((candidate) => candidate.employeeId === "F1").reasonCode, allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS);
});

test("applies recognized contractual exception without changing candidate order", () => {
  const result = analyzeAllocation(allocationFixture({
    assignments: [{
      assignment_group_id: "S4",
      employee_id: "F4",
      faculty_name: "Dee Diaz",
      status: "tentative",
      reason_code: "dual_enrollment_positioned",
      justification: "Instructor is assigned to the partner high school site.",
    }],
  }));
  const s4 = section(result, "S4");

  assert.deepEqual(s4.candidateList.map((candidate) => candidate.employeeId), ["F1", "F2", "F4"]);
  assert.equal(s4.exception.reasonCode, allocationReasonCodes.CONTRACT_EXCEPTION_APPLIED);
  assert.equal(s4.exception.bypassedEmployeeId, "F1");
  assert.equal(prefDisposition(result, "F1", "S4").reasonCode, allocationReasonCodes.CONTRACT_EXCEPTION_APPLIED);
});

test("flags pending contractual exception when override lacks recognized code or justification", () => {
  const result = analyzeAllocation(allocationFixture({
    assignments: [{ assignment_group_id: "S4", employee_id: "F4", faculty_name: "Dee Diaz", status: "tentative", reason: "Because." }],
  }));

  assert.equal(section(result, "S4").exception.reasonCode, allocationReasonCodes.CONTRACT_EXCEPTION_PENDING);
  assert.equal(prefDisposition(result, "F1", "S4").reasonCode, allocationReasonCodes.CONTRACT_EXCEPTION_PENDING);
});

test("emits explicit reason codes for withdrawn, unavailable, not qualified, load limit, missing seniority, and data conflict", () => {
  const result = analyzeAllocation(allocationFixture({
    faculty: [
      ...fixtureFaculty,
      { employee_id: "F7", first_name: "Gus", last_name: "Gray", division: "Science", discipline: "BIOL", qualified_disciplines: "BIOL" },
    ],
    preferences: [
      ...fixturePreferences,
      preference("F6", "S1", 1),
      preference("F7", "S2", 1),
      preference("F2", "S9", 9),
      preference("F2", "S6", 2, { status: "withdrawn" }),
      preference("F2", "S5", "bad-rank"),
    ],
    assignments: [{ assignment_group_id: "S1", employee_id: "F1", status: "tentative" }],
    loadLimits: { oneAssignmentPerPass: true, maxAssignmentsByFaculty: { F2: 0 } },
  }));

  assert.equal(prefDisposition(result, "F6", "S1").reasonCode, allocationReasonCodes.NOT_QUALIFIED);
  assert.equal(prefDisposition(result, "F7", "S2").reasonCode, allocationReasonCodes.MISSING_SENIORITY);
  assert.equal(prefDisposition(result, "F2", "S9").reasonCode, allocationReasonCodes.SECTION_NO_LONGER_AVAILABLE);
  assert.equal(prefDisposition(result, "F2", "S6").reasonCode, allocationReasonCodes.WITHDRAWN);
  assert.equal(prefDisposition(result, "F2", "S3").reasonCode, allocationReasonCodes.LOAD_LIMIT_REACHED);
  assert.ok(result.warnings.some((item) => item.reasonCode === allocationReasonCodes.MISSING_SENIORITY && item.employeeId === "F7"));
  assert.ok(result.warnings.some((item) => item.reasonCode === allocationReasonCodes.DATA_CONFLICT));
});

test("preserves cross-listed and corequisite bundles as one staffing unit", () => {
  const result = analyzeAllocation(allocationFixture());

  assert.equal(section(result, "S4").staffingUnitType, "cross_listed");
  assert.equal(section(result, "S6").staffingUnitType, "corequisite_bundle");
  assert.equal(result.recommendedNextAssignmentSequence.filter((item) => item.assignmentGroupId === "S4").length, 1);
});

test("repeat execution with the same source data produces identical output", () => {
  const input = allocationFixture({
    assignments: [{ assignment_group_id: "S2", employee_id: "F1", status: "tentative" }],
  });

  assert.deepEqual(analyzeAllocation(input), analyzeAllocation(input));
});

test("reason code catalog includes required codes", () => {
  const result = analyzeAllocation(allocationFixture());

  for (const code of Object.values(allocationReasonCodes)) {
    assert.ok(result.reasonCodes.includes(code), `missing ${code}`);
  }
});
