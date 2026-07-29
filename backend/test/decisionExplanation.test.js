import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDecisionExplanation, decisionExplanationRows } from "../domain/decisionExplanation.js";

const section = {
  term_code: "SP27",
  division: "Science",
  assignment_group_id: "S1",
  primary_subject_course: "BIOL 001",
  primary_crn: "10001",
};

const originalRecommendationSnapshot = {
  assignmentGroupId: "S1",
  recommendedEmployeeId: "F1",
  recommendedFacultyName: "Ava Andrews",
  recommendedSeniorityRank: 1,
  recommendedPreferenceRank: 2,
  candidateList: [
    { employeeId: "F1", facultyName: "Ava Andrews", seniorityRank: 1, preferenceRank: 2, qualified: true, reasonCode: "NOT_YET_REACHED" },
    { employeeId: "F2", facultyName: "Ben Baker", seniorityRank: 2, preferenceRank: 1, qualified: true, reasonCode: "NOT_YET_REACHED" },
  ],
};

const decision = {
  id: 1,
  term_code: "SP27",
  division: "Science",
  assignment_group_id: "S1",
  recommended_employee_id: "F1",
  selected_employee_id: "F2",
  selected_faculty_name: "Ben Baker",
  decision_status: "bypassed",
  exception_reason_code: "COURSE_CONTINUITY",
  exception_explanation: "Ben has course continuity from the prior term.",
  recommendation_snapshot: originalRecommendationSnapshot,
  decision_snapshot: {
    selectedEmployeeId: "F2",
    selectedFacultyName: "Ben Baker",
    exceptionReasonCode: "COURSE_CONTINUITY",
  },
  decided_by_email: "chair@cos.edu",
  decided_by_role: "chair",
  decided_at: "2027-01-15T10:00:00.000Z",
  updated_at: "2027-01-15T10:00:00.000Z",
};

const submission = {
  id: 10,
  term_code: "SP27",
  faculty_id: "F1",
  employee_id: "F1",
  faculty_name: "Ava Andrews",
  division: "Science",
  submission_snapshot: {
    preferences: [{ assignment_group_id: "S1", preference_rank: 1 }],
  },
  submitted_at: "2027-01-10T10:00:00.000Z",
};

const item = {
  submission_id: 10,
  term_code: "SP27",
  faculty_id: "F1",
  employee_id: "F1",
  faculty_name: "Ava Andrews",
  assignment_group_id: "S1",
  preference_rank: 1,
  item_snapshot: { assignment_group_id: "S1", preference_rank: 1, title: "Original frozen preference" },
};

test("section explanations come from stored decision snapshots after seniority changes", () => {
  const explanation = buildDecisionExplanation({
    termCode: "SP27",
    division: "Science",
    sections: [section],
    decisions: [decision],
    submissions: [submission],
    submissionItems: [item],
    currentAnalysis: {
      sections: [{
        assignmentGroupId: "S1",
        candidateList: [
          { employeeId: "F2", facultyName: "Ben Baker", seniorityRank: 1, preferenceRank: 1, qualified: true, reasonCode: "NOT_YET_REACHED" },
          { employeeId: "F1", facultyName: "Ava Andrews", seniorityRank: 9, preferenceRank: 2, qualified: true, reasonCode: "NOT_YET_REACHED" },
        ],
      }],
    },
  });

  const s1 = explanation.sections[0];
  assert.equal(s1.original_system_recommendation.employee_id, "F1");
  assert.deepEqual(s1.interested_faculty.map((candidate) => `${candidate.employee_id}:${candidate.seniority_rank}`), ["F1:1", "F2:2"]);
  assert.equal(s1.chair_decision.employee_id, "F2");
  assert.equal(s1.chair_decision.exception_reason_code, "COURSE_CONTINUITY");
});

test("faculty explanation uses original frozen submission and decision sequence", () => {
  const explanation = buildDecisionExplanation({
    termCode: "SP27",
    division: "Science",
    sections: [section],
    decisions: [decision],
    submissions: [submission],
    submissionItems: [item],
  });
  const faculty = explanation.faculty.find((row) => row.employee_id === "F1");

  assert.equal(faculty.frozen_submission.preferences[0].assignment_group_id, "S1");
  assert.equal(faculty.selected_sections[0].preference_rank, 1);
  assert.equal(faculty.selected_sections[0].decision_sequence.recommended_employee_id, "F1");
  assert.equal(faculty.selected_sections[0].decision_sequence.selected_employee_id, "F2");
});

test("CSV export rows omit extra employee profile data", () => {
  const explanation = buildDecisionExplanation({
    termCode: "SP27",
    division: "Science",
    sections: [section],
    decisions: [decision],
    submissions: [submission],
    submissionItems: [item],
  });
  const rows = decisionExplanationRows(explanation);

  assert.equal(rows[0].candidate_employee_id, "F1");
  assert.equal(rows[0].candidate_name, "Ava Andrews");
  assert.equal(Object.hasOwn(rows[0], "email"), false);
  assert.equal(Object.hasOwn(rows[0], "employee_id_full_profile"), false);
});

test("schema contains immutable preference submission tables", () => {
  const schema = fs.readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS scope_preference_submissions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS scope_preference_submission_items/);
  assert.match(schema, /submission_snapshot JSONB/);
  assert.match(schema, /item_snapshot JSONB/);
});

test("workflow uses server-authored explanation and export endpoints", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /router\.get\("\/decision-explanations"/);
  assert.match(workflow, /router\.get\("\/decision-explanations\/export\.csv"/);
  assert.match(workflow, /router\.get\("\/decision-explanations\/print"/);
  assert.match(workflow, /submitted_by_email/);
});

test("workflow exposes staged exports with frozen source gates and audit records", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /workflowExportStages = new Set\(\["preference-review", "chair-submission", "final-approved"\]\)/);
  assert.match(workflow, /workflowExportFormats = new Set\(\["xlsx", "pdf", "csv"\]\)/);
  assert.match(workflow, /router\.get\("\/workflow-exports\/:stage\.:format", requireElevatedRole, requireScopedRead/);
  assert.match(workflow, /allowLatestSubmittedFallback: false/);
  assert.match(workflow, /Preference review export is available after the preference window is frozen/);
  assert.match(workflow, /Chair submission export is available after the chair submits the staffing packet/);
  assert.match(workflow, /Final approved staffing export is available after dean approval/);
  assert.match(workflow, /WORKFLOW_EXPORT_GENERATED/);
  assert.match(workflow, /writeAuditEvent\(client, req/);
});

test("workflow export files include readable names, headers, legends, and formats", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /function workflowExportFilename/);
  assert.match(workflow, /SHERMAN_\$\{safeFilePart\(termCode\)\}_\$\{safeFilePart\(divisionLabel\)\}_\$\{safeFilePart\(humanStageLabel\(stage\)\)\}_\$\{exportDateStamp\(generatedAt\)\}\.\$\{format\}/);
  assert.match(workflow, /Preference Review/);
  assert.match(workflow, /Chair Submission/);
  assert.match(workflow, /Final Approved Staffing/);
  assert.match(workflow, /Content-Type", "application\/pdf"/);
  assert.match(workflow, /Content-Type", "application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"/);
  assert.match(workflow, /Legend: Seniority rank is the roster order/);
  assert.match(workflow, /"System Seniority Recommendation"/);
  assert.match(workflow, /"Contractual Exception Code"/);
  assert.match(workflow, /"Dean Approval Date"/);
});
