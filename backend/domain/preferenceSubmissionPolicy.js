function text(value) {
  return String(value ?? "").trim();
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const preferenceSubmissionStatuses = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  FROZEN: "frozen",
  SUPERSEDED: "superseded",
  CORRECTED: "corrected",
});

export const preferenceWindowTimezone = "America/Los_Angeles";

export function validatePreferenceRanks(preferences = []) {
  const errors = [];
  const ranks = new Set();
  const sections = new Set();
  preferences.forEach((preference, index) => {
    const rank = Number(preference.preference_rank ?? preference.preferenceRank ?? preference.rank);
    const sectionId = text(preference.assignment_group_id || preference.assignmentGroupId);
    if (!Number.isInteger(rank) || rank < 1) {
      errors.push({ code: "INVALID_RANK", message: "Preference rank must be a positive integer.", index, rank: preference.preference_rank ?? preference.preferenceRank ?? preference.rank });
    } else if (ranks.has(rank)) {
      errors.push({ code: "DUPLICATE_RANK", message: `Preference rank ${rank} appears more than once.`, index, rank });
    }
    if (Number.isInteger(rank)) ranks.add(rank);
    if (!sectionId) {
      errors.push({ code: "MISSING_SECTION", message: "Preference is missing assignment_group_id.", index });
    } else if (sections.has(sectionId)) {
      errors.push({ code: "DUPLICATE_SECTION", message: `Section ${sectionId} appears more than once.`, index, assignmentGroupId: sectionId });
    }
    if (sectionId) sections.add(sectionId);
  });
  return errors;
}

export function windowState(windowRow = {}, now = new Date()) {
  const serverNow = toDate(now) || new Date();
  if (!windowRow || typeof windowRow !== "object") {
    return {
      status: "missing",
      serverNow,
      openedAt: null,
      closesAt: null,
      timezone: preferenceWindowTimezone,
      open: false,
      closed: true,
      missing: true,
    };
  }
  const closesAt = toDate(windowRow.closes_at || windowRow.closesAt);
  const openedAt = toDate(windowRow.opened_at || windowRow.openedAt);
  const status = text(windowRow.status || "open").toLowerCase();
  const isOpenByStatus = status === "open" || status === "reopened";
  const isAfterOpen = !openedAt || serverNow >= openedAt;
  const isBeforeDeadline = !closesAt || serverNow < closesAt;
  return {
    status,
    serverNow,
    openedAt,
    closesAt,
    timezone: preferenceWindowTimezone,
    open: isOpenByStatus && isAfterOpen && isBeforeDeadline,
    closed: !isOpenByStatus || !isAfterOpen || !isBeforeDeadline,
  };
}

export function canSavePreferenceVersion({ action = "submit", windowRow = {}, now = new Date(), actorRole = "faculty" }) {
  const state = windowState(windowRow, now);
  const normalizedAction = text(action || "submit").toLowerCase();
  const role = text(actorRole || "faculty").toLowerCase();
  const elevated = ["admin", "chair", "dean"].includes(role);

  if (state.open) return { ok: true, state };
  if (state.missing) {
    return {
      ok: false,
      state,
      error: "No preference window is configured for this term and division.",
    };
  }
  if (elevated && ["admin_correct", "reopen_correct"].includes(normalizedAction)) return { ok: true, state, requiresAuditReason: true };
  return {
    ok: false,
    state,
    error: "The preference window is closed. Ordinary faculty users cannot edit or submit after the deadline.",
  };
}
