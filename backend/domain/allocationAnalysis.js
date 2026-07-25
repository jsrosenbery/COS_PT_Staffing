export const allocationReasonCodes = Object.freeze({
  AWARDED: "AWARDED",
  AWARDED_TO_MORE_SENIOR_CANDIDATE: "AWARDED_TO_MORE_SENIOR_CANDIDATE",
  NOT_SELECTED_BY_FACULTY: "NOT_SELECTED_BY_FACULTY",
  NOT_QUALIFIED: "NOT_QUALIFIED",
  LOAD_LIMIT_REACHED: "LOAD_LIMIT_REACHED",
  ALREADY_ASSIGNED_IN_THIS_PASS: "ALREADY_ASSIGNED_IN_THIS_PASS",
  CONTRACT_EXCEPTION_PENDING: "CONTRACT_EXCEPTION_PENDING",
  CONTRACT_EXCEPTION_APPLIED: "CONTRACT_EXCEPTION_APPLIED",
  WITHDRAWN: "WITHDRAWN",
  SECTION_NO_LONGER_AVAILABLE: "SECTION_NO_LONGER_AVAILABLE",
  MISSING_SENIORITY: "MISSING_SENIORITY",
  DATA_CONFLICT: "DATA_CONFLICT",
  NOT_YET_REACHED: "NOT_YET_REACHED",
});

export const allocationExceptionCodes = Object.freeze([
  "continuity",
  "dual_enrollment_positioned",
  "configured_contractual_exception",
]);

const ACTIVE_ASSIGNMENT_STATUSES = new Set(["tentative", "chair_submitted", "dean_approved", "approved", "assigned"]);
const INACTIVE_ASSIGNMENT_STATUSES = new Set(["released", "deleted", "void", "withdrawn"]);

function text(value) {
  return String(value ?? "").trim();
}

function textLower(value) {
  return text(value).toLowerCase();
}

