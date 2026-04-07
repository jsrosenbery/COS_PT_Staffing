const API_BASE = "https://cos-pt-staffing.onrender.com";
import React, { useMemo, useState } from "react";
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

const ui = {
  page: { minHeight: "100vh", background: "#f8fafc", padding: 24, fontFamily: "Arial, sans-serif", color: "#0f172a" },
  shell: { maxWidth: 1300, margin: "0 auto", display: "grid", gap: 24 },
  card: { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" },
  cardTitle: { fontSize: 20, fontWeight: 700, margin: 0 },
  cardDesc: { fontSize: 13, color: "#475569", marginTop: 6 },
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
    importedCount: 0,
    fileName: "",
    summary: null,
  });
  const [mappingReport, setMappingReport] = useState({
    error: "",
    importedRows: 0,
    fileName: "",
  });
  const [uploadingSchedule, setUploadingSchedule] = useState(false);
  const [uploadingMapping, setUploadingMapping] = useState(false);
  const [backendMessage, setBackendMessage] = useState("");

  const activeTerm = terms.find((t) => t.active);

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
        });
        return;
      }

      setMappingReport({
        error: "",
        importedRows: data.importedRows || 0,
        fileName: file.name,
      });
    } catch (error) {
      setMappingReport({
        error: error.message || "Unexpected mapping upload error.",
        importedRows: 0,
        fileName: file.name,
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
        importedCount: data.importedCount || 0,
        fileName: file.name,
        summary: data.summary || null,
      });
      setBackendMessage("Schedule uploaded to backend successfully.");
    } catch (error) {
      setUploadReport({
        errors: [error.message || "Unexpected upload error."],
        warnings: [],
        importedCount: 0,
        fileName: file.name,
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
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={ui.between}>
          <div>
            <h1 style={{ fontSize: 32, margin: 0 }}>PT Faculty Staffing MVP</h1>
            <div style={ui.cardDesc}>
              Upload subject mapping first, then upload the schedule.
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
            Upload a CSV with columns: <code>subject_code</code>, <code>discipline_code</code>
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

          {uploadingMapping ? (
            <div style={{ marginTop: 12, color: "#475569", fontWeight: 700 }}>
              Uploading subject mapping...
            </div>
          ) : null}

          {mappingReport.fileName ? (
            <div style={{ ...ui.sectionCard, marginTop: 16 }}>
              <div style={{ fontWeight: 700 }}>Latest mapping upload: {mappingReport.fileName}</div>
              {mappingReport.error ? (
                <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
                  {mappingReport.error}
                </div>
              ) : (
                <div style={{ marginTop: 12, color: "#166534", fontWeight: 700 }}>
                  Mapping uploaded successfully. {mappingReport.importedRows} row(s) imported.
                </div>
              )}
            </div>
          ) : null}
        </div>

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
