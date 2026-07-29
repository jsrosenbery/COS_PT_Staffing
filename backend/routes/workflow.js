import express from "express";
import multer from "multer";
import Papa from "papaparse";
import { pool, query } from "../db.js";
import { writeAuditEvent } from "../audit.js";
import { analyzeAllocation } from "../domain/allocationAnalysis.js";
import { defaultContractExceptionReasons, validateChairDecision } from "../domain/chairDecision.js";
import { buildDecisionExplanation, decisionExplanationRows } from "../domain/decisionExplanation.js";
import { canSavePreferenceVersion, preferenceSubmissionStatuses, preferenceWindowTimezone, validatePreferenceRanks, windowState } from "../domain/preferenceSubmissionPolicy.js";
import { enforceFacultySelf, isAdmin, requireDivisionScope, requireElevatedRole, requirePreferenceOwnerOrElevated, requireRoles, requireScopedRead, scopeFilterForReq, splitScope } from "../permissions.js";
import { sendDisseminationEmail } from "../emailService.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024) },
});

function normalize(value) {
  return String(value ?? "").trim();
}

function jsonObjectParam(value) {
  try {
    const parsed = JSON.parse(JSON.stringify(value ?? {}));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function jsonObjectTextParam(value) {
  return JSON.stringify(jsonObjectParam(value));
}

function normUpper(value) {
  return normalize(value).toUpperCase();
}

function compactKey(value) {
  return normUpper(value).replace(/[^A-Z0-9]/g, "");
}

function personNameTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function compatiblePersonName(left, right) {
  const leftTokens = Array.from(new Set(personNameTokens(left)));
  const rightTokens = Array.from(new Set(personNameTokens(right)));
  if (!leftTokens.length || !rightTokens.length) return false;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const shared = leftTokens.filter((token) => rightSet.has(token));
  if (shared.length >= 2) return true;
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longerSet = leftTokens.length <= rightTokens.length ? rightSet : leftSet;
  return shorter.length >= 2 && shorter.every((token) => longerSet.has(token));
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

function addSectionAliasKeys(keys, ...values) {
  for (const value of values) {
    const textValue = normalize(value);
    const compact = compactKey(textValue);
    if (compact) keys.add(`key:${compact}`);
    const digitRuns = textValue.match(/\d{4,}/g) || [];
    for (const run of digitRuns) {
      keys.add(`crn:${run}`);
      if (run.length > 5) keys.add(`crn:${run.slice(-5)}`);
    }
  }
}

function sectionAliasKeys(row = {}) {
  const raw = row.raw_row && typeof row.raw_row === "object" ? row.raw_row : {};
  const keys = new Set();
  addSectionAliasKeys(
    keys,
    row.assignment_group_id,
    row.primary_crn,
    row.primary_subject_course,
    [row.primary_subject_course, row.primary_crn].filter(Boolean).join(" "),
    [row.subject_code, row.course_number, row.primary_crn].filter(Boolean).join(" "),
    raw.assignment_group_id,
    raw.primary_crn,
    raw.CRN,
    raw.crn,
    raw.Subject_Course,
    raw.SUBJECT_COURSE,
    raw["Subject Course"],
    raw.REFERENCE_NUMBER,
    raw["Reference Number"]
  );
  return keys;
}

function preferenceAliasKeys(row = {}) {
  const snapshot = row.item_snapshot && typeof row.item_snapshot === "object" ? row.item_snapshot : {};
  const keys = new Set();
  addSectionAliasKeys(
    keys,
    row.assignment_group_id,
    snapshot.assignment_group_id,
    snapshot.assignmentGroupId,
    snapshot.primary_crn,
    snapshot.primaryCrn,
    snapshot.crn,
    snapshot.CRN,
    snapshot.primary_subject_course,
    snapshot.primarySubjectCourse,
    [snapshot.primary_subject_course || snapshot.primarySubjectCourse, snapshot.primary_crn || snapshot.primaryCrn || snapshot.crn].filter(Boolean).join(" "),
    snapshot.course,
    snapshot.subject_course,
    snapshot.Subject_Course
  );
  return keys;
}

function remapPreferencesToCurrentSections(preferences = [], sections = []) {
  const sectionByAlias = new Map();
  for (const section of sections) {
    for (const key of sectionAliasKeys(section)) {
      if (!sectionByAlias.has(key)) sectionByAlias.set(key, section);
    }
  }
  return preferences.map((preference) => {
    const exact = sections.find((section) => section.assignment_group_id === preference.assignment_group_id);
    if (exact) return preference;
    for (const key of preferenceAliasKeys(preference)) {
      const section = sectionByAlias.get(key);
      if (section) {
        return {
          ...preference,
          original_assignment_group_id: preference.assignment_group_id,
          assignment_group_id: section.assignment_group_id,
          discipline_code: preference.discipline_code || section.discipline_code || "",
        };
      }
    }
    return preference;
  }).filter((preference) => sections.some((section) => section.assignment_group_id === preference.assignment_group_id));
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

async function loadPreferenceRowsForSections(db, { termCode, sections = [], allowLatestSubmittedFallback = false }) {
  const scopedDivisions = Array.from(new Set(sections.map((row) => row.division).filter(Boolean)));
  const empty = { rows: [], source: "none", frozenCount: 0, latestSubmittedCount: 0 };
  if (!termCode || !sections.length || !scopedDivisions.length) return empty;

  const preferenceResult = await db.query(
    `SELECT i.term_code, i.faculty_id, i.employee_id, i.faculty_name, i.assignment_group_id, i.discipline_code,
            i.preference_rank, i.item_snapshot, i.created_at, i.created_at AS updated_at
     FROM scope_preference_submission_items i
     JOIN scope_preference_submissions s ON s.id = i.submission_id
     WHERE i.term_code = $1
       AND LOWER(s.division) = ANY($2::text[])
       AND s.status = 'frozen'
     ORDER BY i.faculty_name, i.preference_rank, i.assignment_group_id`,
    [termCode, scopedDivisions.map((value) => value.toLowerCase())]
  );

  const frozenRows = remapPreferencesToCurrentSections(preferenceResult.rows, sections);
  if (frozenRows.length || !allowLatestSubmittedFallback) {
    return { rows: frozenRows, source: frozenRows.length ? "frozen" : "none", frozenCount: frozenRows.length, latestSubmittedCount: 0 };
  }

  const latestSubmittedResult = await db.query(
    `WITH latest AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY faculty_id ORDER BY submitted_at DESC NULLS LAST, version_number DESC, id DESC) AS rn
       FROM scope_preference_submissions
       WHERE term_code = $1
         AND LOWER(division) = ANY($2::text[])
         AND status IN ('submitted', 'corrected')
     )
     SELECT i.term_code, i.faculty_id, i.employee_id, i.faculty_name, i.assignment_group_id, i.discipline_code,
            i.preference_rank, i.item_snapshot, i.created_at, i.created_at AS updated_at
     FROM scope_preference_submission_items i
     JOIN latest ON latest.id = i.submission_id AND latest.rn = 1
     ORDER BY i.faculty_name, i.preference_rank, i.assignment_group_id`,
    [termCode, scopedDivisions.map((value) => value.toLowerCase())]
  );
  const latestSubmittedRows = remapPreferencesToCurrentSections(latestSubmittedResult.rows, sections);
  return {
    rows: latestSubmittedRows,
    source: latestSubmittedRows.length ? "latest_submitted" : "none",
    frozenCount: 0,
    latestSubmittedCount: latestSubmittedRows.length,
  };
}

async function loadFrozenPreferenceRowsForSections(db, { termCode, sections = [], allowLatestSubmittedFallback = false }) {
  return loadPreferenceRowsForSections(db, { termCode, sections, allowLatestSubmittedFallback });
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
  if (result.rows[0]) return result.rows[0];
  if (!lookupName) return null;
  const fallbackResult = await runQuery(
    `SELECT employee_id, email, CONCAT_WS(' ', first_name, last_name) AS faculty_name, division, discipline
     FROM scope_pt_faculty
     WHERE COALESCE(active_status, 'active') = 'active'
     ORDER BY employee_id`,
    []
  );
  return (fallbackResult.rows || []).find((row) => compatiblePersonName(lookupName, row.faculty_name)) || null;
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

async function resolvePreferenceFacultyRoster(db, { facultyId = "", employeeId = "", authUser = null } = {}) {
  const runQuery = typeof db === "function" ? db : db?.query?.bind(db);
  if (typeof runQuery !== "function") {
    throw new TypeError("A database query function is required to resolve a faculty roster row.");
  }
  const isFaculty = String(authUser?.role || "").trim().toLowerCase() === "faculty";
  const lookupEmployeeId = String(isFaculty ? authUser?.employee_id || employeeId || facultyId : employeeId || facultyId).trim();
  const lookupEmail = String(isFaculty ? authUser?.email || "" : "").trim();
  const lookupName = String(isFaculty ? authUser?.full_name || "" : "").trim();
  const result = await runQuery(
    `SELECT employee_id, email, CONCAT_WS(' ', first_name, last_name) AS faculty_name, division, discipline
     FROM scope_pt_faculty
     WHERE COALESCE(active_status, 'active') = 'active'
       AND (
         employee_id = $1
         OR ($2 <> '' AND LOWER(email) = LOWER($2))
         OR ($3 <> '' AND LOWER(REGEXP_REPLACE(CONCAT_WS('', first_name, last_name), '[^a-zA-Z0-9]', '', 'g')) =
              LOWER(REGEXP_REPLACE($3, '[^a-zA-Z0-9]', '', 'g')))
         OR (
           LENGTH(REGEXP_REPLACE($3, '[^a-zA-Z0-9]', '', 'g')) >= 6
           AND (
             LOWER(REGEXP_REPLACE(CONCAT_WS('', first_name, last_name), '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE($3, '[^a-zA-Z0-9]', '', 'g')) || '%'
             OR LOWER(REGEXP_REPLACE($3, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || LOWER(REGEXP_REPLACE(CONCAT_WS('', first_name, last_name), '[^a-zA-Z0-9]', '', 'g')) || '%'
           )
         )
       )
     ORDER BY
       CASE
         WHEN employee_id = $1 THEN 0
         WHEN $2 <> '' AND LOWER(email) = LOWER($2) THEN 1
         WHEN $3 <> '' AND LOWER(REGEXP_REPLACE(CONCAT_WS('', first_name, last_name), '[^a-zA-Z0-9]', '', 'g')) =
              LOWER(REGEXP_REPLACE($3, '[^a-zA-Z0-9]', '', 'g')) THEN 2
         ELSE 3
       END,
       employee_id
     LIMIT 1`,
    [lookupEmployeeId, lookupEmail, lookupName]
  );
  return result.rows[0] || null;
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
       SELECT id, faculty_id, ROW_NUMBER() OVER (PARTITION BY faculty_id ORDER BY submitted_at DESC NULLS LAST, version_number DESC, id DESC) AS rn
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
  oneAssignmentPerPass = false,
  maxAssignments = "",
  maxLoad = "",
  allowLatestSubmittedFallback = false,
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

  const [facultyResult, preferenceSource, assignmentResult, reasonRows] = await Promise.all([
    scopedDivisions.length
      ? db.query(
          `SELECT pt.employee_id, pt.first_name, pt.last_name, pt.email, pt.division, pt.discipline,
                  COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '') AS seniority_rank,
                  COALESCE(NULLIF(pt.seniority_value, ''), pt.seniority_rank, '') AS seniority_value,
                  pt.qualified_disciplines, pt.active_status,
                  COALESCE(fls.status, 'active') AS load_status
           FROM scope_pt_faculty pt
           LEFT JOIN scope_faculty_load_status fls
             ON fls.term_code = $2
            AND LOWER(fls.division) = LOWER(pt.division)
            AND fls.employee_id = pt.employee_id
           WHERE COALESCE(pt.active_status, 'active') = 'active'
             AND LOWER(pt.division) = ANY($1::text[])
           ORDER BY pt.division, pt.discipline, pt.seniority_rank, pt.last_name, pt.first_name`,
          [scopedDivisions.map((value) => value.toLowerCase()), termCode]
        )
      : Promise.resolve({ rows: [] }),
    sectionIds.length
      ? loadPreferenceRowsForSections(db, { termCode, sections, allowLatestSubmittedFallback })
      : Promise.resolve({ rows: [], source: "none", frozenCount: 0, latestSubmittedCount: 0 }),
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
      preferences: preferenceSource.rows,
      assignments: assignmentResult.rows,
      recognizedContractualExceptions: reasonRows.map((row) => row.code),
      loadLimits: {
        oneAssignmentPerPass: Boolean(oneAssignmentPerPass),
        maxAssignments: maxAssignments ? Number(maxAssignments) : undefined,
        maxLoad: maxLoad ? Number(maxLoad) : undefined,
      },
    }),
    exceptionReasons: reasonRows,
    preferenceSource,
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

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "All_Divisions";
}

function exportDateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function formatMeetingSummary(meetings = []) {
  const list = Array.isArray(meetings) ? meetings : [];
  return list.map((meeting) => [
    meeting.days,
    [meeting.start_time, meeting.end_time].filter(Boolean).join("-"),
    [meeting.building, meeting.room].filter(Boolean).join(" "),
  ].filter(Boolean).join(" ")).filter(Boolean).join("; ");
}

function humanStageLabel(stage) {
  if (stage === "preference-review") return "Preference Review";
  if (stage === "chair-submission") return "Chair Submission";
  if (stage === "final-approved") return "Final Approved Staffing";
  return "Workflow Export";
}

function workflowExportFilename({ termCode, divisionLabel, stage, format, generatedAt = new Date() }) {
  return `SHERMAN_${safeFilePart(termCode)}_${safeFilePart(divisionLabel)}_${safeFilePart(humanStageLabel(stage))}_${exportDateStamp(generatedAt)}.${format}`;
}

function xlsxColumnName(index) {
  let column = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function xlsxSheetXml(rows = []) {
  const xmlRows = rows.map((values, rowIndex) => {
    const cells = values.map((value, columnIndex) => {
      const ref = `${xlsxColumnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeHtml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function zipStore(files, date = new Date()) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime(date);
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function workbookXlsx({ title, generatedAt, summaryRows = [], detailRows = [], headers = [] }) {
  const summary = [
    [title],
    ["Generated", generatedAt.toISOString()],
    ...summaryRows.map((item) => [item.label, item.value]),
  ];
  const details = [
    headers,
    ...detailRows.map((item) => headers.map((header) => item[header] ?? "")),
  ];
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Detail" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: xlsxSheetXml(summary) },
    { name: "xl/worksheets/sheet2.xml", data: xlsxSheetXml(details) },
  ];
  return zipStore(files, generatedAt);
}

function pdfEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function simplePdf({ title, generatedAt, summaryRows = [], detailRows = [], headers = [] }) {
  const lines = [
    title,
    `Generated: ${generatedAt.toISOString()}`,
    "",
    ...summaryRows.map((row) => `${row.label}: ${row.value}`),
    "",
    "Legend: Seniority rank is the roster order; preference rank is the faculty submitted order; recommendation is the system seniority recommendation; exception status reflects documented contractual rationale.",
    "",
    headers.join(" | "),
    ...detailRows.slice(0, 90).map((row) => headers.map((header) => row[header] ?? "").join(" | ")),
  ].map((line) => pdfEscape(String(line).slice(0, 170)));
  const content = [
    "BT",
    "/F1 10 Tf",
    "36 760 Td",
    ...lines.flatMap((line, index) => index === 0 ? [`(${line}) Tj`] : ["0 -14 Td", `(${line}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function sendWorkflowExport(res, { format, filename, title, generatedAt, summaryRows, detailRows, headers }) {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(csvFromRows(detailRows, headers));
  }
  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(simplePdf({ title, generatedAt, summaryRows, detailRows, headers }));
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(workbookXlsx({ title, generatedAt, summaryRows, detailRows, headers }));
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
       ORDER BY submitted_at DESC NULLS LAST, id DESC`,
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

const workflowExportStages = new Set(["preference-review", "chair-submission", "final-approved"]);
const workflowExportFormats = new Set(["xlsx", "pdf", "csv"]);

function sectionExportFields(section = {}) {
  return {
    subject_course: section.primary_subject_course || [section.subject_code, section.course_number].filter(Boolean).join(" "),
    crn: section.primary_crn || "",
    title: section.title || "",
    campus: section.campus || "",
    modality: section.display_modality || section.modality || section.instructional_method || "",
    meetings: formatMeetingSummary(section.meetings),
    discipline: section.discipline_code || "",
  };
}

function stageSummaryRows({ stage, termCode, divisionLabel, generatedAt, sourceLabel, rowCount, snapshotDate = "", packetVersion = "" }) {
  return [
    { label: "Stage", value: humanStageLabel(stage) },
    { label: "Term", value: termCode },
    { label: "Division", value: divisionLabel },
    { label: "Source snapshot", value: sourceLabel },
    { label: "Snapshot date", value: snapshotDate || generatedAt.toISOString() },
    { label: "Packet version", value: packetVersion || "N/A" },
    { label: "Detail rows", value: String(rowCount) },
    { label: "Legend", value: "Seniority rank is roster order; preference rank is faculty submitted order; recommendation is the system seniority recommendation; exception status shows contractual rationale." },
  ];
}

async function workflowExportSource(db, { termCode, divisions }) {
  const divisionKeys = divisions.map((value) => value.toLowerCase());
  const { analysis, preferenceSource } = await buildAllocationAnalysisFromDb(db, {
    termCode,
    divisions,
    allowLatestSubmittedFallback: false,
  });
  const assignmentResult = await db.query(
    `SELECT a.id, a.term_code, a.assignment_group_id, a.employee_id, a.faculty_name, a.status,
            a.reason, a.reason_code, a.justification, a.recommendation_snapshot, a.decision_snapshot,
            a.version, a.created_at, a.updated_at,
            d.selected_employee_id, d.selected_faculty_name, d.recommended_employee_id, d.decision_status,
            d.exception_reason_code, d.exception_explanation, d.decided_by_email, d.decided_by_name,
            d.decided_by_role, d.version AS decision_version, d.decided_at,
            s.division, s.primary_subject_course, s.primary_crn, s.title, s.campus, s.display_modality,
            s.modality, s.instructional_method, s.discipline_code, s.meetings
     FROM scope_assignments a
     JOIN scope_sections s ON s.term_code = a.term_code AND s.assignment_group_id = a.assignment_group_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM scope_chair_decisions d
       WHERE d.term_code = a.term_code AND d.assignment_group_id = a.assignment_group_id
       ORDER BY d.decided_at DESC, d.id DESC
       LIMIT 1
     ) d ON TRUE
     WHERE a.term_code = $1
       AND LOWER(s.division) = ANY($2::text[])
       AND COALESCE(a.status, 'tentative') NOT IN ('released', 'deleted', 'void', 'returned_for_revision')
     ORDER BY s.division, s.discipline_code, s.primary_subject_course, s.primary_crn`,
    [termCode, divisionKeys]
  );
  return { analysis, preferenceSource, assignments: assignmentResult.rows.map((row) => ({ ...row, meetings: row.meetings || [] })) };
}

function preferenceReviewRows({ termCode, analysis }) {
  return (analysis.sections || []).flatMap((entry) => {
    const section = entry.section || {};
    const fields = sectionExportFields(section);
    const candidates = entry.candidateList?.length ? entry.candidateList : [{}];
    const recommendation = entry.highestSeniorityCurrentlyEligibleCandidate || {};
    return candidates.map((candidate) => ({
      Term: termCode,
      Division: section.division || "",
      "Staffing Unit": entry.assignmentGroupId,
      "Subject and Course": fields.subject_course,
      CRN: fields.crn,
      Title: fields.title,
      Campus: fields.campus,
      Modality: fields.modality,
      "Days and Times": fields.meetings,
      "Interested Faculty": candidate.facultyName || "",
      "Employee ID": candidate.employeeId || "",
      "Seniority Rank": candidate.seniorityRank ?? "",
      "Preference Rank": candidate.preferenceRank ?? "",
      "Qualification Status": candidate.qualified === undefined ? "No interested candidate" : (candidate.qualified ? "Qualified" : "Not qualified"),
      "Current Availability Status": candidate.reasonCode || "NO_INTERESTED_CANDIDATE",
      "Load Status": candidate.reasonCode === "LOAD_LIMIT_REACHED" ? "Load limit reached" : "",
      "System Seniority Recommendation": recommendation.facultyName || "",
      "Recommendation Rationale": recommendation.employeeId ? "Highest-seniority currently eligible interested faculty." : "No eligible interested faculty available.",
      "Missing Seniority Flag": candidate.reasonCode === "MISSING_SENIORITY" ? "Yes" : "",
      "No Request Flag": candidate.reasonCode === "NOT_SELECTED_BY_FACULTY" ? "Yes" : "",
      "No Qualified Candidate Flag": !recommendation.employeeId ? "Yes" : "",
      "Unresolved Data Warnings": (analysis.warnings || []).filter((warning) => warning.assignmentGroupId === entry.assignmentGroupId || warning.employeeId === candidate.employeeId).map((warning) => warning.reasonCode || warning.code || warning.message).join("; "),
    }));
  });
}

function chairSubmissionRows({ termCode, analysis, assignments }) {
  const analysisBySection = new Map((analysis.sections || []).map((row) => [row.assignmentGroupId, row]));
  const assignmentBySection = new Map(assignments.filter((row) => ["chair_submitted", "dean_approved"].includes(String(row.status || "").toLowerCase())).map((row) => [row.assignment_group_id, row]));
  return (analysis.sections || []).map((entry) => {
    const section = entry.section || {};
    const fields = sectionExportFields(section);
    const assignment = assignmentBySection.get(entry.assignmentGroupId) || {};
    const recommendation = entry.highestSeniorityCurrentlyEligibleCandidate || {};
    const selectedCandidate = (analysisBySection.get(entry.assignmentGroupId)?.candidateList || []).find((candidate) => candidate.employeeId === assignment.employee_id) || {};
    const followed = assignment.employee_id && recommendation.employeeId ? assignment.employee_id === recommendation.employeeId : false;
    return {
      Term: termCode,
      Division: section.division || assignment.division || "",
      "Staffing Unit": entry.assignmentGroupId,
      "Subject and Course": fields.subject_course,
      CRN: fields.crn,
      Title: fields.title,
      "Selected Faculty": assignment.faculty_name || "",
      "Employee ID": assignment.employee_id || "",
      "Selected Seniority Rank": selectedCandidate.seniorityRank ?? "",
      "Selected Preference Rank": selectedCandidate.preferenceRank ?? "",
      "Original System Recommendation": recommendation.facultyName || "",
      "Followed Recommendation": assignment.employee_id ? (followed ? "Yes" : "No") : "Unstaffed",
      "Contractual Exception Code": assignment.exception_reason_code || assignment.reason_code || "",
      "Chair Explanation": assignment.exception_explanation || assignment.justification || assignment.reason || "",
      "Current Load": assignment.employee_id ? "Assigned in packet" : "Unstaffed",
      "Submission Date": assignment.updated_at || assignment.created_at || "",
      "Submitted By": assignment.decided_by_name || assignment.decided_by_email || assignment.actor_name || "",
      "Packet Version": assignment.version || assignment.decision_version || "",
      "Packet Status": assignment.status || "unstaffed",
    };
  });
}

function finalApprovedRows({ termCode, analysis, assignments }) {
  const approvedBySection = new Map(assignments.filter((row) => String(row.status || "").toLowerCase() === "dean_approved").map((row) => [row.assignment_group_id, row]));
  return (analysis.sections || []).map((entry) => {
    const section = entry.section || {};
    const fields = sectionExportFields(section);
    const assignment = approvedBySection.get(entry.assignmentGroupId) || {};
    return {
      Term: termCode,
      Division: section.division || assignment.division || "",
      "Subject and Course": fields.subject_course,
      CRN: fields.crn,
      Title: fields.title,
      "Assigned Faculty": assignment.faculty_name || "",
      "Employee ID": assignment.employee_id || "",
      "Assignment Load": assignment.employee_id ? "1" : "",
      Campus: fields.campus,
      Modality: fields.modality,
      "Days and Times": fields.meetings,
      "Chair Submission Date": assignment.created_at || "",
      "Dean Approval Date": assignment.updated_at || "",
      "Approved By": assignment.decided_by_name || assignment.decided_by_email || "",
      "Exception Code": assignment.exception_reason_code || assignment.reason_code || "",
      "Packet/Snapshot Version": assignment.version || assignment.decision_version || "",
      "Final Status": assignment.status || "unstaffed",
    };
  });
}

async function buildWorkflowExport(db, { termCode, divisions, stage }) {
  const generatedAt = new Date();
  const divisionLabel = divisions.join("_") || "All Divisions";
  const source = await workflowExportSource(db, { termCode, divisions });
  const frozenReady = (source.preferenceSource?.source || "") === "frozen";
  const submittedReady = source.assignments.some((row) => ["chair_submitted", "dean_approved"].includes(String(row.status || "").toLowerCase()));
  const approvedReady = source.assignments.some((row) => String(row.status || "").toLowerCase() === "dean_approved");
  if (stage === "preference-review" && !frozenReady) {
    const error = new Error("Preference review export is available after the preference window is frozen.");
    error.status = 409;
    throw error;
  }
  if (stage === "chair-submission" && !submittedReady) {
    const error = new Error("Chair submission export is available after the chair submits the staffing packet.");
    error.status = 409;
    throw error;
  }
  if (stage === "final-approved" && !approvedReady) {
    const error = new Error("Final approved staffing export is available after dean approval.");
    error.status = 409;
    throw error;
  }

  const rows = stage === "preference-review"
    ? preferenceReviewRows({ termCode, analysis: source.analysis })
    : stage === "chair-submission"
      ? chairSubmissionRows({ termCode, analysis: source.analysis, assignments: source.assignments })
      : finalApprovedRows({ termCode, analysis: source.analysis, assignments: source.assignments });
  const headers = Object.keys(rows[0] || { Term: "", Division: "", "No Data": "" });
  const snapshotDates = source.assignments.map((row) => row.updated_at || row.created_at).filter(Boolean).sort();
  const snapshotDate = snapshotDates.length ? snapshotDates[snapshotDates.length - 1] : generatedAt.toISOString();
  return {
    title: `${humanStageLabel(stage)} - ${termCode} - ${divisionLabel}`,
    generatedAt,
    divisionLabel,
    rows,
    headers,
    summaryRows: stageSummaryRows({
      stage,
      termCode,
      divisionLabel,
      generatedAt,
      sourceLabel: stage === "preference-review" ? "Frozen preference snapshot" : "Chair/dean assignment snapshots",
      snapshotDate,
      packetVersion: source.assignments.map((row) => row.version).filter(Boolean).sort((a, b) => Number(b) - Number(a))[0] || "",
      rowCount: rows.length,
    }),
  };
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
    let facultyRosterRow = null;
    if (String(req.auth?.user?.role || "").toLowerCase() === "faculty") {
      facultyRosterRow = await resolvePreferenceFacultyRoster(query, {
        facultyId: req.auth.user.employee_id || "",
        authUser: req.auth?.user || null,
      });
      if (!facultyRosterRow) {
        return res.status(409).json({
          error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID, email, or name to the roster.",
          sections: [],
        });
      }
      const facultyDivisions = splitScope(facultyRosterRow.division);
      if (!facultyDivisions.length) {
        return res.status(409).json({
          error: "Your active PT staffing roster record does not have a division assigned. Ask an administrator to update the roster.",
          sections: [],
        });
      }
      const windowResult = await query(
        `SELECT id, term, division, opened_at, closes_at, status
         FROM scope_staffing_windows
         WHERE term = $1
           AND LOWER(division) = ANY($2::text[])
         ORDER BY opened_at DESC, id DESC
         LIMIT 1`,
        [termCode, facultyDivisions]
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
    const divisionList = facultyRosterRow
      ? splitScope(facultyRosterRow.division)
      : scopeFilterForReq(req, String(divisions || "").split("|"));
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

router.get("/faculty-self-dashboard", async (req, res) => {
  const { termCode = "", disciplineCode = "" } = req.query;
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  if (String(req.auth?.user?.role || "").trim().toLowerCase() !== "faculty") {
    return res.status(403).json({ error: "Faculty account access is required." });
  }
  try {
    const authUser = req.auth?.user || {};
    const facultyRosterRow = await resolvePreferenceFacultyRoster(query, {
      facultyId: authUser.employee_id || "",
      authUser,
    });
    if (!facultyRosterRow?.employee_id) {
      return res.status(409).json({
        error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID, email, or name to the roster.",
        rosterRows: [],
        sections: [],
        preferences: [],
        availability: { days: [], timeBlocks: [] },
      });
    }

    const rosterResult = await query(
      `SELECT pt.employee_id, pt.first_name, pt.last_name, pt.email, pt.division, pt.discipline,
              COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '') AS seniority_rank,
              COALESCE(NULLIF(pt.seniority_value, ''), pt.seniority_rank, '') AS seniority_value,
              pt.qualified_disciplines, pt.active_status
       FROM scope_pt_faculty pt
       WHERE COALESCE(pt.active_status, 'active') = 'active'
         AND pt.employee_id = $1
       ORDER BY pt.division, pt.discipline, pt.last_name, pt.first_name`,
      [facultyRosterRow.employee_id]
    );
    const rosterRows = rosterResult.rows || [];
    const facultyDivisions = Array.from(new Set(rosterRows.flatMap((row) => splitScope(row.division))));
    const facultyDivisionKeys = facultyDivisions.map((division) => division.toLowerCase());
    if (!facultyDivisions.length) {
      return res.status(409).json({
        error: "Your active PT staffing roster record does not have a division assigned. Ask an administrator to update the roster.",
        rosterRows,
        sections: [],
        preferences: [],
        availability: { days: [], timeBlocks: [] },
      });
    }

    const windowResult = await query(
      `SELECT id, term, division, opened_at, closes_at, status
       FROM scope_staffing_windows
       WHERE term = $1
         AND LOWER(division) = ANY($2::text[])
       ORDER BY opened_at DESC, id DESC
       LIMIT 1`,
      [termCode, facultyDivisionKeys]
    );
    const state = windowState(windowResult.rows[0] || null, new Date());
    if (!state.open) {
      return res.json({
        rosterRows,
        sections: [],
        preferences: [],
        availability: { days: [], timeBlocks: [] },
        window: state,
        message: state.missing
          ? "The preference window has not been opened for your division yet."
          : "The preference window is not open for your division.",
      });
    }

    const sectionParams = [termCode, facultyDivisionKeys];
    let sectionWhere = `WHERE s.term_code = $1
      AND LOWER(s.division) = ANY($2::text[])
      AND COALESCE((s.raw_row->>'staff_eligible')::boolean, true) = true`;
    if (disciplineCode && disciplineCode !== "ALL") {
      sectionParams.push(disciplineCode);
      sectionWhere += ` AND s.discipline_code = $${sectionParams.length}`;
    }
    const sectionsResult = await query(
      `SELECT s.assignment_group_id, s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.subject_code, s.course_number,
              s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings, s.raw_row
       FROM scope_sections s
       ${sectionWhere}
       ORDER BY s.primary_subject_course, s.primary_crn`,
      sectionParams
    );

    const facultyIdentifiers = Array.from(new Set([
      authUser.employee_id,
      facultyRosterRow.employee_id,
    ].map((value) => String(value || "").trim()).filter(Boolean)));
    const [preferencesResult, availabilityResult] = await Promise.all([
      query(
        `SELECT p.assignment_group_id, p.preference_rank, p.faculty_id, p.employee_id, p.faculty_name,
                s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings
         FROM scope_preferences p
         LEFT JOIN scope_sections s ON s.term_code = p.term_code AND s.assignment_group_id = p.assignment_group_id
         WHERE p.term_code = $1
           AND (p.faculty_id = ANY($2::text[]) OR p.employee_id = ANY($2::text[]))
         ORDER BY p.preference_rank ASC`,
        [termCode, facultyIdentifiers]
      ),
      query(
        `SELECT availability_days, availability_time_blocks
         FROM scope_faculty_availability
         WHERE term_code = $1
           AND (faculty_id = ANY($2::text[]) OR employee_id = ANY($2::text[]))
         LIMIT 1`,
        [termCode, facultyIdentifiers]
      ),
    ]);
    const availability = availabilityResult.rows[0] || {};

    res.json({
      rosterRows,
      rosterMatch: facultyRosterRow,
      sections: (sectionsResult.rows || []).map((row) => ({ ...row, meetings: row.meetings || [] })),
      preferences: (preferencesResult.rows || []).map((row) => ({ ...row, meetings: row.meetings || [] })),
      availability: {
        days: Array.isArray(availability.availability_days) ? availability.availability_days : [],
        timeBlocks: Array.isArray(availability.availability_time_blocks) ? availability.availability_time_blocks : [],
      },
      window: state,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not load faculty dashboard." });
  }
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
    oneAssignmentPerPass = "false",
    maxAssignments = "",
    maxLoad = "",
  } = req.query;
  const requestedDivisions = parseScopeList(divisions || division);

  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  if (!isAdmin(req) && !requestedDivisions.length) {
    return res.status(400).json({ error: "division or divisions is required for scoped allocation analysis." });
  }

  try {
    const { analysis, exceptionReasons, preferenceSource } = await buildAllocationAnalysisFromDb({ query }, {
      termCode,
      division: requestedDivisions.join("|"),
      divisions: requestedDivisions,
      disciplineCode,
      oneAssignmentPerPass: String(oneAssignmentPerPass).toLowerCase() !== "false" && String(oneAssignmentPerPass) !== "0",
      maxAssignments,
      maxLoad,
      allowLatestSubmittedFallback: true,
    });

    res.json({ analysis, exceptionReasons, preferenceSource });
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

router.get("/workflow-exports/:stage.:format", requireElevatedRole, requireScopedRead, async (req, res) => {
  const { termCode = "", divisions = "" } = req.query;
  const stage = normalize(req.params.stage).toLowerCase();
  const format = normalize(req.params.format).toLowerCase();
  if (!termCode) return res.status(400).json({ error: "termCode is required." });
  if (!workflowExportStages.has(stage)) return res.status(400).json({ error: "Unknown workflow export stage." });
  if (!workflowExportFormats.has(format)) return res.status(400).json({ error: "Export format must be xlsx, pdf, or csv." });

  const scopedDivisions = scopeFilterForReq(req, String(divisions || "").split("|"));
  if (!isAdmin(req) && !scopedDivisions.length) return res.status(403).json({ error: "No permitted divisions are available for this export." });
  if (!scopedDivisions.length) return res.status(400).json({ error: "Select at least one division for this export." });

  const client = await pool.connect();
  try {
    const report = await buildWorkflowExport(client, { termCode, divisions: scopedDivisions, stage });
    const filename = workflowExportFilename({
      termCode,
      divisionLabel: report.divisionLabel,
      stage,
      format,
      generatedAt: report.generatedAt,
    });
    await writeAuditEvent(client, req, {
      eventType: "WORKFLOW_EXPORT_GENERATED",
      division: report.divisionLabel,
      term: termCode,
      reasonCode: stage.toUpperCase().replace(/-/g, "_"),
      newValue: {
        workflow_stage: stage,
        snapshot_or_packet_id: report.summaryRows.find((row) => row.label === "Source snapshot")?.value || "",
        version_number: report.summaryRows.find((row) => row.label === "Packet version")?.value || "",
        generated_at: report.generatedAt.toISOString(),
        filename,
        format,
      },
      note: `${humanStageLabel(stage)} export generated as ${format}.`,
    });
    return sendWorkflowExport(res, {
      format,
      filename,
      title: report.title,
      generatedAt: report.generatedAt,
      summaryRows: report.summaryRows,
      detailRows: report.rows,
      headers: report.headers,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Could not generate workflow export." });
  } finally {
    client.release();
  }
});

router.post("/chair-decisions", requireRoles("chair"), async (req, res) => {
  const {
    termCode = "",
    disciplineCode = "",
    assignmentGroupId = "",
    selectedEmployeeId = "",
    exceptionReasonCode = "",
    exceptionExplanation = "",
    expectedRecommendedEmployeeId = "",
    expectedRecommendationSnapshot = null,
  } = req.body || {};
  if (!termCode || !assignmentGroupId || !selectedEmployeeId) {
    return res.status(400).json({ error: "termCode, assignmentGroupId, and selectedEmployeeId are required." });
  }

  const actor = req.auth?.user || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedSection = await client.query(
      `SELECT assignment_group_id, division, discipline_code
       FROM scope_sections
       WHERE term_code = $1 AND assignment_group_id = $2
       FOR UPDATE`,
      [termCode, assignmentGroupId]
    );
    if (!lockedSection.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Staffing unit was not found." });
    }

    const sectionDivision = lockedSection.rows[0].division || "";
    const sectionDisciplineCode = disciplineCode || lockedSection.rows[0].discipline_code || "";
    const scopedDivisions = scopeFilterForReq(req, [sectionDivision]);
    if (!isAdmin(req) && !scopedDivisions.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This action is outside your assigned division scope." });
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
      division: sectionDivision,
      divisions: [sectionDivision],
      disciplineCode: sectionDisciplineCode,
      allowLatestSubmittedFallback: true,
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
    const recommendationSnapshot = jsonObjectTextParam(decision.recommendationSnapshot);
    const decisionSnapshot = jsonObjectTextParam(decision.decisionSnapshot);
    const recommendationSnapshotResponse = JSON.parse(recommendationSnapshot);
    const decisionSnapshotResponse = JSON.parse(decisionSnapshot);
    const decisionResult = await client.query(
      `INSERT INTO scope_chair_decisions
        (term_code, division, discipline_code, assignment_group_id, recommended_employee_id, selected_employee_id, selected_faculty_name,
         decision_status, exception_reason_code, exception_explanation, recommendation_snapshot, decision_snapshot,
         decided_by_user_id, decided_by_email, decided_by_name, decided_by_role, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,NOW())
       RETURNING id, decided_at`,
      [
        termCode,
        sectionDivision,
        sectionDisciplineCode,
        assignmentGroupId,
        decision.recommendedCandidate.employeeId,
        selectedEmployeeId,
        selectedFacultyName,
        decision.decisionStatus,
        reasonCode,
        justification,
        recommendationSnapshot,
        decisionSnapshot,
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
        sectionDisciplineCode,
        assignmentGroupId,
        selectedEmployeeId,
        selectedFacultyName,
        actor.full_name || actor.email || "",
        justification,
        reasonCode,
        justification,
        recommendationSnapshot,
        decisionSnapshot,
      ]
    );

    await writeAuditEvent(client, req, {
      eventType: "CHAIR_DECISION_RECORDED",
      division: sectionDivision,
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
        division: sectionDivision,
        discipline_code: sectionDisciplineCode,
        status: decision.decisionStatus,
        recommended_employee_id: decision.recommendedCandidate.employeeId,
        selected_employee_id: selectedEmployeeId,
        selected_faculty_name: selectedFacultyName,
        recommendation_snapshot: recommendationSnapshotResponse,
        decision_snapshot: decisionSnapshotResponse,
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
              s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings, s.raw_row,
              pt.employee_id, CONCAT_WS(' ', pt.first_name, pt.last_name) AS faculty_name,
              COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '') AS seniority_rank,
              pref.preference_rank,
              section_pref.section_preference_rank,
              COALESCE(av.availability_days, '[]'::jsonb) AS availability_days,
              COALESCE(av.availability_time_blocks, '[]'::jsonb) AS availability_time_blocks,
              COALESCE(fls.status, 'active') AS load_status,
              fls.updated_at AS load_status_updated_at
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
         FROM scope_preference_submission_items p
         JOIN scope_preference_submissions sub ON sub.id = p.submission_id
         WHERE p.term_code = s.term_code
           AND (p.employee_id = pt.employee_id OR p.faculty_id = pt.employee_id)
           AND sub.status = 'frozen'
           AND LOWER(sub.division) = LOWER(s.division)
           AND (
             p.assignment_group_id = s.assignment_group_id
             OR REGEXP_REPLACE(COALESCE(p.assignment_group_id, ''), '[^0-9]', '', 'g') LIKE '%' || s.primary_crn
           )
       ) pref ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(p.preference_rank) AS section_preference_rank
         FROM scope_preference_submission_items p
         JOIN scope_preference_submissions sub ON sub.id = p.submission_id
         WHERE p.term_code = s.term_code
           AND sub.status = 'frozen'
           AND LOWER(sub.division) = LOWER(s.division)
           AND (
             p.assignment_group_id = s.assignment_group_id
             OR REGEXP_REPLACE(COALESCE(p.assignment_group_id, ''), '[^0-9]', '', 'g') LIKE '%' || s.primary_crn
           )
       ) section_pref ON TRUE
       LEFT JOIN scope_faculty_availability av
         ON av.term_code = s.term_code
        AND (av.faculty_id = pt.employee_id OR av.employee_id = pt.employee_id)
       LEFT JOIN scope_faculty_load_status fls
         ON fls.term_code = s.term_code
        AND LOWER(fls.division) = LOWER(s.division)
        AND fls.employee_id = pt.employee_id
       ${where}
       ORDER BY section_pref.section_preference_rank NULLS LAST, s.primary_subject_course, s.primary_crn,
                COALESCE(NULLIF(pt.seniority_rank, ''), pt.seniority_value, '999999') NULLS LAST,
                pref.preference_rank NULLS LAST, faculty_name`,
      params
    );

    const sectionById = new Map();
    for (const row of result.rows) {
      if (!row.assignment_group_id || sectionById.has(row.assignment_group_id)) continue;
      sectionById.set(row.assignment_group_id, {
        term_code: termCode,
        assignment_group_id: row.assignment_group_id,
        primary_subject_course: row.primary_subject_course,
        primary_crn: row.primary_crn,
        title: row.title,
        division: row.division,
        campus: row.campus,
        discipline_code: row.discipline_code,
        instructional_method: row.instructional_method,
        display_modality: row.display_modality,
        modality: row.modality,
        meetings: row.meetings || [],
        raw_row: row.raw_row || {},
      });
    }
    const sections = Array.from(sectionById.values());
    const preferenceSource = await loadPreferenceRowsForSections({ query }, {
      termCode,
      sections,
      allowLatestSubmittedFallback: true,
    });
    const effectivePreferences = preferenceSource.rows;
    const sectionRankByAssignment = new Map();
    const candidateRankByAssignmentEmployee = new Map();
    for (const preference of effectivePreferences) {
      const assignmentGroupId = normalize(preference.assignment_group_id);
      const employeeId = normalize(preference.employee_id || preference.faculty_id);
      const rank = Number(preference.preference_rank);
      if (!assignmentGroupId || !Number.isFinite(rank)) continue;

      const sectionRank = sectionRankByAssignment.get(assignmentGroupId);
      if (!Number.isFinite(sectionRank) || rank < sectionRank) {
        sectionRankByAssignment.set(assignmentGroupId, rank);
      }
      if (employeeId) {
        const key = `${assignmentGroupId}::${employeeId}`;
        const candidateRank = candidateRankByAssignmentEmployee.get(key);
        if (!Number.isFinite(candidateRank) || rank < candidateRank) {
          candidateRankByAssignmentEmployee.set(key, rank);
        }
      }
    }

    const rows = result.rows.map((row) => {
      const assignmentGroupId = normalize(row.assignment_group_id);
      const employeeId = normalize(row.employee_id);
      return {
        ...row,
        meetings: row.meetings || [],
        preference_rank: candidateRankByAssignmentEmployee.get(`${assignmentGroupId}::${employeeId}`) ?? null,
        section_preference_rank: sectionRankByAssignment.get(assignmentGroupId) ?? null,
      };
    });

    res.json({ rows, preferenceSource });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post("/faculty-load-status", requireRoles("chair"), async (req, res) => {
  const {
    termCode = "",
    division = "",
    employeeId = "",
    facultyName = "",
    loadComplete = false,
    note = "",
  } = req.body || {};
  const targetDivision = normalize(division);
  const targetEmployee = normalize(employeeId);
  if (!termCode || !targetDivision || !targetEmployee) {
    return res.status(400).json({ error: "termCode, division, and employeeId are required." });
  }
  const scoped = scopeFilterForReq(req, [targetDivision]);
  if (!scoped.length) return res.status(403).json({ error: "This action is outside your assigned division scope." });

  try {
    const actor = req.auth?.user || {};
    const status = loadComplete ? "complete" : "active";
    const result = await query(
      `INSERT INTO scope_faculty_load_status
        (term_code, division, employee_id, faculty_name, status, note,
         actor_user_id, actor_email, actor_name, actor_role, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (term_code, division, employee_id)
       DO UPDATE SET
         faculty_name = EXCLUDED.faculty_name,
         status = EXCLUDED.status,
         note = EXCLUDED.note,
         actor_user_id = EXCLUDED.actor_user_id,
         actor_email = EXCLUDED.actor_email,
         actor_name = EXCLUDED.actor_name,
         actor_role = EXCLUDED.actor_role,
         updated_at = NOW()
       RETURNING term_code, division, employee_id, faculty_name, status, note, updated_at`,
      [
        termCode,
        targetDivision,
        targetEmployee,
        normalize(facultyName),
        status,
        normalize(note),
        actor.id || null,
        actor.email || "",
        actor.full_name || actor.email || "",
        actor.role || "",
      ]
    );
    await writeAuditEvent({ query }, req, {
      eventType: status === "complete" ? "FACULTY_LOAD_COMPLETED" : "FACULTY_LOAD_REOPENED",
      division: targetDivision,
      term: termCode,
      instructorName: normalize(facultyName) || targetEmployee,
      oldValue: "",
      newValue: status,
      reasonCode: status === "complete" ? "LOAD_COMPLETE" : "LOAD_REOPENED",
      explanation: normalize(note),
      note: status === "complete"
        ? `${normalize(facultyName) || targetEmployee} marked load complete for the current review.`
        : `${normalize(facultyName) || targetEmployee} returned to assignment consideration.`,
    });
    res.json({ status: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message || "Could not update faculty load status." });
  }
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
    const facultyRosterRow = await resolvePreferenceFacultyRoster(query, {
      facultyId,
      authUser: req.auth?.user || null,
    });
    if (String(req.auth?.user?.role || "").toLowerCase() === "faculty") {
      if (!facultyRosterRow) {
        return res.status(409).json({
          error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID, email, or name to the roster.",
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

    const facultyIdentifiers = Array.from(new Set([facultyId, facultyRosterRow?.employee_id].map((value) => String(value || "").trim()).filter(Boolean)));
    const [result, availabilityResult] = await Promise.all([
      query(
      `SELECT p.assignment_group_id, p.preference_rank, p.faculty_id, p.employee_id, p.faculty_name,
              s.primary_subject_course, s.primary_crn, s.title, s.division, s.campus, s.discipline_code, s.instructional_method, s.display_modality, s.modality, s.meetings
       FROM scope_preferences p
       LEFT JOIN scope_sections s ON s.term_code = p.term_code AND s.assignment_group_id = p.assignment_group_id
       WHERE p.term_code = $1
         AND (p.faculty_id = ANY($2::text[]) OR p.employee_id = ANY($2::text[]))
       ORDER BY p.preference_rank ASC`,
      [termCode, facultyIdentifiers]
      ),
      query(
        `SELECT availability_days, availability_time_blocks
         FROM scope_faculty_availability
         WHERE term_code = $1
           AND (faculty_id = ANY($2::text[]) OR employee_id = ANY($2::text[]))
         LIMIT 1`,
        [termCode, facultyIdentifiers]
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
    const facultyRosterRow = await resolvePreferenceFacultyRoster(client, {
      facultyId,
      employeeId,
      authUser: req.auth?.user || null,
    });
    if (!facultyRosterRow) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Your account is not linked to an active PT staffing roster record. Ask an administrator to match your account employee ID, email, or name to the roster.",
      });
    }
    const canonicalFacultyId = facultyRosterRow.employee_id || employeeId || facultyId;
    const canonicalEmployeeId = facultyRosterRow.employee_id || employeeId || facultyId;
    const canonicalFacultyName = facultyRosterRow.faculty_name || facultyName;
    const facultyIdentifiers = Array.from(new Set([facultyId, employeeId, canonicalFacultyId].map((value) => String(value || "").trim()).filter(Boolean)));
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
      facultyId: canonicalFacultyId,
      employeeId: canonicalEmployeeId,
      facultyName: canonicalFacultyName,
      preferences,
      availabilityDays,
      availabilityTimeBlocks,
      status: targetStatus,
      source,
      auditReason,
      actor,
    });
    const submissionId = submissionResult.id;
    await client.query(
      `DELETE FROM scope_preferences
       WHERE term_code = $1
         AND (faculty_id = ANY($2::text[]) OR employee_id = ANY($2::text[]))`,
      [termCode, facultyIdentifiers]
    );
    for (const pref of preferences) {
      await client.query(
        `INSERT INTO scope_preferences
          (term_code, faculty_id, employee_id, faculty_name, assignment_group_id, discipline_code, preference_rank, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [termCode, canonicalFacultyId, canonicalEmployeeId, canonicalFacultyName, pref.assignment_group_id, pref.discipline_code || "", pref.preference_rank || 1]
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
      [termCode, canonicalFacultyId, canonicalEmployeeId, canonicalFacultyName, JSON.stringify(availabilityDays), JSON.stringify(availabilityTimeBlocks)]
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
        canonicalFacultyName,
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

const divisionResetModes = new Set(["preferences", "staffing", "complete"]);

function addCount(counts, key, result) {
  counts[key] = (counts[key] || 0) + (result?.rowCount || 0);
}

async function resolveResetDivision(client, termCode, division) {
  const result = await client.query(
    `SELECT division
     FROM (
       SELECT division FROM scope_sections WHERE term_code = $1 AND LOWER(division) = LOWER($2)
       UNION ALL
       SELECT division FROM scope_staffing_windows WHERE term = $1 AND LOWER(division) = LOWER($2)
       UNION ALL
       SELECT division FROM scope_preference_submissions WHERE term_code = $1 AND LOWER(division) = LOWER($2)
       UNION ALL
       SELECT division FROM scope_chair_decisions WHERE term_code = $1 AND LOWER(division) = LOWER($2)
       UNION ALL
       SELECT fls.division FROM scope_faculty_load_status fls WHERE fls.term_code = $1 AND LOWER(fls.division) = LOWER($2)
       UNION ALL
       SELECT s.division
       FROM scope_assignments a
       JOIN scope_sections s ON s.term_code = a.term_code AND s.assignment_group_id = a.assignment_group_id
       WHERE a.term_code = $1 AND LOWER(s.division) = LOWER($2)
     ) scoped
     WHERE COALESCE(division, '') <> ''
     ORDER BY CASE WHEN division = $2 THEN 0 ELSE 1 END, division
     LIMIT 1`,
    [termCode, division]
  );
  return result.rows[0]?.division || "";
}

async function resetDivisionWorkflow(client, { termCode, division, resetMode, failAfterDelete = false }) {
  const counts = {};
  const divisionKey = String(division || "").toLowerCase();
  const sectionResult = await client.query(
    `SELECT assignment_group_id
     FROM scope_sections
     WHERE term_code = $1 AND LOWER(division) = $2
     FOR SHARE`,
    [termCode, divisionKey]
  );
  const sectionIds = sectionResult.rows.map((row) => row.assignment_group_id).filter(Boolean);
  const facultyResult = await client.query(
    `SELECT employee_id
     FROM scope_pt_faculty
     WHERE LOWER(division) = $1`,
    [divisionKey]
  );
  const facultyIds = facultyResult.rows.map((row) => String(row.employee_id || "").trim()).filter(Boolean);

  const submissionIdResult = await client.query(
    `SELECT id
     FROM scope_preference_submissions
     WHERE term_code = $1 AND LOWER(division) = $2
     FOR UPDATE`,
    [termCode, divisionKey]
  );
  const submissionIds = submissionIdResult.rows.map((row) => row.id);

  if (submissionIds.length) {
    addCount(counts, "scope_preference_submission_items", await client.query(
      `DELETE FROM scope_preference_submission_items WHERE submission_id = ANY($1::int[])`,
      [submissionIds]
    ));
    addCount(counts, "scope_preference_submissions", await client.query(
      `DELETE FROM scope_preference_submissions WHERE id = ANY($1::int[])`,
      [submissionIds]
    ));
  } else {
    counts.scope_preference_submission_items = 0;
    counts.scope_preference_submissions = 0;
  }

  if (sectionIds.length || facultyIds.length) {
    addCount(counts, "scope_preferences", await client.query(
      `DELETE FROM scope_preferences
       WHERE term_code = $1
         AND (
           ($2::text[] <> '{}'::text[] AND assignment_group_id = ANY($2::text[]))
           OR ($3::text[] <> '{}'::text[] AND (faculty_id = ANY($3::text[]) OR employee_id = ANY($3::text[])))
         )`,
      [termCode, sectionIds, facultyIds]
    ));
    addCount(counts, "scope_faculty_availability", await client.query(
      `DELETE FROM scope_faculty_availability
       WHERE term_code = $1
         AND $2::text[] <> '{}'::text[]
         AND (faculty_id = ANY($2::text[]) OR employee_id = ANY($2::text[]))`,
      [termCode, facultyIds]
    ));
  } else {
    counts.scope_preferences = 0;
    counts.scope_faculty_availability = 0;
  }

  addCount(counts, "scope_staffing_windows", await client.query(
    `DELETE FROM scope_staffing_windows
     WHERE term = $1 AND LOWER(division) = $2`,
    [termCode, divisionKey]
  ));

  if (resetMode === "staffing" || resetMode === "complete") {
    addCount(counts, "scope_faculty_load_status", await client.query(
      `DELETE FROM scope_faculty_load_status
       WHERE term_code = $1 AND LOWER(division) = $2`,
      [termCode, divisionKey]
    ));
    addCount(counts, "scope_chair_decisions", await client.query(
      `DELETE FROM scope_chair_decisions
       WHERE term_code = $1
         AND (
           LOWER(division) = $2
           OR ($3::text[] <> '{}'::text[] AND assignment_group_id = ANY($3::text[]))
         )`,
      [termCode, divisionKey, sectionIds]
    ));
    addCount(counts, "scope_assignments", await client.query(
      `DELETE FROM scope_assignments a
       USING scope_sections s
       WHERE a.term_code = $1
         AND s.term_code = a.term_code
         AND s.assignment_group_id = a.assignment_group_id
         AND LOWER(s.division) = $2`,
      [termCode, divisionKey]
    ));
  } else {
    counts.scope_faculty_load_status = 0;
    counts.scope_chair_decisions = 0;
    counts.scope_assignments = 0;
  }

  if (failAfterDelete) throw new Error("Injected division reset failure.");

  return counts;
}

router.post("/admin/division-reset", requireRoles("admin"), async (req, res) => {
  const {
    termCode = "",
    division = "",
    resetMode = "",
    auditReason = "",
    confirmationText = "",
    injectFailure = "",
  } = req.body || {};
  const normalizedTerm = normalize(termCode);
  const requestedDivision = normalize(division);
  const normalizedMode = normalize(resetMode).toLowerCase();
  const reason = normalize(auditReason);
  if (!normalizedTerm || !requestedDivision || !normalizedMode || !reason || !normalize(confirmationText)) {
    return res.status(400).json({ error: "termCode, division, resetMode, auditReason, and confirmationText are required." });
  }
  if (!divisionResetModes.has(normalizedMode)) {
    return res.status(400).json({ error: "resetMode must be preferences, staffing, or complete." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const storedDivision = await resolveResetDivision(client, normalizedTerm, requestedDivision);
    if (!storedDivision) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No stored schedule or workflow data was found for that term and division." });
    }
    if (normalize(confirmationText) !== storedDivision) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: `Confirmation text must exactly match ${storedDivision}.` });
    }

    const counts = await resetDivisionWorkflow(client, {
      termCode: normalizedTerm,
      division: storedDivision,
      resetMode: normalizedMode,
      failAfterDelete: process.env.NODE_ENV === "test" && normalize(injectFailure) === "after_delete",
    });

    await writeAuditEvent(client, req, {
      eventType: "DIVISION_RESET",
      division: storedDivision,
      term: normalizedTerm,
      reasonCode: normalizedMode.toUpperCase(),
      explanation: reason,
      newValue: counts,
      note: `Admin reset ${storedDivision} for ${normalizedTerm} using ${normalizedMode} mode.`,
    });
    await client.query("COMMIT");
    res.json({ success: true, termCode: normalizedTerm, division: storedDivision, resetMode: normalizedMode, affected: counts });
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: error.message || "Could not reset division." });
  } finally {
    client.release();
  }
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

