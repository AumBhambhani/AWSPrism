import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

export async function setup() {
  const dbUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/prism_test";

  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const initSqlPath = path.resolve(__dir, "../../../../init.sql");
  const sql = readFileSync(initSqlPath, "utf8");

  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}
