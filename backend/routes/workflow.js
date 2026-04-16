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

function compactKey(value) {
  return normUpper(value).replace(/[^A-Z0-9]/g, "");
}

function findValue(row, candidates) {
  const entries = Object.entries(row || {});
  for (const candidate of candidates) {
    const target = compactKey(candidate);
    const found = entries.find(([key]) => compactKey(key) === target);
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

function parseSubjectCourse(subjectCourseRaw, fallbackSubject = "", fallbackCourse = "") {
  const subjectCourse = normalize(subjectCourseRaw);
  if (!subjectCourse) return { subject: normalize(fallbackSubject), courseNumber: normalize(fallbackCourse) };
  const parts = subjectCourse.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { subject: parts[0], courseNumber: parts.slice(1).join(" ") };
  const match = subjectCourse.match(/^([A-Za-z&]+)[\s_-]*([0-9A-Za-z.]+)$/);
  if (match) return { subject: match[1], courseNumber: match[2] };
  return { subject: subjectCourse, courseNumber: normalize(fallbackCourse) };
}

function parseTimeRange(raw) {
  const text = normalize(raw);
  if (!text) return { start: "", end: "" };
  const cleaned = text.replace(/\u2013|\u2014/g, "-").replace(/\s+to\s+/gi, "-").replace(/\s*-\s*/g, "-");
  const parts = cleaned.split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { start: parts[0], end: parts[1] };
  return { start: text, end: "" };
}

function parseMeetings(row) {
  const days = findValue(row, ["Days", "DAYS", "MEETING_DAYS", "DAY", "MEET_DAYS", "Meeting Days"]);
  const start = findValue(row, ["Start Time", "START_TIME", "Begin Time", "Begin", "START", "MEET_BEGIN_TIME", "Meeting Begin Time"]);
  const end = findValue(row, ["End Time", "END_TIME", "END", "MEET_END_TIME", "Meeting End Time"]);
  const combinedTime = findValue(row, ["Time", "TIME", "Meeting Time"]);
  const building = findValue(row, ["BUILDING", "Building"]);
  const room = findValue(row, ["ROOM", "Room"]);
  const resolved = start || end ? { start, end } : parseTimeRange(combinedTime);
  if (!days && !resolved.start && !resolved.end && !building && !room) return [];
  return [{ days, start_time: resolved.start, end_time: resolved.end, building, room }];
}

function canonicalDivisionName(value) {
  const raw = normalize(value);
  const key = compactKey(raw);
  const aliases = {
    "INDUSTRYTECHNOLOGY": "Industry and Technology",
    "INDUSTRYANDTECHNOLOGY": "Industry and Technology",
    "MATHENGINEERING": "Math and Engineering",
    "MATHEMATICSENGINEERING": "Math and Engineering",
    "POLICESCIENCE": "Police Science",
    "POLICESCIENCES": "Police Science",
    "FINEART": "Fine Arts",
    "FINEARTS": "Fine Arts",
    "PHYSICALDUCATION": "Physical Education",
    "PHYSICALEDUCATION": "Physical Education",
    "LANGUAGECOMMUNICATIONSTUD": "Language & Communication Stud.",
    "LANGUAGECOMMUNICATIONSTUDIES": "Language & Communication Stud.",
    "EMERGENCYMEDICALTECHNICIAN": "Emergency Medical Technician",
    "CONSUMERFAMILYSTUDIES": "Consumer/Family Studies",
  };
  return aliases[key] || raw;
}

async function getSubjectMap(termCode) {
  const result = await query(
    `SELECT subject_code, discipline_code
     FROM scope_subject_mappings
     WHERE scope = 'global' OR term_code = $1`,
    [termCode]
  );
  const map = new Map();
  for (const row of result.rows) map.set(normUpper(row.subject_code), row.discipline_code);
  return map;
}

function inferSection(row, subjectMap, divisionName) {
  const subjectCourse = findValue(row, ["Subject_Course", "SUBJECT_COURSE", "Subject Course"]);
  const parsed = parseSubjectCourse(
    subjectCourse,
    findValue(row, ["SUBJECT", "Subject", "subject", "SUBJ", "subj", "SUBJECT_CODE", "Subject Code"]),
    findValue(row, ["COURSE_NUMBER", "Course Number", "CATALOG_NUMBER", "Catalog Number", "CATALOG", "COURSE NO", "Course"])
  );
  const subject = parsed.subject;
  const courseNumber = parsed.courseNumber;
  const crn = normalize(findValue(row, ["CRN", "crn", "REFERENCE_NUMBER", "Reference Number"]));
  const title = findValue(row, ["TITLE", "Title", "COURSE_TITLE", "Course Title"]);
  const division = canonicalDivisionName(findValue(row, ["DIVISION", "Division", "division"]) || divisionName);
  const campus = findValue(row, ["CAMPUS", "Campus", "campus", "LOCATION", "Location"]);
  const instructionalMethod = findValue(row, ["METHOD", "Instructional_Method", "Instructional Method", "instructional_method", "INSTRUCTIONAL_METHOD", "Method"]);
  const displayModality = findValue(row, ["MODALITY", "Display Modality", "display_modality", "Display Modality"]);
  const modality = findValue(row, ["MODALITY", "display_modality", "modality", "Display Modality"]);
  const meetings = parseMeetings(row);
  const crossList = normalize(findValue(row, ["Cross_List", "CROSS_LIST", "Cross List"]));
  const corequisiteCrn = normalize(findValue(row, ["COREQUISITE_CRN", "Corequisite_CRN", "Corequisite CRN"]));
  const instructorName = normalize(findValue(row, ["INSTRUCTOR", "Instructor", "FACULTY", "Faculty"]));
  const disciplineCode = subjectMap.get(normUpper(subject)) || "";
  const normalizedInstructor = normUpper(instructorName || "");
  const isStaff =
    normalizedInstructor === "STAFF" ||
    normalizedInstructor.startsWith("STAFF") ||
    normalizedInstructor.includes("STAFF") ||
    normalizedInstructor === "" ||
    normalizedInstructor === "TBA" ||
    normalizedInstructor.includes("TBA");

  return {
    division,
    assignment_group_id: "",
    primary_subject_course: [subject, courseNumber].filter(Boolean).join(" ").trim(),
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
    cross_list: crossList,
    corequisite_crn: corequisiteCrn,
    instructor_name: instructorName,
    staff_eligible: isStaff,
  };
}

function inferBundleType(rows) {
  const distinctCrns = new Set(rows.map((row) => normalize(row.primary_crn)).filter(Boolean));
  const hasCross = rows.some((row) => normalize(row.cross_list));
  const hasCoreq = rows.some((row) => normalize(row.corequisite_crn));
  const subjectCourses = new Set(rows.map((row) => normalize(row.primary_subject_course)).filter(Boolean));
  const titles = new Set(rows.map((row) => normalize(row.title)).filter(Boolean));

  if (distinctCrns.size <= 1) {
    if (rows.length <= 1) return "single";
    if (subjectCourses.size <= 1 || titles.size <= 1) return "single_crn_multiline";
    return "multi_part_course";
  }

  if (hasCross && hasCoreq) return "mixed_bundle";
  if (hasCoreq) return "corequisite_bundle";
  if (hasCross) return "cross_listed";
  return "multi_part_course";
}

function mergeBundleRows(rows, bundleId) {
  const seed = rows[0] || {};
  const bundleType = inferBundleType(rows);
  const bundle = {
    ...seed,
    assignment_group_id: bundleId,
    bundle_type: bundleType,
    is_true_linked: false,
    distinct_crn_count: 0,
    linked_sections: [],
    all_crns: [],
    all_titles: [],
    all_subject_courses: [],
    all_instructors: [],
    meetings: [],
    staff_eligible: true,
  };

  for (const row of rows) {
    bundle.linked_sections.push({
      primary_crn: row.primary_crn,
      primary_subject_course: row.primary_subject_course,
      title: row.title,
      discipline_code: row.discipline_code,
      cross_list: row.cross_list,
      corequisite_crn: row.corequisite_crn,
    });
    if (row.primary_crn && !bundle.all_crns.includes(row.primary_crn)) bundle.all_crns.push(row.primary_crn);
    if (row.title && !bundle.all_titles.includes(row.title)) bundle.all_titles.push(row.title);
    if (row.primary_subject_course && !bundle.all_subject_courses.includes(row.primary_subject_course)) bundle.all_subject_courses.push(row.primary_subject_course);
    if (row.instructor_name && !bundle.all_instructors.includes(row.instructor_name)) bundle.all_instructors.push(row.instructor_name);
    bundle.staff_eligible = bundle.staff_eligible && Boolean(row.staff_eligible);
    for (const meeting of row.meetings || []) {
      const sig = JSON.stringify(meeting);
      if (!(bundle.meetings || []).some((m) => JSON.stringify(m) === sig)) bundle.meetings.push(meeting);
    }
    if (!bundle.discipline_code && row.discipline_code) bundle.discipline_code = row.discipline_code;
    if (!bundle.subject_code && row.subject_code) bundle.subject_code = row.subject_code;
    if (!bundle.course_number && row.course_number) bundle.course_number = row.course_number;
    if (!bundle.primary_crn && row.primary_crn) bundle.primary_crn = row.primary_crn;
    if (!bundle.title && row.title) bundle.title = row.title;
  }

  bundle.primary_subject_course = bundle.all_subject_courses.join(" + ") || bundle.primary_subject_course;
  bundle.title = bundle.all_titles.join(" + ") || bundle.title;
  bundle.primary_crn = bundle.all_crns.join(" / ") || bundle.primary_crn;
  bundle.distinct_crn_count = Array.from(new Set((bundle.all_crns || []).filter(Boolean))).length || 1;
  bundle.is_true_linked = bundle.distinct_crn_count > 1 && ["cross_listed", "corequisite_bundle", "mixed_bundle"].includes(bundle.bundle_type);
  return bundle;
}

/*
 Wave 11:
 1. Build stacked / cross-list groups first.
 2. For each base group, pull in any support/coreq sections referenced by ANY member.
 3. Recursively pull in additional stacked peers of those support sections if needed.
 This allows one row to bridge stacked + coreq rules into a single staffing unit.
*/
function buildInstructionalBundles(rows) {
  const byCrn = new Map();
  const rowsByCrossList = new Map();

  for (const row of rows) {
    const crn = normalize(row.primary_crn);
    if (crn) byCrn.set(crn, row);
    const cross = normalize(row.cross_list);
    if (cross) {
      const list = rowsByCrossList.get(cross) || [];
      list.push(row);
      rowsByCrossList.set(cross, list);
    }
  }

  const baseGroups = [];
  const assigned = new Set();

  // Base groups = stacked/cross-listed groups first
  for (const [cross, groupRows] of rowsByCrossList.entries()) {
    const groupCrns = groupRows.map((r) => normalize(r.primary_crn)).filter(Boolean);
    groupCrns.forEach((crn) => assigned.add(crn));
    baseGroups.push(groupRows);
  }

  // Add standalone rows not already part of a stacked group
  for (const row of rows) {
    const crn = normalize(row.primary_crn);
    if (!crn || !assigned.has(crn)) {
      if (crn) assigned.add(crn);
      baseGroups.push([row]);
    }
  }

  const finalBundles = [];

  for (const base of baseGroups) {
    const bundleMap = new Map();
    const queue = [];

    function addRow(row) {
      const crn = normalize(row.primary_crn) || JSON.stringify(row.raw_row || row);
      if (bundleMap.has(crn)) return;
      bundleMap.set(crn, row);
      queue.push(row);
    }

    base.forEach(addRow);

    while (queue.length) {
      const current = queue.shift();
      const currentCoreq = normalize(current.corequisite_crn);

      // If current points to a support section, pull it in
      if (currentCoreq && byCrn.has(currentCoreq)) {
        const support = byCrn.get(currentCoreq);
        addRow(support);

        // If support itself is stacked, pull in its stacked peers
        const supportCross = normalize(support.cross_list);
        if (supportCross && rowsByCrossList.has(supportCross)) {
          for (const peer of rowsByCrossList.get(supportCross) || []) addRow(peer);
        }
      }

      // If other rows point to current as their support, pull them in too
      const currentCrn = normalize(current.primary_crn);
      if (currentCrn) {
        for (const row of rows) {
          if (normalize(row.corequisite_crn) === currentCrn) {
            addRow(row);
            const peerCross = normalize(row.cross_list);
            if (peerCross && rowsByCrossList.has(peerCross)) {
              for (const peer of rowsByCrossList.get(peerCross) || []) addRow(peer);
            }
          }
        }
      }
    }

    const bundleRows = Array.from(bundleMap.values());
    const ids = bundleRows.map((r) => normalize(r.primary_crn)).filter(Boolean).sort().join("|") || Math.random().toString(36).slice(2, 8);
    finalBundles.push(mergeBundleRows(bundleRows, `bundle:${ids}`));
  }

  // de-duplicate final bundles by CRN signature
  const unique = new Map();
  for (const bundle of finalBundles) {
    const sig = (bundle.all_crns || []).slice().sort().join("|");
    if (!unique.has(sig)) unique.set(sig, bundle);
  }

  return Array.from(unique.values());
}

async function getProtectedWork(termCode, division) {
  const sections = await query(`SELECT assignment_group_id FROM scope_sections WHERE term_code = $1 AND division = $2`, [termCode, division]);
  const sectionIds = sections.rows.map((r) => r.assignment_group_id);
  if (!sectionIds.length) return { preferences: 0, tentativeAssignments: 0, decisionLogs: 0 };

  const prefs = await query(`SELECT COUNT(*)::int AS count FROM scope_preferences WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`, [termCode, sectionIds]);
  const assigns = await query(`SELECT COUNT(*)::int AS count FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = ANY($2::text[]) AND COALESCE(status, 'tentative') <> 'released'`, [termCode, sectionIds]);
  const logs = await query(`SELECT COUNT(*)::int AS count FROM scope_audit_log WHERE term = $1 AND section_key = ANY($2::text[])`, [termCode, sectionIds]);

  return {
    preferences: prefs.rows[0]?.count || 0,
    tentativeAssignments: assigns.rows[0]?.count || 0,
    decisionLogs: logs.rows[0]?.count || 0,
  };
}

router.get("/terms", async (_req, res) => {
  try {
    const result = await query(`SELECT id, term_code, term_name, is_active FROM scope_terms ORDER BY is_active DESC, term_name ASC`);
    res.json({ terms: result.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/terms", async (req, res) => {
  const { termCode = "", termName = "", isActive = false } = req.body || {};
  if (!termCode.trim() || !termName.trim()) return res.status(400).json({ error: "termCode and termName are required." });
  try {
    const result = await query(
      `INSERT INTO scope_terms (term_code, term_name, is_active, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (term_code) DO UPDATE SET term_name = EXCLUDED.term_name, updated_at = NOW()
       RETURNING id, term_code, term_name, is_active`,
      [termCode.trim(), termName.trim(), Boolean(isActive)]
    );
    res.json({ term: result.rows[0] });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/terms/activate", async (req, res) => {
  const { termCode = "" } = req.body || {};
  if (!termCode.trim()) return res.status(400).json({ error: "termCode is required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE scope_terms SET is_active = FALSE, updated_at = NOW()`);
    const result = await client.query(`UPDATE scope_terms SET is_active = TRUE, updated_at = NOW() WHERE term_code = $1 RETURNING id, term_code, term_name, is_active`, [termCode.trim()]);
    await client.query("COMMIT");
    if (!result.rows.length) return res.status(404).json({ error: "Term not found." });
    res.json({ term: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.get("/subject-mapping", async (req, res) => {
  const { termCode = "" } = req.query;
  try {
    const result = await query(`SELECT scope, term_code, subject_code, discipline_code FROM scope_subject_mappings WHERE scope = 'global' OR term_code = $1 ORDER BY subject_code`, [termCode]);
    res.json({ mappings: result.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/subject-mapping/export", async (req, res) => {
  const { termCode = "" } = req.query;
  try {
    const result = await query(`SELECT scope, term_code, subject_code, discipline_code FROM scope_subject_mappings WHERE scope = 'global' OR term_code = $1 ORDER BY subject_code`, [termCode]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(Papa.unparse(result.rows));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/subject-mapping/:termCode/status", async (req, res) => {
  try {
    const globalCount = await query(`SELECT COUNT(*)::int AS count FROM scope_subject_mappings WHERE scope = 'global'`);
    const termCount = await query(`SELECT COUNT(*)::int AS count FROM scope_subject_mappings WHERE term_code = $1`, [req.params.termCode]);
    res.json({ globalCount: globalCount.rows[0]?.count || 0, termCount: termCount.rows[0]?.count || 0 });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/upload/subject-mapping", upload.single("file"), async (req, res) => {
  const file = req.file;
  const { termCode = "" } = req.body || {};
  if (!file) return res.status(400).json({ error: "A CSV file is required." });
  const parsed = parseCsvBuffer(file);
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const valid = [];
  for (const row of rows) {
    const subject = findValue(row, ["subject_code", "subject", "SUBJECT", "subj", "SUBJ"]);
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
    res.json({ importedRows: valid.length, globalCount: globalCount.rows[0]?.count || valid.length, termCount: termCount.rows[0]?.count || 0, scope: "global", message: `Imported ${valid.length} global subject mapping row(s).` });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message, importedRows: 0, globalCount: 0, termCount: 0, scope: "global" });
  } finally { client.release(); }
});

router.post("/upload/schedule/preview", upload.single("file"), async (req, res) => {
  const file = req.file;
  const termCode = normalize(req.body?.termCode);
  const divisionName = canonicalDivisionName(req.body?.divisionName);
  if (!file || !termCode || !divisionName) return res.status(400).json({ ok: false, error: "file, termCode, and divisionName are required." });
  try {
    const subjectMap = await getSubjectMap(termCode);
    const parsed = parseCsvBuffer(file);
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const sections = buildInstructionalBundles(rows.map((row) => inferSection(row, subjectMap, divisionName)));
    const inDivision = sections.filter((row) =>
      canonicalDivisionName(row.division) === canonicalDivisionName(divisionName) &&
      Boolean(row.staff_eligible)
    );
    const ignoredRowsFromOtherDivisions = rows.filter((row) => canonicalDivisionName(findValue(row, ["DIVISION", "Division", "division"]) || divisionName) !== canonicalDivisionName(divisionName)).length;
    const unmappedSubjects = Array.from(new Set(inDivision.filter((s) => !s.discipline_code && s.subject_code).map((s) => s.subject_code))).sort();
    const protectedWork = await getProtectedWork(termCode, divisionName);
    res.json({
      ok: true,
      divisionName,
      errors: [],
      warnings: unmappedSubjects.length ? [`${unmappedSubjects.length} subject code(s) are unmapped.`] : [],
      unmappedSubjects,
      summary: { totalRows: rows.length, divisionRows: inDivision.length, ignoredRowsFromOtherDivisions },
      impact: { openSections: inDivision.length, facultyPreferences: protectedWork.preferences, tentativeAssignments: protectedWork.tentativeAssignments, decisionLogs: protectedWork.decisionLogs },
    });
  } catch (error) { res.status(500).json({ ok: false, error: error.message, errors: [error.message] }); }
});

router.post("/upload/schedule", upload.single("file"), async (req, res) => {
  const file = req.file;
  const termCode = normalize(req.body?.termCode);
  const divisionName = canonicalDivisionName(req.body?.divisionName);
  const forceReplace = String(req.body?.forceReplace || "").toLowerCase() === "true";
  if (!file || !termCode || !divisionName) return res.status(400).json({ error: "file, termCode, and divisionName are required." });

  const client = await pool.connect();
  try {
    const protectedWork = await getProtectedWork(termCode, divisionName);
    const hasProtectedWork = protectedWork.preferences || protectedWork.tentativeAssignments || protectedWork.decisionLogs;
    if (hasProtectedWork && !forceReplace) {
      return res.status(409).json({ code: "existing_work_detected", error: "Existing work was found for this division.", protectedWork });
    }
    const subjectMap = await getSubjectMap(termCode);
    const parsed = parseCsvBuffer(file);
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    const sections = buildInstructionalBundles(rows.map((row) => inferSection(row, subjectMap, divisionName)));
    const inDivision = sections.filter((row) =>
      canonicalDivisionName(row.division) === canonicalDivisionName(divisionName) &&
      Boolean(row.staff_eligible)
    );
    const ignoredRowsFromOtherDivisions = rows.filter((row) => canonicalDivisionName(findValue(row, ["DIVISION", "Division", "division"]) || divisionName) !== canonicalDivisionName(divisionName)).length;
    const unmappedSubjects = Array.from(new Set(inDivision.filter((s) => !s.discipline_code && s.subject_code).map((s) => s.subject_code))).sort();

    await client.query("BEGIN");
    const existing = await client.query(`SELECT assignment_group_id FROM scope_sections WHERE term_code = $1 AND division = $2`, [termCode, divisionName]);
    const existingIds = existing.rows.map((r) => r.assignment_group_id);
    if (forceReplace && existingIds.length) {
      await client.query(`DELETE FROM scope_preferences WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`, [termCode, existingIds]);
      await client.query(`DELETE FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`, [termCode, existingIds]);
      await client.query(`DELETE FROM scope_audit_log WHERE term = $1 AND section_key = ANY($2::text[])`, [termCode, existingIds]);
    }
    const deleted = await client.query(`DELETE FROM scope_sections WHERE term_code = $1 AND division = $2`, [termCode, divisionName]);

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
          termCode, divisionName, section.assignment_group_id, section.primary_subject_course, section.primary_crn,
          section.title, section.campus, section.subject_code, section.course_number, section.discipline_code,
          section.instructional_method, section.display_modality, section.modality,
          JSON.stringify(section.meetings || []),
          JSON.stringify({ ...(section.raw_row || {}), linked_sections: section.linked_sections || [], bundle_type: section.bundle_type || "single", distinct_crn_count: section.distinct_crn_count || 1, is_true_linked: Boolean(section.is_true_linked) }),
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
      summary: { totalRows: rows.length, divisionRows: inDivision.length, ignoredRowsFromOtherDivisions },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message, errors: [error.message] });
  } finally { client.release(); }
});

router.get("/available-sections", async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let where = `WHERE s.term_code = $1 AND COALESCE((s.raw_row->>'staff_eligible')::boolean, true) = true`;
    if (disciplineCode) {
      params.push(disciplineCode);
      where += ` AND s.discipline_code = $${params.length}`;
    }
    const divisionList = String(divisions || "").split("|").map((v) => v.trim()).filter(Boolean);
    if (divisionList.length) {
      params.push(divisionList);
      where += ` AND s.division = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.subject_code, s.course_number,
              s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings, s.raw_row
       FROM scope_sections s
       ${where}
       ORDER BY s.primary_subject_course, s.primary_crn`,
      params
    );
    res.json({ sections: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/division-statuses", async (req, res) => {
  const { termCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const result = await query(
      `SELECT s.division AS division, s.division AS division_name,
              COUNT(DISTINCT s.assignment_group_id)::int AS open_sections_count,
              COUNT(DISTINCT p.id)::int AS preferences_count,
              COUNT(DISTINCT a.id)::int AS assignments_count,
              COUNT(DISTINCT l.id)::int AS decision_logs_count
       FROM scope_sections s
       LEFT JOIN scope_preferences p ON p.term_code = s.term_code AND p.assignment_group_id = s.assignment_group_id
       LEFT JOIN scope_assignments a ON a.term_code = s.term_code AND a.assignment_group_id = s.assignment_group_id AND COALESCE(a.status, 'tentative') <> 'released'
       LEFT JOIN scope_audit_log l ON l.term = s.term_code AND l.section_key = s.assignment_group_id
       WHERE s.term_code = $1
       GROUP BY s.division
       ORDER BY s.division`,
      [termCode]
    );
    const divisions = result.rows.map((row) => {
      const sectionCount = row.open_sections_count || 0;
      const prefCount = row.preferences_count || 0;
      const assignmentCount = row.assignments_count || 0;
      let status = "clean";
      if (sectionCount > 0) status = "loaded";
      if (prefCount > 0) status = "in_progress";
      if (assignmentCount > 0) status = "advanced";
      return { ...row, sectionCount, preferenceCount: prefCount, submissionCount: prefCount, tentativeAssignmentCount: assignmentCount, approvedAssignmentCount: 0, chairFinalizedCount: 0, deanApprovedCount: 0, status };
    });
    res.json({ divisions });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/chair-workflow", async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let where = `WHERE s.term_code = $1 AND COALESCE((s.raw_row->>'staff_eligible')::boolean, true) = true`;
    if (disciplineCode) {
      params.push(disciplineCode);
      where += ` AND s.discipline_code = $${params.length}`;
    }
    const divisionList = String(divisions || "").split("|").map((v) => v.trim()).filter(Boolean);
    if (divisionList.length) {
      params.push(divisionList);
      where += ` AND s.division = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus,
              s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings,
              pt.employee_id, CONCAT_WS(' ', pt.first_name, pt.last_name) AS faculty_name,
              COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '') AS seniority_rank,
              pref.preference_rank
       FROM scope_sections s
       JOIN scope_pt_faculty pt
         ON pt.division = s.division
        AND pt.discipline = s.discipline_code
        AND COALESCE(pt.active_status, 'active') = 'active'
       LEFT JOIN LATERAL (
         SELECT MIN(p.preference_rank) AS preference_rank
         FROM scope_preferences p
         WHERE p.term_code = s.term_code
           AND p.assignment_group_id = s.assignment_group_id
           AND (p.employee_id = pt.employee_id OR p.faculty_id = pt.employee_id)
       ) pref ON TRUE
       ${where}
       ORDER BY s.primary_subject_course, s.primary_crn,
                COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '999999') NULLS LAST,
                pref.preference_rank NULLS LAST, faculty_name`,
      params
    );
    res.json({ rows: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/assignments", async (req, res) => {
  const { termCode = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let disciplineFilter = "";
    if (disciplineCode) { params.push(disciplineCode); disciplineFilter = ` AND a.discipline_code = $2`; }
    const result = await query(
      `SELECT a.id, a.assignment_group_id, a.employee_id, a.faculty_name, a.status, a.reason, a.created_at,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_assignments a
       LEFT JOIN scope_sections s ON s.term_code = a.term_code AND s.assignment_group_id = a.assignment_group_id
       WHERE a.term_code = $1 AND COALESCE(a.status, 'tentative') <> 'released' ${disciplineFilter}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json({ assignments: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/assignments", async (req, res) => {
  const { termCode = "", disciplineCode = "", assignmentGroupId = "", employeeId = "", actorName = "", reason = "" } = req.body || {};
  if (!termCode || !assignmentGroupId || !employeeId) return res.status(400).json({ error: "termCode, assignmentGroupId, and employeeId are required." });
  const client = await pool.connect();
  try {
    const faculty = await client.query(`SELECT CONCAT_WS(' ', first_name, last_name) AS faculty_name FROM scope_pt_faculty WHERE employee_id = $1 ORDER BY COALESCE(active_status, 'active') = 'active' DESC LIMIT 1`, [employeeId]);
    const facultyName = faculty.rows[0]?.faculty_name || employeeId;
    await client.query("BEGIN");
    await client.query(`DELETE FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = $2`, [termCode, assignmentGroupId]);
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
  } finally { client.release(); }
});

router.delete("/assignments/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM scope_assignments WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assignment not found." });
    }
    await client.query(`DELETE FROM scope_assignments WHERE id = $1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ success: true, message: "Tentative assignment removed." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
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
    const faculty = await client.query(`SELECT CONCAT_WS(' ', first_name, last_name) AS faculty_name FROM scope_pt_faculty WHERE employee_id = $1 LIMIT 1`, [employeeId]);
    const facultyName = faculty.rows[0]?.faculty_name || employeeId;
    await client.query(`UPDATE scope_assignments SET employee_id = $1, faculty_name = $2, actor_name = $3, reason = $4, updated_at = NOW() WHERE id = $5`, [employeeId, facultyName, actorName, reason, req.params.id]);
    await client.query("COMMIT");
    res.json({ success: true, message: "Tentative assignment reassigned." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.get("/preferences", async (req, res) => {
  const { termCode = "", facultyId = "" } = req.query;
  if (!termCode || !facultyId) return res.status(400).json({ error: "termCode and facultyId are required." });
  try {
    const result = await query(
      `SELECT p.assignment_group_id, p.preference_rank, p.faculty_id, p.employee_id, p.faculty_name,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_preferences p
       LEFT JOIN scope_sections s ON s.term_code = p.term_code AND s.assignment_group_id = p.assignment_group_id
       WHERE p.term_code = $1 AND p.faculty_id = $2
       ORDER BY p.preference_rank ASC`,
      [termCode, facultyId]
    );
    res.json({ preferences: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
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
  } finally { client.release(); }
});

router.get("/preferences/export", async (req, res) => {
  const { termCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const result = await query(`SELECT term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank FROM scope_preferences WHERE term_code = $1 ORDER BY faculty_name, preference_rank`, [termCode]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(Papa.unparse(result.rows));
  } catch (error) { res.status(500).json({ error: error.message }); }
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
    const result = await query(`SELECT id, actor_name, event_type, COALESCE(section_key, '') AS section_key, COALESCE(note, '') AS detail, created_at FROM scope_audit_log WHERE term = $1 ${disciplineClause} ORDER BY created_at DESC`, params);
    const withDiscipline = await Promise.all(result.rows.map(async (row) => {
      if (!row.section_key) return { ...row, discipline_code: "" };
      const section = await query(`SELECT discipline_code FROM scope_sections WHERE term_code = $1 AND assignment_group_id = $2 LIMIT 1`, [termCode, row.section_key]);
      return { ...row, discipline_code: section.rows[0]?.discipline_code || "" };
    }));
    res.json({ logs: withDiscipline });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

export default router;
