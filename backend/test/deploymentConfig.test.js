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
