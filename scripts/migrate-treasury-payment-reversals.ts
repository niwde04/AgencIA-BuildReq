import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const migrations = [
  "../drizzle/20261126000000_treasury_payment_reversal_enums.sql",
  "../drizzle/20261126000001_treasury_payment_reversals.sql",
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  try {
    // PostgreSQL requires committing newly added enum values before they can
    // be used in constraints. Each migration has its own transaction.
    for (const migration of migrations) {
      const statements = readFileSync(
        new URL(migration, import.meta.url),
        "utf8"
      );
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(20261126, 0)`);
        await tx.execute(sql`set local lock_timeout = '10s'`);
        await tx.execute(sql.raw(statements));
      });
    }
    console.log("Treasury payment reversal migrations applied.");
  } finally {
    await db.$client.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
