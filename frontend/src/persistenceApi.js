import { fetchJson } from "./apiClient";

export async function saveRoles(rows) {
  return fetchJson("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Array.isArray(rows) ? rows : []),
  }, "Could not save role directory.");
}

export async function loadRoles() {
  return fetchJson("/api/roles", {}, "Could not load role directory.");
}

export async function savePTFaculty(rows) {
  return fetchJson("/api/pt-faculty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Array.isArray(rows) ? rows : []),
  }, "Could not save PT roster.");
}

export async function loadPTFaculty(options = {}) {
  const params = new URLSearchParams();
  if (options.includeInactive) params.set("includeInactive", "1");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson(`/api/pt-faculty${suffix}`, {}, "Could not load PT roster.");
}

export async function wipePTFaculty() {
  return fetchJson("/api/pt-faculty", {
    method: "DELETE",
  }, "Could not wipe PT roster.");
}
