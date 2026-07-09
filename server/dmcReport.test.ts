import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DMC_COLUMNS,
  buildDmcReportPayload,
  type DmcReportSourceInvoice,
} from "@shared/dmc-report";
import { buildDmcSarReportPayload } from "@shared/dmc-sar-report";
import { buildSarSheetDefinitions } from "../client/src/lib/dmc-export";
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
    postingDate: overrides.postingDate ?? null,
    receiptDate: overrides.receiptDate ?? null,
    retentionReceiptNumber: overrides.retentionReceiptNumber ?? null,
    hasOceExemption: overrides.hasOceExemption ?? false,
    oceResolutionNumber: overrides.oceResolutionNumber ?? null,
    oceResolutionDate: overrides.oceResolutionDate ?? null,
    oceExemptAmount: overrides.oceExemptAmount ?? "0.0000",
    subtotal: overrides.subtotal ?? "100.0000",
    taxAmount: overrides.taxAmount ?? "15.0000",
    total: overrides.total ?? "115.0000",
    retentionTotal: overrides.retentionTotal ?? "0.0000",
    netPayable: overrides.netPayable ?? "115.0000",
    receiptNumber: overrides.receiptNumber ?? null,
    purchaseOrderNumber: overrides.purchaseOrderNumber ?? "OC-2026-0001",
    purchaseType: overrides.purchaseType ?? "local",
    purchaseOrderPaymentMethod: overrides.purchaseOrderPaymentMethod ?? null,
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
              itemName: "Cemento gris",
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
              itemName: "Servicio exento",
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

    const row = payload.rows[0];
    expect(DMC_COLUMNS.map(column => column.header)).toContain("N° REGISTRO");
    expect(row.establecimiento).toBe("000");
    expect(row.puntoEmision).toBe("001");
    expect(row.tipoDocumento).toBe("01");
    expect(row.correlativo).toBe("00010571");
    expect(row.diasCredito).toBe(30);
    expect(row.baseIsv15).toBe(1000);
    expect(row.baseIsv0).toBe(250);
    expect(row.isv15).toBe(150);
    expect(row.retIsr1).toBe(10);
    expect(row.retIsv).toBe(20);
    expect(row.totalRetencion).toBe(30);
    expect(row.netoPagar).toBe(1370);
    expect(row.job).toBe("REQ-2026-0025");
    expect(row.actividadFlujo).toBe("Solicitud de compra");
    expect(row.level3).toBe("SP-01 - Cimentación");
    expect(payload.summary.invoiceCount).toBe(1);
    expect(payload.summary.totalFactura).toBe(1400);
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

