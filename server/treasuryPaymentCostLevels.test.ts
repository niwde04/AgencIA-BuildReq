import { describe, expect, it } from "vitest";
import matrixSeed from "../data/cost-matrix/initial.json";
import {
  createTreasuryPaymentCostLevelResolver,
  emptyTreasuryPaymentCostLevels,
} from "../shared/treasury-payment-cost-levels";
import {
  buildTreasuryPaymentsReportRows,
  resolveTreasuryPaymentFinancialGroup,
} from "../shared/treasury-payments-report";

const resolve = createTreasuryPaymentCostLevelResolver(matrixSeed);
describe("Payments: niveles de matriz", () => {
  it("resuelve los cuatro niveles del código financiero de la captura", () => {
    expect(resolve("02020201", "0202")).toEqual({
      level1: "02 · Costos operativos",
      level2: "0202 · Maquinaria",
      level3: "020202 · Mantenimiento y reparación maquinaria",
      level4: "02020201 · Repuestos maquinaria",
    });
  });
  it("usa codN2 para separar asesoría legal e inventario con el mismo código", () => {
    expect(resolve("11060101", "0106")).toEqual({
      level1: "01 · Gastos administrativos Oficina Central",
      level2: "0106 · Honorarios profesionales",
      level3: "010601 · Asesoría legal",
      level4: "11060101 · Gastos de asesoría legal",
    });
    expect(resolve("11060101", "1106").level1).toBe("11 · Bodega Central");
    expect(resolve("11060101", "1106").level4).toBe(
      "11060101 · Inventario de materiales asfálticos"
    );
  });
  it("no toma prefijos ni el primer resultado cuando el cruce es contradictorio o ambiguo", () => {
    expect(resolve("11060101").level1).toBe("REVISAR MATRIZ");
    expect(resolve("11060101", "9999").level1).toBe("REVISAR MATRIZ");
    expect(resolve("MISSING", "0106").level1).toBe("SIN MATRIZ");
    expect(resolve("")).toEqual(emptyTreasuryPaymentCostLevels());
  });
  it("usa la coincidencia única del código aunque el codN2 legado esté desactualizado", () => {
    expect(resolve("11051001", "1105")).toEqual({
      level1: "01 · Gastos administrativos Oficina Central",
      level2: "0105 · Servicios generales",
      level3: "010510 · Olimpiadas",
      level4: "11051001 · Olimpiadas",
    });
  });
  it("conserva ceros y permite clasificaciones equivalentes en varias filas", () => {
    const row = matrixSeed.find(r => r.n4 === "02020201")!;
    expect(
      createTreasuryPaymentCostLevelResolver([row, { ...row }])(
        " 02020201 ",
        " 0202 "
      )
    ).toEqual(resolve("02020201", "0202"));
  });
  it("transporta el codN2 del mismo grupo elegido por código SAP actual u original", () => {
    const catalog = new Map([
      [
        "OLD",
        {
          itemCode: "OLD",
          financialCode: "11060101",
          financialGroupDescription: "Asesoría",
          financialGroupLevel2Code: "0106",
        },
      ],
      [
        "NEW",
        {
          itemCode: "NEW",
          financialCode: "11060101",
          financialGroupDescription: "Inventario",
          financialGroupLevel2Code: "1106",
        },
      ],
    ]);
    expect(
      resolveTreasuryPaymentFinancialGroup(
        { currentSapItemCode: "NEW", originalSapItemCode: "OLD" },
        catalog
      ).financialGroupLevel2Code
    ).toBe("1106");
    expect(
      resolveTreasuryPaymentFinancialGroup(
        { currentSapItemCode: "UNKNOWN", originalSapItemCode: "OLD" },
        catalog
      ).financialGroupLevel2Code
    ).toBe("0106");
  });
  it("enriquece una vez por renglón, preserva job y todos los importes, y no clasifica otros cargos", () => {
    const payment = {
      paymentItemId: 1,
      batchNumber: "TES-1",
      bankReference: "REF",
      invoiceId: 1,
      invoiceDate: null,
      invoiceNumber: "F-1",
      supplierName: "Prueba",
      jobCode: "023",
      currency: "HNL" as const,
      invoiceSubtotal: 110,
      invoiceTaxAmount: 15,
      invoiceTotal: 125,
      fiscalRetentionTotal: 1,
      otherRetentionTotal: 0,
      documentDiscountTotal: 0,
      invoiceNetPayable: 124,
      appliedAdvanceAmount: 0,
      bankPaidAmount: 124,
      hasOceExemption: false,
      oceExemptAmount: 0,
    };
    const input = {
      payments: [payment],
      products: [
        {
          id: 1,
          invoiceId: 1,
          currentSapItemCode: "A",
          originalSapItemCode: "A",
          itemName: "Servicio legal",
          quantity: 1,
          unit: "UND",
          unitPrice: 100,
          subtotal: 100,
          taxAmount: 15,
          total: 115,
          taxCode: "isv_15",
          taxBreakdown: null,
          financialCode: "11060101",
          financialGroupDescription: "Honorarios profesionales",
          financialGroupLevel2Code: "0106",
        },
      ],
      otherCharges: [{ id: 1, invoiceId: 1, concept: "Propina", amount: 10 }],
    };
    const original = buildTreasuryPaymentsReportRows(input);
    const enriched = buildTreasuryPaymentsReportRows({
      ...input,
      costMatrixEntries: matrixSeed,
    });
    const amounts = (rows: typeof original) =>
      rows.map(({ level1, level2, level3, level4, ...rest }) => rest);
    expect(amounts(enriched)).toEqual(amounts(original));
    expect(enriched).toHaveLength(2);
    expect(enriched[0].jobCode).toBe("023");
    expect(enriched[0].level2).toBe("0106 · Honorarios profesionales");
    expect(enriched[1]).toMatchObject(emptyTreasuryPaymentCostLevels());
    const noDetail = buildTreasuryPaymentsReportRows({
      ...input,
      products: [],
      otherCharges: [],
      costMatrixEntries: matrixSeed,
    });
    expect(noDetail[0]).toMatchObject(emptyTreasuryPaymentCostLevels());
  });
});
