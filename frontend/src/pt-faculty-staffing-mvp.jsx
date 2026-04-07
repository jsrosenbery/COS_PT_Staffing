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

const initialSections = [
  {
    id: "grp_45678",
    assignment_group_id: "grp_45678",
    disciplineId: "hist",
    primary_subject_course: "HIST 17A",
    all_subject_courses: ["HIST 17A"],
    primary_crn: "45678",
    all_crns: ["45678"],
    title: "U.S. History",
    division: "Social Sciences",
    modality: "F2F",
    campus: "Visalia",
    meetings: [{ days: "MW", start_time: "9:00AM", end_time: "10:15AM", building: "HUM", room: "101" }],
    units: [3],
    pt_eligible: true,
    is_grouped: false,
  },
  {
    id: "grp_45110",
    assignment_group_id: "grp_45110",
    disciplineId: "hist",
    primary_subject_course: "HIST 17A",
    all_subject_courses: ["HIST 17A"],
    primary_crn: "45110",
    all_crns: ["45110"],
    title: "U.S. History",
    division: "Social Sciences",
    modality: "F2F",
    campus: "Visalia",
    meetings: [{ days: "TTh", start_time: "10:30AM", end_time: "11:45AM", building: "HUM", room: "101" }],
    units: [3],
    pt_eligible: true,
    is_grouped: false,
  },
  {
    id: "grp_44990",
    assignment_group_id: "grp_44990",
    disciplineId: "hist",
    primary_subject_course: "HIST 32",
    all_subject_courses: ["HIST 32"],
    primary_crn: "44990",
    all_crns: ["44990"],
    title: "World Civilizations",
    division: "Social Sciences",
    modality: "Online",
    campus: "Online",
    meetings: [{ days: "XX", start_time: "12:00AM", end_time: "12:00AM", building: "ONLINE", room: "N/A" }],
    units: [3],
    pt_eligible: true,
    is_grouped: false,
  },
];

const initialLinks = [
  { disciplineId: "hist", facultyId: "f1", sent: true, lastAccess: "2027-05-03 10:15 AM", status: "submitted" },
  { disciplineId: "hist", facultyId: "f2", sent: true, lastAccess: "2027-05-04 1:40 PM", status: "logged_in_no_submission" },
  { disciplineId: "hist", facultyId: "f3", sent: true, lastAccess: null, status: "no_activity" },
  { disciplineId: "hist", facultyId: "f4", sent: true, lastAccess: "2027-05-05 9:12 AM", status: "submitted" },
  { disciplineId: "hist", facultyId: "f5", sent: true, lastAccess: "2027-05-06 3:02 PM", status: "submitted" },
];

const initialSubmissions = [
  {
    disciplineId: "hist",
    facultyId: "f1",
    submitted: true,
    submittedAt: "2027-05-03 10:18 AM",
    selections: ["grp_45678", "grp_44990"],
    generalInterests: ["HIST 18A", "HIST 32"],
  },
  {
    disciplineId: "hist",
    facultyId: "f4",
    submitted: true,
    submittedAt: "2027-05-05 9:15 AM",
    selections: ["grp_45110", "grp_45678", "grp_44990"],
    generalInterests: ["HIST 17A"],
  },
  {
    disciplineId: "hist",
    facultyId: "f5",
    submitted: true,
    submittedAt: "2027-05-06 3:06 PM",
    selections: ["grp_44990"],
    generalInterests: ["HIST 18A"],
  },
];

const initialAssignments = [
  { id: "a1", disciplineId: "hist", sectionId: "grp_45678", facultyId: "f1", status: "draft", assignedAt: "2027-05-10 09:10 AM" },
];

