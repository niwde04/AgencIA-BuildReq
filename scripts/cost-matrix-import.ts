import type { Client } from "pg";
import { z } from "zod";
import { costMatrixFields, deriveCostMatrix } from "../shared/cost-matrix";

export const costMatrixSeedRow = costMatrixFields
  .extend({ sourceKey: z.string().min(1).max(200) })
  .strict();
export function validateCostMatrixSeed(value: unknown) {
  const rows = z.array(costMatrixSeedRow).min(1).parse(value);
  const byCode = new Map<string, (typeof rows)[number]>();
  const sourceKeys = new Set<string>();
  for (const row of rows) {
    const code = deriveCostMatrix(row).matrixCode;
    const previous = byCode.get(code);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row))
      throw new Error(`Duplicados contradictorios para ${code}`);
    if (previous) continue;
    if (sourceKeys.has(row.sourceKey))
      throw new Error(`Referencia de origen duplicada: ${row.sourceKey}`);
    sourceKeys.add(row.sourceKey);
    byCode.set(code, row);
  }
  return Array.from(byCode.values());
}
export async function importCostMatrix(
  client: Client,
  value: unknown,
  apply = false
) {
  const rows = validateCostMatrixSeed(value);
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('buildreq:cost-matrix:seed'))"
    );
    // Serialize against CRUD as well, so a code cannot change between inspection and insertion.
    await client.query(
      'LOCK TABLE public."costMatrixEntries" IN SHARE ROW EXCLUSIVE MODE'
    );
    const existing = (
      await client.query(
        'SELECT "matrixCode", "sourceKey" FROM public."costMatrixEntries"'
      )
    ).rows;
    const existingSources = new Set(existing.map(r => r.sourceKey));
    const existingCodes = new Set(existing.map(r => r.matrixCode));
    let inserted = 0,
      skipped = 0;
    const columns = [
      "sourceKey",
      ...Object.keys(costMatrixFields.shape),
      "matrixCode",
    ];
    for (const row of rows) {
      const entry = { ...row, matrixCode: deriveCostMatrix(row).matrixCode };
      if (
        existingSources.has(row.sourceKey) ||
        existingCodes.has(entry.matrixCode)
      ) {
        skipped++;
        continue;
      }
      if (apply)
        await client.query(
          `INSERT INTO public."costMatrixEntries" (${columns.map(c => '"' + c + '"').join(",")}) VALUES (${columns.map((_, i) => "$" + (i + 1)).join(",")})`,
          columns.map(c => entry[c as keyof typeof entry])
        );
      inserted++;
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return {
      mode: apply ? "apply" : "dry-run",
      incoming: rows.length,
      inserted,
      skipped,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
