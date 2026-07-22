import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryRateLimitStore,
  PostgresRateLimitStore,
  clientIp,
  configuredRateLimitStore,
  hashRateLimitKey,
  rateLimitKey,
} from "../rateLimit.js";
import { rateLimiter } from "../security.js";

function request(body = {}, remoteAddress = "198.51.100.7", headers = {}) {
  return { body, headers, socket: { remoteAddress }, correlationId: "test-request" };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("repeated requests are limited while endpoint limits remain independent", async () => {
  const store = new MemoryRateLimitStore();
  const login = rateLimiter("login", { store, max: 1, windowMs: 60_000 });
  const reset = rateLimiter("passwordResetRequest", { store, max: 1, windowMs: 60_000 });
  const req = request({ email: "person@example.edu" });

  let calls = 0;
  await login(req, response(), () => { calls += 1; });
  const blocked = response();
  await login(req, blocked, () => { calls += 1; });
  await reset(req, response(), () => { calls += 1; });

  assert.equal(blocked.statusCode, 429);
  assert.equal(calls, 2);
});

test("memory limits expire and reset", async () => {
  let now = 1_000;
  const store = new MemoryRateLimitStore({ now: () => now });
  assert.equal((await store.consume("login", "key", 100)).count, 1);
  assert.equal((await store.consume("login", "key", 100)).count, 2);
  now = 1_101;
  assert.equal((await store.consume("login", "key", 100)).count, 1);
});

test("raw reset and invitation tokens are not passed to limiter storage", async () => {
  const rawToken = "raw-secret-invitation-or-reset-token";
  const keys = [];
  const store = {
    async consume(_name, key) {
      keys.push(key);
      return { count: 1, resetAt: Date.now() + 1000 };
    },
  };
  const limiter = rateLimiter("inviteAccept", { store });
  await limiter(request({ token: rawToken, password: "never-store-this" }), response(), () => {});

  assert.equal(keys.length, 1);
  assert.equal(keys[0], hashRateLimitKey(`inviteAccept\n198.51.100.7\n${rawToken}`));
  assert.doesNotMatch(keys[0], new RegExp(rawToken));
  assert.equal(keys[0].length, 64);
});

test("development defaults to memory and production defaults to PostgreSQL", () => {
  assert.ok(configuredRateLimitStore({ NODE_ENV: "development" }) instanceof MemoryRateLimitStore);
  assert.ok(configuredRateLimitStore({ NODE_ENV: "production" }, { query: async () => ({ rows: [] }) }) instanceof PostgresRateLimitStore);
});

test("production store failure fails closed without calling route logic", async () => {
  const store = { async consume() { throw new Error("database unavailable"); } };
  const limiter = rateLimiter("login", { store });
  const res = response();
  let called = false;
  await limiter(request({ email: "person@example.edu" }), res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "RATE_LIMIT_UNAVAILABLE");
});

test("forwarded addresses are ignored unless an exact trusted hop count is configured", () => {
  const req = request({}, "10.0.0.4", { "x-forwarded-for": "203.0.113.9, 10.0.0.3" });
  assert.equal(clientIp(req, { RATE_LIMIT_TRUST_PROXY_HOPS: "0" }), "10.0.0.4");
  assert.equal(clientIp(req, { RATE_LIMIT_TRUST_PROXY_HOPS: "1" }), "10.0.0.3");
  assert.equal(clientIp(req, { RATE_LIMIT_TRUST_PROXY_HOPS: "2" }), "203.0.113.9");
});

test("limiter names are part of hashed storage keys", () => {
  const req = request({ email: "PERSON@EXAMPLE.EDU" });
  assert.notEqual(rateLimitKey("login", req), rateLimitKey("accountRequest", req));
});
