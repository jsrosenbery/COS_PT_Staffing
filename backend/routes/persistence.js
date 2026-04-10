
import express from "express";
import { query } from "../db.js";

const router = express.Router();

async function ensureScopeTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS scope_roles (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      division TEXT NOT NULL,
      active_status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS scope_pt_faculty (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      division TEXT NOT NULL,
      discipline TEXT NOT NULL,
      seniority_value TEXT,
      qualified_disciplines TEXT,
      active_status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS scope_staffing_windows (
      id SERIAL PRIMARY KEY,
      term TEXT NOT NULL,
      division TEXT NOT NULL,
      sender_email TEXT,
      opened_at TIMESTAMP DEFAULT NOW(),
      closes_at TIMESTAMP,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS scope_audit_log (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      actor_name TEXT,
      actor_role TEXT,
      division TEXT,
      term TEXT,
      section_key TEXT,
      instructor_name TEXT,
      old_value JSONB,
      new_value JSONB,
      note TEXT,
      source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

router.use(async (_req, _res, next) => {
  try {
    await ensureScopeTables();
    next();
  } catch (error) {
    next(error);
  }
});

router.post("/roles", async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  try {
    await query("BEGIN");
    await query("DELETE FROM scope_roles");
    for (const row of rows) {
      await query(
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
    await query("COMMIT");
    res.json({ success: true, count: rows.length });
  } catch (error) {
    try { await query("ROLLBACK"); } catch {}
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/roles", async (_req, res) => {
  try {
    const result = await query(
      `SELECT employee_id, first_name, last_name, email, role, division, active_status
       FROM scope_roles
       ORDER BY division, role, last_name, first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/pt-faculty", async (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  try {
    await query("BEGIN");
    await query("DELETE FROM scope_pt_faculty");
    for (const row of rows) {
      await query(
        `INSERT INTO scope_pt_faculty
          (employee_id, first_name, last_name, email, division, discipline, seniority_value, qualified_disciplines, active_status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          row.employee_id || "",
          row.first_name || "",
          row.last_name || "",
          row.email || "",
          row.division || "",
          row.discipline || "",
          row.seniority_value || row.seniority_rank || "",
          row.qualified_disciplines || "",
          row.active_status || "active",
        ]
      );
    }
    await query("COMMIT");
    res.json({ success: true, count: rows.length });
  } catch (error) {
    try { await query("ROLLBACK"); } catch {}
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/pt-faculty", async (_req, res) => {
  try {
    const result = await query(
      `SELECT employee_id, first_name, last_name, email, division, discipline, seniority_value, qualified_disciplines, active_status
       FROM scope_pt_faculty
       ORDER BY division, discipline, last_name, first_name`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/windows", async (req, res) => {
  const row = req.body || {};
  try {
    const result = await query(
      `INSERT INTO scope_staffing_windows
        (term, division, sender_email, closes_at, status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, term, division, sender_email, opened_at, closes_at, status`,
      [row.term || "", row.division || "", row.sender_email || "", row.closes_at || null, row.status || "open"]
    );
    res.json({ success: true, window: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
