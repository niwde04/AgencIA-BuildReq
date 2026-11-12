import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  INVENTORY_CUTOFF_SOURCE_ROW_LIMIT,
  InventoryCutoffSourceLimitError,
  loadInventoryCutoffCurrentPending,
  loadInventoryCutoffSources,
} from "./inventoryCutoffSources";

const period = { fromDate: "2026-09-30", throughDate: "2026-11-12" };

describe("inventory cutoff source boundaries", () => {
  it("does not query current pending totals for an empty warehouse permission scope", async () => {
    const execute = vi.fn();
    expect(
      await loadInventoryCutoffCurrentPending({ execute }, { warehouseIds: [] })
    ).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not truncate current pending totals beyond the remaining shared budget", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{}, {}] });
    await expect(
      loadInventoryCutoffCurrentPending({ execute }, {}, 1)
    ).rejects.toBeInstanceOf(InventoryCutoffSourceLimitError);
  });
  it.each([{ projectIds: [] }, { warehouseIds: [] }])(
    "does not query a denied empty permission scope: %j",
    async scope => {
      const execute = vi.fn();
      expect(
        await loadInventoryCutoffSources({ execute }, { ...period, ...scope })
      ).toEqual({
        currentInventory: [],
        openingLines: [],
        receiptLines: [],
        exitLines: [],
        returnLines: [],
      });
      expect(execute).not.toHaveBeenCalled();
    }
  );

  it.each([
    { fromDate: "2026-02-30" },
    { throughDate: "2026-09-01" },
    { fromDate: "2026-09-30'; drop table users; --" },
    { projectIds: [0] },
    { warehouseIds: [1.5] },
  ])("rejects invalid bounds before any query: %j", async override => {
    const execute = vi.fn();
    await expect(
      loadInventoryCutoffSources({ execute }, { ...period, ...override })
    ).rejects.toThrow(/no es válido/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces one total row budget and never silently truncates", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: Array.from(
          { length: INVENTORY_CUTOFF_SOURCE_ROW_LIMIT - 1 },
          () => ({})
        ),
      })
      .mockResolvedValueOnce({ rows: [{}, {}] });
    await expect(
      loadInventoryCutoffSources({ execute }, period)
    ).rejects.toBeInstanceOf(InventoryCutoffSourceLimitError);
    expect(execute).toHaveBeenCalledTimes(2);
    const second = new PgDialect().sqlToQuery(execute.mock.calls[1][0]);
    expect(second.params.at(-1)).toBe(2);
  });

  it("uses fixed read-only queries and parameterized permission sets", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    await loadInventoryCutoffSources(
      { execute },
      { ...period, projectIds: [711, 712], warehouseIds: [921] }
    );
    expect(execute).toHaveBeenCalledTimes(5);
    const statements = execute.mock.calls.map(([query]) =>
      new PgDialect().sqlToQuery(query)
    );
    for (const statement of statements) {
      expect(statement.sql.trim()).toMatch(/^select\b/i);
      expect(statement.sql).not.toMatch(
        /\b(insert|update|delete|alter|drop)\b/i
      );
      expect(statement.sql).not.toContain("711");
      expect(statement.params).toContainEqual([711, 712]);
      expect(statement.params).toContainEqual([921]);
    }
    const receiptSql = statements[2].sql;
    expect(receiptSql).toMatch(/r\."sourceType"::text = 'transfer' and \(/);
    expect(receiptSql).toMatch(/r\."voidedAt" >=/);
    expect(receiptSql).not.toMatch(/r\."receiptDate" >=/);
  });
});
