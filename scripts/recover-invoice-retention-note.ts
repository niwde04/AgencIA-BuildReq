import "dotenv/config";
import { pathToFileURL } from "node:url";
import { getDb } from "../server/db";
import { recoverInvoiceRetentionNote } from "../server/retentionNoteRecovery";

/** Intentionally limited to the one approved invoice in the SSH database. */
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !["--dry-run", "--apply"].includes(args[0]))
    throw new Error(
      "Uso: tsx scripts/recover-invoice-retention-note.ts --dry-run|--apply"
    );
  const target = new URL(process.env.DATABASE_URL || "");
  if (
    !["covi-supabase-kge7a7-supabase-db", "192.168.10.82"].includes(
      target.hostname
    ) ||
    target.pathname !== "/postgres" ||
    !["", "5432"].includes(target.port)
  )
    throw new Error(
      "La recuperación solo está autorizada para la base SSH de BuildReq"
    );
  try {
    const result = await recoverInvoiceRetentionNote({
      invoiceId: 1837,
      invoiceNumber: "FT-018-00000443",
      retentionCode: "RT15",
      expectedAmount: "4568.4000",
      mode: args[0] === "--apply" ? "apply" : "dry-run",
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await ((await getDb()) as any)?.$client?.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    console.error("Recuperación de nota fallida", {
      message: error.message,
      code: error.code,
    });
    process.exitCode = 1;
  });
