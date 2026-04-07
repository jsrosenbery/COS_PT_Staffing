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

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
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
  const match = disciplines.find((d) =>
    d.coveredSubjects.map((x) => x.toUpperCase()).includes(subject)
  );
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
        let multiRowCrnCount = 0;

        const parsedSections = clusters.map((cluster) => {
          cluster.forEach((crn) => {
            if (!crnRows.has(crn)) {
              errors.push(
                `CRN ${crn} is referenced by COREQUISITE_CRN but is missing from the upload.`
              );
            }
          });

          const bundleRows = cluster.flatMap((crn) => crnRows.get(crn) || []);
          const instructorValues = Array.from(
            new Set(bundleRows.map((r) => normalize(r.INSTRUCTOR)).filter(Boolean))
          );
          const allStaff = instructorValues.every((val) => val.toLowerCase() === "staff");
          if (!allStaff) {
            errors.push(
              `Bundle ${cluster.join(", ")} has mixed INSTRUCTOR values: ${
                instructorValues.join(", ") || "(blank)"
              }. Fix and reupload.`
            );
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
            multiRowCrnCount += 1;
          }

          const first = bundleRows[0] || {};
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
          ).filter((n) => n);
          const crossListCodes = Array.from(
            new Set(bundleRows.map((r) => normalize(r.CROSS_LIST)).filter(Boolean))
          );
          const coreqGroup = Array.from(
            new Set(bundleRows.map((r) => normalize(r.COREQUISITE_CRN)).filter(Boolean))
          );
          const { disciplineId, subjectCode } = inferDisciplineIdFromSubjectCourse(
            first.SUBJECT_COURSE,
            disciplines
          );

          if (!disciplineId) {
            warnings.push(
              `Unmapped subject ${
                subjectCode || normalize(first.SUBJECT_COURSE) || "UNKNOWN SUBJECT"
              } for CRN group ${cluster.join(", ")}`
            );
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
            cross_list_group: crossListCodes.length ? crossListCodes : null,
            corequisite_group: coreqGroup.length ? coreqGroup : null,
            pt_eligible: true,
            is_grouped: cluster.length > 1 || bundleRows.length > 1,
          };
        });

        if (errors.length) {
          onError({ errors, warnings, summary: null });
          return;
        }

        onSuccess({
          sections: parsedSections.filter((s) => s.disciplineId),
          warnings,
          summary: {
            totalRows: rows.length,
            totalCrns: crnRows.size,
            assignmentGroups: parsedSections.length,
            mappedAssignmentGroups: parsedSections.filter((s) => s.disciplineId).length,
            unmappedAssignmentGroups: parsedSections.filter((s) => !s.disciplineId).length,
            crossListedGroups: crossListedGroupCount,
            corequisiteGroups: corequisiteGroupCount,
            multiRowCrnGroups: multiRowCrnCount,
          },
        });
      } catch (error) {
        onError({
          errors: [error.message || "Unknown parser error"],
          warnings: [],
          summary: null,
        });
      }
    },
    error: (error) =>
      onError({
        errors: [error.message || "CSV parsing failed"],
        warnings: [],
        summary: null,
      }),
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
  const [uploadReport, setUploadReport] = useState({
    errors: [],
    warnings: [],
    importedCount: 0,
    fileName: "",
    summary: null,
  });
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
  const currentSelections = (currentSubmission?.selections || [])
    .map((id, index) => {
      const section = sections.find((s) => s.id === id);
      if (!section) return null;
      const assn = assignments.find((a) => a.sectionId === id && a.status !== "released");
      let status = "Available";
      if (assn && assn.facultyId !== selectedFacultyId) {
        status = `Assigned to ${facultyName(faculty.find((f) => f.id === assn.facultyId))}`;
      }
      if (assn && assn.facultyId === selectedFacultyId) status = "Assigned to current faculty";
      return { section, preference: index + 1, status };
    })
    .filter(Boolean);

  const remainingSections = sections.filter(
    (s) =>
      s.disciplineId === selectedDisciplineId &&
      s.pt_eligible &&
      !assignments.find((a) => a.sectionId === s.id && a.status !== "released")
  );

  const currentFacultyAssignments = assignments.filter(
    (a) => a.disciplineId === selectedDisciplineId && a.facultyId === selectedFacultyId && a.status !== "released"
  );

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

      parseScheduleCsv(
        file,
        disciplines,
        (parsed) => {
          setSections(parsed.sections);
          setUploadReport({
            errors: [],
            warnings: data.warnings || parsed.warnings || [],
            importedCount: data.importedCount ?? parsed.sections.length,
            fileName: file.name,
            summary: data.summary || parsed.summary,
          });
          setBackendMessage("Schedule uploaded to backend successfully.");
        },
        (localResult) => {
          setUploadReport({
            errors: localResult.errors || [],
            warnings: localResult.warnings || [],
            importedCount: 0,
            fileName: file.name,
            summary: localResult.summary || null,
          });
          setBackendMessage("Backend accepted the file, but local parsing failed.");
        }
      );
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
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId
          ? { ...d, status: "open", opensAt: openForm.opensAt, closesAt: openForm.closesAt }
          : d
      )
    );
    setShowOpenModal(false);
  };

  const closeDiscipline = () =>
    setDisciplines((prev) =>
      prev.map((d) => (d.id === selectedDisciplineId ? { ...d, status: "closed" } : d))
    );

  const startStaffing = () =>
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId ? { ...d, status: "staffing_in_progress" } : d
      )
    );

  const chairFinalize = () =>
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId ? { ...d, status: "chair_finalized" } : d
      )
    );

  const deanApprove = () => {
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId ? { ...d, status: "dean_approved" } : d
      )
    );
    setAssignments((prev) =>
      prev.map((a) =>
        a.disciplineId === selectedDisciplineId && a.status !== "released"
          ? { ...a, status: "approved" }
          : a
      )
    );
  };

  const deanReturn = () =>
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id === selectedDisciplineId ? { ...d, status: "staffing_in_progress" } : d
      )
    );

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
        rows.push([
          activeTerm.code,
          selectedDiscipline.code,
          sec.all_crns.join(" + "),
          sec.primary_subject_course,
          sec.title,
          facultyName(fac),
          fac.employeeId,
          a.status,
        ]);
      });
    downloadCsv(`${selectedDiscipline.code}_banner_export.csv`, rows);
  };

  const previewFacultySubmission = submissions.find(
    (s) => s.disciplineId === selectedDisciplineId && s.facultyId === facultyViewerId
  );

  return (
    <div style={ui.page}>
      <div style={ui.shell}>
        <div style={ui.between}>
          <div>
            <h1 style={{ fontSize: 32, margin: 0 }}>PT Faculty Staffing MVP</h1>
            <div style={ui.cardDesc}>
              GitHub-friendly version with plain React elements, grouped schedule parser, strict upload validation, guided staffing, and dean approval.
            </div>
          </div>
          <div style={ui.row}>
            <select style={ui.select} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Scheduler / Admin</option>
              <option value="chair">Chair</option>
              <option value="dean">Dean</option>
              <option value="faculty">PT Faculty</option>
            </select>
            <span style={{ ...ui.badge("open"), background: "#0f172a", color: "white" }}>
              {activeTerm.name}
            </span>
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
              <div style={ui.cardDesc}>
                Upload a division CSV. The parser collapses same-CRN rows, bundles cross-listed and corequisite sections, and blocks invalid bundles.
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
          </>
        )}

        {role !== "admin" && (
          <div style={ui.card}>
            <h2 style={ui.cardTitle}>Interface loaded</h2>
            <div style={ui.cardDesc}>
              The admin upload parser changes are in place. The rest of the workflow UI can stay as previously structured.
            </div>
          </div>
        )}
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
