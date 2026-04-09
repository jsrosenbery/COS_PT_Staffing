const API_BASE = "https://cos-pt-staffing.onrender.com";
import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import cosLogo from "./assets/cos-logo.jpg";

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
  { chairName: "Math & Engineering Division Chair", divisions: ["Math & Engineering"] },
  { chairName: "Science Division Chair", divisions: ["Science"] },
  { chairName: "Language & Communication Stud. Division Chair", divisions: ["Language & Communication Stud."] },
  { chairName: "Library Division Chair", divisions: ["Library"] },
  { chairName: "Physical Education Division Chair", divisions: ["Physical Education"] },
  { chairName: "Nursing Division Chair", divisions: ["Nursing"] },
  { chairName: "Industry & Technology Division Chair", divisions: ["Industry and Technology", "Industry & Technology"] },
  { chairName: "Cosmetology Division Chair", divisions: ["Cosmetology"] },
  { chairName: "Student Services Division Chair", divisions: ["Student Services"] },
  { chairName: "Fire Technology Division Chair", divisions: ["Fire Technology"] },
  { chairName: "Police Sciences Division Chair", divisions: ["Police Sciences"] },
  { chairName: "Emergency Medical Technician Division Chair", divisions: ["Emergency Medical Technician"] },
];

const initialDeanAssignments = [
  { deanName: "Agriculture Dean", divisions: ["Agriculture"] },
  { deanName: "Social Sciences, Business, Consumer/Family Studies Dean", divisions: ["Social Sciences", "Business", "Consumer/Family Studies"] },
  { deanName: "English, Fine Arts Dean", divisions: ["English", "Fine Arts"] },
  { deanName: "Math & Engineering, Science Dean", divisions: ["Math & Engineering", "Science"] },
  { deanName: "Language & Communication Stud., Library Dean", divisions: ["Language & Communication Stud.", "Library"] },
  { deanName: "Physical Education Dean", divisions: ["Physical Education"] },
  { deanName: "Nursing, Industry & Technology, Cosmetology Dean", divisions: ["Nursing", "Industry and Technology", "Industry & Technology", "Cosmetology"] },
  { deanName: "Student Services Dean", divisions: ["Student Services"] },
  { deanName: "Fire Technology, Police Sciences, Emergency Medical Technician Dean", divisions: ["Fire Technology", "Police Sciences", "Emergency Medical Technician"] },
];

const initialSections = [];
const initialLinks = [];
const initialSubmissions = [];
const initialAssignments = [];
const initialDecisionLog = [];

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
      return [dayPart, timePart, roomPart].filter(Boolean).join(" • ");
    })
    .join("; ");
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

  const campusMatch = !filters?.campuses?.length || filters.campuses.includes(campus);
  const methodMatch = !filters?.methods?.length || filters.methods.includes(method);
  const modalityMatch = !filters?.modalities?.length || filters.modalities.includes(modality);

  return campusMatch && methodMatch && modalityMatch;
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
  return pillStyle("#f8fafc", "#475569", "#cbd5e1");
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
};

