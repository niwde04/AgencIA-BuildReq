import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const target = new URL(process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    await client.query(
      readFileSync(
        new URL(
          "../drizzle/20260929052542_invoice_accounting_queue.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const result = await client.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name in ('submittedForAccountingAt', 'submittedForAccountingById') order by column_name`
    );
    console.log(
      JSON.stringify(
        {
          migration: "20260929052542_invoice_accounting_queue",
          host: target.hostname,
          database: target.pathname.slice(1),
          columns: result.rows,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}
main().catch(error => {
  console.error("Invoice-accounting migration failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
