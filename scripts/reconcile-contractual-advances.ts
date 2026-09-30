import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb } from "../server/db";
import {
  inspectGeo,
  listAdvanceReconciliationCandidates,
  regularizeGeo,
} from "../server/advanceReconciliation";
async function main() {
  const apply = process.argv.includes("--apply-geo");
  if (apply && !process.argv.includes("--compatible-app-installed"))
    throw new Error(
      "Instale y verifique primero la aplicación compatible; confirme con --compatible-app-installed."
    );
  const out = resolve("output/contractual-advances");
  mkdirSync(out, { recursive: true });
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // This maintenance process must not log the pg client object or connection secrets.
  (db as any).$client.removeAllListeners("error");
  (db as any).$client.on("error", (error: any) =>
    console.error({ message: error.message, code: error.code })
  );
  try {
    const candidates: any[] = [];
    let cursor = 0;
    for (;;) {
      const page = await listAdvanceReconciliationCandidates(db, cursor);
      candidates.push(...page);
      if (page.length < 100) break;
      cursor = page[page.length - 1].id;
    }
    writeFileSync(
      join(out, "other-reconciliation-candidates.json"),
      JSON.stringify(candidates, null, 2)
    );
    let preview;
    try {
      preview = await db.transaction(tx => regularizeGeo(tx));
    } catch (error: any) {
      const current = await db.transaction(tx => inspectGeo(tx));
      writeFileSync(
        join(out, "geo-blocked.json"),
        JSON.stringify(
          { changed: false, reason: error.message, current },
          null,
          2
        )
      );
      console.log(
        JSON.stringify(
          {
            apply,
            changed: false,
            geoBlockedReason: error.message,
            otherCandidates: candidates.length,
          },
          null,
          2
        )
      );
      if (apply) process.exitCode = 1;
      return;
    }
    const backup = join(out, `geo-before-${Date.now()}.json`);
    writeFileSync(backup, JSON.stringify(preview, null, 2));
    const result = apply
      ? await db.transaction(tx => regularizeGeo(tx, { apply: true }))
      : preview;
    if (result.changed || result.alreadyApplied) {
      const geoIndex = candidates.findIndex(row => row.id === 1953);
      if (geoIndex >= 0) candidates.splice(geoIndex, 1);
      writeFileSync(
        join(out, "other-reconciliation-candidates.json"),
        JSON.stringify(candidates, null, 2)
      );
    }
    writeFileSync(
      join(out, "geo-reconciliation.json"),
      JSON.stringify(result, null, 2)
    );
    console.log(
      JSON.stringify(
        {
          apply,
          changed: result.changed,
          alreadyApplied: result.alreadyApplied,
          expected: result.expected,
          otherCandidates: candidates.length,
          backup,
        },
        null,
        2
      )
    );
  } finally {
    await (db as any).$client.end();
  }
}
main().catch(error => {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
});
