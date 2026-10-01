import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { reclassifyRetentionDocuments } from "../server/retentionDocuments";
async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  try {
    const report = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(20260930,120000)`);
      await tx.execute(sql`set local lock_timeout='10s'`);
      await tx.execute(
        sql.raw(
          readFileSync(
            new URL(
              "../drizzle/20260930120000_retention_documents.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
      );
      return reclassifyRetentionDocuments(tx);
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await (db as any).$client?.end();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
