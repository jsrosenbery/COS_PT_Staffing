import express from "express";
import multer from "multer";
import Papa from "papaparse";
import { pool, query } from "../db.js";
import { writeAuditEvent } from "../audit.js";
import { analyzeAllocation } from "../domain/allocationAnalysis.js";
import { defaultContractExceptionReasons, validateChairDecision } from "../domain/chairDecision.js";
import { buildDecisionExplanation, decisionExplanationRows } from "../domain/decisionExplanation.js";
import { canSavePreferenceVersion, preferenceSubmissionStatuses, preferenceWindowTimezone, validatePreferenceRanks, windowState } from "../domain/preferenceSubmissionPolicy.js";
import { enforceFacultySelf, isAdmin, requireDivisionScope, requireElevatedRole, requirePreferenceOwnerOrElevated, requireRoles, requireScopedRead, scopeFilterForReq } from "../permissions.js";
import { sendDisseminationEmail } from "../emailService.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024) },
});

function normalize(value) {
  return String(value ?? "").trim();
}

function normUpper(value) {
  return normalize(value).toUpperCase();
}

function compactKey(value) {
  return normUpper(value).replace(/[^A-Z0-9]/g, "");
}

function stableHash(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableSectionSignature(row = {}) {
  const raw = row.raw_row && typeof row.raw_row === "object" ? row.raw_row : {};
  return [
    row.primary_crn,
    row.primary_subject_course,
    row.title,
    row.division,
    row.campus,
    row.subject_code,
    row.course_number,
    row.discipline_code,
    JSON.stringify(row.meetings || []),
    findValue(raw, ["Section", "SECTION", "SECTION_NUMB", "Reference Number", "REFERENCE_NUMBER"]),
  ].map(normalize).join("|");
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
    const ids = bundleRows.map((r) => normalize(r.primary_crn)).filter(Boolean).sort().join("|")
      || `no-crn:${stableHash(bundleRows.map(stableSectionSignature).sort().join("||"))}`;
    finalBundles.push(mergeBundleRows(bundleRows, `bundle:${ids}`));
  }

  // de-duplicate final bundles by CRN signature
  const unique = new Map();
  for (const bundle of finalBundles) {
    const sig = (bundle.all_crns || []).slice().sort().join("|") || stableSectionSignature(bundle);
    if (!unique.has(sig)) unique.set(sig, bundle);
  }

  return Array.from(unique.values());
}

function buildUploadSummary({ rows = [], sections = [], inDivision = [], ignoredRowsFromOtherDivisions = 0 }) {
  const uniqueCrns = new Set();
  for (const section of inDivision) {
    for (const crn of section.all_crns || []) {
      if (normalize(crn)) uniqueCrns.add(normalize(crn));
    }
    if (normalize(section.primary_crn) && !(section.all_crns || []).length) {
      normalize(section.primary_crn).split("/").map(normalize).filter(Boolean).forEach((crn) => uniqueCrns.add(crn));
    }
  }

  const mappedAssignmentGroups = inDivision.filter((section) => Boolean(section.discipline_code)).length;
  const unmappedAssignmentGroups = inDivision.length - mappedAssignmentGroups;
  const crossListedGroups = inDivision.filter((section) =>
    Boolean(section.is_true_linked) ||
    ["cross_listed", "mixed_bundle"].includes(section.bundle_type) ||
    (section.linked_sections || []).some((linked) => normalize(linked.cross_list))
  ).length;

  return {
    totalRows: rows.length,
    sourceTotalRows: rows.length,
    keptRowsForDivision: Math.max(rows.length - ignoredRowsFromOtherDivisions, 0),
    divisionRows: inDivision.length,
    ignoredRowsFromOtherDivisions,
    importedSectionBundles: inDivision.length,
    assignmentGroups: inDivision.length,
    totalBundles: sections.length,
    totalCrns: uniqueCrns.size,
    mappedAssignmentGroups,
    unmappedAssignmentGroups,
    crossListedGroups,
  };
}

function parseScopeList(value) {
  return String(value || "")
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function getContractExceptionReasons(db = { query }) {
  try {
    const result = await db.query(
      `SELECT code, label, description, requires_explanation, active_status, display_order
       FROM scope_contract_exception_reasons
       WHERE COALESCE(active_status, 'active') = 'active'
       ORDER BY display_order, label`
    );
    return result.rows.length ? result.rows : defaultContractExceptionReasons;
  } catch (_error) {
    return defaultContractExceptionReasons;
  }
}

async function getActivePreferenceWindow(db, termCode, division) {
  const result = await db.query(
    `SELECT id, term, division, opened_at, closes_at, status
     FROM scope_staffing_windows
     WHERE term = $1
       AND LOWER(division) = LOWER($2)
     ORDER BY opened_at DESC, id DESC
     LIMIT 1`,
    [termCode, division || ""]
  );
  return result.rows[0] || null;
}

async function createPreferenceSubmissionVersion(client, {
  termCode,
  facultyId,
  employeeId,
  facultyName,
  preferences,
  availabilityDays,
  availabilityTimeBlocks,
  status,
  source,
  auditReason,
  actor,
}) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`preference:${termCode}:${facultyId}`]);
  const facultyResult = await client.query(
    `SELECT division, discipline
     FROM scope_pt_faculty
     WHERE employee_id = $1
     ORDER BY COALESCE(active_status, 'active') = 'active' DESC
     LIMIT 1`,
    [employeeId || facultyId]
  );
  const facultyRosterRow = facultyResult.rows[0] || {};
  await client.query(
    `SELECT id
     FROM scope_preference_submissions
     WHERE term_code = $1 AND faculty_id = $2
     FOR UPDATE`,
    [termCode, facultyId]
  );
  const versionResult = await client.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM scope_preference_submissions
     WHERE term_code = $1 AND faculty_id = $2`,
    [termCode, facultyId]
  );
  const versionNumber = versionResult.rows[0]?.next_version || 1;
  if (status === preferenceSubmissionStatuses.SUBMITTED || status === preferenceSubmissionStatuses.CORRECTED) {
    await client.query(
      `UPDATE scope_preference_submissions
       SET status = 'superseded', superseded_at = NOW()
       WHERE term_code = $1
         AND faculty_id = $2
         AND status IN ('submitted', 'corrected')`,
      [termCode, facultyId]
    );
  }
  const submissionResult = await client.query(
    `INSERT INTO scope_preference_submissions
      (term_code, faculty_id, employee_id, faculty_name, division, discipline_code, status, version_number,
       submission_snapshot, source, audit_reason, submitted_by_user_id, submitted_by_email, submitted_by_name,
       submitted_by_role, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,CASE WHEN $7 = 'draft' THEN NULL ELSE NOW() END)
     RETURNING id, version_number, submitted_at`,
    [
      termCode,
      facultyId,
      employeeId,
      facultyName,
      facultyRosterRow.division || "",
      facultyRosterRow.discipline || "",
      status,
      versionNumber,
      JSON.stringify({ preferences, availability: { days: availabilityDays, timeBlocks: availabilityTimeBlocks } }),
      source || "web",
      auditReason || "",
      actor.id || null,
      actor.email || "",
      actor.full_name || actor.email || "",
      actor.role || "",
    ]
  );
  const submissionId = submissionResult.rows[0]?.id;
  for (const pref of preferences) {
    await client.query(
      `INSERT INTO scope_preference_submission_items
        (submission_id, term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank, item_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        submissionId,
        termCode,
        facultyId,
        employeeId,
        facultyName,
        pref.assignment_group_id,
        pref.discipline_code || "",
        pref.preference_rank || 1,
        JSON.stringify(pref),
      ]
    );
  }
  return { ...submissionResult.rows[0], division: facultyRosterRow.division || "", discipline: facultyRosterRow.discipline || "" };
}

async function freezeLatestSubmittedVersions(client, { termCode, division, actor, auditReason = "Preference window closed; latest valid submitted versions frozen." }) {
  await client.query(
    `UPDATE scope_preference_submissions
     SET status = 'superseded', superseded_at = NOW()
     WHERE term_code = $1
       AND LOWER(division) = LOWER($2)
       AND status = 'frozen'`,
    [termCode, division]
  );
  const result = await client.query(
    `WITH ranked AS (
       SELECT id, faculty_id, ROW_NUMBER() OVER (PARTITION BY faculty_id ORDER BY submitted_at DESC, version_number DESC, id DESC) AS rn
       FROM scope_preference_submissions
       WHERE term_code = $1
         AND LOWER(division) = LOWER($2)
         AND status IN ('submitted', 'corrected')
     )
     UPDATE scope_preference_submissions s
     SET status = CASE WHEN ranked.rn = 1 THEN 'frozen' ELSE 'superseded' END,
         frozen_at = CASE WHEN ranked.rn = 1 THEN NOW() ELSE frozen_at END,
         superseded_at = CASE WHEN ranked.rn = 1 THEN superseded_at ELSE NOW() END
     FROM ranked
     WHERE s.id = ranked.id
     RETURNING s.id, s.faculty_id, s.status`,
    [termCode, division]
  );
  await client.query(
    `INSERT INTO scope_audit_log (event_type, actor_name, actor_role, division, term, note, source)
     VALUES ('PREFERENCE_WINDOW_FROZEN',$1,$2,$3,$4,$5,'backend')`,
    [actor?.full_name || actor?.email || "", actor?.role || "", division, termCode, auditReason]
  );
  return result.rows;
}

