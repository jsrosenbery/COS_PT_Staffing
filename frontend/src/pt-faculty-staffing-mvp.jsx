const API_BASE = "https://cos-pt-staffing.onrender.com";
import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

const initialTerms = [{ id: "fa27", code: "FA27", name: "Fall 2027", active: true }];

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
  page: { minHeight: "100vh", background: "#f8fafc", padding: 24, fontFamily: "Arial, sans-serif", color: "#0f172a" },
  shell: { maxWidth: 1300, margin: "0 auto", display: "grid", gap: 24 },
  card: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" },
  cardTitle: { fontSize: 20, fontWeight: 700, margin: 0 },
  cardDesc: { fontSize: 13, color: "#475569", marginTop: 6 },
  tableWrap: { overflowX: "auto", marginTop: 16 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #cbd5e1", background: "#f8fafc", whiteSpace: "nowrap" },
  td: { padding: "10px 12px", borderBottom: "1px solid #e2e8f0", verticalAlign: "top" },
  row: { display: "flex", gap: 12, flexWrap: "wrap" },
  between: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  btn: { padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#ffffff", cursor: "pointer", fontWeight: 600 },
  btnPrimary: { padding: "10px 14px", borderRadius: 10, border: "1px solid #0f172a", background: "#0f172a", color: "#ffffff", cursor: "pointer", fontWeight: 600 },
  input: { padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1", width: "100%" },
  select: { padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff" },
  badge: (status) => ({ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: statusColors[status] || "#e2e8f0" }),
  gridSummary: { display: "grid", gap: 16, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" },
  sectionCard: { border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" },
  small: { fontSize: 12, color: "#64748b" },
  chip: { display: "inline-block", padding: "6px 10px", borderRadius: 999, background: "#eef2ff", color: "#3730a3", fontSize: 12, fontWeight: 700, marginRight: 8, marginBottom: 8 },
  panelGrid: { display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)" },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 12, color: "#475569" },
  td: { padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
};

export default function PTFacultyStaffingMVP() {
  const [role, setRole] = useState("admin");
  const [selectedChairName, setSelectedChairName] = useState(initialChairAssignments[0]?.chairName || "");
  const [selectedDeanName, setSelectedDeanName] = useState(initialDeanAssignments[0]?.deanName || "");
  const [selectedFacultyId, setSelectedFacultyId] = useState(initialFaculty[0]?.id || "");
  const [terms] = useState(initialTerms);
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
  const [facultyPreferences, setFacultyPreferences] = useState([]);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [showOnlyConflictFree, setShowOnlyConflictFree] = useState(false);
  const [mappingList, setMappingList] = useState([]);
  const [loadingMappingList, setLoadingMappingList] = useState(false);
  const [mappingAdminError, setMappingAdminError] = useState("");
  const [showMappingList, setShowMappingList] = useState(false);

  const activeTerm = terms.find((t) => t.active);

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

  const visibleSections = useMemo(() => {
    return roleScopedSections.filter((section) => {
      if (selectedDisciplineCode === "ALL") return true;
      return section.discipline_code === selectedDisciplineCode;
    });
  }, [roleScopedSections, selectedDisciplineCode]);

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
    if (role !== "faculty") return;
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

  async function handleScheduleUpload(file) {
    if (!file) return;

    setUploadingSchedule(true);
    setBackendMessage("");
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

      const response = await fetch(`${API_BASE}/api/upload/schedule`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setUploadReport({
          errors: data.errors || [data.error || "Upload failed."],
          warnings: data.warnings || [],
          unmappedSubjects: data.unmappedSubjects || [],
          importedCount: 0,
          fileName: file.name,
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
        fileName: file.name,
        summary: data.summary || null,
      });
      setBackendMessage("Schedule uploaded to backend successfully.");
      loadAvailableSections(selectedDisciplineCode);
    } catch (error) {
      setUploadReport({
        errors: [error.message || "Unexpected upload error."],
        warnings: [],
        unmappedSubjects: [],
        importedCount: 0,
        fileName: file.name,
        summary: null,
      });
      setBackendMessage("Could not reach the backend service.");
    } finally {
      setUploadingSchedule(false);
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

  const summary = {
    ready: disciplines.filter((d) => d.status === "ready").length,
    open: disciplines.filter((d) => d.status === "open").length,
    pending: disciplines.filter((d) => d.status === "chair_finalized").length,
    approved: disciplines.filter((d) => d.status === "dean_approved").length,
    submitted: 0,
    noActivity: 0,
  };

  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={ui.between}>
          <div>
            <h1 style={{ fontSize: 32, margin: 0 }}>PT Faculty Staffing MVP</h1>
            <div style={ui.cardDesc}>
              Upload subject mapping once, then future schedule uploads can reuse it automatically.
            </div>
          </div>
          <div style={ui.row}>
            <select style={ui.select} value={role} onChange={(e) => { setRole(e.target.value); setSelectedDisciplineCode("ALL"); }}>
              <option value="admin">Scheduler / Admin</option>
              <option value="chair">Division Chair</option>
              <option value="dean">Dean</option>
              <option value="faculty">Part-Time Faculty</option>
            </select>
            <span style={{ ...ui.badge("open"), background: "#0f172a", color: "white" }}>
              {activeTerm.name}
            </span>
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
        <div style={ui.card}>
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
            <div style={{ marginTop: 12, color: "#475569", fontWeight: 700 }}>
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
                  <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>
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
              <div style={{ color: "#475569", fontSize: 13 }}>
                {mappingList.length} mapping row(s)
              </div>
            </div>

            {mappingList.length ? (
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={ui.table}>
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
              <div style={{ marginTop: 12, color: "#475569" }}>
                No mappings are currently saved.
              </div>
            )}
          </div>
        ) : null}

        {role === "admin" ? (
        <div style={ui.card}>
          <h2 style={ui.cardTitle}>Schedule Upload</h2>
          <div style={ui.cardDesc}>
            Upload a division or college-wide CSV after subject mapping is in place.
          </div>
          <div style={{ marginTop: 16 }}>
            <input
              style={ui.input}
              type="file"
              accept=".csv"
              disabled={uploadingSchedule}
              onChange={(e) => handleScheduleUpload(e.target.files?.[0])}
            />
          </div>

          {uploadingSchedule ? (
            <div style={{ marginTop: 12, color: "#475569", fontWeight: 700 }}>
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
              <div style={{ marginTop: 8, color: "#475569" }}>
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
                <div style={{ color: "#475569" }}>No sample seniority rows are assigned to this faculty profile yet.</div>
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

          {loadingSections ? (
            <div style={{ marginTop: 12, color: "#475569", fontWeight: 700 }}>
              Loading available sections...
            </div>
          ) : null}

          {sectionsError ? (
            <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
              {sectionsError}
            </div>
          ) : null}

          <div style={{ marginTop: 12, color: "#475569" }}>
            Showing {visibleSections.length} section(s)
            {selectedDisciplineCode !== "ALL" ? ` for ${selectedDisciplineCode}` : ""}.
          </div>
          {role !== "admin" ? (
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
              {role === "chair"
                ? `Scoped to ${selectedChairName}`
                : role === "dean"
                ? `Scoped to ${selectedDeanName}`
                : `Scoped to ${selectedFaculty ? facultyName(selectedFaculty) : "selected faculty"}`}
            </div>
          ) : null}

          {role === "faculty" ? (
            <div style={ui.panelGrid}>
              <div>
                <div style={{ marginTop: 12, color: "#475569" }}>
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
                <div style={{ marginTop: 8, color: "#475569" }}>
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
                          background: conflictIds.has(item.assignment_group_id) ? "#fff7ed" : "#fff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 700 }}>
                            #{index + 1} {item.primary_subject_course} • {item.primary_crn}
                          </div>
                          <button style={ui.btn} onClick={() => removePreference(item.assignment_group_id)}>Remove</button>
                        </div>
                        <div style={{ marginTop: 6 }}>{item.title || ""}</div>
                        <div style={{ marginTop: 6, color: "#475569", fontSize: 13 }}>
                          {formatMeetings(item.meetings)} • {item.campus || ""} • {item.modality || ""}
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          <button disabled={index === 0} style={ui.btn} onClick={() => movePreference(index, index - 1)}>Move Up</button>
                          <button disabled={index === facultyPreferences.length - 1} style={ui.btn} onClick={() => movePreference(index, index + 1)}>Move Down</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#64748b" }}>No selections yet.</div>
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
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Discipline</th>
                  <th style={ui.th}>Course</th>
                  <th style={ui.th}>CRN</th>
                  <th style={ui.th}>Title</th>
                  <th style={ui.th}>Meetings</th>
                  <th style={ui.th}>Units</th>
                  <th style={ui.th}>Campus</th>
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
                      <td style={ui.td}>{section.modality || ""}</td>
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
                    <td style={ui.td} colSpan={role === "faculty" ? 9 : 8}>
                      No PT-eligible open sections found yet. Upload a schedule, then click Refresh Sections.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div style={ui.card}>
      <div style={ui.small}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function TinyStat({ label, value }) {
  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <div style={{ ...ui.small, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 6, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
