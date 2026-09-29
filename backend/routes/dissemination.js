import express from "express";
import { pool } from "../db.js";
import { sendDisseminationEmail } from "../emailService.js";
import { requireElevatedRole, requireDivisionScope, isAdmin, scopeFilterForReq } from "../permissions.js";
import { internalError } from "../security.js";

// Dependency injection keeps provider tests local; production always uses the
// configured provider. No caller can choose a provider or its destination URL.
export function createDisseminationRouter({ send = sendDisseminationEmail } = {}) {
  const router = express.Router();
  const actor = req => req.auth?.user?.email || req.auth?.authType || "";
  const permitted = (req, division) => isAdmin(req) || scopeFilterForReq(req, [division]).length > 0;
  async function audit(client, req, event, window, note) {
    await client.query(`INSERT INTO scope_audit_log(event_type,actor_name,actor_role,division,term,note,source)
      VALUES ($1,$2,$3,$4,$5,$6,'backend')`, [event, actor(req), req.auth?.user?.role || req.auth?.role || "", window.division, window.term, note]);
  }
  async function deliver(client, req, res, window, delivery) {
    let result;
    try {
      result = await send({ recipients: delivery.recipients, subject: delivery.subject, body: delivery.message_body });
      if (result?.accepted !== true && result?.delivered !== true) {
        const error = new Error("The email provider did not accept this notice.");
        error.deliveryRejected = true;
        throw error;
      }
    } catch (error) {
      // A lost response could follow provider acceptance. Keep that attempt
      // pending for operator reconciliation instead of risking a duplicate send.
      const status = error.deliveryRejected ? "failed" : "pending";
      await client.query(`UPDATE scope_email_deliveries SET status=$2, failed_at=CASE WHEN $2='failed' THEN NOW() ELSE NULL END,
        last_error=$3 WHERE id=$1`, [delivery.id, status, status === "failed" ? "Provider rejected the notice." : "Provider outcome unknown; check provider logs before retrying."]);
      await audit(client, req, status === "failed" ? "DISSEMINATION_FAILED" : "DISSEMINATION_UNCERTAIN", window, `Notice ${delivery.id}: ${status}.`);
      return res.status(502).json({ error: status === "failed" ? "The staffing window is open, but email was not accepted. Retry the failed notice." : "The staffing window is open. Email outcome is unknown; check provider logs before retrying.",
        windowCreated: true, window, deliveryId: delivery.id, emailStatus: status });
    }
    // Persist acceptance and its audit together. If this write fails, leave the
    // attempt pending, never mark it failed after the provider already accepted.
    await client.query("BEGIN");
    try {
      await client.query(`UPDATE scope_email_deliveries SET status='sent', sent_at=NOW(), failed_at=NULL,
        provider_message_id=$2, last_error=NULL WHERE id=$1`, [delivery.id, String(result.messageId || result.id || "")]);
      await audit(client, req, "DISSEMINATION_ACCEPTED", window, `Provider accepted notice ${delivery.id} for ${delivery.recipients.length} recipient(s); inbox delivery is unconfirmed.`);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    return res.json({ success: true, recipientCount: delivery.recipients.length, email: result, window, deliveryId: delivery.id, emailStatus: "sent" });
  }
  router.get("/dissemination/status", requireElevatedRole, requireDivisionScope, async (req, res) => {
    const { termCode, division } = req.query;
    if (!termCode || !division) return res.status(400).json({ error: "termCode and division are required." });
    const client = await pool.connect();
    try {
      const result = await client.query(`SELECT d.id,d.status,d.subject,d.last_error,d.attempt_count,w.id AS window_id,w.closes_at,
        (d.message_body<>'' AND jsonb_array_length(d.recipients)>0) AS has_payload
        FROM scope_email_deliveries d JOIN scope_staffing_windows w ON w.id=d.staffing_window_id
        WHERE w.term=$1 AND LOWER(w.division)=LOWER($2) AND w.status='open' ORDER BY w.id DESC LIMIT 1`, [termCode, division]);
      res.json({ delivery: result.rows[0] || null });
    } catch (error) { internalError(req, res, error, "Could not read notice status."); }
    finally { client.release(); }
  });
  router.post("/dissemination/send", requireElevatedRole, requireDivisionScope, async (req, res) => {
    const { termCode, division, senderEmail, subject, body, closesAt = null } = req.body || {};
    if (![termCode, division, senderEmail, subject, body].every(value => typeof value === "string" && value.trim())) return res.status(400).json({ error: "termCode, division, senderEmail, subject, and body are required." });
    const client = await pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN"); transaction = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [termCode.toLowerCase(), division.toLowerCase()]);
      const existing = await client.query("SELECT id FROM scope_staffing_windows WHERE LOWER(term)=LOWER($1) AND LOWER(division)=LOWER($2) AND status='open' LIMIT 1", [termCode, division]);
      if (existing.rowCount) return res.status(409).json({ error: "An open staffing window already exists. Check its notice status and retry the failed notice." });
      const rows = await client.query("SELECT DISTINCT BTRIM(email) AS email FROM scope_pt_faculty WHERE LOWER(division)=LOWER($1) AND COALESCE(active_status,'active')='active' AND BTRIM(email)<>'' ORDER BY email", [division]);
      const recipients = rows.rows.map(row => row.email);
      if (!recipients.length) return res.status(400).json({ error: "No active recipients with email were found for this division." });
      const window = (await client.query(`INSERT INTO scope_staffing_windows(term,division,sender_email,closes_at,status,updated_at)
        VALUES ($1,$2,$3,$4,'open',NOW()) RETURNING *`, [termCode, division, senderEmail, closesAt])).rows[0];
      const delivery = (await client.query(`INSERT INTO scope_email_deliveries(staffing_window_id,recipient_count,subject,message_body,recipients,status,requested_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,'pending',$6) RETURNING *`, [window.id, recipients.length, subject, body, JSON.stringify(recipients), actor(req)])).rows[0];
      await audit(client, req, "DISSEMINATION_QUEUED", window, `Queued notice ${delivery.id} for ${recipients.length} recipient(s).`);
      await client.query("COMMIT"); transaction = false;
      return await deliver(client, req, res, window, delivery);
    } catch (error) { internalError(req, res, error, "Could not create the window or record email acceptance. Check notice status before retrying."); }
    finally { if (transaction) await client.query("ROLLBACK"); client.release(); }
  });
  router.post("/dissemination/:id/retry", requireElevatedRole, async (req, res) => {
    const client = await pool.connect();
    let transaction = false;
    try {
      await client.query("BEGIN"); transaction = true;
      const result = await client.query(`SELECT d.*,row_to_json(w) AS window FROM scope_email_deliveries d
        JOIN scope_staffing_windows w ON w.id=d.staffing_window_id WHERE d.id=$1 FOR UPDATE OF d,w`, [req.params.id]);
      const delivery = result.rows[0];
      if (!delivery) return res.status(404).json({ error: "Notice not found." });
      const window = delivery.window;
      if (!permitted(req, window.division)) return res.status(403).json({ error: "This notice is outside your assigned division scope." });
      if (delivery.status === "sent") return res.json({ success: true, alreadyAccepted: true, deliveryId: delivery.id, emailStatus: "sent", window });
      if (delivery.status !== "failed") return res.status(409).json({ error: "Notice is pending or its outcome is unknown. Check provider logs; it cannot be retried automatically." });
      if (window.status !== "open" || (window.closes_at && new Date(window.closes_at) <= new Date())) return res.status(409).json({ error: "The staffing window is no longer open." });
      if (!delivery.message_body || !delivery.recipients.length) {
        const body = req.body?.legacyBody;
        if (typeof body !== "string" || !body.trim()) return res.status(409).json({ error: "This older notice has no saved message. Supply its reviewed original message to retry." });
        const recipients = await client.query("SELECT DISTINCT BTRIM(email) AS email FROM scope_pt_faculty WHERE LOWER(division)=LOWER($1) AND COALESCE(active_status,'active')='active' AND BTRIM(email)<>'' ORDER BY email", [window.division]);
        if (!recipients.rowCount) return res.status(400).json({ error: "No active recipients with email remain in this division." });
        delivery.recipients = recipients.rows.map(row => row.email);
        delivery.message_body = body;
        await client.query("UPDATE scope_email_deliveries SET message_body=$2,recipients=$3::jsonb,recipient_count=$4 WHERE id=$1", [delivery.id, body, JSON.stringify(delivery.recipients), delivery.recipients.length]);
        await audit(client, req, "DISSEMINATION_LEGACY_RECOVERED", window, `Operator supplied original notice ${delivery.id}; recipients captured from current active division roster.`);
      }
      await client.query("UPDATE scope_email_deliveries SET status='pending',attempt_count=attempt_count+1,last_error=NULL WHERE id=$1", [delivery.id]);
      await audit(client, req, "DISSEMINATION_RETRY_QUEUED", window, `Retry queued for notice ${delivery.id}.`);
      await client.query("COMMIT"); transaction = false;
      return await deliver(client, req, res, window, delivery);
    } catch (error) { internalError(req, res, error, "Could not retry the notice. Check notice status before trying again."); }
    finally { if (transaction) await client.query("ROLLBACK"); client.release(); }
  });
  return router;
}
export default createDisseminationRouter();
