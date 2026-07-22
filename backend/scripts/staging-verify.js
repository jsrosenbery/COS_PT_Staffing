import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const baseUrl = required("STAGING_API_BASE_URL").replace(/\/$/, "");
const sessionToken = required("STAGING_SESSION_TOKEN");
const termCode = required("STAGING_TERM_CODE");
const allowedDivision = required("STAGING_ALLOWED_DIVISION");
const forbiddenDivision = required("STAGING_FORBIDDEN_DIVISION");

if (!/^https:\/\//i.test(baseUrl)) {
  throw new Error("STAGING_API_BASE_URL must use HTTPS.");
}

async function request(path, { authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authenticated ? { Authorization: `Bearer ${sessionToken}` } : {},
  });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body };
}

function expectStatus(label, result, expected) {
  if (result.status !== expected) {
    throw new Error(`${label} expected HTTP ${expected}, received ${result.status}: ${JSON.stringify(result.body)}`);
  }
  console.log(`PASS ${label} (HTTP ${result.status})`);
}

try {
  expectStatus("backend health", await request("/health", { authenticated: false }), 200);
  expectStatus("public minimal terms", await request("/terms", { authenticated: false }), 200);
  expectStatus("named session", await request("/auth/me"), 200);
  expectStatus(
    "allowed division read",
    await request(`/available-sections?termCode=${encodeURIComponent(termCode)}&divisions=${encodeURIComponent(allowedDivision)}`),
    200
  );
  expectStatus(
    "cross-division read rejection",
    await request(`/available-sections?termCode=${encodeURIComponent(termCode)}&divisions=${encodeURIComponent(forbiddenDivision)}`),
    403
  );
  console.log("Staging read-only smoke verification passed.");
} catch (error) {
  console.error(`Staging verification failed: ${error.message}`);
  process.exitCode = 1;
}
