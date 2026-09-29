import { spawn, spawnSync } from 'node:child_process';

// Never use the production API fallback in browser tests.
const env = { ...process.env, VITE_API_BASE_URL: 'http://127.0.0.1:4317/api', VITE_API_TOKEN_AUTH_ENABLED: 'false' };
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { env, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { preview.kill(); process.exit(); });
preview.on('exit', code => process.exit(code || 0));
