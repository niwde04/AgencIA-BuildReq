import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DMC_COLUMNS,
  buildDmcReportPayload,
  type DmcReportSourceInvoice,
} from "@shared/dmc-report";
import { buildDmcSarReportPayload } from "@shared/dmc-sar-report";
import {
  buildDmc527Workbook,
  buildRetentionSarWorkbook,
  buildSystemWorkbook,
} from "../client/src/lib/dmc-export";
import { buildRetentionSarPayload } from "@shared/retention-sar-report";
import { buildSystemWorkbookPayload } from "@shared/system-workbook-report";
import * as XLSX from "xlsx";
import { appRouter } from "./routers";
import * as db from "./db";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(overrides: Partial<AuthenticatedUser> = {}) {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@buildreq.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    buildreqRole: "administracion_central",
    assignedProjectId: null,
    mustChangePassword: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    assignedProjectIds: [],
    assignedProjects: [],
    ...overrides,
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } satisfies TrpcContext;
}

const validInvoiceUpdateInput = {
  id: 1,
  isFiscalDocument: true,
  cai: "338827-15203E-A419E0-63BE03-0909A6-53",
  invoiceNumber: "000-001-01-00010571",
  documentRangeStart: "000-001-01-00010000",
  documentRangeEnd: "000-001-01-00020000",
  documentDate: "2026-07-01",
  documentDueDate: "2026-07-31",
  postingDate: "2026-07-01",
  receiptDate: "2026-07-02",
  emissionDeadline: "2026-08-31",
  retentionReceiptNumber: "",
  notes: "",
};

function mockEditableInvoice(subtotal = "1000.0000") {
  vi.spyOn(db, "getInvoiceById").mockResolvedValue({
    invoice: {
      id: 1,
      projectId: 1,
      status: "borrador",
      subtotal,
      isFiscalDocument: true,
    },
    retentions: [],
    items: [],
  } as any);
  return vi.spyOn(db, "updateInvoice").mockResolvedValue({ id: 1 } as any);
}

