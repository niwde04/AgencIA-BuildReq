import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { ClientBase } from "pg";
import {
  captureOpeningBalanceRepairSnapshot,
  type OpeningProjectRepairSnapshot,
} from "./openingBalanceProjectRepair";

export const OPENING_NUMBER_REPAIR = Object.freeze({
  operationKey: "opening-folio-si-024-to-si-018-00000001-v1",
  id: 4,
  projectId: 22,
  warehouseId: 23,
  oldNumber: "SI-024-00000001",
  newNumber: "SI-018-00000001",
});
type Executor = Pick<ClientBase, "query">;
type Snapshot = OpeningProjectRepairSnapshot & { otherHeaders: unknown[] };
export type OpeningNumberRepairResult = {
  operationKey: string;
  apply: boolean;
  alreadyApplied: boolean;
  changed: boolean;
  before: Snapshot;
  after: Snapshot;
  fingerprints: Record<string, string>;
};
const guardSql = readFileSync(
  new URL(
    "../drizzle/20261023155836_retire_opening_balance_folio.sql",
    import.meta.url
  ),
  "utf8"
);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Renumeración del saldo: ${message}`);
}
async function snapshot(client: Executor): Promise<Snapshot> {
  const target = await captureOpeningBalanceRepairSnapshot(client);
  const others = await client.query(
    'SELECT to_jsonb(b) row FROM public."openingBalances" b WHERE b.id<>$1 ORDER BY b.id',
    [OPENING_NUMBER_REPAIR.id]
  );
  return { ...target, otherHeaders: others.rows.map(row => row.row) };
}
function fixedHeaderFields(header: Record<string, unknown>) {
  const { balanceNumber, updatedAt, ...fixed } = header;
  return fixed;
}

/** Owns its transaction. Backups and prepared audit must reach durable storage before COMMIT. */
export async function repairOpeningBalanceNumber(
  client: Executor,
  options: {
    apply: boolean;
    beforeApply?: (snapshot: Snapshot) => Promise<void>;
    beforeCommit?: (result: OpeningNumberRepairResult) => Promise<void>;
  }
): Promise<OpeningNumberRepairResult> {
  if (options.apply)
    requireCondition(
      options.beforeApply && options.beforeCommit,
      "faltan respaldo y auditoría durables."
    );
  const target = OPENING_NUMBER_REPAIR;
  await client.query(
    `BEGIN ISOLATION LEVEL REPEATABLE READ ${options.apply ? "READ WRITE" : "READ ONLY"}`
  );
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (options.apply) {
      await client.query(
        "SELECT id FROM public.warehouses WHERE id=$1 FOR UPDATE",
        [target.warehouseId]
      );
      await client.query(
        'SELECT id FROM public."openingBalances" WHERE id=$1 FOR UPDATE',
        [target.id]
      );
      await client.query(
        "SELECT id FROM public.projects WHERE id IN (22,26) ORDER BY id FOR UPDATE"
      );
    }
    const before = await snapshot(client);
    requireCondition(
      before.header.id === target.id &&
        before.header.projectId === target.projectId &&
        before.header.warehouseId === target.warehouseId &&
        (before.header.balanceNumber === target.oldNumber ||
          before.header.balanceNumber === target.newNumber),
      "el documento actual no coincide con el saldo autorizado."
    );
    requireCondition(
      before.warehouse.code === "018" &&
        before.warehouse.isActive === true &&
        before.projects.some(
          p =>
            p.id === target.projectId &&
            p.code === "018" &&
            p.status === "activo" &&
            p.belongsToWarehouse
        ),
      "el proyecto o la bodega no coinciden con 018."
    );
    requireCondition(
      before.items.length > 0 &&
        before.items.every(i => i.projectId === target.projectId),
      "las líneas requieren una nueva revisión de proyecto."
    );
    const collision = await client.query(
      'SELECT id FROM public."openingBalances" WHERE "balanceNumber"=$1 AND id<>$2 LIMIT 1',
      [target.newNumber, target.id]
    );
    requireCondition(
      collision.rows.length === 0,
      "el folio nuevo ya pertenece a otro saldo."
    );
    const alreadyApplied = before.header.balanceNumber === target.newNumber;
    if (options.apply) {
      await options.beforeApply!(structuredClone(before));
      if (!alreadyApplied) {
        const update = await client.query(
          'UPDATE public."openingBalances" SET "balanceNumber"=$1,"updatedAt"=clock_timestamp() WHERE id=$2 AND "balanceNumber"=$3 AND "projectId"=$4 AND "warehouseId"=$5 RETURNING id',
          [
            target.newNumber,
            target.id,
            target.oldNumber,
            target.projectId,
            target.warehouseId,
          ]
        );
        requireCondition(
          update.rowCount === 1,
          "el saldo cambió durante la operación."
        );
      }
      await client.query(guardSql);
    }
    const after = options.apply ? await snapshot(client) : before;
    if (options.apply) {
      requireCondition(
        after.header.balanceNumber === target.newNumber &&
          isDeepStrictEqual(
            fixedHeaderFields(before.header),
            fixedHeaderFields(after.header)
          ),
        "cambió un campo no autorizado del encabezado."
      );
      for (const field of [
        "warehouse",
        "projects",
        "items",
        "inventory",
        "otherHeaders",
      ] as const)
        requireCondition(
          isDeepStrictEqual(before[field], after[field]),
          `cambió ${field}; se revierte la operación.`
        );
      const guard = await client.query(
        "SELECT convalidated FROM pg_constraint WHERE conrelid='public.\"openingBalances\"'::regclass AND conname='ob_no_retired_balance_number'"
      );
      requireCondition(
        guard.rows[0]?.convalidated === true,
        "la reserva del folio anterior no quedó validada."
      );
    }
    const result: OpeningNumberRepairResult = {
      operationKey: target.operationKey,
      apply: options.apply,
      alreadyApplied,
      changed: options.apply && !alreadyApplied,
      before,
      after,
      fingerprints: {
        beforeItems: digest(before.items),
        afterItems: digest(after.items),
        beforeInventory: digest(before.inventory),
        afterInventory: digest(after.inventory),
        beforeOtherHeaders: digest(before.otherHeaders),
        afterOtherHeaders: digest(after.otherHeaders),
      },
    };
    if (options.apply) await options.beforeCommit!(structuredClone(result));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
