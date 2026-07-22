import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_ID = "82468349120260722";
const defaultMigrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url));

function checksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export async function loadMigrations(migrationsDir = defaultMigrationsDir) {
  const filenames = (await fs.readdir(migrationsDir))
    .filter((filename) => filename.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right, "en"));

  const migrations = [];
  const identifiers = new Set();

  for (const filename of filenames) {
    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }

    const identifier = match[1];
    if (identifiers.has(identifier)) {
      throw new Error(`Duplicate migration identifier: ${identifier}`);
    }
    identifiers.add(identifier);

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    if (!sql.trim()) {
      throw new Error(`Migration is empty: ${filename}`);
    }

    migrations.push({ identifier, filename, checksum: checksum(sql), sql });
  }

  return migrations;
}

async function ensureHistoryTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS scope_schema_migrations (
      migration_identifier TEXT PRIMARY KEY,
      migration_filename TEXT NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readAppliedMigrations(client) {
  const result = await client.query(`
    SELECT migration_identifier, migration_filename, checksum, applied_at
    FROM scope_schema_migrations
    ORDER BY migration_identifier
  `);
  return new Map(result.rows.map((row) => [row.migration_identifier, row]));
}

function verifyAppliedMigration(migration, applied) {
  if (applied.migration_filename !== migration.filename) {
    throw new Error(
      `Migration ${migration.identifier} filename mismatch: database has ${applied.migration_filename}, filesystem has ${migration.filename}`
    );
  }
  if (applied.checksum.trim() !== migration.checksum) {
    throw new Error(`Migration ${migration.identifier} checksum mismatch for ${migration.filename}`);
  }
}

export async function runMigrations({ pool, migrationsDir = defaultMigrationsDir, logger = console } = {}) {
  if (!pool?.connect) throw new Error("A PostgreSQL pool is required.");

  const migrations = await loadMigrations(migrationsDir);
  const client = await pool.connect();
  const result = { applied: [], skipped: [] };
  let locked = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    locked = true;
    await ensureHistoryTable(client);
    const appliedMigrations = await readAppliedMigrations(client);

    for (const migration of migrations) {
      const applied = appliedMigrations.get(migration.identifier);
      if (applied) {
        verifyAppliedMigration(migration, applied);
        result.skipped.push(migration.identifier);
        logger.info?.(`Skipping migration ${migration.filename}; already applied.`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO scope_schema_migrations
             (migration_identifier, migration_filename, checksum)
           VALUES ($1, $2, $3)`,
          [migration.identifier, migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.filename} failed: ${error.message}`, { cause: error });
      }

      result.applied.push(migration.identifier);
      logger.info?.(`Applied migration ${migration.filename}.`);
    }

    return result;
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}

export async function getMigrationStatus({ pool, migrationsDir = defaultMigrationsDir } = {}) {
  if (!pool?.connect) throw new Error("A PostgreSQL pool is required.");

  const migrations = await loadMigrations(migrationsDir);
  const client = await pool.connect();
  try {
    await ensureHistoryTable(client);
    const appliedMigrations = await readAppliedMigrations(client);
    return migrations.map((migration) => {
      const applied = appliedMigrations.get(migration.identifier);
      if (applied) verifyAppliedMigration(migration, applied);
      return {
        identifier: migration.identifier,
        filename: migration.filename,
        status: applied ? "applied" : "pending",
        appliedAt: applied?.applied_at ?? null,
        checksum: migration.checksum,
      };
    });
  } finally {
    client.release();
  }
}