function sarInvoice(
  overrides: Partial<DmcReportSourceInvoice> = {}
): DmcReportSourceInvoice {
  return {
    invoiceId: overrides.invoiceId ?? 100,
    invoiceDocumentNumber: overrides.invoiceDocumentNumber ?? "FT-2026-0001",
    invoiceNumber: overrides.invoiceNumber ?? "000-001-01-00000001",
    status: overrides.status ?? "borrador",
    isFiscalDocument: overrides.isFiscalDocument ?? true,
    cai: overrides.cai ?? "338827-15203E-A419E0-63BE03-0909A6-53",
    documentDate:
      overrides.documentDate ?? new Date("2026-07-01T12:00:00.000"),
    documentDueDate: overrides.documentDueDate ?? null,
    postingDate:
      overrides.postingDate ?? new Date("2026-07-02T12:00:00.000"),
    receiptDate: overrides.receiptDate ?? null,
    retentionReceiptNumber: overrides.retentionReceiptNumber ?? null,
    retentionCai: overrides.retentionCai ?? null,
    retentionDocumentDate: overrides.retentionDocumentDate ?? null,
    hasOceExemption: overrides.hasOceExemption ?? false,
    oceNumber: overrides.oceNumber ?? null,
    oceResolutionNumber: overrides.oceResolutionNumber ?? null,
    oceResolutionDate: overrides.oceResolutionDate ?? null,
    oceExemptAmount: overrides.oceExemptAmount ?? "0.0000",
    oceExemptAmount15: overrides.oceExemptAmount15 ?? null,
    oceExemptAmount18: overrides.oceExemptAmount18 ?? null,
    dmcForeignSection: overrides.dmcForeignSection ?? null,
    dmcForeignIdentification:
      overrides.dmcForeignIdentification ?? null,
    dmcFyducaNumber: overrides.dmcFyducaNumber ?? null,
    dmcDuaNumber: overrides.dmcDuaNumber ?? null,
    dmcImportOutsideCentralAmerica:
      overrides.dmcImportOutsideCentralAmerica ?? null,
    subtotal: overrides.subtotal ?? "100.0000",
    taxAmount: overrides.taxAmount ?? "15.0000",
    total: overrides.total ?? "115.0000",
    retentionTotal: overrides.retentionTotal ?? "0.0000",
    netPayable: overrides.netPayable ?? "115.0000",
    receiptNumber: overrides.receiptNumber ?? null,
    purchaseOrderNumber: overrides.purchaseOrderNumber ?? "OC-2026-0001",
    purchaseType: overrides.purchaseType ?? "local",
    purchaseOrderPaymentMethod: overrides.purchaseOrderPaymentMethod ?? null,
    currency: overrides.currency ?? "HNL",
    projectCode: overrides.projectCode ?? "HID",
    projectName: overrides.projectName ?? "Hidalgo",
    supplierCode: overrides.supplierCode ?? "PROV-001",
    supplierName: overrides.supplierName ?? "Proveedor Demo",
    supplierRtn: overrides.supplierRtn ?? "08019002274414",
    items: overrides.items ?? [
      {
        id: 1,
        itemName: "Compra gravada",
        taxCode: "isv_15",
        subtotal: "100.0000",
        taxAmount: "15.0000",
        total: "115.0000",
        taxBreakdown: [
          {
            taxCode: "isv_15",
            label: "ISV 15%",
            shortLabel: "ISV 15%",
            taxType: "base",
            fiscalCategory: "gravado",
            ratePercent: 15,
            rate: 0.15,
            baseAmount: 100,
            amount: 15,
            displayOrder: 20,
          },
        ],
        dmcDestination: "costo",
      },
    ],
    retentions: overrides.retentions ?? [],
    materialRequests: overrides.materialRequests ?? [],
    subProjectLabels: overrides.subProjectLabels ?? [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DMC report mapper", () => {
  it("maps fiscal invoice data into DMC columns", () => {
    const payload = buildDmcReportPayload(
      [
        {
          invoiceId: 1,
          invoiceDocumentNumber: "FAC-2026-0001",
          invoiceNumber: "000-001-01-00010571",
          status: "borrador",
          isFiscalDocument: true,
          cai: "338827-15203E-A419E0-63BE03-0909A6-53",
          documentDate: new Date("2026-07-01T12:00:00"),
          documentDueDate: new Date("2026-07-31T12:00:00"),
          postingDate: new Date("2026-07-01T12:00:00"),
          receiptDate: new Date("2026-07-02T12:00:00"),
          retentionReceiptNumber: "000-001-01-00000015",
          subtotal: "1250.0000",
          taxAmount: "150.0000",
          total: "1400.0000",
          retentionTotal: "30.0000",
          netPayable: "1370.0000",
          receiptNumber: "REC-2026-0001",
          purchaseOrderNumber: "OC-2026-0001",
          purchaseOrderPaymentMethod: "linea_credito",
          projectCode: "HID",
          projectName: "Hidalgo",
          supplierCode: "PROV-001",
          supplierName: "Proveedor Demo",
          supplierRtn: "08011999123456",
          items: [
            {
              id: 10,
              itemName: "Nombre guardado de cemento",
              sapItemCode: "01010100001",
              articleDescription: "Cemento gris Portland tipo I",
              financialGroupCode: "02019901",
              financialGroupDescription: "Materiales de construcción",
              taxCode: "isv_15",
              subtotal: "1000.0000",
              taxAmount: "150.0000",
              total: "1150.0000",
              taxBreakdown: [
                {
                  taxCode: "isv_15",
                  label: "ISV 15%",
                  shortLabel: "ISV 15%",
                  taxType: "base",
                  fiscalCategory: "gravado",
                  ratePercent: 15,
                  rate: 0.15,
                  baseAmount: 1000,
                  amount: 150,
                  displayOrder: 20,
                },
              ],
            },
            {
              id: 11,
              itemName: "Nombre guardado del servicio",
              sapItemCode: "02020200002",
              articleDescription: "Servicio técnico exento",
              financialGroupCode: "02029902",
              financialGroupDescription: "Servicios técnicos",
              taxCode: "exe",
              subtotal: "250.0000",
              taxAmount: "0.0000",
              total: "250.0000",
              taxBreakdown: [
                {
                  taxCode: "exe",
                  label: "EXE - Exento",
                  shortLabel: "EXE",
                  taxType: "base",
                  fiscalCategory: "exento",
                  ratePercent: 0,
                  rate: 0,
                  baseAmount: 250,
                  amount: 0,
                  displayOrder: 10,
                },
              ],
            },
          ],
          retentions: [
            {
              id: 20,
              retentionCode: "ISR_1",
              retentionErpCode: "ISR1",
              description: "Retención ISR 1%",
              percentage: "1.0000",
              baseAmount: "1000.0000",
              amount: "10.0000",
            },
            {
              id: 21,
              retentionCode: "RET_ISV",
              retentionErpCode: "RISV",
              description: "Retención ISV",
              percentage: "15.0000",
              baseAmount: "133.3333",
              amount: "20.0000",
            },
          ],
          materialRequests: [
            {
              id: 30,
              requestNumber: "REQ-2026-0025",
              assignedFlow: "solicitud_compra",
            },
          ],
          subProjectLabels: ["SP-01 - Cimentación"],
        },
      ],
      {
        generatedAt: new Date("2026-07-09T12:00:00"),
        dateFrom: new Date("2026-07-01T00:00:00"),
        dateTo: new Date("2026-07-31T23:59:59"),
      }
    );

    const [cementRow, serviceRow] = payload.rows;
    expect(DMC_COLUMNS.map(column => column.header)).toContain("N° REGISTRO");
    expect(DMC_COLUMNS.map(column => column.header)).toContain(
      "Nombre_Grupo_Financiero"
    );
    expect(DMC_COLUMNS.map(column => column.header)).toContain("Código SAP");
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows.map(row => row.numeroRegistro)).toEqual([1, 1]);
    expect(cementRow.codFinanzas).toBe("02019901");
    expect(serviceRow.codFinanzas).toBe("02029902");
    expect(cementRow.nombreGrupoFinanciero).toBe(
      "Materiales de construcción"
    );
    expect(serviceRow.nombreGrupoFinanciero).toBe("Servicios técnicos");
    expect(cementRow.codigoSap).toBe("01010100001");
    expect(serviceRow.codigoSap).toBe("02020200002");
    expect(cementRow.descripcionFactura).toBe(
      "Cemento gris Portland tipo I"
    );
    expect(serviceRow.descripcionFactura).toBe("Servicio técnico exento");
    expect(cementRow.establecimiento).toBe("000");
    expect(cementRow.puntoEmision).toBe("001");
    expect(cementRow.tipoDocumento).toBe("01");
    expect(cementRow.correlativo).toBe("00010571");
    expect(cementRow.diasCredito).toBe(30);
    expect(cementRow.baseIsv15).toBe(1000);
    expect(cementRow.baseIsv0).toBe(0);
    expect(serviceRow.baseIsv15).toBe(0);
    expect(serviceRow.baseIsv0).toBe(250);
    expect(cementRow.isv15).toBe(150);
    expect(serviceRow.isv15).toBe(0);
    expect(
      payload.rows.reduce((sum, row) => sum + Number(row.totalRetencion), 0)
    ).toBe(30);
    expect(
      payload.rows.reduce((sum, row) => sum + Number(row.netoPagar), 0)
    ).toBe(1370);
    expect(cementRow.job).toBe("REQ-2026-0025");
    expect(cementRow.actividadFlujo).toBe("Solicitud de compra");
    expect(cementRow.level3).toBe("SP-01 - Cimentación");
    expect(payload.summary.invoiceCount).toBe(1);
    expect(cementRow.moneda).toBe("HNL");
    expect(payload.summary.totalsByCurrency).toEqual([
      expect.objectContaining({
        currency: "HNL",
        invoiceCount: 1,
        totalFactura: 1400,
      }),
    ]);
  });

  it("keeps HNL and USD totals separated without applying exchange rates", () => {
    const payload = buildDmcReportPayload([
      sarInvoice({
        invoiceId: 10,
        currency: "HNL",
        total: "115.0000",
        netPayable: "115.0000",
      }),
      sarInvoice({
        invoiceId: 11,
        currency: "USD",
        total: "115.0000",
        netPayable: "115.0000",
      }),
    ]);

    expect(payload.rows.map(row => row.moneda)).toEqual(["HNL", "USD"]);
    expect(payload.summary.totalsByCurrency).toEqual([
      expect.objectContaining({ currency: "HNL", totalFactura: 115 }),
      expect.objectContaining({ currency: "USD", totalFactura: 115 }),
    ]);
  });

  it("uses OCE exempt amount as DMC base 0 and keeps resolution in observation", () => {
    const payload = buildDmcReportPayload([
      {
        invoiceId: 2,
        invoiceDocumentNumber: "FAC-2026-0002",
        invoiceNumber: "000-001-01-00010572",
        status: "borrador",
        isFiscalDocument: true,
        documentDate: new Date("2026-07-02T12:00:00"),
        documentDueDate: new Date("2026-07-15T12:00:00"),
        subtotal: "500.0000",
        taxAmount: "0.0000",
        total: "500.0000",
        retentionTotal: "0.0000",
        netPayable: "500.0000",
        receiptNumber: "REC-2026-0002",
        hasOceExemption: true,
        oceResolutionNumber: "RES-123-2026",
        oceResolutionDate: new Date("2026-07-01T12:00:00"),
        oceExemptAmount: "325.5000",
        items: [
          {
            id: 12,
            itemName: "Compra con OCE",
            taxCode: "exe",
            subtotal: "500.0000",
            taxAmount: "0.0000",
            total: "500.0000",
            taxBreakdown: [],
          },
        ],
        retentions: [],
        materialRequests: [],
        subProjectLabels: [],
      },
    ]);

    expect(payload.rows[0].baseIsv0).toBe(325.5);
    expect(payload.rows[0].totalBase).toBe(325.5);
    expect(payload.rows[0].observacion).toContain("RES-123-2026");
  });
});

