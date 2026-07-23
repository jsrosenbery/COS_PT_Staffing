import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRawToken, hashPassword } from "../auth.js";
import { pool, query } from "../db.js";

function enabled(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function demoUsers(env) {
  return [
  {
    employee_id: "DEMO-PT-001",
    email: env.DEMO_FACULTY_EMAIL || "faculty.demo@cos.edu",
    full_name: env.DEMO_FACULTY_NAME || "Demo Part-Time Faculty",
    role: "faculty",
    division: env.DEMO_FACULTY_DIVISION || "Social Sciences",
    password: env.DEMO_FACULTY_PASSWORD || "",
  },
  {
    employee_id: "DEMO-CHAIR-001",
    email: env.DEMO_CHAIR_EMAIL || "chair.demo@cos.edu",
    full_name: env.DEMO_CHAIR_NAME || "Demo Division Chair",
    role: "chair",
    division: env.DEMO_CHAIR_DIVISION || "Social Sciences",
    password: env.DEMO_CHAIR_PASSWORD || "",
  },
  {
    employee_id: "DEMO-DEAN-001",
    email: env.DEMO_DEAN_EMAIL || "dean.demo@cos.edu",
    full_name: env.DEMO_DEAN_NAME || "Demo Dean",
    role: "dean",
    division: env.DEMO_DEAN_DIVISION || "Social Sciences",
    password: env.DEMO_DEAN_PASSWORD || "",
  },
  ];
}

export function buildUsers(env = process.env) {
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  const seedDemoUsers = enabled(env.SEED_DEMO_USERS, !production);
  if (production && seedDemoUsers) throw new Error("SEED_DEMO_USERS cannot be enabled in production.");

  const users = seedDemoUsers ? demoUsers(env) : [];
  const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (production && !adminEmail) throw new Error("ADMIN_EMAIL is required for production bootstrap.");
  if (production && !String(env.ADMIN_PASSWORD || "")) throw new Error("ADMIN_PASSWORD is required for production bootstrap.");
  if (adminEmail) {
    users.unshift({
      employee_id: env.ADMIN_EMPLOYEE_ID || "ADMIN-001",
      email: adminEmail,
      full_name: env.ADMIN_FULL_NAME || "SHERMAN Admin",
      role: "admin",
      division: env.ADMIN_DIVISION || "",
      password: env.ADMIN_PASSWORD || "",
    });
  }
  return users;
}

async function upsertUser(user, { discloseGeneratedPassword = true } = {}) {
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
    password: discloseGeneratedPassword ? (generatedPassword || "(provided via environment)") : "(not displayed)",
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

  const results = [];
  for (const user of users) {
    results.push(await upsertUser(user, {
      discloseGeneratedPassword: String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production",
    }));
  }

  console.log("Seeded login users:");
  console.table(results);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) {
  main()
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
