import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import cosLogo from "./assets/cos-logo.jpg";
import AdminOperationsPanel from "./AdminOperationsPanel";
import { buildInitialPtRoster } from "./adminOpsUtils";
import { loadRoles, loadPTFaculty, saveRoles, savePTFaculty, wipeActivePTRoster } from "./persistenceApi";
import {
  API_BASE,
  acceptInvite,
  apiFetch,
  approveAccountRequest,
  clearApiToken,
  completePasswordReset,
  fetchCurrentUser,
  fetchJson,
  getApiToken,
  getCurrentUser,
  inviteUser,
  loadAccountRequests,
  loadUsers,
  login,
  logout,
  rejectAccountRequest,
  requestAccount,
  requestPasswordReset,
  resendUserInvite,
  sendUserPasswordReset,
  setApiToken,
  updateUser,
} from "./apiClient";

const initialTerms = [];

const initialDisciplines = [
  {
    id: "hist",
    code: "HIST",
    name: "History",
    division: "Social Sciences",
    coveredSubjects: ["HIST"],
    status: "open",
    opensAt: "2027-05-01T09:00",
    closesAt: "2027-05-15T17:00",
    chair: "Dr. Mason",
    dean: "Dean Alvarez",
  },
  {
    id: "math",
    code: "MATH",
    name: "Mathematics",
    division: "Math/Science",
    coveredSubjects: ["MATH", "STAT"],
    status: "ready",
    opensAt: "",
    closesAt: "",
    chair: "Dr. Shah",
    dean: "Dean Kim",
  },
  {
    id: "pols",
    code: "POLS",
    name: "Political Science",
    division: "Social Sciences",
    coveredSubjects: ["POLS"],
    status: "blocked",
    opensAt: "",
    closesAt: "",
    chair: "Dr. Mason",
    dean: "Dean Alvarez",
  },
];

const initialFaculty = [
  { id: "f1", employeeId: "100001", firstName: "Jordan", lastName: "Smith", email: "j.smith@cos.edu" },
  { id: "f2", employeeId: "100002", firstName: "Maria", lastName: "Garcia", email: "m.garcia@cos.edu" },
  { id: "f3", employeeId: "100003", firstName: "Anh", lastName: "Nguyen", email: "a.nguyen@cos.edu" },
  { id: "f4", employeeId: "100004", firstName: "Priya", lastName: "Patel", email: "p.patel@cos.edu" },
  { id: "f5", employeeId: "100005", firstName: "Tomas", lastName: "Lee", email: "t.lee@cos.edu" },
];

const initialSeniority = [
  { disciplineId: "hist", facultyId: "f1", rank: 1, seniorityDate: "2010-08-15", active: true },
  { disciplineId: "hist", facultyId: "f2", rank: 2, seniorityDate: "2012-08-15", active: true },
  { disciplineId: "hist", facultyId: "f3", rank: 3, seniorityDate: "2014-08-15", active: true },
  { disciplineId: "hist", facultyId: "f4", rank: 4, seniorityDate: "2019-08-15", active: true },
  { disciplineId: "hist", facultyId: "f5", rank: 5, seniorityDate: "2021-08-15", active: true },
  { disciplineId: "math", facultyId: "f3", rank: 1, seniorityDate: "2011-08-15", active: true },
  { disciplineId: "math", facultyId: "f4", rank: 2, seniorityDate: "2016-08-15", active: true },
];

const initialChairAssignments = [
  { chairName: "Agriculture Division Chair", divisions: ["Agriculture"] },
  { chairName: "Social Sciences Division Chair", divisions: ["Social Sciences"] },
  { chairName: "Business Division Chair", divisions: ["Business"] },
  { chairName: "Consumer/Family Studies Division Chair", divisions: ["Consumer/Family Studies"] },
  { chairName: "English Division Chair", divisions: ["English"] },
  { chairName: "Fine Arts Division Chair", divisions: ["Fine Arts"] },
  { chairName: "Math & Engineering Division Chair", divisions: ["Math and Engineering"] },
  { chairName: "Science Division Chair", divisions: ["Science"] },
  { chairName: "Language & Communication Stud. Division Chair", divisions: ["Language & Communication Stud."] },
  { chairName: "Library Division Chair", divisions: ["Library"] },
  { chairName: "Physical Education Division Chair", divisions: ["Physical Education"] },
  { chairName: "Nursing Division Chair", divisions: ["Nursing"] },
  { chairName: "Industry & Technology Division Chair", divisions: ["Industry and Technology"] },
  { chairName: "Cosmetology Division Chair", divisions: ["Cosmetology"] },
  { chairName: "Student Services Division Chair", divisions: ["Student Services"] },
  { chairName: "Fire Technology Division Chair", divisions: ["Fire Technology"] },
  { chairName: "Police Sciences Division Chair", divisions: ["Police Science"] },
  { chairName: "Emergency Medical Technician Division Chair", divisions: ["Emergency Medical Technician"] },
];

const initialDeanAssignments = [
  { deanName: "Agriculture Dean", divisions: ["Agriculture"] },
  { deanName: "Social Sciences, Business, Consumer/Family Studies Dean", divisions: ["Social Sciences", "Business", "Consumer/Family Studies"] },
  { deanName: "English, Fine Arts Dean", divisions: ["English", "Fine Arts"] },
  { deanName: "Math & Engineering, Science Dean", divisions: ["Math and Engineering", "Science"] },
  { deanName: "Language & Communication Stud., Library Dean", divisions: ["Language & Communication Stud.", "Library"] },
  { deanName: "Physical Education Dean", divisions: ["Physical Education"] },
  { deanName: "Nursing, Industry & Technology, Cosmetology Dean", divisions: ["Nursing", "Industry and Technology", "Cosmetology"] },
  { deanName: "Student Services Dean", divisions: ["Student Services"] },
  { deanName: "Fire Technology, Police Sciences, Emergency Medical Technician Dean", divisions: ["Fire Technology", "Police Science", "Emergency Medical Technician"] },
];

const initialSections = [];
const initialLinks = [];
const initialSubmissions = [];
const initialAssignments = [];
const initialDecisionLog = [];

const availabilityDayOptions = [
  { key: "M", label: "Mon" },
  { key: "T", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "R", label: "Thu" },
  { key: "F", label: "Fri" },
  { key: "A", label: "Sat" },
  { key: "U", label: "Sun" },
];

const availabilityTimeOptions = [
  { key: "morning", label: "Morning", detail: "7:00-11:00", start: 7 * 60, end: 11 * 60 },
  { key: "afternoon", label: "Afternoon", detail: "11:01-4:00", start: 11 * 60 + 1, end: 16 * 60 },
  { key: "evening", label: "Evening", detail: "4:01-11:00", start: 16 * 60 + 1, end: 23 * 60 },
];

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

const statusColors = {
  blocked: "#fee2e2",
  ready: "#fef3c7",
  open: "#dbeafe",
  closed: "#e5e7eb",
  staffing_in_progress: "#ede9fe",
  chair_finalized: "#ffedd5",
  dean_approved: "#dcfce7",
};

function statusLabel(value) {
  return {
    blocked: "Blocked",
    ready: "Ready",
    open: "Open",
    closed: "Closed",
    staffing_in_progress: "Staffing In Progress",
    chair_finalized: "Pending Dean Approval",
    dean_approved: "Dean Approved",
  }[value] || value;
}

function facultyName(faculty) {
  return `${faculty.firstName} ${faculty.lastName}`;
}

function normalize(s) {
  return String(s ?? "").trim();
}

function compactKey(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitScopeValues(...values) {
  return values
    .flatMap((value) => String(value ?? "").split(/[|,;]/))
    .map(normalize)
    .filter(Boolean);
}

function sectionScopeKeys(section) {
  const raw = section?.raw_row || {};
  const primarySubject = normalize(section?.primary_subject_course).split(/\s+/)[0] || "";
  return new Set(
    splitScopeValues(
      section?.discipline_code,
      section?.subject_code,
      section?.division,
      primarySubject,
      raw.discipline_code,
      raw.discipline,
      raw.DISCIPLINE,
      raw.subject_code,
      raw.Subject,
      raw.SUBJECT,
      raw.division,
      raw.Division,
      raw.DIVISION
    ).map(compactKey).filter(Boolean)
  );
}

function sectionMatchesFacultyScope(section, facultyScopeKeys) {
  if (!facultyScopeKeys.size) return true;
  for (const key of sectionScopeKeys(section)) {
    if (facultyScopeKeys.has(key)) return true;
  }
  return false;
}


function canonicalDivisionName(value) {
  const raw = normalize(value);
  const key = compactKey(raw);
  const aliases = {
    "industrytechnology": "Industry and Technology",
    "industryandtechnology": "Industry and Technology",
    "mathengineering": "Math and Engineering",
    "mathandengineering": "Math and Engineering",
    "policesciences": "Police Science",
    "policescience": "Police Science",
  };
  return aliases[key] || raw;
}

function metricValue(value, fallback = 0) {
  return value ?? fallback;
}

function buildUnmappedSubjectsCsv(rows) {
  const uniqueRows = Array.from(
    new Map((rows || []).map((row) => [row.subject_code, row])).values()
  );

  const lines = [
    "subject_code,discipline_code,example_crn_group",
    ...uniqueRows.map((row) => {
      const cells = [
        row.subject_code || "",
        row.discipline_code || "",
        row.example_crn_group || "",
      ];

      return cells
        .map((value) => {
          const safe = String(value ?? "");
          const escaped = safe.replace(/"/g, '""');
          return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
        })
        .join(",");
    }),
  ];

  return lines.join("\n");
}

function downloadUnmappedSubjectsCsv(rows, fileName) {
  if (!rows?.length) return;

  const csv = buildUnmappedSubjectsCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "unmapped-subjects.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatMeetings(meetings) {
  const rows = (meetings || []).filter(Boolean);
  if (!rows.length) return "No meeting details";
  return rows
    .map((meeting) => {
      const dayPart = meeting.days || "TBA";
      const timePart = [meeting.start_time, meeting.end_time].filter(Boolean).join(" - ") || "Time TBA";
      const roomPart = [meeting.building, meeting.room].filter(Boolean).join(" ");
      return [dayPart, timePart, roomPart].filter(Boolean).join(" - ");
    })
    .join("; ");
}



function linkedSectionCount(section) {
  const rawLinked = Array.isArray(section?.raw_row?.linked_sections) ? section.raw_row.linked_sections : [];
  if (rawLinked.length) return rawLinked.length;
  const crns = String(section?.primary_crn || "").split("/").map((v) => normalize(v)).filter(Boolean);
  return crns.length > 1 ? crns.length : 0;
}

function hasLinkedSections(section) {
  return linkedSectionCount(section) > 1;
}

function formatUnits(units) {
  if (!units) return "";
  if (Array.isArray(units)) return units.join(", ");
  return String(units);
}

function parseUnitsValue(units) {
  try {
    const parsed = typeof units === "string" ? JSON.parse(units) : units;
    if (Array.isArray(parsed)) return parsed.map((x) => Number(x) || 0).reduce((a, b) => a + b, 0);
  } catch (_error) {}
  return Number(units) || 0;
}

function normalizeMeetingPattern(meetings) {
  return (meetings || [])
    .map((meeting) => `${meeting.days || ""}|${meeting.start_time || ""}|${meeting.end_time || ""}`)
    .sort()
    .join(";");
}

function hasMeetingConflict(sectionA, sectionB) {
  return normalizeMeetingPattern(sectionA?.meetings) === normalizeMeetingPattern(sectionB?.meetings)
    && normalizeMeetingPattern(sectionA?.meetings) !== "";
}

function parseClockToMinutes(value) {
  const raw = normalize(value).toUpperCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return null;
  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  if (match[3] === "PM") hours += 12;
  return hours * 60 + minutes;
}

function normalizeDayTokens(value) {
  const raw = normalize(value).toUpperCase();
  if (!raw || ["TBA", "ARR", "ASYNC"].includes(raw) || /^X+$/.test(raw)) return [];
  return raw
    .replace(/\s+/g, "")
    .replace(/SU/g, "U")
    .replace(/SA/g, "A")
    .split("")
    .filter((token) => "MTWRFAUS".includes(token));
}

function isAsyncLikeMeeting(meeting = {}) {
  const days = normalize(meeting.days).toUpperCase();
  const building = normalize(meeting.building).toUpperCase();
  const room = normalize(meeting.room).toUpperCase();
  const start = normalize(meeting.start_time).toUpperCase();
  const end = normalize(meeting.end_time).toUpperCase();

  return (
    !normalizeDayTokens(days).length
    || building.includes("ONLINE")
    || room === "N/A"
    || (start === "12:00AM" && end === "12:00AM")
  );
}

function meetingsOverlap(meetingsA = [], meetingsB = []) {
  for (const meetingA of meetingsA || []) {
    if (isAsyncLikeMeeting(meetingA)) continue;
    const daysA = normalizeDayTokens(meetingA.days);
    const startA = parseClockToMinutes(meetingA.start_time);
    const endA = parseClockToMinutes(meetingA.end_time);
    if (!daysA.length || startA === null || endA === null || startA === endA) continue;

    for (const meetingB of meetingsB || []) {
      if (isAsyncLikeMeeting(meetingB)) continue;
      const daysB = normalizeDayTokens(meetingB.days);
      const startB = parseClockToMinutes(meetingB.start_time);
      const endB = parseClockToMinutes(meetingB.end_time);
      if (!daysB.length || startB === null || endB === null || startB === endB) continue;

      const sharedDay = daysA.some((day) => daysB.includes(day));
      const overlapsInTime = startA < endB && startB < endA;
      if (sharedDay && overlapsInTime) return true;
    }
  }

  return false;
}

function inferSectionMethod(section) {
  const meetings = Array.isArray(section?.meetings) ? section.meetings : [];
  const hasAsyncLikeMeeting = meetings.some((meeting) => isAsyncLikeMeeting(meeting));
  const hasPhysicalMeeting = meetings.some((meeting) => !isAsyncLikeMeeting(meeting));
  const campus = normalize(section?.campus).toUpperCase();

  if (hasAsyncLikeMeeting && hasPhysicalMeeting) return "HYB";
  if (hasAsyncLikeMeeting || campus.startsWith("ON")) return "ONL";
  if (hasPhysicalMeeting) return "IP";
  return "";
}

function canonicalMethodCode(value, section = null) {
  const key = normalize(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (["IP", "INPERSON", "INP"].includes(key)) return "IP";
  if (["HYB", "HYBRID", "OH"].includes(key)) return "HYB";
  if (["FLX", "HYFLEX", "HYBRIDFLEX", "FLEX"].includes(key)) return "FLX";
  if (["ONL", "ONLINE", "ONS", "ONN", "OL", "ON"].includes(key)) return "ONL";
  if (["DE", "DUALENROLLMENT", "DUAL"].includes(key)) return "DE";
  if (["02S", "022", "02N", "04"].includes(key)) return inferSectionMethod(section) || "IP";
  return inferSectionMethod(section) || key || "";
}

function sectionMethodLabel(section) {
  return canonicalMethodCode(section?.instructional_method, section) || "TBA";
}

function sectionModalityLabel(section) {
  const display = normalize(section?.display_modality);
  if (display) return display;
  const method = canonicalMethodCode(section?.instructional_method, section);
  if (method === "IP") return "In Person";
  if (method === "HYB") return "Hybrid";
  if (method === "FLX") return "Hybrid Flex";
  if (method === "ONL") return "Online";
  if (method === "DE") return "Dual Enrollment";
  return normalize(section?.modality) || "TBA";
}

function matchesSectionFilters(section, filters) {
  const campus = normalize(section?.campus);
  const method = sectionMethodLabel(section);
  const modality = sectionModalityLabel(section);
  const search = normalize(filters?.search).toLowerCase();

  const campusMatch = !filters?.campuses?.length || filters.campuses.includes(campus);
  const methodMatch = !filters?.methods?.length || filters.methods.includes(method);
  const modalityMatch = !filters?.modalities?.length || filters.modalities.includes(modality);
  const meetings = Array.isArray(section?.meetings) ? section.meetings : [];
  const dayMatch = !filters?.days?.length || meetings
    .flatMap((meeting) => normalizeDayTokens(meeting.days))
    .some((day) => filters.days.includes(day));
  const timeMatch = !filters?.timeBlocks?.length || meetings.some((meeting) => {
    const start = parseClockToMinutes(meeting.start_time);
    const end = parseClockToMinutes(meeting.end_time);
    if (start === null || end === null || start === end) return false;
    return availabilityTimeOptions
      .filter((block) => filters.timeBlocks.includes(block.key))
      .some((block) => start < block.end && block.start < end);
  });
  const searchMatch = !search || [
    section?.primary_subject_course,
    section?.primary_crn,
    section?.title,
    section?.division,
    section?.campus,
    section?.discipline_code,
    method,
    modality,
    formatMeetings(section?.meetings),
  ].some((value) => normalize(value).toLowerCase().includes(search));

  return campusMatch && methodMatch && modalityMatch && dayMatch && timeMatch && searchMatch;
}

function sectionAvailabilitySummary(section, availability = {}) {
  const selectedDays = Array.isArray(availability.days) ? availability.days : [];
  const selectedBlocks = Array.isArray(availability.timeBlocks) ? availability.timeBlocks : [];
  if (!selectedDays.length && !selectedBlocks.length) {
    return { matches: true, label: "No availability selected" };
  }

  const meetings = Array.isArray(section?.meetings) ? section.meetings.filter((meeting) => !isAsyncLikeMeeting(meeting)) : [];
  if (!meetings.length) {
    return { matches: true, label: "No fixed meeting pattern" };
  }

  const sectionDays = Array.from(new Set(meetings.flatMap((meeting) => normalizeDayTokens(meeting.days))));
  const dayMatch = !selectedDays.length || sectionDays.some((day) => selectedDays.includes(day));
  const blockMatch = !selectedBlocks.length || meetings.some((meeting) => {
    const start = parseClockToMinutes(meeting.start_time);
    const end = parseClockToMinutes(meeting.end_time);
    if (start === null || end === null || start === end) return false;
    return availabilityTimeOptions
      .filter((block) => selectedBlocks.includes(block.key))
      .some((block) => start < block.end && block.start < end);
  });
  const matches = dayMatch && blockMatch;
  const label = matches ? "Availability match" : "Outside availability";
  return { matches, label, dayMatch, blockMatch };
}

function courseSortKey(section) {
  return `${section?.primary_subject_course || ""} ${section?.primary_crn || ""}`.trim();
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sectionPreferenceMatchKeys(item = {}) {
  const keys = new Set();
  [item.assignment_group_id, item.primary_crn].forEach((value) => {
    const compact = compactKey(value);
    if (compact) keys.add(compact);
    const crns = String(value ?? "").match(/\d{4,}/g) || [];
    crns.forEach((crn) => keys.add(`crn:${crn}`));
    if (crns.length > 1) keys.add(`crns:${[...crns].sort().join("|")}`);
  });
  return Array.from(keys);
}

function minRankForKeys(map, keys, suffix = "") {
  let best = null;
  keys.forEach((key) => {
    const rank = map.get(`${key}${suffix}`);
    if (rank !== undefined && (best === null || rank < best)) best = rank;
  });
  return best;
}

function sectionStartMinutes(section) {
  const starts = (section?.meetings || [])
    .map((meeting) => parseClockToMinutes(meeting.start_time))
    .filter((value) => value !== null);
  return starts.length ? Math.min(...starts) : 999999;
}

function pillStyle(background, color, borderColor) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    background,
    color,
    border: `1px solid ${borderColor}`,
  };
}

function methodPillStyle(method) {
  const key = normalize(method).toUpperCase();
  if (key === "IP") return pillStyle("#dcfce7", "#166534", "#86efac");
  if (key === "HYB") return pillStyle("#fef3c7", "#92400e", "#fcd34d");
  if (key === "FLX") return pillStyle("#ede9fe", "#5b21b6", "#c4b5fd");
  if (key === "ONL") return pillStyle("#dbeafe", "#1d4ed8", "#93c5fd");
  if (key === "DE") return pillStyle("#ffedd5", "#c2410c", "#fdba74");
  return pillStyle("#e2e8f0", "#334155", "#cbd5e1");
}

function modalityPillStyle(modality) {
  const key = normalize(modality).toLowerCase();
  if (key.includes("person")) return pillStyle("#dcfce7", "#166534", "#86efac");
  if (key.includes("hybrid flex") || key.includes("hyflex") || key.includes("flex")) return pillStyle("#ede9fe", "#5b21b6", "#c4b5fd");
  if (key.includes("hybrid")) return pillStyle("#fef3c7", "#92400e", "#fcd34d");
  if (key.includes("online")) return pillStyle("#dbeafe", "#1d4ed8", "#93c5fd");
  if (key.includes("dual")) return pillStyle("#ffedd5", "#c2410c", "#fdba74");
  return pillStyle("#e2e8f0", "#334155", "#cbd5e1");
}

function workflowStatePillStyle(kind) {
  if (kind === "assigned") return pillStyle("#dcfce7", "#166534", "#86efac");
  if (kind === "top") return pillStyle("#dbeafe", "#1d4ed8", "#93c5fd");
  if (kind === "bypass") return pillStyle("#ffedd5", "#c2410c", "#fdba74");
  if (kind === "conflict") return pillStyle("#fee2e2", "#b91c1c", "#fca5a5");
  if (kind === "filled") return pillStyle("#e2e8f0", "#334155", "#cbd5e1");
  if (kind === "advanced") return pillStyle("#ede9fe", "#5b21b6", "#c4b5fd");
  if (kind === "loaded") return pillStyle("#ecfccb", "#3f6212", "#bef264");
  return pillStyle("#f8fafc", "#475569", "#cbd5e1");
}

function assignmentStatusLabel(status) {
  const key = normalize(status || "tentative").toLowerCase();
  if (key === "chair_submitted") return "Submitted";
  if (key === "chair_finalized") return "Chair finalized";
  if (key === "dean_approved") return "Dean approved";
  if (key === "bypassed") return "Bypassed";
  if (key === "released") return "Released";
  if (key === "returned_for_revision") return "Returned";
  return "Tentative";
}

function assignmentStatusKind(status) {
  const key = normalize(status || "tentative").toLowerCase();
  if (key === "chair_submitted") return "top";
  if (key === "chair_finalized") return "top";
  if (key === "dean_approved") return "assigned";
  if (key === "bypassed") return "bypass";
  if (key === "released") return "filled";
  if (key === "returned_for_revision") return "conflict";
  return "advanced";
}

function divisionStatusMeta(status) {
  if (status === "advanced") {
    return {
      label: "Advanced",
      kind: "advanced",
      note: "Chair or dean activity already exists.",
    };
  }
  if (status === "in_progress") {
    return {
      label: "In Progress",
      kind: "top",
      note: "Preferences or tentative assignments are in play.",
    };
  }
  if (status === "loaded") {
    return {
      label: "Loaded",
      kind: "loaded",
      note: "Schedule is loaded, but downstream work has not started.",
    };
  }
  return {
    label: "Clean",
    kind: "filled",
    note: "No division-specific schedule activity yet.",
  };
}

function logEventKind(entry = {}) {
  const eventType = normalize(entry?.event_type).toLowerCase();
  if (["assignment_removed"].includes(eventType)) return "filled";
  if (["bypassed_preference", "reassigned", "schedule_reupload"].includes(eventType)) return "bypass";
  if (["chair_finalized", "dean_approved"].includes(eventType)) return "advanced";
  if (["schedule_upload", "assigned", "faculty_submission"].includes(eventType)) return "top";
  return "filled";
}

const codeLegend = [
  { label: "IP", meaning: "In Person instruction." },
  { label: "HYB", meaning: "Hybrid, part in person and part online." },
  { label: "FLX", meaning: "HyFlex or flexible attendance pattern." },
  { label: "ONL", meaning: "Fully online delivery." },
  { label: "DE", meaning: "Dual Enrollment section." },
  { label: "Clean", meaning: "No division schedule data or staffing activity is in play yet." },
  { label: "Loaded", meaning: "Schedule data is loaded for the division, but staffing work has not started." },
  { label: "In Progress", meaning: "Preferences or tentative assignments exist and the queue is active." },
  { label: "Advanced", meaning: "Chair finalization or dean approval activity has already begun." },
];

function sectionStateSummary(section, topCandidate) {
  if (section?.currentAssignment) {
    return {
      title: "Tentative assignment in place",
      detail: "This section already has a tentative assignee. Other candidates stay visible for review and reassignment.",
      kind: "assigned",
    };
  }
  if (topCandidate) {
    return {
      title: "Ready for next action",
      detail: `The next clean recommendation is ${topCandidate.faculty_name || topCandidate.employee_id}, based on seniority and available preference data.`,
      kind: "top",
    };
  }
  return {
    title: "Chair intervention likely needed",
    detail: "No conflict-free candidate is available right now, so this one likely needs bypass or reassignment judgment.",
    kind: "conflict",
  };
}

function candidateReasonSummary(section, row, topCandidate, currentAssignment) {
  const isTop = topCandidate?.employee_id === row.employee_id;
  const isCurrentAssignee = currentAssignment?.employee_id === row.employee_id;
  const sectionHasSavedPreference = finiteNumberOrNull(section?.bestPreferenceRank) !== null;
  if (isCurrentAssignee) {
    return {
      title: "Current tentative holder",
      detail: "This faculty member currently occupies the section in the working queue.",
      kind: "assigned",
    };
  }
  if (row.has_assignment_conflict) {
    return {
      title: "Blocked by time conflict",
      detail: `Conflicts with ${row.conflicting_assignment?.primary_subject_course || row.conflicting_assignment?.assignment_group_id || "another tentative assignment"}.`,
      kind: "conflict",
    };
  }
  if (row.section_assigned_to_other || row.has_tentative_assignment) {
    return {
      title: "Already placed elsewhere",
      detail: "This person already has a tentative placement attached to another section.",
      kind: "filled",
    };
  }
  if (section?.currentAssignment) {
    return {
      title: "Eligible for reassignment",
      detail: "This candidate is available, but moving the section here requires a rationale because an assignment already exists.",
      kind: "bypass",
    };
  }
  if (isTop) {
    return {
      title: "Next in line",
      detail: "Highest available candidate after seniority and conflict checks.",
      kind: "top",
    };
  }
  return {
    title: sectionHasSavedPreference ? "Assignable with rationale" : "Assignable",
    detail: sectionHasSavedPreference
      ? "This section is on a saved preference list, so bypassing the top available person requires a documented reason."
      : "This section is not on a saved preference list, so this candidate can be assigned without bypass rationale.",
    kind: sectionHasSavedPreference ? "bypass" : "top",
  };
}

function includesNormalized(haystack, needle) {
  return normalize(haystack).toLowerCase().includes(normalize(needle).toLowerCase());
}

function reorderList(items, startIndex, endIndex) {
  const next = [...items];
  const [removed] = next.splice(startIndex, 1);
  next.splice(endIndex, 0, removed);
  return next;
}

function downloadCsvFromRows(rows, fileName, headers) {
  const escapeCell = (value) => {
    const safe = String(value ?? "");
    const escaped = safe.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const ui = {
  page: {
    minHeight: "100vh",
    background: "var(--bg-page)",
    padding: 24,
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    color: "var(--text-main)",
    transition: "background 180ms ease, color 180ms ease",
  },
  shell: { maxWidth: 1420, margin: "0 auto", display: "grid", gap: 22 },
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border-color)",
    borderRadius: 24,
    padding: 18,
    boxShadow: "var(--shadow-soft)",
    backdropFilter: "blur(10px)",
  },
  cardTitle: { fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" },
  cardDesc: { fontSize: 13, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.45 },
  tableWrap: {
    overflowX: "auto",
    marginTop: 16,
    borderRadius: 20,
    border: "1px solid var(--border-color)",
    background: "var(--bg-card)",
  },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 14 },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-color)",
    background: "var(--bg-soft)",
    whiteSpace: "nowrap",
    color: "var(--text-muted)",
    fontSize: 12,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  td: { padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", verticalAlign: "top" },
  row: { display: "flex", gap: 12, flexWrap: "wrap" },
  between: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  btn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid var(--border-color)",
    background: "var(--bg-card)",
    color: "var(--text-main)",
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
  },
  btnPrimary: {
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid transparent",
    background: "linear-gradient(135deg, var(--brand-blue), var(--brand-orange) 55%, var(--brand-green))",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 800,
    boxShadow: "0 14px 32px rgba(36,51,122,0.22)",
  },
  input: {
    padding: "11px 12px",
    borderRadius: 14,
    border: "1px solid var(--border-color)",
    width: "100%",
    background: "var(--bg-card)",
    color: "var(--text-main)",
  },
  select: {
    padding: "11px 12px",
    borderRadius: 14,
    border: "1px solid var(--border-color)",
    background: "var(--bg-card)",
    color: "var(--text-main)",
  },
  alphaSelect: {
    padding: "11px 12px",
    borderRadius: 14,
    border: "1px solid rgba(36, 51, 122, 0.22)",
    background: "rgba(255,255,255,0.62)",
    color: "var(--text-main)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
  },
  badge: (status) => ({
    display: "inline-block",
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    background: statusColors[status] || "var(--bg-soft)",
    color: "var(--text-main)",
  }),
  gridSummary: { display: "grid", gap: 16, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" },
  sectionCard: { border: "1px solid var(--border-color)", borderRadius: 18, padding: 12, background: "var(--bg-card)" },
  small: { fontSize: 12, color: "var(--text-subtle)" },
  chip: {
    display: "inline-block",
    padding: "7px 11px",
    borderRadius: 999,
    background: "var(--chip-bg)",
    color: "var(--chip-text)",
    fontSize: 12,
    fontWeight: 800,
    marginRight: 8,
    marginBottom: 8,
  },
  panelGrid: { display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)" },
  filterChip: {
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid var(--border-color)",
    background: "var(--bg-card)",
    color: "var(--text-main)",
    cursor: "pointer",
    fontWeight: 700,
  },
  filterChipActive: {
    background: "linear-gradient(135deg, rgba(36,51,122,0.12), rgba(240,84,35,0.14), rgba(127,190,65,0.16))",
    border: "1px solid rgba(240,84,35,0.35)",
    color: "var(--text-main)",
  },
  metricTile: {
    border: "1px solid var(--border-soft)",
    borderRadius: 18,
    padding: 14,
    background: "var(--bg-soft)",
  },
  miniKicker: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-subtle)",
  },
  commandLane: {
    border: "1px solid var(--border-soft)",
    borderRadius: 18,
    padding: 14,
    background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0))",
  },
};