describe("DMC SAR 527 report mapper", () => {
  it("splits local, FYDUCA, and import invoices into official sections", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 1,
        invoiceNumber: "000-001-01-00000001",
      }),
      sarInvoice({
        invoiceId: 2,
        dmcForeignSection: "fyduca",
        dmcForeignIdentification: "P-CA-002",
        dmcFyducaNumber: "FY-0002",
      }),
      sarInvoice({
        invoiceId: 3,
        dmcForeignSection: "importacion",
        dmcForeignIdentification: "PASS-003",
        dmcDuaNumber: "DUA-0003",
        dmcImportOutsideCentralAmerica: true,
      }),
    ]);

    expect(payload.section52752).toHaveLength(1);
    expect(payload.section52752[0].documentClass).toBe("FA");
    expect(payload.section52753[0].fyducaNumber).toBe("FY-0002");
    expect(payload.section52754[0]).toMatchObject({
      duaNumber: "DUA-0003",
      base15: 0,
      base15OutsideCentralAmerica: 100,
    });
    expect(payload.summary).toMatchObject({
      invoiceCount: 3,
      section52752Count: 1,
      section52753Count: 1,
      section52754Count: 1,
    });
    expect(payload.canExport).toBe(true);
  });

  it("separates OCE 15%/18% and marks historical OCE without split incomplete", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 4,
        hasOceExemption: true,
        oceNumber: "OCE-001",
        oceResolutionNumber: "RES-OCE-2026",
        oceExemptAmount: "123.4500",
        oceExemptAmount15: "100.0000",
        oceExemptAmount18: "23.4500",
      }),
      sarInvoice({
        invoiceId: 5,
        hasOceExemption: true,
        oceNumber: "OCE-002",
        oceResolutionNumber: "RES-002",
        oceExemptAmount: "50.0000",
        oceExemptAmount15: null,
        oceExemptAmount18: null,
      }),
    ]);

    expect(payload.section52752[0]).toMatchObject({
      oceNumber: "OCE-001",
      oceResolutionNumber: "RES-OCE-2026",
      exonerated15: 100,
      exonerated18: 23.45,
    });
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          invoiceId: 5,
          field: "oceExemptAmount15",
        }),
      ])
    );
    expect(payload.canExport).toBe(false);
  });

  it("blocks ISV 4% but does not require DMC line classification", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 6,
        items: [
          {
            id: 6,
            itemName: "Compra ISV 4",
            taxCode: "isv_4",
            subtotal: "100.0000",
            taxAmount: "4.0000",
            total: "104.0000",
            taxBreakdown: [
              {
                taxCode: "isv_4",
                label: "ISV 4%",
                shortLabel: "ISV 4%",
                taxType: "base",
                fiscalCategory: "gravado",
                ratePercent: 4,
                rate: 0.04,
                baseAmount: 100,
                amount: 4,
                displayOrder: 40,
              },
            ],
            dmcDestination: null,
          },
        ],
      }),
    ]);

    expect(payload.canExport).toBe(false);
    expect(payload.issues.map(issue => issue.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("ISV 4%")])
    );
    expect(payload.issues.map(issue => issue.message)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("Clasifique")])
    );
    expect(payload.section52752[0]).toMatchObject({
      cost: null,
      expense: null,
      nonDeductible: null,
    });
  });

  it("exports blank cost, expense, and non-deductible columns without classification", () => {
    const unclassifiedItem = (id: number) => ({
      id,
      itemName: "Compra sin clasificación DMC",
      taxCode: "isv_15",
      subtotal: "100.0000",
      taxAmount: "15.0000",
      total: "115.0000",
      taxBreakdown: [],
      dmcDestination: null,
    });
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 8,
        items: [unclassifiedItem(8)],
      }),
      sarInvoice({
        invoiceId: 9,
        dmcForeignSection: "fyduca",
        dmcForeignIdentification: "ID-FY-009",
        dmcFyducaNumber: "FY-009",
        items: [unclassifiedItem(9)],
      }),
      sarInvoice({
        invoiceId: 10,
        dmcForeignSection: "importacion",
        dmcForeignIdentification: "ID-IMP-010",
        dmcDuaNumber: "DUA-010",
        items: [unclassifiedItem(10)],
      }),
    ]);

    expect(payload.canExport).toBe(true);
    expect(payload.issues).toEqual([]);
    for (const row of [
      payload.section52752[0],
      payload.section52753[0],
      payload.section52754[0],
    ]) {
      expect(row).toMatchObject({
        cost: null,
        expense: null,
        nonDeductible: null,
      });
    }

    const workbook = buildDmc527Workbook(XLSX, payload);
    const roundTrip = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { type: "buffer", cellDates: true }
    );
    expect(roundTrip.Sheets["527-52"].O2).toBeUndefined();
    expect(roundTrip.Sheets["527-52"].P2).toBeUndefined();
    expect(roundTrip.Sheets["527-52"].Q2).toBeUndefined();
    expect(roundTrip.Sheets["527-53"].N2).toBeUndefined();
    expect(roundTrip.Sheets["527-53"].O2).toBeUndefined();
    expect(roundTrip.Sheets["527-53"].P2).toBeUndefined();
    expect(roundTrip.Sheets["527-54"].O2).toBeUndefined();
    expect(roundTrip.Sheets["527-54"].P2).toBeUndefined();
    expect(roundTrip.Sheets["527-54"].Q2).toBeUndefined();
  });

  it("serializes the exact DMC 527 sheet order and hides Lista", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 7,
      }),
    ]);
    const workbook = buildDmc527Workbook(XLSX, payload);
    const roundTrip = XLSX.read(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
      { type: "buffer", cellDates: true }
    );
    expect(roundTrip.SheetNames).toEqual([
      "General",
      "Lista",
      "527-52",
      "527-53",
      "527-54",
    ]);
    expect(roundTrip.Workbook?.Sheets?.[1]?.Hidden).toBe(1);
    expect(roundTrip.Sheets.General.G4?.v).toBe(
      "DECLARACIÓN MENSUAL DE COMPRAS (D.M.C.)"
    );
    expect(roundTrip.Sheets.General.G5?.v).toBe(
      "52 - Compras en el mercado interno"
    );
    expect(roundTrip.Sheets.General.G6?.v).toBe("53 - FYDUCA");
    expect(roundTrip.Sheets.General.G7?.v).toBe("54 - Importaciones");
    expect(
      XLSX.utils.sheet_to_json(roundTrip.Sheets["527-52"], { header: 1 })[0]
    ).toEqual(expect.arrayContaining(["200-RTN", "290-Valor no deducible"]));
  });
});

