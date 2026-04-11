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

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
  app.listen(PORT, () => console.log("Server running on " + PORT));
});
