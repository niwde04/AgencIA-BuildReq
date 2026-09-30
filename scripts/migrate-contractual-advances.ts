import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";
async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    await client.connect();
    await client.query(
      readFileSync(
        new URL(
          "../drizzle/20260930_contractual_advances.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    console.log(
      "Migración aditiva de anticipos contractuales aplicada. No se regularizó ningún anticipo histórico."
    );
  } finally {
    await client.end();
  }
}
main().catch(error => {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
});
