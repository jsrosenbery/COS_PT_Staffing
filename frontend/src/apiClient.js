const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim();

export const API_BASE = (RAW_API_BASE || "https://cos-pt-staffing.onrender.com").replace(/\/$/, "");

export async function fetchJson(path, options = {}, fallbackMessage = "Request failed.") {
  const target = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(target, options);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!isJson) {
    const text = await response.text();
    const looksHtml = /^\s*</.test(text);
    if (looksHtml) {
      throw new Error(
        `Backend returned HTML instead of JSON for ${path}. Check VITE_API_BASE_URL and confirm the backend route exists.`
      );
    }
    throw new Error(fallbackMessage);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || fallbackMessage);
  }
  return data;
}
