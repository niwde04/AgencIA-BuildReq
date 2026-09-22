import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(
      "SET lock_timeout = '10s'; SET statement_timeout = '60s'"
    );
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('buildreq:migration:0142',0))"
    );
    await client.query(
      readFileSync(
        new URL("../drizzle/0142_financial_notes.sql", import.meta.url),
        "utf8"
      )
    );
    const { rows } = await client.query(
      `select type,count(*)::int concepts,count("retentionCatalogId")::int retentions from "financialNoteConcepts" group by type order by type`
    );
    const settings = await client.query(
      'select enabled,"activatedAt" from "financialNoteSettings" where id=1'
    );
    console.log(
      JSON.stringify(
        {
          migration: "0142_financial_notes",
          catalogs: rows,
          settings: settings.rows[0],
        },
        null,
        2
      )
    );
  } finally {
    // Closing also releases the session advisory lock, including on rollback.
    await client.end();
  }
}
main().catch(error => {
  console.error("Financial-note migration failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
