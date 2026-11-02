import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });
  try {
    await db.connect();
    await db.query(
      readFileSync(
        new URL(
          "../supabase/migrations/20261030015425_invoice_settlement_document_cents.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    console.log(
      "Migración aditiva de liquidación instalada. Las políticas nuevas permanecen deshabilitadas hasta su activación auditada."
    );
  } finally {
    await db.end();
  }
}
main().catch(error => {
  const cause = error.cause ?? error;
  console.error({ message: cause.message, code: cause.code });
  process.exitCode = 1;
});
