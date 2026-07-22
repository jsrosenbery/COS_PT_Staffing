import test from "node:test";
import assert from "node:assert/strict";
import { buildUsers } from "../scripts/seed-login-users.js";

test("development bootstrap retains demo users by default", () => {
  assert.deepEqual(buildUsers({ NODE_ENV: "development" }).map((user) => user.role), ["faculty", "chair", "dean"]);
});

test("production bootstrap creates only the configured administrator", () => {
  const users = buildUsers({ NODE_ENV: "production", ADMIN_EMAIL: "admin@example.edu", ADMIN_PASSWORD: "supplied-out-of-band" });
  assert.equal(users.length, 1);
  assert.equal(users[0].role, "admin");
});

test("production bootstrap rejects missing credentials and demo accounts", () => {
  assert.throws(() => buildUsers({ NODE_ENV: "production" }), /ADMIN_EMAIL/);
  assert.throws(() => buildUsers({ NODE_ENV: "production", ADMIN_EMAIL: "admin@example.edu" }), /ADMIN_PASSWORD/);
  assert.throws(() => buildUsers({ NODE_ENV: "production", ADMIN_EMAIL: "admin@example.edu", ADMIN_PASSWORD: "supplied-out-of-band", SEED_DEMO_USERS: "true" }), /cannot be enabled/);
});
