import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  REQUEST_ID_MAX_LENGTH,
  correlationId,
  isPublicApiRequest,
  publicTokenUrlsEnabled,
  rateLimiter,
  resetRateLimiters,
  validateProductionConfig,
} from "../security.js";

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

function mockReq(body = {}, ip = "127.0.0.1") {
  return {
    body,
    ip,
    headers: {},
    get() {
      return "";
    },
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("brute-force throttling returns a stable 429 response", async () => {
  resetRateLimiters();
  const limiter = rateLimiter("login", { windowMs: 60_000, max: 2 });
  const req = mockReq({ email: "user@cos.edu" });

  for (let i = 0; i < 2; i += 1) {
    const res = mockRes();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  }

  const blocked = mockRes();
  let nextCalled = false;
  await limiter(req, blocked, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, "RATE_LIMITED");
  assert.match(blocked.body.error, /too many/i);
});

test("production configuration fails closed for unsafe auth settings", () => {
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@example.com:5432/db",
    CORS_ORIGIN: "https://scope.example.edu",
    APP_BASE_URL: "https://scope.example.edu",
    EMAIL_PROVIDER: "console",
    AUTH_DISABLED: "false",
    API_TOKEN_AUTH_ENABLED: "false",
    RATE_LIMIT_STORE: "postgres",
  };

  assert.equal(validateProductionConfig({ ...base }).ok, true);

  assert.match(validateProductionConfig({ ...base, AUTH_DISABLED: "true" }).errors.join(" "), /AUTH_DISABLED/);
  assert.match(validateProductionConfig({ ...base, CORS_ORIGIN: "" }).errors.join(" "), /CORS_ORIGIN/);
  assert.match(validateProductionConfig({ ...base, DATABASE_URL: "" }).errors.join(" "), /DATABASE_URL/);
  assert.match(validateProductionConfig({ ...base, RATE_LIMIT_STORE: "memory" }).errors.join(" "), /RATE_LIMIT_STORE/);
  assert.match(validateProductionConfig({ ...base, API_TOKEN_AUTH_ENABLED: "true", API_TOKEN: "short" }).errors.join(" "), /API_TOKEN/);
  assert.match(validateProductionConfig({ ...base, EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: "", EMAIL_FROM: "" }).errors.join(" "), /SENDGRID_API_KEY/);
  assert.match(validateProductionConfig({ ...base, EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "", EMAIL_FROM: "" }).errors.join(" "), /BREVO_API_KEY/);
  assert.equal(validateProductionConfig({ ...base, EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "xkeysib-production-key-that-is-long-enough", EMAIL_FROM: "jacoba@cos.edu" }).ok, true);
});

test("token bearer URLs are suppressed by default in production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllow = process.env.ALLOW_TOKEN_URLS_IN_RESPONSES;
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_TOKEN_URLS_IN_RESPONSES;

  try {
    assert.equal(publicTokenUrlsEnabled(), false);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllow === undefined) delete process.env.ALLOW_TOKEN_URLS_IN_RESPONSES;
    else process.env.ALLOW_TOKEN_URLS_IN_RESPONSES = originalAllow;
  }
});

test("auth routes invalidate invite, reset, and stale session tokens after use", () => {
  const authRoutes = read("../routes/auth.js");

  assert.match(authRoutes, /UPDATE scope_user_invites SET accepted_at = NOW\(\) WHERE user_id = \$1 AND accepted_at IS NULL/);
  assert.match(authRoutes, /UPDATE scope_password_resets SET used_at = NOW\(\) WHERE user_id = \$1 AND used_at IS NULL/);
  assert.match(authRoutes, /revokeOtherSessions\(user\.id, session\.token\)/);
});

test("expired tokens, disabled users, and revoked sessions are rejected by auth queries", () => {
  const auth = read("../auth.js");
  const authRoutes = read("../routes/auth.js");

  assert.match(auth, /s\.revoked_at IS NULL/);
  assert.match(auth, /s\.expires_at > NOW\(\)/);
  assert.match(auth, /u\.active_status = 'active'/);
  assert.match(authRoutes, /r\.used_at IS NULL/);
  assert.match(authRoutes, /r\.expires_at > NOW\(\)/);
  assert.match(authRoutes, /accepted_at IS NULL/);
  assert.match(authRoutes, /expires_at > NOW\(\)/);
});

