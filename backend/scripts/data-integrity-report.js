import "dotenv/config";
import { buildDataIntegrityReport } from "../dataIntegrity.js";
import { pool, query } from "../db.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to inspect database integrity.");
  }

  const report = await buildDataIntegrityReport(query);
  console.table(report.map((item) => ({
    check: item.code,
    table: item.table,
    violations: item.violationCount,
    sample_ids: item.sampleIds.join(", "),
  })));

  const violationCount = report.reduce((total, item) => total + item.violationCount, 0);
  console.log(`Integrity report complete: ${violationCount} total violation(s).`);
  if (process.argv.includes("--strict") && violationCount > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