describe("retention SAR workbooks", () => {
  it("consolidates RT15 per invoice and reconciles 15%/18% cents", () => {
    const invoice = sarInvoice({
      retentionReceiptNumber: "001-001-11-00000001",
      retentionCai: "338827-15203E-A419E0-63BE03-0909A6-53",
      retentionDocumentDate: new Date("2026-07-03T12:00:00"),
      items: [
        {
          id: 1,
          itemName: "Base 15",
          taxCode: "isv_15",
          subtotal: 60,
          taxAmount: 9,
          total: 69,
          dmcDestination: "costo",
          taxBreakdown: [
            {
              taxCode: "isv_15",
              label: "ISV 15%",
              shortLabel: "ISV 15%",
              taxType: "base",
              fiscalCategory: "gravado",
              ratePercent: 15,
              rate: 0.15,
              baseAmount: 60,
              amount: 9,
              displayOrder: 20,
            },
          ],
        },
        {
          id: 2,
          itemName: "Base 18",
          taxCode: "isv_18",
          subtotal: 40,
          taxAmount: 7.2,
          total: 47.2,
          dmcDestination: "gasto",
          taxBreakdown: [
            {
              taxCode: "isv_18",
              label: "ISV 18%",
              shortLabel: "ISV 18%",
              taxType: "base",
              fiscalCategory: "gravado",
              ratePercent: 18,
              rate: 0.18,
              baseAmount: 40,
              amount: 7.2,
              displayOrder: 30,
            },
          ],
        },
      ],
      retentions: [
        {
          id: 1,
          retentionCode: "RT15",
          baseAmount: "33.33",
          amount: "5.00",
        },
      ],
    });
    const payload = buildRetentionSarPayload([invoice], "RT15");
    expect(payload.canExport).toBe(true);
    expect(payload.rows).toHaveLength(1);
    expect(
      payload.rows[0].retainedBase15 + payload.rows[0].retainedBase18
    ).toBe(33.33);
    expect(payload.rows[0]).toMatchObject({
      retainedBase15: 20,
      retainedBase18: 13.33,
    });

    const workbook = buildRetentionSarWorkbook(XLSX, payload);
    expect(workbook.SheetNames).toEqual(["General", "Lista", "217-6"]);
    expect(workbook.Workbook?.Sheets?.[1]?.Hidden).toBe(1);
    const values = XLSX.utils.sheet_to_json(workbook.Sheets["217-6"], {
      header: 1,
    }) as unknown[][];
    expect(values[0]).toHaveLength(13);
    expect(values[1].slice(-2)).toEqual([20, 13.33]);
  });
});

