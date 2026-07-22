import crypto from "crypto";
import { promisify } from "util";
import { query } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 14);
const INVITE_DAYS = Number(process.env.INVITE_DAYS || 7);
const RESET_HOURS = Number(process.env.RESET_HOURS || 2);
const API_TOKEN = (process.env.API_TOKEN || "").trim();
const API_TOKEN_AUTH_ENABLED = String(process.env.API_TOKEN_AUTH_ENABLED ?? (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() === "true";

export const publicAuthPaths = new Set([
  "/api/auth/login",
  "/api/auth/accept-invite",
  "/api/auth/request-account",
  "/api/auth/password-reset/request",
  "/api/auth/password-reset/complete",
]);

export function createRawToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export async function hashPassword(password) {
  const salt = createRawToken(16);
  const hash = await scrypt(String(password || ""), salt, 64);
  return { salt, hash: hash.toString("base64") };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const actual = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, "base64");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    employee_id: user.employee_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    division: user.division,
    active_status: user.active_status,
    last_login_at: user.last_login_at,
  };
}

export async function issueSession(userId) {
  const token = createRawToken(32);
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO scope_user_sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expires.toISOString()]
  );
  await query("UPDATE scope_users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [userId]);
  return { token, expires_at: expires.toISOString() };
}

export async function revokeOtherSessions(userId, activeToken) {
  await query(
    `UPDATE scope_user_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND session_token_hash <> $2`,
    [userId, hashToken(activeToken)]
  );
}

export async function cleanupExpiredAuthRecords() {
  await query("DELETE FROM scope_user_sessions WHERE expires_at <= NOW() OR revoked_at IS NOT NULL");
  await query("DELETE FROM scope_password_resets WHERE expires_at <= NOW() OR used_at IS NOT NULL");
  await query("DELETE FROM scope_user_invites WHERE expires_at <= NOW() OR accepted_at IS NOT NULL");
}

export function inviteExpiresAt() {
  return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function resetExpiresAt() {
  return new Date(Date.now() + RESET_HOURS * 60 * 60 * 1000).toISOString();
}

export async function authenticateRequest(req) {
  const auth = req.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey = req.get("x-api-token") || "";

  if (API_TOKEN_AUTH_ENABLED && API_TOKEN && (bearer === API_TOKEN || apiKey === API_TOKEN)) {
    return { authType: "api-token", role: "admin" };
  }

  const sessionToken = bearer || apiKey;
  if (!sessionToken) return null;

  const { rows } = await query(
    `SELECT u.*
       FROM scope_user_sessions s
       JOIN scope_users u ON u.id = s.user_id
      WHERE s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.active_status = 'active'
      LIMIT 1`,
    [hashToken(sessionToken)]
  );

  const user = rows[0];
  if (!user) return null;
  return { authType: "session", role: user.role, user: sanitizeUser(user) };
}
