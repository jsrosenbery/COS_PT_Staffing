import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const visibleBrandingFiles = [
  "README.md",
  "frontend/index.html",
  "frontend/src/AdminOperationsPanel.jsx",
  "frontend/src/pt-faculty-staffing-mvp.jsx",
  "backend/emailService.js",
  "backend/routes/workflow.js",
  "backend/server.js",
  "docs/auth-production-hardening.md",
  "docs/operations/deployment-runbook.md",
  "docs/operations/environment-reference.md",
];
const formerBrandPatterns = [
  new RegExp(["S", "C", "O", "P", "E"].join("\\."), "i"),
  new RegExp(["Staffing Coordination", "Preference Engine"].join(" & "), "i"),
  new RegExp(["COS", "PT", "Staffing"].join(" "), "i"),
  new RegExp(["COS", "Part-Time Faculty Staffing"].join(" "), "i"),
];

test("user-facing application branding is SHERMAN", async () => {
  const sources = await Promise.all(
    visibleBrandingFiles.map(async (relativePath) => ({
      relativePath,
      source: await readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
    }))
  );
  const combined = sources.map(({ source }) => source).join("\n");

  assert.match(combined, /\bSHERMAN\b/);
  assert.match(
    combined.replaceAll("&amp;", "&"),
    /Seniority & Hiring Eligibility Ranking Management for Academic Needs/
  );

  for (const { relativePath, source } of sources) {
    for (const pattern of formerBrandPatterns) {
      assert.doesNotMatch(source, pattern, `former branding remains in ${relativePath}`);
    }
  }
});
