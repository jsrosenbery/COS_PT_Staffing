function text(value) {
  return String(value ?? "").trim();
}

function numberOrBlank(value) {
  return value === undefined || value === null ? "" : value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function latestSubmissionForFaculty(submissions = [], employeeId) {
  return submissions
    .filter((submission) => text(submission.employee_id || submission.faculty_id) === employeeId)
    .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))[0] || null;
}

function itemsForSubmission(items = [], submission) {
  if (!submission) return [];
  return items
    .filter((item) => Number(item.submission_id) === Number(submission.id))
    .sort((a, b) => Number(a.preference_rank || 999999) - Number(b.preference_rank || 999999));
}

function candidateFromSnapshot(candidate = {}, decision = {}) {
  const selected = text(decision.selected_employee_id);
  const recommended = text(decision.recommended_employee_id);
  const employeeId = text(candidate.employeeId || candidate.employee_id);
  let disposition = text(candidate.reasonCode || candidate.reason_code || "NOT_YET_REACHED");
  if (employeeId && employeeId === selected) disposition = "AWARDED";
  if (employeeId && employeeId === recommended && selected && selected !== recommended) {
    disposition = text(decision.exception_reason_code) ? "CONTRACT_EXCEPTION_APPLIED" : "CONTRACT_EXCEPTION_PENDING";
  }
  return {
    employee_id: employeeId,
    faculty_name: text(candidate.facultyName || candidate.faculty_name),
    seniority_rank: numberOrBlank(candidate.seniorityRank ?? candidate.seniority_rank),
    preference_rank: numberOrBlank(candidate.preferenceRank ?? candidate.preference_rank),
    qualified: candidate.qualified !== false,
    available_at_decision: !["ALREADY_ASSIGNED_IN_THIS_PASS", "LOAD_LIMIT_REACHED", "SECTION_NO_LONGER_AVAILABLE", "MISSING_SENIORITY"].includes(disposition),
    workload_or_assignment_cap_applied: ["ALREADY_ASSIGNED_IN_THIS_PASS", "LOAD_LIMIT_REACHED"].includes(disposition),
    section_already_awarded: disposition === "SECTION_NO_LONGER_AVAILABLE",
    disposition,
  };
}

