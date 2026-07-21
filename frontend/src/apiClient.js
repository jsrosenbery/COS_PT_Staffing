const RAW_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").trim() ||
  "https://cos-pt-staffing.onrender.com/api";

export const API_BASE = RAW_BASE.replace(/\/$/, "");
const API_TOKEN_STORAGE_KEY = "cos_pt_staffing_api_token";
const SESSION_STORAGE_KEY = "cos_pt_staffing_session_token";
const USER_STORAGE_KEY = "cos_pt_staffing_user";

export function getApiToken() {
  if (typeof window === "undefined") return "";
  return (window.sessionStorage?.getItem(API_TOKEN_STORAGE_KEY) || "").trim();
}

export function setApiToken(token) {
  if (typeof window === "undefined") return;
  const normalized = String(token || "").trim();
  if (normalized) window.sessionStorage?.setItem(API_TOKEN_STORAGE_KEY, normalized);
  else window.sessionStorage?.removeItem(API_TOKEN_STORAGE_KEY);
}

export function clearApiToken() {
  setApiToken("");
}

export function getSessionToken() {
  if (typeof window === "undefined") return "";
  return (window.sessionStorage?.getItem(SESSION_STORAGE_KEY) || "").trim();
}

export function getCurrentUser() {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage?.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(session, user) {
  if (typeof window === "undefined") return;
  const token = String(session?.token || "").trim();
  if (token) window.sessionStorage?.setItem(SESSION_STORAGE_KEY, token);
  else window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);

  if (user) window.sessionStorage?.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  else window.sessionStorage?.removeItem(USER_STORAGE_KEY);
}

export function clearSession() {
  setSession(null, null);
}

export function withAuthHeaders(options = {}) {
  const sessionToken = getSessionToken();
  const apiToken = getApiToken();
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
    throw new Error(text || `Request failed with status ${response.status}`);
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

export async function acceptInvite(token, password, fullName = "") {
  const data = await fetchJson("/auth/accept-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password, full_name: fullName }),
  });
  setSession(data.session, data.user);
  return data;
}