describe("internal BuildReq workbook", () => {
  it("contains only the two client sheets and exact 32 invoice columns", () => {
    const payload = buildSystemWorkbookPayload(
      [sarInvoice()],
      [
        {
          orderNumber: "OC-001",
          job: "REQ-001",
          financialCode: "0201",
          date: new Date("2026-07-01"),
          supplierRtn: "08019002274414",
          supplierName: "Proveedor Demo",
          salesAdvisor: "Asesor",
          currency: "HNL",
          orderId: 1,
          itemNumber: 1,
          partNumber: "SAP-001",
          description: "Material",
          quantity: 1,
          unitPrice: 100,
          subtotal: 100,
          tax: 15,
          total: 115,
          purchaseType: "local",
          requestedBy: "Solicitante",
          deliveryDate: new Date("2026-07-10"),
          destination: "Proyecto",
          quoteReference: "55",
          status: "emitida",
        },
      ]
    );
    const workbook = buildSystemWorkbook(XLSX, payload);
    expect(workbook.SheetNames).toEqual([
      "Órdenes de Compra",
      "Registro Facturacion",
    ]);
    const rows = XLSX.utils.sheet_to_json(
      workbook.Sheets["Registro Facturacion"],
      { header: 1 }
    ) as unknown[][];
    expect(rows[1].slice(1)).toHaveLength(32);
    expect(rows.flat()).not.toContain("Data");
    expect(rows.flat()).not.toContain("Campos");
  });
});

