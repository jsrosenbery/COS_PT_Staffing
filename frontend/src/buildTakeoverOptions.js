export function buildTakeoverOptions(section) {
  if (!section?.candidates?.length) return [];

  return section.candidates
    .filter((row) => !row.has_tentative_assignment && !row.section_assigned_to_other && !row.has_assignment_conflict)
    .sort((a, b) => {
      const aRank = Number.isFinite(Number(a.seniority_rank)) ? Number(a.seniority_rank) : 999999;
      const bRank = Number.isFinite(Number(b.seniority_rank)) ? Number(b.seniority_rank) : 999999;
      if (aRank !== bRank) return aRank - bRank;
      const aPref = Number.isFinite(Number(a.preference_rank)) ? Number(a.preference_rank) : 999999;
      const bPref = Number.isFinite(Number(b.preference_rank)) ? Number(b.preference_rank) : 999999;
      if (aPref !== bPref) return aPref - bPref;
      return String(a.faculty_name || a.employee_id || "").localeCompare(String(b.faculty_name || b.employee_id || ""));
    });
}

function parseRemovalDetail(detail = "") {
  const match = String(detail).match(/Removed tentative assignment\s+(.+?)\s+from\s+(.+)$/i);
  if (!match) return null;
  return {
    assignment_group_id: match[1]?.trim(),
    previousFaculty: match[2]?.trim(),
  };
}

export function buildVacancyCards({ decisionLogs = [], sectionQueue = [], takeoverBenchByGroup = new Map(), currentAssignmentByGroup = new Map() }) {
  const latestByGroup = new Map();

  decisionLogs
    .filter((entry) => entry?.event_type === "assignment_removed")
    .forEach((entry) => {
      const parsed = parseRemovalDetail(entry.detail);
      if (!parsed?.assignment_group_id) return;
      const existing = latestByGroup.get(parsed.assignment_group_id);
      const entryTime = new Date(entry.created_at || 0).getTime();
      const existingTime = existing ? new Date(existing.created_at || 0).getTime() : -Infinity;
      if (!existing || entryTime >= existingTime) {
        latestByGroup.set(parsed.assignment_group_id, { ...entry, ...parsed });
      }
    });

  return Array.from(latestByGroup.values())
    .map((entry) => {
      if (currentAssignmentByGroup.get(entry.assignment_group_id)) return null;
      const section = sectionQueue.find((item) => item.assignment_group_id === entry.assignment_group_id);
      if (!section) return null;
      const options = takeoverBenchByGroup.get(entry.assignment_group_id) || [];
      return {
        assignment_group_id: entry.assignment_group_id,
        previousFaculty: entry.previousFaculty,
        removedAtLabel: entry.created_at ? new Date(entry.created_at).toLocaleString() : "",
        topOption: options[0] || null,
        options,
        ...section,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const at = new Date(a.removedAtLabel || 0).getTime();
      const bt = new Date(b.removedAtLabel || 0).getTime();
      return bt - at;
    });
}


export function buildRecoveryReasons(option = {}) {
  const reasons = [];
  if (!option.has_assignment_conflict) reasons.push('No time conflict');
  if (option.preference_rank && Number(option.preference_rank) <= 3) reasons.push(`Strong preference match (#${option.preference_rank})`);
  if (option.seniority_rank) reasons.push(`Seniority #${option.seniority_rank}`);
  if (option.assigned_elsewhere) reasons.push('Already carries another tentative section');
  if (option.section_assigned_to_other) reasons.push('Already attached to another section');
  if (!reasons.length) reasons.push('Visible in live recovery queue');
  return reasons;
}

export function buildRecoveryAuditQuickFilters() {
  return [
    { key: 'vacancy', label: 'Vacancy events', eventTypes: ['assignment_removed'] },
    { key: 'reassignment', label: 'Reassignments', eventTypes: ['assignment_created', 'assignment_updated'] },
    { key: 'overrides', label: 'Overrides', eventTypes: ['assignment_created', 'assignment_updated'], searchHint: 'rationale' },
  ];
}
