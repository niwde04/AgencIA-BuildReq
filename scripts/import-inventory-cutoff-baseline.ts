/** Imports an offline, verified inventory-only artifact; never changes live stock. */
import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main() {
  const args = process.argv.slice(2);
  assert.ok(
    args.length === 2 && args[0] === "--file",
    "Usage: tsx scripts/import-inventory-cutoff-baseline.ts --file PRIVATE_BASELINE.json"
  );
  const payload = JSON.parse(readFileSync(args[1], "utf8"));
  assert.equal(payload.format, "buildreq-inventory-cutoff-baseline-v1");
  assert.equal(payload.kind, "backup");
  assert.match(payload.sourceKey, /^cloud-backup-[0-9A-Za-z_-]+$/);
  assert.match(payload.sourceHash, /^[0-9a-f]{64}$/);
  assert.ok(
    Number.isFinite(Date.parse(payload.capturedAt)),
    "Invalid capture timestamp"
  );
  assert.ok(
    payload.metadata &&
      typeof payload.metadata === "object" &&
      !Array.isArray(payload.metadata)
  );
  assert.ok(Array.isArray(payload.rows) && payload.rows.length <= 1_000_000);
  const ids = new Set<number>();
  for (const row of payload.rows) {
    assert.ok(
      Number.isSafeInteger(row.id) && row.id > 0 && !ids.has(row.id),
      "Invalid/duplicate inventory identity"
    );
    ids.add(row.id);
    assert.ok(
      typeof row.sapItemCode === "string" && row.sapItemCode.trim(),
      "Missing article code"
    );
    assert.ok(typeof row.name === "string", "Missing item name");
    assert.match(String(row.currentStock), /^-?\d+(?:\.\d{1,2})?$/);
    for (const field of ["projectId", "warehouseId"]) {
      assert.ok(
        row[field] === null ||
          (Number.isSafeInteger(row[field]) && row[field] > 0),
        `Invalid ${field}`
      );
    }
    assert.ok(
      row.storageLocation === null || typeof row.storageLocation === "string"
    );
    assert.equal(typeof row.isActive, "boolean");
  }
  const rowsSha256 = createHash("sha256")
    .update(JSON.stringify(payload.rows))
    .digest("hex");
  const metadata = { ...payload.metadata, rowsSha256 };
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const target = new URL(connectionString);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
  if (!local) {
    assert.equal(
      payload.projectRef,
      "ovaergjxbzrirmdwnwot",
      "Artifact project mismatch"
    );
    assert.equal(
      decodeURIComponent(target.username),
      `postgres.${payload.projectRef}`,
      "Database project mismatch"
    );
    assert.equal(
      target.hostname,
      "aws-1-us-east-1.pooler.supabase.com",
      "Unexpected Cloud host"
    );
    assert.equal(target.pathname, "/postgres", "Unexpected database");
  }
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  let inTransaction = false;
  try {
    await client.connect();
    await client.query("begin");
    inTransaction = true;
    await client.query("set local lock_timeout='5s'");
    await client.query("set local statement_timeout='120s'");
    // Serialize imports of the same source before testing existence.
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [payload.sourceKey]
    );
    const existing = await client.query(
      `select s.*, (select count(*)::int from public."inventoryReportSnapshotRows" r where r."snapshotId"=s.id) as "storedRows"
       from public."inventoryReportSnapshots" s where s."sourceKey"=$1`,
      [payload.sourceKey]
    );
    let snapshotId: number;
    let alreadyImported = false;
    if (existing.rowCount) {
      const row = existing.rows[0];
      assert.equal(
        row.sourceHash,
        payload.sourceHash,
        "Existing source hash differs"
      );
      assert.equal(
        row.capturedAt.toISOString(),
        new Date(payload.capturedAt).toISOString(),
        "Existing capture time differs"
      );
      assert.equal(row.kind, "backup");
      assert.equal(row.rowsCount, payload.rows.length);
      assert.equal(row.storedRows, payload.rows.length);
      assert.equal(
        row.metadata.rowsSha256,
        rowsSha256,
        "Existing snapshot payload differs"
      );
      snapshotId = row.id;
      alreadyImported = true;
    } else {
      const inserted = await client.query(
        `insert into public."inventoryReportSnapshots" ("sourceKey", "sourceHash", "capturedAt", kind, "rowsCount", metadata)
         values ($1,$2,$3,'backup',$4,$5::jsonb) returning id`,
        [
          payload.sourceKey,
          payload.sourceHash,
          payload.capturedAt,
          payload.rows.length,
          JSON.stringify(metadata),
        ]
      );
      snapshotId = inserted.rows[0].id;
      for (let offset = 0; offset < payload.rows.length; offset += 1_000) {
        await client.query(
          `insert into public."inventoryReportSnapshotRows" ("snapshotId", "inventoryItemId", "rowData")
           select $1, (item->>'id')::int, item from jsonb_array_elements($2::jsonb) item`,
          [
            snapshotId,
            JSON.stringify(payload.rows.slice(offset, offset + 1_000)),
          ]
        );
      }
      const count = await client.query(
        `select count(*)::int as count from public."inventoryReportSnapshotRows" where "snapshotId"=$1`,
        [snapshotId]
      );
      assert.equal(count.rows[0].count, payload.rows.length);
    }
    await client.query("commit");
    inTransaction = false;
    console.log(
      JSON.stringify(
        {
          sourceKey: payload.sourceKey,
          snapshotId,
          rows: payload.rows.length,
          sourceHash: payload.sourceHash,
          capturedAt: payload.capturedAt,
          alreadyImported,
          liveStockModified: false,
        },
        null,
        2
      )
    );
  } catch (error) {
    if (inTransaction) await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error("Inventory baseline import failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
