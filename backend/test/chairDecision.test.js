import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeAllocation } from "../domain/allocationAnalysis.js";
import { validateChairDecision } from "../domain/chairDecision.js";
import { requireDivisionScope, requireRoles } from "../permissions.js";
import { allocationFixture } from "./fixtures/allocationFixture.js";

function analysis(overrides = {}) {
  return analyzeAllocation(allocationFixture(overrides));
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("recommended candidate can be selected without an exception", () => {
  const result = validateChairDecision({
    analysis: analysis(),
    assignmentGroupId: "S2",
    selectedEmployeeId: "F1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.isRecommended, true);
  assert.equal(result.decisionStatus, "tentative");
  assert.equal(result.recommendationSnapshot.recommendedEmployeeId, "F1");
});

test("lower-seniority candidate cannot be selected without a contractual reason", () => {
  const result = validateChairDecision({
    analysis: analysis(),
    assignmentGroupId: "S4",
    selectedEmployeeId: "F4",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /contractual exception/i);
});

test("exception decision retains original recommendation snapshot", () => {
  const result = validateChairDecision({
    analysis: analysis(),
    assignmentGroupId: "S4",
    selectedEmployeeId: "F4",
    exceptionReasonCode: "DUAL_ENROLLMENT_SITE_POSITION",
    exceptionExplanation: "Instructor is assigned to the partner high school site for this dual-enrollment section.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.decisionStatus, "bypassed");
  assert.equal(result.recommendationSnapshot.recommendedEmployeeId, "F1");
  assert.equal(result.decisionSnapshot.selectedEmployeeId, "F4");
  assert.equal(result.decisionSnapshot.exceptionReasonCode, "DUAL_ENROLLMENT_SITE_POSITION");
});

test("OTHER_CONTRACTUAL_EXCEPTION requires a detailed explanation", () => {
  const result = validateChairDecision({
    analysis: analysis(),
    assignmentGroupId: "S4",
    selectedEmployeeId: "F4",
    exceptionReasonCode: "OTHER_CONTRACTUAL_EXCEPTION",
    exceptionExplanation: "Other.",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /detailed explanation/i);
});

test("division scope rejects action outside assigned division", () => {
  const req = {
    auth: { user: { role: "chair", division: "Science" } },
    body: { division: "Business" },
    query: {},
  };
  const res = mockRes();
  let nextCalled = false;

  requireDivisionScope(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("faculty user cannot make chair decisions", () => {
  const req = { auth: { user: { role: "faculty" } }, body: {}, query: {} };
  const res = mockRes();
  let nextCalled = false;

  requireRoles("chair")(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("schema records durable decision state for page reloads", () => {
  const schema = fs.readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS scope_chair_decisions/);
  assert.match(schema, /recommendation_snapshot JSONB/);
  assert.match(schema, /decision_snapshot JSONB/);
});

test("schema and route guard simultaneous conflicting awards", () => {
  const schema = fs.readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8");
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_assignments_one_active_section/);
  assert.match(workflow, /FOR UPDATE/);
  assert.match(workflow, /This staffing unit already has an active chair decision or assignment/);
});

test("chair review UI separates selected faculty rank from section-level preference rank", () => {
  const frontend = fs.readFileSync(new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url), "utf8");

  assert.match(frontend, /Submitted faculty list/);
  assert.match(frontend, /Selected Faculty Preferences/);
  assert.match(frontend, /selectedReviewFacultyName.*preference #/);
  assert.match(frontend, /Highest submitted preference #/);
  assert.match(frontend, /Own preference #/);
  assert.match(frontend, /effectiveRecommendedEmployeeId = backendRecommendedEmployeeId \|\| topCandidate\?\.employee_id/);
  assert.match(frontend, /item\.label \|\| `\$\{facultyName\(item\)\} - \$\{item\.seniorityRank \?\? "no seniority"\}`/);
  assert.match(frontend, /\{item\.facultyName\} - \{item\.seniorityRank \?\? "no seniority"\}/);
  assert.match(frontend, /const candidateLimit = 6/);
  assert.match(frontend, /visibleCandidates\.map/);
  assert.match(frontend, /Show \$\{hiddenCandidateCount\} more/);
  assert.match(frontend, /setTentativeAssignments\(\(current\) => \[/);
  assert.match(frontend, /setWorkflowView\("assigned"\)/);
  assert.match(frontend, /loadChairWorkflow\(\{ preserveMessage: true, preserveAssignmentsOnError: true \}\)/);
});
