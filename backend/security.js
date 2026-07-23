import crypto from "crypto";
import { rateLimiter as createRateLimiter } from "./rateLimit.js";

export const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
export { resetRateLimiters } from "./rateLimit.js";

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
  const rateLimitStore = text(env.RATE_LIMIT_STORE || (production ? "postgres" : "memory")).toLowerCase();
  const proxyHops = text(env.RATE_LIMIT_TRUST_PROXY_HOPS || "0");
  const apiTokenEnabled = ["1", "true", "yes", "on"].includes(String(env.API_TOKEN_AUTH_ENABLED ?? (!production ? "true" : "false")).trim().toLowerCase());

  if (production && authDisabled) errors.push("AUTH_DISABLED cannot be true in production.");
  if (production && !corsOrigin) errors.push("CORS_ORIGIN must be explicitly configured in production.");
  if (production && !databaseUrl) errors.push("DATABASE_URL must be configured in production.");
  if (production && !appBaseUrl) errors.push("APP_BASE_URL must be configured in production for invite and password-reset links.");
  if (production && rateLimitStore !== "postgres") errors.push("RATE_LIMIT_STORE must be postgres in production.");
  if (!/^[0-5]$/.test(proxyHops)) errors.push("RATE_LIMIT_TRUST_PROXY_HOPS must be an integer from 0 through 5.");
  if (production && apiTokenEnabled) {
    if (!apiToken) errors.push("API_TOKEN_AUTH_ENABLED requires API_TOKEN.");
    if (apiToken && isWeakSecret(apiToken)) errors.push("API_TOKEN must be a strong random bootstrap secret when enabled.");
  }
  if (String(env.EMAIL_PROVIDER || "").trim().toLowerCase() === "sendgrid") {
    if (isWeakSecret(env.SENDGRID_API_KEY)) errors.push("SENDGRID_API_KEY must be configured as a strong secret when EMAIL_PROVIDER=sendgrid.");
    if (!text(env.EMAIL_FROM)) errors.push("EMAIL_FROM must be configured when EMAIL_PROVIDER=sendgrid.");
  }
  if (String(env.EMAIL_PROVIDER || "").trim().toLowerCase() === "brevo") {
    if (isWeakSecret(env.BREVO_API_KEY)) errors.push("BREVO_API_KEY must be configured as a strong secret when EMAIL_PROVIDER=brevo.");
    if (!text(env.EMAIL_FROM)) errors.push("EMAIL_FROM must be configured when EMAIL_PROVIDER=brevo.");
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

export function validRequestId(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= REQUEST_ID_MAX_LENGTH
    && REQUEST_ID_PATTERN.test(value);
}

export function effectiveRequestId(value) {
  return validRequestId(value) ? value : crypto.randomUUID();
}

export function correlationId(req, res, next) {
  const existing = req.get?.("x-request-id") || req.headers?.["x-request-id"];
  req.correlationId = effectiveRequestId(existing);
  res.setHeader("X-Request-ID", req.correlationId);
  next();
}

export function isPublicApiRequest(req, { authDisabled = false, publicAuthPaths = new Set() } = {}) {
  if (authDisabled || req.method === "OPTIONS") return true;
  if (req.path === "/api/health" || publicAuthPaths.has(req.path)) return true;
  return req.method === "GET" && req.path === "/api/terms";
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

export function rateLimiter(name, options = {}) {
  return createRateLimiter(name, {
    ...options,
    onLimited: (res, req) => publicError(res, 429, "RATE_LIMITED", "Too many attempts. Please wait and try again.", req.correlationId),
    onStoreError: (res, req) => publicError(res, 503, "RATE_LIMIT_UNAVAILABLE", "Authentication is temporarily unavailable. Please try again later.", req.correlationId),
  });
}
