import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { runMigrations } from "../migrations.js";

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? test : test.skip;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function headers(role, division = "", employeeId = "") {
  return {
    "x-test-role": role,
    "x-test-division": division,
    "x-test-employee-id": employeeId,
  };
}

integrationTest("draft preference timestamps and division reset workflow are PostgreSQL-safe", { timeout: 120_000 }, async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const schema = `division_reset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new Pool({ connectionString: testDatabaseUrl });
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);

  const scopedUrl = new URL(testDatabaseUrl);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = scopedUrl.toString();

  const [{ default: express }, { pool }, { default: workflowRoutes }] = await Promise.all([
    import("express"),
    import("../db.js"),
    import("../routes/workflow.js"),
  ]);

  await runMigrations({ pool, logger: { info() {} } });

  let requestCount = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    requestCount += 1;
    const role = req.get("x-test-role") || "faculty";
    const employeeId = req.get("x-test-employee-id") || "";
    req.correlationId = `division-reset-${requestCount}`;
    req.auth = {
      authType: role === "admin" ? "api-token" : "session",
      user: {
        id: role === "admin" ? 1 : 2,
        role,
        division: req.get("x-test-division") || "",
        employee_id: employeeId,
        email: `${employeeId || role}@test.invalid`,
        full_name: `Test ${role}`,
      },
    };
    next();
  });
  app.use("/api", workflowRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function api(path, { method = "GET", role = "admin", division = "", employeeId = "", body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...headers(role, division, employeeId),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
    return { status: response.status, body: payload };
  }

  async function seedDivisionFixture(termCode, division = "Science") {
    await pool.query(
      `INSERT INTO scope_terms (term_code, term_name)
       VALUES ($1, $2)
       ON CONFLICT (term_code) DO NOTHING`,
      [termCode, `${termCode} Test Term`]
    );
    await pool.query(
      `INSERT INTO scope_pt_faculty (employee_id, first_name, last_name, email, division, discipline, seniority_rank)
       VALUES ($1,'Ada','Faculty',$2,$3,'MATH','1')
       ON CONFLICT (employee_id, division, discipline) DO NOTHING`,
      [`${termCode}-F1`, `${termCode.toLowerCase()}-f1@test.invalid`, division]
    );
    await pool.query(
      `INSERT INTO scope_sections
        (term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, subject_code, discipline_code, raw_row)
       VALUES ($1,$2,$3,'MATH 101',$4,'Algebra','MATH','MATH','{"staff_eligible":true}'::jsonb)
       ON CONFLICT (term_code, assignment_group_id) DO NOTHING`,
      [termCode, division, `${termCode}-S1`, termCode.slice(-4)]
    );
    await pool.query(
      `INSERT INTO scope_staffing_windows (term, division, sender_email, status)
       VALUES ($1,$2,'chair@test.invalid','open')`,
      [termCode, division]
    );
    await pool.query(
      `INSERT INTO scope_preferences (term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank)
       VALUES ($1,$2,$2,'Ada Faculty',$3,'MATH',1)`,
      [termCode, `${termCode}-F1`, `${termCode}-S1`]
    );
    await pool.query(
      `INSERT INTO scope_faculty_availability (term_code, faculty_id, employee_id, faculty_name, availability_days, availability_time_blocks)
       VALUES ($1,$2,$2,'Ada Faculty','["Monday"]'::jsonb,'["morning"]'::jsonb)
       ON CONFLICT (term_code, faculty_id) DO NOTHING`,
      [termCode, `${termCode}-F1`]
    );
    const submission = await pool.query(
      `INSERT INTO scope_preference_submissions
        (term_code, faculty_id, employee_id, faculty_name, division, discipline_code, status, version_number, submission_snapshot, submitted_at)
       VALUES ($1,$2,$2,'Ada Faculty',$3,'MATH','submitted',1,'{}'::jsonb,NOW())
       RETURNING id`,
      [termCode, `${termCode}-F1`, division]
    );
    await pool.query(
      `INSERT INTO scope_preference_submission_items
        (submission_id, term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank, item_snapshot)
       VALUES ($1,$2,$3,$3,'Ada Faculty',$4,'MATH',1,'{}'::jsonb)`,
      [submission.rows[0].id, termCode, `${termCode}-F1`, `${termCode}-S1`]
    );
    await pool.query(
      `INSERT INTO scope_faculty_load_status (term_code, division, employee_id, faculty_name, status)
       VALUES ($1,$2,$3,'Ada Faculty','complete')
       ON CONFLICT (term_code, division, employee_id) DO NOTHING`,
      [termCode, division, `${termCode}-F1`]
    );
    await pool.query(
      `INSERT INTO scope_chair_decisions
        (term_code, division, discipline_code, assignment_group_id, recommended_employee_id, selected_employee_id, selected_faculty_name, decision_status)
       VALUES ($1,$2,'MATH',$3,$4,$4,'Ada Faculty','tentative')`,
      [termCode, division, `${termCode}-S1`, `${termCode}-F1`]
    );
    await pool.query(
      `INSERT INTO scope_assignments (term_code, discipline_code, assignment_group_id, employee_id, faculty_name, status)
       VALUES ($1,'MATH',$2,$3,'Ada Faculty','tentative')`,
      [termCode, `${termCode}-S1`, `${termCode}-F1`]
    );
  }

  async function count(termCode, table) {
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE term_code = $1`, [termCode]);
    return result.rows[0].count;
  }

  try {
    await seedDivisionFixture("DRAFT", "Science");

    await t.test("draft, submitted, replacement, and freeze timestamp behavior is correct", async () => {
      const draft = await api("/api/preferences", {
        method: "POST",
        role: "faculty",
        division: "Science",
        employeeId: "DRAFT-F1",
        body: {
          termCode: "DRAFT",
          facultyId: "DRAFT-F1",
          employeeId: "DRAFT-F1",
          facultyName: "Ada Faculty",
          action: "draft",
          preferences: [{ assignment_group_id: "DRAFT-S1", discipline_code: "MATH", preference_rank: 1 }],
        },
      });
      assert.equal(draft.status, 200);

      const draftRow = await pool.query(
        "SELECT status, submitted_at FROM scope_preference_submissions WHERE id = $1",
        [draft.body.submissionId]
      );
      assert.equal(draftRow.rows[0].status, "draft");
      assert.equal(draftRow.rows[0].submitted_at, null);

      const submitted = await api("/api/preferences", {
        method: "POST",
        role: "faculty",
        division: "Science",
        employeeId: "DRAFT-F1",
        body: {
          termCode: "DRAFT",
          facultyId: "DRAFT-F1",
          employeeId: "DRAFT-F1",
          facultyName: "Ada Faculty",
          action: "submit",
          preferences: [{ assignment_group_id: "DRAFT-S1", discipline_code: "MATH", preference_rank: 1 }],
        },
      });
      assert.equal(submitted.status, 200);
      assert.ok(submitted.body.submittedAt);

      await api("/api/preferences", {
        method: "POST",
        role: "faculty",
        division: "Science",
        employeeId: "DRAFT-F1",
        body: {
          termCode: "DRAFT",
          facultyId: "DRAFT-F1",
          employeeId: "DRAFT-F1",
          facultyName: "Ada Faculty",
          action: "draft",
          preferences: [{ assignment_group_id: "DRAFT-S1", discipline_code: "MATH", preference_rank: 1 }],
        },
      });
      const freeze = await api("/api/windows/freeze", {
        method: "POST",
        role: "chair",
        division: "Science",
        body: { termCode: "DRAFT", division: "Science", auditReason: "Freeze submitted versions only." },
      });
      assert.equal(freeze.status, 200);
      const frozen = await pool.query(
        "SELECT status, submitted_at, frozen_at FROM scope_preference_submissions WHERE term_code = 'DRAFT' AND faculty_id = 'DRAFT-F1' ORDER BY version_number"
      );
      assert.equal(frozen.rows.filter((row) => row.status === "frozen").length, 1);
      assert.ok(frozen.rows.find((row) => row.status === "frozen").submitted_at);
      assert.ok(frozen.rows.find((row) => row.status === "frozen").frozen_at);
      assert.ok(frozen.rows.some((row) => row.status === "draft" && row.submitted_at === null));
    });

    for (const [mode, termCode] of [["preferences", "RSTP"], ["staffing", "RSTS"], ["complete", "RSTC"]]) {
      await seedDivisionFixture(termCode, "Science");
      await seedDivisionFixture(`${termCode}O`, "Arts");
      await t.test(`${mode} reset is scoped, audited, and preserves protected data`, async () => {
        const blocked = await Promise.all(["chair", "dean", "faculty"].map((role) => api("/api/admin/division-reset", {
          method: "POST",
          role,
          division: "Science",
          employeeId: `${termCode}-F1`,
          body: { termCode, division: "Science", resetMode: mode, auditReason: "Not allowed.", confirmationText: "Science" },
        })));
        assert.deepEqual(blocked.map((response) => response.status), [403, 403, 403]);

        const reset = await api("/api/admin/division-reset", {
          method: "POST",
          role: "admin",
          body: { termCode, division: "Science", resetMode: mode, auditReason: `Reset ${mode} fixture.`, confirmationText: "Science" },
        });
        assert.equal(reset.status, 200);
        assert.equal(reset.body.division, "Science");
        assert.ok(reset.body.affected.scope_preferences >= 1);
        assert.equal(await count(termCode, "scope_sections"), 1);
        assert.equal(await count(`${termCode}O`, "scope_preferences"), 1);
        assert.equal(await count(`${termCode}O`, "scope_assignments"), 1);

        const targetPreferences = await pool.query("SELECT COUNT(*)::int AS count FROM scope_preferences WHERE term_code = $1", [termCode]);
        const targetWindows = await pool.query("SELECT COUNT(*)::int AS count FROM scope_staffing_windows WHERE term = $1", [termCode]);
        assert.equal(targetPreferences.rows[0].count, 0);
        assert.equal(targetWindows.rows[0].count, 0);

        const targetAssignments = await count(termCode, "scope_assignments");
        const targetDecisions = await count(termCode, "scope_chair_decisions");
        if (mode === "preferences") {
          assert.equal(targetAssignments, 1);
          assert.equal(targetDecisions, 1);
        } else {
          assert.equal(targetAssignments, 0);
          assert.equal(targetDecisions, 0);
        }

        const audit = await pool.query(
          "SELECT event_type, actor_role, reason_code, new_value, explanation FROM scope_audit_log WHERE term = $1 AND event_type = 'DIVISION_RESET' ORDER BY id DESC LIMIT 1",
          [termCode]
        );
        assert.equal(audit.rowCount, 1);
        assert.equal(audit.rows[0].actor_role, "admin");
        assert.equal(audit.rows[0].reason_code, mode.toUpperCase());
        assert.match(audit.rows[0].new_value, /scope_preferences/);
        assert.match(audit.rows[0].explanation, /fixture/);
      });
    }

    await seedDivisionFixture("FAIL", "Science");
    await t.test("reset rollback leaves rows unchanged when a step fails", async () => {
      const before = {
        preferences: await count("FAIL", "scope_preferences"),
        assignments: await count("FAIL", "scope_assignments"),
        decisions: await count("FAIL", "scope_chair_decisions"),
      };
      const failed = await api("/api/admin/division-reset", {
        method: "POST",
        role: "admin",
        body: {
          termCode: "FAIL",
          division: "Science",
          resetMode: "complete",
          auditReason: "Rollback fixture.",
          confirmationText: "Science",
          injectFailure: "after_delete",
        },
      });
      assert.equal(failed.status, 500);
      assert.deepEqual({
        preferences: await count("FAIL", "scope_preferences"),
        assignments: await count("FAIL", "scope_assignments"),
        decisions: await count("FAIL", "scope_chair_decisions"),
      }, before);
      const audit = await pool.query("SELECT COUNT(*)::int AS count FROM scope_audit_log WHERE term = 'FAIL' AND event_type = 'DIVISION_RESET'");
      assert.equal(audit.rows[0].count, 0);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
    await adminPool.end();
    process.env.NODE_ENV = previousNodeEnv;
  }
});