async function buildAllocationAnalysisFromDb(db, {
  termCode,
  division = "",
  divisions = [],
  disciplineCode = "",
  oneAssignmentPerPass = true,
  maxAssignments = "",
  maxLoad = "",
}) {
  const requestedDivisions = divisions.length ? divisions : parseScopeList(division);
  const params = [termCode];
  let sectionWhere = `WHERE s.term_code = $1 AND COALESCE((s.raw_row->>'staff_eligible')::boolean, true) = true`;
  if (disciplineCode) {
    params.push(String(disciplineCode).trim());
    sectionWhere += ` AND s.discipline_code = $${params.length}`;
  }
  if (requestedDivisions.length) {
    params.push(requestedDivisions.map((value) => value.toLowerCase()));
    sectionWhere += ` AND LOWER(s.division) = ANY($${params.length}::text[])`;
  }

  const sectionsResult = await db.query(
    `SELECT s.term_code, s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus,
            s.subject_code, s.course_number, s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings, s.raw_row
     FROM scope_sections s
     ${sectionWhere}
     ORDER BY s.division, s.discipline_code, s.primary_subject_course, s.primary_crn`,
    params
  );
  const sections = sectionsResult.rows.map((row) => ({ ...row, meetings: row.meetings || [] }));
  const sectionIds = sections.map((row) => row.assignment_group_id).filter(Boolean);
  const scopedDivisions = Array.from(new Set(sections.map((row) => row.division).filter(Boolean)));

  const [facultyResult, preferenceResult, assignmentResult, reasonRows] = await Promise.all([
    scopedDivisions.length
      ? db.query(
          `SELECT employee_id, first_name, last_name, email, division, discipline,
                  COALESCE(NULLIF(seniority_rank, ''), seniority_value, '') AS seniority_rank,
                  COALESCE(NULLIF(seniority_value, ''), seniority_rank, '') AS seniority_value,
                  qualified_disciplines, active_status
           FROM scope_pt_faculty
           WHERE COALESCE(active_status, 'active') = 'active'
             AND LOWER(division) = ANY($1::text[])
           ORDER BY division, discipline, seniority_rank, last_name, first_name`,
          [scopedDivisions.map((value) => value.toLowerCase())]
        )
      : Promise.resolve({ rows: [] }),
    sectionIds.length
      ? db.query(
          `SELECT i.term_code, i.faculty_id, i.employee_id, i.faculty_name, i.assignment_group_id, i.discipline_code, i.preference_rank, i.created_at, i.created_at AS updated_at
           FROM scope_preference_submission_items i
           JOIN scope_preference_submissions s ON s.id = i.submission_id
           WHERE i.term_code = $1
             AND i.assignment_group_id = ANY($2::text[])
             AND s.status = 'frozen'
           ORDER BY i.faculty_name, i.preference_rank, i.assignment_group_id`,
          [termCode, sectionIds]
        )
      : Promise.resolve({ rows: [] }),
    sectionIds.length
      ? db.query(
          `SELECT a.id, a.term_code, a.discipline_code, a.assignment_group_id, a.employee_id, a.faculty_name, a.status,
                  a.reason, a.reason_code, a.justification, a.actor_name, a.created_at, a.updated_at
           FROM scope_assignments a
           WHERE a.term_code = $1
             AND a.assignment_group_id = ANY($2::text[])
             AND COALESCE(a.status, 'tentative') NOT IN ('released', 'deleted', 'void', 'returned_for_revision')
           ORDER BY a.created_at, a.id`,
          [termCode, sectionIds]
        )
      : Promise.resolve({ rows: [] }),
    getContractExceptionReasons(db),
  ]);

  return {
    analysis: analyzeAllocation({
      termCode,
      division: requestedDivisions.join("|"),
      disciplineCode,
      sections,
      faculty: facultyResult.rows,
      preferences: preferenceResult.rows,
      assignments: assignmentResult.rows,
      recognizedContractualExceptions: reasonRows.map((row) => row.code),
      loadLimits: {
        oneAssignmentPerPass: Boolean(oneAssignmentPerPass),
        maxAssignments: maxAssignments ? Number(maxAssignments) : undefined,
        maxLoad: maxLoad ? Number(maxLoad) : undefined,
      },
    }),
    exceptionReasons: reasonRows,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvFromRows(rows, headers) {
  const escapeCell = (value) => {
    const safe = String(value ?? "");
    const escaped = safe.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))].join("\n");
}

