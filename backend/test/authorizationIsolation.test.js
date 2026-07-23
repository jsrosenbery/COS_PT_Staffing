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

  assert.match(frontend, /role === "faculty" \? normalize\(currentUser\?\.employee_id\)\.toLowerCase\(\) : ""/);
  assert.match(frontend, /ownRosterRow\?\.employeeId \|\| ""/);
  assert.match(frontend, /if \(!facultyScopeKeys\.size\) \{\s+return \[\];/);
  assert.match(frontend, /Your account is not linked to an active PT staffing roster record/);
});

test("division-sensitive workflow reads apply scope directly in SQL", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /router\.get\("\/available-sections", requireScopedRead/);
  assert.match(workflow, /router\.get\("\/chair-workflow", requireElevatedRole, requireScopedRead/);
  assert.match(workflow, /router\.get\("\/assignments", requireElevatedRole, requireScopedRead/);
  assert.match(workflow, /LOWER\(s\.division\) = ANY/);
  assert.match(workflow, /scopeFilterForReq\(req/);
});

test("division-sensitive writes derive indirect assignment scope from database", () => {
  const workflow = fs.readFileSync(new URL("../routes/workflow.js", import.meta.url), "utf8");

  assert.match(workflow, /SELECT division FROM scope_sections WHERE term_code = \$1 AND assignment_group_id = \$2/);
  assert.match(workflow, /FROM scope_assignments a\s+LEFT JOIN scope_sections s/);
  assert.match(workflow, /This action is outside your assigned division scope/);
});

test("permission matrix documents API-token behavior and endpoint classes", () => {
  const doc = fs.readFileSync(new URL("../../docs/endpoint-permissions.md", import.meta.url), "utf8");

  assert.match(doc, /API-token authentication is treated as bootstrap\/admin access/);
  assert.match(doc, /GET \/api\/available-sections/);
  assert.match(doc, /POST \/api\/preferences/);
  assert.match(doc, /own-record-only/);
});