export default function PTFacultyStaffingMVP() {
  const [role, setRole] = useState(() => getCurrentUser()?.role || "faculty");
  const [apiTokenInput, setApiTokenInput] = useState(() => getApiToken());
  const [apiAccessMessage, setApiAccessMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", full_name: "", employee_id: "", role: "faculty", division: "" });
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [accountRequests, setAccountRequests] = useState([]);
  const [accountRequestsMessage, setAccountRequestsMessage] = useState("");
  const [accountRequestsBusy, setAccountRequestsBusy] = useState(false);
  const [managedUsers, setManagedUsers] = useState([]);
  const [managedUsersMessage, setManagedUsersMessage] = useState("");
  const [managedUsersBusy, setManagedUsersBusy] = useState(false);
  const [accessRequestForm, setAccessRequestForm] = useState({ email: "", full_name: "", employee_id: "", role: "faculty", division: "", note: "" });
  const [accessRequestMessage, setAccessRequestMessage] = useState("");
  const [accessRequestBusy, setAccessRequestBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [setupInviteToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.location.pathname === "/accept-invite" ? new URLSearchParams(window.location.search).get("token") || "" : "";
  });
  const [resetToken] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.location.pathname === "/reset-password" ? new URLSearchParams(window.location.search).get("token") || "" : "";
  });
  const [setupFullName, setSetupFullName] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupMessage, setSetupMessage] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [newResetMessage, setNewResetMessage] = useState("");
  const [newResetBusy, setNewResetBusy] = useState(false);
  const [terms, setTerms] = useState(initialTerms);
  const [newTermCode, setNewTermCode] = useState("");
  const [newTermName, setNewTermName] = useState("");
  const [termMessage, setTermMessage] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [selectedChairName, setSelectedChairName] = useState(initialChairAssignments[0]?.chairName || "");
  const [selectedDeanName, setSelectedDeanName] = useState(initialDeanAssignments[0]?.deanName || "");
  const [selectedFacultyId, setSelectedFacultyId] = useState("");
  const [chairAssignments, setChairAssignments] = useState(initialChairAssignments);
  const [deanAssignments, setDeanAssignments] = useState(initialDeanAssignments);
  const [ptStaffingRows, setPtStaffingRows] = useState(() => buildInitialPtRoster(initialFaculty, initialSeniority, initialDisciplines));
  const [divisionSenderEmail, setDivisionSenderEmail] = useState("jacoba@cos.edu");
  const [directoryPersistenceReady, setDirectoryPersistenceReady] = useState(false);
  const [rosterPersistenceReady, setRosterPersistenceReady] = useState(false);
  const skipNextDirectoryPersistRef = useRef(true);
  const skipNextRosterPersistRef = useRef(true);
  const [disciplines] = useState(initialDisciplines);
  const [faculty] = useState(initialFaculty);
  const [seniority] = useState(initialSeniority);
  const [sections, setSections] = useState(initialSections);
  const [uploadReport, setUploadReport] = useState({
    errors: [],
    warnings: [],
    unmappedSubjects: [],
    importedCount: 0,
    fileName: "",
    summary: null,
  });
  const [mappingReport, setMappingReport] = useState({
    error: "",
    importedRows: 0,
    fileName: "",
    globalCount: 0,
    termCount: 0,
    scope: "",
    message: "",
    loadedFromBackend: false,
  });
  const [uploadingSchedule, setUploadingSchedule] = useState(false);
  const [uploadingMapping, setUploadingMapping] = useState(false);
  const [backendMessage, setBackendMessage] = useState("");
  const [availableSections, setAvailableSections] = useState([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [sectionsError, setSectionsError] = useState("");
  const [selectedDisciplineCode, setSelectedDisciplineCode] = useState("ALL");
  const [ptFacultyDisciplineFilter, setPtFacultyDisciplineFilter] = useState("ALL");
  const [preferenceWipeMessage, setPreferenceWipeMessage] = useState("");
  const [chairWorkflowRows, setChairWorkflowRows] = useState([]);
  const [chairPreferenceRows, setChairPreferenceRows] = useState([]);
  const [tentativeAssignments, setTentativeAssignments] = useState([]);
  const [allocationAnalysis, setAllocationAnalysis] = useState(null);
  const [contractExceptionReasons, setContractExceptionReasons] = useState([]);
  const [decisionLogs, setDecisionLogs] = useState([]);
  const [chairMessage, setChairMessage] = useState("");
  const [loadingChairWorkflow, setLoadingChairWorkflow] = useState(false);
  const [facultyPreferences, setFacultyPreferences] = useState([]);
  const [facultyAvailability, setFacultyAvailability] = useState({ days: [], timeBlocks: [] });
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [showOnlyConflictFree, setShowOnlyConflictFree] = useState(false);
  const [showOnlyPreferredSections, setShowOnlyPreferredSections] = useState(false);
  const [mappingList, setMappingList] = useState([]);
  const [loadingMappingList, setLoadingMappingList] = useState(false);
  const [mappingAdminError, setMappingAdminError] = useState("");
  const [showMappingList, setShowMappingList] = useState(false);
  const [sectionFilters, setSectionFilters] = useState({ campuses: [], methods: [], modalities: [], days: [], timeBlocks: [], search: "" });
  const [selectedUploadDivision, setSelectedUploadDivision] = useState("");
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const [uploadConflict, setUploadConflict] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const [previewingUpload, setPreviewingUpload] = useState(false);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [divisionStatuses, setDivisionStatuses] = useState([]);
  const [loadingDivisionStatuses, setLoadingDivisionStatuses] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditTypeFilter, setAuditTypeFilter] = useState("ALL");
  const [workflowView, setWorkflowView] = useState("all");
  const [workflowSort, setWorkflowSort] = useState("preference");
  const [showOnlyPreferenceQueue, setShowOnlyPreferenceQueue] = useState(false);

  const activeTerm = terms.find((t) => t.active) || terms[0] || { code: "SP27", name: "Spring 2027", active: true };
  const apiTokenConfigured = Boolean(apiTokenInput.trim());
  const savedApiTokenConfigured = Boolean(getApiToken());
  const canShowWorkspace = Boolean(currentUser || savedApiTokenConfigured);
  const canUseAdminTools = role === "admin" && (currentUser?.role === "admin" || savedApiTokenConfigured);
  const canUseElevatedTools = canUseAdminTools || ["chair", "dean"].includes(currentUser?.role || "");
  const roleOptions = currentUser && currentUser.role !== "admin"
    ? [{ value: currentUser.role, label: currentUser.role === "chair" ? "Division Chair" : currentUser.role === "dean" ? "Dean" : "Part-Time Faculty" }]
    : currentUser?.role === "admin" || savedApiTokenConfigured
      ? [
      { value: "admin", label: "Scheduler / Admin" },
      { value: "chair", label: "Division Chair" },
      { value: "dean", label: "Dean" },
      { value: "faculty", label: "Part-Time Faculty" },
      ]
      : [{ value: "faculty", label: "Part-Time Faculty" }];

  function saveApiAccessToken() {
    setApiToken(apiTokenInput);
    setApiAccessMessage(apiTokenInput.trim() ? "API access token saved for this browser session." : "API access token cleared.");
    if (apiTokenInput.trim()) setRole("admin");
  }

  function clearApiAccessToken() {
    clearApiToken();
    setApiTokenInput("");
    if (!currentUser) setRole("faculty");
    setApiAccessMessage("API access token cleared.");
  }

  async function handleLogin(event) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const data = await login(authEmail, authPassword);
      setCurrentUser(data.user);
      if (data.user?.role) setRole(data.user.role);
      setAuthPassword("");
      setAuthMessage(`Signed in as ${data.user?.full_name || data.user?.email || "user"}.`);
    } catch (error) {
      setAuthMessage(error.message || "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      await logout();
      setCurrentUser(null);
      setAuthMessage("Signed out.");
    } catch (error) {
      setAuthMessage(error.message || "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function sendAccessInvite(event) {
    event.preventDefault();
    setInviteBusy(true);
    setInviteMessage("");
    try {
      const data = await inviteUser(inviteForm);
      setInviteForm({ email: "", full_name: "", employee_id: "", role: "faculty", division: "" });
      setInviteMessage(data.email?.delivered === false ? `Invitation staged. Console email link: ${data.inviteUrl}` : "Invitation sent.");
    } catch (error) {
      setInviteMessage(error.message || "Could not send invitation.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function submitAccessRequest(event) {
    event.preventDefault();
    setAccessRequestBusy(true);
    setAccessRequestMessage("");
    try {
      const data = await requestAccount({
        email: accessRequestForm.email,
        full_name: accessRequestForm.full_name,
        employee_id: accessRequestForm.employee_id,
        requested_role: accessRequestForm.role,
        division: accessRequestForm.division,
        note: accessRequestForm.note,
      });
      setAccessRequestForm({ email: "", full_name: "", employee_id: "", role: "faculty", division: "", note: "" });
      setAccessRequestMessage(
        data.email?.delivered === false
          ? "Account request submitted for review. Email delivery is not active yet; the request is still recorded."
          : "Account request submitted for review. Confirmation email sent."
      );
    } catch (error) {
      setAccessRequestMessage(error.message || "Could not submit account request.");
    } finally {
      setAccessRequestBusy(false);
    }
  }

  async function sendPasswordResetRequest(event) {
    event.preventDefault();
    setResetBusy(true);
    setResetMessage("");
    try {
      const data = await requestPasswordReset(resetEmail);
      setResetMessage(data.message || "If an active account exists, a reset link will be sent.");
    } catch (error) {
      setResetMessage(error.message || "Could not request password reset.");
    } finally {
      setResetBusy(false);
    }
  }

  async function handleCompletePasswordReset(event) {
    event.preventDefault();
    setNewResetBusy(true);
    setNewResetMessage("");
    try {
      const data = await completePasswordReset(resetToken, newResetPassword);
      setCurrentUser(data.user);
      if (data.user?.role) setRole(data.user.role);
      setNewResetPassword("");
      setNewResetMessage("Password reset. You are signed in.");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (error) {
      setNewResetMessage(error.message || "Could not reset password.");
    } finally {
      setNewResetBusy(false);
    }
  }

  async function refreshAccountRequests() {
    setAccountRequestsBusy(true);
    setAccountRequestsMessage("");
    try {
      const data = await loadAccountRequests("pending");
      setAccountRequests(data.requests || []);
    } catch (error) {
      setAccountRequestsMessage(error.message || "Could not load account requests.");
    } finally {
      setAccountRequestsBusy(false);
    }
  }

  async function refreshManagedUsers() {
    setManagedUsersBusy(true);
    setManagedUsersMessage("");
    try {
      const data = await loadUsers();
      setManagedUsers(data.users || []);
    } catch (error) {
      setManagedUsersMessage(error.message || "Could not load users.");
    } finally {
      setManagedUsersBusy(false);
    }
  }

  async function saveManagedUser(user, patch) {
    setManagedUsersBusy(true);
    setManagedUsersMessage("");
    try {
      const data = await updateUser(user.id, { ...user, ...patch });
      setManagedUsers((prev) => prev.map((item) => item.id === user.id ? data.user : item));
      setManagedUsersMessage(`Updated ${data.user.email}.`);
    } catch (error) {
      setManagedUsersMessage(error.message || "Could not update user.");
    } finally {
      setManagedUsersBusy(false);
    }
  }

  async function runUserAction(user, action) {
    setManagedUsersBusy(true);
    setManagedUsersMessage("");
    try {
      const data = action === "invite" ? await resendUserInvite(user.id) : await sendUserPasswordReset(user.id);
      const link = data.inviteUrl || data.resetUrl || "";
      const staged = data.email?.delivered === false && link ? ` Console link: ${link}` : "";
      setManagedUsersMessage(`${action === "invite" ? "Invite" : "Password reset"} sent for ${user.email}.${staged}`);
    } catch (error) {
      setManagedUsersMessage(error.message || "Could not complete user action.");
    } finally {
      setManagedUsersBusy(false);
    }
  }

  async function reviewAccountRequest(id, action) {
    setAccountRequestsBusy(true);
    setAccountRequestsMessage("");
    try {
      const data = action === "approve" ? await approveAccountRequest(id) : await rejectAccountRequest(id);
      setAccountRequests((prev) => prev.filter((request) => request.id !== id));
      setAccountRequestsMessage(action === "approve" && data.email?.delivered === false ? `Approved. Console invite link: ${data.inviteUrl}` : `Request ${action}d.`);
    } catch (error) {
      setAccountRequestsMessage(error.message || `Could not ${action} request.`);
    } finally {
      setAccountRequestsBusy(false);
    }
  }

  async function handleAcceptInvitation(event) {
    event.preventDefault();
    setSetupBusy(true);
    setSetupMessage("");
    try {
      const data = await acceptInvite(setupInviteToken, setupPassword, setupFullName);
      setCurrentUser(data.user);
      if (data.user?.role) setRole(data.user.role);
      setSetupPassword("");
      setSetupMessage("Account ready. You are signed in.");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", window.location.pathname);
      }
    } catch (error) {
      setSetupMessage(error.message || "Could not set up account.");
    } finally {
      setSetupBusy(false);
    }
  }

  useEffect(() => {
    if (!currentUser) return;
    fetchCurrentUser()
      .then((user) => {
        if (user) {
          setCurrentUser(user);
          if (user.role) setRole(user.role);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (canUseAdminTools) refreshAccountRequests();
  }, [canUseAdminTools]);

  useEffect(() => {
    if (canUseAdminTools) refreshManagedUsers();
  }, [canUseAdminTools]);


  function normalizeRoleRows(rows = []) {
    const grouped = new Map();
    rows.forEach((row) => {
      const role = String(row.role || "").toLowerCase();
      const displayName = `${row.first_name || ""} ${row.last_name || ""}`.trim() || row.name || "";
      const key = `${role}::${displayName}::${row.email || ""}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          role,
          name: displayName,
          email: row.email || "",
          divisions: [],
        });
      }
      const entry = grouped.get(key);
      const canonicalDivision = canonicalDivisionName(row.division);
      if (canonicalDivision && !entry.divisions.includes(canonicalDivision)) {
        entry.divisions.push(canonicalDivision);
      }
    });

    const chairs = [];
    const deans = [];
    grouped.forEach((entry) => {
      if (entry.role === "chair") {
        chairs.push({ chairName: entry.name, email: entry.email, divisions: entry.divisions });
      } else if (entry.role === "dean") {
        deans.push({ deanName: entry.name, email: entry.email, divisions: entry.divisions });
      }
    });

    chairs.sort((a, b) => a.chairName.localeCompare(b.chairName));
    deans.sort((a, b) => a.deanName.localeCompare(b.deanName));
    return { chairs, deans };
  }

  function expandRolesForSave(chairs = [], deans = []) {
    const rows = [];
    chairs.forEach((row) => {
      const fullName = String(row.chairName || "").trim();
      const parts = fullName.split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ");
      (row.divisions || []).forEach((division) => {
        rows.push({
          employee_id: row.employee_id || "",
          first_name: firstName,
          last_name: lastName,
          email: row.email || "",
          role: "chair",
          division,
          active_status: row.active_status || "active",
        });
      });
    });
    deans.forEach((row) => {
      const fullName = String(row.deanName || "").trim();
      const parts = fullName.split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ");
      (row.divisions || []).forEach((division) => {
        rows.push({
          employee_id: row.employee_id || "",
          first_name: firstName,
          last_name: lastName,
          email: row.email || "",
          role: "dean",
          division,
          active_status: row.active_status || "active",
        });
      });
    });
    return rows;
  }

  async function hydrateAdminDirectories() {
    try {
      const [roleRows, ptRows] = await Promise.all([
        loadRoles(),
        loadPTFaculty(),
      ]);

      if (Array.isArray(roleRows)) {
        const normalized = normalizeRoleRows(roleRows);
        setChairAssignments(normalized.chairs);
        setDeanAssignments(normalized.deans);
      }

      if (Array.isArray(ptRows)) {
        setPtStaffingRows(ptRows.map((row) => ({
          ...row,
          seniority_rank: row.seniority_rank ?? row.seniority_value ?? "",
        })));
      }
    } catch (error) {
      console.warn("Could not hydrate admin directories", error);
    } finally {
      skipNextDirectoryPersistRef.current = true;
      skipNextRosterPersistRef.current = true;
      setDirectoryPersistenceReady(true);
      setRosterPersistenceReady(true);
    }
  }


  async function writeAudit(eventType, note, extras = {}) {
    void eventType;
    void note;
    void extras;
  }

  async function wipePreferencesForDivision() {
    if (!activeTerm?.code || !selectedUploadDivision) return;
    const confirmed = window.confirm(
      `Delete saved faculty preferences for ${selectedUploadDivision} in ${activeTerm.code}? This cannot be undone.`
    );
    if (!confirmed) return;
    setPreferenceWipeMessage("");
    try {
      const response = await apiFetch(`${API_BASE}/preferences?termCode=${encodeURIComponent(activeTerm.code)}&division=${encodeURIComponent(selectedUploadDivision)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        setPreferenceWipeMessage(data.error || "Could not wipe preferences.");
        return;
      }
      setPreferenceWipeMessage(`Deleted ${data.deletedCount || 0} saved preference row(s) for ${selectedUploadDivision}.`);
      await writeAudit("preferences_wiped", `Cleared saved faculty preferences for ${selectedUploadDivision}.`, {
        division: selectedUploadDivision,
        term: activeTerm.code,
        new_value: String(data.deletedCount || 0),
      });
      if (role === "chair" || role === "dean" || role === "admin") {
        await loadChairWorkflow();
      }
    } catch (error) {
      setPreferenceWipeMessage(error.message || "Could not wipe preferences.");
    }
  }


  async function loadTerms() {
    try {
      const data = await fetchJson("/terms", {}, "Could not load terms.");
      setTerms((data.terms || []).map((term) => ({
        id: term.id || term.term_code,
        code: term.term_code,
        name: term.term_name,
        active: term.is_active,
      })));
    } catch (error) {
      setTermMessage(error.message || "Could not load terms.");
    }
  }

  async function activateTerm(termCode) {
    if (!canUseAdminTools) {
      setTermMessage("Sign in as an admin or save the bootstrap API token before changing terms.");
      return;
    }
    try {
      const data = await fetchJson("/terms/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termCode }),
      }, "Could not activate term.");
      setTermMessage(`Active term set to ${data.term.term_name}.`);
      await loadTerms();
    } catch (error) {
      setTermMessage(error.message || "Could not activate term.");
    }
  }

  async function createOrUpdateTerm() {
    if (!canUseAdminTools) {
      setTermMessage("Sign in as an admin or save the bootstrap API token before saving terms.");
      return;
    }
    try {
      const data = await fetchJson("/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: newTermCode,
          termName: newTermName,
          isActive: false,
        }),
      }, "Could not save term.");
      setTermMessage(`Saved ${data.term.term_name}.`);
      setNewTermCode("");
      setNewTermName("");
      await loadTerms();
    } catch (error) {
      setTermMessage(error.message || "Could not save term.");
    }
  }

  useEffect(() => {
    loadTerms();
  }, []);

  useEffect(() => {
    if (canShowWorkspace) hydrateAdminDirectories();
  }, [canShowWorkspace]);

  useEffect(() => {
    if (canShowWorkspace && (role === "chair" || role === "admin" || role === "dean") && activeTerm?.code) {
      loadChairWorkflow();
    }
  }, [canShowWorkspace, role, activeTerm?.code, selectedDisciplineCode, selectedChairName, selectedDeanName, chairAssignments, deanAssignments]);

  useEffect(() => {
    if (canShowWorkspace && activeTerm?.code) {
      setSelectedDisciplineCode("ALL");
      loadAvailableSections("ALL");
    }
  }, [canShowWorkspace, role, activeTerm?.code, selectedChairName, selectedDeanName, chairAssignments, deanAssignments]);


  const themeVars = darkMode
    ? {
        "--bg-page": "linear-gradient(180deg, #081120 0%, #0f172a 100%)",
        "--bg-card": "rgba(15, 23, 42, 0.88)",
        "--bg-soft": "rgba(30, 41, 59, 0.96)",
        "--border-color": "rgba(148, 163, 184, 0.22)",
        "--border-soft": "rgba(148, 163, 184, 0.12)",
        "--text-main": "#f8fafc",
        "--text-muted": "#cbd5e1",
        "--text-subtle": "#94a3b8",
        "--chip-bg": "rgba(240, 84, 35, 0.18)",
        "--chip-text": "#fed7aa",
        "--shadow-soft": "0 20px 54px rgba(2, 6, 23, 0.45)",
        "--brand-blue": "#24337a",
        "--brand-orange": "#f05423",
        "--brand-green": "#7fbe41",
      }
    : {
        "--bg-page": "linear-gradient(180deg, #f8fafc 0%, #eef4f7 100%)",
        "--bg-card": "rgba(255, 255, 255, 0.9)",
        "--bg-soft": "rgba(248, 250, 252, 0.98)",
        "--border-color": "rgba(36, 51, 122, 0.12)",
        "--border-soft": "rgba(36, 51, 122, 0.08)",
        "--text-main": "#0f172a",
        "--text-muted": "#475569",
        "--text-subtle": "#64748b",
        "--chip-bg": "rgba(127, 190, 65, 0.16)",
        "--chip-text": "#24337a",
        "--shadow-soft": "0 18px 50px rgba(15, 23, 42, 0.08)",
        "--brand-blue": "#24337a",
        "--brand-orange": "#f05423",
        "--brand-green": "#7fbe41",
      };

  const heroCardStyle = {
    ...ui.card,
    background: "linear-gradient(135deg, rgba(36,51,122,0.98), rgba(240,84,35,0.96) 58%, rgba(127,190,65,0.92))",
    color: "#fff",
    padding: 26,
    overflow: "hidden",
    position: "relative",
  };

  const availableDisciplineCodes = useMemo(() => {
    return Array.from(
      new Set(
        availableSections
          .map((section) => section.discipline_code)
          .filter(Boolean)
      )
    ).sort();
  }, [availableSections]);

  const chairDivisions = useMemo(() => {
    return (chairAssignments.find((item) => item.chairName === selectedChairName)?.divisions || []).map(canonicalDivisionName);
  }, [selectedChairName, chairAssignments]);

  const deanDivisions = useMemo(() => {
    return (deanAssignments.find((item) => item.deanName === selectedDeanName)?.divisions || []).map(canonicalDivisionName);
  }, [selectedDeanName, deanAssignments]);

  const uploadDivisionOptions = useMemo(() => (
    Array.from(
      new Set(
        [...chairAssignments, ...deanAssignments]
          .flatMap((item) => item.divisions || [])
          .map((division) => canonicalDivisionName(division))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))
  ), [chairAssignments, deanAssignments]);

  const divisionStatusMap = useMemo(() => {
    const map = new Map();
    (divisionStatuses || []).forEach((row) => {
      if (row?.division) map.set(canonicalDivisionName(row.division), row);
    });
    return map;
  }, [divisionStatuses]);

  const divisionStatusCards = useMemo(() => {
    return uploadDivisionOptions.map((division) => {
      const statusRow = divisionStatusMap.get(division) || {
        division,
        status: "clean",
        sectionCount: 0,
        preferenceCount: 0,
        submissionCount: 0,
        tentativeAssignmentCount: 0,
        approvedAssignmentCount: 0,
        chairFinalizedCount: 0,
        deanApprovedCount: 0,
      };
      return {
        ...statusRow,
        meta: divisionStatusMeta(statusRow.status),
      };
    });
  }, [uploadDivisionOptions, divisionStatusMap]);

  useEffect(() => {
    if (!selectedUploadDivision && uploadDivisionOptions.length) {
      setSelectedUploadDivision(uploadDivisionOptions[0]);
    }
  }, [selectedUploadDivision, uploadDivisionOptions]);

  useEffect(() => {
    if (!chairAssignments.some((item) => item.chairName === selectedChairName) && chairAssignments[0]?.chairName) {
      setSelectedChairName(chairAssignments[0].chairName);
    }
  }, [chairAssignments, selectedChairName]);

  useEffect(() => {
    if (!deanAssignments.some((item) => item.deanName === selectedDeanName) && deanAssignments[0]?.deanName) {
      setSelectedDeanName(deanAssignments[0].deanName);
    }
  }, [deanAssignments, selectedDeanName]);

  useEffect(() => {
    setUploadPreview(null);
    setUploadConflict(null);
    setPendingUploadFile(null);
    setUploadInputKey((value) => value + 1);
  }, [selectedUploadDivision, activeTerm.code]);

  useEffect(() => {
    if (canShowWorkspace) loadDivisionStatuses();
  }, [canShowWorkspace, activeTerm?.code]);


  useEffect(() => {
    if (!directoryPersistenceReady) return;
    if (skipNextDirectoryPersistRef.current) {
      skipNextDirectoryPersistRef.current = false;
      return;
    }
    const rows = expandRolesForSave(chairAssignments, deanAssignments);
    (async () => {
      try {
        await saveRoles(rows);
        await writeAudit("role_directory_saved", `Saved ${rows.length} role-directory row(s).`, {
          term: activeTerm?.code || "",
          new_value: String(rows.length),
        });
      } catch (error) {
        console.warn("Could not persist role directory", error);
      }
    })();
  }, [directoryPersistenceReady, chairAssignments, deanAssignments]);

  useEffect(() => {
    if (!rosterPersistenceReady) return;
    if (skipNextRosterPersistRef.current) {
      skipNextRosterPersistRef.current = false;
      return;
    }
    (async () => {
      try {
        await savePTFaculty(ptStaffingRows);
        await writeAudit("pt_roster_saved", `Saved ${ptStaffingRows.length} active PT roster row(s).`, {
          term: activeTerm?.code || "",
          new_value: String(ptStaffingRows.length),
        });
      } catch (error) {
        console.warn("Could not persist PT roster", error);
      }
    })();
  }, [rosterPersistenceReady, ptStaffingRows]);

  const previewFacultyOptions = useMemo(() => {
    const grouped = new Map();
    (ptStaffingRows || []).forEach((row) => {
      if (normalize(row.active_status || "active") !== "active") return;
      const employeeId = normalize(row.employee_id);
      if (!employeeId) return;
      const approvedDiscipline = normalize(row.discipline || row.qualified_disciplines || "");
      if (ptFacultyDisciplineFilter !== "ALL" && approvedDiscipline !== ptFacultyDisciplineFilter) return;
      if (!grouped.has(employeeId)) {
        grouped.set(employeeId, {
          id: employeeId,
          employeeId,
          firstName: row.first_name || "",
          lastName: row.last_name || "",
          email: row.email || "",
          rows: [],
        });
      }
      grouped.get(employeeId).rows.push(row);
    });
    return Array.from(grouped.values()).sort((a, b) =>
      `${a.lastName} ${a.firstName}`.trim().localeCompare(`${b.lastName} ${b.firstName}`.trim())
    );
  }, [ptStaffingRows, ptFacultyDisciplineFilter]);

  useEffect(() => {
    if (!previewFacultyOptions.length) return;
    if (!previewFacultyOptions.some((item) => item.employeeId === selectedFacultyId)) {
      setSelectedFacultyId(previewFacultyOptions[0].employeeId);
    }
  }, [previewFacultyOptions, selectedFacultyId]);

  const selectedFaculty = useMemo(
    () => previewFacultyOptions.find((item) => item.employeeId === selectedFacultyId) || previewFacultyOptions[0] || null,
    [previewFacultyOptions, selectedFacultyId]
  );

  const facultySeniorityRows = useMemo(() => {
    if (!selectedFaculty) return [];
    const rows = (selectedFaculty.rows || []).map((row) => ({
      facultyId: selectedFaculty.employeeId,
      employeeId: selectedFaculty.employeeId,
      rank: row.seniority_rank || row.seniority_value || "",
      seniorityDate: row.seniority_date || "",
      disciplineCode: row.discipline || row.qualified_disciplines || "",
      disciplineName: row.discipline || row.qualified_disciplines || "",
      division: row.division || "",
      scopeKeys: splitScopeValues(row.discipline, row.qualified_disciplines, row.division)
        .map(compactKey)
        .filter(Boolean),
      active: normalize(row.active_status || "active") === "active",
    }));
    return rows;
  }, [selectedFaculty]);

  const roleScopedSections = useMemo(() => {
    if (role === "chair") {
      return availableSections.filter((section) => chairDivisions.includes(canonicalDivisionName(section.division)));
    }
    if (role === "dean") {
      return availableSections.filter((section) => deanDivisions.includes(canonicalDivisionName(section.division)));
    }
    if (role === "faculty") {
      const facultyScopeKeys = new Set(
        facultySeniorityRows
          .filter((row) => {
            if (!ptFacultyDisciplineFilter || ptFacultyDisciplineFilter === "ALL") return true;
            return splitScopeValues(row.disciplineCode, row.disciplineName, row.division)
              .map(compactKey)
              .includes(compactKey(ptFacultyDisciplineFilter));
          })
          .flatMap((row) => row.scopeKeys)
      );
      if (!facultyScopeKeys.size) {
        return availableSections;
      }
      const scoped = availableSections.filter((section) => sectionMatchesFacultyScope(section, facultyScopeKeys));
      return scoped;
    }
    return availableSections;
  }, [role, availableSections, chairDivisions, deanDivisions, facultySeniorityRows, ptFacultyDisciplineFilter]);

  const roleAvailableDisciplineCodes = useMemo(() => {
    return Array.from(
      new Set(roleScopedSections.map((section) => section.discipline_code).filter(Boolean))
    ).sort();
  }, [roleScopedSections]);

  useEffect(() => {
    if (selectedDisciplineCode !== "ALL" && roleAvailableDisciplineCodes.length && !roleAvailableDisciplineCodes.includes(selectedDisciplineCode)) {
      setSelectedDisciplineCode("ALL");
    }
  }, [selectedDisciplineCode, roleAvailableDisciplineCodes]);

  const filterOptionSections = useMemo(() => {
    const workflowTemplates = chairWorkflowRows.map((row) => ({
      campus: row.campus,
      instructional_method: row.instructional_method,
      display_modality: row.display_modality,
      modality: row.modality,
      meetings: row.meetings,
    }));
    return [...roleScopedSections, ...workflowTemplates];
  }, [roleScopedSections, chairWorkflowRows]);

  const campusFilterOptions = useMemo(() => {
    return Array.from(new Set(filterOptionSections.map((section) => normalize(section?.campus)).filter(Boolean))).sort();
  }, [filterOptionSections]);

  const methodFilterOptions = useMemo(() => {
    return Array.from(new Set(filterOptionSections.map((section) => sectionMethodLabel(section)).filter(Boolean))).sort();
  }, [filterOptionSections]);

  const modalityFilterOptions = useMemo(() => {
    return Array.from(new Set(filterOptionSections.map((section) => sectionModalityLabel(section)).filter(Boolean))).sort();
  }, [filterOptionSections]);

  const chairPreferenceLookups = useMemo(() => {
    const sectionRankByAssignment = new Map();
    const candidateRankByAssignmentEmployee = new Map();
    const selectedFacultySectionRankByAssignment = new Map();
    const selectedFacultyKey = normalize(selectedFacultyId || selectedFaculty?.employeeId);

    chairPreferenceRows.forEach((row) => {
      const matchKeys = sectionPreferenceMatchKeys(row);
      if (!matchKeys.length) return;
      const rank = finiteNumberOrNull(row.preference_rank);
      if (rank === null) return;
      const employeeId = normalize(row.employee_id || row.faculty_id);
      const isSelectedFacultyPreference = selectedFacultyKey && employeeId === selectedFacultyKey;

      matchKeys.forEach((matchKey) => {
        const currentSectionRank = sectionRankByAssignment.get(matchKey);
        if (!Number.isFinite(currentSectionRank) || rank < currentSectionRank) {
          sectionRankByAssignment.set(matchKey, rank);
        }
        if (isSelectedFacultyPreference) {
          const currentSelectedRank = selectedFacultySectionRankByAssignment.get(matchKey);
          if (!Number.isFinite(currentSelectedRank) || rank < currentSelectedRank) {
            selectedFacultySectionRankByAssignment.set(matchKey, rank);
          }
        }
      });

      if (employeeId) {
        matchKeys.forEach((matchKey) => {
          const key = `${matchKey}::${employeeId}`;
          const currentCandidateRank = candidateRankByAssignmentEmployee.get(key);
          if (!Number.isFinite(currentCandidateRank) || rank < currentCandidateRank) {
            candidateRankByAssignmentEmployee.set(key, rank);
          }
        });
      }
    });

    return { sectionRankByAssignment, candidateRankByAssignmentEmployee, selectedFacultySectionRankByAssignment };
  }, [chairPreferenceRows, selectedFacultyId, selectedFaculty]);

  const sectionQueue = useMemo(() => {
    const grouped = new Map();
    const activeAssignments = tentativeAssignments.filter((assignment) => assignment.status !== "released");

    chairWorkflowRows.forEach((row) => {
      if (selectedDisciplineCode !== "ALL" && row.discipline_code !== selectedDisciplineCode) return;
      if (!matchesSectionFilters(row, sectionFilters)) return;
      const key = row.assignment_group_id;
      const currentAssignment = activeAssignments.find((assignment) => assignment.assignment_group_id === key) || null;
      const employeeAssignments = activeAssignments.filter((assignment) => assignment.employee_id === row.employee_id && assignment.assignment_group_id !== key);
      const conflictingAssignment = employeeAssignments.find((assignment) => hasMeetingConflict(row, assignment)) || null;
      const rowMatchKeys = sectionPreferenceMatchKeys(row);
      const exportedPreferenceRank = minRankForKeys(chairPreferenceLookups.candidateRankByAssignmentEmployee, rowMatchKeys, `::${normalize(row.employee_id)}`);
      const rowPreferenceRank = finiteNumberOrNull(row.preference_rank) ?? exportedPreferenceRank ?? null;
      const enrichedRow = {
        ...row,
        preference_rank: rowPreferenceRank,
        availabilitySummary: sectionAvailabilitySummary(row, {
          days: row.availability_days || [],
          timeBlocks: row.availability_time_blocks || [],
        }),
        has_tentative_assignment: currentAssignment?.employee_id === row.employee_id,
        section_assigned_to_other: Boolean(currentAssignment && currentAssignment.employee_id !== row.employee_id),
        assigned_elsewhere: employeeAssignments.length > 0,
        has_assignment_conflict: Boolean(conflictingAssignment),
        conflicting_assignment: conflictingAssignment,
      };

      if (!grouped.has(key)) {
        grouped.set(key, {
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
          meetings: row.meetings,
          selected_faculty_preference_rank: minRankForKeys(chairPreferenceLookups.selectedFacultySectionRankByAssignment, rowMatchKeys),
          section_preference_rank: finiteNumberOrNull(row.section_preference_rank) ?? minRankForKeys(chairPreferenceLookups.sectionRankByAssignment, rowMatchKeys) ?? null,
          candidates: [],
          currentAssignment,
        });
      }

      const entry = grouped.get(key);
      entry.currentAssignment = entry.currentAssignment || currentAssignment;
      entry.candidates.push(enrichedRow);
    });

    return Array.from(grouped.values())
      .map((section) => {
        const candidates = [...section.candidates].sort((a, b) => {
          const aRank = finiteNumberOrNull(a.seniority_rank) ?? 999999;
          const bRank = finiteNumberOrNull(b.seniority_rank) ?? 999999;
          if (aRank !== bRank) return aRank - bRank;
          const aPref = finiteNumberOrNull(a.preference_rank) ?? 999999;
          const bPref = finiteNumberOrNull(b.preference_rank) ?? 999999;
          if (aPref !== bPref) return aPref - bPref;
          return String(a.faculty_name || a.employee_id || "").localeCompare(String(b.faculty_name || b.employee_id || ""));
        });
        const eligibleCandidates = candidates.filter((row) => !row.has_tentative_assignment && !row.section_assigned_to_other && !row.has_assignment_conflict);
        const preferenceRanks = [
          finiteNumberOrNull(section.selected_faculty_preference_rank),
          finiteNumberOrNull(section.section_preference_rank),
          ...candidates.map((row) => finiteNumberOrNull(row.preference_rank)),
        ]
          .filter((rank) => rank !== null);
        const bestPreferenceRank = preferenceRanks.length ? Math.min(...preferenceRanks) : null;
        const selectedFacultyPreferenceRank = finiteNumberOrNull(section.selected_faculty_preference_rank);
        return { ...section, candidates, eligibleCandidates, bestPreferenceRank, selectedFacultyPreferenceRank };
      })
      .sort((a, b) => {
        const aPref = finiteNumberOrNull(a.bestPreferenceRank) ?? 999999;
        const bPref = finiteNumberOrNull(b.bestPreferenceRank) ?? 999999;
        if (aPref !== bPref) return aPref - bPref;
        return courseSortKey(a).localeCompare(courseSortKey(b));
      });
  }, [chairWorkflowRows, chairPreferenceLookups, tentativeAssignments, sectionFilters, selectedDisciplineCode]);

  const workflowMetrics = useMemo(() => {
    const assigned = sectionQueue.filter((section) => Boolean(section.currentAssignment)).length;
    const ready = sectionQueue.filter((section) => !section.currentAssignment && Boolean(section.eligibleCandidates?.length)).length;
    const blocked = sectionQueue.filter((section) => !section.currentAssignment && !section.eligibleCandidates?.length).length;
    const reassignmentPool = sectionQueue.filter((section) => Boolean(section.currentAssignment)).length;
    return { assigned, ready, blocked, reassignmentPool, total: sectionQueue.length };
  }, [sectionQueue]);

  const allocationSectionById = useMemo(() => {
    const map = new Map();
    (allocationAnalysis?.sections || []).forEach((section) => map.set(section.assignmentGroupId, section));
    return map;
  }, [allocationAnalysis]);

  const highestRemainingPreferenceByFaculty = useMemo(() => {
    const map = new Map();
    (allocationAnalysis?.faculty || []).forEach((facultyRow) => {
      const remaining = (facultyRow.rankedPreferences || [])
        .filter((pref) => ["NOT_YET_REACHED", "ALREADY_ASSIGNED_IN_THIS_PASS", "LOAD_LIMIT_REACHED"].includes(pref.reasonCode))
        .sort((a, b) => (finiteNumberOrNull(a.preferenceRank) ?? 999999) - (finiteNumberOrNull(b.preferenceRank) ?? 999999));
      if (remaining[0]) map.set(facultyRow.employeeId, remaining[0].assignmentGroupId);
    });
    return map;
  }, [allocationAnalysis]);

  const assignmentStatusCounts = useMemo(() => {
    return tentativeAssignments.reduce((counts, assignment) => {
      const status = normalize(assignment.status || "tentative").toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, { tentative: 0, chair_submitted: 0, dean_approved: 0 });
  }, [tentativeAssignments]);

  const sortedSectionQueue = useMemo(() => {
    return [...sectionQueue].sort((a, b) => {
      if (workflowSort === "campus") {
        const campusCompare = normalize(a.campus).localeCompare(normalize(b.campus));
        if (campusCompare) return campusCompare;
      } else if (workflowSort === "method") {
        const methodCompare = sectionMethodLabel(a).localeCompare(sectionMethodLabel(b));
        if (methodCompare) return methodCompare;
      } else if (workflowSort === "modality") {
        const modalityCompare = sectionModalityLabel(a).localeCompare(sectionModalityLabel(b));
        if (modalityCompare) return modalityCompare;
      } else if (workflowSort === "time") {
        const timeCompare = sectionStartMinutes(a) - sectionStartMinutes(b);
        if (timeCompare) return timeCompare;
      } else if (workflowSort === "seniority") {
        const aRank = finiteNumberOrNull(a.eligibleCandidates?.[0]?.seniority_rank) ?? 999999;
        const bRank = finiteNumberOrNull(b.eligibleCandidates?.[0]?.seniority_rank) ?? 999999;
        if (aRank !== bRank) return aRank - bRank;
      } else if (workflowSort === "course") {
        return courseSortKey(a).localeCompare(courseSortKey(b));
      } else {
        const aPref = finiteNumberOrNull(a.selectedFacultyPreferenceRank) ?? finiteNumberOrNull(a.bestPreferenceRank) ?? 999999;
        const bPref = finiteNumberOrNull(b.selectedFacultyPreferenceRank) ?? finiteNumberOrNull(b.bestPreferenceRank) ?? 999999;
        if (aPref !== bPref) return aPref - bPref;
      }
      return courseSortKey(a).localeCompare(courseSortKey(b));
    });
  }, [sectionQueue, workflowSort]);

  const filteredSectionQueue = useMemo(() => {
    const preferenceScopedQueue = showOnlyPreferenceQueue
      ? sortedSectionQueue.filter((section) => {
        const hasSelectedFacultyPrefs = chairPreferenceLookups.selectedFacultySectionRankByAssignment.size > 0;
        return hasSelectedFacultyPrefs
          ? finiteNumberOrNull(section.selectedFacultyPreferenceRank) !== null
          : finiteNumberOrNull(section.bestPreferenceRank) !== null;
      })
      : sortedSectionQueue;
    if (workflowView === "assigned") return preferenceScopedQueue.filter((section) => Boolean(section.currentAssignment));
    if (workflowView === "ready") return preferenceScopedQueue.filter((section) => !section.currentAssignment && Boolean(section.eligibleCandidates?.length));
    if (workflowView === "blocked") return preferenceScopedQueue.filter((section) => !section.currentAssignment && !section.eligibleCandidates?.length);
    return preferenceScopedQueue;
  }, [sortedSectionQueue, workflowView, showOnlyPreferenceQueue]);

  const preferenceQueueCount = useMemo(() => {
    const hasSelectedFacultyPrefs = chairPreferenceLookups.selectedFacultySectionRankByAssignment.size > 0;
    return sectionQueue.filter((section) => hasSelectedFacultyPrefs
      ? finiteNumberOrNull(section.selectedFacultyPreferenceRank) !== null
      : finiteNumberOrNull(section.bestPreferenceRank) !== null).length;
  }, [sectionQueue, chairPreferenceLookups]);

  const auditEventOptions = useMemo(() => {
    return Array.from(new Set(decisionLogs.map((entry) => normalize(entry.event_type)).filter(Boolean))).sort();
  }, [decisionLogs]);

  const filteredDecisionLogs = useMemo(() => {
    return decisionLogs.filter((entry) => {
      const typeMatch = auditTypeFilter === "ALL" || normalize(entry.event_type) === auditTypeFilter;
      const textMatch = !auditSearch || [entry.actor_name, entry.event_type, entry.discipline_code, entry.detail]
        .some((value) => includesNormalized(value, auditSearch));
      return typeMatch && textMatch;
    });
  }, [decisionLogs, auditSearch, auditTypeFilter]);

  const activeSectionFilterCount =
    sectionFilters.campuses.length +
    sectionFilters.methods.length +
    sectionFilters.modalities.length +
    sectionFilters.days.length +
    sectionFilters.timeBlocks.length +
    (sectionFilters.search.trim() ? 1 : 0);

  const divisionReportRows = useMemo(() => {
    return [...divisionStatuses]
      .sort((a, b) => normalize(a.division_name).localeCompare(normalize(b.division_name)))
      .map((row) => {
        const meta = divisionStatusMeta(row.status);
        return {
          division_name: row.division_name,
          status: meta.label,
          note: meta.note,
          open_sections: row.open_sections_count ?? 0,
          faculty_preferences: row.preferences_count ?? 0,
          tentative_assignments: row.assignments_count ?? 0,
          decision_log_entries: row.decision_logs_count ?? 0,
        };
      });
  }, [divisionStatuses]);

  const visibleSections = useMemo(() => {
    return roleScopedSections.filter((section) => {
      if (selectedDisciplineCode !== "ALL" && section.discipline_code !== selectedDisciplineCode) return false;
      return matchesSectionFilters(section, sectionFilters);
    });
  }, [roleScopedSections, selectedDisciplineCode, sectionFilters]);


  const currentAssignmentByGroup = useMemo(() => {
    const map = new Map();
    tentativeAssignments.forEach((assignment) => {
      if (assignment?.assignment_group_id) map.set(assignment.assignment_group_id, assignment);
    });
    return map;
  }, [tentativeAssignments]);

  const conflictIds = useMemo(() => {
    const ids = new Set();
    facultyPreferences.forEach((preference, index) => {
      facultyPreferences.forEach((other, otherIndex) => {
        if (index !== otherIndex && hasMeetingConflict(preference, other)) {
          ids.add(preference.assignment_group_id);
          ids.add(other.assignment_group_id);
        }
      });
    });
    return ids;
  }, [facultyPreferences]);

  const preferenceDisciplineCodes = useMemo(() => {
    return Array.from(new Set(facultyPreferences.map((item) => item.discipline_code).filter(Boolean))).sort();
  }, [facultyPreferences]);

  const facultySectionRows = useMemo(() => {
    const rankBySection = new Map(facultyPreferences.map((item, index) => [item.assignment_group_id, index + 1]));
    const rows = visibleSections.map((section) => {
      const preferenceRank = rankBySection.get(section.assignment_group_id) || null;
      return {
        ...section,
        preference_rank: preferenceRank,
        is_preferred: Boolean(preferenceRank),
        availabilitySummary: sectionAvailabilitySummary(section, facultyAvailability),
      };
    });
    const preferredFiltered = showOnlyPreferredSections ? rows.filter((section) => section.is_preferred) : rows;
    const conflictFiltered = showOnlyConflictFree
      ? preferredFiltered.filter((section) => !facultyPreferences.some((pref) => pref.assignment_group_id !== section.assignment_group_id && hasMeetingConflict(section, pref)))
      : preferredFiltered;

    return [...conflictFiltered].sort((a, b) => {
      const aPref = finiteNumberOrNull(a.preference_rank) ?? 999999;
      const bPref = finiteNumberOrNull(b.preference_rank) ?? 999999;
      if (aPref !== bPref) return aPref - bPref;
      const aAvailability = a.availabilitySummary?.matches ? 0 : 1;
      const bAvailability = b.availabilitySummary?.matches ? 0 : 1;
      if (aAvailability !== bAvailability) return aAvailability - bAvailability;
      return courseSortKey(a).localeCompare(courseSortKey(b));
    });
  }, [visibleSections, facultyPreferences, facultyAvailability, showOnlyPreferredSections, showOnlyConflictFree]);

  async function loadAvailableSections(disciplineCode = selectedDisciplineCode) {
    if (!activeTerm?.code) return;
    setLoadingSections(true);
    setSectionsError("");
    setAvailableSections([]);

    try {
      const params = new URLSearchParams({ termCode: activeTerm.code });
      if (disciplineCode && disciplineCode !== "ALL") {
        params.set("disciplineCode", disciplineCode);
      }
      const scopedDivisions =
        role === "chair" ? chairDivisions :
        role === "dean" ? deanDivisions :
        [];
      if (scopedDivisions.length) {
        params.set("divisions", scopedDivisions.join("|"));
      }

      const response = await apiFetch(`${API_BASE}/available-sections?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        setSectionsError(data.error || "Could not load available sections.");
        setAvailableSections([]);
        return;
      }

      const fetchedSections = Array.isArray(data.sections) ? data.sections : [];
      const filteredSections =
        disciplineCode && disciplineCode !== "ALL"
          ? fetchedSections.filter((section) => section.discipline_code === disciplineCode)
          : fetchedSections;

      setAvailableSections(filteredSections);
    } catch (error) {
      setSectionsError(error.message || "Could not load available sections.");
      setAvailableSections([]);
    } finally {
      setLoadingSections(false);
    }
  }




  async function loadDivisionStatuses() {
    if (!activeTerm?.code) return;
    setLoadingDivisionStatuses(true);
    try {
      const response = await apiFetch(`${API_BASE}/division-statuses?termCode=${encodeURIComponent(activeTerm.code)}`);
      const data = await response.json();
      if (!response.ok) {
        setDivisionStatuses([]);
        return;
      }
      setDivisionStatuses(Array.isArray(data.divisions) ? data.divisions : []);
    } catch (_error) {
      setDivisionStatuses([]);
    } finally {
      setLoadingDivisionStatuses(false);
    }
  }

  async function loadChairWorkflow() {
    if (!activeTerm?.code) return;
    setLoadingChairWorkflow(true);
    setChairMessage("");
    try {
      const workflowParams = new URLSearchParams({ termCode: activeTerm.code });
      const scopedDiscipline = selectedDisciplineCode && selectedDisciplineCode !== "ALL" ? selectedDisciplineCode : "";
      if (scopedDiscipline) workflowParams.set("disciplineCode", scopedDiscipline);
      const scopedDivisions =
        role === "chair" ? chairDivisions :
        role === "dean" ? deanDivisions :
        [];
      if (scopedDivisions.length) workflowParams.set("divisions", scopedDivisions.join("|"));

      const [workflowResponse, assignmentsResponse, logsResponse, analysisResponse] = await Promise.all([
        apiFetch(`${API_BASE}/chair-workflow?${workflowParams.toString()}`),
        apiFetch(`${API_BASE}/assignments?${workflowParams.toString()}`),
        apiFetch(`${API_BASE}/decision-logs?${workflowParams.toString()}`),
        apiFetch(`${API_BASE}/allocation-analysis?${workflowParams.toString()}`),
      ]);

      const workflowData = await workflowResponse.json();
      const assignmentsData = await assignmentsResponse.json();
      const logsData = await logsResponse.json();
      const analysisData = await analysisResponse.json();

      if (!workflowResponse.ok) {
        setChairMessage(workflowData.error || "Could not load workflow.");
        setChairWorkflowRows([]);
        setChairPreferenceRows([]);
        setTentativeAssignments([]);
        setDecisionLogs([]);
        return;
      }
      if (!assignmentsResponse.ok) {
        setChairMessage(assignmentsData.error || "Could not load tentative assignments.");
        setChairWorkflowRows(workflowData.rows || []);
        setChairPreferenceRows([]);
        setTentativeAssignments([]);
        setDecisionLogs([]);
        return;
      }
      if (!logsResponse.ok) {
        setChairMessage(logsData.error || "Could not load decision logs.");
        setChairWorkflowRows(workflowData.rows || []);
        setChairPreferenceRows([]);
        setTentativeAssignments(assignmentsData.assignments || []);
        setDecisionLogs([]);
        return;
      }
      if (!analysisResponse.ok) {
        setChairMessage(analysisData.error || "Could not load allocation analysis.");
        setAllocationAnalysis(null);
        setContractExceptionReasons([]);
      }

      let exportedPreferences = [];
      try {
        const preferenceResponse = await apiFetch(`${API_BASE}/preferences/export?termCode=${encodeURIComponent(activeTerm.code)}`);
        if (preferenceResponse.ok) {
          const preferenceCsv = await preferenceResponse.text();
          exportedPreferences = Papa.parse(preferenceCsv, { header: true, skipEmptyLines: true }).data || [];
        }
      } catch (_error) {
        exportedPreferences = [];
      }

      setChairWorkflowRows(Array.isArray(workflowData.rows) ? workflowData.rows : []);
      setChairPreferenceRows(exportedPreferences);
      setTentativeAssignments(Array.isArray(assignmentsData.assignments) ? assignmentsData.assignments : []);
      setAllocationAnalysis(analysisData.analysis || null);
      setContractExceptionReasons(Array.isArray(analysisData.exceptionReasons) ? analysisData.exceptionReasons : []);
      setDecisionLogs(Array.isArray(logsData.logs) ? logsData.logs : []);
      loadDivisionStatuses();
    } catch (error) {
      setChairMessage(error.message || "Could not load workflow.");
      setChairWorkflowRows([]);
      setChairPreferenceRows([]);
      setTentativeAssignments([]);
      setAllocationAnalysis(null);
      setContractExceptionReasons([]);
      setDecisionLogs([]);
    } finally {
      setLoadingChairWorkflow(false);
    }
  }

  async function assignSectionToInstructor(row, topEmployeeId, requiresRationale = false) {
    if (!row?.assignment_group_id || !row?.employee_id || !activeTerm?.code) return;
    const expectedRecommendedEmployeeId = topEmployeeId || "";
    const isBypass = Boolean(requiresRationale && topEmployeeId && topEmployeeId !== row.employee_id);
    let exceptionReasonCode = "";
    let exceptionExplanation = "";
    if (isBypass) {
      const activeReasons = contractExceptionReasons.filter((reason) => (reason.active_status || "active") === "active");
      const reasonOptions = activeReasons.map((reason, index) => `${index + 1}. ${reason.code} - ${reason.label}`).join("\n");
      const selectedReason = window.prompt(`Choose the contractual exception reason number:\n\n${reasonOptions}`, "1") || "";
      const selectedIndex = Number(selectedReason) - 1;
      const reason = activeReasons[selectedIndex];
      if (!reason) {
        setChairMessage("A recognized contractual exception reason is required when bypassing the recommended candidate.");
        return;
      }
      exceptionReasonCode = reason.code;
      exceptionExplanation = window.prompt("Enter the written explanation for this non-seniority selection:", "") || "";
      if (!exceptionExplanation.trim()) {
        setChairMessage("A written explanation is required when bypassing the recommended candidate.");
        return;
      }
    }

    setChairMessage("");
    try {
      const response = await apiFetch(`${API_BASE}/chair-decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: activeTerm.code,
          division: row.division,
          disciplineCode: row.discipline_code,
          assignmentGroupId: row.assignment_group_id,
          selectedEmployeeId: row.employee_id,
          exceptionReasonCode,
          exceptionExplanation: exceptionExplanation.trim(),
          expectedRecommendedEmployeeId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setChairMessage(data.error || "Could not record chair decision.");
        return;
      }
      setChairMessage(isBypass ? "Chair exception decision recorded." : "Recommended candidate selected.");
      await loadChairWorkflow();
    } catch (error) {
      setChairMessage(error.message || "Could not record chair decision.");
    }
  }

  async function undoTentativeAssignment(assignment) {
    if (!assignment?.id) return;
    const confirmed = window.confirm(`Unassign ${assignment.primary_subject_course || assignment.assignment_group_id} from ${assignment.faculty_name || assignment.employee_id}?`);
    if (!confirmed) return;

    setChairMessage("");
    try {
      const params = new URLSearchParams();
      if (assignment.version) params.set("expectedVersion", assignment.version);
      const response = await apiFetch(`${API_BASE}/assignments/${assignment.id}${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: assignment.version || null }),
      });
      const data = await response.json();
      if (!response.ok) {
        setChairMessage(data.error || "Could not remove tentative assignment.");
        return;
      }
      setChairMessage(data.message || "Tentative assignment removed.");
      await loadChairWorkflow();
    } catch (error) {
      setChairMessage(error.message || "Could not remove tentative assignment.");
    }
  }


  async function reassignTentativeAssignment(assignment, candidateRow) {
    if (!assignment?.id || !candidateRow?.employee_id) return;
    const reason = window.prompt(
      `Reassign ${assignment.primary_subject_course || assignment.assignment_group_id} from ${assignment.faculty_name || assignment.employee_id} to ${candidateRow.faculty_name || candidateRow.employee_id}. Enter a brief rationale:`,
      ""
    ) || "";
    if (!reason.trim()) {
      setChairMessage("A rationale is required when reassigning a section.");
      return;
    }

    setChairMessage("");
    try {
      const response = await apiFetch(`${API_BASE}/assignments/${assignment.id}/reassign`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: candidateRow.employee_id,
          reason: reason.trim(),
          expectedVersion: assignment.version || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setChairMessage(data.error || "Could not reassign section.");
        return;
      }
      setChairMessage(data.message || "Tentative assignment reassigned.");
      await loadChairWorkflow();
    } catch (error) {
      setChairMessage(error.message || "Could not reassign section.");
    }
  }

  async function submitAssignmentsToDean() {
    if (!activeTerm?.code) return;
    const submittedCount = assignmentStatusCounts.tentative || 0;
    if (!submittedCount) {
      setChairMessage("There are no tentative assignments in the current scope to submit.");
      return;
    }
    const confirmed = window.confirm(`Submit ${submittedCount} tentative assignment(s) to dean review for the current scope?`);
    if (!confirmed) return;
    setChairMessage("");
    try {
      const scopedDivisions = role === "chair" ? chairDivisions : [];
      const response = await apiFetch(`${API_BASE}/assignments/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: activeTerm.code,
          disciplineCode: selectedDisciplineCode !== "ALL" ? selectedDisciplineCode : "",
          divisions: scopedDivisions,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setChairMessage(data.error || "Could not submit assignments.");
        return;
      }
      setChairMessage(data.message || "Assignments submitted to dean review.");
      await loadChairWorkflow();
    } catch (error) {
      setChairMessage(error.message || "Could not submit assignments.");
    }
  }

  async function approveSubmittedAssignments() {
    if (!activeTerm?.code) return;
    const approvedCount = assignmentStatusCounts.chair_submitted || 0;
    if (!approvedCount) {
      setChairMessage("There are no chair-submitted assignments in the current scope to approve.");
      return;
    }
    const confirmed = window.confirm(`Approve ${approvedCount} submitted assignment(s) for the current scope?`);
    if (!confirmed) return;
    setChairMessage("");
    try {
      const scopedDivisions = role === "dean" ? deanDivisions : [];
      const response = await apiFetch(`${API_BASE}/assignments/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: activeTerm.code,
          disciplineCode: selectedDisciplineCode !== "ALL" ? selectedDisciplineCode : "",
          divisions: scopedDivisions,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setChairMessage(data.error || "Could not approve assignments.");
        return;
      }
      setChairMessage(data.message || "Assignments approved.");
      await loadChairWorkflow();
    } catch (error) {
      setChairMessage(error.message || "Could not approve assignments.");
    }
  }

  async function loadFacultyPreferences(facultyId = selectedFacultyId) {
    if (!activeTerm?.code) return;
    try {
      setPreferencesMessage("Loading saved preferences...");
      const resolvedFacultyId = facultyId || selectedFaculty?.employeeId || "";
      if (!resolvedFacultyId) {
        setPreferencesMessage("Select a faculty member before loading preferences.");
        return;
      }
      const params = new URLSearchParams({ termCode: activeTerm.code, facultyId: resolvedFacultyId });
      const response = await apiFetch(`${API_BASE}/preferences?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setPreferencesMessage(data.error || "Could not load saved preferences.");
        setFacultyPreferences([]);
        setFacultyAvailability({ days: [], timeBlocks: [] });
        return;
      }
      setFacultyPreferences(data.preferences || []);
      setFacultyAvailability({
        days: Array.isArray(data.availability?.days) ? data.availability.days : [],
        timeBlocks: Array.isArray(data.availability?.timeBlocks) ? data.availability.timeBlocks : [],
      });
      setPreferencesMessage(`Loaded ${(data.preferences || []).length} saved preference(s).`);
    } catch (error) {
      setPreferencesMessage(error.message || "Could not load saved preferences.");
      setFacultyPreferences([]);
      setFacultyAvailability({ days: [], timeBlocks: [] });
    }
  }

  function toggleAvailabilityValue(kind, value) {
    setFacultyAvailability((current) => {
      const currentValues = Array.isArray(current[kind]) ? current[kind] : [];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];
      return { ...current, [kind]: nextValues };
    });
    setPreferencesMessage("");
  }

  function addPreference(section) {
    if (facultyPreferences.some((item) => item.assignment_group_id === section.assignment_group_id)) return;
    const next = [
      ...facultyPreferences,
      {
        ...section,
        preference_rank: facultyPreferences.length + 1,
        faculty_id: selectedFaculty?.id,
        employee_id: selectedFaculty?.employeeId,
        faculty_name: selectedFaculty ? facultyName(selectedFaculty) : "",
      },
    ];
    setFacultyPreferences(next.map((item, index) => ({ ...item, preference_rank: index + 1 })));
    setPreferencesMessage("");
  }

  function removePreference(assignmentGroupId) {
    const next = facultyPreferences
      .filter((item) => item.assignment_group_id !== assignmentGroupId)
      .map((item, index) => ({ ...item, preference_rank: index + 1 }));
    setFacultyPreferences(next);
    setPreferencesMessage("");
  }

  function movePreference(fromIndex, toIndex) {
    const next = reorderList(facultyPreferences, fromIndex, toIndex).map((item, index) => ({
      ...item,
      preference_rank: index + 1,
    }));
    setFacultyPreferences(next);
    setPreferencesMessage("");
  }

  async function savePreferences(action = "submit") {
    if (!selectedFaculty) return;
    setSavingPreferences(true);
    setPreferencesMessage("");
    try {
      const response = await apiFetch(`${API_BASE}/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: activeTerm.code,
          facultyId: selectedFaculty.employeeId,
          employeeId: selectedFaculty.employeeId,
          facultyName: facultyName(selectedFaculty),
          action,
          preferences: facultyPreferences.map((item, index) => ({
            assignment_group_id: item.assignment_group_id,
            discipline_code: item.discipline_code,
            preference_rank: index + 1,
          })),
          availability: facultyAvailability,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPreferencesMessage(data.error || "Could not save preferences.");
        return;
      }
      setPreferencesMessage(action === "draft"
        ? `Draft saved with ${data.savedCount || 0} preference(s).`
        : `Submitted ${data.savedCount || 0} preference(s), version ${data.versionNumber || ""}.`);
      await writeAudit("preferences_saved", `Saved ${data.savedCount || 0} faculty preference row(s).`, {
        division: "",
        term: activeTerm.code,
        instructor_name: facultyName(selectedFaculty),
        new_value: String(data.savedCount || 0),
      });
      loadFacultyPreferences(selectedFaculty.employeeId);
    } catch (error) {
      setPreferencesMessage(error.message || "Could not save preferences.");
    } finally {
      setSavingPreferences(false);
    }
  }

  function toggleSectionFilter(kind, value) {
    setSectionFilters((current) => {
      const values = current[kind] || [];
      const exists = values.includes(value);
      return {
        ...current,
        [kind]: exists ? values.filter((item) => item !== value) : [...values, value],
      };
    });
  }

  function clearSectionFilters() {
    setSectionFilters({ campuses: [], methods: [], modalities: [], days: [], timeBlocks: [], search: "" });
  }

  async function exportPreferences() {
    try {
      const response = await apiFetch(`${API_BASE}/preferences/export?termCode=${activeTerm.code}`);
      const text = await response.text();
      const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${activeTerm.code.toLowerCase()}-faculty-preferences.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setPreferencesMessage(error.message || "Could not export preferences.");
    }
  }


  async function loadMappingList() {
    setLoadingMappingList(true);
    setMappingAdminError("");
    try {
      const response = await apiFetch(`${API_BASE}/subject-mapping?scope=global&termCode=${activeTerm.code}`);
      const data = await response.json();
      if (!response.ok) {
        setMappingAdminError(data.error || "Could not load mappings.");
        return;
      }
      setMappingList(data.mappings || []);
      setShowMappingList(true);
    } catch (error) {
      setMappingAdminError(error.message || "Could not load mappings.");
    } finally {
      setLoadingMappingList(false);
    }
  }

  async function handleExportMappings() {
    setMappingAdminError("");
    try {
      const response = await apiFetch(`${API_BASE}/subject-mapping/export?scope=global&termCode=${activeTerm.code}`);
      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch (_error) {
          data = {};
        }
        setMappingAdminError(data.error || "Could not export mappings.");
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "subject-mapping.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setMappingAdminError(error.message || "Could not export mappings.");
    }
  }


  useEffect(() => {
    async function loadMappingStatus() {
      try {
        const response = await apiFetch(`${API_BASE}/subject-mapping/${activeTerm.code}/status`);
        const data = await response.json();
        if (!response.ok) return;

        if ((data.globalCount || 0) > 0 || (data.termCount || 0) > 0) {
          setMappingReport({
            error: "",
            importedRows: data.globalCount || 0,
            fileName: "",
            globalCount: data.globalCount || 0,
            termCount: data.termCount || 0,
            scope: "global",
            message: "Saved subject mapping was loaded from the backend automatically.",
            loadedFromBackend: true,
          });
        }
      } catch (_error) {
        // silent, page can still function without the status badge
      }
    }

    loadMappingStatus();
  }, [activeTerm.code]);

  async function handleSubjectMappingUpload(file) {
    if (!file) return;

    setUploadingMapping(true);
    setMappingReport({ error: "", importedRows: 0, fileName: file.name });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("termCode", activeTerm.code);

      const response = await apiFetch(`${API_BASE}/upload/subject-mapping`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setMappingReport({
          error: data.error || "Mapping upload failed.",
          importedRows: 0,
          fileName: file.name,
          globalCount: data.globalCount || 0,
          termCount: data.termCount || 0,
          scope: data.scope || "",
          message: data.message || "",
          loadedFromBackend: false,
        });
        return;
      }

      setMappingReport({
        error: "",
        importedRows: data.importedRows || 0,
        fileName: file.name,
        globalCount: data.globalCount || data.importedRows || 0,
        termCount: data.termCount || 0,
        scope: data.scope || "global",
        message: data.message || "",
        loadedFromBackend: false,
      });
    } catch (error) {
      setMappingReport({
        error: error.message || "Unexpected mapping upload error.",
        importedRows: 0,
        fileName: file.name,
        globalCount: 0,
        termCount: 0,
        scope: "",
        message: "",
        loadedFromBackend: false,
      });
    } finally {
      setUploadingMapping(false);
    }
  }


  function clearPendingUploadState({ clearMessage = false } = {}) {
    setPendingUploadFile(null);
    setUploadConflict(null);
    setUploadPreview(null);
    setUploadInputKey((value) => value + 1);
    if (clearMessage) {
      setBackendMessage("");
    }
  }

  async function requestSchedulePreview(file) {
    if (!file) return;
    if (!selectedUploadDivision) {
      setBackendMessage("Select a division before uploading.");
      return;
    }

    setPreviewingUpload(true);
    setBackendMessage("");
    setUploadConflict(null);
    setUploadPreview(null);
    setPendingUploadFile(file);
    setUploadReport({
      errors: [],
      warnings: [],
      unmappedSubjects: [],
      importedCount: 0,
      fileName: file.name,
      summary: null,
    });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("termCode", activeTerm.code);
      formData.append("divisionName", selectedUploadDivision);

      const data = await fetchJson("/upload/schedule/preview", {
        method: "POST",
        body: formData,
      }, "Preview failed.");

      setUploadPreview({
        ok: Boolean(data.ok),
        fileName: file.name,
        errors: data.errors || [],
        warnings: data.warnings || [],
        unmappedSubjects: data.unmappedSubjects || [],
        summary: data.summary || null,
        impact: data.impact || null,
        divisionName: data.divisionName || selectedUploadDivision,
      });

      if (!data.ok) {
        setBackendMessage("Preview found issues. Review before uploading.");
      }
    } catch (error) {
      setUploadPreview({
        ok: false,
        fileName: file.name,
        errors: [error.message || "Could not preview this upload."],
        warnings: [],
        unmappedSubjects: [],
        summary: null,
        impact: null,
        divisionName: selectedUploadDivision,
      });
      setBackendMessage("Could not reach the backend service.");
    } finally {
      setPreviewingUpload(false);
    }
  }

  function handleScheduleFileSelection(file) {
    if (!file) return;
    requestSchedulePreview(file);
  }

  async function handleScheduleUpload(file, options = {}) {
    const { forceReplace = false } = options;
    const targetFile = file || pendingUploadFile;
    if (!targetFile) return;
    if (!selectedUploadDivision) {
      setBackendMessage("Select a division before uploading.");
      return;
    }

    setUploadingSchedule(true);
    setBackendMessage("");
    setUploadConflict(null);
    setUploadReport({
      errors: [],
      warnings: [],
      unmappedSubjects: [],
      importedCount: 0,
      fileName: targetFile.name,
      summary: null,
    });

    try {
      const formData = new FormData();
      formData.append("file", targetFile);
      formData.append("termCode", activeTerm.code);
      formData.append("divisionName", selectedUploadDivision);
      if (forceReplace) {
        formData.append("forceReplace", "true");
      }

      const data = await fetchJson("/upload/schedule", {
        method: "POST",
        body: formData,
      }, "Could not upload schedule.");

      if (!data.ok) {
        if (data.code === "existing_work_detected") {
          setPendingUploadFile(targetFile);
          setUploadConflict(data);
          setBackendMessage("Existing class selection or approval work was found for this division. Review before replacing it.");
          return;
        }

        setUploadReport({
          errors: data.errors || [data.error || "Upload failed."],
          warnings: data.warnings || [],
          unmappedSubjects: data.unmappedSubjects || [],
          importedCount: 0,
          fileName: targetFile.name,
          summary: data.summary || null,
        });
        setBackendMessage("Backend rejected the upload. Fix the issues and reupload.");
        return;
      }

      setSections([]);
      setUploadReport({
        errors: [],
        warnings: data.warnings || [],
        unmappedSubjects: data.unmappedSubjects || [],
        importedCount: data.importedCount || 0,
        fileName: targetFile.name,
        summary: data.summary || null,
      });
      const ignoredRowsNote = data.summary?.ignoredRowsFromOtherDivisions
        ? ` Ignored ${data.summary.ignoredRowsFromOtherDivisions} row(s) outside ${data.divisionName || selectedUploadDivision}.`
        : "";
      setBackendMessage(`${data.divisionName || selectedUploadDivision} uploaded successfully.${data.replacedCount ? ` Replaced ${data.replacedCount} existing section bundle(s) for this division.` : ""}${ignoredRowsNote}`);
      clearPendingUploadState();
      loadAvailableSections(selectedDisciplineCode);
      if (role === "admin" || role === "chair" || role === "dean") {
        loadChairWorkflow();
      }
    } catch (error) {
      setUploadReport({
        errors: [error.message || "Unexpected upload error."],
        warnings: [],
        unmappedSubjects: [],
        importedCount: 0,
        fileName: targetFile.name,
        summary: null,
      });
      setBackendMessage("Could not reach the backend service.");
    } finally {
      setUploadingSchedule(false);
    }
  }

  const summary = {
    ready: disciplines.filter((d) => d.status === "ready").length,
    open: disciplines.filter((d) => d.status === "open").length,
    pending: disciplines.filter((d) => d.status === "chair_finalized").length,
    approved: disciplines.filter((d) => d.status === "dean_approved").length,
    submitted: 0,
    noActivity: 0,
  };

  return (
    <div style={{ ...ui.page, ...themeVars }}>
      <style>{`
        .cos-table tbody tr:nth-child(even) { background: rgba(36, 51, 122, 0.03); }
        .cos-table tbody tr:hover { background: rgba(240, 84, 35, 0.08); transition: background 140ms ease; }
        .cos-summary-card { position: relative; overflow: hidden; }
        .cos-summary-card::after { content: ""; position: absolute; inset: auto -24px -24px auto; width: 96px; height: 96px; background: radial-gradient(circle, rgba(240,84,35,0.14), transparent 65%); border-radius: 999px; }
        @media (max-width: 980px) {
          .cos-panel-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={ui.shell}>
        <div style={heroCardStyle}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at top right, rgba(255,255,255,0.2), transparent 34%)" }} />
          <div style={{ ...ui.between, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <img
                src={cosLogo}
                alt="Staffing Coordination & Preference Engine logo"
                style={{ width: 120, height: 120, objectFit: "contain", borderRadius: 22, background: "rgba(255,255,255,0.1)", padding: 8, boxShadow: "0 16px 34px rgba(15,23,42,0.22)" }}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.92 }}>
                  College of the Sequoias
                </div>
                <h1 style={{ fontSize: 36, margin: "4px 0 0 0", fontWeight: 900, letterSpacing: "-0.04em" }}>
                  S.C.O.P.E.
                </h1>
                <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800, maxWidth: 720, lineHeight: 1.35, opacity: 0.98 }}>
                  Staffing Coordination & Preference Engine
                </div>
                <div style={{ marginTop: 8, fontSize: 14, maxWidth: 720, lineHeight: 1.5, opacity: 0.96 }}>
                  Smarter faculty staffing starts here.
                </div>
                {preferenceWipeMessage ? (
                  <div style={{ marginTop: 10, color: preferenceWipeMessage.startsWith("Deleted") ? "#166534" : "#b91c1c", fontWeight: 700 }}>
                    {preferenceWipeMessage}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ ...ui.row, alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 999, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.22)", fontWeight: 800 }}>
                <span>Dark View</span>
                <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
              </label>
              {canShowWorkspace ? (
                <>
                  <select
                    style={{ ...ui.select, background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)" }}
                    value={role}
                    onChange={(e) => { setRole(e.target.value); setSelectedDisciplineCode("ALL"); }}
                  >
                    {roleOptions.map((option) => (
                      <option key={option.value} value={option.value} style={{ color: "#0f172a" }}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    style={{ ...ui.select, background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)", minWidth: 220 }}
                    value={activeTerm.code}
                    onChange={(e) => activateTerm(e.target.value)}
                    disabled={!canUseAdminTools}
                    title={canUseAdminTools ? "Switch active term" : "Admin access is required to switch the active term"}
                  >
                    {terms.length ? terms.map((term) => (
                      <option key={term.code} value={term.code} style={{ color: "#0f172a" }}>
                        {term.name}{term.active ? " - Active" : ""}
                      </option>
                    )) : (
                      <option value={activeTerm.code} style={{ color: "#0f172a" }}>{activeTerm.name}</option>
                    )}
                  </select>
                </>
              ) : null}
              <form
                onSubmit={handleLogin}
                style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderRadius: 16, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)" }}
              >
                {currentUser ? (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>
                      {currentUser.full_name || currentUser.email}
                    </span>
                    <button type="button" style={ui.btn} onClick={handleLogout} disabled={authBusy}>
                      Sign Out
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => {
                        setAuthEmail(e.target.value);
                        setAuthMessage("");
                      }}
                      placeholder="Email"
                      aria-label="Email"
                      style={{ ...ui.input, width: 180, padding: "9px 10px", background: "rgba(255,255,255,0.92)", color: "#0f172a" }}
                    />
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => {
                        setAuthPassword(e.target.value);
                        setAuthMessage("");
                      }}
                      placeholder="Password"
                      aria-label="Password"
                      style={{ ...ui.input, width: 150, padding: "9px 10px", background: "rgba(255,255,255,0.92)", color: "#0f172a" }}
                    />
                    <button type="submit" style={ui.btn} disabled={authBusy}>
                      Sign In
                    </button>
                    <button type="button" style={ui.btn} onClick={() => setResetEmail(authEmail)}>
                      Forgot
                    </button>
                  </>
                )}
                {authMessage ? (
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>{authMessage}</span>
                ) : null}
              </form>
              {canShowWorkspace ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderRadius: 16, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)" }}>
                <input
                  type="password"
                  value={apiTokenInput}
                  onChange={(e) => {
                    setApiTokenInput(e.target.value);
                    setApiAccessMessage("");
                  }}
                  placeholder="API access token"
                  aria-label="API access token"
                  style={{ ...ui.input, width: 190, padding: "9px 10px", background: "rgba(255,255,255,0.92)", color: "#0f172a" }}
                />
                <button type="button" style={ui.btn} onClick={saveApiAccessToken}>
                  {apiTokenConfigured ? "Update Token" : "Save Token"}
                </button>
                {apiTokenConfigured ? (
                  <button type="button" style={ui.btn} onClick={clearApiAccessToken}>
                    Clear
                  </button>
                ) : null}
                {apiAccessMessage ? (
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>{apiAccessMessage}</span>
                ) : null}
              </div>
              ) : null}
            </div>
          </div>
        </div>

        {canShowWorkspace ? (
        <div style={ui.gridSummary}>
          <SummaryCard title="Ready" value={summary.ready} />
          <SummaryCard title="Open" value={summary.open} />
          <SummaryCard title="Pending Dean" value={summary.pending} />
          <SummaryCard title="Approved" value={summary.approved} />
          <SummaryCard title="Submitted" value={summary.submitted} />
          <SummaryCard title="No Activity" value={summary.noActivity} />
        </div>
        ) : null}

        {setupInviteToken && !currentUser ? (
          <div style={ui.card}>
            <h2 style={ui.cardTitle}>Set Up Account</h2>
            <div style={ui.cardDesc}>
              Enter your name and create a password to activate this S.C.O.P.E. invitation.
            </div>
            <form onSubmit={handleAcceptInvitation} style={{ ...ui.row, marginTop: 16, alignItems: "center" }}>
              <input
                style={{ ...ui.input, maxWidth: 260 }}
                value={setupFullName}
                onChange={(e) => setSetupFullName(e.target.value)}
                placeholder="Full name"
              />
              <input
                style={{ ...ui.input, maxWidth: 260 }}
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                placeholder="Password, 10+ characters"
                type="password"
                minLength={10}
                required
              />
              <button type="submit" style={ui.btnPrimary} disabled={setupBusy}>
                {setupBusy ? "Activating..." : "Activate Account"}
              </button>
            </form>
            {setupMessage ? (
              <div style={{ marginTop: 10, fontSize: 13, color: setupMessage.startsWith("Account") ? "var(--text-muted)" : "#b91c1c", fontWeight: 700 }}>
                {setupMessage}
              </div>
            ) : null}
          </div>
        ) : null}

        {resetToken && !currentUser ? (
          <div style={ui.card}>
            <h2 style={ui.cardTitle}>Reset Password</h2>
            <div style={ui.cardDesc}>
              Create a new password for your S.C.O.P.E. account.
            </div>
            <form onSubmit={handleCompletePasswordReset} style={{ ...ui.row, marginTop: 16, alignItems: "center" }}>
              <input
                style={{ ...ui.input, maxWidth: 260 }}
                value={newResetPassword}
                onChange={(e) => setNewResetPassword(e.target.value)}
                placeholder="Password, 10+ characters"
                type="password"
                minLength={10}
                required
              />
              <button type="submit" style={ui.btnPrimary} disabled={newResetBusy}>
                {newResetBusy ? "Resetting..." : "Reset Password"}
              </button>
            </form>
            {newResetMessage ? (
              <div style={{ marginTop: 10, fontSize: 13, color: newResetMessage.startsWith("Password") ? "var(--text-muted)" : "#b91c1c", fontWeight: 700 }}>
                {newResetMessage}
              </div>
            ) : null}
          </div>
        ) : null}

        {!currentUser && !setupInviteToken && !resetToken ? (
          <div className="cos-panel-grid" style={{ ...ui.panelGrid, gridTemplateColumns: "minmax(0, 1.3fr) minmax(320px, 0.7fr)" }}>
            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Request Account Access</h2>
              <div style={ui.cardDesc}>
                Submit your details for scheduler review. Approved requests receive an account setup email.
              </div>
              <form onSubmit={submitAccessRequest} style={{ display: "grid", gap: 10, marginTop: 16 }}>
                <div style={ui.row}>
                  <input
                    style={{ ...ui.input, maxWidth: 260 }}
                    value={accessRequestForm.full_name}
                    onChange={(e) => setAccessRequestForm((prev) => ({ ...prev, full_name: e.target.value }))}
                    placeholder="Full name"
                    required
                  />
                  <input
                    style={{ ...ui.input, maxWidth: 260 }}
                    value={accessRequestForm.email}
                    onChange={(e) => setAccessRequestForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="user@cos.edu"
                    type="email"
                    required
                  />
                  <input
                    style={{ ...ui.input, maxWidth: 160 }}
                    value={accessRequestForm.employee_id}
                    onChange={(e) => setAccessRequestForm((prev) => ({ ...prev, employee_id: e.target.value }))}
                    placeholder="Employee ID"
                  />
                </div>
                <div style={ui.row}>
                  <select
                    style={{ ...ui.input, maxWidth: 220 }}
                    value={accessRequestForm.role}
                    onChange={(e) => setAccessRequestForm((prev) => ({ ...prev, role: e.target.value }))}
                  >
                    <option value="faculty">Part-Time Faculty</option>
                    <option value="chair">Division Chair</option>
                    <option value="dean">Dean</option>
                  </select>
                  <select
                    style={{ ...ui.input, maxWidth: 260 }}
                    value={accessRequestForm.division}
                    onChange={(e) => setAccessRequestForm((prev) => ({ ...prev, division: e.target.value }))}
                    required
                  >
                    <option value="">Select division</option>
                    {uploadDivisionOptions.map((division) => (
                      <option key={division} value={division}>{division}</option>
                    ))}
                  </select>
                  <input
                    style={{ ...ui.input, maxWidth: 360 }}
                    value={accessRequestForm.note}
                    onChange={(e) => setAccessRequestForm((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Optional note"
                  />
                  <button type="submit" style={ui.btnPrimary} disabled={accessRequestBusy}>
                    {accessRequestBusy ? "Submitting..." : "Request Access"}
                  </button>
                </div>
              </form>
              {accessRequestMessage ? (
                <div style={{ marginTop: 10, fontSize: 13, color: accessRequestMessage.startsWith("Account") ? "var(--text-muted)" : "#b91c1c", fontWeight: 700 }}>
                  {accessRequestMessage}
                </div>
              ) : null}
            </div>
            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Password Help</h2>
              <div style={ui.cardDesc}>
                Send a reset link to the email on your active account.
              </div>
              <form onSubmit={sendPasswordResetRequest} style={{ ...ui.row, marginTop: 16 }}>
                <input
                  style={{ ...ui.input, maxWidth: 260 }}
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="user@cos.edu"
                  type="email"
                  required
                />
                <button type="submit" style={ui.btnPrimary} disabled={resetBusy}>
                  {resetBusy ? "Sending..." : "Send Reset"}
                </button>
              </form>
              {resetMessage ? (
                <div style={{ marginTop: 10, fontSize: 13, color: resetMessage.startsWith("If") ? "var(--text-muted)" : "#b91c1c", fontWeight: 700 }}>
                  {resetMessage}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {canShowWorkspace ? (
        <>
        {canUseAdminTools ? (
        <div className="cos-summary-card" style={ui.card}>
          <div style={ui.between}>
            <div>
              <h2 style={ui.cardTitle}>Manage Terms</h2>
              <div style={ui.cardDesc}>
                Add future semesters here, then switch the active staffing cycle from the header dropdown.
              </div>
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
              Active: {activeTerm?.name || "Spring 2027"}
            </div>
          </div>

          <div style={{ ...ui.row, marginTop: 16 }}>
            <input
              style={{ ...ui.input, maxWidth: 180 }}
              value={newTermCode}
              onChange={(e) => setNewTermCode(e.target.value.toUpperCase())}
              placeholder="SP28"
            />
            <input
              style={{ ...ui.input, maxWidth: 280 }}
              value={newTermName}
              onChange={(e) => setNewTermName(e.target.value)}
              placeholder="Spring 2028"
            />
            <button style={ui.btnPrimary} onClick={createOrUpdateTerm}>
              Save Term
            </button>
          </div>

          <div style={ui.tableWrap}>
            <table className="cos-table" style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Term Code</th>
                  <th style={ui.th}>Term Name</th>
                  <th style={ui.th}>Status</th>
                  <th style={ui.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {terms.length ? (
                  terms.map((term) => (
                    <tr key={term.code}>
                      <td style={ui.td}>{term.code}</td>
                      <td style={ui.td}>{term.name}</td>
                      <td style={ui.td}>{term.active ? "Active" : "Available"}</td>
                      <td style={ui.td}>
                        <button style={ui.btn} disabled={term.active} onClick={() => activateTerm(term.code)}>
                          {term.active ? "Current Term" : "Make Active"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={ui.td} colSpan={4}>No terms loaded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {termMessage ? (
            <div style={{ marginTop: 12, color: termMessage.toLowerCase().includes("could not") ? "#b91c1c" : "#166534", fontWeight: 700 }}>
              {termMessage}
            </div>
          ) : null}
        </div>
        ) : null}

        {canUseAdminTools ? (
        <div className="cos-summary-card" style={ui.card}>
          <h2 style={ui.cardTitle}>Subject Mapping Upload</h2>
          <div style={ui.cardDesc}>
            Upload a CSV with columns: <code>subject_code</code>, <code>discipline_code</code>. This saves a global mapping that later schedule uploads reuse automatically.
          </div>
          <div style={{ marginTop: 16 }}>
            <input
              style={ui.input}
              type="file"
              accept=".csv"
              disabled={uploadingMapping}
              onChange={(e) => handleSubjectMappingUpload(e.target.files?.[0])}
            />
          </div>

          <div style={{ ...ui.row, marginTop: 12 }}>
            <button style={ui.btn} type="button" onClick={loadMappingList} disabled={loadingMappingList}>
              {loadingMappingList ? "Loading mappings..." : "View current mappings"}
            </button>
            <button style={ui.btn} type="button" onClick={handleExportMappings}>
              Export mappings
            </button>
            {showMappingList ? (
              <button style={ui.btn} type="button" onClick={() => setShowMappingList(false)}>
                Hide mappings
              </button>
            ) : null}
          </div>


          <div style={{ ...ui.sectionCard, marginTop: 16 }}>
            <div style={{ fontWeight: 700 }}>Starter Mapping Example</div>
            <div style={{ marginTop: 8, color: "var(--text-muted)" }}>Use this exact header format in your CSV.</div>
            <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 13 }}>
{`subject_code,discipline_code
BUS,BUSINESS
PLSI,POLITICAL_SCIENCE
ASCI,ANIMAL_SCIENCE
AGTC,AGRICULTURE_TECHNOLOGY
AG,AGRICULTURE
VT,VETERINARIAN_ASSISTING
OH,ORNAMENTAL_HORTICULTURE`}
            </pre>
          </div>

          {uploadingMapping ? (
            <div style={{ marginTop: 12, color: "var(--text-muted)", fontWeight: 700 }}>
              Uploading subject mapping...
            </div>
          ) : null}

          {(mappingReport.fileName || mappingReport.loadedFromBackend) ? (
            <div style={{ ...ui.sectionCard, marginTop: 16 }}>
              <div style={{ fontWeight: 700 }}>
                {mappingReport.fileName
                  ? `Latest mapping upload: ${mappingReport.fileName}`
                  : "Saved subject mapping found in backend"}
              </div>
              {mappingReport.error ? (
                <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
                  {mappingReport.error}
                </div>
              ) : (
                <>
                  <div style={{ marginTop: 12, color: "#166534", fontWeight: 700 }}>
                    {mappingReport.loadedFromBackend
                      ? `Subject mapping is already saved. ${mappingReport.globalCount} global row(s) available.`
                      : `Mapping uploaded successfully. ${mappingReport.importedRows} row(s) imported.`}
                  </div>
                  <div style={{ marginTop: 8, color: "#334155" }}>
                    {mappingReport.message || "Future schedule uploads will reuse this mapping automatically."}
                  </div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
                    Global mappings: {mappingReport.globalCount || 0}
                    {mappingReport.termCount ? `, term-specific overrides: ${mappingReport.termCount}` : ""}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
        ) : null}

        {canUseAdminTools && mappingAdminError ? (
          <div style={{ ...ui.card, borderColor: "#fecaca", background: "#fff7f7" }}>
            <div style={{ color: "#b91c1c", fontWeight: 700 }}>{mappingAdminError}</div>
          </div>
        ) : null}

        {canUseAdminTools && showMappingList ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Current Subject Mappings</h2>
                <div style={ui.cardDesc}>
                  Global mappings currently saved in the backend and reused for future schedule uploads.
                </div>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {mappingList.length} mapping row(s)
              </div>
            </div>

            {mappingList.length ? (
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="cos-table" style={ui.table}>
                  <thead>
                    <tr>
                      <th style={ui.th}>Subject Code</th>
                      <th style={ui.th}>Discipline Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingList.map((row, idx) => (
                      <tr key={`${row.subject_code}-${row.discipline_code}-${idx}`}>
                        <td style={ui.td}>{row.subject_code}</td>
                        <td style={ui.td}>{row.discipline_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
                No mappings are currently saved.
              </div>
            )}
          </div>
        ) : null}

        {canUseAdminTools ? (
        <div style={ui.card}>
          <h2 style={ui.cardTitle}>Schedule Upload</h2>
          <div style={ui.cardDesc}>
            Upload one division at a time after subject mapping is in place. You can upload a full college-wide file and the system will keep only rows that match the selected division, then replace only that division for the active term.
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ ...ui.between, marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>Division Status</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {loadingDivisionStatuses ? "Refreshing division activity..." : "Clean, loaded, in progress, or advanced at a glance."}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {divisionStatusCards.map((item) => (
                <button
                  key={item.division}
                  type="button"
                  onClick={() => setSelectedUploadDivision(item.division)}
                  style={{
                    textAlign: "left",
                    border: selectedUploadDivision === item.division ? "1px solid rgba(240,84,35,0.45)" : "1px solid var(--border-soft)",
                    background: selectedUploadDivision === item.division ? "linear-gradient(135deg, rgba(36,51,122,0.10), rgba(240,84,35,0.08), rgba(127,190,65,0.10))" : "var(--bg-soft)",
                    borderRadius: 16,
                    padding: 12,
                    cursor: "pointer",
                    color: "var(--text-main)",
                  }}
                >
                  <div style={{ ...ui.between, alignItems: "center", gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{item.division}</div>
                    <span style={workflowStatePillStyle(item.meta.kind)}>{item.meta.label}</span>
                  </div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>{item.meta.note}</div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={workflowStatePillStyle("filled")}>{item.sectionCount || 0} sections</span>
                    {(item.preferenceCount || item.submissionCount) ? <span style={workflowStatePillStyle("top")}>{(item.preferenceCount || 0) + (item.submissionCount || 0)} prefs/submissions</span> : null}
                    {item.tentativeAssignmentCount ? <span style={workflowStatePillStyle("assigned")}>{item.tentativeAssignmentCount} tentative</span> : null}
                    {(item.chairFinalizedCount || item.deanApprovedCount || item.approvedAssignmentCount) ? <span style={workflowStatePillStyle("advanced")}>{(item.chairFinalizedCount || 0) + (item.deanApprovedCount || 0) + (item.approvedAssignmentCount || 0)} finalized/approved</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: 720 }}>
            <div>
              <div style={{ marginBottom: 6, fontWeight: 700 }}>Division</div>
              <select
                style={ui.alphaSelect}
                value={selectedUploadDivision}
                onChange={(e) => setSelectedUploadDivision(e.target.value)}
                disabled={uploadingSchedule}
              >
                {uploadDivisionOptions.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
              <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                Divisions are sorted A to Z. A new upload replaces only this division for the active term, and a college-wide CSV will be filtered down to this division when division data is present in the file.
              </div>
            </div>
            <input
              key={uploadInputKey}
              style={ui.input}
              type="file"
              accept=".csv"
              disabled={uploadingSchedule || previewingUpload}
              onChange={(e) => handleScheduleFileSelection(e.target.files?.[0])}
            />
          </div>


          {previewingUpload ? (
            <div style={{ marginTop: 12, color: "var(--text-muted)", fontWeight: 700 }}>
              Previewing upload impact...
            </div>
          ) : null}

          {uploadPreview ? (
            <div style={{ ...ui.sectionCard, marginTop: 16, borderColor: uploadPreview.ok ? "rgba(36, 51, 122, 0.18)" : "#f59e0b", background: uploadPreview.ok ? "var(--bg-soft)" : "#fffbeb" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>
                    Upload impact preview{uploadPreview.fileName ? ` · ${uploadPreview.fileName}` : ""}
                  </div>
                  <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
                    {uploadPreview.divisionName || selectedUploadDivision} · {activeTerm.code}
                  </div>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  Nothing changes until you confirm.
                </div>
              </div>

              {uploadPreview.summary ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                  <TinyStat label="Source Rows" value={uploadPreview.summary.sourceTotalRows ?? uploadPreview.summary.totalRows ?? 0} />
                  <TinyStat label="Kept Rows" value={uploadPreview.summary.keptRowsForDivision ?? uploadPreview.summary.totalRows ?? 0} />
                  <TinyStat label="Ignored Rows" value={uploadPreview.summary.ignoredRowsFromOtherDivisions || 0} />
                  <TinyStat label="Bundles" value={uploadPreview.summary.importedSectionBundles ?? uploadPreview.summary.assignmentGroups ?? 0} />
                  <TinyStat label="Will Replace" value={uploadPreview.impact?.sections || 0} />
                  <TinyStat label="Prefs" value={uploadPreview.impact?.facultyPreferences || 0} />
                  <TinyStat label="Assignments" value={uploadPreview.impact?.tentativeAssignments || 0} />
                  <TinyStat label="Chair/Dean" value={uploadPreview.impact?.disciplineWindows || 0} />
                </div>
              ) : null}

              {uploadPreview.impact?.hasProtectedWork ? (
                <div style={{ marginTop: 12, color: "#92400e", fontWeight: 700 }}>
                  This division already has downstream work attached. Uploading will require an extra confirmation before replacement.
                </div>
              ) : null}

              {uploadPreview.errors?.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {uploadPreview.errors.map((err, idx) => (
                    <div key={idx} style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 12, padding: "10px 12px" }}>
                      {err}
                    </div>
                  ))}
                </div>
              ) : null}

              {uploadPreview.warnings?.length ? (
                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                  {uploadPreview.warnings.slice(0, 6).map((warn, idx) => (
                    <div key={idx} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", borderRadius: 12, padding: "10px 12px" }}>
                      {warn}
                    </div>
                  ))}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                <button
                  style={ui.btnPrimary}
                  onClick={() => handleScheduleUpload()}
                  disabled={!uploadPreview.ok || uploadingSchedule}
                >
                  Confirm Upload
                </button>
                <button
                  style={ui.btn}
                  onClick={() => clearPendingUploadState({ clearMessage: true })}
                  disabled={uploadingSchedule}
                >
                  Cancel Preview
                </button>
              </div>
            </div>
          ) : null}

          {uploadConflict ? (
            <div style={{ ...ui.sectionCard, marginTop: 16, borderColor: "#f59e0b", background: "#fffbeb" }}>
              <div style={{ fontWeight: 800, color: "#92400e" }}>Replace-with-work warning</div>
              <div style={{ marginTop: 8, color: "#78350f" }}>
                Replacing {uploadConflict.divisionName} for {activeTerm.code} will wipe schedule bundles that already have related work attached.
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#78350f", fontSize: 14 }}>
                <div>Existing section bundles: {uploadConflict.protectedWork?.sections || 0}</div>
                <div>Faculty selections saved: {uploadConflict.protectedWork?.facultyPreferences || 0}</div>
                <div>Faculty submissions saved: {uploadConflict.protectedWork?.facultySubmissions || 0}</div>
                <div>Tentative assignments saved: {uploadConflict.protectedWork?.tentativeAssignments || 0}</div>
                <div>Chair/Dean workflow records touched: {uploadConflict.protectedWork?.disciplineWindows || 0}</div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button style={ui.btnPrimary} onClick={() => handleScheduleUpload(null, { forceReplace: true })} disabled={uploadingSchedule}>
                  Replace Division Anyway
                </button>
                <button style={ui.btn} onClick={() => clearPendingUploadState({ clearMessage: true })}>
                  Cancel Replace
                </button>
              </div>
            </div>
          ) : null}

          {uploadingSchedule ? (
            <div style={{ marginTop: 12, color: "var(--text-muted)", fontWeight: 700 }}>
              Uploading schedule to backend...
            </div>
          ) : null}

          {backendMessage ? (
            <div
              style={{
                marginTop: 12,
                color: backendMessage.includes("successfully") ? "#166534" : "#b91c1c",
                fontWeight: 700,
              }}
            >
              {backendMessage}
            </div>
          ) : null}

          {uploadReport.unmappedSubjects?.length ? (
            <div style={{ ...ui.sectionCard, marginTop: 16 }}>
              <div style={{ fontWeight: 700 }}>
                Unmapped subjects found: {Array.from(new Set(uploadReport.unmappedSubjects.map((row) => row.subject_code))).length}
              </div>
              <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                Download a ready-to-fill CSV, add discipline codes, then upload it as your next subject mapping file.
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  style={ui.btn}
                  onClick={() =>
                    downloadUnmappedSubjectsCsv(
                      uploadReport.unmappedSubjects,
                      `${activeTerm.code.toLowerCase()}-unmapped-subjects.csv`
                    )
                  }
                >
                  Download Unmapped Subjects CSV
                </button>
              </div>
            </div>
          ) : null}

          {uploadReport.fileName ? (
            <div style={{ ...ui.sectionCard, marginTop: 16 }}>
              <div style={{ fontWeight: 700 }}>Latest upload: {uploadReport.fileName}</div>

              {uploadReport.errors.length ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: "#b91c1c", fontWeight: 700 }}>
                    Upload blocked. Fix and reupload.
                  </div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {uploadReport.errors.map((err, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          borderRadius: 10,
                          padding: 10,
                          color: "#b91c1c",
                        }}
                      >
                        {err}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: "#166534", fontWeight: 700 }}>
                    Validation passed. {uploadReport.importedCount} mapped assignment groups parsed.
                    {uploadReport.summary?.ignoredRowsFromOtherDivisions
                      ? ` ${uploadReport.summary.ignoredRowsFromOtherDivisions} row(s) outside the selected division were ignored.`
                      : ""}
                  </div>
                  {uploadReport.summary ? (
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
                        marginTop: 12,
                      }}
                    >
                      <TinyStat label="Source Rows" value={uploadReport.summary.sourceTotalRows ?? uploadReport.summary.totalRows} />
                      <TinyStat label="Kept Rows" value={uploadReport.summary.keptRowsForDivision ?? uploadReport.summary.totalRows} />
                      <TinyStat label="Ignored Rows" value={uploadReport.summary.ignoredRowsFromOtherDivisions || 0} />
                      <TinyStat label="Unique CRNs" value={metricValue(uploadReport.summary.totalCrns)} />
                      <TinyStat label="Groups" value={metricValue(uploadReport.summary.assignmentGroups, uploadReport.summary.importedSectionBundles ?? uploadReport.summary.divisionRows ?? uploadReport.importedCount)} />
                      <TinyStat label="Mapped" value={metricValue(uploadReport.summary.mappedAssignmentGroups)} />
                      <TinyStat label="Unmapped" value={metricValue(uploadReport.summary.unmappedAssignmentGroups)} />
                      <TinyStat label="Cross-Listed" value={metricValue(uploadReport.summary.crossListedGroups)} />
                    </div>
                  ) : null}
                </div>
              )}

              {uploadReport.warnings?.length ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: "#92400e", fontWeight: 700 }}>Warnings</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {uploadReport.warnings.slice(0, 25).map((warn, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "#fffbeb",
                          border: "1px solid #fde68a",
                          borderRadius: 10,
                          padding: 10,
                          color: "#92400e",
                        }}
                      >
                        {warn}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        ) : null}

        {canUseAdminTools ? (
        <div style={ui.card}>
          <div style={ui.between}>
            <div>
              <h2 style={ui.cardTitle}>User Access Invitations</h2>
              <div style={ui.cardDesc}>
                Create account setup links for chairs, deans, faculty, and schedulers.
              </div>
            </div>
          </div>
          <form onSubmit={sendAccessInvite} style={{ ...ui.row, marginTop: 16, alignItems: "center" }}>
            <input
              style={{ ...ui.input, maxWidth: 240 }}
              value={inviteForm.email}
              onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="user@cos.edu"
              type="email"
              required
            />
            <input
              style={{ ...ui.input, maxWidth: 220 }}
              value={inviteForm.full_name}
              onChange={(e) => setInviteForm((prev) => ({ ...prev, full_name: e.target.value }))}
              placeholder="Full name"
            />
            <input
              style={{ ...ui.input, maxWidth: 160 }}
              value={inviteForm.employee_id}
              onChange={(e) => setInviteForm((prev) => ({ ...prev, employee_id: e.target.value }))}
              placeholder="Employee ID"
            />
            <select
              style={{ ...ui.input, maxWidth: 180 }}
              value={inviteForm.role}
              onChange={(e) => setInviteForm((prev) => ({ ...prev, role: e.target.value }))}
            >
              <option value="faculty">Part-Time Faculty</option>
              <option value="chair">Division Chair</option>
              <option value="dean">Dean</option>
              <option value="admin">Scheduler / Admin</option>
            </select>
            <select
              style={{ ...ui.input, maxWidth: 240 }}
              value={inviteForm.division}
              onChange={(e) => setInviteForm((prev) => ({ ...prev, division: e.target.value }))}
            >
              <option value="">Division optional</option>
              {uploadDivisionOptions.map((division) => (
                <option key={division} value={division}>{division}</option>
              ))}
            </select>
            <button type="submit" style={ui.btnPrimary} disabled={inviteBusy}>
              {inviteBusy ? "Sending..." : "Send Invite"}
            </button>
          </form>
          {inviteMessage ? (
            <div style={{ marginTop: 10, fontSize: 13, color: inviteMessage.startsWith("Invitation") ? "var(--text-muted)" : "#b91c1c", fontWeight: 700 }}>
              {inviteMessage}
            </div>
          ) : null}
          <div style={{ marginTop: 22, borderTop: "1px solid var(--border-soft)", paddingTop: 16 }}>
            <div style={ui.between}>
              <div>
                <h3 style={{ ...ui.cardTitle, fontSize: 16 }}>Pending Account Requests</h3>
                <div style={ui.cardDesc}>Approve verified users into the invite flow, or reject unknown requests.</div>
              </div>
              <button type="button" style={ui.btn} onClick={refreshAccountRequests} disabled={accountRequestsBusy}>
                Refresh
              </button>
            </div>
            {accountRequestsMessage ? (
              <div style={{ marginTop: 10, fontSize: 13, color: accountRequestsMessage.includes("Could not") ? "#b91c1c" : "var(--text-muted)", fontWeight: 700 }}>
                {accountRequestsMessage}
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              {accountRequests.length ? accountRequests.map((request) => (
                <div key={request.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 12, padding: 12, background: "var(--bg-soft)" }}>
                  <div style={ui.between}>
                    <div>
                      <div style={{ fontWeight: 900 }}>{request.full_name || request.email}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                        {request.email} {request.employee_id ? `| ID ${request.employee_id}` : ""} | {request.requested_role} {request.division ? `| ${request.division}` : ""}
                      </div>
                      {request.note ? <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>{request.note}</div> : null}
                    </div>
                    <div style={ui.row}>
                      <button type="button" style={ui.btnPrimary} onClick={() => reviewAccountRequest(request.id, "approve")} disabled={accountRequestsBusy}>
                        Approve
                      </button>
                      <button type="button" style={ui.btn} onClick={() => reviewAccountRequest(request.id, "reject")} disabled={accountRequestsBusy}>
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              )) : (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {accountRequestsBusy ? "Loading requests..." : "No pending account requests."}
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: 22, borderTop: "1px solid var(--border-soft)", paddingTop: 16 }}>
            <div style={ui.between}>
              <div>
                <h3 style={{ ...ui.cardTitle, fontSize: 16 }}>User Management</h3>
                <div style={ui.cardDesc}>Disable users, adjust roles/divisions, resend setup links, or trigger password resets.</div>
              </div>
              <button type="button" style={ui.btn} onClick={refreshManagedUsers} disabled={managedUsersBusy}>
                Refresh
              </button>
            </div>
            {managedUsersMessage ? (
              <div style={{ marginTop: 10, fontSize: 13, color: managedUsersMessage.includes("Could not") ? "#b91c1c" : "var(--text-muted)", fontWeight: 700 }}>
                {managedUsersMessage}
              </div>
            ) : null}
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="cos-table" style={ui.table}>
                <thead>
                  <tr>
                    <th style={ui.th}>User</th>
                    <th style={ui.th}>Role</th>
                    <th style={ui.th}>Division</th>
                    <th style={ui.th}>Status</th>
                    <th style={ui.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {managedUsers.length ? managedUsers.map((user) => (
                    <tr key={user.id}>
                      <td style={ui.td}>
                        <div style={{ fontWeight: 800 }}>{user.full_name || user.email}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{user.email}{user.employee_id ? ` | ${user.employee_id}` : ""}</div>
                      </td>
                      <td style={ui.td}>
                        <select style={ui.input} value={user.role || "faculty"} onChange={(e) => saveManagedUser(user, { role: e.target.value })} disabled={managedUsersBusy}>
                          <option value="faculty">Faculty</option>
                          <option value="chair">Chair</option>
                          <option value="dean">Dean</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td style={ui.td}>
                        <select style={ui.input} value={user.division || ""} onChange={(e) => saveManagedUser(user, { division: e.target.value })} disabled={managedUsersBusy}>
                          <option value="">All / none</option>
                          {uploadDivisionOptions.map((division) => (
                            <option key={division} value={division}>{division}</option>
                          ))}
                        </select>
                      </td>
                      <td style={ui.td}>
                        <select style={ui.input} value={user.active_status || "invited"} onChange={(e) => saveManagedUser(user, { active_status: e.target.value })} disabled={managedUsersBusy}>
                          <option value="invited">Invited</option>
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </td>
                      <td style={ui.td}>
                        <div style={ui.row}>
                          <button type="button" style={ui.btn} onClick={() => runUserAction(user, "invite")} disabled={managedUsersBusy || user.active_status === "disabled"}>
                            Resend Invite
                          </button>
                          <button type="button" style={ui.btn} onClick={() => runUserAction(user, "reset")} disabled={managedUsersBusy || user.active_status !== "active"}>
                            Password Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td style={ui.td} colSpan={5}>{managedUsersBusy ? "Loading users..." : "No users found."}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        ) : null}

        {canUseAdminTools ? (
          <AdminOperationsPanel
            ui={ui}
            activeTerm={activeTerm}
            chairAssignments={chairAssignments}
            setChairAssignments={setChairAssignments}
            deanAssignments={deanAssignments}
            setDeanAssignments={setDeanAssignments}
            ptStaffingRows={ptStaffingRows}
            setPtStaffingRows={setPtStaffingRows}
            divisionOptions={uploadDivisionOptions}
            senderEmail={divisionSenderEmail}
            setSenderEmail={setDivisionSenderEmail}
          />
        ) : null}


        {(role === "chair" || role === "dean" || role === "admin") ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Division Chair View</h2>
                <div style={ui.cardDesc}>
                  Scoped to the real division structure you provided. Chair names can be swapped in once you are ready.
                </div>
              </div>
              <select
                style={ui.alphaSelect}
                value={selectedChairName}
                onChange={(e) => {
                  setSelectedChairName(e.target.value);
                  setSelectedDisciplineCode("ALL");
                }}
              >
                {chairAssignments.map((item) => (
                  <option key={item.chairName} value={item.chairName}>
                    {item.chairName}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              {chairDivisions.map((division) => (
                <span key={division} style={ui.chip}>{division}</span>
              ))}
            </div>
          </div>
        ) : null}

        {(role === "dean" || role === "admin") ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Dean View</h2>
                <div style={ui.cardDesc}>
                  Scoped to the real dean coverage structure you provided. Dean names can be swapped in later.
                </div>
              </div>
              <select
                style={ui.alphaSelect}
                value={selectedDeanName}
                onChange={(e) => {
                  setSelectedDeanName(e.target.value);
                  setSelectedDisciplineCode("ALL");
                }}
              >
                {deanAssignments.map((item) => (
                  <option key={item.deanName} value={item.deanName}>
                    {item.deanName}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              {deanDivisions.map((division) => (
                <span key={division} style={ui.chip}>{division}</span>
              ))}
            </div>
          </div>
        ) : null}

        {(role === "faculty" || role === "chair" || role === "dean" || role === "admin") ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Part-Time Faculty View</h2>
                <div style={ui.cardDesc}>
                  This view is driven by the uploaded PT roster. Filter by discipline to narrow the preview faculty list to instructors approved for that discipline.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  style={ui.alphaSelect}
                  value={ptFacultyDisciplineFilter}
                  onChange={(e) => {
                      setPtFacultyDisciplineFilter(e.target.value);
                      setSelectedFacultyId("");
                      setFacultyPreferences([]);
                      setFacultyAvailability({ days: [], timeBlocks: [] });
                    }}
                >
                  <option value="ALL">All PT disciplines</option>
                  {Array.from(new Set((ptStaffingRows || []).map((row) => normalize(row.discipline || row.qualified_disciplines || "")).filter(Boolean))).sort().map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <select
                  style={ui.alphaSelect}
                  value={selectedFacultyId}
                  onChange={(e) => {
                      setSelectedFacultyId(e.target.value);
                      setSelectedDisciplineCode("ALL");
                      setFacultyPreferences([]);
                      setFacultyAvailability({ days: [], timeBlocks: [] });
                      setTimeout(() => loadFacultyPreferences(e.target.value), 0);
                    }}
                >
                  {previewFacultyOptions.map((item) => (
                    <option key={item.employeeId} value={item.employeeId}>
                      {facultyName(item)}
                    </option>
                  ))}
                </select>
                <button style={ui.btn} onClick={() => loadFacultyPreferences(selectedFacultyId || selectedFaculty?.employeeId)}>
                  Load Saved Preferences
                </button>
              </div>
              {preferencesMessage ? (
                <div style={{ marginTop: 8, color: /saved|loaded|loading/i.test(preferencesMessage) ? "#166534" : "#b91c1c", fontWeight: 700, fontSize: 13 }}>
                  {preferencesMessage}
                </div>
              ) : null}
            </div>
            <div style={{ marginTop: 12 }}>
              {facultySeniorityRows.length ? (
                facultySeniorityRows.map((row) => (
                  <span key={`${row.disciplineCode}-${row.rank}`} style={ui.chip}>
                    {row.disciplineCode} - Rank {row.rank}
                  </span>
                ))
              ) : (
                <div style={{ color: "var(--text-muted)" }}>No sample seniority rows are assigned to this faculty profile yet.</div>
              )}
            </div>
          </div>
        ) : null}

        {(role === "admin" || role === "chair" || role === "dean") ? (
          <div style={ui.card}>
            <div style={{ ...ui.between, marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)" }}>Command Center</div>
                <div style={{ marginTop: 6, color: "var(--text-muted)" }}>Sharper lanes for controls, workflow, and reference data, so the page reads like a cockpit instead of a cargo hold.</div>
              </div>
            </div>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              <div style={ui.commandLane}>
                <div style={ui.miniKicker}>Controls</div>
                <h2 style={{ ...ui.cardTitle, marginTop: 8 }}>Workflow Controls</h2>
                <div style={ui.cardDesc}>Refresh the queue, export data, and advance staffing decisions through review.</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <button style={ui.btnPrimary} onClick={loadChairWorkflow}>
                    {loadingChairWorkflow ? "Refreshing..." : "Refresh Workflow"}
                  </button>
                  {role === "chair" ? (
                    <button style={ui.btnPrimary} onClick={submitAssignmentsToDean} disabled={!assignmentStatusCounts.tentative}>
                      Submit to Dean ({assignmentStatusCounts.tentative || 0})
                    </button>
                  ) : null}
                  {role === "dean" ? (
                    <button style={ui.btnPrimary} onClick={approveSubmittedAssignments} disabled={!assignmentStatusCounts.chair_submitted}>
                      Approve Submitted ({assignmentStatusCounts.chair_submitted || 0})
                    </button>
                  ) : null}
                  <button style={ui.btn} onClick={exportPreferences}>
                    Export Preferences
                  </button>
                  {canUseAdminTools ? (
                    <button style={ui.btn} onClick={wipePreferencesForDivision}>
                      Wipe Division Preferences
                    </button>
                  ) : null}
                  <button
                    style={ui.btn}
                    onClick={() => downloadCsvFromRows(
                      divisionReportRows,
                      `scope-division-summary-${activeTerm.code}.csv`,
                      ["division_name", "status", "note", "open_sections", "faculty_preferences", "tentative_assignments", "decision_log_entries"]
                    )}
                    disabled={!divisionReportRows.length}
                  >
                    Export Division Summary
                  </button>
                </div>
              </div>

              <div style={ui.commandLane}>
                <div style={ui.miniKicker}>Workflow</div>
                <h2 style={{ ...ui.cardTitle, marginTop: 8 }}>Assignment State</h2>
                <div style={ui.cardDesc}>Current scope counts for chair submission and dean approval.</div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 12 }}>
                  <div style={ui.metricTile}>
                    <div style={ui.miniKicker}>Tentative</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{assignmentStatusCounts.tentative || 0}</div>
                    <div style={ui.small}>Chair selections not yet submitted.</div>
                  </div>
                  <div style={ui.metricTile}>
                    <div style={ui.miniKicker}>Submitted</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{assignmentStatusCounts.chair_submitted || 0}</div>
                    <div style={ui.small}>Waiting for dean review.</div>
                  </div>
                  <div style={ui.metricTile}>
                    <div style={ui.miniKicker}>Approved</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{assignmentStatusCounts.dean_approved || 0}</div>
                    <div style={ui.small}>Approved by dean.</div>
                  </div>
                  <div style={ui.metricTile}>
                    <div style={ui.miniKicker}>Ready Queue</div>
                    <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{workflowMetrics.ready}</div>
                    <div style={ui.small}>Unassigned sections with a conflict-free candidate.</div>
                  </div>
                </div>
              </div>

              <div style={ui.commandLane}>
                <div style={ui.miniKicker}>Reference Data</div>
                <h2 style={{ ...ui.cardTitle, marginTop: 8 }}>Current Scope</h2>
                <div style={ui.cardDesc}>Filters are display-only, not restrictive. Chairs keep full assignment authority, and modality never hard-locks eligibility.</div>
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  <div style={ui.metricTile}>
                    <div style={ui.small}>Active term</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{activeTerm.name} ({activeTerm.code})</div>
                  </div>
                  <div style={ui.metricTile}>
                    <div style={ui.small}>Current role scope</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {role === "admin" ? "College-wide administrative view" : role === "chair" ? selectedChairName : role === "dean" ? selectedDeanName : facultyName(selectedFaculty || {})}
                    </div>
                  </div>
                  <div style={ui.metricTile}>
                    <div style={ui.small}>Display filters active</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{activeSectionFilterCount}</div>
                  </div>
                </div>
                <div style={{ ...ui.sectionCard, marginTop: 14, background: "var(--bg-soft)" }}>
                  <div style={{ fontWeight: 800 }}>Legend</div>
                  <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                    Quick decoding for instructional codes and division activity states.
                  </div>
                  <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                    {codeLegend.map((item) => (
                      <div key={item.label} style={{ display: "grid", gridTemplateColumns: "110px minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
                        <span style={ui.chip}>{item.label}</span>
                        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{item.meaning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {chairMessage ? (
              <div style={{ marginTop: 12, color: chairMessage.toLowerCase().includes("could not") || chairMessage.toLowerCase().includes("conflict") || chairMessage.toLowerCase().includes("required") || chairMessage.toLowerCase().includes("already") ? "#b91c1c" : "#166534", fontWeight: 700 }}>
                {chairMessage}
              </div>
            ) : null}

            {role !== "admin" ? (
            <>
            <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
              {filteredSectionQueue.length} visible queued section(s), {assignmentStatusCounts.tentative || 0} tentative, {assignmentStatusCounts.chair_submitted || 0} submitted, {assignmentStatusCounts.dean_approved || 0} approved, {filteredDecisionLogs.length} visible audit entr{filteredDecisionLogs.length === 1 ? "y" : "ies"}.
            </div>

            <div style={{ ...ui.sectionCard, marginTop: 12, background: "var(--bg-soft)" }}>
              <div style={{ ...ui.between, alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>Section Assignment Queue</div>
                  <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                    Sort and review the {selectedDisciplineCode === "ALL" ? "currently scoped" : selectedDisciplineCode} section cards below before assigning PT faculty. Preference order follows {selectedFaculty ? facultyName(selectedFaculty) : "the selected faculty member"} first when that person has saved choices.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <button
                      type="button"
                      style={{ ...ui.filterChip, ...(showOnlyPreferenceQueue ? {} : ui.filterChipActive) }}
                      onClick={() => setShowOnlyPreferenceQueue(false)}
                    >
                      All queued sections ({sectionQueue.length})
                    </button>
                    <button
                      type="button"
                      style={{ ...ui.filterChip, ...(showOnlyPreferenceQueue ? ui.filterChipActive : {}) }}
                      onClick={() => {
                        setShowOnlyPreferenceQueue(true);
                        setWorkflowSort("preference");
                      }}
                    >
                      Preference sections only ({preferenceQueueCount})
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {[
                      ["all", `All (${workflowMetrics.total})`],
                      ["ready", `Ready (${workflowMetrics.ready})`],
                      ["assigned", `Assigned (${workflowMetrics.assigned})`],
                      ["blocked", `Blocked (${workflowMetrics.blocked})`],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        style={{ ...ui.filterChip, ...(workflowView === value ? ui.filterChipActive : {}) }}
                        onClick={() => setWorkflowView(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                  <label style={ui.small}>Sort sections by</label>
                  <select
                    style={ui.select}
                    value={workflowSort}
                    onChange={(e) => setWorkflowSort(e.target.value)}
                  >
                    <option value="preference">Saved preference order</option>
                    <option value="course">Course / CRN</option>
                    <option value="time">Meeting time</option>
                    <option value="campus">Campus</option>
                    <option value="method">Method</option>
                    <option value="modality">Modality</option>
                    <option value="seniority">Top candidate seniority</option>
                  </select>
                  <div style={ui.small}>
                    {chairPreferenceRows.length} saved preference row(s) loaded for sorting.
                  </div>
                </div>
              </div>
            </div>

            <div className="cos-panel-grid" style={{ ...ui.panelGrid, marginTop: 16 }}>
              <div style={{ display: "grid", gap: 12 }}>
                {filteredSectionQueue.length ? filteredSectionQueue.map((section) => {
                  const topCandidate = section.eligibleCandidates[0] || null;
                  const stateSummary = sectionStateSummary(section, topCandidate);
                  return (
                    <div key={section.assignment_group_id} style={{ ...ui.sectionCard, borderColor: section.currentAssignment ? "#bbf7d0" : "var(--border-color)", background: section.currentAssignment ? "rgba(220, 252, 231, 0.28)" : "var(--bg-card)" }}>
                      <div style={{ ...ui.between, alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 800 }}>{section.primary_subject_course} - {section.primary_crn}</div>
                          <div style={{ marginTop: 4 }}>{section.title || "Untitled"}</div>
                          <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                            {formatMeetings(section.meetings)}{hasLinkedSections(section) ? ` - ${linkedSectionCount(section)} linked parts move together` : ""}
                            {section.campus ? ` - ${section.campus}` : ""}
                            {section.discipline_code ? ` - ${section.discipline_code}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <span style={methodPillStyle(sectionMethodLabel(section))}>{sectionMethodLabel(section)}</span>
                          <span style={modalityPillStyle(sectionModalityLabel(section))}>{sectionModalityLabel(section)}</span>
                          {section.currentAssignment ? (
                            <span style={workflowStatePillStyle(assignmentStatusKind(section.currentAssignment.decision_status || section.currentAssignment.status))}>{assignmentStatusLabel(section.currentAssignment.decision_status || section.currentAssignment.status)}</span>
                          ) : topCandidate ? (
                            <span style={workflowStatePillStyle("top")}>Next in line ready</span>
                          ) : (
                            <span style={workflowStatePillStyle("conflict")}>No eligible candidate</span>
                          )}
                          {section.bestPreferenceRank ? (
                            <span style={workflowStatePillStyle("advanced")}>Preference #{section.bestPreferenceRank}</span>
                          ) : null}
                          {section.selectedFacultyPreferenceRank ? (
                            <span style={workflowStatePillStyle("top")}>{selectedFaculty ? facultyName(selectedFaculty) : "Selected faculty"} #{section.selectedFacultyPreferenceRank}</span>
                          ) : null}
                        </div>
                      </div>

                      <div style={{ marginTop: 12, border: "1px solid var(--border-soft)", borderRadius: 14, padding: 12, background: "var(--bg-soft)" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={workflowStatePillStyle(stateSummary.kind)}>{stateSummary.title}</span>
                        </div>
                        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>{stateSummary.detail}</div>
                        {section.currentAssignment ? (
                          <div style={{ marginTop: 8, color: "#166534", fontWeight: 700, fontSize: 13 }}>
                            {assignmentStatusLabel(section.currentAssignment.decision_status || section.currentAssignment.status)} assignment: {section.currentAssignment.faculty_name || section.currentAssignment.employee_id}.
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                        {section.candidates.slice(0, 5).map((row) => {
                          const isTop = topCandidate?.employee_id === row.employee_id;
                          const allocationSection = allocationSectionById.get(section.assignment_group_id);
                          const backendRecommendedEmployeeId =
                            allocationSection?.highestSeniorityCurrentlyEligibleCandidate?.employeeId ||
                            allocationAnalysis?.recommendedNextAssignmentSequence?.find((item) => item.assignmentGroupId === section.assignment_group_id)?.employeeId ||
                            "";
                          const isBackendRecommended = backendRecommendedEmployeeId === row.employee_id;
                          const isHighestRemainingPreference = highestRemainingPreferenceByFaculty.get(row.employee_id) === section.assignment_group_id;
                          const sectionHasSavedPreference = finiteNumberOrNull(section.bestPreferenceRank) !== null;
                          const requiresPreferenceRationale = sectionHasSavedPreference && !isBackendRecommended;
                          const currentAssignment = currentAssignmentByGroup.get(section.assignment_group_id) || section.currentAssignment || null;
                          const isCurrentAssignee = currentAssignment?.employee_id === row.employee_id;
                          const reasonSummary = candidateReasonSummary(section, row, topCandidate, currentAssignment);
                          return (
                            <div key={`${section.assignment_group_id}-${row.employee_id}`} style={{ border: "1px solid var(--border-soft)", borderRadius: 14, padding: 10, background: row.has_tentative_assignment || isCurrentAssignee ? "rgba(220, 252, 231, 0.22)" : row.has_assignment_conflict ? "rgba(254, 226, 226, 0.22)" : "var(--bg-soft)" }}>
                              <div style={{ ...ui.between, alignItems: "flex-start" }}>
                                <div>
                                  <div style={{ fontWeight: 700 }}>{row.faculty_name}</div>
                                  <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
                                    Seniority #{row.seniority_rank || "—"} - Preference #{row.preference_rank || "—"}
                                  </div>
                                  <div style={{ marginTop: 6 }}>
                                    <span style={workflowStatePillStyle(row.availabilitySummary?.matches ? "assigned" : "bypass")}>
                                      {row.availabilitySummary?.label || "No availability selected"}
                                    </span>
                                    {isHighestRemainingPreference ? (
                                      <span style={{ ...workflowStatePillStyle("top"), marginLeft: 6 }}>
                                        Highest remaining preference
                                      </span>
                                    ) : null}
                                  </div>
                                  {isCurrentAssignee ? (
                                    <div style={{ marginTop: 6, color: "#166534", fontSize: 12, fontWeight: 700 }}>
                                      Current tentative assignee.
                                    </div>
                                  ) : null}
                                  {row.has_assignment_conflict ? (
                                    <div style={{ marginTop: 6, color: "#b91c1c", fontSize: 12, fontWeight: 700 }}>
                                      Time conflict with {row.conflicting_assignment?.primary_subject_course || row.conflicting_assignment?.assignment_group_id}.
                                    </div>
                                  ) : null}
                                  {!row.has_assignment_conflict && row.assigned_elsewhere ? (
                                    <div style={{ marginTop: 6, color: "#92400e", fontSize: 12, fontWeight: 700 }}>
                                      Has other tentative assignment(s), but no time collision.
                                    </div>
                                  ) : null}
                                  <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 12 }}>
                                    <span style={workflowStatePillStyle(reasonSummary.kind)}>{reasonSummary.title}</span>
                                    <div style={{ marginTop: 6 }}>{reasonSummary.detail}</div>
                                  </div>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                    {isCurrentAssignee || row.has_tentative_assignment ? <span style={workflowStatePillStyle("assigned")}>{isCurrentAssignee ? "Current assignee" : "Assigned"}</span> : null}
                                    {!isCurrentAssignee && !row.has_tentative_assignment && row.section_assigned_to_other ? <span style={workflowStatePillStyle("filled")}>Section filled</span> : null}
                                    {!isCurrentAssignee && !row.has_tentative_assignment && row.has_assignment_conflict ? <span style={workflowStatePillStyle("conflict")}>Time conflict</span> : null}
                                    {!section.currentAssignment && !row.has_tentative_assignment && !row.section_assigned_to_other && !row.has_assignment_conflict && isBackendRecommended ? <span style={workflowStatePillStyle("top")}>Backend recommendation</span> : null}
                                    {!section.currentAssignment && !row.has_tentative_assignment && !row.section_assigned_to_other && !row.has_assignment_conflict && requiresPreferenceRationale ? <span style={workflowStatePillStyle("bypass")}>Bypass needs rationale</span> : null}
                                    {section.currentAssignment && !isCurrentAssignee && !row.has_assignment_conflict ? <span style={workflowStatePillStyle("bypass")}>Reassign requires rationale</span> : null}
                                  </div>
                                  {isCurrentAssignee || row.has_tentative_assignment ? (
                                    <button style={ui.btn} disabled>{isCurrentAssignee ? "Current" : "Assigned"}</button>
                                  ) : row.has_assignment_conflict ? (
                                    <button style={ui.btn} disabled>Time Conflict</button>
                                  ) : section.currentAssignment ? (
                                    <button style={ui.btn} onClick={() => reassignTentativeAssignment(currentAssignment, row)}>
                                      Reassign
                                    </button>
                                  ) : row.section_assigned_to_other ? (
                                    <button style={ui.btn} disabled>Filled</button>
                                  ) : (
                                    <button style={isBackendRecommended || !requiresPreferenceRationale ? ui.btnPrimary : ui.btn} onClick={() => assignSectionToInstructor(row, backendRecommendedEmployeeId, requiresPreferenceRationale)}>
                                      {requiresPreferenceRationale ? "Assign with Rationale" : "Assign"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ ...ui.sectionCard, color: "var(--text-muted)" }}>
                    No instructor preference queue is available yet. Save faculty preferences first, then refresh this workflow.
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                {(role === "chair" || role === "dean" || tentativeAssignments.length > 0) ? (
                <div style={ui.sectionCard}>
                  <div style={{ fontWeight: 800 }}>Staffing Decisions</div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                    Live persistence snapshot for tentative, submitted, and approved assignments.
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {tentativeAssignments.length ? tentativeAssignments.map((assignment) => (
                      <div key={assignment.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 14, padding: 10, background: "var(--bg-soft)" }}>
                        <div style={{ ...ui.between, alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{assignment.primary_subject_course} - {assignment.primary_crn}</div>
                            {hasLinkedSections(assignment) ? <div style={{ marginTop: 6 }}><span style={workflowStatePillStyle("advanced")}>Linked Sections</span></div> : null}
                            <div style={{ marginTop: 4 }}>{assignment.faculty_name || assignment.employee_id}</div>
                            <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                              {formatMeetings(assignment.meetings)}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                              <span style={workflowStatePillStyle(assignmentStatusKind(assignment.decision_status || assignment.status))}>{assignmentStatusLabel(assignment.decision_status || assignment.status)}</span>
                              <span style={methodPillStyle(sectionMethodLabel(assignment))}>{sectionMethodLabel(assignment)}</span>
                              <span style={modalityPillStyle(sectionModalityLabel(assignment))}>{sectionModalityLabel(assignment)}</span>
                            </div>
                          </div>
                          <button style={ui.btn} onClick={() => undoTentativeAssignment(assignment)}>Unassign</button>
                        </div>
                      </div>
                    )) : (
                      <div style={{ color: "var(--text-subtle)" }}>No tentative assignments saved yet.</div>
                    )}
                  </div>
                </div>
                ) : null}

                <div style={ui.sectionCard}>
                  <div style={{ ...ui.between, gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>Audit & Decision Log</div>
                      <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                        Uploads, submissions, assignments, reassignments, and approvals all leave a timestamped trail.
                      </div>
                    </div>
                    <button
                      style={ui.btn}
                      onClick={() => downloadCsvFromRows(
                        filteredDecisionLogs.map((entry) => ({
                          created_at: entry.created_at,
                          actor_name: entry.actor_name,
                          event_type: entry.event_type,
                          discipline_code: entry.discipline_code,
                          detail: entry.detail,
                        })),
                        `scope-audit-log-${activeTerm.code}.csv`,
                        ["created_at", "actor_name", "event_type", "discipline_code", "detail"]
                      )}
                      disabled={!filteredDecisionLogs.length}
                    >
                      Export Audit Log
                    </button>
                  </div>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1.4fr 1fr auto", marginTop: 12, alignItems: "center" }}>
                    <input
                      style={ui.input}
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search actor, event, discipline, or detail"
                    />
                    <select style={ui.select} value={auditTypeFilter} onChange={(e) => setAuditTypeFilter(e.target.value)}>
                      <option value="ALL">All event types</option>
                      {auditEventOptions.map((eventType) => (
                        <option key={eventType} value={eventType}>{eventType.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <button style={ui.btn} onClick={() => { setAuditSearch(""); setAuditTypeFilter("ALL"); }}>
                      Clear
                    </button>
                  </div>
                  <div style={{ marginTop: 10, color: "var(--text-subtle)", fontSize: 12 }}>
                    Showing {filteredDecisionLogs.length} of {decisionLogs.length} audit entr{decisionLogs.length === 1 ? "y" : "ies"}.
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 12, maxHeight: 540, overflowY: "auto", paddingRight: 4 }}>
                    {filteredDecisionLogs.length ? filteredDecisionLogs.map((entry) => (
                      <div key={entry.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 14, padding: 10, background: "var(--bg-soft)" }}>
                        <div style={{ ...ui.between, alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700 }}>{entry.actor_name}</div>
                          <span style={workflowStatePillStyle(logEventKind(entry))}>{entry.event_type.replace(/_/g, " ")}</span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13 }}>{entry.detail}</div>
                        <div style={{ marginTop: 6, color: "var(--text-subtle)", fontSize: 12 }}>
                          {entry.discipline_code || "All disciplines"} - {new Date(entry.created_at).toLocaleString()}
                        </div>
                      </div>
                    )) : (
                      <div style={{ color: "var(--text-subtle)" }}>No audit entries match the current filters.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            </>
            ) : null}
          </div>
        ) : null}

        <div style={ui.card}>
          <div style={ui.between}>
            <div>
              <h2 style={ui.cardTitle}>Available Sections</h2>
              <div style={ui.cardDesc}>
                {role === "admin"
                  ? "View PT-eligible open sections by discipline for the active term."
                  : role === "chair"
                  ? "View only the open sections assigned to the selected chair disciplines."
                  : role === "dean"
                  ? "View only the open sections that fall inside the selected dean divisions."
                  : "View only the open sections available to the selected faculty member's seniority disciplines."}
              </div>
            </div>
            <div style={ui.row}>
              <select
                style={ui.alphaSelect}
                value={selectedDisciplineCode}
                onChange={(e) => {
                  const nextCode = e.target.value;
                  setSelectedDisciplineCode(nextCode);
                  loadAvailableSections(nextCode);
                }}
              >
                <option value="ALL">All disciplines</option>
                {roleAvailableDisciplineCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <button style={ui.btnPrimary} onClick={() => loadAvailableSections(selectedDisciplineCode)}>
                Refresh Sections
              </button>
              {(role === "admin" || role === "chair" || role === "dean") ? (
                <button style={ui.btn} onClick={exportPreferences}>
                  Export Preferences
                </button>
              ) : null}
            </div>
          </div>

          <div style={{ ...ui.sectionCard, marginTop: 14 }}>
            <div style={{ ...ui.between, alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 800 }}>Display Filters</div>
                <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
                  Filters stay in place while you work on this page, and reset naturally after a refresh or when you come back later.
                </div>
              </div>
              <button style={ui.btn} onClick={clearSectionFilters}>Clear Filters</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ ...ui.small, display: "block", marginBottom: 8 }}>Search sections</label>
              <input
                style={ui.input}
                value={sectionFilters.search}
                onChange={(event) => setSectionFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Search course, CRN, title, campus, discipline, modality, or meeting time"
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                Days
              </div>
              <div style={{ ...ui.row, gap: 8 }}>
                {availabilityDayOptions.map((day) => {
                  const active = sectionFilters.days.includes(day.key);
                  return (
                    <button
                      key={day.key}
                      type="button"
                      style={{ ...ui.filterChip, ...(active ? ui.filterChipActive : {}) }}
                      onClick={() => toggleSectionFilter("days", day.key)}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                Time
              </div>
              <div style={{ ...ui.row, gap: 8 }}>
                {availabilityTimeOptions.map((block) => {
                  const active = sectionFilters.timeBlocks.includes(block.key);
                  return (
                    <button
                      key={block.key}
                      type="button"
                      style={{ ...ui.filterChip, ...(active ? ui.filterChipActive : {}) }}
                      onClick={() => toggleSectionFilter("timeBlocks", block.key)}
                    >
                      {block.label} ({block.detail})
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                Campus
              </div>
              <div style={{ ...ui.row, gap: 8 }}>
                {campusFilterOptions.length ? campusFilterOptions.map((campus) => {
                  const active = sectionFilters.campuses.includes(campus);
                  return (
                    <button
                      key={campus}
                      type="button"
                      style={{ ...ui.filterChip, ...(active ? ui.filterChipActive : {}) }}
                      onClick={() => toggleSectionFilter("campuses", campus)}
                    >
                      {campus}
                    </button>
                  );
                }) : <span style={{ color: "var(--text-subtle)" }}>No campus values loaded yet.</span>}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                Method
              </div>
              <div style={{ ...ui.row, gap: 8 }}>
                {methodFilterOptions.length ? methodFilterOptions.map((method) => {
                  const active = sectionFilters.methods.includes(method);
                  return (
                    <button
                      key={method}
                      type="button"
                      style={{ ...ui.filterChip, ...(active ? ui.filterChipActive : {}) }}
                      onClick={() => toggleSectionFilter("methods", method)}
                    >
                      {method}
                    </button>
                  );
                }) : <span style={{ color: "var(--text-subtle)" }}>No method values loaded yet.</span>}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                Modality
              </div>
              <div style={{ ...ui.row, gap: 8 }}>
                {modalityFilterOptions.length ? modalityFilterOptions.map((modality) => {
                  const active = sectionFilters.modalities.includes(modality);
                  return (
                    <button
                      key={modality}
                      type="button"
                      style={{ ...ui.filterChip, ...(active ? ui.filterChipActive : {}) }}
                      onClick={() => toggleSectionFilter("modalities", modality)}
                    >
                      {modality}
                    </button>
                  );
                }) : <span style={{ color: "var(--text-subtle)" }}>No modality values loaded yet.</span>}
              </div>
            </div>
          </div>

          {loadingSections ? (
            <div style={{ marginTop: 12, color: "var(--text-muted)", fontWeight: 700 }}>
              Loading available sections...
            </div>
          ) : null}

          {sectionsError ? (
            <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
              {sectionsError}
            </div>
          ) : null}

          <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
            Showing {visibleSections.length} section(s)
            {selectedDisciplineCode !== "ALL" ? ` for ${selectedDisciplineCode}` : ""}
            {activeSectionFilterCount ? ` with ${activeSectionFilterCount} active display filter(s).` : "."}
          </div>
          {role !== "admin" ? (
            <div style={{ marginTop: 8, color: "var(--text-subtle)", fontSize: 13 }}>
              {role === "chair"
                ? `Scoped to ${selectedChairName}`
                : role === "dean"
                ? `Scoped to ${selectedDeanName}`
                : `Scoped to ${selectedFaculty ? facultyName(selectedFaculty) : "selected faculty"}`}
            </div>
          ) : null}

          {role === "faculty" ? (
            <div className="cos-panel-grid" style={ui.panelGrid}>
              <div>
                <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
                  Build your ranked section list. Use Add to Preferences, then drag or move items in My Preferences.
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, color: "#334155" }}>
                  <input
                    type="checkbox"
                    checked={showOnlyConflictFree}
                    onChange={(e) => setShowOnlyConflictFree(e.target.checked)}
                  />
                  Show only sections with no direct meeting-pattern conflict against my current preferences
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 10, color: "#334155" }}>
                  <input
                    type="checkbox"
                    checked={showOnlyPreferredSections}
                    onChange={(e) => setShowOnlyPreferredSections(e.target.checked)}
                  />
                  Show only sections listed in my preferences
                </label>
                <div style={{ ...ui.sectionCard, marginTop: 12 }}>
                  <div style={{ fontWeight: 800 }}>Availability</div>
                  <div style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 13 }}>
                    Save day and time interests along with section preferences.
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                      Days
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {availabilityDayOptions.map((day) => (
                        <label key={day.key} style={{ ...ui.filterChip, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", ...(facultyAvailability.days.includes(day.key) ? ui.filterChipActive : {}) }}>
                          <input
                            type="checkbox"
                            checked={facultyAvailability.days.includes(day.key)}
                            onChange={() => toggleAvailabilityValue("days", day.key)}
                          />
                          {day.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-subtle)", marginBottom: 8 }}>
                      Times
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {availabilityTimeOptions.map((block) => (
                        <label key={block.key} style={{ ...ui.filterChip, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", ...(facultyAvailability.timeBlocks.includes(block.key) ? ui.filterChipActive : {}) }}>
                          <input
                            type="checkbox"
                            checked={facultyAvailability.timeBlocks.includes(block.key)}
                            onChange={() => toggleAvailabilityValue("timeBlocks", block.key)}
                          />
                          {block.label} {block.detail}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ ...ui.sectionCard, marginTop: 12 }}>
                <div style={{ fontWeight: 700 }}>My Preferences</div>
                <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                  {facultyPreferences.length} section(s) selected
                  {conflictIds.size ? `, ${conflictIds.size} with direct pattern conflicts` : ", no direct pattern conflicts detected"}.
                </div>
                <div style={{ marginTop: 12 }}>
                  {facultyPreferences.length ? (
                    facultyPreferences.map((item, index) => (
                      <div
                        key={item.assignment_group_id}
                        draggable
                        onDragStart={() => setDragIndex(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (dragIndex === null || dragIndex === index) return;
                          movePreference(dragIndex, index);
                          setDragIndex(null);
                        }}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: 12,
                          padding: 10,
                          marginBottom: 10,
                          background: conflictIds.has(item.assignment_group_id) ? "#fff7ed" : "var(--bg-card)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 700 }}>
                            #{index + 1} {item.primary_subject_course} - {item.primary_crn}
                          </div>
                          <button style={ui.btn} onClick={() => removePreference(item.assignment_group_id)}>Remove</button>
                        </div>
                        <div style={{ marginTop: 6 }}>{item.title || ""}</div>
                        <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                          {formatMeetings(item.meetings)} - {item.campus || ""} - {sectionMethodLabel(item)} - {sectionModalityLabel(item)}
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          <button disabled={index === 0} style={ui.btn} onClick={() => movePreference(index, index - 1)}>Move Up</button>
                          <button disabled={index === facultyPreferences.length - 1} style={ui.btn} onClick={() => movePreference(index, index + 1)}>Move Down</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "var(--text-subtle)" }}>No selections yet.</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button style={ui.btn} onClick={() => savePreferences("draft")} disabled={savingPreferences}>
                    {savingPreferences ? "Saving..." : "Save Draft"}
                  </button>
                  <button style={ui.btnPrimary} onClick={() => savePreferences("submit")} disabled={savingPreferences}>
                    {savingPreferences ? "Submitting..." : "Submit Preferences"}
                  </button>
                  <button style={ui.btn} onClick={() => {
                    setFacultyPreferences([]);
                    setFacultyAvailability({ days: [], timeBlocks: [] });
                    setPreferencesMessage("");
                  }}>
                    Clear List
                  </button>
                  <button
                    style={ui.btn}
                    onClick={() =>
                      downloadCsvFromRows(
                        facultyPreferences.map((item, index) => ({
                          preference_rank: index + 1,
                          discipline_code: item.discipline_code,
                          course: item.primary_subject_course,
                          crn: item.primary_crn,
                          title: item.title,
                          campus: item.campus,
                          modality: item.modality,
                        })),
                        `${activeTerm.code.toLowerCase()}-${selectedFaculty?.employeeId || "faculty"}-preferences-preview.csv`,
                        ["preference_rank", "discipline_code", "course", "crn", "title", "campus", "modality"]
                      )
                    }
                  >
                    Download My List
                  </button>
                </div>
                {preferencesMessage ? (
                  <div style={{ marginTop: 10, color: /saved|loaded|loading/i.test(preferencesMessage) ? "#166534" : "#b91c1c", fontWeight: 700 }}>
                    {preferencesMessage}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div style={ui.tableWrap}>
            <table className="cos-table" style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Discipline</th>
                  <th style={ui.th}>Course</th>
                  <th style={ui.th}>CRN</th>
                  <th style={ui.th}>Title</th>
                  <th style={ui.th}>Meetings</th>
                  <th style={ui.th}>Units</th>
                  <th style={ui.th}>Campus</th>
                  <th style={ui.th}>Method</th>
                  <th style={ui.th}>Modality</th>
                  {role === "faculty" ? <th style={ui.th}>Interest</th> : null}
                  {role === "faculty" ? <th style={ui.th}>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {(role === "faculty" ? facultySectionRows : visibleSections).length ? (
                  (role === "faculty" ? facultySectionRows : visibleSections).map((section) => (
                    <tr key={section.assignment_group_id}>
                      <td style={ui.td}>{section.discipline_code || ""}</td>
                      <td style={ui.td}>{section.primary_subject_course || ""}</td>
                      <td style={ui.td}>{section.primary_crn || ""}</td>
                      <td style={ui.td}><div>{section.title || ""}</div>{hasLinkedSections(section) ? <div style={{ marginTop: 6 }}><span style={workflowStatePillStyle("advanced")}>Linked Sections</span></div> : null}</td>
                      <td style={ui.td}>{formatMeetings(section.meetings)}</td>
                      <td style={ui.td}>{formatUnits(section.units)}</td>
                      <td style={ui.td}>{section.campus || ""}</td>
                      <td style={ui.td}>
                        <span style={methodPillStyle(sectionMethodLabel(section))}>{sectionMethodLabel(section)}</span>
                      </td>
                      <td style={ui.td}>
                        <span style={modalityPillStyle(sectionModalityLabel(section))}>{sectionModalityLabel(section)}</span>
                      </td>
                      {role === "faculty" ? (
                        <td style={ui.td}>
                          {section.is_preferred ? <span style={workflowStatePillStyle("top")}>Preference #{section.preference_rank}</span> : <span style={ui.chip}>Not ranked</span>}
                          <div style={{ marginTop: 6 }}>
                            <span style={workflowStatePillStyle(section.availabilitySummary?.matches ? "assigned" : "bypass")}>
                              {section.availabilitySummary?.label || "No availability selected"}
                            </span>
                          </div>
                        </td>
                      ) : null}
                      {role === "faculty" ? (
                        <td style={ui.td}>
                          {section.is_preferred ? (
                            <button style={ui.btn} onClick={() => removePreference(section.assignment_group_id)}>
                              Remove
                            </button>
                          ) : (
                            <button style={ui.btnPrimary} onClick={() => addPreference(section)}>
                              Add to Preferences
                            </button>
                          )}
                          {facultyPreferences.some((item) => item.assignment_group_id !== section.assignment_group_id && hasMeetingConflict(section, item)) ? (
                            <div style={{ marginTop: 6, color: "#b45309", fontSize: 12, fontWeight: 700 }}>
                              Conflicts with a selected meeting pattern
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={ui.td} colSpan={role === "faculty" ? 11 : 9}>
                      No PT-eligible open sections found yet. Upload a schedule, then click Refresh Sections.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>


        </>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div className="cos-summary-card" style={{ ...ui.card, padding: 16 }}>
      <div style={{ ...ui.small, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 800 }}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 30, fontWeight: 900, color: "var(--brand-blue)" }}>{value}</div>
    </div>
  );
}

function TinyStat({ label, value }) {
  return (
    <div
      style={{
        background: "var(--bg-soft)",
        border: "1px solid var(--border-color)",
        borderRadius: 16,
        padding: 12,
      }}
    >
      <div style={{ ...ui.small, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 6, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