export function buildDecisionExplanation({ termCode = "", division = "", sections = [], decisions = [], submissions = [], submissionItems = [], currentAnalysis = null }) {
  const latestDecisionBySection = new Map();
  for (const decision of decisions) {
    const sectionKey = text(decision.assignment_group_id);
    const current = latestDecisionBySection.get(sectionKey);
    if (!current || new Date(decision.decided_at || 0) > new Date(current.decided_at || 0)) {
      latestDecisionBySection.set(sectionKey, decision);
    }
  }

  const currentAnalysisBySection = new Map((currentAnalysis?.sections || []).map((section) => [section.assignmentGroupId, section]));

  const sectionExplanations = sections.map((section) => {
    const assignmentGroupId = text(section.assignment_group_id || section.assignmentGroupId);
    const decision = latestDecisionBySection.get(assignmentGroupId) || null;
    const recommendationSnapshot = decision?.recommendation_snapshot || {};
    const decisionSnapshot = decision?.decision_snapshot || {};
    const currentSectionAnalysis = currentAnalysisBySection.get(assignmentGroupId) || {};
    const snapshotCandidates = recommendationSnapshot.candidateList || currentSectionAnalysis.candidateList || [];
    const candidates = snapshotCandidates.map((candidate) => candidateFromSnapshot(candidate, decision || {}));
    return {
      term_code: termCode || text(section.term_code),
      division: division || text(section.division),
      assignment_group_id: assignmentGroupId,
      section: clone(section),
      interested_faculty: candidates,
      original_system_recommendation: {
        employee_id: text(recommendationSnapshot.recommendedEmployeeId || decision?.recommended_employee_id || currentSectionAnalysis.highestSeniorityCurrentlyEligibleCandidate?.employeeId),
        faculty_name: text(recommendationSnapshot.recommendedFacultyName || currentSectionAnalysis.highestSeniorityCurrentlyEligibleCandidate?.facultyName),
        seniority_rank: numberOrBlank(recommendationSnapshot.recommendedSeniorityRank ?? currentSectionAnalysis.highestSeniorityCurrentlyEligibleCandidate?.seniorityRank),
        preference_rank: numberOrBlank(recommendationSnapshot.recommendedPreferenceRank ?? currentSectionAnalysis.highestSeniorityCurrentlyEligibleCandidate?.preferenceRank),
      },
      chair_decision: decision ? {
        employee_id: text(decision.selected_employee_id),
        faculty_name: text(decision.selected_faculty_name || decisionSnapshot.selectedFacultyName),
        status: text(decision.decision_status),
        exception_reason_code: text(decision.exception_reason_code),
        exception_explanation: text(decision.exception_explanation),
        decided_by_email: text(decision.decided_by_email),
        decided_by_role: text(decision.decided_by_role),
        decided_at: decision.decided_at,
      } : null,
      dean_review: decision && ["dean_approved", "returned_for_revision"].includes(text(decision.decision_status)) ? {
        status: text(decision.decision_status),
        timestamp: decision.updated_at || decision.decided_at,
      } : null,
      timestamps: {
        decided_at: decision?.decided_at || null,
        decision_updated_at: decision?.updated_at || null,
        section_created_at: section.created_at || null,
        section_updated_at: section.updated_at || null,
      },
      snapshot_source: decision ? "chair_decision_snapshot" : "current_analysis_fallback",
    };
  });

  const facultyIds = Array.from(new Set([
    ...submissions.map((submission) => text(submission.employee_id || submission.faculty_id)),
    ...sectionExplanations.flatMap((section) => section.interested_faculty.map((candidate) => text(candidate.employee_id))),
  ].filter(Boolean))).sort();

  const facultyExplanations = facultyIds.map((employeeId) => {
    const submission = latestSubmissionForFaculty(submissions, employeeId);
    const frozenItems = itemsForSubmission(submissionItems, submission);
    const awardedSections = sectionExplanations
      .filter((section) => text(section.chair_decision?.employee_id) === employeeId)
      .map((section) => section.assignment_group_id);
    const selectedSections = frozenItems.map((item) => {
      const section = sectionExplanations.find((entry) => entry.assignment_group_id === text(item.assignment_group_id));
      const candidate = section?.interested_faculty.find((row) => text(row.employee_id) === employeeId);
      return {
        assignment_group_id: text(item.assignment_group_id),
        preference_rank: item.preference_rank,
        original_item: clone(item.item_snapshot || item),
        disposition: candidate?.disposition || (section?.chair_decision ? "SECTION_NO_LONGER_AVAILABLE" : "NOT_YET_REACHED"),
        explanation: candidate?.disposition || "No historical decision snapshot exists for this preference yet.",
        decision_sequence: section?.chair_decision ? {
          decided_at: section.chair_decision.decided_at,
          recommended_employee_id: section.original_system_recommendation.employee_id,
          selected_employee_id: section.chair_decision.employee_id,
          status: section.chair_decision.status,
        } : null,
      };
    });
    return {
      employee_id: employeeId,
      faculty_name: text(submission?.faculty_name) || sectionExplanations.flatMap((section) => section.interested_faculty).find((candidate) => candidate.employee_id === employeeId)?.faculty_name || employeeId,
      frozen_submission: submission ? clone(submission.submission_snapshot || submission) : null,
      submitted_at: submission?.submitted_at || null,
      selected_sections: selectedSections,
      awarded_sections: awardedSections,
    };
  });

  return {
    term_code: termCode,
    division,
    sections: sectionExplanations,
    faculty: facultyExplanations,
    generated_from: {
      section_count: sectionExplanations.length,
      decision_count: decisions.length,
      submission_count: submissions.length,
      uses_historical_snapshots: decisions.some((decision) => decision.recommendation_snapshot || decision.decision_snapshot),
    },
  };
}

export function decisionExplanationRows(explanation) {
  return explanation.sections.flatMap((section) => {
    const candidates = section.interested_faculty.length ? section.interested_faculty : [{}];
    return candidates.map((candidate) => ({
      term_code: section.term_code,
      division: section.division,
      assignment_group_id: section.assignment_group_id,
      course: section.section?.primary_subject_course || "",
      crn: section.section?.primary_crn || "",
      candidate_employee_id: candidate.employee_id || "",
      candidate_name: candidate.faculty_name || "",
      seniority_rank: candidate.seniority_rank || "",
      preference_rank: candidate.preference_rank || "",
      qualified: candidate.qualified === undefined ? "" : String(candidate.qualified),
      available_at_decision: candidate.available_at_decision === undefined ? "" : String(candidate.available_at_decision),
      disposition: candidate.disposition || "",
      recommended_employee_id: section.original_system_recommendation.employee_id,
      selected_employee_id: section.chair_decision?.employee_id || "",
      decision_status: section.chair_decision?.status || "",
      exception_reason_code: section.chair_decision?.exception_reason_code || "",
      decided_at: section.chair_decision?.decided_at || "",
    }));
  });
}
