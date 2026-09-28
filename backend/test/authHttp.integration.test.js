import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { runMigrations } from "../migrations.js";
import { startHttpServer } from "../test-support/httpServer.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("HTTP authentication and token consumption enforce persisted account state", { timeout: 120_000 }, async (t) => {
  const schema = `auth_http_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new pg.Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(databaseUrl);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  scoped.searchParams.set("application_name", schema);
  process.env.DATABASE_URL = scoped.toString();
  const [{ pool }, { hashPassword, hashToken, issueSession, verifyPassword }] = await Promise.all([
    import("../db.js"), import("../auth.js"),
  ]);
  let server;
  const originalPassword = "Original synthetic password 123";
  let userNumber = 0;
  let tokenNumber = 0;
  try {
    await runMigrations({ pool, logger: { info() {} } });
    server = await startHttpServer();
    const passwordRecord = await hashPassword(originalPassword);
    async function account(status = "active", role = "faculty") {
      return (await pool.query(`INSERT INTO scope_users
        (email,full_name,employee_id,role,division,active_status,password_hash,password_salt)
        VALUES ($1,'Synthetic Account','F1',$2,'Science',$3,$4,$5) RETURNING *`,
      [`user-${++userNumber}@example.invalid`, role, status, passwordRecord.hash, passwordRecord.salt])).rows[0];
    }
    async function resetToken(user, state = "valid") {
      const token = `synthetic-reset-${++tokenNumber}`;
      await pool.query(`INSERT INTO scope_password_resets(user_id,reset_token_hash,expires_at,used_at)
        VALUES ($1,$2,NOW() + $3::interval,$4)`,
      [user.id, hashToken(token), state === "expired" ? "-1 hour" : "1 hour", state === "used" ? new Date() : null]);
      return token;
    }
    async function api(path, { method = "GET", body, token = "", headers = {} } = {}) {
      const response = await fetch(server.url + path, { method, headers: {
        "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    const complete = (token, password = "Replacement synthetic password 123") => api("/auth/password-reset/complete", {
      method: "POST", body: { token, password },
    });
    const me = token => api("/auth/me", { token });
    const currentAccount = async user => (await pool.query("SELECT * FROM scope_users WHERE id=$1", [user.id])).rows[0];
    async function assertPassword(user, password) {
      const current = await currentAccount(user);
      assert.equal(await verifyPassword(password, current.password_salt, current.password_hash), true);
    }
    // Hold the account row until every request reaches a database lock. This
    // reproduces overlapping requests deterministically, without timing sleeps.
    async function blockedRequests(count) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const result = await adminPool.query(`SELECT COUNT(*)::int AS count FROM pg_stat_activity
          WHERE application_name=$1 AND wait_event_type='Lock'`, [schema]);
        if (result.rows[0].count >= count) return;
        await delay(20);
      }
      assert.fail(`Expected ${count} requests waiting on the account lock`);
    }

    await t.test("real sessions reject missing, invalid, expired, revoked and disabled credentials", async () => {
      assert.equal((await me("")).status, 401);
      assert.equal((await me("invalid-token")).status, 401);
      assert.equal((await api("/auth/users", { headers: { "x-role": "admin", "x-api-token": "invalid" } })).status, 401);
      for (const state of ["active", "expired", "revoked", "disabled"]) {
        const user = await account(state === "disabled" ? "disabled" : "active");
        const session = await issueSession(user.id);
        if (state === "expired") await pool.query("UPDATE scope_user_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", [user.id]);
        if (state === "revoked") await pool.query("UPDATE scope_user_sessions SET revoked_at=NOW() WHERE user_id=$1", [user.id]);
        const response = await me(session.token);
        assert.equal(response.status, state === "active" ? 200 : 401);
        if (state === "active") assert.equal(response.body.user.id, user.id);
        if (state === "disabled") {
          const login = await api("/auth/login", { method: "POST", body: { email: user.email, password: originalPassword } });
          assert.equal(login.status, 401);
        }
      }
      const user = await account();
      const login = await api("/auth/login", { method: "POST", body: { email: user.email, password: originalPassword } });
      assert.equal(login.status, 200);
      assert.equal((await me(login.body.session.token)).status, 200);
    });

    await t.test("admin identity, privilege and status changes revoke existing sessions", async () => {
      const admin = await account("active", "admin");
      const adminSession = await issueSession(admin.id);
      for (const patch of [{ active_status: "disabled" }, { role: "faculty" }, { division: "Arts" }, { employee_id: "F2" }]) {
        const user = await account("active", "chair");
        const session = await issueSession(user.id);
        assert.equal((await me(session.token)).status, 200);
        const changed = await api(`/auth/users/${user.id}`, { method: "PATCH", token: adminSession.token, body: patch });
        assert.equal(changed.status, 200);
        assert.equal((await me(session.token)).status, 401);
      }
    });

    await t.test("invalid reset tokens and disabled users cannot change credentials or create sessions", async () => {
      assert.equal((await complete("unknown-reset-token")).status, 400);
      for (const state of ["expired", "used", "disabled"]) {
        const user = await account(state === "disabled" ? "disabled" : "active");
        const token = await resetToken(user, state);
        const before = await currentAccount(user);
        assert.equal((await complete(token)).status, 400);
        assert.deepEqual(await currentAccount(user), before);
        assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_user_sessions WHERE user_id=$1", [user.id])).rows[0].count, 0);
      }
    });

    for (const distinctTokens of [false, true]) {
      await t.test(`concurrent reset requests have one winner (${distinctTokens ? "two tokens for one account" : "same token"})`, async () => {
        const user = await account();
        const oldSession = await issueSession(user.id);
        const firstToken = await resetToken(user);
        const secondToken = distinctTokens ? await resetToken(user) : firstToken;
        const passwords = ["First competing password 123", "Second competing password 123"];
        const blocker = await pool.connect();
        let pending = [];
        let results;
        try {
          await blocker.query("BEGIN");
          await blocker.query("SELECT id FROM scope_users WHERE id=$1 FOR UPDATE", [user.id]);
          pending = [complete(firstToken, passwords[0]), complete(secondToken, passwords[1])];
          await blockedRequests(2);
          await blocker.query("COMMIT");
          results = await Promise.all(pending);
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await Promise.allSettled(pending);
        }
        assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
        const winningIndex = results.findIndex(result => result.status === 200);
        await assertPassword(user, passwords[winningIndex]);
        assert.equal((await me(oldSession.token)).status, 401);
        assert.equal((await me(results[winningIndex].body.session.token)).status, 200);
        assert.equal((await complete(firstToken)).status, 400);
        const counts = (await pool.query(`SELECT
          (SELECT COUNT(*)::int FROM scope_password_resets WHERE user_id=$1 AND used_at IS NULL) AS unused,
          (SELECT COUNT(*)::int FROM scope_user_sessions WHERE user_id=$1 AND revoked_at IS NULL) AS sessions`, [user.id])).rows[0];
        assert.deepEqual(counts, { unused: 0, sessions: 1 });
      });
    }

    await t.test("reset rechecks account status after a concurrent disable", async () => {
      const user = await account();
      const token = await resetToken(user);
      const blocker = await pool.connect();
      let pending;
      let result;
      try {
        await blocker.query("BEGIN");
        await blocker.query("UPDATE scope_users SET active_status='disabled' WHERE id=$1", [user.id]);
        pending = complete(token);
        await blockedRequests(1);
        await blocker.query("COMMIT");
        result = await pending;
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        if (pending) await pending;
      }
      assert.equal(result.status, 400);
      await assertPassword(user, originalPassword);
      assert.equal((await currentAccount(user)).active_status, "disabled");
    });

    await t.test("session insertion failure rolls back password and token consumption", async () => {
      const user = await account();
      const oldSession = await issueSession(user.id);
      const token = await resetToken(user);
      await pool.query(`CREATE FUNCTION reject_test_session() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.user_id = ${Number(user.id)} THEN RAISE EXCEPTION 'Synthetic session insertion failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER reject_test_session BEFORE INSERT ON scope_user_sessions FOR EACH ROW EXECUTE FUNCTION reject_test_session()`);
      try {
        assert.equal((await complete(token)).status, 500);
        await assertPassword(user, originalPassword);
        assert.equal((await me(oldSession.token)).status, 200);
        assert.equal((await pool.query("SELECT used_at FROM scope_password_resets WHERE reset_token_hash=$1", [hashToken(token)])).rows[0].used_at, null);
      } finally {
        await pool.query("DROP TRIGGER reject_test_session ON scope_user_sessions; DROP FUNCTION reject_test_session()");
      }
      assert.equal((await complete(token)).status, 200);
      assert.equal((await me(oldSession.token)).status, 401);
    });
  } finally {
    if (server) await server.close();
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  }
});
