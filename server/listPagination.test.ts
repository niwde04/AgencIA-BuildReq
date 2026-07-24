import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fetchAllFilteredPages } from "../client/src/lib/paginated-export";
import { getPageMeta, pageResult } from "./paginatedLists";

describe("operational list pagination", () => {
  it("uses 50 rows by default and calculates a partial last page", () => {
    expect(getPageMeta(125, { page: 3 })).toEqual({
      page: 3,
      pageSize: 50,
      totalPages: 3,
      offset: 100,
    });
  });

  it("corrects a page outside the available range", () => {
    expect(pageResult([], 51, { page: 9, pageSize: 50 })).toEqual({
      items: [],
      total: 51,
      page: 2,
      pageSize: 50,
      totalPages: 2,
    });
  });

  it("returns a stable first page for an empty list", () => {
    expect(pageResult([], 0, { page: 4, pageSize: 50 })).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
  });

  it("limits explicit export blocks to the server maximum", () => {
    expect(getPageMeta(600, { page: 1, pageSize: 500 }).pageSize).toBe(200);
  });

  it("fetches every filtered export page in 200-row blocks", async () => {
    const rows = Array.from({ length: 425 }, (_, index) => index + 1);
    const fetchPage = vi.fn(async (page: number, pageSize: number) => ({
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      totalPages: Math.ceil(rows.length / pageSize),
    }));

    await expect(fetchAllFilteredPages(fetchPage)).resolves.toEqual(rows);
    expect(fetchPage.mock.calls).toEqual([
      [1, 200],
      [2, 200],
      [3, 200],
    ]);
  });
});

describe("pagination index migration", () => {
  it("indexes stable ordering and missing status filters", () => {
    const sql = readFileSync(
      new URL("../drizzle/0113_list_pagination_indexes.sql", import.meta.url),
      "utf8"
    );

    for (const [indexName, tableName] of [
      ["mr_created_page_idx", "materialRequests"],
      ["sfr_created_page_idx", "supplyFlowRecords"],
      ["pr_created_page_idx", "purchaseRequests"],
      ["po_created_page_idx", "purchaseOrders"],
      ["tr_created_page_idx", "transferRequests"],
      ["tf_created_page_idx", "transfers"],
      ["rec_created_page_idx", "receipts"],
      ["inv_created_page_idx", "invoices"],
    ]) {
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${indexName}"`);
      expect(sql).toContain(
        `ON "${tableName}" ("createdAt" DESC, "id" DESC)`
      );
    }

    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "rec_status_idx" ON "receipts" ("status")'
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "sfr_status_idx" ON "supplyFlowRecords" ("status")'
    );
  });
});

describe("article search in operational document lists", () => {
  const source = readFileSync(
    new URL("./paginatedLists.ts", import.meta.url),
    "utf8"
  );

  function functionBody(start: string, end?: string) {
    const startIndex = source.indexOf(start);
    const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
    return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
  }

  it.each([
    [
      "requisitions",
      functionBody(
        "export async function listMaterialRequestsPage",
        "export type SupplyFlowPageFilters"
      ),
      [
        "requestItems.itemName",
        "requestItems.sapItemCode",
        "requestItems.sapItemDescription",
      ],
    ],
    [
      "purchase requests",
      functionBody(
        "export async function listPurchaseRequestsPage",
        "export type PurchaseOrderPageFilters"
      ),
      [
        "purchaseRequestItems.itemName",
        "purchaseRequestItems.currentSapItemCode",
        "purchaseRequestItems.originalSapItemCode",
      ],
    ],
    [
      "purchase orders",
      functionBody(
        "export async function listPurchaseOrdersPage",
        "export type TransferRequestPageFilters"
      ),
      [
        "purchaseOrderItems.itemName",
        "purchaseOrderItems.currentSapItemCode",
        "purchaseOrderItems.originalSapItemCode",
      ],
    ],
    [
      "receipts",
      functionBody(
        "export async function listReceiptsPage",
        "export type InvoicePageFilters"
      ),
      ["receiptItems.itemName", "receiptItems.sapItemCode"],
    ],
    [
      "invoices",
      functionBody("export async function listInvoicesPage"),
      [
        "invoiceItems.itemName",
        "invoiceItems.currentSapItemCode",
        "invoiceItems.originalSapItemCode",
      ],
    ],
  ])("matches code and description for %s", (_name, body, fields) => {
    for (const field of fields) {
      expect(body).toContain(`ilike(${field}, pattern)`);
    }
  });
});