async function buildDecisionExplanationFromDb(db, { termCode, division = "", divisions = [], disciplineCode = "" }) {
  const requestedDivisions = divisions.length ? divisions : parseScopeList(division);
  const { analysis } = await buildAllocationAnalysisFromDb(db, {
    termCode,
    division: requestedDivisions.join("|"),
    divisions: requestedDivisions,
    disciplineCode,
  });

  const sectionIds = (analysis.sections || []).map((section) => section.assignmentGroupId).filter(Boolean);
  const params = [termCode];
  let sectionWhere = "WHERE term_code = $1";
  if (sectionIds.length) {
    params.push(sectionIds);
    sectionWhere += ` AND assignment_group_id = ANY($${params.length}::text[])`;
  }

  const [sectionsResult, decisionsResult, submissionsResult, submissionItemsResult] = await Promise.all([
    db.query(
      `SELECT term_code, division, assignment_group_id, primary_subject_course, primary_crn, title, discipline_code, raw_row, created_at, updated_at
       FROM scope_sections
       ${sectionWhere}
       ORDER BY division, discipline_code, primary_subject_course, primary_crn`,
      params
    ),
    sectionIds.length
      ? db.query(
          `SELECT id, term_code, division, discipline_code, assignment_group_id, recommended_employee_id, selected_employee_id,
                  selected_faculty_name, decision_status, exception_reason_code, exception_explanation,
                  recommendation_snapshot, decision_snapshot, decided_by_email, decided_by_name, decided_by_role,
                  decided_at, created_at, updated_at
           FROM scope_chair_decisions
           WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])
           ORDER BY decided_at, id`,
          [termCode, sectionIds]
        )
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT id, term_code, faculty_id, employee_id, faculty_name, division, discipline_code, submission_snapshot,
              submitted_by_email, submitted_by_name, submitted_by_role, submitted_at, created_at
       FROM scope_preference_submissions
       WHERE term_code = $1
         ${requestedDivisions.length ? "AND LOWER(division) = ANY($2::text[])" : ""}
       ORDER BY submitted_at DESC, id DESC`,
      requestedDivisions.length ? [termCode, requestedDivisions.map((value) => value.toLowerCase())] : [termCode]
    ),
    db.query(
      `SELECT i.id, i.submission_id, i.term_code, i.faculty_id, i.employee_id, i.faculty_name,
              i.assignment_group_id, i.discipline_code, i.preference_rank, i.item_snapshot, i.created_at
       FROM scope_preference_submission_items i
       JOIN scope_preference_submissions s ON s.id = i.submission_id
       WHERE i.term_code = $1
         ${requestedDivisions.length ? "AND LOWER(s.division) = ANY($2::text[])" : ""}
       ORDER BY i.faculty_name, i.preference_rank`,
      requestedDivisions.length ? [termCode, requestedDivisions.map((value) => value.toLowerCase())] : [termCode]
    ),
  ]);

  return buildDecisionExplanation({
    termCode,
    division: requestedDivisions.join("|"),
    sections: sectionsResult.rows,
    decisions: decisionsResult.rows,
    submissions: submissionsResult.rows,
    submissionItems: submissionItemsResult.rows,
    currentAnalysis: analysis,
  });
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
    const result = await query(`SELECT term_code, term_name, is_active FROM scope_terms ORDER BY is_active DESC, term_name ASC`);
    res.json({ terms: result.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/terms", requireRoles("admin"), async (req, res) => {
  const { termCode = "", termName = "", isActive = false } = req.body || {};
  if (!termCode.trim() || !termName.trim()) return res.status(400).json({ error: "termCode and termName are required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (Boolean(isActive)) {
      await client.query(`UPDATE scope_terms SET is_active = FALSE, updated_at = NOW()`);
    }
    const result = await client.query(
      `INSERT INTO scope_terms (term_code, term_name, is_active, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (term_code) DO UPDATE SET
         term_name = EXCLUDED.term_name,
         is_active = CASE WHEN EXCLUDED.is_active THEN TRUE ELSE scope_terms.is_active END,
         updated_at = NOW()
       RETURNING id, term_code, term_name, is_active`,
      [termCode.trim(), termName.trim(), Boolean(isActive)]
    );
    await client.query("COMMIT");
    res.json({ term: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post("/terms/activate", requireRoles("admin"), async (req, res) => {
  const { termCode = "" } = req.body || {};
  if (!termCode.trim()) return res.status(400).json({ error: "termCode is required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, term_code, term_name FROM scope_terms WHERE term_code = $1 FOR UPDATE`,
      [termCode.trim()]
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Term not found." });
    }
    await client.query(`UPDATE scope_terms SET is_active = FALSE, updated_at = NOW()`);
    const result = await client.query(`UPDATE scope_terms SET is_active = TRUE, updated_at = NOW() WHERE term_code = $1 RETURNING id, term_code, term_name, is_active`, [termCode.trim()]);
    await client.query("COMMIT");
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

router.post("/upload/subject-mapping", requireRoles("admin"), upload.single("file"), async (req, res) => {
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
        `DELETE FROM scope_subject_mappings
         WHERE scope = 'global'
           AND term_code IS NULL
           AND subject_code = $1`,
        [row.subject_code]
      );
      await client.query(
        `INSERT INTO scope_subject_mappings (scope, term_code, subject_code, discipline_code, updated_at)
         VALUES ('global', NULL, $1, $2, NOW())`,
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

router.post("/upload/schedule/preview", requireElevatedRole, requireDivisionScope, upload.single("file"), async (req, res) => {
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
    const summary = buildUploadSummary({ rows, sections, inDivision, ignoredRowsFromOtherDivisions });
    res.json({
      ok: true,
      divisionName,
      errors: [],
      warnings: unmappedSubjects.length ? [`${unmappedSubjects.length} subject code(s) are unmapped.`] : [],
      unmappedSubjects,
      summary,
      impact: { openSections: inDivision.length, facultyPreferences: protectedWork.preferences, tentativeAssignments: protectedWork.tentativeAssignments, decisionLogs: protectedWork.decisionLogs },
    });
  } catch (error) { res.status(500).json({ ok: false, error: error.message, errors: [error.message] }); }
});

router.post("/upload/schedule", requireElevatedRole, requireDivisionScope, upload.single("file"), async (req, res) => {
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
    if (!inDivision.length) {
      return res.status(400).json({ error: "No staff-eligible sections matched the selected division. Refusing to replace existing schedule data." });
    }
    const ignoredRowsFromOtherDivisions = rows.filter((row) => canonicalDivisionName(findValue(row, ["DIVISION", "Division", "division"]) || divisionName) !== canonicalDivisionName(divisionName)).length;
    const unmappedSubjects = Array.from(new Set(inDivision.filter((s) => !s.discipline_code && s.subject_code).map((s) => s.subject_code))).sort();
    const summary = buildUploadSummary({ rows, sections, inDivision, ignoredRowsFromOtherDivisions });

    await client.query("BEGIN");
    const existing = await client.query(`SELECT assignment_group_id FROM scope_sections WHERE term_code = $1 AND division = $2`, [termCode, divisionName]);
    const existingIds = existing.rows.map((r) => r.assignment_group_id);
    if (forceReplace && existingIds.length) {
      await client.query(`DELETE FROM scope_preferences WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`, [termCode, existingIds]);
      await client.query(`DELETE FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`, [termCode, existingIds]);
      await client.query(
        `INSERT INTO scope_audit_log (term, event_type, division, note, source)
         VALUES ($1, 'SCHEDULE_FORCE_REPLACE', $2, $3, 'backend')`,
        [termCode, divisionName, `Replaced ${existingIds.length} schedule bundle(s); prior audit entries were retained.`]
      );
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
      summary,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message, errors: [error.message] });
  } finally { client.release(); }
});

router.get("/available-sections", requireScopedRead, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    if (String(req.auth?.user?.role || "").toLowerCase() === "faculty") {
      const facultyResult = await query(
        `SELECT division
         FROM scope_pt_faculty
         WHERE employee_id = $1
           AND COALESCE(active_status, 'active') = 'active'
         ORDER BY COALESCE(active_status, 'active') = 'active' DESC
         LIMIT 1`,
        [req.auth.user.employee_id || ""]
      );
      const facultyRosterRow = facultyResult.rows[0] || null;
      if (!facultyRosterRow) {
        return res.status(409).json({
          error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID to the roster.",
          sections: [],
        });
      }
      const windowResult = await query(
        `SELECT id, term, division, opened_at, closes_at, status
         FROM scope_staffing_windows
         WHERE term = $1
           AND LOWER(division) = LOWER($2)
         ORDER BY opened_at DESC, id DESC
         LIMIT 1`,
        [termCode, facultyRosterRow.division || ""]
      );
      const state = windowState(windowResult.rows[0] || null, new Date());
      if (!state.open) {
        return res.json({
          sections: [],
          window: state,
          message: state.missing
            ? "The preference window has not been opened for your division yet."
            : "The preference window is not open for your division.",
        });
      }
    }

    const params = [termCode];
    let where = `WHERE s.term_code = $1 AND COALESCE((s.raw_row->>'staff_eligible')::boolean, true) = true`;
    if (disciplineCode) {
      params.push(disciplineCode);
      where += ` AND s.discipline_code = $${params.length}`;
    }
    const divisionList = scopeFilterForReq(req, String(divisions || "").split("|"));
    if (!isAdmin(req) && !divisionList.length) return res.status(403).json({ error: "No permitted divisions are available for this request." });
    if (divisionList.length) {
      params.push(divisionList);
      where += ` AND LOWER(s.division) = ANY($${params.length}::text[])`;
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

router.get("/division-statuses", requireScopedRead, async (req, res) => {
  const { termCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    const scopedDivisions = scopeFilterForReq(req, []);
    let scopedWhere = "";
    if (scopedDivisions.length) {
      params.push(scopedDivisions);
      scopedWhere = `AND LOWER(s.division) = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT s.division AS division, s.division AS division_name,
              COUNT(DISTINCT s.assignment_group_id)::int AS open_sections_count,
              COUNT(DISTINCT p.id)::int AS preferences_count,
              COUNT(DISTINCT a.id)::int AS assignments_count,
              COUNT(DISTINCT a.id) FILTER (WHERE COALESCE(a.status, 'tentative') = 'tentative')::int AS tentative_assignments_count,
              COUNT(DISTINCT a.id) FILTER (WHERE COALESCE(a.status, 'tentative') = 'chair_submitted')::int AS chair_submitted_count,
              COUNT(DISTINCT a.id) FILTER (WHERE COALESCE(a.status, 'tentative') = 'dean_approved')::int AS dean_approved_count,
              COUNT(DISTINCT l.id)::int AS decision_logs_count
       FROM scope_sections s
       LEFT JOIN scope_preferences p ON p.term_code = s.term_code AND p.assignment_group_id = s.assignment_group_id
       LEFT JOIN scope_assignments a ON a.term_code = s.term_code AND a.assignment_group_id = s.assignment_group_id AND COALESCE(a.status, 'tentative') <> 'released'
       LEFT JOIN scope_audit_log l ON l.term = s.term_code AND l.section_key = s.assignment_group_id
       WHERE s.term_code = $1 ${scopedWhere}
       GROUP BY s.division
       ORDER BY s.division`,
      params
    );
    const divisions = result.rows.map((row) => {
      const sectionCount = row.open_sections_count || 0;
      const prefCount = row.preferences_count || 0;
      const assignmentCount = row.assignments_count || 0;
      const submittedCount = row.chair_submitted_count || 0;
      const approvedCount = row.dean_approved_count || 0;
      let status = "clean";
      if (sectionCount > 0) status = "loaded";
      if (prefCount > 0) status = "in_progress";
      if (assignmentCount > 0) status = "advanced";
      return {
        ...row,
        sectionCount,
        preferenceCount: prefCount,
        submissionCount: submittedCount,
        tentativeAssignmentCount: row.tentative_assignments_count || 0,
        approvedAssignmentCount: approvedCount,
        chairFinalizedCount: submittedCount,
        deanApprovedCount: approvedCount,
        status,
      };
    });
    res.json({ divisions });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/windows/freeze", requireElevatedRole, requireDivisionScope, async (req, res) => {
  const { termCode = "", division = "", auditReason = "" } = req.body || {};
  if (!termCode || !division) return res.status(400).json({ error: "termCode and division are required." });
  const actor = req.auth?.user || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const windowResult = await client.query(
      `SELECT id, term, division, opened_at, closes_at, status
       FROM scope_staffing_windows
       WHERE term = $1 AND LOWER(division) = LOWER($2)
       ORDER BY opened_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [termCode, division]
    );
    if (!windowResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Preference window not found." });
    }
    await client.query(
      `UPDATE scope_staffing_windows
       SET status = 'closed', closes_at = COALESCE(closes_at, NOW()), updated_at = NOW()
       WHERE id = $1`,
      [windowResult.rows[0].id]
    );
    const frozen = await freezeLatestSubmittedVersions(client, {
      termCode,
      division,
      actor,
      auditReason: auditReason || "Preference window closed; latest submitted versions frozen.",
    });
    await client.query("COMMIT");
    res.json({ success: true, frozenCount: frozen.filter((row) => row.status === "frozen").length, windowTimezone: preferenceWindowTimezone });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message || "Could not freeze preference window." });
  } finally {
    client.release();
  }
});

router.post("/windows/reopen", requireRoles("admin"), requireDivisionScope, async (req, res) => {
  const { termCode = "", division = "", closesAt = null, auditReason = "" } = req.body || {};
  if (!termCode || !division || !String(auditReason || "").trim()) return res.status(400).json({ error: "termCode, division, and auditReason are required." });
  const actor = req.auth?.user || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO scope_staffing_windows (term, division, sender_email, closes_at, status, updated_at)
       VALUES ($1,$2,$3,$4,'reopened',NOW())
       RETURNING id, term, division, opened_at, closes_at, status`,
      [termCode, division, actor.email || "", closesAt || null]
    );
    await client.query(
      `INSERT INTO scope_audit_log (event_type, actor_name, actor_role, division, term, note, source)
       VALUES ('PREFERENCE_WINDOW_REOPENED',$1,$2,$3,$4,$5,'backend')`,
      [actor.full_name || actor.email || "", actor.role || "", division, termCode, auditReason]
    );
    await client.query("COMMIT");
    res.json({ success: true, window: result.rows[0], windowTimezone: preferenceWindowTimezone });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message || "Could not reopen preference window." });
  } finally {
    client.release();
  }
});

router.get("/allocation-analysis", requireElevatedRole, requireDivisionScope, async (req, res) => {
  const {
    termCode = "",
    disciplineCode = "",
    division = "",
    divisions = "",
    oneAssignmentPerPass = "true",
    maxAssignments = "",
    maxLoad = "",
  } = req.query;
  const requestedDivisions = parseScopeList(divisions || division);

  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  if (!isAdmin(req) && !requestedDivisions.length) {
    return res.status(400).json({ error: "division or divisions is required for scoped allocation analysis." });
  }

  try {
    const { analysis, exceptionReasons } = await buildAllocationAnalysisFromDb({ query }, {
      termCode,
      division: requestedDivisions.join("|"),
      divisions: requestedDivisions,
      disciplineCode,
      oneAssignmentPerPass: String(oneAssignmentPerPass).toLowerCase() !== "false" && String(oneAssignmentPerPass) !== "0",
      maxAssignments,
      maxLoad,
    });

    res.json({ analysis, exceptionReasons });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not build allocation analysis." });
  }
});

router.get("/contract-exception-reasons", requireElevatedRole, async (_req, res) => {
  try {
    res.json({ reasons: await getContractExceptionReasons({ query }) });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load contractual exception reasons." });
  }
});

router.get("/decision-explanations", requireElevatedRole, requireDivisionScope, async (req, res) => {
  const { termCode = "", division = "", divisions = "", disciplineCode = "" } = req.query;
  const requestedDivisions = parseScopeList(divisions || division);
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  if (!isAdmin(req) && !requestedDivisions.length) {
    return res.status(400).json({ error: "division or divisions is required for scoped decision explanations." });
  }
  try {
    const explanation = await buildDecisionExplanationFromDb({ query }, {
      termCode,
      divisions: requestedDivisions,
      disciplineCode,
    });
    res.json({ explanation });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not build decision explanations." });
  }
});

router.get("/decision-explanations/export.csv", requireRoles("admin"), async (req, res) => {
  const { termCode = "", division = "", divisions = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const explanation = await buildDecisionExplanationFromDb({ query }, {
      termCode,
      divisions: parseScopeList(divisions || division),
      disciplineCode,
    });
    const rows = decisionExplanationRows(explanation);
    const headers = [
      "term_code",
      "division",
      "assignment_group_id",
      "course",
      "crn",
      "candidate_employee_id",
      "candidate_name",
      "seniority_rank",
      "preference_rank",
      "qualified",
      "available_at_decision",
      "disposition",
      "recommended_employee_id",
      "selected_employee_id",
      "decision_status",
      "exception_reason_code",
      "decided_at",
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sherman-decision-explanations-${termCode}.csv"`);
    res.send(csvFromRows(rows, headers));
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not export decision explanations." });
  }
});

router.get("/decision-explanations/print", requireRoles("admin"), async (req, res) => {
  const { termCode = "", division = "", divisions = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).send("termCode is required.");
  try {
    const explanation = await buildDecisionExplanationFromDb({ query }, {
      termCode,
      divisions: parseScopeList(divisions || division),
      disciplineCode,
    });
    const sections = explanation.sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.section?.primary_subject_course || section.assignment_group_id)} ${escapeHtml(section.section?.primary_crn || "")}</h2>
        <p><strong>Recommendation:</strong> ${escapeHtml(section.original_system_recommendation.faculty_name || section.original_system_recommendation.employee_id || "None")}</p>
        <p><strong>Chair decision:</strong> ${escapeHtml(section.chair_decision?.faculty_name || "No chair decision recorded")} ${section.chair_decision?.exception_reason_code ? `(${escapeHtml(section.chair_decision.exception_reason_code)})` : ""}</p>
        <table>
          <thead><tr><th>Candidate</th><th>Seniority</th><th>Pref</th><th>Qualified</th><th>Available</th><th>Disposition</th></tr></thead>
          <tbody>
            ${section.interested_faculty.map((candidate) => `
              <tr>
                <td>${escapeHtml(candidate.faculty_name || candidate.employee_id)}</td>
                <td>${escapeHtml(candidate.seniority_rank)}</td>
                <td>${escapeHtml(candidate.preference_rank)}</td>
                <td>${escapeHtml(candidate.qualified)}</td>
                <td>${escapeHtml(candidate.available_at_decision)}</td>
                <td>${escapeHtml(candidate.disposition)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `).join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
      <html>
        <head>
          <title>SHERMAN Decision Explanations</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { font-size: 24px; }
            h2 { font-size: 18px; margin-top: 28px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; }
            th { background: #f3f4f6; }
            @media print { body { margin: 12mm; } section { break-inside: avoid; } }
          </style>
        </head>
        <body>
          <h1>SHERMAN Decision Explanations - ${escapeHtml(termCode)}</h1>
          <p>Generated from stored recommendation, decision, and preference snapshots where available.</p>
          ${sections}
        </body>
      </html>`);
  } catch (error) {
    res.status(500).send(escapeHtml(error.message || "Could not render decision explanations."));
  }
});

router.post("/chair-decisions", requireRoles("chair"), requireDivisionScope, async (req, res) => {
  const {
    termCode = "",
    division = "",
    disciplineCode = "",
    assignmentGroupId = "",
    selectedEmployeeId = "",
    exceptionReasonCode = "",
    exceptionExplanation = "",
    expectedRecommendedEmployeeId = "",
    expectedRecommendationSnapshot = null,
  } = req.body || {};
  if (!termCode || !division || !assignmentGroupId || !selectedEmployeeId) {
    return res.status(400).json({ error: "termCode, division, assignmentGroupId, and selectedEmployeeId are required." });
  }

  const actor = req.auth?.user || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedSection = await client.query(
      `SELECT assignment_group_id, division, discipline_code
       FROM scope_sections
       WHERE term_code = $1 AND assignment_group_id = $2 AND division = $3
       FOR UPDATE`,
      [termCode, assignmentGroupId, division]
    );
    if (!lockedSection.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Staffing unit was not found in this division." });
    }

    const existingAssignment = await client.query(
      `SELECT id
       FROM scope_assignments
       WHERE term_code = $1
         AND assignment_group_id = $2
         AND COALESCE(status, 'tentative') NOT IN ('released', 'deleted', 'void', 'returned_for_revision')
       FOR UPDATE`,
      [termCode, assignmentGroupId]
    );
    if (existingAssignment.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This staffing unit already has an active chair decision or assignment." });
    }

    const { analysis, exceptionReasons } = await buildAllocationAnalysisFromDb(client, {
      termCode,
      division,
      divisions: [division],
      disciplineCode: disciplineCode || lockedSection.rows[0].discipline_code || "",
    });
    const decision = validateChairDecision({
      analysis,
      assignmentGroupId,
      selectedEmployeeId,
      exceptionReasonCode,
      exceptionExplanation,
      exceptionReasons,
    });
    if (!decision.ok) {
      await client.query("ROLLBACK");
      return res.status(decision.status || 400).json({ error: decision.error });
    }
    if (expectedRecommendedEmployeeId && expectedRecommendedEmployeeId !== decision.recommendedCandidate.employeeId) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "The recommendation changed before this decision was submitted. Reload the staffing queue and try again.",
        code: "STALE_RECOMMENDATION",
        currentRecommendedEmployeeId: decision.recommendedCandidate.employeeId,
      });
    }
    if (expectedRecommendationSnapshot?.recommendedEmployeeId && expectedRecommendationSnapshot.recommendedEmployeeId !== decision.recommendedCandidate.employeeId) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "The recommendation snapshot is stale. Reload the staffing queue and try again.",
        code: "STALE_RECOMMENDATION",
        currentRecommendedEmployeeId: decision.recommendedCandidate.employeeId,
      });
    }

    const selectedFacultyName = decision.selectedCandidate.facultyName || selectedEmployeeId;
    const reasonCode = decision.exceptionReason?.code || "";
    const justification = decision.exceptionExplanation || "";
    const decisionResult = await client.query(
      `INSERT INTO scope_chair_decisions
        (term_code, division, discipline_code, assignment_group_id, recommended_employee_id, selected_employee_id, selected_faculty_name,
         decision_status, exception_reason_code, exception_explanation, recommendation_snapshot, decision_snapshot,
         decided_by_user_id, decided_by_email, decided_by_name, decided_by_role, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,NOW())
       RETURNING id, decided_at`,
      [
        termCode,
        division,
        disciplineCode || lockedSection.rows[0].discipline_code || "",
        assignmentGroupId,
        decision.recommendedCandidate.employeeId,
        selectedEmployeeId,
        selectedFacultyName,
        decision.decisionStatus,
        reasonCode,
        justification,
        JSON.stringify(decision.recommendationSnapshot),
        JSON.stringify(decision.decisionSnapshot),
        actor.id || null,
        actor.email || "",
        actor.full_name || actor.email || "",
        actor.role || "",
      ]
    );

    const assignmentResult = await client.query(
      `INSERT INTO scope_assignments
        (term_code, discipline_code, assignment_group_id, employee_id, faculty_name, status, actor_name, reason,
         reason_code, justification, recommendation_snapshot, decision_snapshot, updated_at)
       VALUES ($1,$2,$3,$4,$5,'tentative',$6,$7,$8,$9,$10::jsonb,$11::jsonb,NOW())
       RETURNING id`,
      [
        termCode,
        disciplineCode || lockedSection.rows[0].discipline_code || "",
        assignmentGroupId,
        selectedEmployeeId,
        selectedFacultyName,
        actor.full_name || actor.email || "",
        justification,
        reasonCode,
        justification,
        JSON.stringify(decision.recommendationSnapshot),
        JSON.stringify(decision.decisionSnapshot),
      ]
    );

    await writeAuditEvent(client, req, {
      eventType: "CHAIR_DECISION_RECORDED",
      division,
      term: termCode,
      sectionKey: assignmentGroupId,
      instructorName: selectedFacultyName,
      oldValue: decision.recommendedCandidate.employeeId,
      newValue: selectedEmployeeId,
      reasonCode,
      explanation: justification,
      note: decision.isRecommended
        ? `Selected recommended candidate ${selectedFacultyName}.`
        : `Selected ${selectedFacultyName} with exception ${reasonCode}.`,
    });

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      decision: {
        id: decisionResult.rows[0]?.id,
        decided_at: decisionResult.rows[0]?.decided_at,
        assignment_id: assignmentResult.rows[0]?.id,
        status: decision.decisionStatus,
        recommended_employee_id: decision.recommendedCandidate.employeeId,
        selected_employee_id: selectedEmployeeId,
        recommendation_snapshot: decision.recommendationSnapshot,
        decision_snapshot: decision.decisionSnapshot,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ error: "This staffing unit already has an active chair decision or assignment." });
    }
    res.status(500).json({ error: error.message || "Could not record chair decision." });
  } finally {
    client.release();
  }
});

router.get("/chair-workflow", requireElevatedRole, requireScopedRead, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let where = `WHERE s.term_code = $1 AND COALESCE((s.raw_row->>'staff_eligible')::boolean, true) = true`;
    if (disciplineCode) {
      params.push(disciplineCode);
      where += ` AND s.discipline_code = $${params.length}`;
    }
    const divisionList = scopeFilterForReq(req, String(divisions || "").split("|"));
    if (!isAdmin(req) && !divisionList.length) return res.status(403).json({ error: "No permitted divisions are available for this request." });
    if (divisionList.length) {
      params.push(divisionList);
      where += ` AND LOWER(s.division) = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus,
              s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings,
              pt.employee_id, CONCAT_WS(' ', pt.first_name, pt.last_name) AS faculty_name,
              COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '') AS seniority_rank,
              pref.preference_rank,
              section_pref.section_preference_rank,
              COALESCE(av.availability_days, '[]'::jsonb) AS availability_days,
              COALESCE(av.availability_time_blocks, '[]'::jsonb) AS availability_time_blocks
       FROM scope_sections s
       JOIN scope_pt_faculty pt
         ON pt.division = s.division
        AND (
          LOWER(REGEXP_REPLACE(COALESCE(pt.discipline, ''), '[^a-zA-Z0-9]', '', 'g')) IN (
            LOWER(REGEXP_REPLACE(COALESCE(s.discipline_code, ''), '[^a-zA-Z0-9]', '', 'g')),
            LOWER(REGEXP_REPLACE(COALESCE(s.subject_code, ''), '[^a-zA-Z0-9]', '', 'g')),
            LOWER(REGEXP_REPLACE(COALESCE(s.division, ''), '[^a-zA-Z0-9]', '', 'g'))
          )
          OR LOWER(REGEXP_REPLACE(COALESCE(s.discipline_code, ''), '[^a-zA-Z0-9]', '', 'g')) = ANY(
            REGEXP_SPLIT_TO_ARRAY(LOWER(REGEXP_REPLACE(COALESCE(pt.qualified_disciplines, ''), '[^a-zA-Z0-9|]', '', 'g')), '\\|')
          )
          OR LOWER(REGEXP_REPLACE(COALESCE(s.subject_code, ''), '[^a-zA-Z0-9]', '', 'g')) = ANY(
            REGEXP_SPLIT_TO_ARRAY(LOWER(REGEXP_REPLACE(COALESCE(pt.qualified_disciplines, ''), '[^a-zA-Z0-9|]', '', 'g')), '\\|')
          )
          OR LOWER(REGEXP_REPLACE(COALESCE(s.division, ''), '[^a-zA-Z0-9]', '', 'g')) = ANY(
            REGEXP_SPLIT_TO_ARRAY(LOWER(REGEXP_REPLACE(COALESCE(pt.qualified_disciplines, ''), '[^a-zA-Z0-9|]', '', 'g')), '\\|')
          )
        )
        AND COALESCE(pt.active_status, 'active') = 'active'
       LEFT JOIN LATERAL (
         SELECT MIN(p.preference_rank) AS preference_rank
         FROM scope_preferences p
         WHERE p.term_code = s.term_code
           AND p.assignment_group_id = s.assignment_group_id
           AND (p.employee_id = pt.employee_id OR p.faculty_id = pt.employee_id)
       ) pref ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(p.preference_rank) AS section_preference_rank
         FROM scope_preferences p
         WHERE p.term_code = s.term_code
           AND p.assignment_group_id = s.assignment_group_id
       ) section_pref ON TRUE
       LEFT JOIN scope_faculty_availability av
         ON av.term_code = s.term_code
        AND (av.faculty_id = pt.employee_id OR av.employee_id = pt.employee_id)
       ${where}
       ORDER BY section_pref.section_preference_rank NULLS LAST, s.primary_subject_course, s.primary_crn,
                COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '999999') NULLS LAST,
                pref.preference_rank NULLS LAST, faculty_name`,
      params
    );
    res.json({ rows: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/assignments", requireElevatedRole, requireScopedRead, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let scopedFilter = "";
    if (disciplineCode) {
      params.push(disciplineCode);
      scopedFilter += ` AND COALESCE(NULLIF(a.discipline_code, ''), s.discipline_code) = $${params.length}`;
    }
    const divisionList = scopeFilterForReq(req, String(divisions || "").split("|"));
    if (!isAdmin(req) && !divisionList.length) return res.status(403).json({ error: "No permitted divisions are available for this request." });
    if (divisionList.length) {
      params.push(divisionList);
      scopedFilter += ` AND LOWER(s.division) = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT a.id, a.assignment_group_id, a.employee_id, a.faculty_name, a.status, a.reason, a.reason_code, a.justification,
              a.recommendation_snapshot, a.decision_snapshot, a.version, d.decision_status, d.exception_reason_code, d.exception_explanation, d.decided_at,
              a.created_at,
              COALESCE(NULLIF(a.discipline_code, ''), s.discipline_code) AS discipline_code,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_assignments a
       LEFT JOIN scope_sections s ON s.term_code = a.term_code AND s.assignment_group_id = a.assignment_group_id
       LEFT JOIN LATERAL (
         SELECT decision_status, exception_reason_code, exception_explanation, decided_at
         FROM scope_chair_decisions d
         WHERE d.term_code = a.term_code AND d.assignment_group_id = a.assignment_group_id
         ORDER BY d.decided_at DESC, d.id DESC
         LIMIT 1
       ) d ON TRUE
       WHERE a.term_code = $1 AND COALESCE(a.status, 'tentative') <> 'released' ${scopedFilter}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json({ assignments: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })) });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

