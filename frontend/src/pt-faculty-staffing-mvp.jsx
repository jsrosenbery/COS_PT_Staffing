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
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 12, color: "#475569" },
  td: { padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 14 },
};

export default function PTFacultyStaffingMVP() {
  const [role, setRole] = useState("admin");
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

  const visibleSections = useMemo(() => {
    return availableSections.filter((section) => {
      if (selectedDisciplineCode === "ALL") return true;
      return section.discipline_code === selectedDisciplineCode;
    });
  }, [availableSections, selectedDisciplineCode]);

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
            <select style={ui.select} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Scheduler / Admin</option>
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


        {mappingAdminError ? (
          <div style={{ ...ui.card, borderColor: "#fecaca", background: "#fff7f7" }}>
            <div style={{ color: "#b91c1c", fontWeight: 700 }}>{mappingAdminError}</div>
          </div>
        ) : null}

        {showMappingList ? (
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

        <div style={ui.card}>
          <div style={ui.between}>
            <div>
              <h2 style={ui.cardTitle}>Available Sections</h2>
              <div style={ui.cardDesc}>
                View PT-eligible open sections by discipline for the active term.
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
                {availableDisciplineCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <button style={ui.btnPrimary} onClick={() => loadAvailableSections(selectedDisciplineCode)}>
                Refresh Sections
              </button>
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
                </tr>
              </thead>
              <tbody>
                {visibleSections.length ? (
                  visibleSections.map((section) => (
                    <tr key={section.assignment_group_id}>
                      <td style={ui.td}>{section.discipline_code || ""}</td>
                      <td style={ui.td}>{section.primary_subject_course || ""}</td>
                      <td style={ui.td}>{section.primary_crn || ""}</td>
                      <td style={ui.td}>{section.title || ""}</td>
                      <td style={ui.td}>{formatMeetings(section.meetings)}</td>
                      <td style={ui.td}>{formatUnits(section.units)}</td>
                      <td style={ui.td}>{section.campus || ""}</td>
                      <td style={ui.td}>{section.modality || ""}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td style={ui.td} colSpan={8}>
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
