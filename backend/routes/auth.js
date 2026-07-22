import express from "express";
import { query } from "../db.js";
import {
  createRawToken,
  hashPassword,
  hashToken,
  inviteExpiresAt,
  issueSession,
  resetExpiresAt,
  sanitizeUser,
  verifyPassword,
} from "../auth.js";
import {
  buildInviteUrl,
  buildPasswordResetUrl,
  sendAccountRequestNotice,
  sendInviteEmail,
  sendPasswordResetEmail,
} from "../emailService.js";

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

router.post("/request-account", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const fullName = String(req.body?.full_name || req.body?.fullName || "").trim();
    const employeeId = String(req.body?.employee_id || req.body?.employeeId || "").trim();
    const requestedRole = String(req.body?.requested_role || req.body?.role || "faculty").trim().toLowerCase();
    const division = String(req.body?.division || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!email || !fullName) return res.status(400).json({ error: "Email and full name are required." });
    if (!validRoles.has(requestedRole)) return res.status(400).json({ error: "Requested role must be admin, chair, dean, or faculty." });

    const result = await query(
      `INSERT INTO scope_account_requests (employee_id, email, full_name, requested_role, division, note, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
       RETURNING id, email, full_name, requested_role, division, status, created_at`,
      [employeeId, email, fullName, requestedRole, division, note]
    );
    await sendAccountRequestNotice({ email, fullName });
    res.status(201).json({ request: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not request account access." });
  }
});

router.get("/account-requests", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const status = String(req.query?.status || "pending").trim().toLowerCase();
    const params = [];
    let where = "";
    if (status && status !== "all") {
      params.push(status);
      where = "WHERE status = $1";
    }
    const result = await query(
      `SELECT id, employee_id, email, full_name, requested_role, division, note, status, reviewed_by, reviewed_at, created_at
       FROM scope_account_requests
       ${where}
       ORDER BY created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ requests: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load account requests." });
  }
});

router.post("/invite", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const email = normalizeEmail(req.body?.email);
    const fullName = String(req.body?.full_name || req.body?.fullName || "").trim();
    const employeeId = String(req.body?.employee_id || req.body?.employeeId || "").trim();
    const role = String(req.body?.role || "faculty").trim().toLowerCase();
    const division = String(req.body?.division || "").trim();
    if (!email) return res.status(400).json({ error: "Email is required." });
    if (!validRoles.has(role)) return res.status(400).json({ error: "Role must be admin, chair, dean, or faculty." });

    const userResult = await query(
      `INSERT INTO scope_users (employee_id, email, full_name, role, division, active_status)
       VALUES ($1, $2, $3, $4, $5, 'invited')
       ON CONFLICT (email) DO UPDATE
         SET employee_id = EXCLUDED.employee_id,
             full_name = CASE WHEN scope_users.active_status = 'active' THEN scope_users.full_name ELSE EXCLUDED.full_name END,
             role = CASE WHEN scope_users.active_status = 'active' THEN scope_users.role ELSE EXCLUDED.role END,
             division = CASE WHEN scope_users.active_status = 'active' THEN scope_users.division ELSE EXCLUDED.division END,
             active_status = CASE WHEN scope_users.active_status = 'active' THEN 'active' ELSE 'invited' END,
             updated_at = NOW()
       RETURNING *`,
      [employeeId, email, fullName, role, division]
    );

    const token = createRawToken();
    const inviteUrl = buildInviteUrl(token);
    const inviteResult = await query(
      `INSERT INTO scope_user_invites (user_id, employee_id, email, full_name, role, division, invite_token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, employee_id, email, full_name, role, division, expires_at, accepted_at, created_at`,
      [
        userResult.rows[0].id,
        employeeId,
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

router.post("/account-requests/:id/approve", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const requestResult = await query("SELECT * FROM scope_account_requests WHERE id = $1 LIMIT 1", [req.params.id]);
    const request = requestResult.rows[0];
    if (!request) return res.status(404).json({ error: "Account request not found." });
    if (request.status !== "pending") return res.status(400).json({ error: "Only pending requests can be approved." });

    req.body = {
      email: request.email,
      full_name: request.full_name,
      employee_id: request.employee_id,
      role: request.requested_role,
      division: request.division,
    };

    const userResult = await query(
      `INSERT INTO scope_users (employee_id, email, full_name, role, division, active_status)
       VALUES ($1, $2, $3, $4, $5, 'invited')
       ON CONFLICT (email) DO UPDATE
         SET employee_id = EXCLUDED.employee_id,
             full_name = CASE WHEN scope_users.active_status = 'active' THEN scope_users.full_name ELSE EXCLUDED.full_name END,
             role = CASE WHEN scope_users.active_status = 'active' THEN scope_users.role ELSE EXCLUDED.role END,
             division = CASE WHEN scope_users.active_status = 'active' THEN scope_users.division ELSE EXCLUDED.division END,
             active_status = CASE WHEN scope_users.active_status = 'active' THEN 'active' ELSE 'invited' END,
             updated_at = NOW()
       RETURNING *`,
      [request.employee_id, request.email, request.full_name, request.requested_role, request.division]
    );

    const token = createRawToken();
    const inviteUrl = buildInviteUrl(token);
    const inviteResult = await query(
      `INSERT INTO scope_user_invites (user_id, employee_id, email, full_name, role, division, invite_token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, employee_id, email, full_name, role, division, expires_at, accepted_at, created_at`,
      [
        userResult.rows[0].id,
        request.employee_id,
        request.email,
        request.full_name,
        request.requested_role,
        request.division,
        hashToken(token),
        inviteExpiresAt(),
        req.auth?.user?.email || req.auth?.authType || "",
      ]
    );
    await query(
      `UPDATE scope_account_requests
       SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [request.id, req.auth?.user?.email || req.auth?.authType || ""]
    );

    const emailResult = await sendInviteEmail({ email: request.email, fullName: request.full_name, inviteUrl });
    res.json({ invite: inviteResult.rows[0], inviteUrl, email: emailResult });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not approve account request." });
  }
});

