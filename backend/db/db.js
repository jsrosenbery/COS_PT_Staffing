const { Pool } = require("pg");

const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

if (!connectionString) {
  console.warn("No DATABASE_URL found. Database features will not work until it is set.");
}

const pool = new Pool({
  connectionString,
  ssl: connectionString ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
