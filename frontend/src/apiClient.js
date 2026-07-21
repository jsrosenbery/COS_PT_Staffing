const RAW_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").trim() ||
  "https://cos-pt-staffing.onrender.com/api";

export const API_BASE = RAW_BASE.replace(/\/$/, "");
const API_TOKEN_STORAGE_KEY = "cos_pt_staffing_api_token";

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

export function withAuthHeaders(options = {}) {
  const API_TOKEN = getApiToken();
  if (!API_TOKEN) return options;

  const headers = new Headers(options.headers || {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${API_TOKEN}`);
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
