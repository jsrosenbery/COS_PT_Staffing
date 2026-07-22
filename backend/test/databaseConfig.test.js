import assert from "node:assert/strict";
import test from "node:test";
import { databaseSslConfig } from "../db.js";

test("database TLS remains enabled by default and can be disabled explicitly for trusted local services", () => {
  assert.deepEqual(databaseSslConfig({ DATABASE_URL: "postgres://host/database" }), { rejectUnauthorized: false });
  assert.deepEqual(databaseSslConfig({ DATABASE_URL: "postgres://host/database", DATABASE_SSL: "true" }), { rejectUnauthorized: false });
  assert.equal(databaseSslConfig({ DATABASE_URL: "postgres://localhost/database", DATABASE_SSL: "false" }), false);
});
