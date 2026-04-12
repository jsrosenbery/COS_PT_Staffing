const RAW_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").trim() ||
  "https://cos-pt-staffing.onrender.com/api";

export const API_BASE = RAW_BASE.replace(/\/$/, "");

export async function fetchJson(path, options = {}) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${API_BASE}${normalizedPath}`, options);

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
