import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "./db.js";
import persistenceRoutes from "./routes/persistence.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

async function ensureSchema() {
  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    console.warn("schema.sql not found, skipping schema bootstrap.");
    return;
  }

  const sql = fs.readFileSync(schemaPath, "utf8").trim();
  if (!sql) {
    console.warn("schema.sql is empty, skipping schema bootstrap.");
    return;
  }

  try {
    await query(sql);
    console.log("Schema ready.");
  } catch (error) {
    console.error("Could not initialize schema:", error.message);
    throw error;
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use("/api", persistenceRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Unexpected server error." });
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`S.C.O.P.E. backend listening on port ${PORT}`);
    });
  })
  .catch(() => {
    process.exit(1);
  });
