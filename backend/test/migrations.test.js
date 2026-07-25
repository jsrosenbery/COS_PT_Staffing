import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { runMigrations } from "../migrations.js";
import { PostgresRateLimitStore } from "../rateLimit.js";

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

test("staffing-window compatibility migration adds the missing timestamp without destructive changes", async () => {
  const migration = await fs.readFile(
    new URL("../migrations/0004_staffing_windows_updated_at.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /ALTER TABLE scope_staffing_windows/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i);
});

test("audit-value compatibility migration normalizes legacy json columns to text", async () => {
  const migration = await fs.readFile(
    new URL("../migrations/0005_audit_values_as_text.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /ALTER TABLE scope_audit_log/i);
  assert.match(migration, /ALTER COLUMN old_value TYPE TEXT USING old_value::text/i);
  assert.match(migration, /ALTER COLUMN new_value TYPE TEXT USING new_value::text/i);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i);
});

integrationTest("applies all ordered migrations to an empty PostgreSQL database", async () => {
  await withEmptyDatabase(async (pool) => {
    const result = await runMigrations({ pool, logger: silentLogger });
    assert.deepEqual(result.applied, ["0001", "0002", "0003", "0004", "0005"]);

    const tables = await pool.query(`
      SELECT to_regclass('scope_users') AS users,
             to_regclass('scope_assignments') AS assignments,
             to_regclass('scope_rate_limits') AS rate_limits
    `);
    assert.equal(tables.rows[0].users, "scope_users");
    assert.equal(tables.rows[0].assignments, "scope_assignments");
    assert.equal(tables.rows[0].rate_limits, "scope_rate_limits");

    const windowColumns = await pool.query(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'scope_staffing_windows'
        AND column_name = 'updated_at'
    `);
    assert.equal(windowColumns.rowCount, 1);
    assert.equal(windowColumns.rows[0].is_nullable, "NO");
    assert.match(windowColumns.rows[0].column_default, /now\(\)/i);

    const history = await pool.query("SELECT * FROM scope_schema_migrations ORDER BY migration_identifier");
    assert.equal(history.rowCount, 5);
    assert.equal(history.rows[0].migration_filename, "0001_baseline.sql");
    assert.equal(history.rows[1].migration_filename, "0002_security_integrity_constraints.sql");
    assert.equal(history.rows[2].migration_filename, "0003_shared_auth_rate_limits.sql");
    assert.equal(history.rows[3].migration_filename, "0004_staffing_windows_updated_at.sql");
    assert.equal(history.rows[4].migration_filename, "0005_audit_values_as_text.sql");
    assert.ok(history.rows.every((row) => row.applied_at));
  });
});

integrationTest("PostgreSQL rate-limit counters are shared across store instances", async () => {
  await withEmptyDatabase(async (pool) => {
    await runMigrations({ pool, logger: silentLogger });
    const firstInstance = new PostgresRateLimitStore({ query: pool.query.bind(pool) });
    const secondInstance = new PostgresRateLimitStore({ query: pool.query.bind(pool) });

    assert.equal((await firstInstance.consume("login", "a".repeat(64), 60_000)).count, 1);
    assert.equal((await secondInstance.consume("login", "a".repeat(64), 60_000)).count, 2);

    const stored = await pool.query("SELECT limiter_name, key_hash, request_count FROM scope_rate_limits");
    assert.deepEqual(stored.rows, [{ limiter_name: "login", key_hash: "a".repeat(64), request_count: 2 }]);
  });
});

integrationTest("skips migrations that were already applied successfully", async () => {
  await withEmptyDatabase(async (pool) => {
    await runMigrations({ pool, logger: silentLogger });
    const secondRun = await runMigrations({ pool, logger: silentLogger });

    assert.deepEqual(secondRun.applied, []);
    assert.deepEqual(secondRun.skipped, ["0001", "0002", "0003", "0004", "0005"]);
    const history = await pool.query("SELECT COUNT(*)::int AS count FROM scope_schema_migrations");
    assert.equal(history.rows[0].count, 5);
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
