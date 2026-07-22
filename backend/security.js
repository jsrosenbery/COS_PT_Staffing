import crypto from "crypto";

const DEFAULT_LIMITS = Object.freeze({
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  accountRequest: { windowMs: 60 * 60 * 1000, max: 8 },
  passwordResetRequest: { windowMs: 60 * 60 * 1000, max: 6 },
  passwordResetComplete: { windowMs: 15 * 60 * 1000, max: 8 },
  inviteAccept: { windowMs: 15 * 60 * 1000, max: 8 },
});

const limitStores = new Map();

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function text(value) {
  return String(value ?? "").trim();
}

function isWeakSecret(value) {
  const raw = text(value);
  if (raw.length < 32) return true;
  return /^(change-me|replace|your_|your-|test|dev|password|secret)/i.test(raw);
}

export function apiTokenAuthEnabled() {
  return envFlag("API_TOKEN_AUTH_ENABLED", !isProduction());
}

export function publicTokenUrlsEnabled() {
  return envFlag("ALLOW_TOKEN_URLS_IN_RESPONSES", !isProduction());
}

export function validateProductionConfig(env = process.env) {
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const errors = [];
  const authDisabled = ["1", "true", "yes", "on"].includes(String(env.AUTH_DISABLED || "").trim().toLowerCase());
  const corsOrigin = text(env.CORS_ORIGIN);
  const databaseUrl = text(env.DATABASE_URL);
  const appBaseUrl = text(env.APP_BASE_URL);
  const apiToken = text(env.API_TOKEN);
  const apiTokenEnabled = ["1", "true", "yes", "on"].includes(String(env.API_TOKEN_AUTH_ENABLED ?? (!production ? "true" : "false")).trim().toLowerCase());

  if (production && authDisabled) errors.push("AUTH_DISABLED cannot be true in production.");
  if (production && !corsOrigin) errors.push("CORS_ORIGIN must be explicitly configured in production.");
  if (production && !databaseUrl) errors.push("DATABASE_URL must be configured in production.");
  if (production && !appBaseUrl) errors.push("APP_BASE_URL must be configured in production for invite and password-reset links.");
  if (production && apiTokenEnabled) {
    if (!apiToken) errors.push("API_TOKEN_AUTH_ENABLED requires API_TOKEN.");
    if (apiToken && isWeakSecret(apiToken)) errors.push("API_TOKEN must be a strong random bootstrap secret when enabled.");
  }
  if (String(env.EMAIL_PROVIDER || "").trim().toLowerCase() === "sendgrid") {
    if (isWeakSecret(env.SENDGRID_API_KEY)) errors.push("SENDGRID_API_KEY must be configured as a strong secret when EMAIL_PROVIDER=sendgrid.");
    if (!text(env.EMAIL_FROM)) errors.push("EMAIL_FROM must be configured when EMAIL_PROVIDER=sendgrid.");
  }

  return { ok: errors.length === 0, errors };
}

export function assertProductionConfig(env = process.env) {
  const result = validateProductionConfig(env);
  if (!result.ok) {
    throw new Error(`Production configuration is not safe to start: ${result.errors.join(" ")}`);
  }
  return result;
}

export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'");
  next();
}

export function correlationId(req, res, next) {
  const existing = text(req.get?.("x-request-id") || req.headers?.["x-request-id"]);
  req.correlationId = existing || crypto.randomUUID();
  res.setHeader("X-Request-ID", req.correlationId);
  next();
}

export function publicError(res, status, code, message, correlationId) {
  return res.status(status).json({
    error: message,
    code,
    correlationId,
  });
}

export function logError(label, error, req = {}) {
  console.error(`[${label}]`, {
    correlationId: req.correlationId || "",
    path: req.originalUrl || req.url || "",
    message: error?.message || String(error),
    stack: error?.stack || "",
  });
}

export function resetRateLimiters() {
  limitStores.clear();
}

export function rateLimiter(name, options = {}) {
  const config = { ...(DEFAULT_LIMITS[name] || DEFAULT_LIMITS.login), ...options };
  if (!limitStores.has(name)) limitStores.set(name, new Map());
  const store = limitStores.get(name);

  return (req, res, next) => {
    const now = Date.now();
    const keyParts = [
      req.ip || req.socket?.remoteAddress || "unknown",
      text(req.body?.email || req.body?.token || req.body?.employee_id || ""),
    ];
    const key = keyParts.join("|");
    const existing = store.get(key);
    const entry = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + config.windowMs };
    entry.count += 1;
    store.set(key, entry);

    for (const [storedKey, storedValue] of store.entries()) {
      if (storedValue.resetAt <= now) store.delete(storedKey);
    }

    res.setHeader("X-RateLimit-Limit", String(config.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, config.max - entry.count)));
    res.setHeader("X-RateLimit-Reset", new Date(entry.resetAt).toISOString());

    if (entry.count > config.max) {
      return publicError(
        res,
        429,
        "RATE_LIMITED",
        "Too many attempts. Please wait and try again.",
        req.correlationId
      );
    }
    return next();
  };
}
