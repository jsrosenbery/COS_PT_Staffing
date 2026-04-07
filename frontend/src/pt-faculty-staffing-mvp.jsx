const API_BASE = "https://cos-pt-staffing.onrender.com";
import React, { useMemo, useState } from "react";
import Papa from "papaparse";

const initialTerms = [{ id: "fa27", code: "FA27", name: "Fall 2027", active: true }];

const initialDisciplines = [
  { id: "hist", code: "HIST", name: "History", division: "Social Sciences", coveredSubjects: ["HIST"], status: "open", opensAt: "2027-05-01T09:00", closesAt: "2027-05-15T17:00", chair: "Dr. Mason", dean: "Dean Alvarez" },
  { id: "math", code: "MATH", name: "Mathematics", division: "Math/Science", coveredSubjects: ["MATH", "STAT"], status: "ready", opensAt: "", closesAt: "", chair: "Dr. Shah", dean: "Dean Kim" },
  { id: "pols", code: "POLS", name: "Political Science", division: "Social Sciences", coveredSubjects: ["POLS"], status: "blocked", opensAt: "", closesAt: "", chair: "Dr. Mason", dean: "Dean Alvarez" },
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
              errors.push(`CRN ${crn} is referenced by COREQUISITE_CRN but is missing from the upload.`);
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
          const crossListCodes = Array.from(new Set(bundleRows.map((r) => normalize(r.CROSS_LIST)).filter(Boolean)));
          const coreqGroup = Array.from(new Set(bundleRows.map((r) => normalize(r.COREQUISITE_CRN)).filter(Boolean)));
          const { disciplineId, subjectCode } = inferDisciplineIdFromSubjectCourse(first.SUBJECT_COURSE, disciplines);

          if (!disciplineId) {
            warnings.push(`Unmapped subject ${subjectCode || normalize(first.SUBJECT_COURSE) || "UNKNOWN SUBJECT"} for CRN group ${cluster.join(", ")}`);
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
        onError({ errors: [error.message || "Unknown parser error"], warnings: [], summary: null });
      }
    },
    error: (error) => onError({ errors: [error.message || "CSV parsing failed"], warnings: [], summary: null }),
  });
}

// keep the rest of your UI/state code as-is, but update the upload state shape and upload handler:
