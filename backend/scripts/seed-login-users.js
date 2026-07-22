import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRawToken, hashPassword } from "../auth.js";
import { pool, query } from "../db.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

const demoUsers = [
  {
    employee_id: "DEMO-PT-001",
    email: process.env.DEMO_FACULTY_EMAIL || "faculty.demo@cos.edu",
    full_name: process.env.DEMO_FACULTY_NAME || "Demo Part-Time Faculty",
    role: "faculty",
    division: process.env.DEMO_FACULTY_DIVISION || "Social Sciences",
    password: process.env.DEMO_FACULTY_PASSWORD || "",
  },
  {
    employee_id: "DEMO-CHAIR-001",
    email: process.env.DEMO_CHAIR_EMAIL || "chair.demo@cos.edu",
    full_name: process.env.DEMO_CHAIR_NAME || "Demo Division Chair",
    role: "chair",
    division: process.env.DEMO_CHAIR_DIVISION || "Social Sciences",
    password: process.env.DEMO_CHAIR_PASSWORD || "",
  },
  {
    employee_id: "DEMO-DEAN-001",
    email: process.env.DEMO_DEAN_EMAIL || "dean.demo@cos.edu",
    full_name: process.env.DEMO_DEAN_NAME || "Demo Dean",
    role: "dean",
    division: process.env.DEMO_DEAN_DIVISION || "Social Sciences",
    password: process.env.DEMO_DEAN_PASSWORD || "",
  },
];

function buildUsers() {
  const users = [...demoUsers];
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (adminEmail) {
    users.unshift({
      employee_id: process.env.ADMIN_EMPLOYEE_ID || "ADMIN-001",
      email: adminEmail,
      full_name: process.env.ADMIN_FULL_NAME || "S.C.O.P.E. Admin",
      role: "admin",
      division: process.env.ADMIN_DIVISION || "",
      password: process.env.ADMIN_PASSWORD || "",
    });
  }
  return users;
}

async function ensureSchema() {
  const schemaPath = path.join(backendRoot, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8").trim();
  if (sql) await query(sql);
}

async function upsertUser(user) {
  const generatedPassword = user.password ? "" : createRawToken(18);
  const password = user.password || generatedPassword;
  const passwordRecord = await hashPassword(password);

  await query(
    `INSERT INTO scope_users
      (employee_id, email, full_name, role, division, active_status, password_hash, password_salt, password_set_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET
       employee_id = EXCLUDED.employee_id,
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role,
       division = EXCLUDED.division,
       active_status = 'active',
       password_hash = EXCLUDED.password_hash,
       password_salt = EXCLUDED.password_salt,
       password_set_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [
      user.employee_id,
      user.email,
      user.full_name,
      user.role,
      user.division,
      passwordRecord.hash,
      passwordRecord.salt,
    ]
  );
  await query(
    `UPDATE scope_user_sessions
     SET revoked_at = NOW()
     WHERE user_id IN (SELECT id FROM scope_users WHERE email = $1)
       AND revoked_at IS NULL`,
    [user.email]
  );

  return {
    email: user.email,
    role: user.role,
    division: user.division || "",
    password: generatedPassword || "(provided via environment)",
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Run this against the backend database you want to seed.");
  }

  const users = buildUsers();
  if (!users.some((user) => user.role === "admin")) {
    console.warn("ADMIN_EMAIL was not set, so no admin user was created.");
  }

  await ensureSchema();
  const results = [];
  for (const user of users) {
    results.push(await upsertUser(user));
  }

  console.log("Seeded login users:");
  console.table(results);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