async function advanceAssignmentStatus({ client, req, termCode, fromStatuses, toStatus, divisions = [], disciplineCode = "", actorName = "", actorRole = "", eventType = "", notePrefix = "" }) {
  const params = [termCode, fromStatuses, toStatus, actorName || ""];
  let scopedFilter = "";
  if (disciplineCode) {
    params.push(disciplineCode);
    scopedFilter += ` AND COALESCE(NULLIF(a.discipline_code, ''), s.discipline_code) = $${params.length}`;
  }
  if (divisions.length) {
    params.push(divisions);
    scopedFilter += ` AND LOWER(s.division) = ANY($${params.length}::text[])`;
  }
  const result = await client.query(
    `UPDATE scope_assignments a
     SET status = $3, actor_name = $4, version = version + 1, updated_at = NOW()
     FROM scope_sections s
     WHERE a.term_code = $1
       AND s.term_code = a.term_code
       AND s.assignment_group_id = a.assignment_group_id
       AND COALESCE(a.status, 'tentative') = ANY($2::text[])
       ${scopedFilter}
     RETURNING a.id, a.assignment_group_id, a.employee_id, a.faculty_name, a.status, a.version,
               COALESCE(NULLIF(a.discipline_code, ''), s.discipline_code) AS discipline_code,
               s.division, s.primary_subject_course, s.primary_crn`,
    params
  );
  for (const row of result.rows) {
    await writeAuditEvent(client, req, {
      eventType,
      division: row.division || "",
      term: termCode,
      sectionKey: row.assignment_group_id || "",
      instructorName: row.faculty_name || row.employee_id || "",
      oldValue: fromStatuses.join("|"),
      newValue: toStatus,
      note: `${notePrefix} ${row.primary_subject_course || row.assignment_group_id}${row.primary_crn ? ` (${row.primary_crn})` : ""} for ${row.faculty_name || row.employee_id}.`,
    });
  }
  return result.rows;
}

