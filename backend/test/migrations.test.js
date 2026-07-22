import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { runMigrations } from "../migrations.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

function quotedIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function withEmptyDatabase(run) {
  const schema = `migration_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

const silentLogger = { info() {} };

integrationTest("applies the baseline migration to an empty PostgreSQL database", async () => {
  await withEmptyDatabase(async (pool) => {
    const result = await runMigrations({ pool, logger: silentLogger });
    assert.deepEqual(result.applied, ["0001"]);

    const tables = await pool.query(`
      SELECT to_regclass('scope_users') AS users,
             to_regclass('scope_assignments') AS assignments
    `);
    assert.equal(tables.rows[0].users, "scope_users");
    assert.equal(tables.rows[0].assignments, "scope_assignments");

    const history = await pool.query("SELECT * FROM scope_schema_migrations");
    assert.equal(history.rowCount, 1);
    assert.equal(history.rows[0].migration_filename, "0001_baseline.sql");
    assert.ok(history.rows[0].applied_at);
  });
});

integrationTest("skips migrations that were already applied successfully", async () => {
  await withEmptyDatabase(async (pool) => {
    await runMigrations({ pool, logger: silentLogger });
    const secondRun = await runMigrations({ pool, logger: silentLogger });

    assert.deepEqual(secondRun.applied, []);
    assert.deepEqual(secondRun.skipped, ["0001"]);
    const history = await pool.query("SELECT COUNT(*)::int AS count FROM scope_schema_migrations");
    assert.equal(history.rows[0].count, 1);
  });
});

integrationTest("rejects a checksum mismatch for an applied migration", async () => {
  await withEmptyDatabase(async (pool) => {
    await runMigrations({ pool, logger: silentLogger });
    await pool.query("UPDATE scope_schema_migrations SET checksum = $1 WHERE migration_identifier = '0001'", ["0".repeat(64)]);

    await assert.rejects(
      runMigrations({ pool, logger: silentLogger }),
      /checksum mismatch/
    );
  });
});

integrationTest("rolls back a failed migration without recording it", async () => {
  await withEmptyDatabase(async (pool) => {
    const migrationsDir = await fs.mkdtemp(path.join(os.tmpdir(), "scope-migrations-"));
    try {
      await fs.writeFile(path.join(migrationsDir, "0001_valid.sql"), "CREATE TABLE valid_table (id INTEGER PRIMARY KEY);\n");
      await fs.writeFile(
        path.join(migrationsDir, "0002_broken.sql"),
        "CREATE TABLE partial_table (id INTEGER);\nTHIS IS NOT VALID SQL;\n"
      );

      await assert.rejects(
        runMigrations({ pool, migrationsDir, logger: silentLogger }),
        /0002_broken\.sql failed/
      );

      const history = await pool.query("SELECT migration_identifier FROM scope_schema_migrations ORDER BY migration_identifier");
      assert.deepEqual(history.rows.map((row) => row.migration_identifier), ["0001"]);
      const partialTable = await pool.query("SELECT to_regclass('partial_table') AS name");
      assert.equal(partialTable.rows[0].name, null);
    } finally {
      await fs.rm(migrationsDir, { recursive: true, force: true });
    }
  });
});