export default function PTFacultyStaffingMVP() {
  const [role, setRole] = useState("admin");
  const [terms, setTerms] = useState(initialTerms);
  const [newTermCode, setNewTermCode] = useState("");
  const [newTermName, setNewTermName] = useState("");
  const [termMessage, setTermMessage] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [selectedChairName, setSelectedChairName] = useState(initialChairAssignments[0]?.chairName || "");
  const [selectedDeanName, setSelectedDeanName] = useState(initialDeanAssignments[0]?.deanName || "");
  const [selectedFacultyId, setSelectedFacultyId] = useState(initialFaculty[0]?.id || "");
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
  const [chairWorkflowRows, setChairWorkflowRows] = useState([]);
  const [tentativeAssignments, setTentativeAssignments] = useState([]);
  const [decisionLogs, setDecisionLogs] = useState([]);
  const [chairMessage, setChairMessage] = useState("");
  const [loadingChairWorkflow, setLoadingChairWorkflow] = useState(false);
  const [facultyPreferences, setFacultyPreferences] = useState([]);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [showOnlyConflictFree, setShowOnlyConflictFree] = useState(false);
  const [mappingList, setMappingList] = useState([]);
  const [loadingMappingList, setLoadingMappingList] = useState(false);
  const [mappingAdminError, setMappingAdminError] = useState("");
  const [showMappingList, setShowMappingList] = useState(false);
  const [sectionFilters, setSectionFilters] = useState({ campuses: [], methods: [], modalities: [] });
  const [selectedUploadDivision, setSelectedUploadDivision] = useState("");
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const [uploadConflict, setUploadConflict] = useState(null);

  const activeTerm = terms.find((t) => t.active) || terms[0] || { code: "SP27", name: "Spring 2027", active: true };

  async function loadTerms() {
    try {
      const response = await fetch(`${API_BASE}/api/terms`);
      const data = await response.json();
      if (!response.ok) {
        setTermMessage(data.error || "Could not load terms.");
        return;
      }
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
    try {
      const response = await fetch(`${API_BASE}/api/terms/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        setTermMessage(data.error || "Could not activate term.");
        return;
      }
      setTermMessage(`Active term set to ${data.term.term_name}.`);
      await loadTerms();
    } catch (error) {
      setTermMessage(error.message || "Could not activate term.");
    }
  }

  async function createOrUpdateTerm() {
    try {
      const response = await fetch(`${API_BASE}/api/terms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: newTermCode,
          termName: newTermName,
          isActive: false,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setTermMessage(data.error || "Could not save term.");
        return;
      }
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
    if ((role === "chair" || role === "admin" || role === "dean") && activeTerm?.code) {
      loadChairWorkflow();
    }
  }, [role, activeTerm?.code, selectedDisciplineCode, selectedChairName, selectedDeanName]);


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
    return initialChairAssignments.find((item) => item.chairName === selectedChairName)?.divisions || [];
  }, [selectedChairName]);

  const deanDivisions = useMemo(() => {
    return initialDeanAssignments.find((item) => item.deanName === selectedDeanName)?.divisions || [];
  }, [selectedDeanName]);

  const uploadDivisionOptions = useMemo(() => (
    Array.from(
      new Set(
        [...initialChairAssignments, ...initialDeanAssignments]
          .flatMap((item) => item.divisions || [])
          .map((division) => normalize(division))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))
  ), []);

  useEffect(() => {
    if (!selectedUploadDivision && uploadDivisionOptions.length) {
      setSelectedUploadDivision(uploadDivisionOptions[0]);
    }
  }, [selectedUploadDivision, uploadDivisionOptions]);

  const selectedFaculty = useMemo(
    () => faculty.find((item) => item.id === selectedFacultyId) || faculty[0],
    [faculty, selectedFacultyId]
  );

  const facultySeniorityRows = useMemo(() => {
    if (!selectedFaculty) return [];
    return seniority
      .filter((row) => row.facultyId === selectedFaculty.id)
      .map((row) => {
        const discipline = disciplines.find((d) => d.id === row.disciplineId);
        const fallbackMap = {
          hist: "HIST",
          math: "MATH",
          pols: "POLS",
          aj: "ADMINISTRATION_OF_JUSTICE",
          anth: "ANTHROPOLOGY",
          astr: "ASTRONOMY",
          art: "ART",
          asl: "AMERICAN_SIGN_LANGUAGE",
          cina: "CINEMA",
          music: "MUSIC",
          bus: "BUSINESS",
          biol: "BIOLOGICAL_SCIENCES",
          chem: "CHEMISTRY",
          chld: "CHILD_DEVELOPMENT",
        };
        return {
          ...row,
          disciplineCode:
            discipline?.code ||
            fallbackMap[row.disciplineId] ||
            row.disciplineId?.toUpperCase?.() ||
            row.disciplineId,
          disciplineName: discipline?.name || row.disciplineId,
        };
      });
  }, [selectedFaculty, seniority, disciplines]);

  const roleScopedSections = useMemo(() => {
    if (role === "chair") {
      return availableSections.filter((section) => chairDivisions.includes(section.division));
    }
    if (role === "dean") {
      return availableSections.filter((section) => deanDivisions.includes(section.division));
    }
    if (role === "faculty") {
      const facultyCodes = facultySeniorityRows.map((row) => row.disciplineCode).filter(Boolean);
      if (!facultyCodes.length) {
        return availableSections;
      }
      const scoped = availableSections.filter((section) => facultyCodes.includes(section.discipline_code));
      return scoped.length ? scoped : availableSections;
    }
    return availableSections;
  }, [role, availableSections, chairDivisions, deanDivisions, facultySeniorityRows]);

  const roleAvailableDisciplineCodes = useMemo(() => {
    return Array.from(
      new Set(roleScopedSections.map((section) => section.discipline_code).filter(Boolean))
    ).sort();
  }, [roleScopedSections]);

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

  const visibleSections = useMemo(() => {
    return roleScopedSections.filter((section) => {
      if (selectedDisciplineCode !== "ALL" && section.discipline_code !== selectedDisciplineCode) return false;
      return matchesSectionFilters(section, sectionFilters);
    });
  }, [roleScopedSections, selectedDisciplineCode, sectionFilters]);

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

  const selectableSections = useMemo(() => {
    const selectedIds = new Set(facultyPreferences.map((item) => item.assignment_group_id));
    const base = visibleSections.filter((section) => !selectedIds.has(section.assignment_group_id));
    return showOnlyConflictFree
      ? base.filter((section) => !facultyPreferences.some((pref) => hasMeetingConflict(section, pref)))
      : base;
  }, [visibleSections, facultyPreferences, showOnlyConflictFree]);

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

      const response = await fetch(`${API_BASE}/api/available-sections?${params.toString()}`);
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


  async function loadFacultyPreferences(facultyId = selectedFacultyId) {
    if (role !== "faculty" || !activeTerm?.code) return;
    try {
      const params = new URLSearchParams({ termCode: activeTerm.code, facultyId });
      const response = await fetch(`${API_BASE}/api/preferences?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setPreferencesMessage(data.error || "Could not load saved preferences.");
        setFacultyPreferences([]);
        return;
      }
      setFacultyPreferences(data.preferences || []);
    } catch (error) {
      setPreferencesMessage(error.message || "Could not load saved preferences.");
      setFacultyPreferences([]);
    }
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

  async function savePreferences() {
    if (!selectedFaculty) return;
    setSavingPreferences(true);
    setPreferencesMessage("");
    try {
      const response = await fetch(`${API_BASE}/api/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termCode: activeTerm.code,
          facultyId: selectedFaculty.id,
          employeeId: selectedFaculty.employeeId,
          facultyName: facultyName(selectedFaculty),
          preferences: facultyPreferences.map((item, index) => ({
            assignment_group_id: item.assignment_group_id,
            discipline_code: item.discipline_code,
            preference_rank: index + 1,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPreferencesMessage(data.error || "Could not save preferences.");
        return;
      }
      setPreferencesMessage(`Saved ${data.savedCount || 0} preference(s).`);
      loadFacultyPreferences(selectedFaculty.id);
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
    setSectionFilters({ campuses: [], methods: [], modalities: [] });
  }

  async function exportPreferences() {
    try {
      const response = await fetch(`${API_BASE}/api/preferences/export?termCode=${activeTerm.code}`);
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
      const response = await fetch(`${API_BASE}/api/subject-mapping?scope=global&termCode=${activeTerm.code}`);
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
      const response = await fetch(`${API_BASE}/api/subject-mapping/export?scope=global&termCode=${activeTerm.code}`);
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
        const response = await fetch(`${API_BASE}/api/subject-mapping/${activeTerm.code}/status`);
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

      const response = await fetch(`${API_BASE}/api/upload/subject-mapping`, {
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

      const response = await fetch(`${API_BASE}/api/upload/schedule`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
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

      setPendingUploadFile(null);
      setSections([]);
      setUploadReport({
        errors: [],
        warnings: data.warnings || [],
        unmappedSubjects: data.unmappedSubjects || [],
        importedCount: data.importedCount || 0,
        fileName: targetFile.name,
        summary: data.summary || null,
      });
      setBackendMessage(`${data.divisionName || selectedUploadDivision} uploaded successfully.${data.replacedCount ? ` Replaced ${data.replacedCount} existing section bundle(s) for this division.` : ""}`);
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
              </div>
            </div>
            <div style={{ ...ui.row, alignItems: "center" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 999, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.22)", fontWeight: 800 }}>
                <span>Dark View</span>
                <input type="checkbox" checked={darkMode} onChange={(e) => setDarkMode(e.target.checked)} />
              </label>
              <select
                style={{ ...ui.select, background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)" }}
                value={role}
                onChange={(e) => { setRole(e.target.value); setSelectedDisciplineCode("ALL"); }}
              >
                <option value="admin" style={{ color: "#0f172a" }}>Scheduler / Admin</option>
                <option value="chair" style={{ color: "#0f172a" }}>Division Chair</option>
                <option value="dean" style={{ color: "#0f172a" }}>Dean</option>
                <option value="faculty" style={{ color: "#0f172a" }}>Part-Time Faculty</option>
              </select>
              <select
                style={{ ...ui.select, background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.22)", minWidth: 220 }}
                value={activeTerm.code}
                onChange={(e) => activateTerm(e.target.value)}
              >
                {terms.length ? terms.map((term) => (
                  <option key={term.code} value={term.code} style={{ color: "#0f172a" }}>
                    {term.name}{term.active ? " • Active" : ""}
                  </option>
                )) : (
                  <option value={activeTerm.code} style={{ color: "#0f172a" }}>{activeTerm.name}</option>
                )}
              </select>
            </div>
          </div>
        </div>

        <div style={ui.gridSummary}>
          <SummaryCard title="Ready" value={summary.ready} />
          <SummaryCard title="Open" value={summary.open} />
          <SummaryCard title="Pending Dean" value={summary.pending} />
          <SummaryCard title="Approved" value={summary.approved} />
          <SummaryCard title="Submitted" value={summary.submitted} />
          <SummaryCard title="No Activity" value={summary.noActivity} />
        </div>

        {role === "admin" ? (
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

        {role === "admin" ? (
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

        {role === "admin" && mappingAdminError ? (
          <div style={{ ...ui.card, borderColor: "#fecaca", background: "#fff7f7" }}>
            <div style={{ color: "#b91c1c", fontWeight: 700 }}>{mappingAdminError}</div>
          </div>
        ) : null}

        {role === "admin" && showMappingList ? (
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

        {role === "admin" ? (
        <div style={ui.card}>
          <h2 style={ui.cardTitle}>Schedule Upload</h2>
          <div style={ui.cardDesc}>
            Upload one division at a time after subject mapping is in place. The system replaces only that division for the active term.
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: 720 }}>
            <div>
              <div style={{ marginBottom: 6, fontWeight: 700 }}>Division</div>
              <select
                style={ui.select}
                value={selectedUploadDivision}
                onChange={(e) => setSelectedUploadDivision(e.target.value)}
                disabled={uploadingSchedule}
              >
                {uploadDivisionOptions.map((division) => (
                  <option key={division} value={division}>{division}</option>
                ))}
              </select>
              <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                Divisions are sorted A to Z. A new upload replaces only this division for the active term.
              </div>
            </div>
            <input
              style={ui.input}
              type="file"
              accept=".csv"
              disabled={uploadingSchedule}
              onChange={(e) => handleScheduleUpload(e.target.files?.[0])}
            />
          </div>

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
                <button style={ui.btn} onClick={() => { setUploadConflict(null); setPendingUploadFile(null); setBackendMessage(""); }}>
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
                  </div>
                  {uploadReport.summary ? (
                    <div
                      style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                        marginTop: 12,
                      }}
                    >
                      <TinyStat label="Rows" value={uploadReport.summary.totalRows} />
                      <TinyStat label="Unique CRNs" value={uploadReport.summary.totalCrns} />
                      <TinyStat label="Groups" value={uploadReport.summary.assignmentGroups} />
                      <TinyStat label="Mapped" value={uploadReport.summary.mappedAssignmentGroups} />
                      <TinyStat label="Unmapped" value={uploadReport.summary.unmappedAssignmentGroups} />
                      <TinyStat label="Cross-Listed" value={uploadReport.summary.crossListedGroups} />
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

        {role === "admin" ? (
        <div style={ui.card}>
          <h2 style={ui.cardTitle}>Starter Mapping Example</h2>
          <div style={ui.cardDesc}>Use this exact header format in your CSV.</div>
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
        ) : null}


        {role === "chair" ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Division Chair View</h2>
                <div style={ui.cardDesc}>
                  Scoped to the real division structure you provided. Chair names can be swapped in once you are ready.
                </div>
              </div>
              <select
                style={ui.select}
                value={selectedChairName}
                onChange={(e) => {
                  setSelectedChairName(e.target.value);
                  setSelectedDisciplineCode("ALL");
                }}
              >
                {initialChairAssignments.map((item) => (
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

        {role === "dean" ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Dean View</h2>
                <div style={ui.cardDesc}>
                  Scoped to the real dean coverage structure you provided. Dean names can be swapped in later.
                </div>
              </div>
              <select
                style={ui.select}
                value={selectedDeanName}
                onChange={(e) => {
                  setSelectedDeanName(e.target.value);
                  setSelectedDisciplineCode("ALL");
                }}
              >
                {initialDeanAssignments.map((item) => (
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

        {role === "faculty" ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Part-Time Faculty View</h2>
                <div style={ui.cardDesc}>
                  This view is scoped to a sample faculty member's seniority disciplines for preview purposes. If no sample mapping matches the loaded schedule yet, the view will temporarily fall back to all available sections so you can keep testing.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  style={ui.select}
                  value={selectedFacultyId}
                  onChange={(e) => {
                    setSelectedFacultyId(e.target.value);
                    setSelectedDisciplineCode("ALL");
                    setFacultyPreferences([]);
                    setTimeout(() => loadFacultyPreferences(e.target.value), 0);
                  }}
                >
                  {faculty.map((item) => (
                    <option key={item.id} value={item.id}>
                      {facultyName(item)}
                    </option>
                  ))}
                </select>
                <button style={ui.btn} onClick={() => loadFacultyPreferences(selectedFacultyId)}>
                  Load Saved Preferences
                </button>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              {facultySeniorityRows.length ? (
                facultySeniorityRows.map((row) => (
                  <span key={`${row.disciplineCode}-${row.rank}`} style={ui.chip}>
                    {row.disciplineCode} • Rank {row.rank}
                  </span>
                ))
              ) : (
                <div style={{ color: "var(--text-muted)" }}>No sample seniority rows are assigned to this faculty profile yet.</div>
              )}
            </div>
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
                style={ui.select}
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
            {(sectionFilters.campuses.length || sectionFilters.methods.length || sectionFilters.modalities.length) ? " with active display filters." : "."}
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
                            #{index + 1} {item.primary_subject_course} • {item.primary_crn}
                          </div>
                          <button style={ui.btn} onClick={() => removePreference(item.assignment_group_id)}>Remove</button>
                        </div>
                        <div style={{ marginTop: 6 }}>{item.title || ""}</div>
                        <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                          {formatMeetings(item.meetings)} • {item.campus || ""} • {sectionMethodLabel(item)} • {sectionModalityLabel(item)}
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
                  <button style={ui.btnPrimary} onClick={savePreferences} disabled={savingPreferences}>
                    {savingPreferences ? "Saving..." : "Save Preferences"}
                  </button>
                  <button style={ui.btn} onClick={() => {
                    setFacultyPreferences([]);
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
                  <div style={{ marginTop: 10, color: preferencesMessage.toLowerCase().includes("saved") ? "#166534" : "#b91c1c", fontWeight: 700 }}>
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
                  {role === "faculty" ? <th style={ui.th}>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {(role === "faculty" ? selectableSections : visibleSections).length ? (
                  (role === "faculty" ? selectableSections : visibleSections).map((section) => (
                    <tr key={section.assignment_group_id}>
                      <td style={ui.td}>{section.discipline_code || ""}</td>
                      <td style={ui.td}>{section.primary_subject_course || ""}</td>
                      <td style={ui.td}>{section.primary_crn || ""}</td>
                      <td style={ui.td}>{section.title || ""}</td>
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
                          <button style={ui.btnPrimary} onClick={() => addPreference(section)}>
                            Add to Preferences
                          </button>
                          {facultyPreferences.some((item) => hasMeetingConflict(section, item)) ? (
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
                    <td style={ui.td} colSpan={role === "faculty" ? 10 : 9}>
                      No PT-eligible open sections found yet. Upload a schedule, then click Refresh Sections.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {(role === "admin" || role === "chair" || role === "dean") ? (
          <div style={ui.card}>
            <div style={ui.between}>
              <div>
                <h2 style={ui.cardTitle}>Instructor-First Assignment Workflow</h2>
                <div style={ui.cardDesc}>
                  Seniority stays in front, preference rank breaks ties, and tentative assignments now recalculate by real meeting conflicts instead of a blanket one-section-only rule.
                </div>
              </div>
              <button style={ui.btnPrimary} onClick={loadChairWorkflow}>
                {loadingChairWorkflow ? "Refreshing..." : "Refresh Workflow"}
              </button>
            </div>

            {chairMessage ? (
              <div style={{ marginTop: 12, color: chairMessage.toLowerCase().includes("could not") || chairMessage.toLowerCase().includes("conflict") || chairMessage.toLowerCase().includes("required") || chairMessage.toLowerCase().includes("already") ? "#b91c1c" : "#166534", fontWeight: 700 }}>
                {chairMessage}
              </div>
            ) : null}

            <div style={{ marginTop: 12, color: "var(--text-muted)" }}>
              {sectionQueue.length} queued section(s), {tentativeAssignments.length} tentative assignment(s), {decisionLogs.length} recent decision log entr{decisionLogs.length === 1 ? "y" : "ies"}.
            </div>

            <div className="cos-panel-grid" style={{ ...ui.panelGrid, marginTop: 16 }}>
              <div style={{ display: "grid", gap: 12 }}>
                {sectionQueue.length ? sectionQueue.map((section) => {
                  const topCandidate = section.eligibleCandidates[0] || null;
                  return (
                    <div key={section.assignment_group_id} style={{ ...ui.sectionCard, borderColor: section.currentAssignment ? "#bbf7d0" : "var(--border-color)", background: section.currentAssignment ? "rgba(220, 252, 231, 0.28)" : "var(--bg-card)" }}>
                      <div style={{ ...ui.between, alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 800 }}>{section.primary_subject_course} • {section.primary_crn}</div>
                          <div style={{ marginTop: 4 }}>{section.title || "Untitled"}</div>
                          <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                            {formatMeetings(section.meetings)}
                            {section.campus ? ` • ${section.campus}` : ""}
                            {section.discipline_code ? ` • ${section.discipline_code}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <span style={methodPillStyle(sectionMethodLabel(section))}>{sectionMethodLabel(section)}</span>
                          <span style={modalityPillStyle(sectionModalityLabel(section))}>{sectionModalityLabel(section)}</span>
                          {section.currentAssignment ? (
                            <span style={workflowStatePillStyle("assigned")}>Assigned</span>
                          ) : topCandidate ? (
                            <span style={workflowStatePillStyle("top")}>Next in line ready</span>
                          ) : (
                            <span style={workflowStatePillStyle("conflict")}>No eligible candidate</span>
                          )}
                        </div>
                      </div>

                      {section.currentAssignment ? (
                        <div style={{ marginTop: 10, color: "#166534", fontWeight: 700 }}>
                          Tentatively assigned to {section.currentAssignment.faculty_name || section.currentAssignment.employee_id}.
                        </div>
                      ) : null}

                      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                        {section.candidates.slice(0, 5).map((row) => {
                          const isTop = topCandidate?.employee_id === row.employee_id;
                          return (
                            <div key={`${section.assignment_group_id}-${row.employee_id}`} style={{ border: "1px solid var(--border-soft)", borderRadius: 14, padding: 10, background: row.has_tentative_assignment ? "rgba(220, 252, 231, 0.22)" : row.has_assignment_conflict ? "rgba(254, 226, 226, 0.22)" : "var(--bg-soft)" }}>
                              <div style={{ ...ui.between, alignItems: "flex-start" }}>
                                <div>
                                  <div style={{ fontWeight: 700 }}>{row.faculty_name}</div>
                                  <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
                                    Seniority #{row.seniority_rank || "—"} • Preference #{row.preference_rank || "—"}
                                  </div>
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
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                    {row.has_tentative_assignment ? <span style={workflowStatePillStyle("assigned")}>Assigned</span> : null}
                                    {!row.has_tentative_assignment && row.section_assigned_to_other ? <span style={workflowStatePillStyle("filled")}>Section filled</span> : null}
                                    {!row.has_tentative_assignment && row.has_assignment_conflict ? <span style={workflowStatePillStyle("conflict")}>Time conflict</span> : null}
                                    {!row.has_tentative_assignment && !row.section_assigned_to_other && !row.has_assignment_conflict && isTop ? <span style={workflowStatePillStyle("top")}>Top candidate</span> : null}
                                    {!row.has_tentative_assignment && !row.section_assigned_to_other && !row.has_assignment_conflict && !isTop ? <span style={workflowStatePillStyle("bypass")}>Bypass needs rationale</span> : null}
                                  </div>
                                  {row.has_tentative_assignment ? (
                                    <button style={ui.btn} disabled>Assigned</button>
                                  ) : row.section_assigned_to_other ? (
                                    <button style={ui.btn} disabled>Filled</button>
                                  ) : row.has_assignment_conflict ? (
                                    <button style={ui.btn} disabled>Time Conflict</button>
                                  ) : (
                                    <button style={isTop ? ui.btnPrimary : ui.btn} onClick={() => assignSectionToInstructor(row, topCandidate?.employee_id)}>
                                      {isTop ? "Assign" : "Assign with Rationale"}
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
                <div style={ui.sectionCard}>
                  <div style={{ fontWeight: 800 }}>Tentative Assignments</div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                    Live persistence snapshot with one-click unassign.
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {tentativeAssignments.length ? tentativeAssignments.map((assignment) => (
                      <div key={assignment.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 14, padding: 10, background: "var(--bg-soft)" }}>
                        <div style={{ ...ui.between, alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{assignment.primary_subject_course} • {assignment.primary_crn}</div>
                            <div style={{ marginTop: 4 }}>{assignment.faculty_name || assignment.employee_id}</div>
                            <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
                              {formatMeetings(assignment.meetings)}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
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

                <div style={ui.sectionCard}>
                  <div style={{ fontWeight: 800 }}>Decision Log</div>
                  <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
                    Every assignment, bypass, and undo leaves breadcrumbs instead of disappearing into fog.
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 12, maxHeight: 540, overflowY: "auto", paddingRight: 4 }}>
                    {decisionLogs.length ? decisionLogs.map((entry) => (
                      <div key={entry.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 14, padding: 10, background: "var(--bg-soft)" }}>
                        <div style={{ ...ui.between, alignItems: "flex-start" }}>
                          <div style={{ fontWeight: 700 }}>{entry.actor_name}</div>
                          <span style={workflowStatePillStyle(entry.event_type === "assignment_removed" ? "filled" : entry.event_type === "bypassed_preference" ? "bypass" : "top")}>{entry.event_type.replace(/_/g, " ")}</span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13 }}>{entry.detail}</div>
                        <div style={{ marginTop: 6, color: "var(--text-subtle)", fontSize: 12 }}>
                          {entry.discipline_code || "All disciplines"} • {new Date(entry.created_at).toLocaleString()}
                        </div>
                      </div>
                    )) : (
                      <div style={{ color: "var(--text-subtle)" }}>No decision log entries yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
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
