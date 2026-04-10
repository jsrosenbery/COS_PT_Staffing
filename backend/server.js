import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import Papa from "papaparse";
import fs from "fs";
import { pool, query } from "./db.js";
import persistenceRoutes from "./routes/persistence.js";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN?.split(",") || "*",
    credentials: true,
  })
);

app.use(express.json());
app.use("/api", persistenceRoutes);

async function ensureDefaultTerms() {
  const existing = await pool.query("SELECT COUNT(*)::int AS count FROM terms");
  if ((existing.rows?.[0]?.count || 0) > 0) return;

  await pool.query(
    `INSERT INTO terms (term_code, term_name, is_active)
     VALUES
       ('SP27', 'Spring 2027', true),
       ('FA27', 'Fall 2027', false),
       ('SP28', 'Spring 2028', false)
     ON CONFLICT (term_code) DO NOTHING`
  );
}

async function ensureAssignmentGroupColumns() {
  await pool.query(`ALTER TABLE assignment_groups ADD COLUMN IF NOT EXISTS instructional_method TEXT`);
  await pool.query(`ALTER TABLE assignment_groups ADD COLUMN IF NOT EXISTS display_modality TEXT`);
}

async function ensureAssignmentIndexes() {
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS assignments_unique_group_per_term ON assignments (term_code, assignment_group_id) WHERE status <> 'released'`);
  } catch (error) {
    console.warn("Could not create assignments unique index:", error.message);
  }
}

async function writeDecisionLog(client, { termCode, disciplineCode, actorName, eventType, detail }) {
  if (!termCode || !eventType || !detail) return;
  await client.query(
    `INSERT INTO decision_logs (
      term_code,
      discipline_code,
      actor_name,
      event_type,
      detail
    ) VALUES ($1,$2,$3,$4,$5)`,
    [
      termCode,
      disciplineCode || "ALL",
      actorName || "System",
      eventType,
      detail,
    ]
  );
}


function parseTimeToMinutes(value) {
  const raw = normalize(value).toUpperCase();
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return null;

  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  if (match[3] === "PM") hours += 12;
  return hours * 60 + minutes;
}

function normalizeMeetingDays(value) {
  const raw = normalize(value).toUpperCase();
  if (!raw) return [];
  if (["TBA", "ARR", "ASYNC"].includes(raw)) return [];
  if (/^X+$/.test(raw)) return [];
  return raw
    .replace(/\s+/g, "")
    .replace(/SU/g, "U")
    .replace(/SA/g, "A")
    .split("")
    .filter((token) => "MTWRFAUS".includes(token));
}

function isAsyncMeeting(meeting = {}) {
  const days = normalize(meeting.days).toUpperCase();
  const building = normalize(meeting.building).toUpperCase();
  const room = normalize(meeting.room).toUpperCase();
  const start = normalize(meeting.start_time).toUpperCase();
  const end = normalize(meeting.end_time).toUpperCase();

  return (
    !normalizeMeetingDays(days).length ||
    building.includes("ONLINE") ||
    room === "N/A" ||
    (start === "12:00AM" && end === "12:00AM")
  );
}

function meetingsOverlap(meetingsA = [], meetingsB = []) {
  for (const meetingA of meetingsA || []) {
    if (isAsyncMeeting(meetingA)) continue;
    const daysA = normalizeMeetingDays(meetingA.days);
    const startA = parseTimeToMinutes(meetingA.start_time);
    const endA = parseTimeToMinutes(meetingA.end_time);
    if (!daysA.length || startA === null || endA === null || startA === endA) continue;

    for (const meetingB of meetingsB || []) {
      if (isAsyncMeeting(meetingB)) continue;
      const daysB = normalizeMeetingDays(meetingB.days);
      const startB = parseTimeToMinutes(meetingB.start_time);
      const endB = parseTimeToMinutes(meetingB.end_time);
      if (!daysB.length || startB === null || endB === null || startB === endB) continue;

      const sharedDay = daysA.some((day) => daysB.includes(day));
      const overlapsInTime = startA < endB && startB < endA;
      if (sharedDay && overlapsInTime) return true;
    }
  }

  return false;
}

async function getMeetingsForAssignmentGroups(termCode, assignmentGroupIds = []) {
  const ids = Array.from(new Set((assignmentGroupIds || []).filter(Boolean)));
  if (!termCode || !ids.length) return new Map();

  const result = await pool.query(
    `SELECT
       ag.assignment_group_id,
       agm.days,
       agm.start_time,
       agm.end_time,
       agm.building,
       agm.room
     FROM assignment_groups ag
     LEFT JOIN assignment_group_meetings agm
       ON ag.assignment_group_id = agm.assignment_group_id
     WHERE ag.term_code = $1
       AND ag.assignment_group_id = ANY($2::text[])`,
    [termCode, ids]
  );

  const map = new Map();
  for (const row of result.rows || []) {
    if (!map.has(row.assignment_group_id)) map.set(row.assignment_group_id, []);
    if (row.days || row.start_time || row.end_time || row.building || row.room) {
      map.get(row.assignment_group_id).push({
        days: row.days,
        start_time: row.start_time,
        end_time: row.end_time,
        building: row.building,
        room: row.room,
      });
    }
  }
  return map;
}

function normalizeDivisionName(value) {
  return normalize(value).replace(/&/g, "and").replace(/\s+/g, " ").trim().toLowerCase();
}

async function getDivisionUploadImpact(client, termCode, divisionName) {
  const divisionNorm = normalizeDivisionName(divisionName);
  if (!termCode || !divisionNorm) {
    return { assignmentGroups: [], counts: { sections: 0, facultyPreferences: 0, facultySubmissions: 0, tentativeAssignments: 0, disciplineWindows: 0 } };
  }

  const groupsResult = await client.query(
    `SELECT assignment_group_id, discipline_code, primary_subject_course, primary_crn
     FROM assignment_groups
     WHERE term_code = $1
       AND LOWER(REPLACE(COALESCE(division, ''), '&', 'and')) = $2`,
    [termCode, divisionNorm]
  );

  const assignmentGroups = groupsResult.rows || [];
  const assignmentGroupIds = assignmentGroups.map((row) => row.assignment_group_id).filter(Boolean);
  const disciplineCodes = Array.from(new Set(assignmentGroups.map((row) => row.discipline_code).filter(Boolean)));

  const countQuery = async (sql, params) => {
    const result = await client.query(sql, params);
    return Number(result.rows?.[0]?.count || 0);
  };

  const facultyPreferences = assignmentGroupIds.length
    ? await countQuery(
        `SELECT COUNT(*)::int AS count
         FROM faculty_preferences
         WHERE term_code = $1
           AND assignment_group_id = ANY($2::text[])`,
        [termCode, assignmentGroupIds]
      )
    : 0;

  const facultySubmissions = disciplineCodes.length
    ? await countQuery(
        `SELECT COUNT(*)::int AS count
         FROM faculty_submissions
         WHERE term_code = $1
           AND discipline_code = ANY($2::text[])
           AND submitted = TRUE`,
        [termCode, disciplineCodes]
      )
    : 0;

  const tentativeAssignments = assignmentGroupIds.length
    ? await countQuery(
        `SELECT COUNT(*)::int AS count
         FROM assignments
         WHERE term_code = $1
           AND assignment_group_id = ANY($2::text[])
           AND status <> 'released'`,
        [termCode, assignmentGroupIds]
      )
    : 0;

  const disciplineWindows = disciplineCodes.length
    ? await countQuery(
        `SELECT COUNT(*)::int AS count
         FROM discipline_windows
         WHERE term_code = $1
           AND discipline_code = ANY($2::text[])
           AND COALESCE(status, 'ready') <> 'ready'`,
        [termCode, disciplineCodes]
      )
    : 0;

  return {
    assignmentGroups,
    counts: {
      sections: assignmentGroups.length,
      facultyPreferences,
      facultySubmissions,
      tentativeAssignments,
      disciplineWindows,
    },
  };
}


const hiddenColumns = new Set([
  "SCHEDULE_TYPE",
  "ACCOUNTING_METHOD",
  "PTRM",
  "ACTUAL_ENROLL",
  "WAIT_CAPACITY",
  "WAIT_LIST",
  "STATUS",
  "SECTION_NUMB",
]);

function normalize(value) {
  return String(value ?? "").trim();
}

function getRowValue(row, aliases = []) {
  if (!row) return "";

  for (const alias of aliases) {
    if (alias in row && normalize(row[alias])) return normalize(row[alias]);
  }

  const normalizedLookup = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])
  );

  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    if (normalizedLookup.has(normalizedAlias) && normalize(normalizedLookup.get(normalizedAlias))) {
      return normalize(normalizedLookup.get(normalizedAlias));
    }
  }

  return "";
}

function getFirstBundleValue(rows, aliases = []) {
  for (const row of rows || []) {
    const value = getRowValue(row, aliases);
    if (value) return value;
  }
  return "";
}

function bundleHasAsyncOnlineSignals(rows = []) {
  return (rows || []).some((row) => {
    const days = normalize(getRowValue(row, ["DAYS", "days", "Days"])).toUpperCase();
    const start = normalize(getRowValue(row, ["START_TIME", "start_time", "Start Time"])).toUpperCase();
    const end = normalize(getRowValue(row, ["END_TIME", "end_time", "End Time"])).toUpperCase();
    const building = normalize(getRowValue(row, ["BUILDING", "building", "Building"])).toUpperCase();
    const room = normalize(getRowValue(row, ["ROOM", "room", "Room"])).toUpperCase();
    const campus = normalize(getRowValue(row, ["CAMPUS", "campus", "Campus"])).toUpperCase();
    return (
      /^X+$/.test(days) ||
      building.includes("ONLINE") ||
      building.includes("HYBRID") ||
      room === "N/A" ||
      campus.startsWith("ON") ||
      (start === "12:00AM" && end === "12:00AM")
    );
  });
}

function bundleHasPhysicalMeetings(rows = []) {
  return (rows || []).some((row) => {
    const days = normalize(getRowValue(row, ["DAYS", "days", "Days"])).toUpperCase();
    const building = normalize(getRowValue(row, ["BUILDING", "building", "Building"])).toUpperCase();
    const room = normalize(getRowValue(row, ["ROOM", "room", "Room"])).toUpperCase();
    const campus = normalize(getRowValue(row, ["CAMPUS", "campus", "Campus"])).toUpperCase();
    return (
      normalizeMeetingDays(days).length > 0 &&
      !building.includes("ONLINE") &&
      !building.includes("HYBRID") &&
      room !== "N/A" &&
      !campus.startsWith("ON")
    );
  });
}

function canonicalizeInstructionalMethod(rawInstructionalMethod, rows = []) {
  const value = normalize(rawInstructionalMethod).toUpperCase().replace(/[^A-Z0-9]+/g, "");

  if (!value) {
    if (bundleHasAsyncOnlineSignals(rows) && bundleHasPhysicalMeetings(rows)) return "HYB";
    if (bundleHasAsyncOnlineSignals(rows)) return "ONL";
    if (bundleHasPhysicalMeetings(rows)) return "IP";
    return "";
  }

  if (["IP", "INPERSON", "INP"].includes(value)) return "IP";
  if (["HYB", "HYBRID", "OH"].includes(value)) return "HYB";
  if (["FLX", "HYFLEX", "HYBRIDFLEX", "FLEX"].includes(value)) return "FLX";
  if (["ONL", "ONLINE", "ONS", "ONN", "OL", "ON"].includes(value)) return "ONL";
  if (["DE", "DUALENROLLMENT", "DUAL"].includes(value)) return "DE";

  if (["02S", "022", "02N", "04"].includes(value) && bundleHasPhysicalMeetings(rows)) return "IP";
  if (["72", "71", "XX"].includes(value) && bundleHasAsyncOnlineSignals(rows)) return "ONL";
  if (value === "98") return "";

  if (bundleHasAsyncOnlineSignals(rows) && bundleHasPhysicalMeetings(rows)) return "HYB";
  if (bundleHasAsyncOnlineSignals(rows)) return "ONL";
  if (bundleHasPhysicalMeetings(rows)) return "IP";

  return "";
}

function mapInstructionalMethodToDisplayModality(rawInstructionalMethod, rows = []) {
  const value = canonicalizeInstructionalMethod(rawInstructionalMethod, rows);

  if (value === "IP") return "In Person";
  if (value === "HYB") return "Hybrid";
  if (value === "FLX") return "Hybrid Flex";
  if (value === "ONL") return "Online";
  if (value === "DE") return "Dual Enrollment";

  return "";
}

function resolveInstructionalMethod(rowOrRows) {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
  return getFirstBundleValue(rows, [
    "INSTRUCTIONAL_METHOD",
    "INSTRUCTIONAL_METHODS",
    "INSTRUCTIONAL_METHOD_CODE",
    "INSTRUCTIONAL_METHOD_CD",
    "INSTR_METHOD",
    "METHOD",
    "instructional_method",
    "instructional_methods",
    "instructional_method_code",
    "instructional_method_cd",
    "instr_method",
    "method",
    "Instructional Method",
    "Instructional Methods",
    "Instructional Method Code",
    "Instr Method",
  ]);
}

function resolveRawModality(rowOrRows) {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
  return getFirstBundleValue(rows, [
    "SCHEDULE_TYPE",
    "MEETING_TYPE",
    "MODALITY",
    "schedule_type",
    "meeting_type",
    "modality",
    "Schedule Type",
    "Meeting Type",
    "Modality",
  ]);
}

function normalizeInstructor(value) {
  return normalize(value)
    .replace(/\s+/g, " ")
    .replace(/\s*\.\s*/g, ".")
    .trim();
}

function toFriendlyModality(value, rows = []) {
  const v = normalize(value).toUpperCase();
  if (!v) {
    return mapInstructionalMethodToDisplayModality("", rows) || "TBA";
  }
  if (["IP", "IN PERSON", "INPERSON"].includes(v)) return "In Person";
  if (["HYB", "HYBRID", "OH"].includes(v)) return "Hybrid";
  if (["FLX", "HYBRID FLEX", "FLEX"].includes(v)) return "Hybrid Flex";
  if (["ONL", "ONS", "ONN", "ONC", "ONLINE", "OL", "ON"].includes(v)) return "Online";
  if (["DE", "DUAL ENROLLMENT", "DUAL-ENROLLMENT"].includes(v)) return "Dual Enrollment";
  return mapInstructionalMethodToDisplayModality(v, rows) || value;
}

function inferDiscipline(subjectCourse, coverageRows) {
  const subject = normalize(subjectCourse).split(" ")[0]?.toUpperCase() || "";
  const match = coverageRows.find((row) => row.subject_code.toUpperCase() === subject);
  return {
    disciplineCode: match?.discipline_code || null,
    divisionName: match?.division_name || null,
    subjectCode: subject,
  };
}

async function getCoverage(termCode) {
  const result = await query(
    `WITH combined AS (
       SELECT
         2 AS priority,
         term_code,
         discipline_code,
         subject_code
       FROM discipline_subject_coverage
       WHERE term_code = $1

       UNION ALL

       SELECT
         1 AS priority,
         term_code,
         discipline_code,
         subject_code
       FROM subject_mappings
       WHERE term_code IS NULL OR term_code = $1
     )
     SELECT DISTINCT ON (UPPER(c.subject_code))
       c.term_code,
       c.discipline_code,
       c.subject_code,
       d.division_name
     FROM combined c
     LEFT JOIN disciplines d
       ON d.discipline_code = c.discipline_code
     ORDER BY UPPER(c.subject_code), c.priority DESC, c.discipline_code`,
    [termCode]
  );
  return result.rows;
}

async function getSubjectMappingStatus(termCode) {
  const [globalResult, termResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS count
       FROM subject_mappings
       WHERE term_code IS NULL`
    ),
    query(
      `SELECT COUNT(*)::int AS count
       FROM discipline_subject_coverage
       WHERE term_code = $1`,
      [termCode]
    ),
  ]);

  return {
    globalCount: globalResult.rows[0]?.count || 0,
    termCount: termResult.rows[0]?.count || 0,
  };
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeParsedRowKeys(row) {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    normalized[normalizeHeader(key)] = value;
  });
  return normalized;
}

