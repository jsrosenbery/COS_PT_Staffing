import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { runMigrations } from "../migrations.js";

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

const TERM = "2099FA";
const SCIENCE = "Science";
const ARTS = "Arts";
const sections = ["S-A1", "S-A2", "S-A3"];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function actorHeaders(role, division, employeeId = "") {
  return {
    "x-test-role": role,
    "x-test-division": division,
    "x-test-employee-id": employeeId,
  };
}

integrationTest("complete staffing lifecycle preserves institutional rules in PostgreSQL", { timeout: 120_000 }, async (t) => {
  const schema = `staffing_lifecycle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new Pool({ connectionString: testDatabaseUrl });
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);

  const scopedUrl = new URL(testDatabaseUrl);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = scopedUrl.toString();
  process.env.EMAIL_PROVIDER = "console";

  const [{ default: express }, { pool }, { default: persistenceRoutes }, { default: workflowRoutes }] = await Promise.all([
    import("express"),
    import("../db.js"),
    import("../routes/persistence.js"),
    import("../routes/workflow.js"),
  ]);

  await runMigrations({ pool, logger: { info() {} } });

  let requestSequence = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    requestSequence += 1;
    const role = req.get("x-test-role") || "faculty";
    const employeeId = req.get("x-test-employee-id") || "";
    req.correlationId = `integration-${requestSequence}`;
    req.auth = role === "admin"
      ? { authType: "api-token", user: { role: "admin", email: "admin@test.invalid", full_name: "Test Admin", division: "" } }
      : {
          authType: "session",
          user: {
            role,
            division: req.get("x-test-division") || "",
            employee_id: employeeId,
            email: `${employeeId || role}@test.invalid`,
            full_name: `Test ${role}`,
          },
        };
    next();
  });
  app.use("/api", persistenceRoutes);
  app.use("/api", workflowRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function api(path, { method = "GET", role = "admin", division = "", employeeId = "", body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...actorHeaders(role, division, employeeId),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    return { status: response.status, body: payload };
  }

  async function savePreferences(employeeId, facultyName, preferences, action = "submit") {
    return api("/api/preferences", {
      method: "POST",
      role: "faculty",
      division: SCIENCE,
      employeeId,
      body: {
        termCode: TERM,
        facultyId: employeeId,
        employeeId,
        facultyName,
        action,
        preferences,
        availability: { days: ["Monday", "Wednesday"], timeBlocks: ["morning"] },
      },
    });
  }

  try {
    await t.test("term, divisions, staffing units, and representative faculty are established", async () => {
      const term = await api("/api/terms", {
        method: "POST",
        body: { termCode: TERM, termName: "Fall 2099", isActive: true },
      });
      assert.equal(term.status, 200);
      assert.equal(term.body.term.term_code, TERM);

      const faculty = [
        { employee_id: "F1", first_name: "Ada", last_name: "Senior", email: "f1@test.invalid", division: SCIENCE, discipline: "MATH", seniority_rank: "1", qualified_disciplines: "MATH|STAT" },
        { employee_id: "F2", first_name: "Bea", last_name: "Equal", email: "f2@test.invalid", division: SCIENCE, discipline: "MATH", seniority_rank: "2", qualified_disciplines: "MATH|STAT" },
        { employee_id: "F3", first_name: "Cal", last_name: "Equal", email: "f3@test.invalid", division: SCIENCE, discipline: "MATH", seniority_rank: "2", qualified_disciplines: "MATH|STAT" },
        { employee_id: "F4", first_name: "Dee", last_name: "Unknown", email: "f4@test.invalid", division: SCIENCE, discipline: "MATH", seniority_rank: "", qualified_disciplines: "MATH" },
        { employee_id: "F5", first_name: "Eli", last_name: "Outside", email: "f5@test.invalid", division: ARTS, discipline: "ART", seniority_rank: "0", qualified_disciplines: "ART|MATH" },
      ];
      const roster = await api("/api/pt-faculty", { method: "POST", body: faculty });
      assert.equal(roster.status, 200);
      assert.equal(roster.body.activeCount, 5);

      for (const [termCode, division] of [[TERM, SCIENCE], [TERM, ARTS]]) {
        const opened = await api("/api/windows", {
          method: "POST",
          role: "chair",
          division,
          body: { term: termCode, division, sender_email: "chair@test.invalid", status: "open" },
        });
        assert.equal(opened.status, 200);
      }

      const sectionRows = [
        [TERM, SCIENCE, "S-A1", "MATH 101", "90001", "Algebra", "MATH", "MATH"],
        [TERM, SCIENCE, "S-A2", "MATH 102", "90002", "Geometry", "MATH", "MATH"],
        [TERM, SCIENCE, "S-A3", "STAT 101", "90003", "Statistics", "STAT", "STAT"],
        [TERM, ARTS, "S-B1", "ART 101", "91001", "Drawing", "ART", "ART"],
      ];
      for (const row of sectionRows) {
        await pool.query(
          `INSERT INTO scope_sections
             (term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, subject_code, discipline_code, raw_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{"staff_eligible":true}'::jsonb)`,
          row
        );
      }
      const divisions = await pool.query("SELECT DISTINCT division FROM scope_sections ORDER BY division");
      assert.deepEqual(divisions.rows.map((row) => row.division), [ARTS, SCIENCE]);
    });

    await t.test("draft, submission, resubmission, validation, and freeze behavior use versioned preferences", async () => {
      const f1Draft = await savePreferences("F1", "Ada Senior", [
        { assignment_group_id: "S-A2", discipline_code: "MATH", preference_rank: 1 },
        { assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 2 },
      ], "draft");
      assert.equal(f1Draft.status, 200);
      assert.equal(f1Draft.body.status, "draft");

      const duplicateRank = await savePreferences("F2", "Bea Equal", [
        { assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 1 },
        { assignment_group_id: "S-A2", discipline_code: "MATH", preference_rank: 1 },
      ]);
      assert.equal(duplicateRank.status, 400);

      const duplicateSection = await savePreferences("F2", "Bea Equal", [
        { assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 1 },
        { assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 2 },
      ]);
      assert.equal(duplicateSection.status, 400);

      const f1Submitted = await savePreferences("F1", "Ada Senior", [
        { assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 1 },
        { assignment_group_id: "S-A2", discipline_code: "MATH", preference_rank: 2 },
        { assignment_group_id: "S-A3", discipline_code: "STAT", preference_rank: 3 },
      ]);
      assert.equal(f1Submitted.body.versionNumber, 2);

      const f1Resubmitted = await savePreferences("F1", "Ada Senior", [
        { assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 1 },
        { assignment_group_id: "S-A3", discipline_code: "STAT", preference_rank: 2 },
        { assignment_group_id: "S-A2", discipline_code: "MATH", preference_rank: 3 },
      ]);
      assert.equal(f1Resubmitted.body.versionNumber, 3);

      for (const [id, name, prefs] of [
        ["F2", "Bea Equal", sections.map((assignment_group_id, index) => ({ assignment_group_id, discipline_code: assignment_group_id === "S-A3" ? "STAT" : "MATH", preference_rank: index + 1 }))],
        ["F3", "Cal Equal", ["S-A2", "S-A3", "S-A1"].map((assignment_group_id, index) => ({ assignment_group_id, discipline_code: assignment_group_id === "S-A3" ? "STAT" : "MATH", preference_rank: index + 1 }))],
        ["F4", "Dee Unknown", [{ assignment_group_id: "S-A1", discipline_code: "MATH", preference_rank: 1 }]],
      ]) {
        assert.equal((await savePreferences(id, name, prefs)).status, 200);
      }

      const freeze = await api("/api/windows/freeze", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: { termCode: TERM, division: SCIENCE, auditReason: "Preference deadline reached." },
      });
      assert.equal(freeze.status, 200);
      assert.equal(freeze.body.frozenCount, 4);

      const forbiddenChange = await savePreferences("F1", "Ada Senior", [
        { assignment_group_id: "S-A2", discipline_code: "MATH", preference_rank: 1 },
      ]);
      assert.equal(forbiddenChange.status, 409);

      const versions = await pool.query(
        "SELECT version_number, status FROM scope_preference_submissions WHERE term_code = $1 AND faculty_id = 'F1' ORDER BY version_number",
        [TERM]
      );
      assert.deepEqual(versions.rows, [
        { version_number: 1, status: "draft" },
        { version_number: 2, status: "superseded" },
        { version_number: 3, status: "frozen" },
      ]);
    });

    let analysis;
    await t.test("allocation is deterministic, scoped, seniority-aware, and pass-limited", async () => {
      const query = `/api/allocation-analysis?termCode=${TERM}&division=${encodeURIComponent(SCIENCE)}&maxAssignments=1&maxLoad=1`;
      const first = await api(query, { role: "chair", division: SCIENCE });
      const second = await api(query, { role: "chair", division: SCIENCE });
      assert.equal(first.status, 200);
      assert.deepEqual(first.body.analysis.recommendedNextAssignmentSequence, second.body.analysis.recommendedNextAssignmentSequence);
      analysis = first.body.analysis;

      const sequence = analysis.recommendedNextAssignmentSequence;
      assert.deepEqual(sequence.map((item) => item.employeeId), ["F1", "F2", "F3"]);
      assert.equal(new Set(sequence.map((item) => item.employeeId)).size, sequence.length);
      assert.ok(analysis.warnings.some((warning) => warning.reasonCode === "MISSING_SENIORITY" && warning.employeeId === "F4"));
      assert.ok(analysis.faculty.find((row) => row.employeeId === "F1").rankedPreferences.some((pref) => pref.reasonCode === "ALREADY_ASSIGNED_IN_THIS_PASS"));
      assert.equal(analysis.faculty.some((row) => row.employeeId === "F5"), false);

      const outsideScope = await api(query, { role: "chair", division: ARTS });
      assert.equal(outsideScope.status, 403);
    });

    const decisions = new Map();
    await t.test("chair accepts a recommendation and records an explained contractual override", async () => {
      const recommendations = new Map(analysis.recommendedNextAssignmentSequence.map((item) => [item.assignmentGroupId, item.employeeId]));
      const accepted = await api("/api/chair-decisions", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: {
          termCode: TERM,
          assignmentGroupId: "S-A1",
          selectedEmployeeId: recommendations.get("S-A1"),
          expectedRecommendedEmployeeId: recommendations.get("S-A1"),
        },
      });
      assert.equal(accepted.status, 201);
      decisions.set("S-A1", accepted.body.decision);

      const missingExplanation = await api("/api/chair-decisions", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: {
          termCode: TERM,
          division: SCIENCE,
          assignmentGroupId: "S-A2",
          selectedEmployeeId: "F3",
          exceptionReasonCode: "SPECIALIZED_QUALIFICATION",
          exceptionExplanation: "",
        },
      });
      assert.equal(missingExplanation.status, 400);

      const explanation = "Faculty member F3 has the approved specialized qualification required for this section.";
      const override = await api("/api/chair-decisions", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: {
          termCode: TERM,
          division: SCIENCE,
          assignmentGroupId: "S-A2",
          selectedEmployeeId: "F3",
          exceptionReasonCode: "SPECIALIZED_QUALIFICATION",
          exceptionExplanation: explanation,
        },
      });
      assert.equal(override.status, 201);
      decisions.set("S-A2", override.body.decision);
      const stored = await pool.query("SELECT exception_reason_code, exception_explanation FROM scope_chair_decisions WHERE id = $1", [override.body.decision.id]);
      assert.deepEqual(stored.rows[0], { exception_reason_code: "SPECIALIZED_QUALIFICATION", exception_explanation: explanation });

      const facultyAttempt = await api("/api/chair-decisions", {
        method: "POST",
        role: "faculty",
        division: SCIENCE,
        employeeId: "F1",
        body: { termCode: TERM, division: SCIENCE, assignmentGroupId: "S-A3", selectedEmployeeId: "F2" },
      });
      assert.equal(facultyAttempt.status, 403);
    });

    await t.test("two chairs cannot assign the same staffing unit", async () => {
      const concurrencyTerm = "2099CO";
      await pool.query("INSERT INTO scope_terms (term_code, term_name) VALUES ($1, 'Concurrency Test Term')", [concurrencyTerm]);
      await pool.query(
        `INSERT INTO scope_sections
           (term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, subject_code, discipline_code, raw_row)
         VALUES ($1,$2,'CONCURRENT-1','MATH 250','92500','Concurrency Fixture','MATH','MATH','{"staff_eligible":true}'::jsonb)`,
        [concurrencyTerm, SCIENCE]
      );
      const submission = await pool.query(
        `INSERT INTO scope_preference_submissions
           (term_code, faculty_id, employee_id, faculty_name, division, discipline_code, status, version_number,
            submission_snapshot, submitted_at, frozen_at)
         VALUES ($1,'F2','F2','Bea Equal',$2,'MATH','frozen',1,'{}'::jsonb,NOW(),NOW())
         RETURNING id`,
        [concurrencyTerm, SCIENCE]
      );
      await pool.query(
        `INSERT INTO scope_preference_submission_items
           (submission_id, term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank, item_snapshot)
         VALUES ($1,$2,'F2','F2','Bea Equal','CONCURRENT-1','MATH',1,'{}'::jsonb)`,
        [submission.rows[0].id, concurrencyTerm]
      );
      const request = () => api("/api/chair-decisions", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: {
          termCode: concurrencyTerm,
          division: SCIENCE,
          assignmentGroupId: "CONCURRENT-1",
          selectedEmployeeId: "F2",
          expectedRecommendedEmployeeId: "F2",
        },
      });
      const results = await Promise.all([request(), request()]);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
      const active = await pool.query("SELECT COUNT(*)::int AS count FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = 'CONCURRENT-1' AND status = 'tentative'", [concurrencyTerm]);
      assert.equal(active.rows[0].count, 1);
    });

    await t.test("chair submission, dean return, revision, resubmission, and approval are auditable", async () => {
      const submitted = await api("/api/assignments/submit", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: { termCode: TERM, divisions: [SCIENCE] },
      });
      assert.equal(submitted.status, 200);
      assert.equal(submitted.body.submittedCount, 2);

      const chairCannotReturn = await api("/api/assignments/return", {
        method: "POST",
        role: "chair",
        division: SCIENCE,
        body: { termCode: TERM, divisions: [SCIENCE], reason: "Dean review required." },
      });
      assert.equal(chairCannotReturn.status, 403);

      const returned = await api("/api/assignments/return", {
        method: "POST",
        role: "dean",
        division: SCIENCE,
        body: { termCode: TERM, divisions: [SCIENCE], reason: "Clarify the contractual exception and resubmit." },
      });
      assert.equal(returned.status, 200);
      assert.equal(returned.body.returnedCount, 2);

      for (const [groupId, decision] of decisions.entries()) {
        const revised = await api("/api/assignments", {
          method: "POST",
          role: "chair",
          division: SCIENCE,
          body: {
            termCode: TERM,
            assignmentGroupId: groupId,
            disciplineCode: groupId === "S-A3" ? "STAT" : "MATH",
            employeeId: decision.selected_employee_id,
            reason: "Chair revision completed after dean feedback.",
          },
        });
        assert.equal(revised.status, 200);
      }

      assert.equal((await api("/api/assignments/submit", {
        method: "POST", role: "chair", division: SCIENCE, body: { termCode: TERM, divisions: [SCIENCE] },
      })).body.submittedCount, 2);
      const approved = await api("/api/assignments/approve", {
        method: "POST", role: "dean", division: SCIENCE, body: { termCode: TERM, divisions: [SCIENCE] },
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.body.approvedCount, 2);
    });

    await t.test("two updates using the same version reject the stale writer", async () => {
      await pool.query(
        `INSERT INTO scope_sections
           (term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, subject_code, discipline_code, raw_row)
         VALUES ($1,$2,'S-STALE','MATH 199','90099','Special Topics','MATH','MATH','{"staff_eligible":true}'::jsonb)`,
        [TERM, SCIENCE]
      );
      const saved = await api("/api/assignments", {
        method: "POST", role: "chair", division: SCIENCE,
        body: { termCode: TERM, assignmentGroupId: "S-STALE", disciplineCode: "MATH", employeeId: "F1", reason: "Concurrency fixture." },
      });
      assert.equal(saved.status, 200);
      const reassign = (employeeId) => api(`/api/assignments/${saved.body.id}/reassign`, {
        method: "PUT", role: "chair", division: SCIENCE,
        body: { employeeId, reason: "Concurrent chair correction.", expectedVersion: saved.body.version },
      });
      const results = await Promise.all([reassign("F2"), reassign("F3")]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
      assert.equal(results.find((result) => result.status === 409).body.code, "STALE_ASSIGNMENT");
    });

    await t.test("preference freeze racing with submission leaves no mutable submitted version", async () => {
      const raceTerm = "2099SP";
      await api("/api/terms", { method: "POST", body: { termCode: raceTerm, termName: "Spring 2099" } });
      await api("/api/windows", {
        method: "POST", role: "chair", division: SCIENCE,
        body: { term: raceTerm, division: SCIENCE, sender_email: "chair@test.invalid", status: "open" },
      });
      await pool.query(
        `INSERT INTO scope_sections
           (term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, subject_code, discipline_code, raw_row)
         VALUES ($1,$2,'RACE-1','MATH 201','92001','Race Fixture','MATH','MATH','{"staff_eligible":true}'::jsonb)`,
        [raceTerm, SCIENCE]
      );
      const submit = api("/api/preferences", {
        method: "POST", role: "faculty", division: SCIENCE, employeeId: "F1",
        body: {
          termCode: raceTerm, facultyId: "F1", employeeId: "F1", facultyName: "Ada Senior", action: "submit",
          preferences: [{ assignment_group_id: "RACE-1", discipline_code: "MATH", preference_rank: 1 }],
        },
      });
      const freeze = api("/api/windows/freeze", {
        method: "POST", role: "chair", division: SCIENCE,
        body: { termCode: raceTerm, division: SCIENCE, auditReason: "Race test freeze." },
      });
      const [submitResult, freezeResult] = await Promise.all([submit, freeze]);
      assert.ok([200, 409].includes(submitResult.status));
      assert.equal(freezeResult.status, 200);
      const mutable = await pool.query("SELECT COUNT(*)::int AS count FROM scope_preference_submissions WHERE term_code = $1 AND status IN ('submitted','corrected')", [raceTerm]);
      assert.equal(mutable.rows[0].count, 0);
    });

    await t.test("historical explanations use frozen snapshots and mutation audit is server-generated", async () => {
      await pool.query("UPDATE scope_pt_faculty SET first_name = 'Changed', last_name = 'Record', seniority_rank = '99', seniority_value = '99' WHERE employee_id = 'F1'");
      const response = await api(`/api/decision-explanations?termCode=${TERM}&division=${encodeURIComponent(SCIENCE)}`, {
        role: "chair", division: SCIENCE,
      });
      assert.equal(response.status, 200);
      const a1 = response.body.explanation.sections.find((section) => section.assignment_group_id === "S-A1");
      assert.equal(a1.snapshot_source, "chair_decision_snapshot");
      assert.equal(a1.original_system_recommendation.faculty_name, "Ada Senior");
      assert.equal(Number(a1.original_system_recommendation.seniority_rank), 1);

      const events = await pool.query("SELECT event_type, source, request_id, note FROM scope_audit_log WHERE term = $1 ORDER BY id", [TERM]);
      const eventTypes = new Set(events.rows.map((row) => row.event_type));
      for (const expected of [
        "PREFERENCE_DRAFT_SAVED",
        "PREFERENCE_VERSION_SUBMITTED",
        "PREFERENCE_WINDOW_FROZEN",
        "CHAIR_DECISION_RECORDED",
        "CHAIR_SUBMITTED",
        "DEAN_RETURNED_FOR_REVISION",
        "ASSIGNMENT_SAVED",
        "DEAN_APPROVED",
      ]) assert.ok(eventTypes.has(expected), `missing audit event ${expected}`);
      assert.ok(events.rows.every((row) => row.source === "backend"));
      assert.ok(events.rows.filter((row) => row.event_type !== "PREFERENCE_WINDOW_FROZEN" && row.event_type !== "PREFERENCE_DRAFT_SAVED" && row.event_type !== "PREFERENCE_VERSION_SUBMITTED").every((row) => row.request_id.startsWith("integration-")));
      assert.ok(events.rows.find((row) => row.event_type === "DEAN_RETURNED_FOR_REVISION").note.includes("Clarify the contractual exception"));

      const genericAuditAppend = await api("/api/audit", {
        method: "POST",
        body: { event_type: "CLIENT_CONTROLLED", note: "must not be accepted" },
      });
      assert.equal(genericAuditAppend.status, 404);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_audit_log WHERE event_type = 'CLIENT_CONTROLLED'")).rows[0].count, 0);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
    await adminPool.end();
  }
});
