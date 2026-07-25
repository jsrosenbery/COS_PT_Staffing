import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canSavePreferenceVersion,
  preferenceSubmissionStatuses,
  preferenceWindowTimezone,
  validatePreferenceRanks,
  windowState,
} from "../domain/preferenceSubmissionPolicy.js";

const openWindow = {
  term: "SP27",
  division: "Science",
  opened_at: "2027-01-01T08:00:00.000Z",
  closes_at: "2027-01-10T08:00:00.000Z",
  status: "open",
};

test("draft save is allowed while the window is open", () => {
  const result = canSavePreferenceVersion({
    action: "draft",
    windowRow: openWindow,
    now: "2027-01-05T08:00:00.000Z",
    actorRole: "faculty",
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.open, true);
});

test("final submission is allowed while the window remains open", () => {
  const result = canSavePreferenceVersion({
    action: "submit",
    windowRow: openWindow,
    now: "2027-01-09T08:00:00.000Z",
    actorRole: "faculty",
  });

  assert.equal(result.ok, true);
});

test("deadline race treats equality with closes_at as closed", () => {
  const state = windowState(openWindow, "2027-01-10T08:00:00.000Z");

  assert.equal(state.open, false);
  assert.equal(state.closed, true);
});

test("attempted faculty submission after closure is rejected", () => {
  const result = canSavePreferenceVersion({
    action: "submit",
    windowRow: openWindow,
    now: "2027-01-10T08:00:00.001Z",
    actorRole: "faculty",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /closed/i);
});

test("missing preference window is reported without throwing", () => {
  const result = canSavePreferenceVersion({
    action: "submit",
    windowRow: null,
    now: "2027-01-05T08:00:00.000Z",
    actorRole: "faculty",
  });

  assert.equal(result.ok, false);
  assert.equal(result.state.open, false);
  assert.equal(result.state.missing, true);
  assert.match(result.error, /No preference window is configured/i);
});

test("faculty section and preference reads are hidden until the window opens", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");
  const frontend = fs.readFileSync(new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url), "utf8");

  assert.match(workflow, /router\.get\("\/available-sections"/);
  assert.match(workflow, /String\(req\.auth\?\.user\?\.role \|\| ""\)\.toLowerCase\(\) === "faculty"/);
  assert.match(workflow, /windowState\(windowResult\.rows\[0\] \|\| null, new Date\(\)\)/);
  assert.match(workflow, /return res\.json\(\{\s+sections: \[\],\s+window: state,/);
  assert.match(workflow, /return res\.json\(\{\s+preferences: \[\],\s+availability: \{ days: \[\], timeBlocks: \[\] \},\s+window: state,/);
  assert.match(frontend, /Preference Window Not Open/);
  assert.match(frontend, /role === "faculty" && !facultyPreferenceWindowOpen/);
  assert.match(frontend, /setFacultyPreferences\(\[\]\)/);
});

test("preference submission reports an unlinked faculty roster account before checking its window", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /async function resolvePreferenceFacultyRoster/);
  assert.match(workflow, /LOWER\(email\) = LOWER\(\$2\)/);
  assert.match(workflow, /REGEXP_REPLACE\(CONCAT_WS\('', first_name, last_name\)/);
  assert.match(workflow, /if \(!facultyRosterRow\) \{\s+await client\.query\("ROLLBACK"\)/);
  assert.match(workflow, /Your account is not linked to an active PT staffing roster record/);
});

test("administrator correction after closure is explicit and requires an audit reason in the route", () => {
  const result = canSavePreferenceVersion({
    action: "admin_correct",
    windowRow: openWindow,
    now: "2027-01-10T08:00:00.001Z",
    actorRole: "admin",
  });

  assert.equal(result.ok, true);
  assert.equal(result.requiresAuditReason, true);
});

test("rank validation rejects duplicate ranks and duplicate sections", () => {
  const errors = validatePreferenceRanks([
    { assignment_group_id: "S1", preference_rank: 1 },
    { assignment_group_id: "S1", preference_rank: 2 },
    { assignment_group_id: "S3", preference_rank: 2 },
    { assignment_group_id: "S4", preference_rank: "bad" },
  ]);

  assert.ok(errors.some((error) => error.code === "DUPLICATE_SECTION"));
  assert.ok(errors.some((error) => error.code === "DUPLICATE_RANK"));
  assert.ok(errors.some((error) => error.code === "INVALID_RANK"));
});

test("status catalog distinguishes draft, submitted, frozen, and superseded versions", () => {
  assert.equal(preferenceSubmissionStatuses.DRAFT, "draft");
  assert.equal(preferenceSubmissionStatuses.SUBMITTED, "submitted");
  assert.equal(preferenceSubmissionStatuses.FROZEN, "frozen");
  assert.equal(preferenceSubmissionStatuses.SUPERSEDED, "superseded");
});

test("window timezone is documented as America/Los_Angeles", () => {
  assert.equal(preferenceWindowTimezone, "America/Los_Angeles");
});

test("schema stores versioning, frozen, superseded, actor, and uniqueness fields", () => {
  const schema = fs.readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8");

  assert.match(schema, /status TEXT NOT NULL DEFAULT 'submitted'/);
  assert.match(schema, /version_number INTEGER NOT NULL DEFAULT 1/);
  assert.match(schema, /submitted_at TIMESTAMPTZ/);
  assert.match(schema, /frozen_at TIMESTAMPTZ/);
  assert.match(schema, /superseded_at TIMESTAMPTZ/);
  assert.match(schema, /submitted_by_email/);
  assert.match(schema, /source TEXT NOT NULL DEFAULT 'web'/);
  assert.match(schema, /idx_scope_preference_submission_rank_unique/);
  assert.match(schema, /idx_scope_preference_submission_section_unique/);
  assert.match(schema, /idx_scope_preference_one_frozen/);
});

test("workflow freezes latest submitted versions and allocation reads frozen items only", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /freezeLatestSubmittedVersions/);
  assert.match(workflow, /status = 'frozen'/);
  assert.match(workflow, /scope_preference_submission_items i/);
  assert.doesNotMatch(workflow, /FROM scope_preferences p\s+WHERE p\.term_code = \$1\s+AND p\.assignment_group_id = ANY\(\$2::text\[\]\)/);
});
