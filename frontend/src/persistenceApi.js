const API_BASE = "https://cos-pt-staffing.onrender.com";

async function readJson(response, fallbackMessage) {
  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || fallbackMessage);
  }
  return data;
}

export async function saveRoles(rows) {
  const response = await fetch(`${API_BASE}/api/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Array.isArray(rows) ? rows : []),
  });
  return readJson(response, "Could not save role directory.");
}

export async function loadRoles() {
  const response = await fetch(`${API_BASE}/api/roles`);
  return readJson(response, "Could not load role directory.");
}

export async function savePTFaculty(rows) {
  const response = await fetch(`${API_BASE}/api/pt-faculty`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Array.isArray(rows) ? rows : []),
  });
  return readJson(response, "Could not save PT roster.");
}

export async function loadPTFaculty(options = {}) {
  const params = new URLSearchParams();
  if (options.includeInactive) params.set("includeInactive", "1");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE}/api/pt-faculty${suffix}`);
  return readJson(response, "Could not load PT roster.");
}

export async function wipePTFaculty() {
  const response = await fetch(`${API_BASE}/api/pt-faculty`, {
    method: "DELETE",
  });
  return readJson(response, "Could not wipe PT roster.");
}
