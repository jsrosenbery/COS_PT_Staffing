import { loadMigrations } from "../migrations.js";
import { verifyRelease } from "../releaseVerification.js";

try {
  const result = await verifyRelease({
    apiBaseUrl: process.env.RELEASE_API_BASE_URL,
    expectedCommit: process.env.EXPECTED_DEPLOY_COMMIT,
    expectedMigrationCount: (await loadMigrations()).length,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(`Release verification failed: ${error.message}`);
  process.exitCode = 1;
}