describe("DMC report authorization", () => {
  it.each([
    "administracion_central",
    "administrador_proyecto",
    "contable",
  ] as const)("allows %s to generate reports", async buildreqRole => {
    vi.spyOn(db, "listDmcReportSourceInvoices").mockResolvedValue([]);
    const caller = appRouter.createCaller(
      createUserContext({ role: "user", buildreqRole })
    );

    await expect(
      caller.reports.dmcPurchases({
        dateFrom: null,
        dateTo: null,
        statusMode: "non_void",
      })
    ).resolves.toMatchObject({
      summary: { invoiceCount: 0 },
    });
  });

  it.each([
    { role: "user" as const, buildreqRole: "jefe_bodega_central" },
    { role: "user" as const, buildreqRole: "bodeguero_proyecto" },
    { role: "admin" as const, buildreqRole: null },
  ])("blocks report access for %o", async userOverride => {
    const caller = appRouter.createCaller(createUserContext(userOverride));

    await expect(
      caller.reports.dmcPurchases({
        dateFrom: null,
        dateTo: null,
        statusMode: "non_void",
      })
    ).rejects.toThrow("No tiene acceso a reportes");
  });

  it("applies assigned project scope to system, DMC, and retention endpoints", async () => {
    const invoiceSpy = vi
      .spyOn(db, "listDmcReportSourceInvoices")
      .mockResolvedValue([]);
    const orderSpy = vi
      .spyOn(db, "listSystemReportPurchaseOrderLines")
      .mockResolvedValue([]);
    const caller = appRouter.createCaller(
      createUserContext({
        role: "user",
        buildreqRole: "administrador_proyecto",
        assignedProjectId: 7,
        assignedProjectIds: [7],
      })
    );
    const input = {
      dateFrom: null,
      dateTo: null,
      statusMode: "non_void" as const,
    };

    await caller.reports.systemWorkbook(input);
    await caller.reports.dmcSarPurchases(input);
    await caller.reports.retentionSar({ ...input, type: "RT01" });

    for (const call of invoiceSpy.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ projectIds: [7] }));
    }
    expect(orderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [7] })
    );
  });
});

