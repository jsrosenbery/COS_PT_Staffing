import crypto from "crypto";
import { query as databaseQuery } from "./db.js";

export const DEFAULT_LIMITS = Object.freeze({
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  accountRequest: { windowMs: 60 * 60 * 1000, max: 8 },
  passwordResetRequest: { windowMs: 60 * 60 * 1000, max: 6 },
  passwordResetComplete: { windowMs: 15 * 60 * 1000, max: 8 },
  inviteAccept: { windowMs: 15 * 60 * 1000, max: 8 },
});

function text(value) {
  return String(value ?? "").trim();
}

export function hashRateLimitKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function trustedProxyHops(env = process.env) {
  const raw = text(env.RATE_LIMIT_TRUST_PROXY_HOPS || "0");
  if (!/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), 5);
}

export function clientIp(req, env = process.env) {
  const peer = text(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || "unknown");
  const hops = trustedProxyHops(env);
  if (!hops) return peer;

  const forwarded = text(req.headers?.["x-forwarded-for"] || req.get?.("x-forwarded-for"))
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const chain = [...forwarded, peer];
  return chain[Math.max(0, chain.length - hops - 1)] || peer;
}

export function rateLimitKey(name, req, env = process.env) {
  const identity = text(req.body?.email || req.body?.employee_id || req.body?.employeeId || req.body?.token || "")
    .toLowerCase();
  return hashRateLimitKey(`${name}\n${clientIp(req, env)}\n${identity}`);
}

export class MemoryRateLimitStore {
  constructor({ now = () => Date.now() } = {}) {
    this.entries = new Map();
    this.now = now;
  }

  async consume(name, keyHash, windowMs) {
    const now = this.now();
    const storageKey = `${name}:${keyHash}`;
    const current = this.entries.get(storageKey);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    this.entries.set(storageKey, entry);
    for (const [key, value] of this.entries.entries()) {
      if (value.resetAt <= now) this.entries.delete(key);
    }
    return { count: entry.count, resetAt: entry.resetAt };
  }

  reset() {
    this.entries.clear();
  }
}

export class PostgresRateLimitStore {
  constructor({ query = databaseQuery } = {}) {
    this.query = query;
    this.schemaReady = false;
  }

  async ensureSchema() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS scope_rate_limits (
        limiter_name TEXT NOT NULL,
        key_hash TEXT NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
        window_started_at TIMESTAMPTZ NOT NULL,
        request_count INTEGER NOT NULL CHECK (request_count > 0),
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (limiter_name, key_hash, window_started_at)
      )
    `);
    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_scope_rate_limits_expiry
        ON scope_rate_limits (expires_at)
    `);
    this.schemaReady = true;
  }

  async consume(name, keyHash, windowMs) {
    try {
      return await this.consumeOnce(name, keyHash, windowMs);
    } catch (error) {
      if (error?.code !== "42P01") throw error;
      await this.ensureSchema();
      return this.consumeOnce(name, keyHash, windowMs);
    }
  }

  async consumeOnce(name, keyHash, windowMs) {
    const result = await this.query(
      `INSERT INTO scope_rate_limits (limiter_name, key_hash, window_started_at, request_count, expires_at)
       VALUES (
         $1,
         $2,
         TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) / ($3::double precision / 1000)) * ($3::double precision / 1000)),
         1,
         TO_TIMESTAMP((FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) / ($3::double precision / 1000)) + 1) * ($3::double precision / 1000))
       )
       ON CONFLICT (limiter_name, key_hash, window_started_at)
       DO UPDATE SET request_count = scope_rate_limits.request_count + 1
       RETURNING request_count, expires_at`,
      [name, keyHash, windowMs]
    );
    const row = result.rows[0];
    return { count: Number(row.request_count), resetAt: new Date(row.expires_at).getTime() };
  }
}

export function configuredRateLimitStore(env = process.env, options = {}) {
  const production = text(env.NODE_ENV).toLowerCase() === "production";
  const kind = text(env.RATE_LIMIT_STORE || (production ? "postgres" : "memory")).toLowerCase();
  if (kind === "memory") return new MemoryRateLimitStore(options);
  if (kind === "postgres") return new PostgresRateLimitStore(options);
  throw new Error(`Unsupported RATE_LIMIT_STORE: ${kind}`);
}

let defaultStore;
let defaultStoreSignature;

function currentStore() {
  const signature = `${text(process.env.NODE_ENV).toLowerCase()}|${text(process.env.RATE_LIMIT_STORE).toLowerCase()}`;
  if (!defaultStore || defaultStoreSignature !== signature) {
    defaultStore = configuredRateLimitStore();
    defaultStoreSignature = signature;
  }
  return defaultStore;
}

export function resetRateLimiters() {
  defaultStore?.reset?.();
  defaultStore = undefined;
  defaultStoreSignature = undefined;
}

export function rateLimiter(name, options = {}) {
  const config = { ...(DEFAULT_LIMITS[name] || DEFAULT_LIMITS.login), ...options };
  return async (req, res, next) => {
    try {
      const store = options.store || currentStore();
      const result = await store.consume(name, rateLimitKey(name, req, options.env), config.windowMs);
      res.setHeader("X-RateLimit-Limit", String(config.max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, config.max - result.count)));
      res.setHeader("X-RateLimit-Reset", new Date(result.resetAt).toISOString());
      if (result.count > config.max) {
        return options.onLimited(res, req);
      }
      return next();
    } catch (error) {
      console.error("[rate-limit-store]", { limiter: name, message: error?.message || String(error) });
      return options.onStoreError(res, req);
    }
  };
}
