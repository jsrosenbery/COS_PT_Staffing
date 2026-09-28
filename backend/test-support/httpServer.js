import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

// Exercise server.js itself, including authentication and the production route
// mounts. The caller supplies a disposable database schema and synthetic users.
export async function startHttpServer() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env, PORT: String(port), NODE_ENV: "test",
      AUTH_DISABLED: "false", API_TOKEN_AUTH_ENABLED: "false",
      EMAIL_PROVIDER: "console", RATE_LIMIT_STORE: "memory",
      RUN_MIGRATIONS_ON_STARTUP: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`HTTP server startup timed out: ${output}`)), 15_000);
      const finish = (error) => { clearTimeout(timer); error ? reject(error) : resolve(); };
      child.once("error", finish);
      child.once("exit", code => finish(new Error(`HTTP server exited (${code}): ${output}`)));
      child.stderr.on("data", chunk => { output += chunk; });
      child.stdout.on("data", chunk => {
        output += chunk;
        if (output.includes(`SHERMAN backend listening on port ${port}`)) finish();
      });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    url: `http://127.0.0.1:${port}/api`,
    async close() {
      if (child.exitCode !== null) return;
      const exited = once(child, "exit");
      child.kill();
      await exited;
    },
  };
}