const initialDecisionLog = [
  { id: "d1", disciplineId: "hist", at: "2027-05-10 09:10 AM", actor: "Dr. Mason", type: "assigned", detail: "Assigned HIST 17A (CRN 45678) to Jordan Smith." },
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

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function normalize(s) {
  return String(s ?? "").trim();
}

function toFriendlyModality(value) {
  const v = normalize(value).toUpperCase();
  if (["ONS", "ONN", "ONC", "ONLINE", "DE", "IP"].includes(v)) return "Online";
  return v || "TBA";
}

function inferDisciplineIdFromSubjectCourse(subjectCourse, disciplines) {
  const subject = normalize(subjectCourse).split(" ")[0]?.toUpperCase() || "";
  const match = disciplines.find((d) => d.coveredSubjects.map((x) => x.toUpperCase()).includes(subject));
  return { disciplineId: match?.id || null, subjectCode: subject };
}

function parseScheduleCsv(file, disciplines, onSuccess, onError) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      try {
        const rows = results.data.map((row) => {
          const clean = {};
          Object.entries(row).forEach(([k, v]) => {
            if (!hiddenColumns.has(k)) clean[k] = v;
          });
          return { ...row, __clean: clean };
        });

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

        rows.forEach((row) => {
          const crn = normalize(row.CRN);
          if (!crn) return;
          ensureNode(crn);
          const cross = normalize(row.CROSS_LIST);
          const coreq = normalize(row.COREQUISITE_CRN);
          if (cross) {
            ensureNode(cross);
            graph.get(crn).add(cross);
            graph.get(cross).add(crn);
          }
          if (coreq) {
            ensureNode(coreq);
            graph.get(crn).add(coreq);
            graph.get(coreq).add(crn);
          }
        });

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
        const unmapped = [];
        let crossListedGroupCount = 0;
        let corequisiteGroupCount = 0;
        let multiRowCrnCount = 0;

        clusters.forEach((cluster) => {
          cluster.forEach((crn) => {
            if (!crnRows.has(crn)) {
              errors.push(`CRN ${crn} is referenced by CROSS_LIST or COREQUISITE_CRN but is missing from the upload.`);
            }
          });

          const bundleRows = cluster.flatMap((crn) => crnRows.get(crn) || []);
          const instructorValues = Array.from(new Set(bundleRows.map((r) => normalize(r.INSTRUCTOR)).filter(Boolean)));
          const allStaff = instructorValues.every((val) => val.toLowerCase() === "staff");
          if (!allStaff) {
            errors.push(`Bundle ${cluster.join(", ")} has mixed INSTRUCTOR values: ${instructorValues.join(", ") || "(blank)"}. Fix and reupload.`);
          }

          const hasCross = bundleRows.some((r) => normalize(r.CROSS_LIST));
          const hasCoreq = bundleRows.some((r) => normalize(r.COREQUISITE_CRN));
          if (hasCross) crossListedGroupCount += 1;
          if (hasCoreq) corequisiteGroupCount += 1;
          if (Array.from(new Set(bundleRows.map((r) => normalize(r.CRN)))).some((crn) => (crnRows.get(crn) || []).length > 1)) {
            multiRowCrnCount += 1;
          }
        });

        const parsedSections = clusters.map((cluster) => {
          const bundleRows = cluster.flatMap((crn) => crnRows.get(crn) || []);
          const first = bundleRows[0] || {};
          const meetings = [];
          const meetingSeen = new Set();

          bundleRows.forEach((row) => {
            const key = [normalize(row.DAYS), normalize(row.START_TIME), normalize(row.END_TIME), normalize(row.BUILDING), normalize(row.ROOM)].join("|");
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

          const allSubjectCourses = Array.from(new Set(bundleRows.map((r) => normalize(r.SUBJECT_COURSE)).filter(Boolean)));
          const allTitles = Array.from(new Set(bundleRows.map((r) => normalize(r.TITLE)).filter(Boolean)));
          const allUnits = Array.from(new Set(bundleRows.map((r) => Number(normalize(r.UNITS || r.HOURS || 0)) || 0))).filter((n) => n);
          const crossListGroup = Array.from(new Set(bundleRows.map((r) => normalize(r.CROSS_LIST)).filter(Boolean)));
          const coreqGroup = Array.from(new Set(bundleRows.map((r) => normalize(r.COREQUISITE_CRN)).filter(Boolean)));
          const { disciplineId, subjectCode } = inferDisciplineIdFromSubjectCourse(first.SUBJECT_COURSE, disciplines);

          if (!disciplineId) {
            unmapped.push(`${cluster.join(", ")} (${subjectCode || normalize(first.SUBJECT_COURSE) || "UNKNOWN SUBJECT"})`);
          }

          return {
            id: `grp_${cluster.join("_")}`,
            assignment_group_id: `grp_${cluster.join("_")}`,
            disciplineId,
            primary_subject_course: allSubjectCourses.join(" / ") || "Unknown",
            all_subject_courses: allSubjectCourses,
            primary_crn: cluster[0],
            all_crns: cluster,
            title: allTitles.join(" / ") || normalize(first.TITLE) || "Untitled",
            division: normalize(first.DIVISION),
            modality: toFriendlyModality(first.INSTRUCTIONAL_METHOD),
            campus: normalize(first.CAMPUS),
            meetings,
            units: allUnits,
            cross_list_group: crossListGroup.length ? cluster.filter((c) => crossListGroup.includes(c)) : null,
            corequisite_group: coreqGroup.length ? coreqGroup : null,
            pt_eligible: true,
            is_grouped: cluster.length > 1 || bundleRows.length > 1,
          };
        });

        if (unmapped.length) {
          errors.push(`${unmapped.length} assignment group(s) could not be mapped to a discipline: ${unmapped.slice(0, 10).join("; ")}${unmapped.length > 10 ? " ..." : ""}`);
        }

        if (errors.length) {
          onError(errors);
          return;
        }

        onSuccess({
          sections: parsedSections.filter((s) => s.disciplineId),
          summary: {
            totalRows: rows.length,
            totalCrns: crnRows.size,
            assignmentGroups: parsedSections.filter((s) => s.disciplineId).length,
            crossListedGroups: crossListedGroupCount,
            corequisiteGroups: corequisiteGroupCount,
            multiRowCrnGroups: multiRowCrnCount,
          },
        });
      } catch (error) {
        onError([error.message || "Unknown parser error"]);
      }
    },
    error: (error) => onError([error.message || "CSV parsing failed"]),
  });
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
  grid3: { display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr 1fr" },
  grid4: { display: "grid", gap: 16, gridTemplateColumns: "0.9fr 1.4fr 1fr" },
  gridSummary: { display: "grid", gap: 16, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" },
  sectionCard: { border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: 13 },
  td: { padding: "12px 8px", borderBottom: "1px solid #e2e8f0", fontSize: 14, verticalAlign: "top" },
  small: { fontSize: 12, color: "#64748b" },
};

export default function PTFacultyStaffingMVP() {
  const [role, setRole] = useState("admin");
  const [tab, setTab] = useState("dashboard");
  const [terms] = useState(initialTerms);
  const [disciplines, setDisciplines] = useState(initialDisciplines);
  const [faculty] = useState(initialFaculty);
  const [seniority] = useState(initialSeniority);
  const [sections, setSections] = useState(initialSections);
  const [uploadReport, setUploadReport] = useState({ errors: [], importedCount: 0, fileName: "", summary: null });
  const [uploadingSchedule, setUploadingSchedule] = useState(false);
  const [backendMessage, setBackendMessage] = useState("");
  const [links] = useState(initialLinks);
  const [submissions] = useState(initialSubmissions);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [decisionLog, setDecisionLog] = useState(initialDecisionLog);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState("hist");
  const [currentRank, setCurrentRank] = useState(2);
  const [selectedFacultyId, setSelectedFacultyId] = useState("f2");
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reasonDialog, setReasonDialog] = useState({ sectionId: null, facultyId: null, reason: "continuity" });
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [openForm, setOpenForm] = useState({ opensAt: "2027-05-01T09:00", closesAt: "2027-05-15T17:00" });
  const [facultyViewerId, setFacultyViewerId] = useState("f1");

  const activeTerm = terms.find((t) => t.active);
  const selectedDiscipline = disciplines.find((d) => d.id === selectedDisciplineId) || disciplines[0];

  const queue = useMemo(() => {
    return seniority
      .filter((s) => s.disciplineId === selectedDisciplineId && s.active)
      .sort((a, b) => a.rank - b.rank)
      .map((s) => {
        const f = faculty.find((x) => x.id === s.facultyId);
        const sub = submissions.find((x) => x.disciplineId === selectedDisciplineId && x.facultyId === s.facultyId);
        const facultyAssignments = assignments.filter((a) => a.disciplineId === selectedDisciplineId && a.facultyId === s.facultyId && a.status !== "released");
        let status = "Not Started";
        if (facultyAssignments.length > 0) status = "Completed";
        if (sub && sub.submitted && facultyAssignments.length === 0) status = "Current";
        if (s.rank < currentRank && facultyAssignments.length > 0) status = "Modified";
        if (s.facultyId === selectedFacultyId) status = "Current";
        return { ...s, faculty: f, submission: sub, assignments: facultyAssignments, status };
      });
  }, [selectedDisciplineId, seniority, faculty, submissions, assignments, currentRank, selectedFacultyId]);

  const currentFaculty = faculty.find((f) => f.id === selectedFacultyId) || faculty[0];
  const currentSubmission = submissions.find((s) => s.disciplineId === selectedDisciplineId && s.facultyId === selectedFacultyId);
  const currentSelections = (currentSubmission?.selections || []).map((id, index) => {
    const section = sections.find((s) => s.id === id);
    if (!section) return null;
    const assn = assignments.find((a) => a.sectionId === id && a.status !== "released");
    let status = "Available";
    if (assn && assn.facultyId !== selectedFacultyId) status = `Assigned to ${facultyName(faculty.find((f) => f.id === assn.facultyId))}`;
    if (assn && assn.facultyId === selectedFacultyId) status = "Assigned to current faculty";
    return { section, preference: index + 1, status };
  }).filter(Boolean);

  const remainingSections = sections.filter((s) => s.disciplineId === selectedDisciplineId && s.pt_eligible && !assignments.find((a) => a.sectionId === s.id && a.status !== "released"));
  const currentFacultyAssignments = assignments.filter((a) => a.disciplineId === selectedDisciplineId && a.facultyId === selectedFacultyId && a.status !== "released");

  const disciplineRows = disciplines.map((d) => {
    const eligible = seniority.filter((s) => s.disciplineId === d.id && s.active).length;
    const submitted = submissions.filter((s) => s.disciplineId === d.id && s.submitted).length;
    const openSections = sections.filter((s) => s.disciplineId === d.id && s.pt_eligible).length;
    const assignedCount = assignments.filter((a) => a.disciplineId === d.id && a.status !== "released").length;
    return { ...d, eligible, submitted, openSections, assignedCount };
  });

  const summary = {
    ready: disciplines.filter((d) => d.status === "ready").length,
    open: disciplines.filter((d) => d.status === "open").length,
    pending: disciplines.filter((d) => d.status === "chair_finalized").length,
    approved: disciplines.filter((d) => d.status === "dean_approved").length,
    submitted: submissions.filter((s) => s.submitted).length,
    noActivity: links.filter((l) => l.status === "no_activity").length,
  };

  async function handleScheduleUpload(file) {
    if (!file) return;

    setUploadingSchedule(true);
    setBackendMessage("");
    setUploadReport({ errors: [], importedCount: 0, fileName: file.name, summary: null });

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
          importedCount: 0,
          fileName: file.name,
          summary: data.summary || null,
        });
        setBackendMessage("Backend rejected the upload. Fix the issues and reupload.");
        return;
      }

      parseScheduleCsv(
        file,
        disciplines,
        (parsed) => {
          setSections(parsed.sections);
          setUploadReport({
            errors: [],
            importedCount: data.importedCount ?? parsed.sections.length,
            fileName: file.name,
            summary: data.summary || parsed.summary,
          });
          setBackendMessage("Schedule uploaded to backend successfully.");
        },
        (errors) => {
          setUploadReport({
            errors,
            importedCount: 0,
            fileName: file.name,
            summary: null,
          });
          setBackendMessage("Backend accepted the file, but local parsing failed.");
        }
      );
    } catch (error) {
      setUploadReport({
        errors: [error.message || "Unexpected upload error."],
        importedCount: 0,
        fileName: file.name,
        summary: null,
      });
      setBackendMessage("Could not reach the backend service.");
    } finally {
      setUploadingSchedule(false);
    }
  }

  const assignSection = (sectionId, targetFacultyId) => {
    const topAvailable = currentSelections.find((sel) => sel.status === "Available");
    if (targetFacultyId === selectedFacultyId && topAvailable && topAvailable.section.id !== sectionId) {
      setReasonDialog({ sectionId, facultyId: targetFacultyId, reason: "continuity" });
      setShowReasonModal(true);
      return;
    }
    finalizeAssignment(sectionId, targetFacultyId, null);
  };

  const finalizeAssignment = (sectionId, targetFacultyId, reason) => {
    const section = sections.find((s) => s.id === sectionId);
    const existing = assignments.find((a) => a.sectionId === sectionId && a.status !== "released");
    if (existing) return;
    const newAssignment = {
      id: `a${Date.now()}`,
      disciplineId: selectedDisciplineId,
      sectionId,
      facultyId: targetFacultyId,
      status: selectedDiscipline.status === "dean_approved" ? "approved" : "draft",
      assignedAt: new Date().toLocaleString(),
    };
    setAssignments((prev) => [...prev, newAssignment]);
    setDecisionLog((prev) => [
      {
        id: `d${Date.now()}`,
        disciplineId: selectedDisciplineId,
        at: new Date().toLocaleString(),
        actor: role === "chair" ? selectedDiscipline.chair : role === "dean" ? selectedDiscipline.dean : "Scheduler/Admin",
        type: reason ? "bypassed_preference" : "assigned",
        detail: reason
          ? `${facultyName(faculty.find((f) => f.id === targetFacultyId))} assigned ${section.primary_subject_course} (${section.all_crns.join(", ")}) with rationale: ${reason}.`
          : `${facultyName(faculty.find((f) => f.id === targetFacultyId))} assigned ${section.primary_subject_course} (${section.all_crns.join(", ")}).`,
      },
      ...prev,
    ]);
  };

  const removeAssignment = (assignmentId) => {
    const assn = assignments.find((a) => a.id === assignmentId);
    const sec = sections.find((s) => s.id === assn.sectionId);
    setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, status: "released" } : a)));
    setDecisionLog((prev) => [
      {
        id: `d${Date.now()}`,
        disciplineId: selectedDisciplineId,
        at: new Date().toLocaleString(),
        actor: role === "chair" ? selectedDiscipline.chair : "Scheduler/Admin",
        type: "removed",
        detail: `${sec.primary_subject_course} (${sec.all_crns.join(", ")}) released back to pool.`,
      },
      ...prev,
    ]);
  };

  const completeFaculty = () => {
    const next = queue.find((q) => q.rank > currentRank);
    if (next) {
      setCurrentRank(next.rank);
      setSelectedFacultyId(next.faculty.id);
    }
  };

  const openDiscipline = () => {
    setDisciplines((prev) => prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "open", opensAt: openForm.opensAt, closesAt: openForm.closesAt } : d)));
    setShowOpenModal(false);
  };

  const closeDiscipline = () => setDisciplines((prev) => prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "closed" } : d)));
  const startStaffing = () => setDisciplines((prev) => prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "staffing_in_progress" } : d)));
  const chairFinalize = () => setDisciplines((prev) => prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "chair_finalized" } : d)));
  const deanApprove = () => {
    setDisciplines((prev) => prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "dean_approved" } : d)));
    setAssignments((prev) => prev.map((a) => (a.disciplineId === selectedDisciplineId && a.status !== "released" ? { ...a, status: "approved" } : a)));
  };
  const deanReturn = () => setDisciplines((prev) => prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "staffing_in_progress" } : d)));

  const exportNonResponders = () => {
    const rows = [["Discipline", "Faculty", "Employee ID", "Email", "Status", "Last Access"]];
    links
      .filter((l) => l.disciplineId === selectedDisciplineId && l.status !== "submitted")
      .forEach((l) => {
        const f = faculty.find((x) => x.id === l.facultyId);
        rows.push([selectedDiscipline.code, facultyName(f), f.employeeId, f.email, l.status, l.lastAccess || ""]);
      });
    downloadCsv(`${selectedDiscipline.code}_non_responders.csv`, rows);
  };

  const exportBanner = () => {
    const rows = [["Term", "Discipline", "CRNs", "Primary Subject Course", "Title", "Faculty", "Employee ID", "Status"]];
    assignments
      .filter((a) => a.disciplineId === selectedDisciplineId && a.status !== "released")
      .forEach((a) => {
        const sec = sections.find((s) => s.id === a.sectionId);
        const fac = faculty.find((f) => f.id === a.facultyId);
        rows.push([activeTerm.code, selectedDiscipline.code, sec.all_crns.join(" + "), sec.primary_subject_course, sec.title, facultyName(fac), fac.employeeId, a.status]);
      });
    downloadCsv(`${selectedDiscipline.code}_banner_export.csv`, rows);
  };

  const previewFacultySubmission = submissions.find((s) => s.disciplineId === selectedDisciplineId && s.facultyId === facultyViewerId);

  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={ui.between}>
          <div>
            <h1 style={{ fontSize: 32, margin: 0 }}>PT Faculty Staffing MVP</h1>
            <div style={ui.cardDesc}>GitHub-friendly version with plain React elements, grouped schedule parser, strict upload validation, guided staffing, and dean approval.</div>
          </div>
          <div style={ui.row}>
            <select style={ui.select} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Scheduler / Admin</option>
              <option value="chair">Chair</option>
              <option value="dean">Dean</option>
              <option value="faculty">PT Faculty</option>
            </select>
            <span style={{ ...ui.badge("open"), background: "#0f172a", color: "white" }}>{activeTerm.name}</span>
          </div>
        </div>

        {role === "admin" && (
          <div style={ui.card}>
            <div style={ui.row}>
              <button style={tab === "dashboard" ? ui.btnPrimary : ui.btn} onClick={() => setTab("dashboard")}>Dashboard</button>
              <button style={tab === "discipline" ? ui.btnPrimary : ui.btn} onClick={() => setTab("discipline")}>Discipline Detail</button>
              <button style={tab === "preview" ? ui.btnPrimary : ui.btn} onClick={() => setTab("preview")}>Preview as Faculty</button>
            </div>
          </div>
        )}

        {role === "admin" && tab === "dashboard" && (
          <>
            <div style={ui.gridSummary}>
              <SummaryCard title="Ready" value={summary.ready} />
              <SummaryCard title="Open" value={summary.open} />
              <SummaryCard title="Pending Dean" value={summary.pending} />
              <SummaryCard title="Approved" value={summary.approved} />
              <SummaryCard title="Submitted" value={summary.submitted} />
              <SummaryCard title="No Activity" value={summary.noActivity} />
            </div>

            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Schedule Upload</h2>
              <div style={ui.cardDesc}>Upload a division CSV. The parser collapses same-CRN rows, bundles cross-listed and corequisite sections, and blocks invalid bundles.</div>
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
                <div style={{ marginTop: 12, color: "#475569", fontWeight: 700 }}>Uploading schedule to backend...</div>
              ) : null}

              {backendMessage ? (
                <div style={{ marginTop: 12, color: backendMessage.includes("successfully") ? "#166534" : "#b91c1c", fontWeight: 700 }}>
                  {backendMessage}
                </div>
              ) : null}

              {uploadReport.fileName ? (
                <div style={{ ...ui.sectionCard, marginTop: 16 }}>
                  <div style={{ fontWeight: 700 }}>Latest upload: {uploadReport.fileName}</div>
                  {uploadReport.errors.length ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ color: "#b91c1c", fontWeight: 700 }}>Upload blocked. Fix and reupload.</div>
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {uploadReport.errors.map((err, idx) => <div key={idx} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 10, color: "#b91c1c" }}>{err}</div>)}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ color: "#166534", fontWeight: 700 }}>Validation passed. {uploadReport.importedCount} assignment groups parsed.</div>
                      {uploadReport.summary ? (
                        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(6, minmax(0, 1fr))", marginTop: 12 }}>
                          <TinyStat label="Rows" value={uploadReport.summary.totalRows} />
                          <TinyStat label="Unique CRNs" value={uploadReport.summary.totalCrns} />
                          <TinyStat label="Assignment Groups" value={uploadReport.summary.assignmentGroups} />
                          <TinyStat label="Cross-Listed" value={uploadReport.summary.crossListedGroups} />
                          <TinyStat label="Corequisite" value={uploadReport.summary.corequisiteGroups} />
                          <TinyStat label="Multi-row CRNs" value={uploadReport.summary.multiRowCrnGroups} />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Discipline Control Table</h2>
              <div style={ui.cardDesc}>One row per discipline, even when schedule data was uploaded by division.</div>
              <div style={{ overflowX: "auto", marginTop: 16 }}>
                <table style={ui.table}>
                  <thead>
                    <tr>
                      <th style={ui.th}>Discipline</th>
                      <th style={ui.th}>Division</th>
                      <th style={ui.th}>Covered Codes</th>
                      <th style={ui.th}>Status</th>
                      <th style={ui.th}>Responses</th>
                      <th style={ui.th}>Assignments</th>
                      <th style={ui.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disciplineRows.map((d) => (
                      <tr key={d.id}>
                        <td style={ui.td}><strong>{d.code}</strong></td>
                        <td style={ui.td}>{d.division}</td>
                        <td style={ui.td}>{d.coveredSubjects.join(", ")}</td>
                        <td style={ui.td}><span style={ui.badge(d.status)}>{statusLabel(d.status)}</span></td>
                        <td style={ui.td}>{d.submitted}/{d.eligible}</td>
                        <td style={ui.td}>{d.assignedCount}/{d.openSections}</td>
                        <td style={ui.td}><button style={selectedDisciplineId === d.id ? ui.btnPrimary : ui.btn} onClick={() => setSelectedDisciplineId(d.id)}>View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {role === "admin" && tab === "discipline" && (
          <div style={ui.grid3}>
            <div style={ui.card}>
              <h2 style={ui.cardTitle}>{selectedDiscipline.code} Discipline Detail</h2>
              <div style={ui.cardDesc}>{selectedDiscipline.division} • Chair: {selectedDiscipline.chair} • Dean: {selectedDiscipline.dean}</div>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
                <InfoRow label="Covered subject codes" value={selectedDiscipline.coveredSubjects.join(", ")} />
                <InfoRow label="Status" value={statusLabel(selectedDiscipline.status)} />
                <InfoRow label="Open date" value={selectedDiscipline.opensAt || "—"} />
                <InfoRow label="Close date" value={selectedDiscipline.closesAt || "—"} />
              </div>
              <div style={{ ...ui.row, marginTop: 16 }}>
                <button style={ui.btnPrimary} onClick={() => setShowOpenModal(true)}>Open Discipline</button>
                <button style={ui.btn} onClick={closeDiscipline}>Close Discipline</button>
                <button style={ui.btn} onClick={startStaffing}>Start Staffing</button>
                <button style={ui.btn} onClick={exportNonResponders}>Non-Responders</button>
                <button style={ui.btn} onClick={exportBanner}>Banner Export</button>
              </div>
            </div>

            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Faculty Activity</h2>
              <div style={ui.cardDesc}>Persistent link tracking and response status.</div>
              <div style={{ display: "grid", gap: 12, marginTop: 16, maxHeight: 420, overflow: "auto" }}>
                {links.filter((l) => l.disciplineId === selectedDisciplineId).map((link) => {
                  const f = faculty.find((x) => x.id === link.facultyId);
                  return (
                    <div key={link.facultyId} style={ui.sectionCard}>
                      <div style={ui.between}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{facultyName(f)}</div>
                          <div style={ui.small}>{f.employeeId} • {f.email}</div>
                        </div>
                        <span style={ui.badge("closed")}>{link.status.replaceAll("_", " ")}</span>
                      </div>
                      <div style={{ ...ui.row, marginTop: 12 }}>
                        <button style={ui.btn}>Resend</button>
                        <button style={ui.btn}>Regenerate</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Sections in Discipline</h2>
              <div style={ui.cardDesc}>Grouped assignment units only.</div>
              <div style={{ display: "grid", gap: 12, marginTop: 16, maxHeight: 420, overflow: "auto" }}>
                {sections.filter((s) => s.disciplineId === selectedDisciplineId).map((sec) => <SectionCard key={sec.id} section={sec} />)}
              </div>
            </div>
          </div>
        )}

        {role === "admin" && tab === "preview" && (
          <div style={ui.card}>
            <h2 style={ui.cardTitle}>Preview as Faculty</h2>
            <div style={ui.cardDesc}>See exactly what a faculty member can see for the selected discipline.</div>
            <div style={{ marginTop: 16 }}>
              <select style={ui.select} value={facultyViewerId} onChange={(e) => setFacultyViewerId(e.target.value)}>
                {queue.map((q) => <option key={q.faculty.id} value={q.faculty.id}>{facultyName(q.faculty)}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 16 }}>
              <FacultyView discipline={selectedDiscipline} faculty={faculty.find((f) => f.id === facultyViewerId)} submission={previewFacultySubmission} visibleSections={sections.filter((s) => s.disciplineId === selectedDisciplineId && s.pt_eligible)} />
            </div>
          </div>
        )}

        {role === "chair" && (
          <>
            <div style={ui.card}>
              <h2 style={ui.cardTitle}>Chair Worklist</h2>
              <div style={ui.cardDesc}>Only disciplines assigned to this chair are shown.</div>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 16 }}>
                {disciplines.filter((d) => d.chair === "Dr. Mason").map((d) => (
                  <button key={d.id} onClick={() => setSelectedDisciplineId(d.id)} style={{ ...ui.sectionCard, textAlign: "left", background: selectedDisciplineId === d.id ? "#0f172a" : "#fff", color: selectedDisciplineId === d.id ? "#fff" : "#0f172a" }}>
                    <div style={ui.between}>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{d.code}</div>
                      <span style={{ ...ui.badge(d.status), color: selectedDisciplineId === d.id ? "#fff" : undefined }}>{statusLabel(d.status)}</span>
                    </div>
                    <div style={{ ...ui.small, color: selectedDisciplineId === d.id ? "#cbd5e1" : ui.small.color, marginTop: 8 }}>{d.division}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={ui.grid4}>
              <div style={ui.card}>
                <h2 style={ui.cardTitle}>Seniority Queue</h2>
                <div style={ui.cardDesc}>Strict order, with review of earlier decisions allowed before finalization.</div>
                <div style={{ display: "grid", gap: 10, marginTop: 16, maxHeight: 560, overflow: "auto" }}>
                  {queue.map((q) => (
                    <button key={q.faculty.id} onClick={() => setSelectedFacultyId(q.faculty.id)} style={{ ...ui.sectionCard, textAlign: "left", background: selectedFacultyId === q.faculty.id ? "#0f172a" : "#fff", color: selectedFacultyId === q.faculty.id ? "#fff" : "#0f172a" }}>
                      <div style={ui.between}>
                        <div style={{ fontWeight: 700 }}>#{q.rank} {facultyName(q.faculty)}</div>
                        <span style={selectedFacultyId === q.faculty.id ? { ...ui.badge("open"), color: "#fff" } : ui.badge("closed")}>{q.status}</span>
                      </div>
                      <div style={{ ...ui.small, color: selectedFacultyId === q.faculty.id ? "#cbd5e1" : ui.small.color, marginTop: 6 }}>{q.submission?.submitted ? `Submitted ${q.submission.submittedAt}` : "No submission yet"}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={ui.card}>
                <h2 style={ui.cardTitle}>Current Faculty Review</h2>
                <div style={ui.cardDesc}>One combined card per selectable assignment unit, even when multiple CRNs move together.</div>
                <div style={{ ...ui.sectionCard, marginTop: 16, background: "#f8fafc" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>Rank #{queue.find((q) => q.faculty.id === selectedFacultyId)?.rank} – {facultyName(currentFaculty)}</div>
                  <div style={{ ...ui.small, marginTop: 6 }}>Employee ID: {currentFaculty.employeeId} • Response: {currentSubmission?.submitted ? "Submitted" : "No submission"}</div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div style={ui.between}>
                    <h3 style={{ margin: 0 }}>Ranked Section Selections</h3>
                    <span style={ui.badge("closed")}>{currentSelections.length} selected</span>
                  </div>
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {currentSelections.length === 0 && <div style={{ ...ui.sectionCard, color: "#64748b" }}>No submitted section choices for this faculty member.</div>}
                    {currentSelections.map((sel) => (
                      <SectionCard key={sel.section.id} section={sel.section} status={sel.status} preference={sel.preference} action={sel.status === "Available" ? <button style={ui.btnPrimary} onClick={() => assignSection(sel.section.id, selectedFacultyId)}>Assign</button> : null} />
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <h3 style={{ margin: 0 }}>Current Draft Assignments</h3>
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {currentFacultyAssignments.length === 0 && <div style={{ ...ui.sectionCard, color: "#64748b" }}>Nothing assigned yet.</div>}
                    {currentFacultyAssignments.map((a) => {
                      const sec = sections.find((s) => s.id === a.sectionId);
                      return <SectionCard key={a.id} section={sec} status="Assigned" action={<button style={ui.btn} onClick={() => removeAssignment(a.id)}>Remove</button>} />;
                    })}
                  </div>
                </div>

                <div style={{ ...ui.row, marginTop: 20 }}>
                  <button style={ui.btnPrimary} onClick={completeFaculty}>Complete Faculty</button>
                  <button style={ui.btn}>Save Draft</button>
                  {(selectedDiscipline.status === "closed" || selectedDiscipline.status === "staffing_in_progress") ? <button style={ui.btn} onClick={chairFinalize}>Finalize for Dean</button> : null}
                </div>
              </div>

              <div style={ui.card}>
                <h2 style={ui.cardTitle}>Remaining Open Sections</h2>
                <div style={ui.cardDesc}>Grouped bundles only, with linked CRNs moving together.</div>
                <div style={{ ...ui.sectionCard, marginTop: 16, background: "#f8fafc", color: "#475569" }}>Search and filters can be expanded in the production build.</div>
                <div style={{ display: "grid", gap: 12, marginTop: 16, maxHeight: 540, overflow: "auto" }}>
                  {remainingSections.map((sec) => <SectionCard key={sec.id} section={sec} action={<button style={ui.btn} onClick={() => assignSection(sec.id, selectedFacultyId)}>Assign to Current Faculty</button>} />)}
                </div>
              </div>
            </div>
          </>
        )}

        {role === "dean" && (
          <div style={ui.card}>
            <h2 style={ui.cardTitle}>Dean Approval Review</h2>
            <div style={ui.cardDesc}>Review staffing summary, flag exceptions, approve or return to chair.</div>
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginTop: 16 }}>
              <Metric label="Sections staffed" value={assignments.filter((a) => a.disciplineId === selectedDisciplineId && a.status !== "released").length} />
              <Metric label="Submitted" value={submissions.filter((s) => s.disciplineId === selectedDisciplineId && s.submitted).length} />
              <Metric label="No activity" value={links.filter((l) => l.disciplineId === selectedDisciplineId && l.status === "no_activity").length} />
              <Metric label="Exceptions logged" value={decisionLog.filter((d) => d.disciplineId === selectedDisciplineId && d.type === "bypassed_preference").length} />
            </div>
            <div style={{ ...ui.sectionCard, marginTop: 16 }}>
              <div style={ui.small}>Status</div>
              <div style={{ marginTop: 8 }}>
                <span style={ui.badge(selectedDiscipline.status)}>{statusLabel(selectedDiscipline.status)}</span>
                <span style={{ ...ui.small, marginLeft: 10 }}>{selectedDiscipline.status === "chair_finalized" ? "Ready for approval." : "Chair must finalize before approval."}</span>
              </div>
            </div>
            <div style={{ ...ui.row, marginTop: 16 }}>
              <button style={selectedDiscipline.status === "chair_finalized" ? ui.btnPrimary : { ...ui.btn, opacity: 0.5, cursor: "not-allowed" }} disabled={selectedDiscipline.status !== "chair_finalized"} onClick={deanApprove}>Approve Staffing</button>
              <button style={selectedDiscipline.status === "chair_finalized" ? ui.btn : { ...ui.btn, opacity: 0.5, cursor: "not-allowed" }} disabled={selectedDiscipline.status !== "chair_finalized"} onClick={deanReturn}>Return to Chair</button>
            </div>
          </div>
        )}

        {role === "faculty" && (
          <FacultyView discipline={selectedDiscipline} faculty={faculty.find((f) => f.id === facultyViewerId)} submission={previewFacultySubmission} visibleSections={selectedDiscipline.status === "open" ? sections.filter((s) => s.disciplineId === selectedDisciplineId && s.pt_eligible) : []} />
        )}
      </div>

      {showReasonModal && (
        <Modal title="Reason required for bypassing higher-ranked preference" onClose={() => setShowReasonModal(false)}>
          <div style={ui.cardDesc}>§2(c) discretion is allowed, but the rationale should be logged.</div>
          <div style={{ marginTop: 16 }}>
            <select style={{ ...ui.select, width: "100%" }} value={reasonDialog.reason} onChange={(e) => setReasonDialog((prev) => ({ ...prev, reason: e.target.value }))}>
              <option value="continuity">Continuity of instruction</option>
              <option value="subject_matter_expertise">Subject matter expertise</option>
              <option value="modality_experience">Experience in modality</option>
              <option value="best_interest_of_students">Best interest of students</option>
              <option value="enrollment_program_needs">Enrollment/program needs</option>
              <option value="scheduling_conflict">Scheduling conflict</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div style={{ ...ui.row, marginTop: 16 }}>
            <button style={ui.btn} onClick={() => setShowReasonModal(false)}>Cancel</button>
            <button
              style={ui.btnPrimary}
              onClick={() => {
                finalizeAssignment(reasonDialog.sectionId, reasonDialog.facultyId, reasonDialog.reason);
                setShowReasonModal(false);
              }}
            >
              Log Reason and Assign
            </button>
          </div>
        </Modal>
      )}

      {showOpenModal && (
        <Modal title="Open Discipline Window" onClose={() => setShowOpenModal(false)}>
          <div style={ui.cardDesc}>Set exact open and close times, then send persistent links to eligible faculty.</div>
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <div>
              <label style={{ ...ui.small, display: "block", marginBottom: 6 }}>Open date and time</label>
              <input style={ui.input} type="datetime-local" value={openForm.opensAt} onChange={(e) => setOpenForm((p) => ({ ...p, opensAt: e.target.value }))} />
            </div>
            <div>
              <label style={{ ...ui.small, display: "block", marginBottom: 6 }}>Close date and time</label>
              <input style={ui.input} type="datetime-local" value={openForm.closesAt} onChange={(e) => setOpenForm((p) => ({ ...p, closesAt: e.target.value }))} />
            </div>
            <label style={{ ...ui.sectionCard, display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" defaultChecked />
              <span style={ui.small}>Seniority and schedule data have been verified.</span>
            </label>
          </div>
          <div style={{ ...ui.row, marginTop: 16 }}>
            <button style={ui.btn} onClick={() => setShowOpenModal(false)}>Cancel</button>
            <button style={ui.btnPrimary} onClick={openDiscipline}>Open Discipline</button>
          </div>
        </Modal>
      )}
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

function InfoRow({ label, value }) {
  return (
    <div style={ui.sectionCard}>
      <div style={{ ...ui.small, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 8, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={ui.sectionCard}>
      <div style={ui.small}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function TinyStat({ label, value }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
      <div style={{ ...ui.small, textTransform: "uppercase" }}>{label}</div>
      <div style={{ marginTop: 6, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SectionCard({ section, status, action, preference }) {
  const meetingSummary = section.meetings.map((m) => `${m.days} ${m.start_time}-${m.end_time}${m.building ? ` • ${m.building}` : ""}${m.room ? ` ${m.room}` : ""}`).join("; ");
  return (
    <div style={ui.sectionCard}>
      <div style={ui.between}>
        <div>
          <div style={{ fontWeight: 700 }}>
            {preference ? `#${preference} • ` : ""}
            {section.primary_subject_course}
            {section.is_grouped ? ` • CRNs ${section.all_crns.join(" + ")}` : ` • CRN ${section.primary_crn}`}
          </div>
          <div style={{ ...ui.small, marginTop: 6 }}>{section.title}</div>
          <div style={{ ...ui.small, marginTop: 6 }}>{meetingSummary || "Meeting details TBD"}</div>
          <div style={{ ...ui.small, marginTop: 6 }}>{section.modality} • {section.campus}</div>
        </div>
        {status ? <span style={ui.badge("closed")}>{status}</span> : null}
      </div>
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

function FacultyView({ discipline, faculty, submission, visibleSections }) {
  const selectionCount = submission?.selections?.length || 0;
  const selectedCards = (submission?.selections || []).map((id) => visibleSections.find((s) => s.id === id)).filter(Boolean);
  return (
    <div style={ui.card}>
      <h2 style={ui.cardTitle}>Faculty Portal View</h2>
      <div style={ui.cardDesc}>One card per selectable assignment unit. Linked CRNs are shown together to reduce confusion.</div>
      <div style={{ ...ui.sectionCard, marginTop: 16, background: "#f8fafc" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{faculty ? facultyName(faculty) : "No faculty selected"}</div>
        <div style={{ ...ui.small, marginTop: 6 }}>Discipline: {discipline.code} • Window status: {statusLabel(discipline.status)}</div>
      </div>

      {discipline.status === "open" ? (
        <>
          <div style={{ ...ui.between, marginTop: 16 }}>
            <h3 style={{ margin: 0 }}>Selectable Sections</h3>
            <span style={ui.badge("closed")}>{visibleSections.length} visible</span>
          </div>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {visibleSections.map((sec) => <SectionCard key={sec.id} section={sec} />)}
          </div>
        </>
      ) : null}

      <div style={{ ...ui.between, marginTop: 20 }}>
        <h3 style={{ margin: 0 }}>My Saved Selections</h3>
        <span style={ui.badge("closed")}>{selectionCount} selected</span>
      </div>
      {!submission?.submitted && <div style={{ ...ui.sectionCard, marginTop: 12, color: "#64748b" }}>No saved submission record yet.</div>}
      {submission?.submitted && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={ui.sectionCard}>
            <div style={ui.small}>Submitted {submission.submittedAt}</div>
          </div>
          {selectedCards.length ? selectedCards.map((sec, i) => <SectionCard key={sec.id} section={sec} preference={i + 1} />) : (
            <div style={{ ...ui.sectionCard, color: "#64748b" }}>Selections remain visible after close, but the full schedule disappears from view.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ ...ui.card, width: 560, maxWidth: "100%" }}>
        <div style={ui.between}>
          <h2 style={{ ...ui.cardTitle, fontSize: 22 }}>{title}</h2>
          <button style={ui.btn} onClick={onClose}>Close</button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}