function analyzeUploadDivisionScope(rows, selectedDivision) {
  const selectedDivisionNorm = normalizeDivisionName(selectedDivision);
  const analyzedRows = (rows || []).map((row) => {
    const rawDivision = getRowValue(row, ["DIVISION", "division", "Division"]);
    return {
      row,
      rawDivision,
      normalizedDivision: rawDivision ? normalizeDivisionName(rawDivision) : "",
    };
  });

  const detectedDivisions = Array.from(
    new Set(analyzedRows.map((item) => item.rawDivision).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const detectedDivisionNorms = Array.from(
    new Set(analyzedRows.map((item) => item.normalizedDivision).filter(Boolean))
  );

  const hasDivisionSignals = detectedDivisionNorms.length > 0;
  const hasMultipleDivisions = detectedDivisionNorms.length > 1;
  const hasRowsOutsideSelected = analyzedRows.some(
    (item) => item.normalizedDivision && item.normalizedDivision !== selectedDivisionNorm
  );

  if (!hasDivisionSignals) {
    return {
      rows,
      filterApplied: false,
      detectedDivisions,
      matchedRowCount: rows.length,
      ignoredRowCount: 0,
      warnings: [],
      error: null,
    };
  }

  const matchedRows = analyzedRows
    .filter((item) => item.normalizedDivision === selectedDivisionNorm)
    .map((item) => item.row);

  if (!matchedRows.length) {
    return {
      rows: [],
      filterApplied: true,
      detectedDivisions,
      matchedRowCount: 0,
      ignoredRowCount: rows.length,
      warnings: [],
      error: `This file contains division-tagged rows, but none match ${selectedDivision}. Available divisions in the file: ${detectedDivisions.join(", ")}.`,
    };
  }

  const ignoredRowCount = rows.length - matchedRows.length;
  const warnings = [];

  if (hasMultipleDivisions || hasRowsOutsideSelected) {
    warnings.push(
      `Division-aware upload kept ${matchedRows.length} row(s) for ${selectedDivision} and ignored ${ignoredRowCount} row(s) from other division(s).`
    );
  }

  return {
    rows: matchedRows,
    filterApplied: hasMultipleDivisions || hasRowsOutsideSelected,
    detectedDivisions,
    matchedRowCount: matchedRows.length,
    ignoredRowCount,
    warnings,
    error: null,
  };
}

async function buildScheduleUploadPayload({ fileBuffer, termCode, divisionName }) {
  const csvText = fileBuffer.toString("utf-8");
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  const rows = parsed.data.map((row) => {
    const cleaned = {};
    Object.entries(row).forEach(([key, value]) => {
      if (!hiddenColumns.has(key)) cleaned[key] = value;
    });
    return { ...row, __clean: cleaned };
  });

  const divisionScope = analyzeUploadDivisionScope(rows, divisionName);
  if (divisionScope.error) {
    return {
      ok: false,
      status: 400,
      errors: [divisionScope.error],
      warnings: divisionScope.warnings || [],
      unmappedSubjects: [],
      summary: {
        totalRows: rows.length,
        sourceTotalRows: rows.length,
        keptRowsForDivision: 0,
        ignoredRowsFromOtherDivisions: rows.length,
        detectedDivisions: divisionScope.detectedDivisions || [],
        divisionFilterApplied: true,
      },
      rows,
      scopedRows: [],
      scopedSections: [],
    };
  }

  const scopedRows = divisionScope.rows;
  const coverageRows = await getCoverage(termCode);
  const result = parseScheduleRows(scopedRows, coverageRows);
  const combinedWarnings = [...(divisionScope.warnings || []), ...(result.warnings || [])];
  const combinedSummary = {
    ...(result.summary || {}),
    sourceTotalRows: rows.length,
    keptRowsForDivision: scopedRows.length,
    ignoredRowsFromOtherDivisions: divisionScope.ignoredRowCount || 0,
    detectedDivisions: divisionScope.detectedDivisions || [],
    divisionFilterApplied: Boolean(divisionScope.filterApplied),
  };

  if (result.errors.length) {
    return {
      ok: false,
      status: 400,
      errors: result.errors,
      warnings: combinedWarnings,
      unmappedSubjects: result.unmappedSubjects || [],
      summary: combinedSummary,
      rows,
      scopedRows,
      scopedSections: [],
    };
  }

  const normalizedUploadDivision = normalizeDivisionName(divisionName);
  const divisionMismatchRows = [];
  const scopedSections = [];

  for (const section of result.sections || []) {
    const sectionDivision = normalize(section.division);
    const normalizedSectionDivision = normalizeDivisionName(sectionDivision || divisionName);

    if (sectionDivision && normalizedSectionDivision !== normalizedUploadDivision) {
      divisionMismatchRows.push({
        assignment_group_id: section.assignment_group_id,
        primary_subject_course: section.primary_subject_course,
        primary_crn: section.primary_crn,
        foundDivision: section.division,
      });
      continue;
    }

    scopedSections.push({ ...section, division: sectionDivision || divisionName });
  }

  if (divisionMismatchRows.length) {
    combinedWarnings.push(
      `Ignored ${divisionMismatchRows.length} parsed assignment group(s) that resolved to a different division than ${divisionName}.`
    );
    combinedSummary.filteredOutSectionBundles = divisionMismatchRows.length;
    combinedSummary.mismatchedRows = divisionMismatchRows.slice(0, 10);
  }

  if (!scopedSections.length) {
    return {
      ok: false,
      status: 400,
      errors: [`No open section bundles matched ${divisionName} after division-aware filtering.`],
      warnings: combinedWarnings,
      unmappedSubjects: result.unmappedSubjects || [],
      summary: {
        ...combinedSummary,
        divisionName,
      },
      rows,
      scopedRows,
      scopedSections,
    };
  }

  return {
    ok: true,
    status: 200,
    errors: [],
    warnings: combinedWarnings,
    unmappedSubjects: result.unmappedSubjects || [],
    summary: {
      ...combinedSummary,
      divisionName,
      importedSectionBundles: scopedSections.length,
    },
    rows,
    scopedRows,
    scopedSections,
  };
}


async function runSchema() {
  try {
    const schema = fs.readFileSync("./schema.sql", "utf-8");
    await pool.query(schema);
    await ensureAssignmentGroupColumns();
    await ensureAssignmentIndexes();
    await ensureDefaultTerms();
    console.log("Schema loaded successfully");
  } catch (err) {
    console.error("Error loading schema:", err.message);
  }
}

function parseScheduleRows(rows, coverageRows) {
  const crnRows = new Map();

  rows.forEach((row) => {
    const crn = normalize(row.CRN);
    if (!crn) return;
    if (!crnRows.has(crn)) crnRows.set(crn, []);
    crnRows.get(crn).push(row);
  });

  const graph = new Map();

  const ensureNode = (crn) => {
    if (!graph.has(crn)) graph.set(crn, new Set());
    graph.get(crn).add(crn);
  };

  Array.from(crnRows.keys()).forEach(ensureNode);

  const crossListMap = new Map();

  rows.forEach((row) => {
    const crn = normalize(row.CRN);
    if (!crn) return;

    ensureNode(crn);

    const coreq = normalize(row.COREQUISITE_CRN);
    if (coreq) {
      ensureNode(coreq);
      graph.get(crn).add(coreq);
      graph.get(coreq).add(crn);
    }

    const crossListCode = normalize(row.CROSS_LIST);
    if (crossListCode) {
      if (!crossListMap.has(crossListCode)) crossListMap.set(crossListCode, new Set());
      crossListMap.get(crossListCode).add(crn);
    }
  });

  for (const [, crnSet] of crossListMap.entries()) {
    const crns = Array.from(crnSet);
    for (let i = 0; i < crns.length; i += 1) {
      ensureNode(crns[i]);
      for (let j = i + 1; j < crns.length; j += 1) {
        ensureNode(crns[j]);
        graph.get(crns[i]).add(crns[j]);
        graph.get(crns[j]).add(crns[i]);
      }
    }
  }

  const visited = new Set();
  const clusters = [];

  for (const crn of graph.keys()) {
    if (visited.has(crn)) continue;

    const stack = [crn];
    const cluster = new Set();

    while (stack.length) {
      const current = stack.pop();
      if (visited.has(current)) continue;

      visited.add(current);
      cluster.add(current);

      Array.from(graph.get(current) || []).forEach((neighbor) => {
        if (!visited.has(neighbor)) stack.push(neighbor);
      });
    }

    clusters.push(Array.from(cluster).sort());
  }

  const errors = [];
  const warnings = [];
  let crossListedGroupCount = 0;
  let corequisiteGroupCount = 0;
  let multiRowCrnGroups = 0;
  let mixedInstructorGroupCount = 0;
  let skippedAssignedGroupCount = 0;
  const unmappedSubjects = [];

  const parsedSections = clusters.map((cluster) => {
    cluster.forEach((crn) => {
      if (!crnRows.has(crn)) {
        errors.push(`CRN ${crn} is referenced by COREQUISITE_CRN but is missing from the upload.`);
      }
    });

    const bundleRows = cluster.flatMap((crn) => crnRows.get(crn) || []);
    const instructorValues = Array.from(
      new Set(bundleRows.map((r) => normalizeInstructor(r.INSTRUCTOR)).filter(Boolean))
    );
    const realInstructorValues = instructorValues.filter(
      (value) => value.toLowerCase() !== "staff"
    );

    if (realInstructorValues.length > 1) {
      mixedInstructorGroupCount += 1;
      errors.push(
        `Bundle ${cluster.join(", ")} has multiple assigned instructors: ${realInstructorValues.join(", ")}. Fix the source schedule and reupload.`
      );
    }

    const isOpenStaffBundle = realInstructorValues.length === 0;
    if (!isOpenStaffBundle) {
      skippedAssignedGroupCount += 1;
    }

    const hasCross = bundleRows.some((r) => normalize(r.CROSS_LIST));
    const hasCoreq = bundleRows.some((r) => normalize(r.COREQUISITE_CRN));
    if (hasCross) crossListedGroupCount += 1;
    if (hasCoreq) corequisiteGroupCount += 1;

    if (
      Array.from(new Set(bundleRows.map((r) => normalize(r.CRN)))).some(
        (crn) => (crnRows.get(crn) || []).length > 1
      )
    ) {
      multiRowCrnGroups += 1;
    }

    const first = bundleRows[0] || {};
    const rawInstructionalMethod = resolveInstructionalMethod(bundleRows);
    const instructionalMethod = canonicalizeInstructionalMethod(rawInstructionalMethod, bundleRows);
    const rawModality = resolveRawModality(bundleRows);

    const meetings = [];
    const meetingSeen = new Set();

    bundleRows.forEach((row) => {
      const key = [
        normalize(row.DAYS),
        normalize(row.START_TIME),
        normalize(row.END_TIME),
        normalize(row.BUILDING),
        normalize(row.ROOM),
      ].join("|");

      if (meetingSeen.has(key)) return;
      meetingSeen.add(key);

      meetings.push({
        days: normalize(row.DAYS),
        start_time: normalize(row.START_TIME),
        end_time: normalize(row.END_TIME),
        building: normalize(row.BUILDING),
        room: normalize(row.ROOM),
      });
    });

    const allSubjectCourses = Array.from(
      new Set(bundleRows.map((r) => normalize(r.SUBJECT_COURSE)).filter(Boolean))
    );

    const allTitles = Array.from(
      new Set(bundleRows.map((r) => normalize(r.TITLE)).filter(Boolean))
    );

    const allUnits = Array.from(
      new Set(bundleRows.map((r) => Number(normalize(r.UNITS || r.HOURS || 0)) || 0))
    ).filter(Boolean);

    const crossListCodes = Array.from(
      new Set(bundleRows.map((r) => normalize(r.CROSS_LIST)).filter(Boolean))
    );

    const coreqGroup = Array.from(
      new Set(bundleRows.map((r) => normalize(r.COREQUISITE_CRN)).filter(Boolean))
    );

    const { disciplineCode, divisionName: inferredDivisionName, subjectCode } = inferDiscipline(first.SUBJECT_COURSE, coverageRows);

    if (!disciplineCode) {
      const unresolvedSubjectCode =
        subjectCode || normalize(first.SUBJECT_COURSE) || "UNKNOWN SUBJECT";

      warnings.push(
        `Unmapped subject ${unresolvedSubjectCode} for CRN group ${cluster.join(", ")}`
      );

      unmappedSubjects.push({
        subject_code: unresolvedSubjectCode,
        discipline_code: "",
        example_crn_group: cluster.join(", "),
      });
    }

    const displayModality =
      mapInstructionalMethodToDisplayModality(instructionalMethod, bundleRows) ||
      toFriendlyModality(rawModality, bundleRows);

    return {
      assignment_group_id: `grp_${cluster.join("_")}`,
      discipline_code: disciplineCode,
      primary_subject_course: allSubjectCourses.join(" / ") || "Unknown",
      primary_crn: cluster[0],
      all_crns: cluster,
      title: allTitles.join(" / ") || normalize(first.TITLE) || "Untitled",
      division: getFirstBundleValue(bundleRows, ["DIVISION", "division", "Division"]) || inferredDivisionName || "",
      modality: rawModality,
      instructional_method: instructionalMethod,
      display_modality: displayModality,
      campus: getFirstBundleValue(bundleRows, ["CAMPUS", "campus", "Campus"]),
      units: allUnits,
      meetings,
      pt_eligible: isOpenStaffBundle,
      assigned_instructor: realInstructorValues[0] || null,
      is_grouped: cluster.length > 1 || bundleRows.length > 1,
      cross_list_group: crossListCodes.length ? crossListCodes : null,
      corequisite_group: coreqGroup.length ? coreqGroup : null,
      subject_code: subjectCode || null,
    };
  });

  const mappedSections = parsedSections.filter((s) => s.discipline_code);
  const importableSections = mappedSections.filter((s) => s.pt_eligible);
  const uniqueUnmappedSubjects = Array.from(
    new Map(
      unmappedSubjects.map((row) => [
        `${row.subject_code}__${row.example_crn_group}`,
        row,
      ])
    ).values()
  );

  return {
    errors,
    warnings,
    sections: importableSections,
    unmappedSubjects: uniqueUnmappedSubjects,
    summary: {
      totalRows: rows.length,
      totalCrns: crnRows.size,
      assignmentGroups: parsedSections.length,
      mappedAssignmentGroups: mappedSections.length,
      unmappedAssignmentGroups: parsedSections.filter((s) => !s.discipline_code).length,
      importableOpenGroups: importableSections.length,
      skippedAssignedGroups: skippedAssignedGroupCount,
      mixedInstructorGroups: mixedInstructorGroupCount,
      crossListedGroups: crossListedGroupCount,
      corequisiteGroups: corequisiteGroupCount,
      multiRowCrnGroups,
    },
  };
}



app.get("/api/preferences", async (req, res) => {
  try {
    const { termCode, facultyId } = req.query;

    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const params = [termCode];
    let whereClause = "WHERE fp.term_code = $1";

    if (facultyId) {
      params.push(facultyId);
      whereClause += ` AND fp.faculty_id = $${params.length}`;
    }

    const result = await pool.query(
      `
        SELECT
          fp.id,
          fp.faculty_id,
          fp.employee_id,
          fp.faculty_name,
          fp.term_code,
          fp.assignment_group_id,
          fp.discipline_code,
          fp.preference_rank,
          fp.created_at,
          ag.primary_subject_course,
          ag.primary_crn,
          ag.title,
          ag.division,
          ag.modality,
          ag.instructional_method,
          ag.display_modality,
          ag.campus,
          ag.units,
          COALESCE(
            json_agg(
              json_build_object(
                'days', agm.days,
                'start_time', agm.start_time,
                'end_time', agm.end_time,
                'building', agm.building,
                'room', agm.room
              )
              ORDER BY agm.days NULLS LAST, agm.start_time NULLS LAST, agm.end_time NULLS LAST
            ) FILTER (WHERE agm.id IS NOT NULL),
            '[]'::json
          ) AS meetings
        FROM faculty_preferences fp
        LEFT JOIN assignment_groups ag
          ON fp.assignment_group_id = ag.assignment_group_id
         AND fp.term_code = ag.term_code
        LEFT JOIN assignment_group_meetings agm
          ON ag.assignment_group_id = agm.assignment_group_id
        ${whereClause}
        GROUP BY
          fp.id,
          fp.faculty_id,
          fp.employee_id,
          fp.faculty_name,
          fp.term_code,
          fp.assignment_group_id,
          fp.discipline_code,
          fp.preference_rank,
          fp.created_at,
          ag.primary_subject_course,
          ag.primary_crn,
          ag.title,
          ag.division,
          ag.modality,
          ag.instructional_method,
          ag.display_modality,
          ag.campus,
          ag.units
        ORDER BY fp.faculty_name NULLS LAST, fp.faculty_id, fp.preference_rank
      `,
      params
    );

    res.json({ ok: true, preferences: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/preferences", async (req, res) => {
  try {
    const { termCode, facultyId, employeeId, facultyName, preferences } = req.body || {};

    if (!termCode || !facultyId || !Array.isArray(preferences)) {
      return res.status(400).json({ error: "termCode, facultyId, and preferences are required." });
    }

    const cleanedPreferences = preferences
      .map((item, index) => ({
        assignment_group_id: String(item?.assignment_group_id || "").trim(),
        discipline_code: String(item?.discipline_code || "").trim(),
        preference_rank: Number.isFinite(Number(item?.preference_rank))
          ? Number(item.preference_rank)
          : index + 1,
      }))
      .filter((item) => item.assignment_group_id);

    const duplicateGroups = cleanedPreferences
      .map((item) => item.assignment_group_id)
      .filter((value, index, arr) => arr.indexOf(value) !== index);

    if (duplicateGroups.length) {
      return res.status(400).json({ error: "Duplicate section preferences are not allowed.", duplicates: duplicateGroups });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM faculty_preferences
         WHERE term_code = $1 AND faculty_id = $2`,
        [termCode, facultyId]
      );

      for (let index = 0; index < cleanedPreferences.length; index += 1) {
        const item = cleanedPreferences[index];
        await client.query(
          `INSERT INTO faculty_preferences (
            faculty_id,
            employee_id,
            faculty_name,
            term_code,
            assignment_group_id,
            discipline_code,
            preference_rank
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            facultyId,
            employeeId || null,
            facultyName || null,
            termCode,
            item.assignment_group_id,
            item.discipline_code || null,
            index + 1,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, savedCount: cleanedPreferences.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/preferences/export", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.query;
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const params = [termCode];
    let whereClause = "WHERE fp.term_code = $1";
    if (disciplineCode) {
      params.push(disciplineCode);
      whereClause += ` AND fp.discipline_code = $${params.length}`;
    }

    const result = await pool.query(
      `
        SELECT
          fp.discipline_code,
          fp.faculty_name,
          fp.employee_id,
          fp.preference_rank,
          ag.primary_subject_course,
          ag.primary_crn,
          ag.title,
          ag.division,
          ag.campus,
          ag.instructional_method,
          COALESCE(ag.display_modality, ag.modality) AS modality
        FROM faculty_preferences fp
        LEFT JOIN assignment_groups ag
          ON fp.assignment_group_id = ag.assignment_group_id
         AND fp.term_code = ag.term_code
        ${whereClause}
        ORDER BY fp.discipline_code, fp.faculty_name, fp.preference_rank
      `,
      params
    );

    const header = [
      "discipline_code",
      "faculty_name",
      "employee_id",
      "preference_rank",
      "course",
      "crn",
      "title",
      "division",
      "campus",
      "instructional_method",
      "modality",
    ];

    const escapeCell = (value) => {
      const safe = String(value ?? "");
      const escaped = safe.replace(/"/g, '""');
      return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
    };

    const csv = [
      header.join(","),
      ...result.rows.map((row) =>
        [
          row.discipline_code,
          row.faculty_name,
          row.employee_id,
          row.preference_rank,
          row.primary_subject_course,
          row.primary_crn,
          row.title,
          row.division,
          row.campus,
          row.instructional_method,
          row.modality,
        ].map(escapeCell).join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${termCode.toLowerCase()}-faculty-preferences.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/available-sections", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.query;

    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const params = [termCode];
    let whereClause = "WHERE ag.term_code = $1 AND COALESCE(ag.pt_eligible, true) = true";

    if (disciplineCode) {
      params.push(disciplineCode);
      whereClause += ` AND ag.discipline_code = $${params.length}`;
    }

    const result = await pool.query(
      `
        SELECT
          ag.term_code,
          ag.discipline_code,
          ag.assignment_group_id,
          ag.primary_subject_course,
          ag.primary_crn,
          ag.all_crns,
          ag.title,
          ag.division,
          ag.modality,
          ag.instructional_method,
          ag.display_modality,
          ag.campus,
          ag.units,
          ag.pt_eligible,
          ag.is_grouped,
          COALESCE(
            json_agg(
              json_build_object(
                'days', agm.days,
                'start_time', agm.start_time,
                'end_time', agm.end_time,
                'building', agm.building,
                'room', agm.room
              )
              ORDER BY agm.days NULLS LAST, agm.start_time NULLS LAST, agm.end_time NULLS LAST
            ) FILTER (WHERE agm.id IS NOT NULL),
            '[]'::json
          ) AS meetings
        FROM assignment_groups ag
        LEFT JOIN assignment_group_meetings agm
          ON ag.assignment_group_id = agm.assignment_group_id
        ${whereClause}
        GROUP BY
          ag.term_code,
          ag.discipline_code,
          ag.assignment_group_id,
          ag.primary_subject_course,
          ag.primary_crn,
          ag.all_crns,
          ag.title,
          ag.division,
          ag.modality,
          ag.instructional_method,
          ag.display_modality,
          ag.campus,
          ag.units,
          ag.pt_eligible,
          ag.is_grouped
        ORDER BY ag.discipline_code, ag.primary_subject_course, ag.primary_crn
      `,
      params
    );

    res.json({
      ok: true,
      sections: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/terms", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, term_code, term_name, is_active
       FROM terms
       ORDER BY is_active DESC, created_at DESC, term_name`
    );
    res.json({ ok: true, terms: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/terms", async (req, res) => {
  try {
    const { termCode, termName, isActive } = req.body || {};
    if (!termCode || !termName) {
      return res.status(400).json({ error: "termCode and termName are required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (isActive) {
        await client.query(`UPDATE terms SET is_active = false WHERE is_active = true`);
      }
      const result = await client.query(
        `INSERT INTO terms (term_code, term_name, is_active)
         VALUES ($1, $2, $3)
         ON CONFLICT (term_code)
         DO UPDATE SET term_name = EXCLUDED.term_name, is_active = EXCLUDED.is_active
         RETURNING id, term_code, term_name, is_active`,
        [String(termCode).trim().toUpperCase(), String(termName).trim(), Boolean(isActive)]
      );
      await client.query("COMMIT");
      res.json({ ok: true, term: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/terms/activate", async (req, res) => {
  try {
    const { termCode } = req.body || {};
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE terms SET is_active = false WHERE is_active = true`);
      const result = await client.query(
        `UPDATE terms
         SET is_active = true
         WHERE term_code = $1
         RETURNING id, term_code, term_name, is_active`,
        [String(termCode).trim().toUpperCase()]
      );
      await client.query("COMMIT");

      if (!result.rows.length) {
        return res.status(404).json({ error: "Term not found." });
      }

      res.json({ ok: true, term: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT NOW()");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/upload/schedule/preview", upload.single("file"), async (req, res) => {
  try {
    const { termCode, divisionName } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }
    if (!divisionName) {
      return res.status(400).json({ error: "divisionName is required." });
    }

    const payload = await buildScheduleUploadPayload({
      fileBuffer: req.file.buffer,
      termCode,
      divisionName,
    });

    const client = await pool.connect();
    try {
      const uploadImpact = await getDivisionUploadImpact(client, termCode, divisionName);
      const protectedWorkCount = Object.entries(uploadImpact.counts)
        .filter(([key]) => key !== "sections")
        .reduce((sum, [, value]) => sum + Number(value || 0), 0);

      return res.status(payload.status || 200).json({
        ok: payload.ok,
        errors: payload.errors || [],
        warnings: payload.warnings || [],
        unmappedSubjects: payload.unmappedSubjects || [],
        summary: payload.summary || null,
        divisionName,
        impact: {
          ...uploadImpact.counts,
          hasProtectedWork: protectedWorkCount > 0,
        },
      });
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload/schedule", upload.single("file"), async (req, res) => {
  try {
    const { termCode, divisionName, forceReplace } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }
    if (!divisionName) {
      return res.status(400).json({ error: "divisionName is required." });
    }

    const payload = await buildScheduleUploadPayload({
      fileBuffer: req.file.buffer,
      termCode,
      divisionName,
    });

    if (!payload.ok) {
      return res.status(payload.status || 400).json({
        ok: false,
        errors: payload.errors || [],
        warnings: payload.warnings || [],
        unmappedSubjects: payload.unmappedSubjects || [],
        summary: payload.summary || null,
      });
    }

    const combinedWarnings = payload.warnings || [];
    const combinedSummary = payload.summary || {};
    const scopedSections = payload.scopedSections || [];
    const normalizedUploadDivision = normalizeDivisionName(divisionName);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const uploadImpact = await getDivisionUploadImpact(client, termCode, divisionName);
      const protectedWorkCount = Object.entries(uploadImpact.counts)
        .filter(([key]) => key !== "sections")
        .reduce((sum, [, value]) => sum + Number(value || 0), 0);

      if (uploadImpact.counts.sections > 0 && protectedWorkCount > 0 && String(forceReplace).toLowerCase() !== "true") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          ok: false,
          code: "existing_work_detected",
          error: `Replacing ${divisionName} for ${termCode} will remove schedule bundles that already have related staffing work attached.`,
          divisionName,
          protectedWork: uploadImpact.counts,
        });
      }

      await client.query(
        `DELETE FROM assignment_group_meetings
         WHERE assignment_group_id IN (
           SELECT assignment_group_id FROM assignment_groups
           WHERE term_code = $1
             AND LOWER(REPLACE(COALESCE(division, ''), '&', 'and')) = $2
         )`,
        [termCode, normalizedUploadDivision]
      );

      await client.query(
        `DELETE FROM assignment_groups
         WHERE term_code = $1
           AND LOWER(REPLACE(COALESCE(division, ''), '&', 'and')) = $2`,
        [termCode, normalizedUploadDivision]
      );

      for (const section of scopedSections) {
        await client.query(
          `INSERT INTO assignment_groups (
            term_code,
            discipline_code,
            assignment_group_id,
            primary_subject_course,
            primary_crn,
            all_crns,
            title,
            division,
            modality,
            instructional_method,
            display_modality,
            campus,
            units,
            pt_eligible,
            is_grouped
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            termCode,
            section.discipline_code,
            section.assignment_group_id,
            section.primary_subject_course,
            section.primary_crn,
            JSON.stringify(section.all_crns),
            section.title,
            section.division,
            section.modality,
            section.instructional_method,
            section.display_modality,
            section.campus,
            JSON.stringify(section.units),
            section.pt_eligible,
            section.is_grouped,
          ]
        );

        for (const meeting of section.meetings) {
          await client.query(
            `INSERT INTO assignment_group_meetings (
              assignment_group_id,
              days,
              start_time,
              end_time,
              building,
              room
            ) VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              section.assignment_group_id,
              meeting.days,
              meeting.start_time,
              meeting.end_time,
              meeting.building,
              meeting.room,
            ]
          );
        }
      }

      await writeDecisionLog(client, {
        termCode,
        disciplineCode: normalizedUploadDivision.toUpperCase(),
        actorName: "Scheduler / Admin",
        eventType: uploadImpact.counts.sections > 0 ? "schedule_reupload" : "schedule_upload",
        detail: `${divisionName} upload imported ${scopedSections.length} bundle(s) for ${termCode}${uploadImpact.counts.sections > 0 ? ` and replaced ${uploadImpact.counts.sections} existing bundle(s)` : ""}.`,
      });

      await client.query("COMMIT");

      res.json({
        ok: true,
        importedCount: scopedSections.length,
        warnings: combinedWarnings,
        unmappedSubjects: payload.unmappedSubjects || [],
        divisionName,
        replacedCount: uploadImpact.counts.sections || 0,
        protectedWork: uploadImpact.counts,
        summary: combinedSummary,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload/seniority", async (req, res) => {
  try {
    const { termCode, rows } = req.body;

    if (!termCode || !Array.isArray(rows)) {
      return res.status(400).json({ error: "termCode and rows are required." });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const disciplineCodes = Array.from(new Set(rows.map((r) => r.discipline_code)));

      if (disciplineCodes.length) {
        await client.query(
          `DELETE FROM discipline_seniority
           WHERE term_code = $1
           AND discipline_code = ANY($2::text[])`,
          [termCode, disciplineCodes]
        );

        await client.query(
          `DELETE FROM discipline_subject_coverage
           WHERE term_code = $1
           AND discipline_code = ANY($2::text[])`,
          [termCode, disciplineCodes]
        );
      }

      for (const row of rows) {
        await client.query(
          `INSERT INTO faculty (employee_id, first_name, last_name, email)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (employee_id)
           DO UPDATE SET first_name = EXCLUDED.first_name,
                         last_name = EXCLUDED.last_name,
                         email = EXCLUDED.email`,
          [row.employee_id, row.first_name, row.last_name, row.email]
        );

        await client.query(
          `INSERT INTO discipline_seniority (
            term_code,
            discipline_code,
            employee_id,
            seniority_date,
            seniority_rank,
            active_flag,
            covered_subject_codes,
            notes
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            termCode,
            row.discipline_code,
            row.employee_id,
            row.seniority_date,
            row.seniority_rank,
            row.active_flag ?? true,
            row.covered_subject_codes,
            row.notes || "",
          ]
        );

        const covered = String(row.covered_subject_codes || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);

        for (const subjectCode of covered) {
          await client.query(
            `INSERT INTO discipline_subject_coverage (term_code, discipline_code, subject_code)
             VALUES ($1,$2,$3)`,
            [termCode, row.discipline_code, subjectCode]
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.json({ ok: true, importedRows: rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.get("/api/subject-mapping/:termCode/status", async (req, res) => {
  try {
    const { termCode } = req.params;
    const status = await getSubjectMappingStatus(termCode);
    res.json({ ok: true, ...status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.get("/api/subject-mapping", async (req, res) => {
  try {
    const scope = String(req.query.scope || "global").toLowerCase();
    const termCode = normalize(req.query.termCode || "");
    const useTerm = scope === "term" && termCode;

    const result = await query(
      `SELECT subject_code, discipline_code, term_code, created_at
       FROM subject_mappings
       WHERE ` + (useTerm ? `term_code = $1` : `term_code IS NULL`) + `
       ORDER BY subject_code, discipline_code`,
      useTerm ? [termCode] : []
    );

    res.json({
      ok: true,
      scope: useTerm ? "term" : "global",
      termCode: useTerm ? termCode : null,
      count: result.rows.length,
      mappings: result.rows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/subject-mapping/export", async (req, res) => {
  try {
    const scope = String(req.query.scope || "global").toLowerCase();
    const termCode = normalize(req.query.termCode || "");
    const useTerm = scope === "term" && termCode;

    const result = await query(
      `SELECT subject_code, discipline_code
       FROM subject_mappings
       WHERE ` + (useTerm ? `term_code = $1` : `term_code IS NULL`) + `
       ORDER BY subject_code, discipline_code`,
      useTerm ? [termCode] : []
    );

    const header = "subject_code,discipline_code\n";
    const body = result.rows
      .map((row) => `${row.subject_code},${row.discipline_code}`)
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${useTerm ? `${termCode.toLowerCase()}-subject-mapping.csv` : "subject-mapping.csv"}"`
    );
    res.send(header + body + (body ? "\n" : ""));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/upload/subject-mapping", upload.single("file"), async (req, res) => {
  try {
    const { termCode } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const csvText = req.file.buffer.toString("utf-8");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    if (parsed.errors?.length) {
      return res.status(400).json({
        error: "CSV parse error.",
        parseErrors: parsed.errors.map((err) => ({
          row: err.row,
          code: err.code,
          message: err.message,
        })),
      });
    }

    const rows = parsed.data
      .map((row, index) => {
        const normalizedRow = normalizeParsedRowKeys(row);
        const subjectCode = normalize(
          normalizedRow.subject_code || normalizedRow.subject || normalizedRow.banner_subject
        ).toUpperCase();
        const disciplineCode = normalize(
          normalizedRow.discipline_code || normalizedRow.discipline || normalizedRow.discipline_name
        ).toUpperCase();

        return {
          rowNumber: index + 2,
          subject_code: subjectCode,
          discipline_code: disciplineCode,
        };
      })
      .filter((row) => row.subject_code || row.discipline_code);

    const badRows = rows.filter((row) => !row.subject_code || !row.discipline_code);
    if (badRows.length) {
      return res.status(400).json({
        error: "Each row must contain subject_code and discipline_code.",
        rejectedRows: badRows.map((row) => ({
          rowNumber: row.rowNumber,
          subject_code: row.subject_code,
          discipline_code: row.discipline_code,
        })),
      });
    }

    const dedupedRows = Array.from(
      rows.reduce((map, row) => {
        map.set(row.subject_code, row);
        return map;
      }, new Map()).values()
    );

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM subject_mappings
         WHERE term_code IS NULL`
      );

      for (const row of dedupedRows) {
        await client.query(
          `INSERT INTO subject_mappings (term_code, discipline_code, subject_code)
           VALUES (NULL, $1, $2)`,
          [row.discipline_code, row.subject_code]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const status = await getSubjectMappingStatus(termCode || "FA27");

    res.json({
      ok: true,
      importedRows: dedupedRows.length,
      globalCount: status.globalCount,
      termCount: status.termCount,
      scope: "global",
      message: "Global subject mapping saved. Future schedule uploads will reuse it automatically.",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/sections/:termCode/:disciplineCode", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.params;

    const groups = await query(
      `SELECT * FROM assignment_groups
       WHERE term_code = $1 AND discipline_code = $2
       ORDER BY primary_subject_course, primary_crn`,
      [termCode, disciplineCode]
    );

    const meetings = await query(
      `SELECT * FROM assignment_group_meetings
       WHERE assignment_group_id IN (
         SELECT assignment_group_id FROM assignment_groups
         WHERE term_code = $1 AND discipline_code = $2
       )`,
      [termCode, disciplineCode]
    );

    const meetingMap = new Map();
    meetings.rows.forEach((m) => {
      if (!meetingMap.has(m.assignment_group_id)) meetingMap.set(m.assignment_group_id, []);
      meetingMap.get(m.assignment_group_id).push(m);
    });

    const data = groups.rows.map((group) => ({
      ...group,
      all_crns: JSON.parse(group.all_crns || "[]"),
      units: JSON.parse(group.units || "[]"),
      meetings: meetingMap.get(group.assignment_group_id) || [],
    }));

    res.json({ ok: true, sections: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disciplines/open", async (req, res) => {
  try {
    const { termCode, disciplineCode, opensAt, closesAt } = req.body;

    await query(
      `INSERT INTO discipline_windows (term_code, discipline_code, opens_at, closes_at, status)
       VALUES ($1,$2,$3,$4,'open')
       ON CONFLICT DO NOTHING`,
      [termCode, disciplineCode, opensAt, closesAt]
    );

    await query(
      `UPDATE discipline_windows
       SET opens_at = $3, closes_at = $4, status = 'open'
       WHERE term_code = $1 AND discipline_code = $2`,
      [termCode, disciplineCode, opensAt, closesAt]
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/faculty/submission", async (req, res) => {
  try {
    const { termCode, disciplineCode, employeeId, selections, generalInterests } = req.body;

    const submissionResult = await query(
      `INSERT INTO faculty_submissions (
        term_code,
        discipline_code,
        employee_id,
        submitted,
        submitted_at,
        general_interests
      ) VALUES ($1,$2,$3,TRUE,NOW(),$4)
      RETURNING id`,
      [termCode, disciplineCode, employeeId, JSON.stringify(generalInterests || [])]
    );

    const submissionId = submissionResult.rows[0].id;

    for (let i = 0; i < selections.length; i += 1) {
      await query(
        `INSERT INTO faculty_ranked_preferences (
          submission_id,
          assignment_group_id,
          preference_rank
        ) VALUES ($1,$2,$3)`,
        [submissionId, selections[i], i + 1]
      );
    }

    await writeDecisionLog(pool, {
      termCode,
      disciplineCode,
      actorName: employeeId || "Faculty",
      eventType: "faculty_submission",
      detail: `${employeeId || "Faculty"} submitted ${selections.length} ranked preference(s).`,
    });

    res.json({ ok: true, submissionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.get("/api/division-statuses", async (req, res) => {
  try {
    const { termCode } = req.query;
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const divisionsResult = await pool.query(
      `SELECT
         division,
         COUNT(*)::int AS section_count
       FROM assignment_groups
       WHERE term_code = $1
         AND COALESCE(division, '') <> ''
       GROUP BY division
       ORDER BY division`,
      [termCode]
    );

    const prefsResult = await pool.query(
      `SELECT
         ag.division,
         COUNT(*)::int AS count
       FROM faculty_preferences fp
       INNER JOIN assignment_groups ag
         ON ag.assignment_group_id = fp.assignment_group_id
        AND ag.term_code = fp.term_code
       WHERE fp.term_code = $1
         AND COALESCE(ag.division, '') <> ''
       GROUP BY ag.division`,
      [termCode]
    );

    const assignmentsResult = await pool.query(
      `SELECT
         ag.division,
         COUNT(*) FILTER (WHERE a.status = 'approved')::int AS approved_count,
         COUNT(*) FILTER (WHERE a.status <> 'released' AND a.status <> 'approved')::int AS tentative_count
       FROM assignments a
       INNER JOIN assignment_groups ag
         ON ag.assignment_group_id = a.assignment_group_id
        AND ag.term_code = a.term_code
       WHERE a.term_code = $1
         AND COALESCE(ag.division, '') <> ''
       GROUP BY ag.division`,
      [termCode]
    );

    const submissionsResult = await pool.query(
      `SELECT
         agd.division,
         COUNT(*)::int AS count
       FROM faculty_submissions fs
       INNER JOIN (
         SELECT DISTINCT term_code, discipline_code, division
         FROM assignment_groups
         WHERE term_code = $1
           AND COALESCE(division, '') <> ''
           AND COALESCE(discipline_code, '') <> ''
       ) agd
         ON agd.term_code = fs.term_code
        AND agd.discipline_code = fs.discipline_code
       WHERE fs.term_code = $1
         AND fs.submitted = TRUE
       GROUP BY agd.division`,
      [termCode]
    );

    const windowsResult = await pool.query(
      `SELECT
         agd.division,
         COUNT(*) FILTER (WHERE COALESCE(dw.status, 'ready') = 'chair_finalized')::int AS chair_finalized_count,
         COUNT(*) FILTER (WHERE COALESCE(dw.status, 'ready') = 'dean_approved')::int AS dean_approved_count
       FROM discipline_windows dw
       INNER JOIN (
         SELECT DISTINCT term_code, discipline_code, division
         FROM assignment_groups
         WHERE term_code = $1
           AND COALESCE(division, '') <> ''
           AND COALESCE(discipline_code, '') <> ''
       ) agd
         ON agd.term_code = dw.term_code
        AND agd.discipline_code = dw.discipline_code
       WHERE dw.term_code = $1
       GROUP BY agd.division`,
      [termCode]
    );

    const stats = new Map();
    const ensureDivision = (division) => {
      if (!division) return null;
      if (!stats.has(division)) {
        stats.set(division, {
          division,
          sectionCount: 0,
          preferenceCount: 0,
          submissionCount: 0,
          tentativeAssignmentCount: 0,
          approvedAssignmentCount: 0,
          chairFinalizedCount: 0,
          deanApprovedCount: 0,
        });
      }
      return stats.get(division);
    };

    for (const row of divisionsResult.rows || []) {
      const target = ensureDivision(row.division);
      if (target) target.sectionCount = Number(row.section_count || 0);
    }
    for (const row of prefsResult.rows || []) {
      const target = ensureDivision(row.division);
      if (target) target.preferenceCount = Number(row.count || 0);
    }
    for (const row of assignmentsResult.rows || []) {
      const target = ensureDivision(row.division);
      if (target) {
        target.tentativeAssignmentCount = Number(row.tentative_count || 0);
        target.approvedAssignmentCount = Number(row.approved_count || 0);
      }
    }
    for (const row of submissionsResult.rows || []) {
      const target = ensureDivision(row.division);
      if (target) target.submissionCount = Number(row.count || 0);
    }
    for (const row of windowsResult.rows || []) {
      const target = ensureDivision(row.division);
      if (target) {
        target.chairFinalizedCount = Number(row.chair_finalized_count || 0);
        target.deanApprovedCount = Number(row.dean_approved_count || 0);
      }
    }

    const divisions = Array.from(stats.values())
      .map((row) => {
        let status = "clean";
        if (row.deanApprovedCount > 0 || row.chairFinalizedCount > 0 || row.approvedAssignmentCount > 0) {
          status = "advanced";
        } else if (row.preferenceCount > 0 || row.submissionCount > 0 || row.tentativeAssignmentCount > 0) {
          status = "in_progress";
        } else if (row.sectionCount > 0) {
          status = "loaded";
        }

        return {
          ...row,
          status,
        };
      })
      .sort((a, b) => String(a.division || "").localeCompare(String(b.division || "")));

    res.json({ ok: true, divisions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/assignments", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.query;
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const params = [termCode];
    let whereClause = "WHERE a.term_code = $1";
    if (disciplineCode) {
      params.push(disciplineCode);
      whereClause += ` AND a.discipline_code = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
        a.id,
        a.term_code,
        a.discipline_code,
        a.assignment_group_id,
        a.employee_id,
        a.status,
        a.assigned_at,
        ag.primary_subject_course,
        ag.primary_crn,
        ag.title,
        ag.campus,
        ag.instructional_method,
        ag.display_modality,
        COALESCE(f.first_name || ' ' || f.last_name, a.employee_id) AS faculty_name,
        COALESCE(
          json_agg(
            json_build_object(
              'days', agm.days,
              'start_time', agm.start_time,
              'end_time', agm.end_time,
              'building', agm.building,
              'room', agm.room
            )
            ORDER BY agm.days NULLS LAST, agm.start_time NULLS LAST, agm.end_time NULLS LAST
          ) FILTER (WHERE agm.id IS NOT NULL),
          '[]'::json
        ) AS meetings
       FROM assignments a
       LEFT JOIN assignment_groups ag
         ON ag.assignment_group_id = a.assignment_group_id
        AND ag.term_code = a.term_code
       LEFT JOIN assignment_group_meetings agm
         ON ag.assignment_group_id = agm.assignment_group_id
       LEFT JOIN faculty f
         ON f.employee_id = a.employee_id
       ${whereClause}
       GROUP BY
        a.id,
        a.term_code,
        a.discipline_code,
        a.assignment_group_id,
        a.employee_id,
        a.status,
        a.assigned_at,
        ag.primary_subject_course,
        ag.primary_crn,
        ag.title,
        ag.campus,
        ag.instructional_method,
        ag.display_modality,
        f.first_name,
        f.last_name
       ORDER BY a.assigned_at DESC`,
      params
    );

    res.json({ ok: true, assignments: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/decision-logs", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.query;
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const params = [termCode];
    let whereClause = "WHERE term_code = $1";
    if (disciplineCode && disciplineCode !== "ALL") {
      params.push(disciplineCode);
      whereClause += ` AND discipline_code = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         id,
         term_code,
         discipline_code,
         actor_name,
         event_type,
         detail,
         created_at
       FROM decision_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 200`,
      params
    );

    res.json({ ok: true, logs: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/chair-workflow", async (req, res) => {
  try {
    const { termCode, disciplineCode } = req.query;
    if (!termCode) {
      return res.status(400).json({ error: "termCode is required." });
    }

    const params = [termCode];
    let whereClause = "WHERE fp.term_code = $1";
    if (disciplineCode && disciplineCode !== "ALL") {
      params.push(disciplineCode);
      whereClause += ` AND fp.discipline_code = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         fp.faculty_id,
         fp.employee_id,
         fp.faculty_name,
         fp.term_code,
         fp.assignment_group_id,
         fp.discipline_code,
         fp.preference_rank,
         ag.primary_subject_course,
         ag.primary_crn,
         ag.title,
         ag.division,
         ag.campus,
         ag.instructional_method,
         ag.display_modality,
         ds.seniority_rank,
         ds.seniority_date,
         COALESCE(
           json_agg(
             json_build_object(
               'days', agm.days,
               'start_time', agm.start_time,
               'end_time', agm.end_time,
               'building', agm.building,
               'room', agm.room
             )
             ORDER BY agm.days NULLS LAST, agm.start_time NULLS LAST, agm.end_time NULLS LAST
           ) FILTER (WHERE agm.id IS NOT NULL),
           '[]'::json
         ) AS meetings
       FROM faculty_preferences fp
       LEFT JOIN assignment_groups ag
         ON ag.assignment_group_id = fp.assignment_group_id
        AND ag.term_code = fp.term_code
       LEFT JOIN assignment_group_meetings agm
         ON ag.assignment_group_id = agm.assignment_group_id
       LEFT JOIN discipline_seniority ds
         ON ds.term_code = fp.term_code
        AND ds.discipline_code = fp.discipline_code
        AND ds.employee_id = fp.employee_id
       ${whereClause}
       GROUP BY
         fp.faculty_id,
         fp.employee_id,
         fp.faculty_name,
         fp.term_code,
         fp.assignment_group_id,
         fp.discipline_code,
         fp.preference_rank,
         ag.primary_subject_course,
         ag.primary_crn,
         ag.title,
         ag.division,
         ag.campus,
         ag.instructional_method,
         ag.display_modality,
         ds.seniority_rank,
         ds.seniority_date
       ORDER BY
         COALESCE(ds.seniority_rank, 999999),
         fp.faculty_name,
         fp.preference_rank`,
      params
    );

    res.json({ ok: true, rows: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/assignments", async (req, res) => {
  try {
    const { termCode, disciplineCode, assignmentGroupId, employeeId, actorName, reason } = req.body || {};

    if (!termCode || !disciplineCode || !assignmentGroupId || !employeeId) {
      return res.status(400).json({ error: "termCode, disciplineCode, assignmentGroupId, and employeeId are required." });
    }

    const existingAssignmentResult = await query(
      `SELECT id, employee_id, status
       FROM assignments
       WHERE term_code = $1
         AND assignment_group_id = $2
         AND status <> 'released'
       ORDER BY assigned_at DESC
       LIMIT 1`,
      [termCode, assignmentGroupId]
    );

    const existingAssignment = existingAssignmentResult.rows?.[0];
    if (existingAssignment?.employee_id === employeeId) {
      return res.status(409).json({
        error: "This section is already tentatively assigned to that instructor.",
        code: "duplicate_assignment",
      });
    }

    if (existingAssignment?.employee_id && existingAssignment.employee_id !== employeeId) {
      return res.status(409).json({
        error: "This section already has a tentative assignment. Undo or release it before reassigning.",
        code: "section_already_assigned",
        assignedEmployeeId: existingAssignment.employee_id,
      });
    }

    const existingEmployeeAssignmentsResult = await query(
      `SELECT
         a.id,
         a.assignment_group_id,
         ag.primary_subject_course,
         ag.primary_crn,
         ag.title
       FROM assignments a
       LEFT JOIN assignment_groups ag
         ON ag.assignment_group_id = a.assignment_group_id
        AND ag.term_code = a.term_code
       WHERE a.term_code = $1
         AND a.employee_id = $2
         AND a.assignment_group_id <> $3
         AND a.status <> 'released'`,
      [termCode, employeeId, assignmentGroupId]
    );

    const requestedMeetingsMap = await getMeetingsForAssignmentGroups(termCode, [
      assignmentGroupId,
      ...existingEmployeeAssignmentsResult.rows.map((row) => row.assignment_group_id),
    ]);
    const requestedMeetings = requestedMeetingsMap.get(assignmentGroupId) || [];

    const conflictingAssignment = existingEmployeeAssignmentsResult.rows.find((row) =>
      meetingsOverlap(requestedMeetings, requestedMeetingsMap.get(row.assignment_group_id) || [])
    );

    if (conflictingAssignment) {
      return res.status(409).json({
        error: `Conflict detected. ${employeeId} is already tentatively assigned to ${conflictingAssignment.primary_subject_course || conflictingAssignment.assignment_group_id}${conflictingAssignment.primary_crn ? ` (${conflictingAssignment.primary_crn})` : ""}.`,
        code: "meeting_conflict",
        conflictingAssignmentId: conflictingAssignment.id,
        conflictingAssignmentGroupId: conflictingAssignment.assignment_group_id,
      });
    }

    const inserted = await query(
      `INSERT INTO assignments (
        term_code,
        discipline_code,
        assignment_group_id,
        employee_id,
        status
      ) VALUES ($1,$2,$3,$4,'tentative')
      RETURNING id`,
      [termCode, disciplineCode, assignmentGroupId, employeeId]
    );

    await writeDecisionLog(pool, {
      termCode,
      disciplineCode,
      actorName: actorName || "System",
      eventType: reason ? "bypassed_preference" : "assigned",
      detail: reason
        ? `Assigned ${assignmentGroupId} to ${employeeId} with rationale: ${reason}`
        : `Assigned ${assignmentGroupId} to ${employeeId}`,
    });

    res.json({ ok: true, assignmentId: inserted.rows?.[0]?.id || null, message: `Assigned ${assignmentGroupId} to ${employeeId}.` });
  } catch (error) {
    if (String(error.message || "").includes("assignments_unique_group_per_term")) {
      return res.status(409).json({ error: "This section already has a tentative assignment. Undo or release it before reassigning.", code: "section_already_assigned" });
    }
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/assignments/:id", async (req, res) => {
  try {
    const assignmentId = Number(req.params.id);
    const { actorName } = req.body || {};

    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: "A valid assignment id is required." });
    }

    const existing = await query(
      `SELECT term_code, discipline_code, assignment_group_id, employee_id
       FROM assignments
       WHERE id = $1`,
      [assignmentId]
    );

    const row = existing.rows?.[0];
    if (!row) {
      return res.status(404).json({ error: "Tentative assignment not found." });
    }

    await query(`DELETE FROM assignments WHERE id = $1`, [assignmentId]);

    await writeDecisionLog(pool, {
      termCode: row.term_code,
      disciplineCode: row.discipline_code,
      actorName: actorName || "System",
      eventType: "assignment_removed",
      detail: `Removed tentative assignment ${row.assignment_group_id} from ${row.employee_id}`,
    });

    res.json({ ok: true, message: `Removed ${row.assignment_group_id} from ${row.employee_id}.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.put("/api/assignments/:id/reassign", async (req, res) => {
  try {
    const assignmentId = Number(req.params.id);
    const { employeeId, actorName, reason } = req.body || {};

    if (!Number.isFinite(assignmentId)) {
      return res.status(400).json({ error: "A valid assignment id is required." });
    }
    if (!employeeId) {
      return res.status(400).json({ error: "employeeId is required." });
    }
    if (!normalize(reason)) {
      return res.status(400).json({ error: "A rationale is required when reassigning a section." });
    }

    const existingResult = await query(
      `SELECT
         a.id,
         a.term_code,
         a.discipline_code,
         a.assignment_group_id,
         a.employee_id,
         ag.primary_subject_course,
         ag.primary_crn
       FROM assignments a
       LEFT JOIN assignment_groups ag
         ON ag.assignment_group_id = a.assignment_group_id
        AND ag.term_code = a.term_code
       WHERE a.id = $1`,
      [assignmentId]
    );

    const existing = existingResult.rows?.[0];
    if (!existing) {
      return res.status(404).json({ error: "Tentative assignment not found." });
    }

    if (existing.employee_id === employeeId) {
      return res.status(409).json({ error: "This section is already assigned to that instructor.", code: "duplicate_assignment" });
    }

    const otherAssignmentsResult = await query(
      `SELECT
         a.id,
         a.assignment_group_id,
         ag.primary_subject_course,
         ag.primary_crn,
         ag.title
       FROM assignments a
       LEFT JOIN assignment_groups ag
         ON ag.assignment_group_id = a.assignment_group_id
        AND ag.term_code = a.term_code
       WHERE a.term_code = $1
         AND a.employee_id = $2
         AND a.id <> $3
         AND a.status <> 'released'`,
      [existing.term_code, employeeId, assignmentId]
    );

    const meetingsMap = await getMeetingsForAssignmentGroups(existing.term_code, [
      existing.assignment_group_id,
      ...otherAssignmentsResult.rows.map((row) => row.assignment_group_id),
    ]);
    const requestedMeetings = meetingsMap.get(existing.assignment_group_id) || [];

    const conflictingAssignment = otherAssignmentsResult.rows.find((row) =>
      meetingsOverlap(requestedMeetings, meetingsMap.get(row.assignment_group_id) || [])
    );

    if (conflictingAssignment) {
      return res.status(409).json({
        error: `Conflict detected. ${employeeId} is already tentatively assigned to ${conflictingAssignment.primary_subject_course || conflictingAssignment.assignment_group_id}${conflictingAssignment.primary_crn ? ` (${conflictingAssignment.primary_crn})` : ""}.`,
        code: "meeting_conflict",
        conflictingAssignmentId: conflictingAssignment.id,
        conflictingAssignmentGroupId: conflictingAssignment.assignment_group_id,
      });
    }

    await query(
      `UPDATE assignments
       SET employee_id = $2,
           assigned_at = NOW(),
           discipline_code = COALESCE(NULLIF($3, ''), discipline_code)
       WHERE id = $1`,
      [assignmentId, employeeId, existing.discipline_code]
    );

    await writeDecisionLog(pool, {
      termCode: existing.term_code,
      disciplineCode: existing.discipline_code,
      actorName: actorName || "System",
      eventType: "reassigned",
      detail: `Reassigned ${existing.assignment_group_id} from ${existing.employee_id} to ${employeeId}. Rationale: ${reason}`,
    });

    res.json({
      ok: true,
      message: `Reassigned ${existing.primary_subject_course || existing.assignment_group_id} to ${employeeId}.`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disciplines/finalize", async (req, res) => {
  try {
    const { termCode, disciplineCode, actorName } = req.body;

    await query(
      `UPDATE discipline_windows
       SET status = 'chair_finalized'
       WHERE term_code = $1 AND discipline_code = $2`,
      [termCode, disciplineCode]
    );

    await writeDecisionLog(pool, {
      termCode,
      disciplineCode,
      actorName: actorName || "Division Chair",
      eventType: "chair_finalized",
      detail: `Chair finalized ${disciplineCode} for ${termCode}.`,
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disciplines/dean-approve", async (req, res) => {
  try {
    const { termCode, disciplineCode, actorName } = req.body;

    await query(
      `UPDATE discipline_windows
       SET status = 'dean_approved'
       WHERE term_code = $1 AND discipline_code = $2`,
      [termCode, disciplineCode]
    );

    await query(
      `UPDATE assignments
       SET status = 'approved'
       WHERE term_code = $1 AND discipline_code = $2 AND status <> 'released'`,
      [termCode, disciplineCode]
    );

    await writeDecisionLog(pool, {
      termCode,
      disciplineCode,
      actorName: actorName || "Dean",
      eventType: "dean_approved",
      detail: `Dean approved ${disciplineCode} for ${termCode}.`,
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`Backend running on port ${PORT}`);
  await runSchema();
});