test("API token authentication is bootstrap-only and production-disabled by default", () => {
  const auth = read("../auth.js");
  const doc = read("../../docs/auth-production-hardening.md");
  const frontend = read("../../frontend/src/pt-faculty-staffing-mvp.jsx");
  const apiClient = read("../../frontend/src/apiClient.js");

  assert.match(auth, /API_TOKEN_AUTH_ENABLED/);
  assert.match(auth, /process\.env\.NODE_ENV === "production" \? "false" : "true"/);
  assert.match(doc, /bootstrap-only administrative credential/);
  assert.match(frontend, /API_TOKEN_AUTH_ENABLED/);
  assert.match(apiClient, /skipAuth: true/);
  assert.match(apiClient, /correlationId/);
});

test("cleanup removes expired sessions, reset tokens, and invites", () => {
  const auth = read("../auth.js");

  assert.match(auth, /DELETE FROM scope_user_sessions WHERE expires_at <= NOW\(\) OR revoked_at IS NOT NULL/);
  assert.match(auth, /DELETE FROM scope_password_resets WHERE expires_at <= NOW\(\) OR used_at IS NOT NULL/);
  assert.match(auth, /DELETE FROM scope_user_invites WHERE expires_at <= NOW\(\) OR accepted_at IS NOT NULL/);
});

test("security headers and stable public errors are wired into startup", () => {
  const server = read("../server.js");

  assert.match(server, /assertProductionConfig\(\)/);
  assert.match(server, /app\.use\(correlationId\)/);
  assert.match(server, /app\.use\(securityHeaders\)/);
  assert.match(server, /publicError\(res, 401, "UNAUTHORIZED"/);
  assert.match(server, /cleanupExpiredAuthRecords/);
});

test("production startup does not execute schema migrations", () => {
  const server = read("../server.js");
  assert.doesNotMatch(server, /schema\.sql|runMigrations|ensureSchema/);
  assert.match(server, /app\.listen/);
});

function applyCorrelationId(headerValue) {
  const req = {
    headers: headerValue === undefined ? {} : { "x-request-id": headerValue },
    get(name) {
      return this.headers[name];
    },
  };
  const response = mockRes();
  let nextCalled = false;
  correlationId(req, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(response.headers["X-Request-ID"], req.correlationId);
  return req.correlationId;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("request IDs accept a conservative valid caller identifier", () => {
  assert.equal(applyCorrelationId("request-ABC_123:worker.9"), "request-ABC_123:worker.9");
});

test("missing request IDs receive a server UUID", () => {
  assert.match(applyCorrelationId(undefined), UUID_PATTERN);
});

test("overlong request IDs receive a server UUID", () => {
  assert.match(applyCorrelationId("a".repeat(REQUEST_ID_MAX_LENGTH + 1)), UUID_PATTERN);
});

test("newline and log-injection request IDs receive a server UUID", () => {
  assert.match(applyCorrelationId("request-123\nforged-log-line"), UUID_PATTERN);
});

test("request IDs with unsupported characters receive a server UUID", () => {
  assert.match(applyCorrelationId("request id/with spaces"), UUID_PATTERN);
});

test("only the minimal terms read is public", () => {
  const publicAuthPaths = new Set(["/api/auth/login"]);
  assert.equal(isPublicApiRequest({ method: "GET", path: "/api/terms" }, { publicAuthPaths }), true);
  assert.equal(isPublicApiRequest({ method: "POST", path: "/api/terms" }, { publicAuthPaths }), false);
  assert.equal(isPublicApiRequest({ method: "GET", path: "/api/windows" }, { publicAuthPaths }), false);
  assert.equal(isPublicApiRequest({ method: "POST", path: "/api/auth/login" }, { publicAuthPaths }), true);

  const workflow = read("../routes/workflow.js");
  const termsRoute = workflow.match(/router\.get\("\/terms"[\s\S]*?\n}\);/)?.[0] || "";
  assert.match(termsRoute, /SELECT term_code, term_name, is_active FROM scope_terms/);
  assert.doesNotMatch(termsRoute, /SELECT id,/);
  assert.doesNotMatch(termsRoute, /scope_staffing_windows|scope_pt_faculty|scope_sections|division/);
});
