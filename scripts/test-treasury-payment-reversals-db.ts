import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import * as schema from "../drizzle/schema";
import * as notesSchema from "../drizzle/financial-notes-schema";
import * as settlementSchema from "../drizzle/invoice-settlement-schema";
import * as retentionSchema from "../drizzle/retention-documents-schema";
import * as costMatrixSchema from "../drizzle/cost-matrix-schema";

const { generateDrizzleJson, generateMigration } = createRequire(
  import.meta.url
)("drizzle-kit/api") as typeof import("drizzle-kit/api");

function previousSchema() {
  const snapshot = generateDrizzleJson({
    ...schema,
    ...notesSchema,
    ...settlementSchema,
    ...retentionSchema,
    ...costMatrixSchema,
  });
  delete snapshot.tables["public.treasuryPaymentReversals"];
  delete snapshot.tables["public.treasuryPaymentReversalItems"];
  const advanceTable = snapshot.tables["public.purchaseOrderAdvances"];
  delete advanceTable.columns.reversalHoldId;
  delete advanceTable.indexes.po_advance_reversal_hold_idx;
  const advanceForeignKeys = advanceTable.foreignKeys as Record<
    string,
    { columnsFrom: string[] }
  >;
  for (const [name, foreignKey] of Object.entries(advanceForeignKeys)) {
    if (foreignKey.columnsFrom.includes("reversalHoldId")) {
      delete advanceForeignKeys[name];
    }
  }
  const paymentItems = snapshot.tables["public.treasuryPaymentItems"];
  if (paymentItems.checkConstraints) {
    delete paymentItems.checkConstraints.treasury_item_reversal_check;
  }
  const itemStatus = snapshot.enums["public.treasury_item_status"];
  itemStatus.values = itemStatus.values.filter(
    (value: string) => value !== "revertida"
  );
  const attachmentCategory = snapshot.enums["public.attachment_category"];
  attachmentCategory.values = attachmentCategory.values.filter(
    (value: string) => value !== "comprobante_reversion_pago"
  );
  return snapshot;
}

const migrationFiles = [
  "../drizzle/20261126000000_treasury_payment_reversal_enums.sql",
  "../drizzle/20261126000001_treasury_payment_reversals.sql",
];

async function main() {
  const source = process.env.TREASURY_REVERSAL_TEST_ADMIN_URL;
  if (!source) throw new Error("Falta TREASURY_REVERSAL_TEST_ADMIN_URL");
  const target = new URL(source);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.search
  ) {
    throw new Error("Las pruebas requieren un PostgreSQL local y desechable");
  }
  const token = randomBytes(8).toString("hex");
  const name = `buildreq_treasury_reversal_test_${token}`;
  const admin = new Client({ connectionString: source });
  let created = false;
  let fixture: Client | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    target.pathname = `/${name}`;
    fixture = new Client({ connectionString: target.toString() });
    await fixture.connect();
    const statements = await generateMigration(
      generateDrizzleJson({}),
      previousSchema()
    );
    for (const statement of statements) await fixture.query(statement);

    // Each query commits separately so the new enum values are usable in the
    // next migration. Apply both twice to exercise retries.
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const migration of migrationFiles) {
        await fixture.query(
          readFileSync(new URL(migration, import.meta.url), "utf8")
        );
      }
    }
    await fixture.end();
    fixture = undefined;
    console.log(
      "Base temporal local preparada; migraciones aplicadas dos veces."
    );

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "server/treasuryPaymentReversals.integration.test.ts",
        "server/purchaseOrderAdvanceReversalHold.integration.test.ts",
        "--no-file-parallelism",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: target.toString(),
          TREASURY_REVERSAL_TEST_DATABASE_URL: target.toString(),
          TREASURY_REVERSAL_TEST_TOKEN: token,
          TREASURY_PAYMENT_REVERSALS_ENABLED: "true",
        },
        stdio: "inherit",
      }
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    try {
      await fixture?.end();
      if (
        created &&
        /^buildreq_treasury_reversal_test_[0-9a-f]{16}$/.test(name)
      ) {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
    }
  }
}

main().catch(error => {
  console.error("Fallaron las pruebas locales de reversión", {
    message: error.message,
    code: error.code,
  });
  process.exitCode = 1;
});
