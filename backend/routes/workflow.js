import express from "express";
import multer from "multer";
import Papa from "papaparse";
import { pool, query } from "../db.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalize(value) {
  return String(value ?? "").trim();
}

function normUpper(value) {
  return normalize(value).toUpperCase();
}


function canonicalDivisionName(value) {
  const raw = normalize(value);
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = {
    industrytechnology: "Industry and Technology",
    industryandtechnology: "Industry and Technology",
    mathengineering: "Math and Engineering",
    mathandengineering: "Math and Engineering",
    policesciences: "Police Science",
    policescience: "Police Science",
  };
  return aliases[key] || raw;
}


function findValue(row, candidates) {
  const entries = Object.entries(row || {});
  for (const candidate of candidates) {
    const target = normUpper(candidate).replace(/[^A-Z0-9]/g, "");
    const found = entries.find(([key]) => normUpper(key).replace(/[^A-Z0-9]/g, "") === target);
    if (found && normalize(found[1])) return normalize(found[1]);
  }
  return "";
}

function parseCsvBuffer(file) {
  const text = file?.buffer?.toString("utf8") || "";
  return Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h || "").trim(),
  });
}

function parseMeetings(row) {
  const days = findValue(row, ["Days", "MEETING_DAYS", "DAY", "days"]);
  const start = findValue(row, ["Start Time", "START_TIME", "Begin Time", "Begin", "START"]);
  const end = findValue(row, ["End Time", "END_TIME", "END"]);
  if (!days && !start && !end) return [];
  return [{ days, start_time: start, end_time: end }];
}

async function getSubjectMap(termCode) {
  const result = await query(
    `SELECT subject_code, discipline_code
     FROM scope_subject_mappings
     WHERE scope = 'global' OR term_code = $1`,
    [termCode]
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(normUpper(row.subject_code), row.discipline_code);
  }
  return map;
}

function inferSection(row, subjectMap, divisionName) {
  const subject = findValue(row, ["SUBJECT", "Subject", "subject"]);
  const courseNumber = findValue(row, ["COURSE_NUMBER", "Course Number", "CATALOG_NUMBER", "Course", "course_number"]);
  const crn = findValue(row, ["CRN", "crn"]);
  const title = findValue(row, ["TITLE", "Title", "COURSE_TITLE"]);
  const division = canonicalDivisionName(findValue(row, ["DIVISION", "Division", "division"]) || divisionName);
  const campus = findValue(row, ["CAMPUS", "Campus", "campus"]);
  const instructionalMethod = findValue(row, ["METHOD", "Instructional Method", "instructional_method"]);
  const displayModality = findValue(row, ["MODALITY", "Display Modality", "display_modality"]);
  const modality = findValue(row, ["MODALITY", "display_modality", "modality"]);
  const meetings = parseMeetings(row);
  const assignmentGroupId =
    findValue(row, ["ASSIGNMENT_GROUP_ID", "Assignment Group ID", "GROUP_ID"]) ||
    `${subject}-${courseNumber}-${crn || title || Math.random().toString(36).slice(2, 8)}`;
  const disciplineCode = subjectMap.get(normUpper(subject)) || "";
  const primarySubjectCourse = [subject, courseNumber].filter(Boolean).join(" ").trim();
  return {
    division,
    assignment_group_id: assignmentGroupId,
    primary_subject_course: primarySubjectCourse,
    primary_crn: crn,
    title,
    campus,
    subject_code: subject,
    course_number: courseNumber,
    discipline_code: disciplineCode,
    instructional_method: instructionalMethod,
    display_modality: displayModality,
    modality,
    meetings,
    raw_row: row,
  };
}

