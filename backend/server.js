import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import { authenticateRequest, publicAuthPaths } from "./auth.js";
import authRoutes from "./routes/auth.js";
import persistenceRoutes from "./routes/persistence.js";
import workflowRoutes from "./routes/workflow.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const API_TOKEN = (process.env.API_TOKEN || "").trim();
const AUTH_DISABLED = String(process.env.AUTH_DISABLED || "").toLowerCase() === "true";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "").trim();
const authConfigured = Boolean(API_TOKEN) || AUTH_DISABLED;

if (!authConfigured) {
  console.warn("API_TOKEN is not set. Configure it for initial admin/bootstrap access before user accounts exist.");
}

const corsOrigins = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
if (corsOrigins.length || AUTH_DISABLED) {
  app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
}
app.use(express.json({ limit: "10mb" }));

app.use(async (req, res, next) => {
  if (req.method === "OPTIONS" || req.path === "/api/health" || publicAuthPaths.has(req.path) || AUTH_DISABLED) {
    return next();
  }

  try {
    const auth = await authenticateRequest(req);
    if (auth) {
      req.auth = auth;
      return next();
    }
  } catch (error) {
    return res.status(500).json({ error: error.message || "Authentication failed." });
  }

  return res.status(401).json({ error: "Unauthorized" });
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
    res.status(500).json({ error: e.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api", persistenceRoutes);
app.use("/api", workflowRoutes);

ensureSchema().then(() => {
  app.listen(PORT, () => console.log(`S.C.O.P.E. backend listening on port ${PORT}`));
});
