import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  allowedDivisions,
  currentRole,
  enforceFacultySelf,
  requireDivisionScope,
  requireScopedRead,
  scopeFilterForReq,
} from "../permissions.js";

function req({ role = "chair", division = "Science", query = {}, body = {}, authType = "session", employeeId = "F1" } = {}) {
  return {
    auth: authType === "api-token"
      ? { authType: "api-token", role: "admin" }
      : { authType, user: { role, division, employee_id: employeeId, email: `${role}@cos.edu` } },
    query,
    body,
  };
}

function res() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("requireDivisionScope rejects omitted division for scoped users", () => {
  const request = req({ body: {} });
  const response = res();
  let nextCalled = false;

  requireDivisionScope(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
});

test("chairs and deans with multiple divisions can access only those divisions", () => {
  const request = req({ role: "dean", division: "Science|Business", query: { divisions: "Business|Math" } });

  assert.deepEqual(allowedDivisions(request), ["science", "business"]);
  assert.deepEqual(scopeFilterForReq(request, ["Business", "Math"]), ["business"]);
});

test("role and division authorization comparisons are normalized", () => {
  const request = req({ role: " Chair ", division: " Science | BUSINESS " });
  assert.equal(currentRole(request), "chair");
  assert.deepEqual(allowedDivisions(request), ["science", "business"]);
});

test("account with no valid division scope cannot read all divisions", () => {
  const request = req({ role: "chair", division: "", query: {} });
  const response = res();
  let nextCalled = false;

  requireScopedRead(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
});

test("faculty preference ownership is derived from authenticated session", () => {
  const request = req({ role: "faculty", employeeId: "F1", body: { facultyId: "F2", employeeId: "F2" }, query: { facultyId: "F2" } });
  const response = res();
  let nextCalled = false;

  enforceFacultySelf(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(request.body.employeeId, "F1");
  assert.equal(request.body.facultyId, "F1");
  assert.equal(request.query.facultyId, "F1");
});

test("API token remains isolated as documented admin-equivalent bootstrap behavior", () => {
  const request = req({ authType: "api-token", query: {} });
  const response = res();
  let nextCalled = false;

  requireDivisionScope(request, response, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(scopeFilterForReq(request, []), []);
});

test("admin section reads ignore empty division query values", () => {
  const request = req({ role: "admin", division: "", query: { divisions: "" } });

  assert.deepEqual(scopeFilterForReq(request, [""]), []);
  assert.deepEqual(scopeFilterForReq(request, [" Agriculture ", "", "Business"]), ["agriculture", "business"]);
});

test("faculty section reads fall back to the authenticated division when the query omits divisions", () => {
  const request = req({ role: "faculty", division: "Social Sciences", query: { divisions: "" } });

  assert.deepEqual(scopeFilterForReq(request, [""]), ["social sciences"]);
});

test("faculty section display is bound to the authenticated employee roster record", () => {
  const frontend = fs.readFileSync(
    new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url),
    "utf8"
  );
  const persistence = fs.readFileSync(new URL("../routes/persistence.js", import.meta.url), "utf8");

  assert.match(frontend, /function employeeIdentityKey\(value\)/);
  assert.match(frontend, /function compatibleNameKey\(left, right\)/);
  assert.match(frontend, /const facultyAccountRosterMatch = \(item\) =>/);
  assert.match(frontend, /currentUser\?\.role === "faculty" && role === "faculty" \? \(/);
  assert.match(frontend, /if \(!facultyScopeKeys\.size\) \{\s+return \[\];/);
  assert.match(frontend, /Your account is not linked to an active PT staffing roster record/);
  assert.doesNotMatch(frontend, /role === "faculty" \? normalize\(currentUser\?\.employee_id\)\.toLowerCase\(\) : ""/);
  assert.match(persistence, /if \(currentRole\(req\) === "faculty"\)/);
  assert.match(persistence, /compatiblePersonName\(fullName, row\.faculty_name\)/);
  assert.match(persistence, /AND employee_id = \$1/);
  assert.match(persistence, /return res\.json\(result\.rows\);\s+\}\s+\s+const where = \[\];/);
  assert.match(frontend, /faculty-self-dashboard/);
  assert.match(frontend, /function applyFacultySelfDashboard/);
  assert.match(frontend, /await loadFacultySelfDashboard\(disciplineCode\)/);
  assert.match(frontend, /if \(!canUseAdminTools\) return;\s+if \(skipNextRosterPersistRef\.current\)/);
});

test("faculty preference reload resolves the authenticated account to the active roster identity", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");
  const frontend = fs.readFileSync(
    new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url),
    "utf8"
  );

  assert.match(workflow, /async function resolvePreferenceFacultyRoster/);
  assert.match(workflow, /const runQuery = typeof db === "function" \? db : db\?\.query\?\.bind\(db\)/);
  assert.match(workflow, /function compatiblePersonName\(left, right\)/);
  assert.match(workflow, /fallbackResult\.rows \|\| \[\]\)\.find\(\(row\) => compatiblePersonName\(lookupName, row\.faculty_name\)\)/);
  assert.match(workflow, /LOWER\(email\) = LOWER\(\$2\)/);
  assert.match(workflow, /REGEXP_REPLACE\(CONCAT_WS\('', first_name, last_name\)/);
  assert.match(workflow, /LIKE '%' \|\| LOWER\(REGEXP_REPLACE\(\$3/);
  assert.match(workflow, /const canonicalFacultyId = facultyRosterRow\.employee_id/);
  assert.match(workflow, /p\.faculty_id = ANY\(\$2::text\[\]\) OR p\.employee_id = ANY\(\$2::text\[\]\)/);
  assert.match(workflow, /faculty_id = ANY\(\$2::text\[\]\) OR employee_id = ANY\(\$2::text\[\]\)/);
  assert.match(frontend, /lastFacultyPreferenceLoadRef/);
  assert.match(frontend, /loadFacultyPreferences\(selectedFaculty\.employeeId\)/);
});

test("faculty section reads use the resolved roster division, not a stale account id alone", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /router\.get\("\/faculty-self-dashboard", async/);
  assert.match(workflow, /Faculty account access is required/);
  assert.match(workflow, /rosterRows/);
  assert.match(workflow, /preferences/);
  assert.match(workflow, /availability/);
  assert.match(workflow, /router\.get\("\/available-sections", requireScopedRead/);
  assert.match(workflow, /facultyRosterRow = await resolvePreferenceFacultyRoster/);
  assert.match(workflow, /Ask an administrator to match your account employee ID, email, or name to the roster/);
  assert.match(workflow, /const facultyDivisions = splitScope\(facultyRosterRow\.division\)/);
  assert.match(workflow, /AND LOWER\(division\) = ANY\(\$2::text\[\]\)/);
  assert.match(workflow, /const divisionList = facultyRosterRow\s+\? splitScope\(facultyRosterRow\.division\)/);
});

test("chair and dean frontend reads use authenticated division scope", () => {
  const frontend = fs.readFileSync(
    new URL("../../frontend/src/pt-faculty-staffing-mvp.jsx", import.meta.url),
    "utf8"
  );

  assert.match(frontend, /splitScopeValues\(currentUser\?\.division, currentUser\?\.divisions\)/);
  assert.match(frontend, /if \(role === "chair" && currentUser\?\.role === "chair"\) return authenticatedDivisionScope/);
  assert.match(frontend, /if \(role === "dean" && currentUser\?\.role === "dean"\) return authenticatedDivisionScope/);
  assert.match(frontend, /Your account does not have a division scope assigned/);
  assert.match(frontend, /canSelectSyntheticScope \? \(/);
  assert.match(frontend, /const currentScopeLabel = role === "admin"/);
  assert.match(frontend, /currentUser\?\.role === "dean" \? currentUser\?\.full_name/);
  assert.match(frontend, /\{`Scoped to \$\{currentScopeLabel\}`\}/);
});

test("division-sensitive workflow reads apply scope directly in SQL", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /router\.get\("\/available-sections", requireScopedRead/);
  assert.match(workflow, /router\.get\("\/chair-workflow", requireElevatedRole, requireScopedRead/);
  assert.match(workflow, /router\.get\("\/assignments", requireElevatedRole, requireScopedRead/);
  assert.match(workflow, /LOWER\(s\.division\) = ANY/);
  assert.match(workflow, /scopeFilterForReq\(req/);
});

test("allocation analysis load-status join keeps faculty columns unambiguous", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /LEFT JOIN scope_faculty_load_status fls/);
  assert.match(workflow, /SELECT pt\.employee_id, pt\.first_name, pt\.last_name, pt\.email, pt\.division, pt\.discipline/);
  assert.doesNotMatch(workflow, /SELECT employee_id, first_name, last_name, email, division, discipline/);
});

test("division-sensitive writes derive indirect assignment scope from database", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /SELECT division FROM scope_sections WHERE term_code = \$1 AND assignment_group_id = \$2/);
  assert.match(workflow, /FROM scope_assignments a\s+LEFT JOIN scope_sections s/);
  assert.match(workflow, /router\.post\("\/faculty-load-status", requireRoles\("chair"\)/);
  assert.match(workflow, /const scoped = scopeFilterForReq\(req, \[targetDivision\]\)/);
  assert.match(workflow, /This action is outside your assigned division scope/);
});

test("permission matrix documents API-token behavior and endpoint classes", () => {
  const doc = fs.readFileSync(new URL("../../docs/endpoint-permissions.md", import.meta.url), "utf8");

  assert.match(doc, /API-token authentication is treated as bootstrap\/admin access/);
  assert.match(doc, /GET \/api\/available-sections/);
  assert.match(doc, /POST \/api\/preferences/);
  assert.match(doc, /own-record-only/);
});
