import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import { authenticateRequest, cleanupExpiredAuthRecords, publicAuthPaths } from "./auth.js";
import { assertProductionConfig, correlationId, logError, publicError, securityHeaders } from "./security.js";
import authRoutes from "./routes/auth.js";
import persistenceRoutes from "./routes/persistence.js";
import workflowRoutes from "./routes/workflow.js";

dotenv.config();
assertProductionConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const API_TOKEN = (process.env.API_TOKEN || "").trim();
const AUTH_DISABLED = String(process.env.AUTH_DISABLED || "").toLowerCase() === "true";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "").trim();
const API_TOKEN_AUTH_ENABLED = String(process.env.API_TOKEN_AUTH_ENABLED ?? (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() === "true";
const authConfigured = (API_TOKEN_AUTH_ENABLED && Boolean(API_TOKEN)) || AUTH_DISABLED;

if (!authConfigured && API_TOKEN_AUTH_ENABLED) {
  console.warn("API_TOKEN is not set. Configure it for initial admin/bootstrap access before user accounts exist.");
}

const corsOrigins = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
if (corsOrigins.length || AUTH_DISABLED) {
  app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
}
app.use(express.json({ limit: "10mb" }));
app.use(correlationId);
app.use(securityHeaders);

app.use(async (req, res, next) => {
  if (req.method === "OPTIONS" || req.path === "/api/health" || publicAuthPaths.has(req.path) || AUTH_DISABLED) {
    return next();
  }

  if (req.method === "GET" && req.path === "/api/terms") {
    return next();
  }

  try {
    const auth = await authenticateRequest(req);
    if (auth) {
      req.auth = auth;
      return next();
    }
  } catch (error) {
    logError("auth-middleware", error, req);
    return publicError(res, 500, "AUTHENTICATION_ERROR", "Authentication failed.", req.correlationId);
  }

  return publicError(res, 401, "UNAUTHORIZED", "Unauthorized", req.correlationId);
});

async function ensureSchema() {
  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) return;

  const sql = fs.readFileSync(schemaPath, "utf8").trim();
  if (!sql) return;

  await query(sql);
  console.log("Schema ready.");
}

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    logError("health", e, { originalUrl: "/api/health" });
    res.status(500).json({ error: "Health check failed." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api", persistenceRoutes);
app.use("/api", workflowRoutes);

ensureSchema().then(() => {
  cleanupExpiredAuthRecords().catch((error) => console.error("[auth-cleanup]", error));
  setInterval(() => {
    cleanupExpiredAuthRecords().catch((error) => console.error("[auth-cleanup]", error));
  }, 60 * 60 * 1000).unref?.();
  app.listen(PORT, () => console.log(`S.C.O.P.E. backend listening on port ${PORT}`));
}).catch((error) => {
  console.error("[startup]", error);
  process.exit(1);
});
