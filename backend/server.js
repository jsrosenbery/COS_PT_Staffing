import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool, query } from "./db.js";
import { authenticateRequest, cleanupExpiredAuthRecords, publicAuthPaths } from "./auth.js";
import { runMigrations } from "./migrations.js";
import { assertProductionConfig, correlationId, isPublicApiRequest, logError, publicError, securityHeaders } from "./security.js";
import authRoutes from "./routes/auth.js";
import persistenceRoutes from "./routes/persistence.js";
import workflowRoutes from "./routes/workflow.js";

dotenv.config();
assertProductionConfig();

const app = express();
const PORT = process.env.PORT || 10000;
const API_TOKEN = (process.env.API_TOKEN || "").trim();
const AUTH_DISABLED = String(process.env.AUTH_DISABLED || "").toLowerCase() === "true";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "").trim();
const API_TOKEN_AUTH_ENABLED = String(process.env.API_TOKEN_AUTH_ENABLED ?? (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() === "true";
const RUN_MIGRATIONS_ON_STARTUP = String(process.env.RUN_MIGRATIONS_ON_STARTUP || "").trim().toLowerCase() === "true";
const DEPLOY_COMMIT = (
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  process.env.GIT_COMMIT ||
  ""
).trim();
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
  if (isPublicApiRequest(req, { authDisabled: AUTH_DISABLED, publicAuthPaths })) {
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

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({
      ok: true,
      commit: DEPLOY_COMMIT || null,
      nodeEnv: process.env.NODE_ENV || "",
    });
  } catch (e) {
    logError("health", e, { originalUrl: "/api/health" });
    res.status(500).json({ error: "Health check failed." });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api", persistenceRoutes);
app.use("/api", workflowRoutes);

async function start() {
  if (RUN_MIGRATIONS_ON_STARTUP) {
    console.log("[migrations] RUN_MIGRATIONS_ON_STARTUP=true; applying pending migrations before listening.");
    await runMigrations({ pool });
  }

  cleanupExpiredAuthRecords().catch((error) => console.error("[auth-cleanup]", error));
  setInterval(() => {
    cleanupExpiredAuthRecords().catch((error) => console.error("[auth-cleanup]", error));
  }, 60 * 60 * 1000).unref?.();
  app.listen(PORT, () => console.log(`SHERMAN backend listening on port ${PORT}`));
}

start().catch((error) => {
  console.error("[startup]", error);
  process.exit(1);
});
