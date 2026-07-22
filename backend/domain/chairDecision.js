export const chairDecisionStatuses = Object.freeze({
  RECOMMENDED: "recommended",
  TENTATIVE: "tentative",
  BYPASSED: "bypassed",
  RELEASED: "released",
  CHAIR_FINALIZED: "chair_finalized",
  DEAN_APPROVED: "dean_approved",
  RETURNED_FOR_REVISION: "returned_for_revision",
});

export const defaultContractExceptionReasons = Object.freeze([
  { code: "COURSE_CONTINUITY", label: "Course continuity", requires_explanation: true },
  { code: "DUAL_ENROLLMENT_SITE_POSITION", label: "Dual-enrollment site position", requires_explanation: true },
  { code: "SPECIALIZED_QUALIFICATION", label: "Specialized qualification", requires_explanation: true },
  { code: "AVAILABILITY_OR_SCHEDULE_CONFLICT", label: "Availability or schedule conflict", requires_explanation: true },
  { code: "LOAD_OR_ASSIGNMENT_LIMIT", label: "Load or assignment limit", requires_explanation: true },
  { code: "OTHER_CONTRACTUAL_EXCEPTION", label: "Other contractual exception", requires_explanation: true },
]);

function text(value) {
  return String(value ?? "").trim();
}

function findSectionAnalysis(analysis, assignmentGroupId) {
  return (analysis?.sections || []).find((section) => section.assignmentGroupId === assignmentGroupId) || null;
}

function recommendationForSection(analysis, assignmentGroupId) {
  return findSectionAnalysis(analysis, assignmentGroupId)?.highestSeniorityCurrentlyEligibleCandidate
    || (analysis?.recommendedNextAssignmentSequence || []).find((item) => item.assignmentGroupId === assignmentGroupId)
    || null;
}

function candidateForSection(sectionAnalysis, employeeId) {
  return (sectionAnalysis?.candidateList || []).find((candidate) => candidate.employeeId === employeeId) || null;
}

export function normalizeExceptionReasons(reasons = defaultContractExceptionReasons) {
  return reasons
    .map((reason) => ({
      code: text(reason.code),
      label: text(reason.label || reason.code),
      description: text(reason.description),
      requires_explanation: reason.requires_explanation !== false && reason.requiresExplanation !== false,
      active_status: text(reason.active_status || reason.activeStatus || "active"),
    }))
    .filter((reason) => reason.code && reason.active_status !== "inactive");
}

export function validateChairDecision({
  analysis,
  assignmentGroupId,
  selectedEmployeeId,
  exceptionReasonCode = "",
  exceptionExplanation = "",
  exceptionReasons = defaultContractExceptionReasons,
}) {
  const sectionAnalysis = findSectionAnalysis(analysis, assignmentGroupId);
  if (!sectionAnalysis) {
    return { ok: false, status: 404, error: "Staffing unit was not found in the current allocation analysis." };
  }

  const selectedCandidate = candidateForSection(sectionAnalysis, selectedEmployeeId);
  if (!selectedCandidate) {
    return { ok: false, status: 400, error: "Selected candidate is not in the interested candidate queue for this staffing unit." };
  }

  const recommendedCandidate = recommendationForSection(analysis, assignmentGroupId);
  if (!recommendedCandidate?.employeeId) {
    return { ok: false, status: 409, error: "No eligible recommendation is available for this staffing unit." };
  }

  const isRecommended = recommendedCandidate.employeeId === selectedCandidate.employeeId;
  const reasons = normalizeExceptionReasons(exceptionReasons);
  const reason = reasons.find((item) => item.code === text(exceptionReasonCode));
  const explanation = text(exceptionExplanation);

  if (!isRecommended) {
    if (!reason) {
      return { ok: false, status: 400, error: "A recognized contractual exception reason is required for a non-seniority selection." };
    }
    if (reason.requires_explanation && !explanation) {
      return { ok: false, status: 400, error: "A written explanation is required for this contractual exception." };
    }
    if (reason.code === "OTHER_CONTRACTUAL_EXCEPTION" && explanation.length < 20) {
      return { ok: false, status: 400, error: "OTHER_CONTRACTUAL_EXCEPTION requires a detailed explanation." };
    }
  }

  return {
    ok: true,
    isRecommended,
    decisionStatus: isRecommended ? chairDecisionStatuses.TENTATIVE : chairDecisionStatuses.BYPASSED,
    recommendedCandidate,
    selectedCandidate,
    sectionAnalysis,
    exceptionReason: isRecommended ? null : reason,
    exceptionExplanation: isRecommended ? "" : explanation,
    recommendationSnapshot: {
      assignmentGroupId,
      recommendedEmployeeId: recommendedCandidate.employeeId,
      recommendedFacultyName: recommendedCandidate.facultyName || "",
      recommendedPreferenceRank: recommendedCandidate.preferenceRank ?? null,
      recommendedSeniorityRank: recommendedCandidate.seniorityRank ?? null,
      candidateList: sectionAnalysis.candidateList || [],
      generatedFrom: analysis?.generatedFrom || {},
      policy: analysis?.policy || {},
    },
    decisionSnapshot: {
      assignmentGroupId,
      selectedEmployeeId: selectedCandidate.employeeId,
      selectedFacultyName: selectedCandidate.facultyName || "",
      selectedPreferenceRank: selectedCandidate.preferenceRank ?? null,
      selectedSeniorityRank: selectedCandidate.seniorityRank ?? null,
      exceptionReasonCode: isRecommended ? "" : reason.code,
      exceptionExplanation: isRecommended ? "" : explanation,
      isRecommendedSelection: isRecommended,
    },
  };
}
