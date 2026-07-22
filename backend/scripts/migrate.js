import "dotenv/config";
import { pool } from "../db.js";
import { getMigrationStatus, runMigrations } from "../migrations.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run or inspect migrations.");
  }

  if (process.argv.includes("--status")) {
    const status = await getMigrationStatus({ pool });
    console.table(status);
    return;
  }

  const result = await runMigrations({ pool });
  console.log(`Migration complete: ${result.applied.length} applied, ${result.skipped.length} already applied.`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
