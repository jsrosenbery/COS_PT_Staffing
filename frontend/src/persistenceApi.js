import { fetchJson } from "./apiClient";

export const saveRoles = async (roles) =>
  fetchJson("/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(roles),
  });

export const loadRoles = async () => fetchJson("/roles");

export const savePTFaculty = async (rows) =>
  fetchJson("/pt-faculty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });

export const loadPTFaculty = async (includeInactive = false) =>
  fetchJson(`/pt-faculty${includeInactive ? "?includeInactive=1" : ""}`);

export const createStaffingWindow = async (windowPayload) =>
  fetchJson("/windows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(windowPayload),
  });

export const loadStaffingWindows = async () => fetchJson("/windows");

export const loadAuditLog = async ({
  q = "",
  eventType = "",
  division = "",
  sortBy = "created_at",
  sortDir = "desc",
} = {}) => {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (eventType) params.set("eventType", eventType);
  if (division) params.set("division", division);
  if (sortBy) params.set("sortBy", sortBy);
  if (sortDir) params.set("sortDir", sortDir);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson(`/audit${suffix}`);
};

export const appendAuditLog = async (payload) =>
  fetchJson("/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const wipeActivePTRoster = async () =>
  fetchJson("/pt-faculty", {
    method: "DELETE",
  });
