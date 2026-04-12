import express from "express";
import { pool, query } from "../db.js";

const router = express.Router();

router.get("/roles", async (_req, res) => {
  try {
    const result = await query(
      `SELECT employee_id, first_name, last_name, email, role, division, active_status
       FROM scope_roles
       WHERE COALESCE(active_status, 'active') = 'active'
       ORDER BY division, role, last_name, first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/roles", async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM scope_roles");
    for (const row of rows) {
      await client.query(
        `INSERT INTO scope_roles
          (employee_id, first_name, last_name, email, role, division, active_status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          row.employee_id || "",
          row.first_name || "",
          row.last_name || "",
          row.email || "",
          row.role || "",
          row.division || "",
          row.active_status || "active",
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, count: rows.length });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get("/pt-faculty", async (req, res) => {
  const includeInactive = String(req.query.includeInactive || "") === "1";
  try {
    const result = await query(
      `SELECT employee_id, first_name, last_name, email, division, discipline,
              COALESCE(NULLIF(seniority_rank, ''), seniority_value, '') AS seniority_rank,
              COALESCE(NULLIF(seniority_value, ''), seniority_rank, '') AS seniority_value,
              qualified_disciplines, active_status
       FROM scope_pt_faculty
       ${includeInactive ? "" : "WHERE COALESCE(active_status, 'active') = 'active'"}
       ORDER BY division, discipline, last_name, first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/pt-faculty", async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE scope_pt_faculty
       SET active_status = 'inactive',
           updated_at = NOW()`
    );

    for (const row of rows) {
      const rank = row.seniority_rank ?? row.seniority_value ?? "";
      await client.query(
        `INSERT INTO scope_pt_faculty
          (employee_id, first_name, last_name, email, division, discipline, seniority_rank, seniority_value, qualified_disciplines, active_status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',NOW(),NOW())
         ON CONFLICT (employee_id, division, discipline)
         DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           email = EXCLUDED.email,
           seniority_rank = EXCLUDED.seniority_rank,
           seniority_value = EXCLUDED.seniority_value,
           qualified_disciplines = EXCLUDED.qualified_disciplines,
           active_status = 'active',
           updated_at = NOW()`,
        [
          row.employee_id || "",
          row.first_name || "",
          row.last_name || "",
          row.email || "",
          row.division || "",
          row.discipline || "",
          rank,
          rank,
          row.qualified_disciplines || "",
        ]
      );
    }

    const activeCountResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM scope_pt_faculty
       WHERE COALESCE(active_status, 'active') = 'active'`
    );

    await client.query("COMMIT");
    res.json({ success: true, activeCount: activeCountResult.rows?.[0]?.count || 0 });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.delete("/pt-faculty", async (_req, res) => {
  try {
    const result = await query(
      `UPDATE scope_pt_faculty
       SET active_status = 'inactive',
           updated_at = NOW()
       WHERE COALESCE(active_status, 'active') = 'active'`
    );
    res.json({ success: true, inactivated: result.rowCount || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/windows", async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, term, division, sender_email, opened_at, closes_at, status
       FROM scope_staffing_windows
       ORDER BY opened_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/windows", async (req, res) => {
  const row = req.body || {};
  try {
    const result = await query(
      `INSERT INTO scope_staffing_windows (term, division, sender_email, closes_at, status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, term, division, sender_email, opened_at, closes_at, status`,
      [
        row.term || "",
        row.division || "",
        row.sender_email || "",
        row.closes_at || null,
        row.status || "open",
      ]
    );
    res.json({ success: true, window: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/audit", async (req, res) => {
  const { q = "", eventType = "", division = "", sortBy = "created_at", sortDir = "desc" } = req.query;
  const allowedSortFields = new Set(["created_at", "event_type", "division", "term", "actor_name", "instructor_name"]);
  const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "created_at";
  const safeSortDir = String(sortDir).toLowerCase() === "asc" ? "ASC" : "DESC";

  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    where.push(`(
      COALESCE(event_type, '') ILIKE $${idx}
      OR COALESCE(actor_name, '') ILIKE $${idx}
      OR COALESCE(actor_role, '') ILIKE $${idx}
      OR COALESCE(division, '') ILIKE $${idx}
      OR COALESCE(term, '') ILIKE $${idx}
      OR COALESCE(section_key, '') ILIKE $${idx}
      OR COALESCE(instructor_name, '') ILIKE $${idx}
      OR COALESCE(note, '') ILIKE $${idx}
      OR COALESCE(source, '') ILIKE $${idx}
    )`);
  }

  if (eventType) {
    params.push(eventType);
    where.push(`event_type = $${params.length}`);
  }

  if (division) {
    params.push(division);
    where.push(`division = $${params.length}`);
  }

  const sql = `
    SELECT id, event_type, actor_name, actor_role, division, term, section_key, instructor_name, old_value, new_value, note, source, created_at
    FROM scope_audit_log
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${safeSortBy} ${safeSortDir}
    LIMIT 2000
  `;

  try {
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/audit", async (req, res) => {
  const row = req.body || {};
  try {
    const result = await query(
      `INSERT INTO scope_audit_log
        (event_type, actor_name, actor_role, division, term, section_key, instructor_name, old_value, new_value, note, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, created_at`,
      [
        row.event_type || "",
        row.actor_name || "",
        row.actor_role || "",
        row.division || "",
        row.term || "",
        row.section_key || "",
        row.instructor_name || "",
        row.old_value || null,
        row.new_value || null,
        row.note || "",
        row.source || "",
      ]
    );
    res.json({ success: true, audit: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