describe("invoice OCE validation", () => {
  it("rejects active OCE without resolution number", async () => {
    const caller = appRouter.createCaller(createUserContext());

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: true,
        oceNumber: "OCE-001",
        oceResolutionNumber: "",
        oceResolutionDate: "2026-07-01",
        oceExemptAmount: "100",
        oceExemptAmount15: "100",
        oceExemptAmount18: "0",
      })
    ).rejects.toThrow("Ingrese el número de resolución OCE");
  });

  it("rejects active OCE without resolution date", async () => {
    const caller = appRouter.createCaller(createUserContext());

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: true,
        oceNumber: "OCE-001",
        oceResolutionNumber: "RES-123-2026",
        oceResolutionDate: "",
        oceExemptAmount: "100",
        oceExemptAmount15: "100",
        oceExemptAmount18: "0",
      })
    ).rejects.toThrow("Seleccione la fecha de resolución OCE");
  });

  it("rejects active OCE with zero exempt amount", async () => {
    const caller = appRouter.createCaller(createUserContext());

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: true,
        oceNumber: "OCE-001",
        oceResolutionNumber: "RES-123-2026",
        oceResolutionDate: "2026-07-01",
        oceExemptAmount: "0",
        oceExemptAmount15: "0",
        oceExemptAmount18: "0",
      })
    ).rejects.toThrow(
      "Ingrese un importe exonerado al 15% o 18% mayor que cero"
    );
  });

  it("allows inactive OCE with empty OCE fields", async () => {
    const caller = appRouter.createCaller(createUserContext());
    const updateInvoice = mockEditableInvoice();

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: false,
        oceResolutionNumber: "",
        oceResolutionDate: "",
        oceExemptAmount: "0",
      })
    ).resolves.toEqual({ id: 1 });

    expect(updateInvoice).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        hasOceExemption: false,
        oceResolutionNumber: null,
        oceResolutionDate: null,
        oceExemptAmount: "0.0000",
      })
    );
  });
});
