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

test("chair decision route derives division scope from the staffing unit", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /router\.post\("\/chair-decisions", requireRoles\("chair"\), async/);
  assert.match(workflow, /WHERE term_code = \$1 AND assignment_group_id = \$2\s+FOR UPDATE/);
  assert.match(workflow, /const sectionDivision = lockedSection\.rows\[0\]\.division/);
  assert.match(workflow, /scopeFilterForReq\(req, \[sectionDivision\]\)/);
  assert.match(workflow, /const recommendationSnapshot = jsonObjectTextParam\(decision\.recommendationSnapshot\)/);
  assert.match(workflow, /const decisionSnapshot = jsonObjectTextParam\(decision\.decisionSnapshot\)/);
  assert.match(workflow, /recommendation_snapshot: recommendationSnapshotResponse/);
  assert.doesNotMatch(workflow, /JSON\.stringify\(decision\.recommendationSnapshot\)/);
  assert.doesNotMatch(workflow, /JSON\.stringify\(decision\.decisionSnapshot\)/);
  assert.doesNotMatch(workflow, /termCode, division, assignmentGroupId, and selectedEmployeeId are required/);
});

test("chair review UI separates selected faculty rank from section-level preference rank", () => {
  const frontend = fs.readFileSync(new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url), "utf8");

  assert.match(frontend, /Submitted faculty list/);
  assert.match(frontend, /Selected Faculty Preferences/);
  assert.match(frontend, /selectedReviewFacultyName.*preference #/);
  assert.match(frontend, /Highest submitted preference #/);
  assert.match(frontend, /chairPreferenceSourceLabel/);
  assert.match(frontend, /current submitted preference/);
  assert.match(frontend, /Not on matched submitted list/);
  assert.match(frontend, /frozenPreferenceRowCount/);
  assert.match(frontend, /effectiveRecommendedEmployeeId = backendRecommendedEmployeeId \|\| topCandidate\?\.employee_id/);
  assert.match(frontend, /item\.label \|\| `\$\{facultyName\(item\)\} - \$\{item\.seniorityRank \?\? "no seniority"\}`/);
  assert.match(frontend, /\{item\.facultyName\} - \{item\.seniorityRank \?\? "no seniority"\}/);
  assert.match(frontend, /const candidateLimit = 6/);
  assert.match(frontend, /const orderedCandidates = \[\.\.\.section\.candidates\]\.sort/);
  assert.match(frontend, /const primaryCandidates = orderedCandidates\.filter/);
  assert.match(frontend, /const nonRequestingCandidates = orderedCandidates\.filter/);
  assert.match(frontend, /visibleCandidates\.map/);
  assert.match(frontend, /Hide non-requesting faculty/);
  assert.match(frontend, /including non-requesting faculty/);
  assert.match(frontend, /duplicateSeniorityWarnings/);
  assert.match(frontend, /Duplicate seniority ranking detected/);
  assert.match(frontend, /setTentativeAssignments\(\(current\) => \[/);
  assert.match(frontend, /setWorkflowView\("assigned"\)/);
  assert.match(frontend, /loadChairWorkflow\(\{ preserveMessage: true, preserveAssignmentsOnError: true \}\)/);
  assert.match(frontend, /faculty-load-status/);
  assert.match(frontend, /Load complete for now/);
  assert.match(frontend, /row\.load_complete/);
  assert.match(frontend, /Meeting days/);
  assert.match(frontend, /toggleSectionFilter\("days", day\.key\)/);
  assert.match(frontend, /Seniority recommendation/);
  assert.doesNotMatch(frontend, /Backend recommendation/);
  assert.match(frontend, /assignSectionToInstructor\(row, backendRecommendedEmployeeId, requiresPreferenceRationale\)/);
  assert.match(frontend, /window\.alert\(`Assignment was not saved:/);
  assert.match(frontend, /finiteNumberOrNull\(row\.preference_rank\) !== null/);
  assert.match(frontend, /Not Requested/);
  assert.match(frontend, /chairWorkflowRows\.forEach\(\(row\) =>/);
  assert.match(frontend, /if \(rank === null\) return/);
  assert.match(frontend, /return chairWorkflowRows\s+\.filter/);
  assert.doesNotMatch(frontend, /const rowPreferenceRank = finiteNumberOrNull\(row\.preference_rank\) \?\? exportedPreferenceRank/);
  assert.doesNotMatch(frontend, /chairPreferenceRows/);
  assert.doesNotMatch(frontend, /setChairPreferenceRows/);
});

test("chair workflow displays the same frozen preference source used by allocation", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /async function loadFrozenPreferenceRowsForSections/);
  assert.match(workflow, /async function loadPreferenceRowsForSections/);
  assert.match(workflow, /FROM scope_preference_submission_items i/);
  assert.match(workflow, /JOIN scope_preference_submissions s ON s\.id = i\.submission_id/);
  assert.match(workflow, /AND s\.status = 'frozen'/);
  assert.match(workflow, /allowLatestSubmittedFallback/);
  assert.match(workflow, /status IN \('submitted', 'corrected'\)/);
  assert.match(workflow, /source: latestSubmittedRows\.length \? "latest_submitted" : "none"/);
  assert.match(workflow, /preferences: preferenceSource\.rows/);
  assert.match(workflow, /res\.json\(\{ rows, preferenceSource \}\)/);
  assert.match(workflow, /candidateRankByAssignmentEmployee\.set\(key, rank\)/);
  assert.match(workflow, /preference_rank: candidateRankByAssignmentEmployee\.get/);
  assert.match(workflow, /section_preference_rank: sectionRankByAssignment\.get/);
  assert.match(workflow, /original_assignment_group_id: preference\.assignment_group_id/);
  assert.match(workflow, /run\.slice\(-5\)/);
});

test("chair conflict display ignores online sections, includes CRNs, and explains queue labels", () => {
  const frontend = fs.readFileSync(new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url), "utf8");

  assert.match(frontend, /function hasMeetingConflict\(sectionA, sectionB\) \{\s+if \(sectionMethodLabel\(sectionA\) === "ONL" \|\| sectionMethodLabel\(sectionB\) === "ONL"\) return false;\s+return meetingsOverlap\(sectionA\?\.meetings, sectionB\?\.meetings\);/);
  assert.match(frontend, /if \(isAsyncLikeMeeting\(meetingA\)\) continue;/);
  assert.match(frontend, /if \(isAsyncLikeMeeting\(meetingB\)\) continue;/);
  assert.match(frontend, /function sectionConflictLabel\(section\)/);
  assert.match(frontend, /\(CRN \$\{crn\}\)/);
  assert.match(frontend, /Time conflict with \{sectionConflictLabel\(row\.conflicting_assignment\)\}\./);
  assert.match(frontend, /const chairQueueLegend = \[/);
  assert.match(frontend, /Chair Review Guide/);
  assert.match(frontend, /How to Work This Queue/);
  assert.match(frontend, /No availability selected/);
  assert.match(frontend, /Fully online sections are ignored for conflict checks/);
});
