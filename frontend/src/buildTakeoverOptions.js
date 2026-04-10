
export function buildTakeoverOptions(candidates = [], currentAssignment = null) {
  const currentEmployeeId = currentAssignment?.employee_id || null;

  return [...candidates]
    .filter((row) => row && row.employee_id && row.employee_id !== currentEmployeeId)
    .filter((row) => !row.has_assignment_conflict)
    .filter((row) => !row.has_tentative_assignment)
    .sort((a, b) => {
      const aAssignedElsewhere = a.assigned_elsewhere ? 1 : 0;
      const bAssignedElsewhere = b.assigned_elsewhere ? 1 : 0;
      if (aAssignedElsewhere !== bAssignedElsewhere) return aAssignedElsewhere - bAssignedElsewhere;

      const aRank = Number.isFinite(Number(a.seniority_rank)) ? Number(a.seniority_rank) : 999999;
      const bRank = Number.isFinite(Number(b.seniority_rank)) ? Number(b.seniority_rank) : 999999;
      if (aRank !== bRank) return aRank - bRank;

      const aPref = Number.isFinite(Number(a.preference_rank)) ? Number(a.preference_rank) : 999999;
      const bPref = Number.isFinite(Number(b.preference_rank)) ? Number(b.preference_rank) : 999999;
      if (aPref !== bPref) return aPref - bPref;

      return String(a.faculty_name || a.employee_id || "").localeCompare(String(b.faculty_name || b.employee_id || ""));
    });
}
