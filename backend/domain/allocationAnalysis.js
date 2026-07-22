const DEFAULT_EXCEPTION_CODES = [
  "continuity",
  "dual_enrollment_positioned",
  "configured_contractual_exception",
];

function text(value) {
  return String(value ?? "").trim();
}

function numericRank(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value) {
  const parsed = numericRank(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function personId(row = {}) {
  return text(row.employee_id || row.faculty_id || row.id);
}

function sectionId(row = {}) {
  return text(row.assignment_group_id || row.section_id || row.id);
}

function personName(row = {}) {
  return text(row.faculty_name || row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" "));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function compareText(a, b) {
  return text(a).localeCompare(text(b), "en", { sensitivity: "base", numeric: true });
}

function compareCandidates(a, b) {
  const seniority = (a.senioritySort ?? Number.POSITIVE_INFINITY) - (b.senioritySort ?? Number.POSITIVE_INFINITY);
  if (seniority) return seniority;
  const preference = (a.preferenceRankSort ?? Number.POSITIVE_INFINITY) - (b.preferenceRankSort ?? Number.POSITIVE_INFINITY);
  if (preference) return preference;
  return compareText(a.facultyName || a.employeeId, b.facultyName || b.employeeId);
}

function activeAssignment(assignment = {}) {
  return !["released", "deleted", "void"].includes(text(assignment.status || "tentative").toLowerCase());
}

function buildFacultyIndex(facultyRows = [], findings) {
  const index = new Map();
  for (const row of facultyRows) {
    const employeeId = personId(row);
    if (!employeeId) {
      findings.push({ code: "missing_faculty_id", severity: "error", message: "A faculty row is missing employee_id/faculty_id." });
      continue;
    }
    const seniorityRank = numericRank(row.seniority_rank ?? row.seniority_value);
    if (seniorityRank === null) {
      findings.push({
        code: "missing_seniority",
        severity: "error",
        employeeId,
        message: `${employeeId} is missing a numeric seniority rank.`,
      });
    }
    index.set(employeeId, {
      original: clonePlain(row),
      employeeId,
      facultyName: personName(row) || employeeId,
      division: text(row.division),
      discipline: text(row.discipline),
      seniorityRank,
    });
  }
  return index;
}

function normalizePreferences(preferences = [], facultyIndex, sectionIndex, findings) {
  const normalized = [];
  const ranksByFaculty = new Map();
  const selectedByFacultySection = new Set();

  preferences.forEach((preference, index) => {
    const employeeId = personId(preference);
    const assignmentGroupId = sectionId(preference);
    const rank = positiveInteger(preference.preference_rank ?? preference.rank);

    if (!employeeId) {
      findings.push({ code: "missing_preference_faculty", severity: "error", preferenceIndex: index, message: "A preference is missing a faculty identifier." });
    }
    if (!assignmentGroupId) {
      findings.push({ code: "missing_preference_section", severity: "error", preferenceIndex: index, message: "A preference is missing an assignment group identifier." });
    }
    if (rank === null) {
      findings.push({
        code: "malformed_preference_rank",
        severity: "error",
        employeeId,
        assignmentGroupId,
        value: preference.preference_rank ?? preference.rank,
        message: "Preference ranks must be positive integers.",
      });
    }
    if (employeeId && !facultyIndex.has(employeeId)) {
      findings.push({ code: "unknown_faculty", severity: "warning", employeeId, message: `${employeeId} is not present in the seniority roster.` });
    }
    if (assignmentGroupId && !sectionIndex.has(assignmentGroupId)) {
      findings.push({ code: "unknown_section", severity: "warning", assignmentGroupId, message: `${assignmentGroupId} is not present in the eligible section list.` });
    }

    const rankKey = `${employeeId}::${rank}`;
    if (employeeId && rank !== null) {
      if (ranksByFaculty.has(rankKey)) {
        findings.push({
          code: "duplicate_preference_rank",
          severity: "error",
          employeeId,
          preferenceRank: rank,
          message: `${employeeId} has duplicate preference rank ${rank}.`,
        });
      }
      ranksByFaculty.set(rankKey, true);
    }

    const selectedKey = `${employeeId}::${assignmentGroupId}`;
    if (employeeId && assignmentGroupId) {
      if (selectedByFacultySection.has(selectedKey)) {
        findings.push({
          code: "duplicate_section_preference",
          severity: "error",
          employeeId,
          assignmentGroupId,
          message: `${employeeId} selected ${assignmentGroupId} more than once.`,
        });
      }
      selectedByFacultySection.add(selectedKey);
    }

    normalized.push({
      original: clonePlain(preference),
      employeeId,
      assignmentGroupId,
      preferenceRank: rank,
      preferenceRankSort: rank ?? Number.POSITIVE_INFINITY,
      submissionOrder: index,
    });
  });

  return normalized;
}

function buildAssignmentState(assignments = []) {
  const active = assignments.filter(activeAssignment).map((assignment) => ({
    original: clonePlain(assignment),
    employeeId: personId(assignment),
    assignmentGroupId: sectionId(assignment),
    status: text(assignment.status || "tentative"),
    reasonCode: text(assignment.reason_code || assignment.reasonCode),
    justification: text(assignment.justification || assignment.reason),
  }));

  return {
    active,
    assignedSectionIds: new Set(active.map((assignment) => assignment.assignmentGroupId).filter(Boolean)),
    assignedEmployeeIds: new Set(active.map((assignment) => assignment.employeeId).filter(Boolean)),
    bySection: new Map(active.map((assignment) => [assignment.assignmentGroupId, assignment])),
  };
}

function explainCandidate(candidate, assignmentState) {
  if (assignmentState.assignedSectionIds.has(candidate.assignmentGroupId)) {
    const assignment = assignmentState.bySection.get(candidate.assignmentGroupId);
    if (assignment?.employeeId === candidate.employeeId) return "awarded";
    return "section_awarded_elsewhere";
  }
  if (assignmentState.assignedEmployeeIds.has(candidate.employeeId)) return "candidate_awarded_elsewhere";
  if (candidate.missingSeniority) return "missing_seniority";
  return "available";
}

export function analyzeAllocation(input = {}) {
  const findings = [];
  const exceptionCodes = new Set([...(input.exceptionCodes || DEFAULT_EXCEPTION_CODES)].map((code) => text(code)).filter(Boolean));
  const sections = Array.isArray(input.sections) ? input.sections : [];
  const faculty = Array.isArray(input.faculty) ? input.faculty : [];
  const preferences = Array.isArray(input.preferences) ? input.preferences : [];
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];

  const sectionIndex = new Map();
  for (const section of sections) {
    const id = sectionId(section);
    if (!id) {
      findings.push({ code: "missing_section_id", severity: "error", message: "A section is missing assignment_group_id." });
      continue;
    }
    sectionIndex.set(id, { original: clonePlain(section), assignmentGroupId: id, disciplineCode: text(section.discipline_code) });
  }

  const facultyIndex = buildFacultyIndex(faculty, findings);
  const normalizedPreferences = normalizePreferences(preferences, facultyIndex, sectionIndex, findings);
  const assignmentState = buildAssignmentState(assignments);

  const queuesBySection = new Map(sections.map((section) => [sectionId(section), []]));
  for (const preference of normalizedPreferences) {
    if (!preference.employeeId || !preference.assignmentGroupId) continue;
    if (!sectionIndex.has(preference.assignmentGroupId)) continue;
    const facultyRecord = facultyIndex.get(preference.employeeId);
    const candidate = {
      employeeId: preference.employeeId,
      facultyName: facultyRecord?.facultyName || preference.employeeId,
      assignmentGroupId: preference.assignmentGroupId,
      preferenceRank: preference.preferenceRank,
      preferenceRankSort: preference.preferenceRankSort,
      seniorityRank: facultyRecord?.seniorityRank ?? null,
      senioritySort: facultyRecord?.seniorityRank ?? Number.POSITIVE_INFINITY,
      missingSeniority: !facultyRecord || facultyRecord.seniorityRank === null,
      originalPreference: clonePlain(preference.original),
    };
    candidate.status = explainCandidate(candidate, assignmentState);
    candidate.available = candidate.status === "available";
    queuesBySection.get(preference.assignmentGroupId)?.push(candidate);
  }

  const sectionsAnalysis = [];
  for (const section of sections) {
    const id = sectionId(section);
    if (!id) continue;
    const candidates = [...(queuesBySection.get(id) || [])]
      .sort(compareCandidates)
      .map((candidate, index) => ({ ...candidate, queuePosition: index + 1 }));
    const assignment = assignmentState.bySection.get(id) || null;
    const baselineTopCandidate = candidates.find((candidate) =>
      !candidate.missingSeniority &&
      (!assignmentState.assignedEmployeeIds.has(candidate.employeeId) || assignment?.employeeId === candidate.employeeId)
    ) || null;
    const nextEligibleCandidate = assignment ? null : candidates.find((candidate) => candidate.available && !candidate.missingSeniority) || null;
    const assignedCandidate = assignment ? candidates.find((candidate) => candidate.employeeId === assignment.employeeId) || null : null;
    const bypassedCandidate = assignment && baselineTopCandidate && assignment.employeeId !== baselineTopCandidate.employeeId
      ? baselineTopCandidate
      : null;
    const exceptionRequired = Boolean(bypassedCandidate);
    const exceptionSupported = exceptionRequired
      ? Boolean(exceptionCodes.has(assignment.reasonCode) && assignment.justification)
      : true;
    sectionsAnalysis.push({
      section: clonePlain(section),
      assignmentGroupId: id,
      candidates,
      baselineTopCandidate,
      nextEligibleCandidate,
      assignment,
      assignedCandidate,
      bypassedCandidate,
      exceptionRequired,
      exceptionSupported,
      recommendation: exceptionRequired
        ? {
            action: exceptionSupported ? "documented_exception" : "exception_required",
            employeeId: assignment.employeeId,
            reasonCode: assignment.reasonCode,
            bypassedEmployeeId: bypassedCandidate.employeeId,
          }
        : {
            action: nextEligibleCandidate ? "award_next_candidate" : assignment ? "already_awarded" : "chair_review",
            employeeId: assignment?.employeeId || nextEligibleCandidate?.employeeId || "",
          },
    });
  }

  const serializable = {
    findings,
    sections: sectionsAnalysis,
    originalSubmissions: clonePlain(preferences),
  };

  serializable.hashInput = JSON.stringify({
    sections: clonePlain(sections),
    faculty: clonePlain(faculty),
    preferences: clonePlain(preferences),
    assignments: clonePlain(assignments),
    exceptionCodes: [...exceptionCodes].sort(),
  });

  return serializable;
}

export const allocationExceptionCodes = DEFAULT_EXCEPTION_CODES;
