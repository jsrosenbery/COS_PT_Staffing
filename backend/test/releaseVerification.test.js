import assert from "node:assert/strict";
import test from "node:test";
import { verifyRelease } from "../releaseVerification.js";

const commit = "a".repeat(40);
const options = { apiBaseUrl: "https://backend.example.invalid/api/", expectedCommit: commit, expectedMigrationCount: 12 };
const healthy = { ok: true, commit, migrationCount: 12 };
function responses(health = healthy, readiness = healthy, status = 200) {
  return async url => new Response(JSON.stringify(url.endsWith("/health") ? health : readiness), { status });
}

test("release verification checks both public endpoints against the exact release", async () => {
  const calls = [];
  const result = await verifyRelease({ ...options, fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(init.headers, { Accept: "application/json" });
    return new Response(JSON.stringify(healthy));
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["https://backend.example.invalid/api/health", "https://backend.example.invalid/api/readiness"]);
});

test("healthy but stale backend and unauthorized readiness fail the release gate", async () => {
  const result = await verifyRelease({ ...options, fetchImpl: async url => new Response(
    JSON.stringify(url.endsWith("/health") ? { ok: true, commit: "b".repeat(40) } : { error: "Unauthorized" }),
    { status: url.endsWith("/health") ? 200 : 401 }
  ) });
  assert.equal(result.ok, false);
  assert.match(result.checks[0].errors.join(" "), /commit/);
  assert.equal(result.checks[1].httpStatus, 401);
});

for (const [label, body] of [
  ["missing commit", { ok: true, migrationCount: 12 }],
  ["different commit", { ...healthy, commit: "b".repeat(40) }],
  ["short commit", { ...healthy, commit: commit.slice(0, 7) }],
  ["pending migrations", { ok: false, commit, pendingMigrations: ["0012_pending.sql"] }],
  ["wrong migration count", { ...healthy, migrationCount: 11 }],
  ["missing migration count", { ok: true, commit }],
  ["null response", null],
]) {
  test(`readiness rejects ${label}`, async () => {
    const result = await verifyRelease({ ...options, fetchImpl: responses(healthy, body) });
    assert.equal(result.checks[0].ok, true);
    assert.equal(result.checks[1].ok, false);
    assert.equal(result.ok, false);
  });
}

test("non-200 responses cannot pass even with a healthy-looking JSON body", async () => {
  assert.equal((await verifyRelease({ ...options, fetchImpl: responses(healthy, healthy, 503) })).ok, false);
});

test("invalid JSON, network errors and timeouts fail without exposing response bodies", async () => {
  for (const fetchImpl of [
    async () => new Response("<html>Sign in</html>"),
    async () => { throw new Error("private provider diagnostic"); },
    async () => { throw new DOMException("timed out", "TimeoutError"); },
  ]) {
    const result = await verifyRelease({ ...options, fetchImpl });
    assert.equal(result.ok, false);
    assert.ok(result.checks.every(check => check.errors.length > 0));
    assert.doesNotMatch(JSON.stringify(result), /private provider|<html>/);
  }
});

test("invalid release targets and incomplete commits are rejected before any request", async () => {
  const fetchImpl = () => assert.fail("Invalid configuration must not send a request");
  for (const override of [
    { apiBaseUrl: "http://example.invalid/api" }, { apiBaseUrl: "https://user:secret@example.invalid/api" },
    { apiBaseUrl: "https://example.invalid/api?token=secret" }, { apiBaseUrl: "https://example.invalid/api#fragment" },
    { expectedCommit: "main" }, { expectedCommit: "abc1234" }, { expectedMigrationCount: 0 },
  ]) await assert.rejects(verifyRelease({ ...options, ...override, fetchImpl }));
});
