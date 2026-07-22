import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import pg from "pg";
import { buildDataIntegrityReport, dataIntegrityChecks } from "../dataIntegrity.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const baselineSql = fs.readFileSync(new URL("../migrations/0001_baseline.sql", import.meta.url), "utf8");
const constraintsSql = fs.readFileSync(new URL("../migrations/0002_security_integrity_constraints.sql", import.meta.url), "utf8");
const schemaSql = `${baselineSql}\n${constraintsSql}`;

function quotedIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withEmptyDatabase(run) {
  const schema = `integrity_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA ${quotedIdentifier(schema)}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  try {
    await run(pool);
  } finally {
    await pool.end();
    await adminPool.query(`DROP SCHEMA ${quotedIdentifier(schema)} CASCADE`);
    await adminPool.end();
  }
}

test("integrity report covers high-value identifier, role, and status invariants", () => {
  const codes = dataIntegrityChecks.map((check) => check.code);
  assert.ok(codes.includes("roles.identity_or_role"));
  assert.ok(codes.includes("preferences.identifiers"));
  assert.ok(codes.includes("assignments.integrity"));
  assert.ok(codes.includes("chair_decisions.integrity"));
});

integrationTest("new databases install unvalidated constraints that enforce new writes", async () => {
  await withEmptyDatabase(async (pool) => {
    await pool.query(schemaSql);
    const constraints = await pool.query(`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname LIKE 'scope\\_%\\_valid' ESCAPE '\\'
      ORDER BY conname
    `);
    assert.equal(constraints.rowCount, dataIntegrityChecks.length);
    assert.ok(constraints.rows.every((row) => row.convalidated === false));

    await assert.rejects(
      pool.query("INSERT INTO scope_assignments (term_code, assignment_group_id, employee_id) VALUES ('SP27', 'AG-1', '')"),
      (error) => error.code === "23514" && error.constraint === "scope_assignments_integrity_valid"
    );

    const report = await buildDataIntegrityReport((sql, params) => pool.query(sql, params));
    assert.ok(report.every((item) => item.violationCount === 0));
  });
});

integrationTest("legacy violations are reported and preserved when constraints are adopted", async () => {
  await withEmptyDatabase(async (pool) => {
    await pool.query(schemaSql);
    await pool.query("ALTER TABLE scope_assignments DROP CONSTRAINT scope_assignments_integrity_valid");
    await pool.query("INSERT INTO scope_assignments (term_code, assignment_group_id, employee_id) VALUES ('', '', '')");

    await pool.query(schemaSql);

    const existing = await pool.query("SELECT COUNT(*)::int AS count FROM scope_assignments WHERE BTRIM(term_code) = ''");
    assert.equal(existing.rows[0].count, 1);
    const report = await buildDataIntegrityReport((sql, params) => pool.query(sql, params));
    assert.equal(report.find((item) => item.code === "assignments.integrity")?.violationCount, 1);

    await assert.rejects(
      pool.query("INSERT INTO scope_assignments (term_code, assignment_group_id, employee_id) VALUES ('', '', '')"),
      (error) => error.code === "23514" && error.constraint === "scope_assignments_integrity_valid"
    );
  });
});
