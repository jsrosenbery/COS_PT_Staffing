import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
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
  console.warn("API_TOKEN is not set. Protected API routes will return 503 until it is configured.");
}

const corsOrigins = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
if (corsOrigins.length || AUTH_DISABLED) {
  app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
}
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  if (req.method === "OPTIONS" || req.path === "/api/health" || AUTH_DISABLED) return next();

  if (!API_TOKEN) {
    return res.status(503).json({ error: "API_TOKEN is not configured on the backend." });
  }

  const auth = req.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey = req.get("x-api-token") || "";
  if (bearer === API_TOKEN || apiKey === API_TOKEN) return next();

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

app.use("/api", persistenceRoutes);
app.use("/api", workflowRoutes);

ensureSchema().then(() => {
  app.listen(PORT, () => console.log(`S.C.O.P.E. backend listening on port ${PORT}`));
});
