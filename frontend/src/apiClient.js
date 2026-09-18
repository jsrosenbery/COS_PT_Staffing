const VITE_ENV = import.meta.env || {};
const RAW_BASE =
  (VITE_ENV.VITE_API_BASE_URL || "").trim() ||
  "https://cos-pt-staffing.onrender.com/api";

export const API_BASE = RAW_BASE.replace(/\/$/, "");
export const API_TOKEN_AUTH_ENABLED =
  String(VITE_ENV.VITE_API_TOKEN_AUTH_ENABLED || "").trim().toLowerCase() === "true" ||
  (VITE_ENV.DEV && String(VITE_ENV.VITE_API_TOKEN_AUTH_ENABLED || "").trim() !== "false");
let apiTokenInMemory = "";
let sessionTokenInMemory = "";
let currentUserInMemory = null;

export function getApiToken() {
  return apiTokenInMemory;
}

export function setApiToken(token) {
  apiTokenInMemory = String(token || "").trim();
}

export function clearApiToken() {
  setApiToken("");
}

export function getSessionToken() {
  return sessionTokenInMemory;
}

export function getCurrentUser() {
  return currentUserInMemory;
}

export function setSession(session, user) {
  const token = String(session?.token || "").trim();
  sessionTokenInMemory = token;

  currentUserInMemory = user || null;
}

export function clearSession() {
  setSession(null, null);
}

export function withAuthHeaders(options = {}) {
  if (options.skipAuth) {
    const { skipAuth, ...rest } = options;
    return rest;
  }
  const sessionToken = getSessionToken();
  const apiToken = API_TOKEN_AUTH_ENABLED ? getApiToken() : "";
  const token = sessionToken || apiToken;
  if (!token) return options;

  const headers = new Headers(options.headers || {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...options, headers };
}

export function apiFetch(input, options = {}) {
  return fetch(input, withAuthHeaders(options));
}

export async function fetchJson(path, options = {}) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await apiFetch(`${API_BASE}${normalizedPath}`, options);

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!response.ok) {
    try {
      const data = text ? JSON.parse(text) : {};
      const correlation = data.correlationId ? ` Reference: ${data.correlationId}` : "";
      throw new Error(`${data.error || data.message || `Request failed with status ${response.status}`}${correlation}`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(text || `Request failed with status ${response.status}`);
      }
      throw error;
    }
  }

  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
    throw new Error("Expected JSON from backend but received HTML. Check VITE_API_BASE_URL and backend routes.");
  }

  if (contentType.includes("application/json")) {
    return text ? JSON.parse(text) : {};
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Backend response was not valid JSON.");
  }
}

export async function login(email, password) {
  const data = await fetchJson("/auth/login", {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  setSession(data.session, data.user);
  return data;
}

export async function logout() {
  try {
    await fetchJson("/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
}

export async function fetchCurrentUser() {
  const data = await fetchJson("/auth/me");
  if (data.user) setSession({ token: getSessionToken() }, data.user);
  return data.user || null;
}

export async function inviteUser(payload) {
  return fetchJson("/auth/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function requestAccount(payload) {
  return fetchJson("/auth/request-account", {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadAccountRequests(status = "pending") {
  return fetchJson(`/auth/account-requests?status=${encodeURIComponent(status)}`);
}

export async function approveAccountRequest(id) {
  return fetchJson(`/auth/account-requests/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

export async function rejectAccountRequest(id) {
  return fetchJson(`/auth/account-requests/${encodeURIComponent(id)}/reject`, { method: "POST" });
}

export async function loadUsers() {
  return fetchJson("/auth/users");
}

export async function updateUser(id, payload) {
  return fetchJson(`/auth/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(id) {
  return fetchJson(`/auth/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function resendUserInvite(id) {
  return fetchJson(`/auth/users/${encodeURIComponent(id)}/resend-invite`, { method: "POST" });
}

export async function sendUserPasswordReset(id) {
  return fetchJson(`/auth/users/${encodeURIComponent(id)}/password-reset`, { method: "POST" });
}

export async function sendDissemination(payload) {
  return fetchJson("/dissemination/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function requestPasswordReset(email) {
  return fetchJson("/auth/password-reset/request", {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

export async function completePasswordReset(token, password) {
  const data = await fetchJson("/auth/password-reset/complete", {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  setSession(data.session, data.user);
  return data;
}

export async function acceptInvite(token, password, fullName = "") {
  const data = await fetchJson("/auth/accept-invite", {
    method: "POST",
    skipAuth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password, full_name: fullName }),
  });
  setSession(data.session, data.user);
  return data;
}
