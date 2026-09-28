import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { runMigrations } from "../migrations.js";
import { startHttpServer } from "../test-support/httpServer.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("authorization holds across preference, assignment, and invitation routes", { timeout: 120_000 }, async (t) => {
  const schema = `authorization_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = scoped.toString();
  process.env.EMAIL_PROVIDER = "console";
  process.env.RATE_LIMIT_STORE = "memory";
  const [{ pool }, { hashToken, issueSession }] = await Promise.all([
    import("../db.js"), import("../auth.js"),
  ]);
  await runMigrations({ pool, logger: { info() {} } });
  const server = await startHttpServer();
  const { url } = server;
  const sessions = new Map();
  async function sessionFor(role, division, employee) {
    const key = JSON.stringify([role, division, employee]);
    if (!sessions.has(key)) {
      const user = (await pool.query(`INSERT INTO scope_users(email,full_name,role,division,employee_id,active_status)
        VALUES ($1,'Same Name',$2,$3,$4,'active') RETURNING id`,
      [`actor-${sessions.size}@example.invalid`, role, division, employee])).rows[0];
      sessions.set(key, (await issueSession(user.id)).token);
    }
    return sessions.get(key);
  }
  async function api(path, { method = "GET", role = "chair", division = "Science", employee = "", body } = {}) {
    const token = await sessionFor(role, division, employee);
    const response = await fetch(url + path, { method, headers: {
      "content-type": "application/json", authorization: `Bearer ${token}`,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, body: data };
  }
  const explanation = "Course continuity requires this documented faculty selection.";
  try {
    await pool.query("INSERT INTO scope_terms(term_code, term_name) VALUES ('T','Test')");
    for (const [id, division, rank] of [["F1", "Science", "1"], ["F2", "Science", "2"], ["A1", "Arts", "1"]]) {
      await pool.query(`INSERT INTO scope_pt_faculty(employee_id, first_name, last_name, email, division, discipline, seniority_rank, qualified_disciplines)
        VALUES ($1,'Same','Name','same@example.invalid',$2,'MATH',$3,'MATH')`, [id, division, rank]);
    }
    for (const division of ["Science", "Arts"]) {
      await pool.query("INSERT INTO scope_staffing_windows(term,division,status) VALUES ('T',$1,'open')", [division]);
    }
    for (const [id, division] of [["S1", "Science"], ["S2", "Science"], ["A-S1", "Arts"]]) {
      await pool.query(`INSERT INTO scope_sections(term_code,assignment_group_id,division,discipline_code,subject_code,raw_row)
        VALUES ('T',$1,$2,'MATH','MATH','{"staff_eligible":true}')`, [id, division]);
    }
    for (const [id, division, groups] of [["F1", "Science", ["S1", "S2"]], ["F2", "Science", ["S1", "S2"]], ["A1", "Arts", ["A-S1"]]]) {
      const result = await api("/preferences", { method: "POST", role: "faculty", division, employee: id,
        body: { termCode: "T", facultyId: id, preferences: groups.map((assignment_group_id, i) => ({ assignment_group_id, preference_rank: i + 1, discipline_code: "MATH" })) } });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }
    await t.test("foreign preference reads, writes and empty export intersections are denied", async () => {
      const before = (await pool.query("SELECT * FROM scope_preferences ORDER BY id")).rows;
      for (const role of ["chair", "dean"]) {
        assert.equal((await api("/preferences?termCode=T&facultyId=A1", { role })).status, 403);
        assert.equal((await api("/preferences", { method: "POST", role, body: { termCode: "T", facultyId: "A1", preferences: [] } })).status, 403);
        assert.equal((await api("/preferences/export?termCode=T&divisions=Arts", { role })).status, 403);
        for (const divisions of ["", "Science", "Science|Arts"]) {
          const allowed = await api(`/preferences/export?termCode=T&divisions=${encodeURIComponent(divisions)}`, { role });
          assert.equal(allowed.status, 200);
          assert.ok(allowed.body.includes("S1"));
          assert.ok(!allowed.body.includes("A-S1"));
        }
        assert.equal((await api("/preferences?termCode=T&facultyId=F1", { role })).status, 200);
        assert.equal((await api("/preferences/export?termCode=T", { role, division: "" })).status, 403);
        assert.equal((await api("/preferences?termCode=T&facultyId=F1", { role, division: "" })).status, 403);
      }
      const adminExport = await api("/preferences/export?termCode=T", { role: "admin" });
      assert.equal(adminExport.status, 200);
      assert.ok(adminExport.body.includes("A-S1"));
      assert.deepEqual((await pool.query("SELECT * FROM scope_preferences ORDER BY id")).rows, before);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_preferences WHERE employee_id='A1'")).rows[0].count, 1);
    });
    await t.test("closed-window corrections cannot target another division", async () => {
      await pool.query("UPDATE scope_staffing_windows SET status='closed' WHERE division='Arts'");
      const before = (await pool.query("SELECT * FROM scope_preferences WHERE employee_id='A1'")).rows;
      for (const role of ["chair", "dean"]) {
        const response = await api("/preferences", { method: "POST", role, body: {
          termCode: "T", facultyId: "A1", action: "admin_correct", auditReason: "Synthetic cross-division correction attempt.", preferences: [],
        } });
        assert.equal(response.status, 403);
      }
      assert.deepEqual((await pool.query("SELECT * FROM scope_preferences WHERE employee_id='A1'")).rows, before);
      await pool.query("UPDATE scope_staffing_windows SET status='open' WHERE division='Arts'");
    });
    await t.test("a matching name or email cannot authorize a different roster identity", async () => {
      const result = await api("/faculty-self-dashboard?termCode=T", { role: "faculty", employee: "UNKNOWN" });
      assert.equal(result.status, 409);
      assert.deepEqual((await api("/pt-faculty", { role: "faculty", employee: "UNKNOWN" })).body, []);
      const blocked = await api("/preferences", { method: "POST", role: "faculty", employee: "UNKNOWN", body: { termCode: "T", facultyId: "F1", preferences: [] } });
      assert.equal(blocked.status, 409);
      const own = await api("/pt-faculty", { role: "faculty", employee: "F1" });
      assert.equal(own.body.length, 1);
      assert.equal(own.body[0].employee_id, "F1");
      assert.equal((await api("/faculty-self-dashboard?termCode=T", { role: "faculty", employee: "A1" })).status, 409);
    });
    await t.test("faculty-supplied identifiers cannot impersonate another roster owner", async () => {
      const before = (await pool.query("SELECT * FROM scope_preferences WHERE employee_id='A1'")).rows;
      const read = await api("/preferences?termCode=T&facultyId=A1", { role: "faculty", employee: "F1" });
      assert.equal(read.status, 200);
      assert.ok(read.body.preferences.length > 0);
      assert.ok(read.body.preferences.every(row => row.employee_id === "F1"));
      const write = await api("/preferences", { method: "POST", role: "faculty", employee: "F1", body: {
        termCode: "T", facultyId: "A1", employeeId: "A1",
        preferences: ["S1", "S2"].map((assignment_group_id, index) => ({ assignment_group_id, preference_rank: index + 1, discipline_code: "MATH" })),
      } });
      assert.equal(write.status, 200, JSON.stringify(write.body));
      assert.deepEqual((await pool.query("SELECT * FROM scope_preferences WHERE employee_id='A1'")).rows, before);
    });
    await t.test("faculty dashboard and preference selections stay in the linked division", async () => {
      await pool.query(`INSERT INTO scope_pt_faculty(employee_id,first_name,last_name,division,discipline)
        VALUES ('F1','Same','Name','Arts','MATH')`);
      try {
        const dashboard = await api("/faculty-self-dashboard?termCode=T", { role: "faculty", employee: "F1" });
        assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
        assert.ok(dashboard.body.rosterRows.length > 0);
        assert.ok(dashboard.body.rosterRows.every(row => row.division === "Science"));
        assert.ok(dashboard.body.sections.every(row => row.division === "Science"));
        const blocked = await api("/preferences", { method: "POST", role: "faculty", employee: "F1",
          body: { termCode: "T", facultyId: "F1", preferences: [{ assignment_group_id: "A-S1", preference_rank: 1 }] } });
        assert.equal(blocked.status, 400);
        assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_preferences WHERE employee_id='F1'")).rows[0].count, 2);
      } finally {
        await pool.query("DELETE FROM scope_pt_faculty WHERE employee_id='F1' AND division='Arts'");
      }
    });
    let saved;
    await t.test("legacy assignment creation and reassignment enforce decision rules", async () => {
      saved = await api("/assignments", { method: "POST", body: { termCode: "T", assignmentGroupId: "S1", employeeId: "F1" } });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const path = `/assignments/${saved.body.id}/reassign`;
      assert.equal((await api(path, { method: "PUT", body: { employeeId: "F2", reason: explanation } })).status, 409);
      assert.equal((await api(path, { method: "PUT", body: { employeeId: "F2", expectedVersion: saved.body.version, reason: explanation } })).status, 400);
      const unchanged = await pool.query("SELECT employee_id,status FROM scope_assignments WHERE id=$1", [saved.body.id]);
      assert.deepEqual(unchanged.rows[0], { employee_id: "F1", status: "tentative" });
      const replacement = await api(path, { method: "PUT", body: { employeeId: "F2", expectedVersion: saved.body.version, exceptionReasonCode: "COURSE_CONTINUITY", exceptionExplanation: explanation } });
      assert.equal(replacement.status, 200, JSON.stringify(replacement.body));
      const history = await pool.query("SELECT status,decision_snapshot FROM scope_assignments WHERE id=$1", [saved.body.id]);
      assert.equal(history.rows[0].status, "released");
      assert.equal(history.rows[0].decision_snapshot.selectedEmployeeId, "F1");
      assert.equal(replacement.body.decision.decision_snapshot.selectedEmployeeId, "F2");
      saved = replacement;
      assert.equal((await api("/assignments", { method: "POST", role: "dean", body: { termCode: "T", assignmentGroupId: "S2", employeeId: "F1" } })).status, 403);
    });
    await t.test("bulk status scope cannot be widened and approved assignments cannot change", async () => {
      await pool.query("INSERT INTO scope_assignments(term_code,assignment_group_id,employee_id,status) VALUES ('T','A-S1','A1','tentative')");
      const before = (await pool.query("SELECT * FROM scope_assignments ORDER BY id")).rows;
      for (const [route, role] of [["submit", "chair"], ["approve", "dean"], ["return", "dean"]]) {
        for (const [scope, status] of [[{}, 400], [{ divisions: ["Arts"] }, 403], [{ divisions: ["Science", "Arts"] }, 403]]) {
          const result = await api(`/assignments/${route}`, { method: "POST", role,
            body: { termCode: "T", reason: "Synthetic review reason.", ...scope } });
          assert.equal(result.status, status, JSON.stringify(result.body));
        }
      }
      assert.deepEqual((await pool.query("SELECT * FROM scope_assignments ORDER BY id")).rows, before);
      assert.equal((await api("/assignments/submit", { method: "POST", body: { termCode: "T", division: "Science" } })).body.submittedCount, 1);
      for (const version of [undefined, saved.body.version + 1]) {
        const result = await api(`/assignments/${saved.body.id}/reassign`, { method: "PUT",
          body: { employeeId: "F1", expectedVersion: version, exceptionReasonCode: "COURSE_CONTINUITY", exceptionExplanation: explanation } });
        assert.equal(result.status, 409);
      }
      assert.equal((await api("/assignments/approve", { method: "POST", role: "dean", body: { termCode: "T", division: "Science" } })).body.approvedCount, 1);
      assert.equal((await pool.query("SELECT status FROM scope_assignments WHERE assignment_group_id='A-S1'")).rows[0].status, "tentative");
      const approved = (await pool.query("SELECT * FROM scope_assignments ORDER BY id")).rows;
      const auditCount = (await pool.query("SELECT COUNT(*)::int AS count FROM scope_audit_log")).rows[0].count;
      const body = { employeeId: "F1", expectedVersion: saved.body.version + 2, exceptionReasonCode: "COURSE_CONTINUITY", exceptionExplanation: explanation };
      assert.equal((await api(`/assignments/${saved.body.id}/reassign`, { method: "PUT", body })).status, 409);
      assert.equal((await api(`/assignments/${saved.body.id}?expectedVersion=${body.expectedVersion}`, { method: "DELETE" })).status, 409);
      assert.equal((await api("/assignments", { method: "POST", body: { ...body, termCode: "T", assignmentGroupId: "S1" } })).status, 409);
      assert.equal((await api("/chair-decisions", { method: "POST", body: { termCode: "T", assignmentGroupId: "S1", selectedEmployeeId: "F1" } })).status, 409);
      assert.deepEqual((await pool.query("SELECT * FROM scope_assignments ORDER BY id")).rows, approved);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_audit_log")).rows[0].count, auditCount);
    });
    async function invitedUser(email, role = "faculty") {
      const user = (await pool.query("INSERT INTO scope_users(email,role,division,employee_id,active_status) VALUES ($1,$2,'Science','F1','invited') RETURNING *", [email, role])).rows[0];
      const token = `test-${user.id}`;
      await pool.query(`INSERT INTO scope_user_invites(user_id,email,role,division,employee_id,invite_token_hash,expires_at)
        VALUES ($1,$2,$3,'Science','F1',$4,NOW()+INTERVAL '1 day')`, [user.id, email, role, hashToken(token)]);
      return { user, token };
    }
    const accept = token => api("/auth/accept-invite", { method: "POST", body: { token, password: "Synthetic test password 123" } });
    await t.test("expired and consumed invitations cannot activate an account", async () => {
      for (const state of ["expired", "consumed"]) {
        const { user, token } = await invitedUser(`${state}@example.invalid`);
        if (state === "expired") await pool.query("UPDATE scope_user_invites SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", [user.id]);
        else await pool.query("UPDATE scope_user_invites SET accepted_at=NOW() WHERE user_id=$1", [user.id]);
        const before = (await pool.query("SELECT * FROM scope_users WHERE id=$1", [user.id])).rows;
        assert.equal((await accept(token)).status, 400);
        assert.deepEqual((await pool.query("SELECT * FROM scope_users WHERE id=$1", [user.id])).rows, before);
        assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_user_sessions WHERE user_id=$1", [user.id])).rows[0].count, 0);
      }
    });
    await t.test("disable or privilege changes invalidate outstanding invitations", async () => {
      for (const patch of [{ active_status: "disabled" }, { role: "faculty" }, { division: "Arts" }, { employee_id: "F2" }]) {
        const { user, token } = await invitedUser(`change-${Object.keys(patch)[0]}@example.invalid`, "chair");
        assert.equal((await api(`/auth/users/${user.id}`, { method: "PATCH", role: "admin", body: patch })).status, 200);
        assert.equal((await accept(token)).status, 400);
      }
      const disabled = await invitedUser("disabled@example.invalid");
      await pool.query("UPDATE scope_users SET active_status='disabled' WHERE id=$1", [disabled.user.id]);
      assert.equal((await accept(disabled.token)).status, 400);
      const stale = await invitedUser("stale@example.invalid", "chair");
      await pool.query("UPDATE scope_users SET role='faculty' WHERE id=$1", [stale.user.id]);
      assert.equal((await accept(stale.token)).status, 400);
    });
    await t.test("valid invitations work once, including concurrent requests", async () => {
      const { token, user } = await invitedUser("valid@example.invalid");
      const results = await Promise.all([accept(token), accept(token)]);
      assert.deepEqual(results.map(x => x.status).sort(), [200, 400]);
      assert.equal(results.find(x => x.status === 200).body.user.role, "faculty");
      assert.equal((await accept(token)).status, 400);
      const sessions = await pool.query("SELECT COUNT(*)::int AS count FROM scope_user_sessions WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
      assert.equal(sessions.rows[0].count, 1);
      const winner = results.find(x => x.status === 200).body.session.token;
      assert.equal((await fetch(`${url}/auth/me`, { headers: { authorization: `Bearer ${winner}` } })).status, 200);
    });
  } finally {
    await server.close();
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  }
});
