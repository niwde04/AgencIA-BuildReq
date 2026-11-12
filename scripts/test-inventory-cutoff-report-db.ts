/** Local-only integration checks. Never uses DATABASE_URL as a test target. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  resolve(root, "drizzle/20261112170000_inventory_cutoff_report.sql"),
  "utf8"
);
let assertions = 0;
function check(value: unknown, message: string) {
  assertions++;
  assert.ok(value, message);
}
function equal(actual: unknown, expected: unknown, message?: string) {
  assertions++;
  assert.deepEqual(actual, expected, message);
}

async function main() {
  const source = process.env.INVENTORY_REPORT_LOCAL_DATABASE_URL;
  if (
    !source ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(source).hostname)
  ) {
    throw new Error(
      "INVENTORY_REPORT_LOCAL_DATABASE_URL debe apuntar a PostgreSQL local."
    );
  }
  const name = `buildreq_inventory_report_test_${randomBytes(8).toString("hex")}`;
  const target = new URL(source);
  target.pathname = `/${name}`;
  const admin = new Client({ connectionString: source });
  const db = new Client({ connectionString: target.toString() });
  let created = false,
    connected = false;
  const fingerprint = async () =>
    (
      await db.query(
        `select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') as data from "inventoryItems" i`
      )
    ).rows[0].data;
  const changeCount = async () =>
    (
      await db.query(
        `select count(*)::int as count from "inventoryReportStockChanges"`
      )
    ).rows[0].count;
  async function rejected(query: string, code: string) {
    let failed = false;
    try {
      await db.query(query);
    } catch (error: any) {
      failed = true;
      equal(error.code, code, query.split(" ")[0]);
    }
    check(failed, "Expected query to be rejected");
  }
  const cli = (file: string) =>
    execFileSync(
      process.execPath,
      [
        resolve(root, "node_modules/tsx/dist/cli.mjs"),
        resolve(root, "scripts/import-inventory-cutoff-baseline.ts"),
        "--file",
        file,
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: target.toString() },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  try {
    await admin.connect();
    for (const [role, bypass] of [
      ["anon", false],
      ["authenticated", false],
      ["service_role", true],
      ["inventory_report_test_writer", false],
    ] as const) {
      const found = await admin.query(
        "select 1 from pg_roles where rolname=$1",
        [role]
      );
      if (!found.rowCount)
        await admin.query(
          `create role "${role}" nologin ${bypass ? "bypassrls" : ""}`
        );
    }
    await admin.query(`create database "${name}"`);
    created = true;
    await db.connect();
    connected = true;
    await db.query(`
      create table "inventoryItems" (
        id serial primary key, "sapItemCode" text not null, name text not null,
        description text, unit text, category text, "currentStock" numeric(12,2) not null default 0,
        "minimumStock" numeric(12,2), "projectId" int, "warehouseId" int,
        "warehouseLocation" text, "storageLocation" text, "isActive" boolean not null default true,
        "createdAt" timestamp not null default now(), "updatedAt" timestamp not null default now()
      );
      alter table "inventoryItems" enable row level security;
      insert into "inventoryItems" ("sapItemCode",name,unit,"currentStock","projectId","warehouseId","storageLocation","isActive") values
        ('0001','Artículo prueba','und',5,1,1,'A',true),
        ('0001','Artículo prueba','und',0,1,1,'B',true),
        ('0002','Artículo inactivo','gal',3,2,2,null,false);
    `);
    const before = await fingerprint();
    const beforeAccess = (
      await db.query(
        `select relrowsecurity,relacl from pg_class where oid='"inventoryItems"'::regclass`
      )
    ).rows;
    await db.query(migration);
    equal(await fingerprint(), before, "Migration does not change stock");
    equal(
      (
        await db.query(
          `select relrowsecurity,relacl from pg_class where oid='"inventoryItems"'::regclass`
        )
      ).rows,
      beforeAccess,
      "Original access stays intact"
    );
    const opening = (
      await db.query(
        `select * from "inventoryReportSnapshots" where "sourceKey"='activation-v1'`
      )
    ).rows[0];
    equal(opening.rowsCount, 3);
    equal(opening.kind, "activation");
    equal(opening.metadata, {});
    equal(
      (
        await db.query(
          `select "rowData" from "inventoryReportSnapshotRows" where "snapshotId"=$1 order by "inventoryItemId"`,
          [opening.id]
        )
      ).rows.map(row => row.rowData),
      before,
      "Zero/inactive rows included exactly"
    );
    equal(await changeCount(), 0);
    await db.query(migration);
    equal(
      (
        await db.query(
          `select count(*)::int as count from "inventoryReportSnapshots"`
        )
      ).rows[0].count,
      1
    );
    equal(
      (
        await db.query(`select * from "inventoryReportSnapshots" where id=$1`, [
          opening.id,
        ])
      ).rows[0],
      opening,
      "Rerun does not reset the opening"
    );

    await db.query(
      `update "inventoryItems" set "currentStock"=7,"projectId"=3,"warehouseId"=4,"storageLocation"='Z',unit='caja',name='Nombre corregido',"isActive"=false where id=1`
    );
    const change = (
      await db.query(`select * from "inventoryReportStockChanges" order by id`)
    ).rows[0];
    equal(String(change.beforeRow.currentStock), "5");
    equal(String(change.afterRow.currentStock), "7");
    equal(change.beforeRow.storageLocation, "A");
    equal(change.afterRow.storageLocation, "Z");
    equal(change.beforeRow.projectId, 1);
    equal(change.afterRow.projectId, 3);
    equal(change.afterRow.warehouseId, 4);
    equal(change.afterRow.unit, "caja");
    equal(change.afterRow.isActive, false);
    check(
      change.changedAt >= opening.capturedAt,
      "Registration time follows opening"
    );
    await db.query(
      `update "inventoryItems" set "updatedAt"=clock_timestamp() where id=1`
    );
    equal(
      await changeCount(),
      1,
      "Timestamp-only touch is not a report change"
    );
    await db.query(
      `insert into "inventoryItems" ("sapItemCode",name,"currentStock","storageLocation") values ('0003','Nuevo',2,'N')`
    );
    await db.query(`delete from "inventoryItems" where id=2`);
    const allChanges = (
      await db.query(`select * from "inventoryReportStockChanges" order by id`)
    ).rows;
    equal(allChanges.length, 3);
    equal(allChanges[1].beforeRow, null);
    equal(allChanges[1].afterRow.sapItemCode, "0003");
    equal(allChanges[2].inventoryItemId, 2);
    equal(allChanges[2].afterRow, null);
    equal(
      (
        await db.query(
          `select count(*)::int as count from "inventoryReportSnapshotRows" where "inventoryItemId"=2`
        )
      ).rows[0].count,
      1,
      "Deleting operational stock preserves history"
    );

    const stableStock = await fingerprint();
    const stableChanges = await changeCount();
    await db.query("begin");
    await db.query(`update "inventoryItems" set "currentStock"=99 where id=1`);
    await db.query(`delete from "inventoryItems" where id=3`);
    await db.query("rollback");
    equal(await fingerprint(), stableStock);
    equal(await changeCount(), stableChanges, "Rollback removes history too");
    await db.query(`create function pg_temp.reject_history_insert() returns trigger language plpgsql as $$begin raise exception 'test failure'; end$$;
      create trigger test_reject_history before insert on "inventoryReportStockChanges" for each row execute function pg_temp.reject_history_insert()`);
    await rejected(
      `update "inventoryItems" set "currentStock"=88 where id=1`,
      "P0001"
    );
    equal(await fingerprint(), stableStock, "History failure rolls stock back");
    await db.query(
      `drop trigger test_reject_history on "inventoryReportStockChanges"`
    );

    for (const table of [
      "inventoryReportSnapshots",
      "inventoryReportSnapshotRows",
      "inventoryReportStockChanges",
    ]) {
      const meta = (
        await db.query(
          `select relrowsecurity from pg_class where oid=$1::regclass`,
          [`"${table}"`]
        )
      ).rows[0];
      equal(meta.relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) {
        await db.query(`set role "${role}"`);
        for (const statement of [
          `select * from "${table}"`,
          `insert into "${table}" default values`,
          `update "${table}" set id=id`,
          `delete from "${table}"`,
          `truncate "${table}"`,
        ])
          await rejected(statement, "42501");
        await db.query("reset role");
      }
      await db.query("set role service_role");
      await db.query(`select count(*) from "${table}"`);
      for (const statement of [
        `insert into "${table}" default values`,
        `update "${table}" set id=id`,
        `delete from "${table}"`,
      ])
        await rejected(statement, "42501");
      await db.query("reset role");
      for (const statement of [
        `update "${table}" set id=id`,
        `delete from "${table}"`,
        `truncate "${table}" cascade`,
      ])
        await rejected(statement, "23514");
    }
    await rejected(`truncate "inventoryItems"`, "23514");
    await db.query(`grant select,update on "inventoryItems" to inventory_report_test_writer;
      create policy test_writer on "inventoryItems" to inventory_report_test_writer using(true) with check(true)`);
    await db.query("set role inventory_report_test_writer");
    await db.query(`update "inventoryItems" set "currentStock"=8 where id=1`);
    await rejected(`select * from "inventoryReportStockChanges"`, "42501");
    await db.query("reset role");
    equal(
      await changeCount(),
      4,
      "Definer trigger captures permitted stock writers without ledger privileges"
    );
    const security = (
      await db.query(
        `select p.prosecdef,p.proconfig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='capture_inventory_report_stock_change'`
      )
    ).rows[0];
    equal(security.prosecdef, true);
    equal(security.nspname, "private");
    check(
      security.proconfig.includes("search_path=pg_catalog"),
      "Trusted search path"
    );
    equal(
      (
        await db.query(
          `select (('2026-11-12'::date+1)::timestamp at time zone 'America/Tegucigalpa') as boundary`
        )
      ).rows[0].boundary.toISOString(),
      "2026-11-13T06:00:00.000Z"
    );

    const fixtureDir = resolve(root, ".tmp/inventory-cutoff-db-fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const fixtureFile = resolve(fixtureDir, `${name}.json`);
    const payload = {
      format: "buildreq-inventory-cutoff-baseline-v1",
      projectRef: "local-test",
      sourceKey: `cloud-backup-${name}`,
      sourceHash: "a".repeat(64),
      capturedAt: "2026-09-30T04:29:38.699Z",
      kind: "backup",
      metadata: { approximate: true, earliestOfferedDay: "2026-09-30" },
      rows: [
        {
          id: 101,
          sapItemCode: "000001",
          name: "Ejemplo privado",
          currentStock: "0.00",
          projectId: 1,
          warehouseId: 1,
          storageLocation: null,
          isActive: false,
        },
      ],
    };
    writeFileSync(fixtureFile, JSON.stringify(payload));
    const beforeImport = await fingerprint(),
      beforeImportChanges = await changeCount();
    equal(JSON.parse(cli(fixtureFile)).alreadyImported, false);
    equal(JSON.parse(cli(fixtureFile)).alreadyImported, true);
    equal(
      (
        await db.query(
          `select "rowData"->>'sapItemCode' as code from "inventoryReportSnapshotRows" where "inventoryItemId"=101`
        )
      ).rows[0].code,
      "000001"
    );
    payload.rows[0].currentStock = "1.00";
    writeFileSync(fixtureFile, JSON.stringify(payload));
    let importerRejected = false;
    try {
      cli(fixtureFile);
    } catch {
      importerRejected = true;
    }
    check(
      importerRejected,
      "Importer refuses to replace an existing different baseline"
    );
    equal(await fingerprint(), beforeImport);
    equal(
      await changeCount(),
      beforeImportChanges,
      "Import never modifies current stock"
    );
    if (process.env.INVENTORY_REPORT_BASELINE_FILE) {
      const real = JSON.parse(cli(process.env.INVENTORY_REPORT_BASELINE_FILE));
      check(
        real.rows > 0,
        "Real private offline artifact imports into disposable local DB"
      );
      equal(await fingerprint(), beforeImport);
      equal(await changeCount(), beforeImportChanges);
    }
    await db.query(migration);
    equal(
      (
        await db.query(`select * from "inventoryReportSnapshots" where id=$1`, [
          opening.id,
        ])
      ).rows[0],
      opening
    );
    equal(
      await changeCount(),
      beforeImportChanges,
      "Migration rerun does not invent changes"
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          assertions,
          database: "disposable-local",
          covers: [
            "additive/idempotent migration",
            "zero/inactive snapshot",
            "insert/update/delete/scope history",
            "stock and history rollback",
            "trigger failure rollback",
            "RLS/browser denies",
            "service read-only",
            "immutable history",
            "truncate protection",
            "definer writer capture",
            "Honduras boundary",
            "baseline import/retry/conflict",
          ],
          realOfflineArtifact: Boolean(
            process.env.INVENTORY_REPORT_BASELINE_FILE
          ),
        },
        null,
        2
      )
    );
  } finally {
    if (connected) await db.end();
    if (created && /^buildreq_inventory_report_test_[a-f0-9]{16}$/.test(name))
      await admin.query(`drop database "${name}" with (force)`);
    await admin.end();
  }
}

main().catch(error => {
  console.error("Inventory report local checks failed", {
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
});