async function getProtectedWork(termCode, division) {
  const sections = await query(
    `SELECT assignment_group_id
     FROM scope_sections
     WHERE term_code = $1 AND division = $2`,
    [termCode, division]
  );
  const sectionIds = sections.rows.map((r) => r.assignment_group_id);
  if (!sectionIds.length) {
    return { preferences: 0, tentativeAssignments: 0, decisionLogs: 0 };
  }

  const prefs = await query(
    `SELECT COUNT(*)::int AS count FROM scope_preferences
     WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`,
    [termCode, sectionIds]
  );
  const assigns = await query(
    `SELECT COUNT(*)::int AS count FROM scope_assignments
     WHERE term_code = $1 AND assignment_group_id = ANY($2::text[]) AND COALESCE(status, 'tentative') <> 'released'`,
    [termCode, sectionIds]
  );
  const logs = await query(
    `SELECT COUNT(*)::int AS count FROM scope_audit_log
     WHERE term = $1 AND section_key = ANY($2::text[])`,
    [termCode, sectionIds]
  );

  return {
    preferences: prefs.rows[0]?.count || 0,
    tentativeAssignments: assigns.rows[0]?.count || 0,
    decisionLogs: logs.rows[0]?.count || 0,
  };
}

router.get("/terms", async (_req, res) => {
  try {
    const result = await query(
      `SELECT id, term_code, term_name, is_active
       FROM scope_terms
       ORDER BY is_active DESC, term_name ASC`
    );
    res.json({ terms: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/terms", async (req, res) => {
  const { termCode = "", termName = "", isActive = false } = req.body || {};
  if (!termCode.trim() || !termName.trim()) {
    return res.status(400).json({ error: "termCode and termName are required." });
  }
  try {
    const result = await query(
      `INSERT INTO scope_terms (term_code, term_name, is_active, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (term_code)
       DO UPDATE SET term_name = EXCLUDED.term_name, updated_at = NOW()
       RETURNING id, term_code, term_name, is_active`,
      [termCode.trim(), termName.trim(), Boolean(isActive)]
    );
    res.json({ term: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/terms/activate", async (req, res) => {
  const { termCode = "" } = req.body || {};
  if (!termCode.trim()) return res.status(400).json({ error: "termCode is required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE scope_terms SET is_active = FALSE, updated_at = NOW()`);
    const result = await client.query(
      `UPDATE scope_terms
       SET is_active = TRUE, updated_at = NOW()
       WHERE term_code = $1
       RETURNING id, term_code, term_name, is_active`,
      [termCode.trim()]
    );
    await client.query("COMMIT");
    if (!result.rows.length) return res.status(404).json({ error: "Term not found." });
    res.json({ term: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get("/subject-mapping", async (req, res) => {
  const { termCode = "" } = req.query;
  try {
    const result = await query(
      `SELECT scope, term_code, subject_code, discipline_code
       FROM scope_subject_mappings
       WHERE scope = 'global' OR term_code = $1
       ORDER BY subject_code`,
      [termCode]
    );
    res.json({ mappings: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/subject-mapping/export", async (req, res) => {
  const { termCode = "" } = req.query;
  try {
    const result = await query(
      `SELECT scope, term_code, subject_code, discipline_code
       FROM scope_subject_mappings
       WHERE scope = 'global' OR term_code = $1
       ORDER BY subject_code`,
      [termCode]
    );
    const csv = Papa.unparse(result.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/subject-mapping/:termCode/status", async (req, res) => {
  try {
    const globalCount = await query(
      `SELECT COUNT(*)::int AS count FROM scope_subject_mappings WHERE scope = 'global'`
    );
    const termCount = await query(
      `SELECT COUNT(*)::int AS count FROM scope_subject_mappings WHERE term_code = $1`,
      [req.params.termCode]
    );
    res.json({
      globalCount: globalCount.rows[0]?.count || 0,
      termCount: termCount.rows[0]?.count || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/upload/subject-mapping", upload.single("file"), async (req, res) => {
  const file = req.file;
  const { termCode = "" } = req.body || {};
  if (!file) return res.status(400).json({ error: "A CSV file is required." });

  const parsed = parseCsvBuffer(file);
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const valid = [];
  for (const row of rows) {
    const subject = findValue(row, ["subject_code", "subject", "SUBJECT"]);
    const discipline = findValue(row, ["discipline_code", "discipline", "DISCIPLINE"]);
    if (subject && discipline) valid.push({ subject_code: subject, discipline_code: discipline });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of valid) {
      await client.query(
        `INSERT INTO scope_subject_mappings (scope, term_code, subject_code, discipline_code, updated_at)
         VALUES ('global', NULL, $1, $2, NOW())
         ON CONFLICT (scope, term_code, subject_code)
         DO UPDATE SET discipline_code = EXCLUDED.discipline_code, updated_at = NOW()`,
        [row.subject_code, row.discipline_code]
      );
    }
    await client.query("COMMIT");
    const globalCount = await query(`SELECT COUNT(*)::int AS count FROM scope_subject_mappings WHERE scope = 'global'`);
    const termCount = termCode ? await query(`SELECT COUNT(*)::int AS count FROM scope_subject_mappings WHERE term_code = $1`, [termCode]) : { rows: [{ count: 0 }] };
    res.json({
      importedRows: valid.length,
      globalCount: globalCount.rows[0]?.count || valid.length,
      termCount: termCount.rows[0]?.count || 0,
      scope: "global",
      message: `Imported ${valid.length} global subject mapping row(s).`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message, importedRows: 0, globalCount: 0, termCount: 0, scope: "global" });
  } finally {
    client.release();
  }
});

router.post("/upload/schedule/preview", upload.single("file"), async (req, res) => {
  const file = req.file;
  const termCode = normalize(req.body?.termCode);
  const divisionName = canonicalDivisionName(req.body?.divisionName);
  if (!file || !termCode || !divisionName) {
    return res.status(400).json({ ok: false, error: "file, termCode, and divisionName are required." });
  }

  try {
    const subjectMap = await getSubjectMap(termCode);
    const parsed = parseCsvBuffer(file);
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const sections = rows.map((row) => inferSection(row, subjectMap, divisionName));
    const inDivision = sections.filter((row) => normUpper(row.division) === normUpper(divisionName));
    const ignoredRowsFromOtherDivisions = sections.length - inDivision.length;
    const unmappedSubjects = Array.from(new Set(inDivision.filter((s) => !s.discipline_code && s.subject_code).map((s) => s.subject_code))).sort();
    const protectedWork = await getProtectedWork(termCode, divisionName);

    res.json({
      ok: true,
      divisionName,
      errors: [],
      warnings: unmappedSubjects.length ? [`${unmappedSubjects.length} subject code(s) are unmapped.`] : [],
      unmappedSubjects,
      summary: {
        totalRows: rows.length,
        divisionRows: inDivision.length,
        ignoredRowsFromOtherDivisions,
      },
      impact: {
        openSections: inDivision.length,
        facultyPreferences: protectedWork.preferences,
        tentativeAssignments: protectedWork.tentativeAssignments,
        decisionLogs: protectedWork.decisionLogs,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message, errors: [error.message] });
  }
});

router.post("/upload/schedule", upload.single("file"), async (req, res) => {
  const file = req.file;
  const termCode = normalize(req.body?.termCode);
  const divisionName = canonicalDivisionName(req.body?.divisionName);
  const forceReplace = String(req.body?.forceReplace || "").toLowerCase() === "true";

  if (!file || !termCode || !divisionName) {
    return res.status(400).json({ error: "file, termCode, and divisionName are required." });
  }

  const client = await pool.connect();
  try {
    const protectedWork = await getProtectedWork(termCode, divisionName);
    const hasProtectedWork = protectedWork.preferences || protectedWork.tentativeAssignments || protectedWork.decisionLogs;

    if (hasProtectedWork && !forceReplace) {
      return res.status(409).json({
        code: "existing_work_detected",
        error: "Existing work was found for this division.",
        protectedWork,
      });
    }

    const subjectMap = await getSubjectMap(termCode);
    const parsed = parseCsvBuffer(file);
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const sections = rows.map((row) => inferSection(row, subjectMap, divisionName));
    const inDivision = sections.filter((row) => normUpper(row.division) === normUpper(divisionName));
    const ignoredRowsFromOtherDivisions = sections.length - inDivision.length;
    const unmappedSubjects = Array.from(new Set(inDivision.filter((s) => !s.discipline_code && s.subject_code).map((s) => s.subject_code))).sort();

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT assignment_group_id FROM scope_sections WHERE term_code = $1 AND division = $2`,
      [termCode, divisionName]
    );
    const existingIds = existing.rows.map((r) => r.assignment_group_id);

    if (forceReplace && existingIds.length) {
      await client.query(
        `DELETE FROM scope_preferences WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`,
        [termCode, existingIds]
      );
      await client.query(
        `DELETE FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`,
        [termCode, existingIds]
      );
      await client.query(
        `DELETE FROM scope_audit_log WHERE term = $1 AND section_key = ANY($2::text[])`,
        [termCode, existingIds]
      );
    }

    const deleted = await client.query(
      `DELETE FROM scope_sections WHERE term_code = $1 AND division = $2`,
      [termCode, divisionName]
    );

    for (const section of inDivision) {
      await client.query(
        `INSERT INTO scope_sections
          (term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, campus, subject_code, course_number, discipline_code, instructional_method, display_modality, modality, meetings, raw_row, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,NOW())
         ON CONFLICT (term_code, assignment_group_id)
         DO UPDATE SET
           division = EXCLUDED.division,
           primary_subject_course = EXCLUDED.primary_subject_course,
           primary_crn = EXCLUDED.primary_crn,
           title = EXCLUDED.title,
           campus = EXCLUDED.campus,
           subject_code = EXCLUDED.subject_code,
           course_number = EXCLUDED.course_number,
           discipline_code = EXCLUDED.discipline_code,
           instructional_method = EXCLUDED.instructional_method,
           display_modality = EXCLUDED.display_modality,
           modality = EXCLUDED.modality,
           meetings = EXCLUDED.meetings,
           raw_row = EXCLUDED.raw_row,
           updated_at = NOW()`,
        [
          termCode,
          divisionName,
          section.assignment_group_id,
          section.primary_subject_course,
          section.primary_crn,
          section.title,
          section.campus,
          section.subject_code,
          section.course_number,
          section.discipline_code,
          section.instructional_method,
          section.display_modality,
          section.modality,
          JSON.stringify(section.meetings || []),
          JSON.stringify(section.raw_row || {}),
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      ok: true,
      importedCount: inDivision.length,
      replacedCount: deleted.rowCount || 0,
      divisionName,
      warnings: unmappedSubjects.length ? [`${unmappedSubjects.length} subject code(s) are unmapped.`] : [],
      unmappedSubjects,
      summary: {
        totalRows: rows.length,
        divisionRows: inDivision.length,
        ignoredRowsFromOtherDivisions,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message, errors: [error.message] });
  } finally {
    client.release();
  }
});

router.get("/available-sections", async (req, res) => {
  const { termCode = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let where = `WHERE s.term_code = $1`;
    if (disciplineCode) {
      params.push(disciplineCode);
      where += ` AND s.discipline_code = $2`;
    }
    const result = await query(
      `SELECT s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.subject_code, s.course_number, s.discipline_code,
              s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_sections s
       ${where}
       ORDER BY s.primary_subject_course, s.primary_crn`,
      params
    );
    res.json({ sections: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/division-statuses", async (req, res) => {
  const { termCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const result = await query(
      `SELECT s.division AS division,
              s.division AS division_name,
              COUNT(DISTINCT s.assignment_group_id)::int AS open_sections_count,
              COUNT(DISTINCT p.id)::int AS preferences_count,
              COUNT(DISTINCT a.id)::int AS assignments_count,
              COUNT(DISTINCT l.id)::int AS decision_logs_count
       FROM scope_sections s
       LEFT JOIN scope_preferences p
         ON p.term_code = s.term_code
        AND p.assignment_group_id = s.assignment_group_id
       LEFT JOIN scope_assignments a
         ON a.term_code = s.term_code
        AND a.assignment_group_id = s.assignment_group_id
        AND COALESCE(a.status, 'tentative') <> 'released'
       LEFT JOIN scope_audit_log l
         ON l.term = s.term_code
        AND l.section_key = s.assignment_group_id
       WHERE s.term_code = $1
       GROUP BY s.division
       ORDER BY s.division`,
      [termCode]
    );

    const grouped = new Map();
    result.rows.forEach((row) => {
      const division = canonicalDivisionName(row.division);
      const existing = grouped.get(division) || {
        ...row,
        division,
        division_name: division,
        open_sections_count: 0,
        preferences_count: 0,
        assignments_count: 0,
        decision_logs_count: 0,
      };
      existing.open_sections_count += row.open_sections_count || 0;
      existing.preferences_count += row.preferences_count || 0;
      existing.assignments_count += row.assignments_count || 0;
      existing.decision_logs_count += row.decision_logs_count || 0;
      grouped.set(division, existing);
    });

    const divisions = Array.from(grouped.values()).map((row) => {
      const sectionCount = row.open_sections_count || 0;
      const prefCount = row.preferences_count || 0;
      const assignmentCount = row.assignments_count || 0;
      let status = "clean";
      if (sectionCount > 0) status = "loaded";
      if (prefCount > 0) status = "in_progress";
      if (assignmentCount > 0) status = "advanced";
      return {
        ...row,
        sectionCount,
        preferenceCount: prefCount,
        submissionCount: prefCount,
        tentativeAssignmentCount: assignmentCount,
        approvedAssignmentCount: 0,
        chairFinalizedCount: 0,
        deanApprovedCount: 0,
        status,
      };
    });

    res.json({ divisions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/chair-workflow", async (req, res) => {
  const { termCode = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });

  try {
    const params = [termCode];
    let disciplineFilter = "";
    if (disciplineCode) {
      params.push(disciplineCode);
      disciplineFilter = ` AND s.discipline_code = $2`;
    }

    const result = await query(
      `SELECT s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus,
              s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings,
              pt.employee_id, CONCAT_WS(' ', pt.first_name, pt.last_name) AS faculty_name,
              COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '') AS seniority_rank,
              p.preference_rank
       FROM scope_sections s
       JOIN scope_pt_faculty pt
         ON pt.division = s.division
        AND pt.discipline = s.discipline_code
        AND COALESCE(pt.active_status, 'active') = 'active'
       LEFT JOIN scope_preferences p
         ON p.term_code = s.term_code
        AND p.assignment_group_id = s.assignment_group_id
        AND p.employee_id = pt.employee_id
       WHERE s.term_code = $1
         ${disciplineFilter}
       ORDER BY s.primary_subject_course, s.primary_crn,
                COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '999999') NULLS LAST,
                p.preference_rank NULLS LAST, faculty_name`,
      params
    );

    res.json({ rows: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/assignments", async (req, res) => {
  const { termCode = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });

  try {
    const params = [termCode];
    let disciplineFilter = "";
    if (disciplineCode) {
      params.push(disciplineCode);
      disciplineFilter = ` AND a.discipline_code = $2`;
    }

    const result = await query(
      `SELECT a.id, a.assignment_group_id, a.employee_id, a.faculty_name, a.status, a.reason, a.created_at,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_assignments a
       LEFT JOIN scope_sections s
         ON s.term_code = a.term_code
        AND s.assignment_group_id = a.assignment_group_id
       WHERE a.term_code = $1
         AND COALESCE(a.status, 'tentative') <> 'released'
         ${disciplineFilter}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json({ assignments: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/assignments", async (req, res) => {
  const { termCode = "", disciplineCode = "", assignmentGroupId = "", employeeId = "", actorName = "", reason = "" } = req.body || {};
  if (!termCode || !assignmentGroupId || !employeeId) {
    return res.status(400).json({ error: "termCode, assignmentGroupId, and employeeId are required." });
  }
  const client = await pool.connect();
  try {
    const faculty = await client.query(
      `SELECT CONCAT_WS(' ', first_name, last_name) AS faculty_name
       FROM scope_pt_faculty
       WHERE employee_id = $1
       ORDER BY COALESCE(active_status, 'active') = 'active' DESC
       LIMIT 1`,
      [employeeId]
    );
    const facultyName = faculty.rows[0]?.faculty_name || employeeId;

    await client.query("BEGIN");
    await client.query(
      `DELETE FROM scope_assignments
       WHERE term_code = $1 AND assignment_group_id = $2`,
      [termCode, assignmentGroupId]
    );
    const result = await client.query(
      `INSERT INTO scope_assignments
        (term_code, discipline_code, assignment_group_id, employee_id, faculty_name, status, actor_name, reason, updated_at)
       VALUES ($1,$2,$3,$4,$5,'tentative',$6,$7,NOW())
       RETURNING id`,
      [termCode, disciplineCode, assignmentGroupId, employeeId, facultyName, actorName, reason]
    );

    await client.query("COMMIT");
    res.json({ success: true, id: result.rows[0]?.id, message: "Tentative assignment saved." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.delete("/assignments/:id", async (req, res) => {
  const { actorName = "" } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM scope_assignments WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assignment not found." });
    }
    const row = existing.rows[0];
    await client.query(`DELETE FROM scope_assignments WHERE id = $1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ success: true, message: "Tentative assignment removed." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.put("/assignments/:id/reassign", async (req, res) => {
  const { employeeId = "", actorName = "", reason = "" } = req.body || {};
  if (!employeeId || !reason.trim()) return res.status(400).json({ error: "employeeId and reason are required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM scope_assignments WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assignment not found." });
    }
    const row = existing.rows[0];
    const faculty = await client.query(
      `SELECT CONCAT_WS(' ', first_name, last_name) AS faculty_name
       FROM scope_pt_faculty WHERE employee_id = $1 LIMIT 1`,
      [employeeId]
    );
    const facultyName = faculty.rows[0]?.faculty_name || employeeId;
    await client.query(
      `UPDATE scope_assignments
       SET employee_id = $1, faculty_name = $2, actor_name = $3, reason = $4, updated_at = NOW()
       WHERE id = $5`,
      [employeeId, facultyName, actorName, reason, req.params.id]
    );
    await client.query("COMMIT");
    res.json({ success: true, message: "Tentative assignment reassigned." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get("/preferences", async (req, res) => {
  const { termCode = "", facultyId = "" } = req.query;
  if (!termCode || !facultyId) return res.status(400).json({ error: "termCode and facultyId are required." });
  try {
    const result = await query(
      `SELECT p.assignment_group_id, p.preference_rank, p.faculty_id, p.employee_id, p.faculty_name,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_preferences p
       LEFT JOIN scope_sections s
         ON s.term_code = p.term_code
        AND s.assignment_group_id = p.assignment_group_id
       WHERE p.term_code = $1 AND p.faculty_id = $2
       ORDER BY p.preference_rank ASC`,
      [termCode, facultyId]
    );
    res.json({ preferences: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/preferences", async (req, res) => {
  const { termCode = "", facultyId = "", employeeId = "", facultyName = "", preferences = [] } = req.body || {};
  if (!termCode || !facultyId) return res.status(400).json({ error: "termCode and facultyId are required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM scope_preferences WHERE term_code = $1 AND faculty_id = $2`, [termCode, facultyId]);
    for (const pref of preferences) {
      await client.query(
        `INSERT INTO scope_preferences
          (term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [termCode, facultyId, employeeId, facultyName, pref.assignment_group_id, pref.discipline_code || "", pref.preference_rank || 1]
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, savedCount: preferences.length });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get("/preferences/export", async (req, res) => {
  const { termCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const result = await query(
      `SELECT term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank
       FROM scope_preferences
       WHERE term_code = $1
       ORDER BY faculty_name, preference_rank`,
      [termCode]
    );
    const csv = Papa.unparse(result.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/decision-logs", async (req, res) => {
  const { termCode = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let disciplineClause = "";
    if (disciplineCode) {
      params.push(disciplineCode);
      disciplineClause = ` AND (
        note ILIKE '%' || $2 || '%'
        OR section_key IN (
          SELECT assignment_group_id FROM scope_sections
          WHERE term_code = $1 AND discipline_code = $2
        )
      )`;
    }
    const result = await query(
      `SELECT id, actor_name, event_type,
              COALESCE(section_key, '') AS section_key,
              COALESCE(note, '') AS detail,
              created_at
       FROM scope_audit_log
       WHERE term = $1
       ${disciplineClause}
       ORDER BY created_at DESC`,
      params
    );

    const withDiscipline = await Promise.all(result.rows.map(async (row) => {
      if (!row.section_key) return { ...row, discipline_code: "" };
      const section = await query(
        `SELECT discipline_code FROM scope_sections WHERE term_code = $1 AND assignment_group_id = $2 LIMIT 1`,
        [termCode, row.section_key]
      );
      return { ...row, discipline_code: section.rows[0]?.discipline_code || "" };
    }));

    res.json({ logs: withDiscipline });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
