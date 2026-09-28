import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { loadMigrations, runMigrations, getMigrationStatus } from "../migrations.js";
import { buildDataIntegrityReport } from "../dataIntegrity.js";

const integrationTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const logger = { info() {} };

async function fixture(run) {
  const schema = `directory_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "directory-migrations-"));
  const migrations = await loadMigrations();
  async function through(number) {
    for (const migration of migrations.filter(item => Number(item.identifier) <= number)) {
      await fs.writeFile(path.join(directory, migration.filename), migration.sql);
    }
    return runMigrations({ pool, migrationsDir: directory, logger });
  }
  try { await run(pool, through); } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

integrationTest("blocked 0010 resumes with chair/dean email identity and preserves every record", async () => {
  await fixture(async (pool, through) => {
    await through(1);
    for (let index = 0; index < 36; index++) {
      await pool.query(`INSERT INTO scope_roles(employee_id,email,role,division,active_status)
        VALUES ('',$1,$2,'Science',$3)`, [`test-${index}@example.invalid`, index < 18 ? "chair" : "dean", index % 2 ? "inactive" : "active"]);
    }
    await through(9);
    await assert.rejects(through(10), /scope_roles_identity_valid/);
    const before = (await pool.query("SELECT * FROM scope_roles ORDER BY id")).rows;
    const result = await runMigrations({ pool, logger });
    assert.deepEqual(result.applied, ["0011", "0010"]);
    assert.deepEqual((await pool.query("SELECT * FROM scope_roles ORDER BY id")).rows, before);
    assert.ok((await getMigrationStatus({ pool })).every(row => row.status === "applied"));
    const report = await buildDataIntegrityReport(pool.query.bind(pool));
    assert.ok(report.every(row => row.violationCount === 0));
    assert.deepEqual((await runMigrations({ pool, logger })).applied, []);
    for (const [role, employee, email, division] of [
      ["faculty", "", "faculty@example.invalid", "Science"],
      ["admin", "", "admin@example.invalid", "Science"],
      ["chair", "", "", "Science"], ["dean", "", "not-an-email", "Science"],
      ["chair", "", "chair@example.invalid", ""], ["Chair", "E1", "chair@example.invalid", "Science"],
    ]) await assert.rejects(pool.query(`INSERT INTO scope_roles(role,employee_id,email,division) VALUES ($1,$2,$3,$4)`,
      [role, employee, email, division]), error => error.code === "23514");
    await assert.rejects(pool.query("INSERT INTO scope_pt_faculty(employee_id,division) VALUES ('','Science')"), error => error.code === "23514");
    await assert.rejects(pool.query("INSERT INTO scope_users(email,role) VALUES ('bad@example.invalid','Chair')"), error => error.code === "23514");
  });
});

integrationTest("compatibility migration also upgrades a database already through 0010", async () => {
  await fixture(async (pool, through) => {
    await through(10);
    assert.deepEqual((await runMigrations({ pool, logger })).applied, ["0011"]);
    await pool.query("INSERT INTO scope_roles(role,email,division) VALUES ('dean','dean@example.invalid','Arts')");
    const constraint = await pool.query("SELECT convalidated FROM pg_constraint WHERE conrelid='scope_roles'::regclass AND conname='scope_roles_identity_valid'");
    assert.equal(constraint.rows[0].convalidated, true);
  });
});

integrationTest("invalid legacy contacts still block and roll back the replacement constraint", async () => {
  await fixture(async (pool, through) => {
    await through(1);
    await pool.query("INSERT INTO scope_roles(role,division) VALUES ('chair','Science')");
    await through(9);
    const before = (await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='scope_roles'::regclass AND conname='scope_roles_identity_valid'")).rows;
    await assert.rejects(runMigrations({ pool, logger }), /0011.*scope_roles_identity_valid/);
    assert.deepEqual((await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='scope_roles'::regclass AND conname='scope_roles_identity_valid'")).rows, before);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM scope_schema_migrations WHERE migration_identifier IN ('0010','0011')")).rows[0].count, 0);
    const report = await buildDataIntegrityReport(pool.query.bind(pool));
    assert.equal(report.find(row => row.code === "roles.identity_or_role").violationCount, 1);
  });
});