router.post("/assignments/submit", requireRoles("chair"), requireDivisionScope, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = [] } = req.body || {};
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  const divisionList = Array.isArray(divisions) ? divisions.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await advanceAssignmentStatus({
      client,
      req,
      termCode,
      fromStatuses: ["tentative"],
      toStatus: "chair_submitted",
      divisions: divisionList,
      disciplineCode: String(disciplineCode || "").trim(),
      actorName: req.auth?.user?.full_name || req.auth?.user?.email || "",
      actorRole: "chair",
      eventType: "CHAIR_SUBMITTED",
      notePrefix: "Submitted",
    });
    await client.query("COMMIT");
    res.json({ success: true, submittedCount: rows.length, message: `${rows.length} assignment(s) submitted to dean review.` });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.post("/assignments/approve", requireRoles("dean"), requireDivisionScope, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = [] } = req.body || {};
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  const divisionList = Array.isArray(divisions) ? divisions.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await advanceAssignmentStatus({
      client,
      req,
      termCode,
      fromStatuses: ["chair_submitted"],
      toStatus: "dean_approved",
      divisions: divisionList,
      disciplineCode: String(disciplineCode || "").trim(),
      actorName: req.auth?.user?.full_name || req.auth?.user?.email || "",
      actorRole: "dean",
      eventType: "DEAN_APPROVED",
      notePrefix: "Approved",
    });
    await client.query("COMMIT");
    res.json({ success: true, approvedCount: rows.length, message: `${rows.length} assignment(s) approved.` });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.post("/assignments/return", requireRoles("dean"), requireDivisionScope, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = [], reason = "" } = req.body || {};
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  if (!String(reason || "").trim()) return res.status(400).json({ error: "A revision reason is required." });
  const divisionList = Array.isArray(divisions) ? divisions.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await advanceAssignmentStatus({
      client,
      req,
      termCode,
      fromStatuses: ["chair_submitted"],
      toStatus: "returned_for_revision",
      divisions: divisionList,
      disciplineCode: String(disciplineCode || "").trim(),
      actorName: req.auth?.user?.full_name || req.auth?.user?.email || "",
      actorRole: "dean",
      eventType: "DEAN_RETURNED_FOR_REVISION",
      notePrefix: `Returned for revision: ${String(reason).trim()}.`,
    });
    await client.query("COMMIT");
    res.json({ success: true, returnedCount: rows.length, message: `${rows.length} assignment(s) returned for chair revision.` });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.post("/assignments", requireElevatedRole, async (req, res) => {
  const { termCode = "", disciplineCode = "", assignmentGroupId = "", employeeId = "", reason = "", expectedAssignmentVersion = null } = req.body || {};
  if (!termCode || !assignmentGroupId || !employeeId) return res.status(400).json({ error: "termCode, assignmentGroupId, and employeeId are required." });
  const actor = req.auth?.user || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const section = await client.query(`SELECT division FROM scope_sections WHERE term_code = $1 AND assignment_group_id = $2 FOR UPDATE`, [termCode, assignmentGroupId]);
    if (!section.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Section not found." });
    }
    const scoped = scopeFilterForReq(req, [section.rows[0].division]);
    if (!isAdmin(req) && !scoped.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This action is outside your assigned division scope." });
    }
    const existing = await client.query(
      `SELECT id, version
       FROM scope_assignments
       WHERE term_code = $1 AND assignment_group_id = $2 AND COALESCE(status, 'tentative') NOT IN ('released', 'deleted', 'void', 'returned_for_revision')
       FOR UPDATE`,
      [termCode, assignmentGroupId]
    );
    if (existing.rows.length && Number(expectedAssignmentVersion) !== Number(existing.rows[0].version)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Assignment changed before this request was submitted. Reload and try again.", code: "STALE_ASSIGNMENT", currentVersion: existing.rows[0].version });
    }
    const faculty = await client.query(`SELECT CONCAT_WS(' ', first_name, last_name) AS faculty_name FROM scope_pt_faculty WHERE employee_id = $1 ORDER BY COALESCE(active_status, 'active') = 'active' DESC LIMIT 1`, [employeeId]);
    const facultyName = faculty.rows[0]?.faculty_name || employeeId;
    await client.query(`DELETE FROM scope_assignments WHERE term_code = $1 AND assignment_group_id = $2`, [termCode, assignmentGroupId]);
    const result = await client.query(
      `INSERT INTO scope_assignments
        (term_code, discipline_code, assignment_group_id, employee_id, faculty_name, status, actor_name, reason, updated_at)
       VALUES ($1,$2,$3,$4,$5,'tentative',$6,$7,NOW())
       RETURNING id, version`,
      [termCode, disciplineCode, assignmentGroupId, employeeId, facultyName, actor.full_name || actor.email || "", reason]
    );
    await writeAuditEvent(client, req, {
      eventType: "ASSIGNMENT_SAVED",
      division: section.rows[0].division,
      term: termCode,
      sectionKey: assignmentGroupId,
      instructorName: facultyName,
      oldValue: existing.rows[0]?.id || null,
      newValue: employeeId,
      explanation: reason,
      note: "Tentative assignment saved.",
    });
    await client.query("COMMIT");
    res.json({ success: true, id: result.rows[0]?.id, version: result.rows[0]?.version, message: "Tentative assignment saved." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.delete("/assignments/:id", requireElevatedRole, async (req, res) => {
  const expectedVersion = req.query?.expectedVersion || req.body?.expectedVersion;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT a.*, s.division
       FROM scope_assignments a
       LEFT JOIN scope_sections s ON s.term_code = a.term_code AND s.assignment_group_id = a.assignment_group_id
       WHERE a.id = $1
       LIMIT 1
       FOR UPDATE OF a`,
      [req.params.id]
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assignment not found." });
    }
    const scoped = scopeFilterForReq(req, [existing.rows[0].division]);
    if (!isAdmin(req) && !scoped.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This action is outside your assigned division scope." });
    }
    if (expectedVersion && Number(expectedVersion) !== Number(existing.rows[0].version)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Assignment changed before this request was submitted. Reload and try again.", code: "STALE_ASSIGNMENT", currentVersion: existing.rows[0].version });
    }
    const updated = await client.query(
      `UPDATE scope_assignments
       SET status = 'released', version = version + 1, updated_at = NOW(), actor_name = $2
       WHERE id = $1
       RETURNING version`,
      [req.params.id, req.auth?.user?.full_name || req.auth?.user?.email || ""]
    );
    await writeAuditEvent(client, req, {
      eventType: "ASSIGNMENT_RELEASED",
      division: existing.rows[0].division,
      term: existing.rows[0].term_code,
      sectionKey: existing.rows[0].assignment_group_id,
      instructorName: existing.rows[0].faculty_name || existing.rows[0].employee_id,
      oldValue: existing.rows[0].status,
      newValue: "released",
      note: "Tentative assignment removed.",
    });
    await client.query("COMMIT");
    res.json({ success: true, version: updated.rows[0]?.version, message: "Tentative assignment removed." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.put("/assignments/:id/reassign", requireElevatedRole, async (req, res) => {
  const { employeeId = "", reason = "", expectedVersion = null } = req.body || {};
  if (!employeeId || !reason.trim()) return res.status(400).json({ error: "employeeId and reason are required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT a.*, s.division
       FROM scope_assignments a
       LEFT JOIN scope_sections s ON s.term_code = a.term_code AND s.assignment_group_id = a.assignment_group_id
       WHERE a.id = $1
       LIMIT 1
       FOR UPDATE OF a`,
      [req.params.id]
    );
    if (!existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assignment not found." });
    }
    const scoped = scopeFilterForReq(req, [existing.rows[0].division]);
    if (!isAdmin(req) && !scoped.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This action is outside your assigned division scope." });
    }
    if (expectedVersion && Number(expectedVersion) !== Number(existing.rows[0].version)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Assignment changed before this request was submitted. Reload and try again.", code: "STALE_ASSIGNMENT", currentVersion: existing.rows[0].version });
    }
    const faculty = await client.query(`SELECT CONCAT_WS(' ', first_name, last_name) AS faculty_name FROM scope_pt_faculty WHERE employee_id = $1 LIMIT 1`, [employeeId]);
    const facultyName = faculty.rows[0]?.faculty_name || employeeId;
    const updated = await client.query(`UPDATE scope_assignments SET employee_id = $1, faculty_name = $2, actor_name = $3, reason = $4, version = version + 1, updated_at = NOW() WHERE id = $5 RETURNING version`, [employeeId, facultyName, req.auth?.user?.full_name || req.auth?.user?.email || "", reason, req.params.id]);
    await writeAuditEvent(client, req, {
      eventType: "ASSIGNMENT_REASSIGNED",
      division: existing.rows[0].division,
      term: existing.rows[0].term_code,
      sectionKey: existing.rows[0].assignment_group_id,
      instructorName: facultyName,
      oldValue: existing.rows[0].employee_id,
      newValue: employeeId,
      explanation: reason,
      note: "Tentative assignment reassigned.",
    });
    await client.query("COMMIT");
    res.json({ success: true, version: updated.rows[0]?.version, message: "Tentative assignment reassigned." });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.get("/preferences", enforceFacultySelf, requirePreferenceOwnerOrElevated, async (req, res) => {
  const { termCode = "", facultyId = "" } = req.query;
  if (!termCode || !facultyId) return res.status(400).json({ error: "termCode and facultyId are required." });
  try {
    if (String(req.auth?.user?.role || "").toLowerCase() === "faculty") {
      const facultyResult = await query(
        `SELECT division
         FROM scope_pt_faculty
         WHERE employee_id = $1
           AND COALESCE(active_status, 'active') = 'active'
         ORDER BY COALESCE(active_status, 'active') = 'active' DESC
         LIMIT 1`,
        [req.auth.user.employee_id || facultyId]
      );
      const facultyRosterRow = facultyResult.rows[0] || null;
      if (!facultyRosterRow) {
        return res.status(409).json({
          error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID to the roster.",
          preferences: [],
          availability: { days: [], timeBlocks: [] },
        });
      }
      const windowResult = await query(
        `SELECT id, term, division, opened_at, closes_at, status
         FROM scope_staffing_windows
         WHERE term = $1
           AND LOWER(division) = LOWER($2)
         ORDER BY opened_at DESC, id DESC
         LIMIT 1`,
        [termCode, facultyRosterRow.division || ""]
      );
      const state = windowState(windowResult.rows[0] || null, new Date());
      if (!state.open) {
        return res.json({
          preferences: [],
          availability: { days: [], timeBlocks: [] },
          window: state,
          message: state.missing
            ? "The preference window has not been opened for your division yet."
            : "The preference window is not open for your division.",
        });
      }
    }

    const [result, availabilityResult] = await Promise.all([
      query(
      `SELECT p.assignment_group_id, p.preference_rank, p.faculty_id, p.employee_id, p.faculty_name,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_preferences p
       LEFT JOIN scope_sections s ON s.term_code = p.term_code AND s.assignment_group_id = p.assignment_group_id
       WHERE p.term_code = $1 AND p.faculty_id = $2
       ORDER BY p.preference_rank ASC`,
      [termCode, facultyId]
      ),
      query(
        `SELECT availability_days, availability_time_blocks
         FROM scope_faculty_availability
         WHERE term_code = $1 AND faculty_id = $2
         LIMIT 1`,
        [termCode, facultyId]
      ),
    ]);
    const availability = availabilityResult.rows[0] || {};
    res.json({
      preferences: result.rows.map((r) => ({ ...r, meetings: r.meetings || [] })),
      availability: {
        days: Array.isArray(availability.availability_days) ? availability.availability_days : [],
        timeBlocks: Array.isArray(availability.availability_time_blocks) ? availability.availability_time_blocks : [],
      },
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/preferences", enforceFacultySelf, requirePreferenceOwnerOrElevated, async (req, res) => {
  const { termCode = "", facultyId = "", employeeId = "", facultyName = "", preferences = [], availability = {}, action = "submit", auditReason = "", source = "web" } = req.body || {};
  if (!termCode || !facultyId) return res.status(400).json({ error: "termCode and facultyId are required." });
  if (!Array.isArray(preferences)) return res.status(400).json({ error: "preferences must be an array." });
  const rankErrors = validatePreferenceRanks(preferences);
  if (rankErrors.length) return res.status(400).json({ error: "Preference ranks are invalid.", details: rankErrors });
  const availabilityDays = Array.isArray(availability.days) ? availability.days.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const availabilityTimeBlocks = Array.isArray(availability.timeBlocks) ? availability.timeBlocks.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const actor = req.auth?.user || {};
  const normalizedAction = String(action || "submit").trim().toLowerCase();
  const targetStatus = normalizedAction === "draft" || normalizedAction === "save_draft"
    ? preferenceSubmissionStatuses.DRAFT
    : normalizedAction === "admin_correct" || normalizedAction === "reopen_correct"
      ? preferenceSubmissionStatuses.CORRECTED
      : preferenceSubmissionStatuses.SUBMITTED;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const facultyResult = await client.query(
      `SELECT division, discipline
       FROM scope_pt_faculty
       WHERE employee_id = $1
         AND COALESCE(active_status, 'active') = 'active'
       ORDER BY COALESCE(active_status, 'active') = 'active' DESC
       LIMIT 1`,
      [employeeId || facultyId]
    );
    const facultyRosterRow = facultyResult.rows[0] || null;
    if (!facultyRosterRow) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID to the roster.",
      });
    }
    const windowResult = await client.query(
      `SELECT id, term, division, opened_at, closes_at, status
       FROM scope_staffing_windows
       WHERE term = $1
         AND LOWER(division) = LOWER($2)
       ORDER BY opened_at DESC, id DESC
       LIMIT 1
       FOR UPDATE`,
      [termCode, facultyRosterRow.division || ""]
    );
    const activeWindow = windowResult.rows[0] || null;
    const policy = canSavePreferenceVersion({
      action: normalizedAction,
      windowRow: activeWindow,
      now: new Date(),
      actorRole: actor.role || "faculty",
    });
    if (!policy.ok) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: policy.error, window: policy.state });
    }
    if (policy.requiresAuditReason && !String(auditReason || "").trim()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "An audit reason is required for administrator correction after closure." });
    }
    const submissionResult = await createPreferenceSubmissionVersion(client, {
      termCode,
      facultyId,
      employeeId,
      facultyName,
      preferences,
      availabilityDays,
      availabilityTimeBlocks,
      status: targetStatus,
      source,
      auditReason,
      actor,
    });
    const submissionId = submissionResult.id;
    await client.query(`DELETE FROM scope_preferences WHERE term_code = $1 AND faculty_id = $2`, [termCode, facultyId]);
    for (const pref of preferences) {
      await client.query(
        `INSERT INTO scope_preferences
          (term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [termCode, facultyId, employeeId, facultyName, pref.assignment_group_id, pref.discipline_code || "", pref.preference_rank || 1]
      );
    }
    await client.query(
      `INSERT INTO scope_faculty_availability
        (term_code, faculty_id, employee_id, faculty_name, availability_days, availability_time_blocks, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,NOW())
       ON CONFLICT (term_code, faculty_id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id,
         faculty_name = EXCLUDED.faculty_name,
         availability_days = EXCLUDED.availability_days,
         availability_time_blocks = EXCLUDED.availability_time_blocks,
         updated_at = NOW()`,
      [termCode, facultyId, employeeId, facultyName, JSON.stringify(availabilityDays), JSON.stringify(availabilityTimeBlocks)]
    );
    await client.query(
      `INSERT INTO scope_audit_log (event_type, actor_name, actor_role, division, term, instructor_name, new_value, note, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'backend')`,
      [
        targetStatus === preferenceSubmissionStatuses.DRAFT ? "PREFERENCE_DRAFT_SAVED" : "PREFERENCE_VERSION_SUBMITTED",
        actor.full_name || actor.email || "",
        actor.role || "",
        facultyRosterRow.division || "",
        termCode,
        facultyName,
        String(submissionId || ""),
        targetStatus === preferenceSubmissionStatuses.CORRECTED ? `Admin correction: ${auditReason}` : `Preference ${targetStatus} version ${submissionResult.version_number}.`,
      ]
    );
    await client.query("COMMIT");
    res.json({
      success: true,
      savedCount: preferences.length,
      submissionId,
      versionNumber: submissionResult.version_number,
      status: targetStatus,
      submittedAt: submissionResult.submitted_at,
      windowTimezone: preferenceWindowTimezone,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});


router.delete("/preferences", requireElevatedRole, requireDivisionScope, async (req, res) => {
  const { termCode = "", division = "" } = req.query;
  if (!termCode || !division) return res.status(400).json({ error: "termCode and division are required." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sectionResult = await client.query(
      `SELECT assignment_group_id
       FROM scope_sections
       WHERE term_code = $1 AND division = $2`,
      [termCode, division]
    );
    const sectionIds = sectionResult.rows.map((r) => r.assignment_group_id);
    if (!sectionIds.length) {
      await client.query("COMMIT");
      return res.json({ success: true, deletedCount: 0 });
    }
    const deleteResult = await client.query(
      `DELETE FROM scope_preferences
       WHERE term_code = $1 AND assignment_group_id = ANY($2::text[])`,
      [termCode, sectionIds]
    );
    await client.query("COMMIT");
    res.json({ success: true, deletedCount: deleteResult.rowCount || 0 });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message });
  } finally { client.release(); }
});

router.get("/preferences/export", requireElevatedRole, requireScopedRead, async (req, res) => {
  const { termCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    const scopedDivisions = scopeFilterForReq(req, String(divisions || "").split("|"));
    let scopedFilter = "";
    if (scopedDivisions.length) {
      params.push(scopedDivisions);
      scopedFilter = `AND LOWER(s.division) = ANY($${params.length}::text[])`;
    }
    const result = await query(
      `SELECT p.term_code, p.faculty_id, p.employee_id, p.faculty_name, p.assignment_group_id, p.discipline_code, p.preference_rank,
              s.primary_subject_course, s.primary_crn, s.title
       FROM scope_preferences p
       LEFT JOIN scope_sections s ON s.term_code = p.term_code AND s.assignment_group_id = p.assignment_group_id
       WHERE p.term_code = $1 ${scopedFilter}
       ORDER BY p.faculty_name, p.preference_rank`,
      params
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(Papa.unparse(result.rows));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get("/decision-logs", requireElevatedRole, requireScopedRead, async (req, res) => {
  const { termCode = "", disciplineCode = "", divisions = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  try {
    const params = [termCode];
    let scopedClause = "";
    if (disciplineCode) {
      params.push(disciplineCode);
      scopedClause += ` AND (
        note ILIKE '%' || $${params.length} || '%'
        OR section_key IN (
          SELECT assignment_group_id FROM scope_sections
          WHERE term_code = $1 AND discipline_code = $${params.length}
        )
      )`;
    }
    const divisionList = scopeFilterForReq(req, String(divisions || "").split("|"));
    if (!isAdmin(req) && !divisionList.length) return res.status(403).json({ error: "No permitted divisions are available for this request." });
    if (divisionList.length) {
      params.push(divisionList);
      scopedClause += ` AND (
        LOWER(division) = ANY($${params.length}::text[])
        OR section_key IN (
          SELECT assignment_group_id FROM scope_sections
          WHERE term_code = $1 AND LOWER(division) = ANY($${params.length}::text[])
        )
      )`;
    }
    const result = await query(`SELECT id, actor_name, event_type, COALESCE(section_key, '') AS section_key, COALESCE(note, '') AS detail, created_at FROM scope_audit_log WHERE term = $1 ${scopedClause} ORDER BY created_at DESC`, params);
    const withDiscipline = await Promise.all(result.rows.map(async (row) => {
      if (!row.section_key) return { ...row, discipline_code: "" };
      const section = await query(`SELECT discipline_code FROM scope_sections WHERE term_code = $1 AND assignment_group_id = $2 LIMIT 1`, [termCode, row.section_key]);
      return { ...row, discipline_code: section.rows[0]?.discipline_code || "" };
    }));
    res.json({ logs: withDiscipline });
  } catch (error) { res.status(500).json({ error: error.message }); }
});


router.post("/preferences/wipe", requireElevatedRole, async (req,res)=>{
 const {termCode,division}=req.body||{};
 if(!termCode||!division) return res.status(400).json({error:"termCode and division required"});
 const scoped = scopeFilterForReq(req, [division]);
 if (!isAdmin(req) && !scoped.length) return res.status(403).json({ error: "This action is outside your assigned division scope." });
 try{
   const result=await query(
     `DELETE FROM scope_preferences
      WHERE term_code=$1 AND assignment_group_id IN (
        SELECT assignment_group_id FROM scope_sections
        WHERE term_code=$1 AND division=$2
      )`,[termCode,division]);
   await query(`INSERT INTO scope_audit_log (term,event_type,note)
                VALUES ($1,'PREFERENCE_WIPE',$2)`,
                [termCode,`Wiped ${division}`]);
   res.json({ok:true,deleted:result.rowCount});
 }catch(e){res.status(500).json({error:e.message});}
});

router.post("/dissemination/send", requireElevatedRole, requireDivisionScope, async (req, res) => {
  const {
    termCode = "",
    division = "",
    senderEmail = "",
    subject = "",
    body = "",
    closesAt = null,
  } = req.body || {};

  if (!termCode || !division || !senderEmail || !subject || !body) {
    return res.status(400).json({ error: "termCode, division, senderEmail, subject, and body are required." });
  }

  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const recipientResult = await client.query(
      `SELECT DISTINCT email, CONCAT_WS(' ', first_name, last_name) AS full_name
       FROM scope_pt_faculty
       WHERE division = $1
         AND COALESCE(active_status, 'active') = 'active'
         AND COALESCE(email, '') <> ''
       ORDER BY email`,
      [division]
    );
    const recipients = recipientResult.rows.map((row) => row.email).filter(Boolean);
    if (!recipients.length) return res.status(400).json({ error: "No active recipients with email were found for this division." });

    const emailResult = await sendDisseminationEmail({ recipients, subject, body });

    await client.query("BEGIN");
    transactionStarted = true;
    const windowResult = await client.query(
      `INSERT INTO scope_staffing_windows (term, division, sender_email, closes_at, status, updated_at)
       VALUES ($1, $2, $3, $4, 'open', NOW())
       RETURNING id, term, division, sender_email, opened_at, closes_at, status`,
      [termCode, division, senderEmail, closesAt || null]
    );
    await client.query(
      `INSERT INTO scope_audit_log (event_type, actor_name, actor_role, division, term, note, source)
       VALUES ('DISSEMINATION_SENT', $1, $2, $3, $4, $5, 'backend')`,
      [
        req.auth?.user?.full_name || req.auth?.user?.email || req.auth?.authType || "",
        req.auth?.user?.role || req.auth?.role || "",
        division,
        termCode,
        `Sent staffing window email to ${recipients.length} recipient(s). Subject: ${subject}`,
      ]
    );
    await client.query("COMMIT");

    res.json({
      success: true,
      recipientCount: recipients.length,
      email: emailResult,
      window: windowResult.rows[0],
    });
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    res.status(500).json({ error: error.message || "Could not send dissemination email." });
  } finally {
    client.release();
  }
});
export default router;

