import pkg from "pg";
const { Pool } = pkg;

export function databaseSslConfig(env = process.env) {
  const configured = String(env.DATABASE_SSL || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(configured)) return false;
  if (["1", "true", "yes", "on"].includes(configured)) return { rejectUnauthorized: false };
  return env.DATABASE_URL ? { rejectUnauthorized: false } : false;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig(),
});

export const query = (text, params) => pool.query(text, params);