describe("DMC SAR report mapper", () => {
  it("splits local invoices, other receipts, and imports into SAR sheets", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 1,
        invoiceNumber: "000-001-01-00000001",
        purchaseType: "local",
      }),
      sarInvoice({
        invoiceId: 2,
        invoiceDocumentNumber: "FT-2026-0002",
        invoiceNumber: "000-001-02-00000002",
        purchaseType: "local",
      }),
      sarInvoice({
        invoiceId: 3,
        invoiceNumber: "000-001-01-00000003",
        purchaseType: "extranjera",
      }),
    ]);

    expect(payload.detalleCompras).toHaveLength(1);
    expect(payload.detalleCompras[0].tipoDocumento).toBe("01");
    expect(payload.detalleCompras[0].correlativo).toBe("00000001");
    expect(payload.otrosComprobantes).toHaveLength(1);
    expect(payload.otrosComprobantes[0].tipoDocumento).toBe("02");
    expect(payload.otrosComprobantes[0].numeroDocumentoEquivalente).toBe(
      "000-001-02-00000002"
    );
    expect(payload.detalleImportaciones).toHaveLength(1);
    expect(payload.detalleImportaciones[0]).toMatchObject({
      identificadorTributarioProveedor: "08019002274414",
      razonSocialProveedor: "Proveedor Demo",
      numeroDua: "",
      numeroLiquidacion: "",
      numeroResolucionExoneracionSefin: "",
      fechaVencimientoResolucion: null,
    });
    expect(payload.comprasEventuales).toHaveLength(0);
    expect(payload.summary).toMatchObject({
      invoiceCount: 3,
      detalleComprasCount: 1,
      otrosComprobantesCount: 1,
      comprasEventualesCount: 0,
      importacionesCount: 1,
    });
  });

  it("uses OCE amount for exempt purchases and tax breakdown for non-OCE base 0", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 4,
        invoiceNumber: "000-001-01-00000004",
        hasOceExemption: true,
        oceResolutionNumber: "RES-OCE-2026",
        oceResolutionDate: new Date("2026-07-02T12:00:00.000"),
        oceExemptAmount: "123.4500",
        items: [
          {
            id: 4,
            itemName: "Compra OCE",
            taxCode: "exe",
            subtotal: "200.0000",
            taxAmount: "0.0000",
            total: "200.0000",
            taxBreakdown: [],
          },
        ],
      }),
      sarInvoice({
        invoiceId: 5,
        invoiceNumber: "000-001-01-00000005",
        items: [
          {
            id: 5,
            itemName: "Compra exenta",
            taxCode: "exe",
            subtotal: "50.0000",
            taxAmount: "0.0000",
            total: "50.0000",
            taxBreakdown: [
              {
                taxCode: "exe",
                label: "EXE - Exento",
                shortLabel: "EXE",
                taxType: "base",
                fiscalCategory: "exento",
                ratePercent: 0,
                rate: 0,
                baseAmount: 50,
                amount: 0,
                displayOrder: 10,
              },
            ],
          },
        ],
      }),
    ]);

    expect(payload.detalleCompras[0]).toMatchObject({
      compraConOce: "SI",
      oceResolutionNumber: "RES-OCE-2026",
      importeExento: 123.45,
    });
    expect(payload.detalleCompras[1]).toMatchObject({
      compraConOce: "NO",
      oceResolutionNumber: "",
      importeExento: 50,
    });
  });

  it("tracks ISV 4% as a SAR warning without mixing it into 15% or 18%", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 6,
        invoiceNumber: "000-001-01-00000006",
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
          },
        ],
      }),
    ]);

    expect(payload.detalleCompras[0].importeGravado15).toBeNull();
    expect(payload.detalleCompras[0].importeGravado18).toBeNull();
    expect(payload.summary.isv4InvoiceCount).toBe(1);
    expect(payload.summary.isv4BaseTotal).toBe(100);
    expect(payload.summary.isv4TaxTotal).toBe(4);
  });

  it("builds SAR workbook definitions with expected sheets and headers only", () => {
    const payload = buildDmcSarReportPayload([
      sarInvoice({
        invoiceId: 7,
        invoiceNumber: "000-001-01-00000007",
        supplierRtn: "08019002274414",
      }),
    ]);
    const sheets = buildSarSheetDefinitions(payload);
    const allValues = sheets.flatMap(sheet => sheet.rows.flat());

    expect(sheets.map(sheet => sheet.sheetName)).toEqual([
      "Detalle Compras",
      "Otros Comprobantes de Compra",
      "Compras Eventuales",
      "Detalle Importaciones",
    ]);
    expect(sheets[0].rows[2]).toContain("TIPO DE DOCUMENTO");
    expect(sheets[1].rows[2]).toContain("NÚMERO DE DOCUMENTO EQUIVALENTE");
    expect(sheets[2].rows[2]).toContain("PASAPORTE ");
    expect(sheets[3].rows[1]).toContain("NÚMERO DE LA DUA ");
    expect(sheets[0].rows[3][0]).toBe("08019002274414");
    expect(allValues).not.toContain("LIBERTY NETWORKS HONDURAS");
  });
});

describe("invoice OCE validation", () => {
  it("rejects active OCE without resolution number", async () => {
    const caller = appRouter.createCaller(createUserContext());

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: true,
        oceResolutionNumber: "",
        oceResolutionDate: "2026-07-01",
        oceExemptAmount: "100",
      })
    ).rejects.toThrow("Ingrese el número de resolución OCE");
  });

  it("rejects active OCE without resolution date", async () => {
    const caller = appRouter.createCaller(createUserContext());

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: true,
        oceResolutionNumber: "RES-123-2026",
        oceResolutionDate: "",
        oceExemptAmount: "100",
      })
    ).rejects.toThrow("Seleccione la fecha de resolución OCE");
  });

  it("rejects active OCE with zero exempt amount", async () => {
    const caller = appRouter.createCaller(createUserContext());

    await expect(
      caller.invoices.update({
        ...validInvoiceUpdateInput,
        hasOceExemption: true,
        oceResolutionNumber: "RES-123-2026",
        oceResolutionDate: "2026-07-01",
        oceExemptAmount: "0",
      })
    ).rejects.toThrow("Ingrese un importe exento mayor que cero");
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
