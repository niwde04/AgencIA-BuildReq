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
          "../drizzle/20260929035318_sales_tax_financial_groups.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const result = await client.query(
      `select "taxCode", "ratePercent", "financialGroupCode" from "salesTaxes" order by "displayOrder", "taxCode"`
    );
    console.log(
      JSON.stringify(
        {
          migration: "20260929035318_sales_tax_financial_groups",
          host: target.hostname,
          database: target.pathname.slice(1),
          taxes: result.rows,
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
  console.error("Sales-tax migration failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
