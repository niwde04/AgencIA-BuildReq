import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/** Explicit migration: inspection is the default; never run at application startup. */
async function main() {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
    } else if (["--expect-host", "--expect-database"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error("Falta valor de destino");
      options.set(argument, value);
    } else {
      throw new Error("Argumento desconocido");
    }
  }
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
  const target = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(target.pathname.slice(1));
  if (
    target.hostname !== options.get("--expect-host") ||
    database !== options.get("--expect-database")
  ) {
    throw new Error(
      "Confirme --expect-host y --expect-database exactamente; no se aplicaron cambios"
    );
  }
  const client = new Client({ connectionString: target.toString() });
  let transaction = false;
  try {
    await client.connect();
    const identity = await client.query<{ database: string }>(
      "select current_database() as database"
    );
    if (identity.rows[0].database !== database)
      throw new Error("Destino de base inesperado");
    if (apply) {
      await client.query("BEGIN");
      transaction = true;
      await client.query("select pg_advisory_xact_lock(20261102, 120000)");
      await client.query("set local lock_timeout = '10s'");
      await client.query(
        readFileSync(
          new URL(
            "../drizzle/20261102120000_purchase_order_billing_authorizations.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
    }
    const tables = await client.query<{ name: string; rls: boolean }>(
      `select c.relname as name, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`,
      [
        [
          "purchaseOrderBillingAuthorizations",
          "purchaseOrderBillingAuthorizationUses",
        ],
      ]
    );
    const grants = await client.query<{
      grantee: string;
      table_name: string;
      privilege_type: string;
    }>(
      `select grantee, table_name, privilege_type from information_schema.table_privileges
       where table_schema='public' and table_name=any($1::text[])
       and grantee in ('anon','authenticated','PUBLIC')`,
      [
        [
          "purchaseOrderBillingAuthorizations",
          "purchaseOrderBillingAuthorizationUses",
        ],
      ]
    );
    const ready =
      tables.rows.length === 2 &&
      tables.rows.every(row => row.rls) &&
      grants.rows.length === 0;
    if (apply && !ready)
      throw new Error(
        "La verificación de tablas, RLS y permisos no fue satisfactoria"
      );
    if (transaction) {
      await client.query("COMMIT");
      transaction = false;
    }
    console.log(
      JSON.stringify({
        applied: apply,
        database,
        ready,
        tables: tables.rows,
        browserGrants: grants.rows,
      })
    );
  } catch (error) {
    if (transaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error("No se completó la migración de autorizaciones", {
    message: error.message,
    code: error.code,
  });
  process.exitCode = 1;
});
