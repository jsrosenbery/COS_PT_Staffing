import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runMigrations } from "../migrations.js";

const integrationTest = process.env.TEST_DATABASE_URL ? test : test.skip;
integrationTest("admin continuity and notice recovery hold at the HTTP boundary", { timeout: 120_000 }, async t => {
  const schema = `recovery_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(process.env.TEST_DATABASE_URL);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = scoped.toString();
  process.env.API_TOKEN_AUTH_ENABLED = "true";
  process.env.API_TOKEN = "synthetic-bootstrap-only-for-isolated-tests";
  process.env.RATE_LIMIT_STORE = "memory";
  const [{ default: express }, { pool }, { default: authRoutes }, { createDisseminationRouter }, { authenticateRequest, issueSession }] = await Promise.all([
    import("express"), import("../db.js"), import("../routes/auth.js"), import("../routes/dissemination.js"), import("../auth.js"),
  ]);
  await runMigrations({ pool, logger: { info() {} } });
  let behavior = async () => ({ accepted: false, delivered: false });
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => { req.auth = await authenticateRequest(req); return req.auth ? next() : res.status(401).json({ error: "Unauthorized" }); });
  app.use("/api/auth", authRoutes);
  app.use("/api", createDisseminationRouter({ send: async payload => { calls.push(payload); return behavior(payload); } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function api(path, { method = "GET", token = process.env.API_TOKEN, body } = {}) {
    const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function account(role, name, division = "Science") {
    const user = (await pool.query("INSERT INTO scope_users(email,role,division,active_status) VALUES ($1,$2,$3,'active') RETURNING *", [`${name}@example.invalid`, role, division])).rows[0];
    return { ...user, token: (await issueSession(user.id)).token };
  }
  try {
    await t.test("the last admin cannot be demoted, disabled, invited or deleted", async () => {
      const admin = await account("admin", "sole-admin");
      const before = (await pool.query("SELECT * FROM scope_users WHERE id=$1", [admin.id])).rows;
      for (const patch of [{ role: "faculty" }, { active_status: "disabled" }, { active_status: "invited" }]) {
        const result = await api(`/auth/users/${admin.id}`, { method: "PATCH", token: admin.token, body: patch });
        assert.equal(result.status, 409);
        assert.equal(result.body.code, "LAST_ACTIVE_ADMIN");
      }
      assert.equal((await api(`/auth/users/${admin.id}`, { method: "DELETE" })).status, 409);
      assert.deepEqual((await pool.query("SELECT * FROM scope_users WHERE id=$1", [admin.id])).rows, before);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_audit_log")).rows[0].count, 0);
      assert.equal((await api(`/auth/users/${admin.id}`, { method: "PATCH", token: admin.token, body: { full_name: "Renamed Admin" } })).status, 200);
    });
    await t.test("concurrent admin removal operations leave one active administrator", async () => {
      for (const mode of ["demote", "delete"]) {
        await pool.query("DELETE FROM scope_users");
        const first = await account("admin", `first-${mode}`);
        const second = await account("admin", `second-${mode}`);
        const results = await Promise.all([first, second].map(user => api(`/auth/users/${user.id}`, mode === "delete" ? { method: "DELETE" } : { method: "PATCH", body: { role: "faculty" } })));
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_users WHERE role='admin' AND active_status='active'")).rows[0].count, 1);
      }
    });
    const chair = await account("chair", "science-chair");
    const foreign = await account("chair", "arts-chair", "Arts");
    const faculty = await account("faculty", "faculty");
    await pool.query("INSERT INTO scope_pt_faculty(employee_id,email,division) VALUES ('F1','faculty@example.invalid','Science')");
    const payload = { termCode: "T", division: "Science", senderEmail: "chair@example.invalid", subject: "Original notice", body: "Original closing information", closesAt: "2099-01-01" };
    let deliveryId;
    let originalWindow;
    await t.test("console non-delivery is failed and scoped status exposes recovery", async () => {
      const response = await api("/dissemination/send", { method: "POST", token: chair.token, body: payload });
      assert.equal(response.status, 502, JSON.stringify(response.body));
      assert.equal(response.body.emailStatus, "failed");
      deliveryId = response.body.deliveryId;
      originalWindow = (await pool.query("SELECT * FROM scope_staffing_windows")).rows;
      assert.equal((await api("/dissemination/status?termCode=T&division=Science", { token: foreign.token })).status, 403);
      assert.equal((await api(`/dissemination/${deliveryId}/retry`, { method: "POST", token: foreign.token })).status, 403);
      assert.equal((await api(`/dissemination/${deliveryId}/retry`, { method: "POST", token: faculty.token })).status, 403);
      assert.equal((await api("/dissemination/send", { method: "POST", token: chair.token, body: payload })).status, 409);
    });
    await t.test("retry preserves notice/window and concurrent or repeated retries do not resend", async () => {
      let release;
      let started;
      const began = new Promise(resolve => { started = resolve; });
      behavior = () => { started(); return new Promise(resolve => { release = () => resolve({ accepted: true, messageId: "test-receipt" }); }); };
      const retry = api(`/dissemination/${deliveryId}/retry`, { method: "POST", token: chair.token, body: { subject: "Tampered", body: "Tampered" } });
      await began;
      try {
        assert.equal((await api(`/dissemination/${deliveryId}/retry`, { method: "POST", token: chair.token })).status, 409);
      } finally { release(); }
      assert.equal((await retry).status, 200);
      assert.equal((await api(`/dissemination/${deliveryId}/retry`, { method: "POST", token: chair.token })).body.alreadyAccepted, true);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], calls[0]);
      assert.deepEqual((await pool.query("SELECT * FROM scope_staffing_windows")).rows, originalWindow);
      const stored = (await pool.query("SELECT status,attempt_count,provider_message_id FROM scope_email_deliveries WHERE id=$1", [deliveryId])).rows[0];
      assert.deepEqual(stored, { status: "sent", attempt_count: 2, provider_message_id: "test-receipt" });
    });
    await t.test("uncertain provider outcome stays pending and cannot duplicate a send", async () => {
      behavior = async () => { throw new Error("Network response lost"); };
      const response = await api("/dissemination/send", { method: "POST", token: chair.token, body: { ...payload, termCode: "T2" } });
      assert.equal(response.status, 502);
      assert.equal(response.body.emailStatus, "pending");
      const count = calls.length;
      assert.equal((await api(`/dissemination/${response.body.deliveryId}/retry`, { method: "POST", token: chair.token })).status, 409);
      assert.equal(calls.length, count);
    });
    await t.test("explicit rejection can retry but expired windows cannot", async () => {
      behavior = async () => { throw Object.assign(new Error("Provider rejected"), { deliveryRejected: true }); };
      const response = await api("/dissemination/send", { method: "POST", token: chair.token, body: { ...payload, termCode: "REJECTED" } });
      assert.equal(response.status, 502);
      assert.equal(response.body.emailStatus, "failed");
      await pool.query("UPDATE scope_staffing_windows SET closes_at='2000-01-01' WHERE id=$1", [response.body.window.id]);
      const count = calls.length;
      assert.equal((await api(`/dissemination/${response.body.deliveryId}/retry`, { method: "POST", token: chair.token })).status, 409);
      assert.equal(calls.length, count);
    });
    await t.test("acceptance recording failure stays pending without resending", async () => {
      await pool.query(`CREATE FUNCTION reject_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.status='sent' THEN RAISE EXCEPTION 'synthetic recording failure'; END IF; RETURN NEW; END $$`);
      await pool.query("CREATE TRIGGER reject_acceptance BEFORE UPDATE ON scope_email_deliveries FOR EACH ROW EXECUTE FUNCTION reject_acceptance()");
      behavior = async () => ({ accepted: true });
      try {
        const response = await api("/dissemination/send", { method: "POST", token: chair.token, body: { ...payload, termCode: "RECORDING" } });
        assert.equal(response.status, 500);
        const status = await api("/dissemination/status?termCode=RECORDING&division=Science", { token: chair.token });
        assert.equal(status.body.delivery.status, "pending");
        const count = calls.length;
        assert.equal((await api(`/dissemination/${status.body.delivery.id}/retry`, { method: "POST", token: chair.token })).status, 409);
        assert.equal(calls.length, count);
      } finally { await pool.query("DROP TRIGGER reject_acceptance ON scope_email_deliveries"); }
    });
    await t.test("legacy failed notice requires reviewed content and retains its deadline", async () => {
      const window = (await pool.query("INSERT INTO scope_staffing_windows(term,division,status,closes_at) VALUES ('OLD','Science','open','2099-01-01') RETURNING *")).rows[0];
      const delivery = (await pool.query("INSERT INTO scope_email_deliveries(staffing_window_id,recipient_count,subject,status) VALUES ($1,1,'Old subject','failed') RETURNING id", [window.id])).rows[0];
      assert.equal((await api(`/dissemination/${delivery.id}/retry`, { method: "POST", token: chair.token })).status, 409);
      behavior = async () => ({ accepted: true });
      assert.equal((await api(`/dissemination/${delivery.id}/retry`, { method: "POST", token: chair.token, body: { legacyBody: "Reviewed original text" } })).status, 200);
      assert.equal(calls.at(-1).body, "Reviewed original text");
      assert.deepEqual((await pool.query("SELECT * FROM scope_staffing_windows WHERE id=$1", [window.id])).rows[0], window);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  }
});
