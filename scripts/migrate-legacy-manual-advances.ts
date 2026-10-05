import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    await client.query(
      readFileSync(
        new URL(
          "../drizzle/20261005223104_legacy_manual_advances.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    console.log(
      "Compatibilidad para amortización histórica instalada; no se reclasificó ningún anticipo."
    );
  } finally {
    await client.end();
  }
}
main().catch(error => {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
});
