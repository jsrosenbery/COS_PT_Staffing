export async function verifyRelease({ apiBaseUrl, expectedCommit, expectedMigrationCount, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("RELEASE_API_BASE_URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  if (!/^[a-f0-9]{40}$/i.test(expectedCommit || "")) {
    throw new Error("EXPECTED_DEPLOY_COMMIT must be a full 40-character Git commit SHA.");
  }
  if (!Number.isInteger(expectedMigrationCount) || expectedMigrationCount < 1) {
    throw new Error("The release must contain at least one migration.");
  }
  const base = url.href.replace(/\/$/, "");
  const commit = expectedCommit.toLowerCase();
  const checks = await Promise.all(["health", "readiness"].map(async endpoint => {
    const check = { endpoint, ok: false, httpStatus: null, reportedCommit: null, errors: [] };
    try {
      const response = await fetchImpl(`${base}/${endpoint}`, {
        signal: AbortSignal.timeout(timeoutMs), redirect: "error", headers: { Accept: "application/json" },
      });
      check.httpStatus = response.status;
      if (response.status !== 200) check.errors.push(`Expected HTTP 200; received ${response.status}.`);
      let body;
      try { body = await response.json(); } catch {
        check.errors.push("Response is not JSON.");
        return check;
      }
      if (body?.ok !== true) check.errors.push("Response does not confirm ok: true.");
      check.reportedCommit = typeof body?.commit === "string" ? body.commit : null;
      if (check.reportedCommit?.toLowerCase() !== commit) check.errors.push("Reported commit does not match the expected release.");
      if (endpoint === "readiness") {
        check.migrationCount = body?.migrationCount ?? null;
        if (check.migrationCount !== expectedMigrationCount) check.errors.push("Migration count does not match the checked-out release.");
      }
      check.ok = check.errors.length === 0;
    } catch (error) {
      check.errors.push(error.name === "TimeoutError" ? "Request timed out." : "Request failed or redirected.");
    }
    return check;
  }));
  return {
    ok: checks.every(check => check.ok), checkedAt: new Date().toISOString(),
    apiBaseUrl: base, expectedCommit: commit, expectedMigrationCount, checks,
  };
}
