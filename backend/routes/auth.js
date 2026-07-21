import express from "express";
import { query } from "../db.js";
import {
  createRawToken,
  hashPassword,
  hashToken,
  inviteExpiresAt,
  issueSession,
  sanitizeUser,
  verifyPassword,
} from "../auth.js";
import { buildInviteUrl, sendInviteEmail } from "../emailService.js";

const router = express.Router();
const validRoles = new Set(["admin", "chair", "dean", "faculty"]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function requireAdmin(req, res) {
  if (req.auth?.authType === "api-token" || req.auth?.user?.role === "admin") return true;
  res.status(403).json({ error: "Admin access is required." });
  return false;
}

router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const { rows } = await query("SELECT * FROM scope_users WHERE email = $1 LIMIT 1", [email]);
    const user = rows[0];
    const passwordOk = await verifyPassword(password, user?.password_salt, user?.password_hash);
    if (!user || user.active_status !== "active" || !passwordOk) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const session = await issueSession(user.id);
    res.json({ user: sanitizeUser(user), session });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not sign in." });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const auth = req.get("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (bearer) {
      await query("UPDATE scope_user_sessions SET revoked_at = NOW() WHERE session_token_hash = $1", [hashToken(bearer)]);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not sign out." });
  }
});

router.get("/me", (req, res) => {
  res.json({ user: req.auth?.user || null, authType: req.auth?.authType || null });
});

router.post("/invite", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const email = normalizeEmail(req.body?.email);
    const fullName = String(req.body?.full_name || req.body?.fullName || "").trim();
    const role = String(req.body?.role || "faculty").trim().toLowerCase();
    const division = String(req.body?.division || "").trim();
    if (!email) return res.status(400).json({ error: "Email is required." });
    if (!validRoles.has(role)) return res.status(400).json({ error: "Role must be admin, chair, dean, or faculty." });

    const userResult = await query(
      `INSERT INTO scope_users (email, full_name, role, division, active_status)
       VALUES ($1, $2, $3, $4, 'invited')
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             division = EXCLUDED.division,
             active_status = CASE WHEN scope_users.active_status = 'active' THEN 'active' ELSE 'invited' END,
             updated_at = NOW()
       RETURNING *`,
      [email, fullName, role, division]
    );

    const token = createRawToken();
    const inviteUrl = buildInviteUrl(token);
    const inviteResult = await query(
      `INSERT INTO scope_user_invites (user_id, email, full_name, role, division, invite_token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, full_name, role, division, expires_at, accepted_at, created_at`,
      [
        userResult.rows[0].id,
        email,
        fullName,
        role,
        division,
        hashToken(token),
        inviteExpiresAt(),
        req.auth?.user?.email || req.auth?.authType || "",
      ]
    );

    const emailResult = await sendInviteEmail({ email, fullName, inviteUrl });
    res.status(201).json({ invite: inviteResult.rows[0], inviteUrl, email: emailResult });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not create invitation." });
  }
});

router.post("/accept-invite", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    const fullName = String(req.body?.full_name || req.body?.fullName || "").trim();
    if (!token || password.length < 10) {
      return res.status(400).json({ error: "Invite token and a password of at least 10 characters are required." });
    }

    const inviteResult = await query(
      `SELECT *
         FROM scope_user_invites
        WHERE invite_token_hash = $1
          AND accepted_at IS NULL
          AND expires_at > NOW()
        LIMIT 1`,
      [hashToken(token)]
    );
    const invite = inviteResult.rows[0];
    if (!invite) return res.status(400).json({ error: "Invite is invalid or expired." });

    const passwordRecord = await hashPassword(password);
    const userResult = await query(
      `UPDATE scope_users
          SET full_name = COALESCE(NULLIF($2, ''), full_name, $3),
              role = $4,
              division = $5,
              active_status = 'active',
              password_hash = $6,
              password_salt = $7,
              password_set_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [invite.user_id, fullName, invite.full_name, invite.role, invite.division, passwordRecord.hash, passwordRecord.salt]
    );
    await query("UPDATE scope_user_invites SET accepted_at = NOW() WHERE id = $1", [invite.id]);

    const user = userResult.rows[0];
    const session = await issueSession(user.id);
    res.json({ user: sanitizeUser(user), session });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not accept invitation." });
  }
});

export default router;
