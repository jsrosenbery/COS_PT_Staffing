import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { auditActor, requestId, writeAuditEvent } from "../audit.js";

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

test("audit actor metadata is derived from authentication, not request body", () => {
  const actor = auditActor({
    auth: {
      authType: "session",
      user: {
        id: 42,
        email: "chair@cos.edu",
        full_name: "Division Chair",
        role: "chair",
      },
    },
    body: {
      actor_name: "Forged Admin",
      actor_role: "admin",
      source: "browser",
    },
  });

  assert.deepEqual(actor, {
    actorUserId: 42,
    actorEmail: "chair@cos.edu",
    actorName: "Division Chair",
    actorRole: "chair",
    actorSessionType: "session",
  });
});

test("audit request id uses caller correlation id when present", () => {
  const req = { correlationId: "req-123" };

  assert.equal(requestId(req), "req-123");
});

test("audit records ignore unvalidated request identifiers", async () => {
  let parameters;
  const client = {
    async query(_sql, values) {
      parameters = values;
      return { rows: [{ id: 1, request_id: values[14] }] };
    },
  };
  const req = { correlationId: "validated-request-7", auth: { authType: "session", user: {} } };

  const result = await writeAuditEvent(client, req, {
    eventType: "TEST_EVENT",
    requestId: "forged\nlog-entry",
  });

  assert.equal(parameters[14], "validated-request-7");
  assert.equal(result.request_id, "validated-request-7");
});

test("generic client-controlled audit write endpoint is removed", () => {
  const persistence = read("../routes/persistence.js");

  assert.doesNotMatch(persistence, /router\.post\(["']\/audit["']/);
});

test("schema stores immutable audit context and optimistic versions", () => {
  const schema = read("../migrations/0001_baseline.sql");

  assert.match(schema, /actor_user_id INTEGER/);
  assert.match(schema, /actor_email TEXT DEFAULT ''/);
  assert.match(schema, /actor_session_type TEXT DEFAULT ''/);
  assert.match(schema, /reason_code TEXT DEFAULT ''/);
  assert.match(schema, /explanation TEXT DEFAULT ''/);
  assert.match(schema, /request_id TEXT DEFAULT ''/);
  assert.match(schema, /scope_assignments[\s\S]*version INTEGER DEFAULT 1/);
  assert.match(schema, /scope_chair_decisions[\s\S]*version INTEGER DEFAULT 1/);
});

test("chair decisions reject stale recommendation snapshots", () => {
  const workflow = read("../routes/workflow.js");

  assert.match(workflow, /expectedRecommendedEmployeeId/);
  assert.match(workflow, /expectedRecommendationSnapshot/);
  assert.match(workflow, /STALE_RECOMMENDATION/);
  assert.match(workflow, /FOR UPDATE/);
  assert.match(workflow, /This staffing unit already has an active chair decision or assignment/);
});

test("assignment mutations lock rows and reject stale browser state", () => {
  const workflow = read("../routes/workflow.js");

  assert.match(workflow, /expectedAssignmentVersion/);
  assert.match(workflow, /expectedVersion/);
  assert.match(workflow, /STALE_ASSIGNMENT/);
  assert.match(workflow, /FOR UPDATE OF a/);
  assert.match(workflow, /version = version \+ 1/);
  assert.match(workflow, /status = 'released'/);
});

test("assignment and chair audit events are server generated", () => {
  const workflow = read("../routes/workflow.js");

  assert.match(workflow, /writeAuditEvent\(client, req, \{\s*eventType: "CHAIR_DECISION_RECORDED"/);
  assert.match(workflow, /eventType: "ASSIGNMENT_SAVED"/);
  assert.match(workflow, /eventType: "ASSIGNMENT_RELEASED"/);
  assert.match(workflow, /eventType: "ASSIGNMENT_REASSIGNED"/);
  assert.doesNotMatch(workflow, /const \{[^}]*actorName[^}]*\} = req\.body/);
});

test("frontend sends stale-write tokens instead of actor identity", () => {
  const frontend = read("../../frontend/src/pt-faculty-staffing-mvp.jsx");

  assert.match(frontend, /expectedRecommendedEmployeeId/);
  assert.match(frontend, /expectedVersion: assignment\.version/);
  assert.doesNotMatch(frontend, /actorName:/);
});
