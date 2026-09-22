import { describe, expect, it, vi } from "vitest";
import {
  assertNoteAllocationTotals,
  canAccountFinancialNotes,
  canPrepareFinancialNotes,
  groupNoteRetentions,
  noteMoneyUnits,
  sumNoteMoney,
  noteDraftSchema,
} from "../shared/financial-notes";
import { calculateInvoiceNetPayable } from "../shared/invoice-document-adjustments";
import { buildFinancialNotePrintHtml } from "../client/src/lib/financial-note-print";
import {
  assertNoteFiscalReady,
  assertFinancialNoteAccess,
} from "./financialNotes";
import {
  financialNotesRouter,
  noteConceptsRouter,
} from "./routers/financialNotes";

describe("financial note invariants", () => {
  it("allows accountants to search active financial groups in bounded pages", async () => {
    const db = await import("./db");
    const { financialGroupsRouter } = await import("./routers/financialGroups");
    const spy = vi
      .spyOn(db, "listFinancialGroups")
      .mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      });
    try {
      await financialGroupsRouter
        .createCaller({
          user: { id: 1, role: "user", buildreqRole: "contable" },
        } as any)
        .activeOptionsPage({ search: "Materiales", page: 1, pageSize: 25 });
      expect(spy).toHaveBeenCalledWith({
        search: "Materiales",
        page: 1,
        pageSize: 25,
        isActive: true,
      });
    } finally {
      spy.mockRestore();
    }
  });
  it("adds exact four-decimal amounts and rejects excess precision, negatives and overflow", () => {
    expect(sumNoteMoney(["0.1", "0.2", "0.0001"])).toBe("0.3001");
    for (const value of ["-1", "1e2", "NaN", "0.00001", "10000000000"])
      expect(() => noteMoneyUnits(value)).toThrow();
    expect(() =>
      assertNoteAllocationTotals(
        "credit",
        [{ baseAmount: "9999999999", taxAmount: "1" }],
        [
          { invoiceId: 1, amount: "9999999999" },
          { invoiceId: 2, amount: "1" },
        ]
      )
    ).toThrow();
  });
  it("requires exact applications, distinct invoices and positive lines", () => {
    const lines = [{ baseAmount: "0.1", taxAmount: "0.2" }];
    expect(
      assertNoteAllocationTotals("credit", lines, [
        { invoiceId: 1, amount: "0.3" },
      ])
    ).toBe("0.3000");
    expect(() =>
      assertNoteAllocationTotals("credit", lines, [
        { invoiceId: 1, amount: "0.3001" },
      ])
    ).toThrow(/coincidir/);
    expect(() =>
      assertNoteAllocationTotals("credit", lines, [
        { invoiceId: 1, amount: "0.1" },
        { invoiceId: 1, amount: "0.2" },
      ])
    ).toThrow(/repetir/);
    expect(() =>
      assertNoteAllocationTotals(
        "credit",
        [{ baseAmount: "0", taxAmount: "0" }],
        [{ invoiceId: 1, amount: "0" }]
      )
    ).toThrow();
  });
  it("groups by retention identifier rather than description or recalculated percentages", () => {
    expect(
      groupNoteRetentions([
        { retentionCatalogId: 1, description: "Same", amount: "100" },
        { retentionCatalogId: 1, description: "Same", amount: "150" },
        { retentionCatalogId: 2, description: "Same", amount: "0.0001" },
      ])
    ).toEqual([
      { retentionCatalogId: 1, description: "Same", amount: "250.0000" },
      { retentionCatalogId: 2, description: "Same", amount: "0.0001" },
    ]);
    expect(() =>
      groupNoteRetentions([
        { retentionCatalogId: null, description: "RT01", amount: "100" },
      ])
    ).toThrow(/catálogo/);
  });
  it("includes only ordinary note effects in the existing payable formula", () => {
    expect(
      calculateInvoiceNetPayable({
        total: 1000,
        fiscalRetentionTotal: 100,
        otherRetentionTotal: 25,
        documentDiscountTotal: 5,
        creditNoteTotal: 200,
        debitNoteTotal: 50,
      })
    ).toBe(720);
  });
  it("enforces roles and project scope including scoped procurement administrators", () => {
    const preparer = { role: "user", buildreqRole: "administracion_central" };
    expect(canPrepareFinancialNotes(preparer)).toBe(true);
    expect(canAccountFinancialNotes(preparer)).toBe(false);
    expect(
      canAccountFinancialNotes({ role: "user", buildreqRole: "contable" })
    ).toBe(true);
    expect(() =>
      assertFinancialNoteAccess(
        { projectId: 2, status: "borrador" },
        {
          id: 1,
          role: "admin",
          buildreqRole: "superintendente_aprobador",
          assignedProjectId: 1,
        }
      )
    ).toThrow();
    expect(() =>
      assertFinancialNoteAccess(
        { projectId: 1, status: "registrada" },
        {
          id: 1,
          role: "user",
          buildreqRole: "bodeguero_proyecto",
          assignedProjectId: 1,
        }
      )
    ).toThrow();
  });
  it("requires independent fiscal fields and a valid date/range before review", () => {
    const valid = {
      cai: "338827-15203E-A419E0-63BE03-0909A6-53",
      fiscalNumber: "001-001-01-00000002",
      documentRangeStart: "001-001-01-00000001",
      documentRangeEnd: "001-001-01-00000010",
      documentDate: "2026-09-22",
      documentDueDate: "2026-10-22",
      emissionDeadline: "2026-12-31",
    };
    expect(() => assertNoteFiscalReady(valid)).not.toThrow();
    for (const patch of [
      { cai: null },
      { fiscalNumber: "001-001-01-00000011" },
      { documentDueDate: "2026-01-01" },
      { emissionDeadline: "2026-01-01" },
    ])
      expect(() => assertNoteFiscalReady({ ...valid, ...patch })).toThrow();
  });
  it("bounds API payloads and ignores caller-supplied automatic origin", () => {
    const parsed = noteDraftSchema.parse({
      type: "credit",
      origin: "retentions",
      lines: [{ conceptId: 1, baseAmount: "10", taxAmount: "0" }],
      allocations: [{ invoiceId: 1, amount: "10" }],
    });
    expect(parsed).not.toHaveProperty("origin");
    expect(() =>
      noteDraftSchema.parse({
        ...parsed,
        allocations: Array.from({ length: 101 }, (_, i) => ({
          invoiceId: i + 1,
          amount: "1",
        })),
      })
    ).toThrow();
  });
  it("protects endpoints before catalog writes or note creation", async () => {
    const context = {
      user: {
        id: 1,
        role: "user",
        buildreqRole: "bodeguero_proyecto",
        assignedProjectId: 1,
      },
    } as any;
    await expect(
      noteConceptsRouter.createCaller(context).create({
        type: "credit",
        code: "NC-X",
        description: "X",
        isActive: true,
      })
    ).rejects.toThrow(/permisos/);
    await expect(
      financialNotesRouter.createCaller(context).create({
        type: "credit",
        requestKey: "12345678-1234-4234-8234-123456789abc",
        lines: [{ conceptId: 1, baseAmount: "10", taxAmount: "0" }],
        allocations: [{ invoiceId: 1, amount: "10" }],
      })
    ).rejects.toThrow(/permisos/);
  });
  it("escapes all user-controlled print fields and labels zero retention balance effect", () => {
    const html = buildFinancialNotePrintHtml({
      note: {
        documentNumber: "NC-1",
        type: "credit",
        origin: "retentions",
        supplierName: "<script>alert(1)</script>",
        notes: "<img onerror=alert(1)>",
        currency: "HNL",
        status: "borrador",
        total: 250,
      },
      lines: [{ description: "<svg onload=alert(1)>", total: 250 }],
      allocations: [{ invoiceDocumentNumber: "FT-1", amount: 250 }],
      events: [
        { action: "creada", actorName: "<b>user</b>", createdAt: "2026-09-22" },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Efecto adicional en saldo: cero.");
    expect(html).toContain("FT-1");
  });
});
