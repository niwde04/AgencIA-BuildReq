import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(20260930,120000)`);
      await tx.execute(sql`set local lock_timeout='10s'`);
      await tx.execute(
        sql.raw(
          readFileSync(
            new URL(
              "../drizzle/20261005120000_retention_print.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
      );
    });
    console.log(
      "Retenciones normales habilitadas desde la impresión; comprobantes contabilizados conservados."
    );
  } finally {
    await (db as any).$client?.end();
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
