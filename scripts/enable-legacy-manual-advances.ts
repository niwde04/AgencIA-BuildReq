import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getDb } from "../server/db";
import { enableLegacyManualAdvances } from "../server/legacyManualAdvances";

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && !process.argv.includes("--compatible-app-installed"))
    throw new Error(
      "Publique y verifique primero el código compatible; confirme con --compatible-app-installed."
    );
  if (apply) {
    // This exact Cloud case must never be activated while either deployed reader is old.
    if (
      new URL(process.env.SUPABASE_URL ?? "").hostname !==
      "ovaergjxbzrirmdwnwot.supabase.co"
    )
      throw new Error("Proyecto Supabase inesperado para esta habilitación.");
    const site = "https://buildreq.aibdev.com";
    const health = await fetch(`${site}/health`, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const deployedHealth = await health.json();
    if (
      !health.ok ||
      deployedHealth.capabilities?.legacyManualAdvances !== 1 ||
      deployedHealth.legacyManualCaptureEnabled !== true
    )
      throw new Error(
        "El servidor Cloud todavía no publica soporte de amortización histórica; no se habilitaron anticipos."
      );
    const page = await fetch(site, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const asset = (await page.text()).match(/src="(\/assets\/[^"/]+\.js)"/);
    if (!page.ok || !asset)
      throw new Error("No se pudo verificar el cliente publicado.");
    const js = await fetch(`${site}${asset[1]}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (
      !js.ok ||
      !(await js.text()).includes("Amortización manual de anticipo histórico")
    )
      throw new Error(
        "El cliente Cloud todavía no publica la captura histórica; no se habilitaron anticipos."
      );
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const out = resolve("output/legacy-manual-advances");
  mkdirSync(out, { recursive: true });
  try {
    const preview = await db.transaction(tx => enableLegacyManualAdvances(tx));
    const backup = join(out, `before-${Date.now()}.json`);
    writeFileSync(backup, JSON.stringify(preview, null, 2));
    const result = apply
      ? await db.transaction(tx =>
          enableLegacyManualAdvances(tx, { apply: true })
        )
      : preview;
    writeFileSync(
      join(out, "activation.json"),
      JSON.stringify(result, null, 2)
    );
    console.log(
      JSON.stringify({
        apply,
        changed: result.changed,
        alreadyApplied: result.alreadyApplied,
        operationKey: result.operationKey,
        backup,
      })
    );
  } finally {
    await (db as any).$client?.end();
  }
}
main().catch(error => {
  console.error({ message: error.message, code: error.code });
  process.exitCode = 1;
});
