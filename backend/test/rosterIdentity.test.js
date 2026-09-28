import test from "node:test";
import assert from "node:assert/strict";
import { resolvePreferenceFacultyRoster } from "../routes/workflow.js";

test("faculty roster ownership uses the assigned employee ID, never supplied aliases", async () => {
  let values;
  const db = async (_sql, params) => { values = params; return { rows: [{ employee_id: "F1", division: "Science" }] }; };
  const result = await resolvePreferenceFacultyRoster(db, {
    employeeId: "OTHER", facultyId: "OTHER",
    authUser: { role: "faculty", employee_id: "F1", division: "Science", full_name: "Other Person", email: "other@example.invalid" },
  });
  assert.deepEqual(values, ["F1"]);
  assert.equal(result.employee_id, "F1");
});

test("missing, ambiguous, and out-of-scope roster links fail closed", async () => {
  let queries = 0;
  const db = async () => { queries++; return { rows: [{ employee_id: "F1", division: "Science" }] }; };
  assert.equal(await resolvePreferenceFacultyRoster(db, { facultyId: "F1", authUser: { role: "faculty", full_name: "Same Name" } }), null);
  assert.equal(queries, 0);
  assert.equal(await resolvePreferenceFacultyRoster(db, { authUser: { role: "faculty", employee_id: "F1", division: "Arts" } }), null);
  const ambiguous = async () => ({ rows: [{ employee_id: "F1", division: "Science" }, { employee_id: "F1", division: "Arts" }] });
  assert.equal(await resolvePreferenceFacultyRoster(ambiguous, { facultyId: "F1" }), null);
  const missing = async () => ({ rows: [] });
  assert.equal(await resolvePreferenceFacultyRoster(missing, { authUser: { role: "faculty", employee_id: "UNKNOWN", division: "Science", full_name: "Same Name", email: "same@example.invalid" } }), null);
});