function compact(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function splitList(value) {
  return asArray(value)
    .flatMap((item) => text(item).split(/[|,;]/))
    .map((item) => item.trim())
    .filter(Boolean);
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value) {
  const parsed = numericValue(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function employeeId(row = {}) {
  return text(row.employee_id || row.employeeId || row.faculty_id || row.facultyId || row.id);
}

function facultyName(row = {}) {
  return text(row.faculty_name || row.facultyName || row.full_name || row.fullName || [row.first_name, row.last_name].filter(Boolean).join(" "));
}

function assignmentGroupId(row = {}) {
  return text(row.assignment_group_id || row.assignmentGroupId || row.section_id || row.sectionId || row.id);
}

function preferenceRank(row = {}) {
  return positiveInteger(row.preference_rank ?? row.preferenceRank ?? row.rank);
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function compareText(a, b) {
  return text(a).localeCompare(text(b), "en", { sensitivity: "base", numeric: true });
}

function compareFaculty(a, b) {
  const seniority = (a.senioritySort - b.senioritySort);
  if (seniority) return seniority;
  return compareText(a.facultyName || a.employeeId, b.facultyName || b.employeeId) || compareText(a.employeeId, b.employeeId);
}

function comparePreference(a, b) {
  const rank = a.preferenceRankSort - b.preferenceRankSort;
  if (rank) return rank;
  return compareText(a.assignmentGroupId, b.assignmentGroupId);
}

function activeAssignment(row = {}) {
  const status = textLower(row.status || "tentative");
  if (INACTIVE_ASSIGNMENT_STATUSES.has(status)) return false;
  return !status || ACTIVE_ASSIGNMENT_STATUSES.has(status) || !INACTIVE_ASSIGNMENT_STATUSES.has(status);
}

function warning(code, message, extras = {}) {
  return { code, severity: extras.severity || "warning", message, ...extras };
}

function sectionCourse(section = {}) {
  return text(section.primary_subject_course || [section.subject_code, section.course_number].filter(Boolean).join(" "));
}

function normalizeSection(section = {}, index) {
  const id = assignmentGroupId(section);
  return {
    original: clonePlain(section),
    assignmentGroupId: id,
    term: text(section.term_code || section.termCode || section.term),
    division: text(section.division || section.division_name),
    disciplineCode: text(section.discipline_code || section.disciplineCode),
    subjectCode: text(section.subject_code || section.subjectCode),
    courseNumber: text(section.course_number || section.courseNumber),
    course: sectionCourse(section),
    title: text(section.title),
    primaryCrn: text(section.primary_crn || section.primaryCrn),
    staffingUnitType: text(section.bundle_type || section.bundleType || section.raw_row?.bundle_type || "single"),
    sourceIndex: index,
  };
}

function normalizeFaculty(row = {}, index) {
  const id = employeeId(row);
  const seniorityRank = numericValue(row.seniority_rank ?? row.seniorityRank ?? row.seniority_value ?? row.seniorityValue);
  const loadStatus = textLower(row.load_status || row.loadStatus || (row.load_complete || row.loadComplete ? "complete" : ""));
  const disciplines = splitList([
    row.discipline,
    row.discipline_code,
    row.disciplineCode,
    row.qualified_disciplines,
    row.qualifiedDisciplines,
  ].filter(Boolean).join("|"));
  return {
    original: clonePlain(row),
    employeeId: id,
    facultyName: facultyName(row) || id,
    division: text(row.division),
    discipline: text(row.discipline || row.discipline_code || row.disciplineCode),
    qualifiedDisciplines: disciplines,
    seniorityRank,
    senioritySort: seniorityRank ?? Number.POSITIVE_INFINITY,
    loadComplete: ["complete", "completed", "done", "true", "yes"].includes(loadStatus),
    sourceIndex: index,
  };
}

function normalizePreference(row = {}, index) {
  const rank = preferenceRank(row);
  return {
    original: clonePlain(row),
    employeeId: employeeId(row),
    facultyName: facultyName(row),
    assignmentGroupId: assignmentGroupId(row),
    disciplineCode: text(row.discipline_code || row.disciplineCode),
    preferenceRank: rank,
    preferenceRankSort: rank ?? Number.POSITIVE_INFINITY,
    withdrawn: ["withdrawn", "removed", "deleted"].includes(textLower(row.status || row.disposition)),
    sourceIndex: index,
  };
}

function normalizeAssignment(row = {}, index) {
  return {
    original: clonePlain(row),
    id: text(row.id),
    employeeId: employeeId(row),
    facultyName: facultyName(row),
    assignmentGroupId: assignmentGroupId(row),
    disciplineCode: text(row.discipline_code || row.disciplineCode),
    status: text(row.status || "tentative"),
    reasonCode: text(row.reason_code || row.reasonCode || row.exception_code || row.exceptionCode),
    justification: text(row.justification || row.reason || row.note),
    load: numericValue(row.load ?? row.assignment_load ?? row.units) ?? 1,
    sourceIndex: index,
  };
}

function qualifiesForSection(faculty, section) {
  if (!faculty?.employeeId || !section?.assignmentGroupId) return false;
  const facultyDivision = compact(faculty.division);
  const sectionDivision = compact(section.division);
  if (facultyDivision && sectionDivision && facultyDivision !== sectionDivision) return false;

  const facultyDisciplines = faculty.qualifiedDisciplines.map(compact).filter(Boolean);
  const sectionKeys = [section.disciplineCode, section.subjectCode, section.division].map(compact).filter(Boolean);
  if (!sectionKeys.length) return true;
  return facultyDisciplines.some((discipline) => sectionKeys.includes(discipline));
}

function buildLoadLimits(input = {}) {
  const raw = input.loadLimits || input.assignmentLimits || {};
  const oneAssignmentPerPass = raw.oneAssignmentPerPass !== undefined ? Boolean(raw.oneAssignmentPerPass) : false;
  const defaultMaxAssignments = numericValue(raw.defaultMaxAssignments ?? raw.maxAssignments);
  const defaultMaxLoad = numericValue(raw.defaultMaxLoad ?? raw.maxLoad);
  const maxAssignmentsByFaculty = new Map(Object.entries(raw.maxAssignmentsByFaculty || {}).map(([id, value]) => [text(id), numericValue(value)]));
  const maxLoadByFaculty = new Map(Object.entries(raw.maxLoadByFaculty || {}).map(([id, value]) => [text(id), numericValue(value)]));
  return {
    oneAssignmentPerPass,
    defaultMaxAssignments: defaultMaxAssignments ?? (oneAssignmentPerPass ? 1 : Number.POSITIVE_INFINITY),
    defaultMaxLoad: defaultMaxLoad ?? Number.POSITIVE_INFINITY,
    maxAssignmentsByFaculty,
    maxLoadByFaculty,
  };
}

function facultyAssignmentLimit(faculty, limits) {
  return limits.maxAssignmentsByFaculty.get(faculty.employeeId) ?? limits.defaultMaxAssignments;
}

function facultyLoadLimit(faculty, limits) {
  return limits.maxLoadByFaculty.get(faculty.employeeId) ?? limits.defaultMaxLoad;
}

function hasLoadCapacity({ faculty, counts, load, limits }) {
  if (faculty.loadComplete) return false;
  const assignmentLimit = facultyAssignmentLimit(faculty, limits);
  const loadLimit = facultyLoadLimit(faculty, limits);
  const currentCount = counts.assignmentCount.get(faculty.employeeId) || 0;
  const currentLoad = counts.load.get(faculty.employeeId) || 0;
  if (currentCount >= assignmentLimit) return false;
  if (currentLoad + load > loadLimit) return false;
  return true;
}

function buildIndexes(input) {
  const warnings = [];
  const sections = asArray(input.sections || input.eligibleSections).map(normalizeSection).filter((section) => {
    if (!section.assignmentGroupId) {
      warnings.push(warning("DATA_CONFLICT", "A section is missing assignment_group_id.", { reasonCode: allocationReasonCodes.DATA_CONFLICT }));
      return false;
    }
    return true;
  });
  const faculty = asArray(input.faculty || input.facultyEligibility || input.facultySeniority).map(normalizeFaculty).filter((row) => {
    if (!row.employeeId) {
      warnings.push(warning("DATA_CONFLICT", "A faculty row is missing employee_id.", { reasonCode: allocationReasonCodes.DATA_CONFLICT }));
      return false;
    }
    if (row.seniorityRank === null) {
      warnings.push(warning("MISSING_SENIORITY", `${row.employeeId} is missing numeric seniority.`, {
        reasonCode: allocationReasonCodes.MISSING_SENIORITY,
        employeeId: row.employeeId,
      }));
    }
    return true;
  });
  const preferences = asArray(input.preferences || input.preferenceLists).map(normalizePreference);
  const assignments = asArray(input.assignments || input.currentAssignments).map(normalizeAssignment).filter(activeAssignment);

  const sectionsById = new Map();
  for (const section of sections) {
    if (sectionsById.has(section.assignmentGroupId)) {
      warnings.push(warning("DATA_CONFLICT", `Duplicate section ${section.assignmentGroupId}.`, {
        reasonCode: allocationReasonCodes.DATA_CONFLICT,
        assignmentGroupId: section.assignmentGroupId,
      }));
    }
    sectionsById.set(section.assignmentGroupId, section);
  }

  const facultyById = new Map();
  for (const row of faculty) {
    if (facultyById.has(row.employeeId)) {
      warnings.push(warning("DATA_CONFLICT", `Duplicate faculty row ${row.employeeId}.`, {
        reasonCode: allocationReasonCodes.DATA_CONFLICT,
        employeeId: row.employeeId,
      }));
    }
    facultyById.set(row.employeeId, row);
  }

  const rankKeys = new Set();
  const preferenceKeys = new Set();
  for (const preference of preferences) {
    if (!preference.employeeId || !preference.assignmentGroupId) {
      warnings.push(warning("DATA_CONFLICT", "A preference is missing faculty or section identity.", {
        reasonCode: allocationReasonCodes.DATA_CONFLICT,
        employeeId: preference.employeeId,
        assignmentGroupId: preference.assignmentGroupId,
      }));
    }
    if (preference.preferenceRank === null && !preference.withdrawn) {
      warnings.push(warning("DATA_CONFLICT", `Malformed preference rank for ${preference.employeeId || "unknown faculty"}.`, {
        reasonCode: allocationReasonCodes.DATA_CONFLICT,
        employeeId: preference.employeeId,
        assignmentGroupId: preference.assignmentGroupId,
      }));
    }
    const rankKey = `${preference.employeeId}::${preference.preferenceRank}`;
    if (preference.employeeId && preference.preferenceRank !== null) {
      if (rankKeys.has(rankKey)) {
        warnings.push(warning("DATA_CONFLICT", `${preference.employeeId} has duplicate preference rank ${preference.preferenceRank}.`, {
          reasonCode: allocationReasonCodes.DATA_CONFLICT,
          employeeId: preference.employeeId,
          preferenceRank: preference.preferenceRank,
        }));
      }
      rankKeys.add(rankKey);
    }
    const preferenceKey = `${preference.employeeId}::${preference.assignmentGroupId}`;
    if (preference.employeeId && preference.assignmentGroupId) {
      if (preferenceKeys.has(preferenceKey)) {
        warnings.push(warning("DATA_CONFLICT", `${preference.employeeId} selected ${preference.assignmentGroupId} more than once.`, {
          reasonCode: allocationReasonCodes.DATA_CONFLICT,
          employeeId: preference.employeeId,
          assignmentGroupId: preference.assignmentGroupId,
        }));
      }
      preferenceKeys.add(preferenceKey);
    }
  }

  const assignmentsBySection = new Map();
  for (const assignment of assignments) {
    if (assignmentsBySection.has(assignment.assignmentGroupId)) {
      warnings.push(warning("DATA_CONFLICT", `Section ${assignment.assignmentGroupId} has multiple active assignments.`, {
        reasonCode: allocationReasonCodes.DATA_CONFLICT,
        assignmentGroupId: assignment.assignmentGroupId,
      }));
    }
    assignmentsBySection.set(assignment.assignmentGroupId, assignment);
  }

  return { warnings, sections, faculty, preferences, assignments, sectionsById, facultyById, assignmentsBySection };
}

function buildPreferenceMaps(preferences) {
  const byFaculty = new Map();
  const bySection = new Map();
  const byFacultySection = new Map();

  for (const preference of preferences) {
    if (!preference.employeeId || !preference.assignmentGroupId) continue;
    if (!byFaculty.has(preference.employeeId)) byFaculty.set(preference.employeeId, []);
    if (!bySection.has(preference.assignmentGroupId)) bySection.set(preference.assignmentGroupId, []);
    byFaculty.get(preference.employeeId).push(preference);
    bySection.get(preference.assignmentGroupId).push(preference);
    const key = `${preference.employeeId}::${preference.assignmentGroupId}`;
    const existing = byFacultySection.get(key);
    if (!existing || preference.preferenceRankSort < existing.preferenceRankSort) byFacultySection.set(key, preference);
  }

  for (const list of byFaculty.values()) list.sort(comparePreference);
  for (const list of bySection.values()) list.sort((a, b) => a.preferenceRankSort - b.preferenceRankSort || compareText(a.employeeId, b.employeeId));

  return { byFaculty, bySection, byFacultySection };
}

function buildCounts(assignments) {
  const assignmentCount = new Map();
  const load = new Map();
  const assignedInPass = new Set();
  const unavailableSections = new Set();

  for (const assignment of assignments) {
    if (!assignment.employeeId || !assignment.assignmentGroupId) continue;
    assignmentCount.set(assignment.employeeId, (assignmentCount.get(assignment.employeeId) || 0) + 1);
    load.set(assignment.employeeId, (load.get(assignment.employeeId) || 0) + (assignment.load || 1));
    assignedInPass.add(assignment.employeeId);
    unavailableSections.add(assignment.assignmentGroupId);
  }
  return { assignmentCount, load, assignedInPass, unavailableSections };
}

function exceptionState({ assignment, baselineTopCandidate, exceptionCodes }) {
  if (!assignment || !baselineTopCandidate || assignment.employeeId === baselineTopCandidate.employeeId) return null;
  const recognized = assignment.reasonCode && exceptionCodes.has(assignment.reasonCode);
  const justified = Boolean(assignment.justification);
  return {
    reasonCode: recognized && justified
      ? allocationReasonCodes.CONTRACT_EXCEPTION_APPLIED
      : allocationReasonCodes.CONTRACT_EXCEPTION_PENDING,
    exceptionCode: assignment.reasonCode,
    justification: assignment.justification,
    bypassedEmployeeId: baselineTopCandidate.employeeId,
    assignedEmployeeId: assignment.employeeId,
  };
}

function dispositionForPreference({ preference, faculty, section, assignment, baselineTopCandidate, currentRecommended, hasRecommendedAssignment, counts, limits, exception }) {
  if (preference.withdrawn) return allocationReasonCodes.WITHDRAWN;
  if (!section) return allocationReasonCodes.SECTION_NO_LONGER_AVAILABLE;
  if (!faculty) return allocationReasonCodes.DATA_CONFLICT;
  if (faculty.seniorityRank === null) return allocationReasonCodes.MISSING_SENIORITY;
  if (!qualifiesForSection(faculty, section)) return allocationReasonCodes.NOT_QUALIFIED;
  if (assignment) {
    if (assignment.employeeId === faculty.employeeId) return allocationReasonCodes.AWARDED;
    if (exception && baselineTopCandidate?.employeeId === faculty.employeeId) return exception.reasonCode;
    if (limits.oneAssignmentPerPass && counts.assignedInPass.has(faculty.employeeId)) return allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS;
    if (!hasLoadCapacity({ faculty, counts, load: 1, limits })) return allocationReasonCodes.LOAD_LIMIT_REACHED;
    if (baselineTopCandidate && baselineTopCandidate.employeeId !== faculty.employeeId) return allocationReasonCodes.AWARDED_TO_MORE_SENIOR_CANDIDATE;
    return allocationReasonCodes.SECTION_NO_LONGER_AVAILABLE;
  }
  if (currentRecommended) {
    if (currentRecommended.employeeId === faculty.employeeId && currentRecommended.assignmentGroupId === section.assignmentGroupId) return allocationReasonCodes.AWARDED;
    const recommendedFaculty = currentRecommended.seniorityRank ?? Number.POSITIVE_INFINITY;
    const currentFaculty = faculty.seniorityRank ?? Number.POSITIVE_INFINITY;
    if (recommendedFaculty < currentFaculty) return allocationReasonCodes.AWARDED_TO_MORE_SENIOR_CANDIDATE;
    if (limits.oneAssignmentPerPass && hasRecommendedAssignment) return allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS;
    if (limits.oneAssignmentPerPass && counts.assignedInPass.has(faculty.employeeId)) return allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS;
    if (!hasLoadCapacity({ faculty, counts, load: 1, limits })) return allocationReasonCodes.LOAD_LIMIT_REACHED;
    return allocationReasonCodes.SECTION_NO_LONGER_AVAILABLE;
  }
  if (limits.oneAssignmentPerPass && hasRecommendedAssignment) return allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS;
  if (limits.oneAssignmentPerPass && counts.assignedInPass.has(faculty.employeeId)) return allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS;
  if (!hasLoadCapacity({ faculty, counts, load: 1, limits })) return allocationReasonCodes.LOAD_LIMIT_REACHED;
  if (counts.unavailableSections.has(section.assignmentGroupId)) return allocationReasonCodes.SECTION_NO_LONGER_AVAILABLE;
  return allocationReasonCodes.NOT_YET_REACHED;
}

function candidateReason({ faculty, preference, section, assignment, baselineTopCandidate, exception, counts, limits }) {
  if (!preference) return allocationReasonCodes.NOT_SELECTED_BY_FACULTY;
  if (preference.withdrawn) return allocationReasonCodes.WITHDRAWN;
  if (!qualifiesForSection(faculty, section)) return allocationReasonCodes.NOT_QUALIFIED;
  if (faculty.seniorityRank === null) return allocationReasonCodes.MISSING_SENIORITY;
  if (assignment) {
    if (assignment.employeeId === faculty.employeeId) return allocationReasonCodes.AWARDED;
    if (exception && baselineTopCandidate?.employeeId === faculty.employeeId) return exception.reasonCode;
    if (baselineTopCandidate && baselineTopCandidate.employeeId !== faculty.employeeId) {
      return allocationReasonCodes.AWARDED_TO_MORE_SENIOR_CANDIDATE;
    }
    return allocationReasonCodes.SECTION_NO_LONGER_AVAILABLE;
  }
  if (limits.oneAssignmentPerPass && counts.assignedInPass.has(faculty.employeeId)) return allocationReasonCodes.ALREADY_ASSIGNED_IN_THIS_PASS;
  if (!hasLoadCapacity({ faculty, counts, load: 1, limits })) return allocationReasonCodes.LOAD_LIMIT_REACHED;
  return allocationReasonCodes.NOT_YET_REACHED;
}

function buildSectionAnalyses({ sections, faculty, preferenceMaps, assignmentsBySection, counts, limits, exceptionCodes }) {
  return sections.map((section) => {
    const interested = (preferenceMaps.bySection.get(section.assignmentGroupId) || [])
      .map((preference) => {
        const row = faculty.find((candidate) => candidate.employeeId === preference.employeeId);
        if (!row) return null;
        return { faculty: row, preference };
      })
      .filter(Boolean);
    const orderedInterested = interested
      .sort((a, b) => compareFaculty(a.faculty, b.faculty) || comparePreference(a.preference, b.preference));
    const assignment = assignmentsBySection.get(section.assignmentGroupId) || null;
    const baselineTopCandidate = orderedInterested.find(({ faculty: row, preference }) =>
      !preference.withdrawn &&
      row.seniorityRank !== null &&
      qualifiesForSection(row, section) &&
      (!limits.oneAssignmentPerPass || !counts.assignedInPass.has(row.employeeId) || assignment?.employeeId === row.employeeId)
    ) || null;
    const exception = exceptionState({ assignment, baselineTopCandidate: baselineTopCandidate?.faculty || null, exceptionCodes });
    const candidates = orderedInterested.map(({ faculty: row, preference }, index) => ({
      employeeId: row.employeeId,
      facultyName: row.facultyName,
      seniorityRank: row.seniorityRank,
      preferenceRank: preference.preferenceRank,
      queuePosition: index + 1,
      qualified: qualifiesForSection(row, section),
      reasonCode: candidateReason({
        faculty: row,
        preference,
        section,
        assignment,
        baselineTopCandidate: baselineTopCandidate?.faculty || null,
        exception,
        counts,
        limits,
      }),
      originalPreference: clonePlain(preference.original),
    }));
    const highestSeniorityEligibleCandidate = !assignment
      ? candidates.find((candidate) => candidate.qualified && candidate.reasonCode === allocationReasonCodes.NOT_YET_REACHED) || null
      : null;

    return {
      assignmentGroupId: section.assignmentGroupId,
      section: clonePlain(section.original),
      staffingUnitType: section.staffingUnitType,
      candidateList: candidates,
      highestSeniorityCurrentlyEligibleCandidate: highestSeniorityEligibleCandidate,
      currentAssignment: assignment ? clonePlain(assignment.original) : null,
      exception,
      nonCandidateReasons: faculty
        .filter((row) => !preferenceMaps.byFacultySection.has(`${row.employeeId}::${section.assignmentGroupId}`))
        .map((row) => ({
          employeeId: row.employeeId,
          facultyName: row.facultyName,
          reasonCode: qualifiesForSection(row, section) ? allocationReasonCodes.NOT_SELECTED_BY_FACULTY : allocationReasonCodes.NOT_QUALIFIED,
        })),
    };
  });
}

function buildRecommendations({ faculty, sectionsById, preferenceMaps, counts, limits, assignmentsBySection }) {
  const sequence = [];
  const workingCounts = {
    assignmentCount: new Map(counts.assignmentCount),
    load: new Map(counts.load),
    assignedInPass: new Set(counts.assignedInPass),
    unavailableSections: new Set(counts.unavailableSections),
  };

  const orderedFaculty = [...faculty].sort(compareFaculty);
  for (const row of orderedFaculty) {
    const facultyPreferences = preferenceMaps.byFaculty.get(row.employeeId) || [];
    if (row.seniorityRank === null) continue;
    for (const preference of facultyPreferences) {
      const section = sectionsById.get(preference.assignmentGroupId);
      if (!section || preference.withdrawn) continue;
      if (!qualifiesForSection(row, section)) continue;
      if (workingCounts.unavailableSections.has(section.assignmentGroupId)) continue;
      if (assignmentsBySection.has(section.assignmentGroupId)) continue;
      if (limits.oneAssignmentPerPass && workingCounts.assignedInPass.has(row.employeeId)) break;
      if (!hasLoadCapacity({ faculty: row, counts: workingCounts, load: 1, limits })) break;
      const recommendation = {
        sequence: sequence.length + 1,
        action: "RECOMMEND_ASSIGNMENT",
        termSectionKey: section.assignmentGroupId,
        assignmentGroupId: section.assignmentGroupId,
        employeeId: row.employeeId,
        facultyName: row.facultyName,
        seniorityRank: row.seniorityRank,
        preferenceRank: preference.preferenceRank,
        reasonCode: allocationReasonCodes.NOT_YET_REACHED,
      };
      sequence.push(recommendation);
      workingCounts.unavailableSections.add(section.assignmentGroupId);
      workingCounts.assignedInPass.add(row.employeeId);
      workingCounts.assignmentCount.set(row.employeeId, (workingCounts.assignmentCount.get(row.employeeId) || 0) + 1);
      workingCounts.load.set(row.employeeId, (workingCounts.load.get(row.employeeId) || 0) + 1);
      if (limits.oneAssignmentPerPass) break;
    }
  }

  return sequence;
}

function buildFacultyDisposition({ faculty, preferenceMaps, sectionsById, assignmentsBySection, recommendations, counts, limits, sectionAnalyses }) {
  const recommendationBySection = new Map(recommendations.map((item) => [item.assignmentGroupId, item]));
  const recommendationByFaculty = new Map();
  for (const recommendation of recommendations) {
    if (!recommendationByFaculty.has(recommendation.employeeId)) recommendationByFaculty.set(recommendation.employeeId, []);
    recommendationByFaculty.get(recommendation.employeeId).push(recommendation);
  }
  const sectionExceptionById = new Map(sectionAnalyses.map((section) => [section.assignmentGroupId, section.exception]));
  const baselineTopBySection = new Map(sectionAnalyses.map((section) => [
    section.assignmentGroupId,
    section.candidateList.find((candidate) => candidate.queuePosition === 1) || null,
  ]));

  return faculty.map((row) => {
    const preferences = (preferenceMaps.byFaculty.get(row.employeeId) || []).map((preference) => {
      const section = sectionsById.get(preference.assignmentGroupId) || null;
      const assignment = assignmentsBySection.get(preference.assignmentGroupId) || null;
      const currentRecommended = recommendationBySection.get(preference.assignmentGroupId) || null;
      const exception = sectionExceptionById.get(preference.assignmentGroupId) || null;
      const baselineTop = baselineTopBySection.get(preference.assignmentGroupId);
      const otherRecommendations = (recommendationByFaculty.get(row.employeeId) || [])
        .filter((recommendation) => recommendation.assignmentGroupId !== preference.assignmentGroupId);
      const dispositionCounts = {
        assignmentCount: new Map(counts.assignmentCount),
        load: new Map(counts.load),
        assignedInPass: counts.assignedInPass,
        unavailableSections: counts.unavailableSections,
      };
      if (!currentRecommended || currentRecommended.employeeId !== row.employeeId) {
        dispositionCounts.assignmentCount.set(
          row.employeeId,
          (dispositionCounts.assignmentCount.get(row.employeeId) || 0) + otherRecommendations.length
        );
        dispositionCounts.load.set(
          row.employeeId,
          (dispositionCounts.load.get(row.employeeId) || 0) + otherRecommendations.length
        );
      }
      return {
        assignmentGroupId: preference.assignmentGroupId,
        preferenceRank: preference.preferenceRank,
        reasonCode: dispositionForPreference({
          preference,
          faculty: row,
          section,
          assignment,
          baselineTopCandidate: baselineTop,
          currentRecommended,
          hasRecommendedAssignment: otherRecommendations.length > 0,
          counts: dispositionCounts,
          limits,
          exception,
        }),
        originalPreference: clonePlain(preference.original),
      };
    });
    return {
      employeeId: row.employeeId,
      facultyName: row.facultyName,
      seniorityRank: row.seniorityRank,
      rankedPreferences: preferences,
      currentAssignments: [...assignmentsBySection.values()].filter((assignment) => assignment.employeeId === row.employeeId).map((assignment) => clonePlain(assignment.original)),
      recommendedAssignments: recommendations.filter((recommendation) => recommendation.employeeId === row.employeeId),
    };
  });
}

export function analyzeAllocation(input = {}) {
  const indexes = buildIndexes(input);
  const limits = buildLoadLimits(input);
  const exceptionCodes = new Set(splitList(input.recognizedContractualExceptions || input.exceptionCodes || allocationExceptionCodes));
  const preferenceMaps = buildPreferenceMaps(indexes.preferences);
  const counts = buildCounts(indexes.assignments);
  const sectionAnalyses = buildSectionAnalyses({
    sections: indexes.sections,
    faculty: indexes.faculty,
    preferenceMaps,
    assignmentsBySection: indexes.assignmentsBySection,
    counts,
    limits,
    exceptionCodes,
  });
  const recommendedNextAssignmentSequence = buildRecommendations({
    faculty: indexes.faculty,
    sectionsById: indexes.sectionsById,
    preferenceMaps,
    counts,
    limits,
    assignmentsBySection: indexes.assignmentsBySection,
  });
  const facultyDisposition = buildFacultyDisposition({
    faculty: indexes.faculty,
    preferenceMaps,
    sectionsById: indexes.sectionsById,
    assignmentsBySection: indexes.assignmentsBySection,
    recommendations: recommendedNextAssignmentSequence,
    counts,
    limits,
    sectionAnalyses,
  });

  return {
    term: text(input.term || input.termCode),
    division: text(input.division || input.divisionName),
    discipline: text(input.discipline || input.disciplineCode),
    policy: {
      oneAssignmentPerPass: limits.oneAssignmentPerPass,
      defaultMaxAssignments: Number.isFinite(limits.defaultMaxAssignments) ? limits.defaultMaxAssignments : null,
      defaultMaxLoad: Number.isFinite(limits.defaultMaxLoad) ? limits.defaultMaxLoad : null,
      recognizedContractualExceptions: [...exceptionCodes].sort(),
    },
    reasonCodes: Object.values(allocationReasonCodes),
    sections: sectionAnalyses,
    faculty: facultyDisposition,
    recommendedNextAssignmentSequence,
    warnings: indexes.warnings,
    originalSubmissions: clonePlain(input.preferences || input.preferenceLists || []),
    generatedFrom: {
      sectionCount: indexes.sections.length,
      facultyCount: indexes.faculty.length,
      preferenceCount: indexes.preferences.length,
      activeAssignmentCount: indexes.assignments.length,
    },
  };
}
