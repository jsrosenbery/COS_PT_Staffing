import crypto from "crypto";
import { validRequestId } from "./security.js";

function text(value) {
  return String(value ?? "").trim();
}

function auditValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return JSON.stringify({ value: String(value) });
}

export function requestId(req) {
  const effective = req?.correlationId;
  return validRequestId(effective) ? effective : crypto.randomUUID();
}

export function auditActor(req = {}) {
  const user = req.auth?.user || {};
  return {
    actorUserId: user.id || null,
    actorEmail: text(user.email),
    actorName: text(user.full_name || user.email || req.auth?.authType || "system"),
    actorRole: text(user.role || req.auth?.role || ""),
    actorSessionType: text(req.auth?.authType || "system"),
  };
}

export async function writeAuditEvent(client, req, event = {}) {
  const actor = auditActor(req);
  const correlationId = requestId(req);
  const result = await client.query(
    `INSERT INTO scope_audit_log
      (event_type, actor_user_id, actor_email, actor_name, actor_role, actor_session_type,
       division, term, section_key, instructor_name, old_value, new_value, reason_code,
       explanation, request_id, note, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'backend')
     RETURNING id, created_at, request_id`,
    [
      text(event.eventType),
      actor.actorUserId,
      actor.actorEmail,
      actor.actorName,
      actor.actorRole,
      actor.actorSessionType,
      text(event.division),
      text(event.term),
      text(event.sectionKey),
      text(event.instructorName),
      auditValue(event.oldValue),
      auditValue(event.newValue),
      text(event.reasonCode),
      text(event.explanation),
      correlationId,
      text(event.note),
    ]
  );
  return result.rows[0];
}
