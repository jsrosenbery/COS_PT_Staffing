import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Vercel frontend-root deployments serve authentication routes through the SPA", () => {
  const config = JSON.parse(
    fs.readFileSync(new URL("../../frontend/vercel.json", import.meta.url), "utf8")
  );

  assert.deepEqual(config.rewrites, [
    { source: "/accept-invite", destination: "/index.html" },
    { source: "/reset-password", destination: "/index.html" },
  ]);
});

test("backend health exposes deploy metadata for production diagnostics", () => {
  const server = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

  assert.match(server, /const DEPLOY_COMMIT/);
  assert.match(server, /RENDER_GIT_COMMIT/);
  assert.match(server, /commit: DEPLOY_COMMIT \|\| null/);
});
