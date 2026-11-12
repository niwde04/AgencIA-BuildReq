import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const target = new URL(connectionString);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await client.query(
      readFileSync(
        new URL(
          "../drizzle/20261112170000_inventory_cutoff_report.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const { rows } = await client.query(
      `select s.id, s."sourceKey", s."capturedAt", s."rowsCount",
         (select count(*)::int from public."inventoryReportSnapshotRows" r where r."snapshotId"=s.id) as "storedRows"
       from public."inventoryReportSnapshots" s where s."sourceKey"='activation-v1'`
    );
    assert.equal(rows.length, 1, "Activation snapshot is missing");
    assert.equal(
      rows[0].storedRows,
      rows[0].rowsCount,
      "Snapshot row count differs"
    );
    const tables = await client.query(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1::text[])`,
      [
        [
          "inventoryReportSnapshots",
          "inventoryReportSnapshotRows",
          "inventoryReportStockChanges",
        ],
      ]
    );
    assert.equal(tables.rowCount, 3);
    assert.ok(tables.rows.every(row => row.relrowsecurity));
    console.log(
      JSON.stringify(
        {
          migration: "inventory_cutoff_report",
          host: target.hostname,
          activation: rows[0],
          rlsTables: tables.rowCount,
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
  console.error("Inventory report migration failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