router.post("/account-requests/:id/reject", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await query(
      `UPDATE scope_account_requests
       SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, status`,
      [req.params.id, req.auth?.user?.email || req.auth?.authType || ""]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Pending account request not found." });
    res.json({ request: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not reject account request." });
  }
});

router.post("/password-reset/request", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email is required." });

    const userResult = await query("SELECT * FROM scope_users WHERE email = $1 AND active_status = 'active' LIMIT 1", [email]);
    const user = userResult.rows[0];
    if (user) {
      const token = createRawToken();
      const resetUrl = buildPasswordResetUrl(token);
      await query(
        `INSERT INTO scope_password_resets (user_id, reset_token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, hashToken(token), resetExpiresAt()]
      );
      await sendPasswordResetEmail({ email: user.email, fullName: user.full_name, resetUrl });
    }
    res.json({ ok: true, message: "If an active account exists for that email, a password reset link will be sent." });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not request password reset." });
  }
});

router.post("/password-reset/complete", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    if (!token || password.length < 10) {
      return res.status(400).json({ error: "Reset token and a password of at least 10 characters are required." });
    }

    const resetResult = await query(
      `SELECT r.*, u.email, u.full_name
       FROM scope_password_resets r
       JOIN scope_users u ON u.id = r.user_id
       WHERE r.reset_token_hash = $1
         AND r.used_at IS NULL
         AND r.expires_at > NOW()
         AND u.active_status = 'active'
       LIMIT 1`,
      [hashToken(token)]
    );
    const reset = resetResult.rows[0];
    if (!reset) return res.status(400).json({ error: "Reset link is invalid or expired." });

    const passwordRecord = await hashPassword(password);
    const userResult = await query(
      `UPDATE scope_users
       SET password_hash = $2,
           password_salt = $3,
           password_set_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [reset.user_id, passwordRecord.hash, passwordRecord.salt]
    );
    await query("UPDATE scope_password_resets SET used_at = NOW() WHERE id = $1", [reset.id]);
    await query("UPDATE scope_user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [reset.user_id]);

    const user = userResult.rows[0];
    const session = await issueSession(user.id);
    res.json({ user: sanitizeUser(user), session });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not reset password." });
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
              employee_id = $8,
              active_status = 'active',
              password_hash = $6,
              password_salt = $7,
              password_set_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [invite.user_id, fullName, invite.full_name, invite.role, invite.division, passwordRecord.hash, passwordRecord.salt, invite.employee_id || ""]
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
