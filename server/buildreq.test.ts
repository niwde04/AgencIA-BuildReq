import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import * as storage from "./storage";
import * as supabaseAdmin from "./_core/supabaseAdmin";
import { validateDocumentAttachmentFile } from "./routers/attachments";
import {
  buildProcurementPdfBase64,
  buildPurchaseOrderPrintPdfBase64,
} from "./_core/documents";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import {
  calculatePurchaseOrderLineAmounts,
  calculateContractPaymentDates,
  getPurchaseOrderFiscalSummaryRows,
  getPurchaseOrderContractSummary,
  getPurchaseOrderTaxSelectionError,
  summarizePurchaseOrderLines,
} from "../shared/purchase-orders";
import {
  isInvoiceNumberWithinFiscalRange,
  normalizeFiscalRtn,
} from "../shared/invoices";

// ============================================================
// Test helpers
// ============================================================
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(overrides: Partial<AuthenticatedUser> = {}): {
  ctx: TrpcContext;
  clearedCookies: any[];
} {
  const clearedCookies: any[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@buildreq.com",
    name: "Test User",
    loginMethod: "manus",
    role: "admin",
    buildreqRole: "jefe_bodega_central",
    assignedProjectId: null,
    mustChangePassword: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  if (!("assignedProjectIds" in overrides)) {
    user.assignedProjectIds = user.assignedProjectId
      ? [user.assignedProjectId]
      : [];
  }
  if (!("assignedProjects" in overrides)) {
    user.assignedProjects = [];
  }

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createIngenieroContext() {
  return createUserContext({
    id: 2,
    openId: "test-ingeniero-001",
    role: "user",
    buildreqRole: "ingeniero_residente",
    assignedProjectId: 1,
    name: "Ing. Residente Test",
  });
}

function createBodegaContext() {
  return createUserContext({
    id: 3,
    openId: "test-bodega-001",
    role: "user",
    buildreqRole: "jefe_bodega_central",
    name: "Jefe Bodega Test",
  });
}

function createAdminCentralContext() {
  return createUserContext({
    id: 4,
    openId: "test-admin-central-001",
    role: "user",
    buildreqRole: "administracion_central",
    name: "Admin Central Test",
  });
}

function createProjectAdminContext(overrides: Partial<AuthenticatedUser> = {}) {
  return createUserContext({
    id: 5,
    openId: "test-project-admin-001",
    role: "user",
    buildreqRole: "administrador_proyecto",
    assignedProjectId: 1,
    name: "Admin Proyecto Test",
    ...overrides,
  });
}

function createProjectBodegueroContext(
  overrides: Partial<AuthenticatedUser> = {}
) {
  return createUserContext({
    id: 6,
    openId: "test-project-bodeguero-001",
    role: "user",
    buildreqRole: "bodeguero_proyecto",
    assignedProjectId: 1,
    name: "Bodeguero Proyecto Test",
    ...overrides,
  });
}

function createContableContext(overrides: Partial<AuthenticatedUser> = {}) {
  return createUserContext({
    id: 7,
    openId: "test-contable-001",
    role: "user",
    buildreqRole: "contable",
    assignedProjectId: null,
    name: "Contable Test",
    ...overrides,
  });
}

function createSuperintendentContext(
  overrides: Partial<AuthenticatedUser> = {}
) {
  return createUserContext({
    id: 8,
    openId: "test-superintendente-001",
    role: "user",
    buildreqRole: "superintendente",
    assignedProjectId: 1,
    name: "Superintendente Test",
    ...overrides,
  });
}

const VALID_CAI = "338827-15203E-A419E0-63BE03-0909A6-53";
const VALID_INVOICE_NUMBER = "000-001-01-00010571";
const VALID_INVOICE_NUMBER_ALT = "000-001-01-00010572";
const VALID_DOCUMENT_RANGE_START = "000-001-01-00000001";
const VALID_DOCUMENT_RANGE_END = "000-001-01-99999999";
const VALID_PDF_BASE64 = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"
).toString("base64");
const DEFAULT_PROJECT_WAREHOUSE_ID = 101;
const DEFAULT_PROJECT_WAREHOUSE = {
  id: DEFAULT_PROJECT_WAREHOUSE_ID,
  projectId: 1,
  code: "WH-P001",
  localCode: "GENERAL",
  name: "Almacén principal",
  displayName: "P001 - GENERAL - Almacén principal",
  isActive: true,
  isDefault: true,
} as any;

describe("BuildReq - Invoice fiscal helpers", () => {
  it("normalizes RTN and compares fiscal ranges inclusively", () => {
    expect(normalizeFiscalRtn("0801-1990-12345")).toBe("0801199012345");
    expect(
      isInvoiceNumberWithinFiscalRange({
        invoiceNumber: VALID_DOCUMENT_RANGE_START,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
      })
    ).toBe(true);
    expect(
      isInvoiceNumberWithinFiscalRange({
        invoiceNumber: VALID_DOCUMENT_RANGE_END,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
      })
    ).toBe(true);
    expect(
      isInvoiceNumberWithinFiscalRange({
        invoiceNumber: "000-001-01-00000000",
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
      })
    ).toBe(false);
  });
});

// ============================================================
// Tests: Purchase order tax helpers
// ============================================================
describe("BuildReq - Purchase order tax helpers", () => {
  it("calculates ISV 18% line amounts", () => {
    expect(
      calculatePurchaseOrderLineAmounts({
        quantity: "2",
        unitPrice: "100.00",
        taxCode: "isv_18",
      })
    ).toMatchObject({
      subtotal: 200,
      taxAmount: 36,
      total: 236,
      taxCode: "isv_18",
    });
  });

  it("calculates ISV 4% line amounts separately", () => {
    expect(
      calculatePurchaseOrderLineAmounts({
        quantity: "1",
        unitPrice: "1000.00",
        taxCode: "isv_4",
      })
    ).toMatchObject({
      subtotal: 1000,
      taxAmount: 40,
      total: 1040,
      taxCode: "isv_4",
      additionalTaxCodes: [],
    });
  });

  it("keeps four decimals internally for purchase order money", () => {
    expect(
      calculatePurchaseOrderLineAmounts({
        quantity: "3.00",
        unitPrice: "10.1234",
        taxCode: "isv_15",
      })
    ).toMatchObject({
      subtotal: 30.3702,
      taxAmount: 4.5555,
      total: 34.9257,
      taxCode: "isv_15",
    });
  });

  it("summarizes purchase orders in invoice-style fiscal rows", () => {
    const summary = summarizePurchaseOrderLines([
      { quantity: "1", unitPrice: "100.00", taxCode: "exe" },
      { quantity: "2", unitPrice: "100.00", taxCode: "isv_15" },
      { quantity: "3", unitPrice: "100.00", taxCode: "isv_18" },
    ]);
    const rows = getPurchaseOrderFiscalSummaryRows(summary);

    expect(summary).toMatchObject({
      subtotal: 600,
      totalExonerated: 0,
      totalExempt: 100,
      totalTaxed15: 200,
      totalTaxed18: 300,
      totalIsv15: 30,
      totalIsv18: 54,
      total: 684,
    });
    expect(rows.map(row => row.label)).toEqual([
      "Sub-total L.",
      "Importe exonerado L.",
      "Importe exento L.",
      "Importe gravado 15% L.",
      "Importe gravado 18% L.",
      "Importe gravado 4% L.",
      "I.S.V. 15% L.",
      "I.S.V. 18% L.",
      "I.S.V. 4% L.",
      "Total a pagar L.",
    ]);
  });
});

// ============================================================
// Tests: Purchase order contract helpers
// ============================================================
describe("BuildReq - Purchase order contract helpers", () => {
  it("calculates twelve monthly payments from January 1 to December 31", () => {
    const paymentDates = calculateContractPaymentDates({
      frequency: "mensual",
      firstPaymentDate: "2026-01-01",
      endDate: "2026-12-31",
    });

    expect(paymentDates).toHaveLength(12);
    expect(paymentDates[0]?.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(paymentDates[11]?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("derives pending contract invoice progress and expiration flags", () => {
    const summary = getPurchaseOrderContractSummary({
      appliesContract: true,
      contractPaymentFrequency: "mensual",
      contractFirstPaymentDate: "2026-01-01",
      contractEndDate: "2026-12-31",
      registeredInvoiceCount: 1,
      now: new Date("2026-12-05T12:00:00"),
    });

    expect(summary.expectedInvoiceCount).toBe(12);
    expect(summary.registeredInvoiceCount).toBe(1);
    expect(summary.remainingInvoiceCount).toBe(11);
    expect(summary.expiresSoon).toBe(true);
    expect(summary.isExpired).toBe(false);
    expect(summary.statusLabel).toBe("Pendiente 1 de 12");
  });
});

// ============================================================
// Tests: Tax retentions catalog
// ============================================================
describe("BuildReq - Tax retentions catalog", () => {
  it("Admin central can list retentions with filters and pagination", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const listTaxRetentionsSpy = vi
      .spyOn(db, "listTaxRetentions")
      .mockResolvedValue({
        items: [
          {
            id: 1,
            taxCode: "RT125",
            description: "Retención 12.5%",
            ratePercent: "12.5000",
            isActive: true,
            note: "Base a ley x y o z",
            erpCode: "R12",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      } as any);

    await expect(
      caller.retentions.list({
        search: "RT",
        isActive: true,
        page: 1,
        pageSize: 25,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({ taxCode: "RT125" })],
      })
    );

    expect(listTaxRetentionsSpy).toHaveBeenCalledWith({
      search: "RT",
      isActive: true,
      page: 1,
      pageSize: 25,
    });

    listTaxRetentionsSpy.mockRestore();
  });

  it("Project Administrator can list retentions in read-only mode", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const listTaxRetentionsSpy = vi
      .spyOn(db, "listTaxRetentions")
      .mockResolvedValue({
        items: [
          {
            id: 1,
            taxCode: "RT125",
            description: "Retención 12.5%",
            ratePercent: "12.5000",
            isActive: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      } as any);

    await expect(
      caller.retentions.list({ page: 1, pageSize: 25 })
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({ taxCode: "RT125" })],
      })
    );

    listTaxRetentionsSpy.mockRestore();
  });

  it("Accountant can create retentions", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const createTaxRetentionSpy = vi
      .spyOn(db, "createTaxRetention")
      .mockResolvedValue({
        id: 2,
        taxCode: "RT01",
        description: "Retención 1%",
        ratePercent: "1.0000",
        isActive: true,
      } as any);

    await expect(
      caller.retentions.create({
        taxCode: "rt01",
        description: "Retención 1%",
        ratePercent: "1",
        isActive: true,
        note: "Base a ley x y o z",
        erpCode: "r01",
      })
    ).resolves.toEqual(expect.objectContaining({ taxCode: "RT01" }));

    expect(createTaxRetentionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        taxCode: "RT01",
        ratePercent: "1",
        erpCode: "R01",
      })
    );

    createTaxRetentionSpy.mockRestore();
  });

  it("Project Administrator cannot create retentions", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const createTaxRetentionSpy = vi.spyOn(db, "createTaxRetention");

    await expect(
      caller.retentions.create({
        taxCode: "RT99",
        description: "Retención prueba",
        ratePercent: "9",
        isActive: true,
      })
    ).rejects.toThrow("No tiene permisos para modificar retenciones");

    expect(createTaxRetentionSpy).not.toHaveBeenCalled();
    createTaxRetentionSpy.mockRestore();
  });

  it("Admin central can read but cannot create retentions", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const createTaxRetentionSpy = vi.spyOn(db, "createTaxRetention");

    await expect(
      caller.retentions.create({
        taxCode: "RT98",
        description: "Retención central",
        ratePercent: "9",
        isActive: true,
      })
    ).rejects.toThrow("No tiene permisos para modificar retenciones");

    expect(createTaxRetentionSpy).not.toHaveBeenCalled();
    createTaxRetentionSpy.mockRestore();
  });

  it("Blocks retention maintenance for unauthorized roles", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const createTaxRetentionSpy = vi.spyOn(db, "createTaxRetention");

    await expect(
      caller.retentions.create({
        taxCode: "RT99",
        description: "Retención prueba",
        ratePercent: "9",
        isActive: true,
      })
    ).rejects.toThrow("No tiene permisos para modificar retenciones");

    expect(createTaxRetentionSpy).not.toHaveBeenCalled();
    createTaxRetentionSpy.mockRestore();
  });

  it("Returns active retentions for invoice combo", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const listActiveTaxRetentionsSpy = vi
      .spyOn(db, "listActiveTaxRetentions")
      .mockResolvedValue([
        {
          id: 3,
          taxCode: "RT15",
          description: "Retención 15%",
          ratePercent: "15.0000",
          isActive: true,
        },
      ] as any);

    await expect(caller.retentions.activeOptions()).resolves.toEqual([
      expect.objectContaining({ taxCode: "RT15", isActive: true }),
    ]);

    listActiveTaxRetentionsSpy.mockRestore();
  });
});

// ============================================================
// Tests: Sales taxes catalog
// ============================================================
describe("BuildReq - Sales taxes catalog", () => {
  it("Admin central can create sales taxes", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const createSalesTaxSpy = vi.spyOn(db, "createSalesTax").mockResolvedValue({
      id: 10,
      taxCode: "isv_4",
      description: "ISV 4%",
      shortLabel: "ISV 4%",
      ratePercent: "4.0000",
      taxType: "base",
      fiscalCategory: "gravado",
      isActive: true,
      displayOrder: 40,
      appliesToTaxCodes: [],
    } as any);

    await expect(
      caller.taxes.create({
        taxCode: "ISV 4",
        description: "ISV 4%",
        shortLabel: "ISV 4%",
        ratePercent: "4",
        taxType: "base",
        fiscalCategory: "gravado",
        isActive: true,
        displayOrder: 40,
        appliesToTaxCodes: [],
      })
    ).resolves.toEqual(expect.objectContaining({ taxCode: "isv_4" }));

    expect(createSalesTaxSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        taxCode: "ISV 4",
        ratePercent: "4",
        appliesToTaxCodes: [],
      })
    );

    createSalesTaxSpy.mockRestore();
  });

  it("Project Administrator can list sales taxes read-only", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const listSalesTaxesSpy = vi.spyOn(db, "listSalesTaxes").mockResolvedValue({
      items: [
        {
          id: 1,
          taxCode: "isv_15",
          description: "ISV 15%",
          shortLabel: "ISV 15%",
          ratePercent: "15.0000",
          taxType: "base",
          fiscalCategory: "gravado",
          isActive: true,
          displayOrder: 20,
          appliesToTaxCodes: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    } as any);

    await expect(caller.taxes.list({ page: 1, pageSize: 25 })).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({ taxCode: "isv_15" })],
      })
    );

    listSalesTaxesSpy.mockRestore();
  });

  it("Treats ISV 4% as a standalone selectable tax", () => {
    expect(
      getPurchaseOrderTaxSelectionError({
        taxCode: "isv_4",
        additionalTaxCodes: [],
      })
    ).toBeNull();
  });
});

// ============================================================
// Tests: Articles catalog
// ============================================================
describe("BuildReq - Articles catalog", () => {
  it("Authorized users can list articles with filters and pagination", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const listArticlesSpy = vi.spyOn(db, "listArticles").mockResolvedValue({
      items: [
        {
          id: 1,
          itemCode: "SERV-001",
          description: "Servicio de transporte",
          itemGroup: "Servicios",
          tipoArticulo: 2,
          projectId: null,
          allowsTaxWithholding: true,
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    } as any);

    await expect(
      caller.articles.list({
        search: "transporte",
        tipoArticulo: 2,
        isActive: true,
        allowsTaxWithholding: true,
        page: 1,
        pageSize: 25,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({ tipoArticulo: 2 })],
      })
    );

    expect(listArticlesSpy).toHaveBeenCalledWith({
      search: "transporte",
      tipoArticulo: 2,
      isActive: true,
      allowsTaxWithholding: true,
      page: 1,
      pageSize: 25,
    });

    listArticlesSpy.mockRestore();
  });

  it("Contable lists pending temporary fixed assets by default", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const listArticlesSpy = vi.spyOn(db, "listArticles").mockResolvedValue({
      items: [
        {
          id: 10,
          itemCode: "OC-006-0001",
          temporaryItemCode: "OC-006-0001",
          description: "COMPUTADORA ESCRITORIO",
          tipoArticulo: 3,
          fixedAssetStatus: "pendiente",
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    } as any);

    await expect(
      caller.articles.list({ page: 1, pageSize: 25 })
    ).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ fixedAssetStatus: "pendiente" })],
      })
    );

    expect(listArticlesSpy).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      tipoArticulo: 3,
      fixedAssetStatus: "pendiente",
      temporaryOnly: true,
    });

    listArticlesSpy.mockRestore();
  });

  it("Contable can resolve a temporary fixed asset code", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const resolveFixedAssetArticleCodeSpy = vi
      .spyOn(db, "resolveFixedAssetArticleCode")
      .mockResolvedValue({
        id: 10,
        itemCode: "12120100014",
        temporaryItemCode: "OC-006-0001",
        fixedAssetStatus: "resuelto",
      } as any);

    await expect(
      caller.articles.resolveFixedAssetCode({
        id: 10,
        itemCode: "12120100014",
      })
    ).resolves.toEqual(
      expect.objectContaining({ fixedAssetStatus: "resuelto" })
    );

    expect(resolveFixedAssetArticleCodeSpy).toHaveBeenCalledWith({
      id: 10,
      itemCode: "12120100014",
    });

    resolveFixedAssetArticleCodeSpy.mockRestore();
  });

  it("Contable can edit temporary fixed asset details", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const updateFixedAssetArticleDetailsSpy = vi
      .spyOn(db, "updateFixedAssetArticleDetails")
      .mockResolvedValue({
        id: 10,
        itemCode: "OC-006-0001",
        temporaryItemCode: "OC-006-0001",
        fixedAssetSerialNumber: "SN-EDIT",
        fixedAssetCondition: "usado_buen_estado",
        fixedAssetColor: "Azul",
      } as any);

    await expect(
      caller.articles.updateFixedAssetDetails({
        id: 10,
        isLeasing: true,
        observation: "Equipo verificado",
        assetDetail: {
          serialNumber: "SN-EDIT",
          condition: "usado_buen_estado",
          color: "Azul",
          model: "Modelo X",
          brand: "Marca Y",
          chassisSeries: "CH-2",
          motorSeries: "MT-2",
          plateOrCode: "PL-2",
        },
      })
    ).resolves.toEqual(
      expect.objectContaining({ fixedAssetSerialNumber: "SN-EDIT" })
    );

    expect(updateFixedAssetArticleDetailsSpy).toHaveBeenCalledWith({
      id: 10,
      isLeasing: true,
      observation: "Equipo verificado",
      assetDetail: expect.objectContaining({
        serialNumber: "SN-EDIT",
        condition: "usado_buen_estado",
        color: "Azul",
      }),
    });

    updateFixedAssetArticleDetailsSpy.mockRestore();
  });

  it("Blocks resolving fixed asset codes for users without permission", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const resolveFixedAssetArticleCodeSpy = vi.spyOn(
      db,
      "resolveFixedAssetArticleCode"
    );

    await expect(
      caller.articles.resolveFixedAssetCode({
        id: 10,
        itemCode: "12120100014",
      })
    ).rejects.toThrow("No tiene permisos para resolver activos fijos");

    expect(resolveFixedAssetArticleCodeSpy).not.toHaveBeenCalled();
    resolveFixedAssetArticleCodeSpy.mockRestore();
  });

  it("Blocks editing fixed asset details for users without permission", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateFixedAssetArticleDetailsSpy = vi.spyOn(
      db,
      "updateFixedAssetArticleDetails"
    );

    await expect(
      caller.articles.updateFixedAssetDetails({
        id: 10,
        assetDetail: {
          serialNumber: "SN-001",
          condition: "nuevo",
        },
      })
    ).rejects.toThrow("No tiene permisos para editar datos del activo fijo");

    expect(updateFixedAssetArticleDetailsSpy).not.toHaveBeenCalled();
    updateFixedAssetArticleDetailsSpy.mockRestore();
  });

  it("Builds project-scoped temporary fixed asset codes with four digits", () => {
    expect(
      db.buildTemporaryFixedAssetItemCode({
        projectCode: "006",
        existingCodes: ["OC-006-0001", "OC-006-0007"],
      })
    ).toBe("OC-006-0008");
  });

  it("Admin or Jefe de Bodega can update article type and status", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const updateArticleSpy = vi.spyOn(db, "updateArticle").mockResolvedValue({
      id: 1,
      tipoArticulo: 3,
      projectId: null,
      isActive: false,
      allowsTaxWithholding: false,
    } as any);

    await expect(
      caller.articles.update({
        id: 1,
        tipoArticulo: 3,
        isActive: false,
        allowsTaxWithholding: false,
      })
    ).resolves.toEqual(expect.objectContaining({ tipoArticulo: 3 }));

    expect(updateArticleSpy).toHaveBeenCalledWith(1, {
      tipoArticulo: 3,
      projectId: null,
      isActive: false,
      allowsTaxWithholding: false,
    });

    updateArticleSpy.mockRestore();
  });

  it("Rejects invalid article type values", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const updateArticleSpy = vi.spyOn(db, "updateArticle");

    await expect(
      caller.articles.update({
        id: 1,
        tipoArticulo: 4 as any,
        isActive: true,
        allowsTaxWithholding: true,
      })
    ).rejects.toThrow();

    expect(updateArticleSpy).not.toHaveBeenCalled();
    updateArticleSpy.mockRestore();
  });

  it("Blocks article updates for read-only users", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateArticleSpy = vi.spyOn(db, "updateArticle");

    await expect(
      caller.articles.update({
        id: 1,
        tipoArticulo: 1,
        isActive: true,
        allowsTaxWithholding: true,
      })
    ).rejects.toThrow("No tiene permisos para modificar artículos");

    expect(updateArticleSpy).not.toHaveBeenCalled();
    updateArticleSpy.mockRestore();
  });

  it("Blocks article listing for unauthorized roles", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const listArticlesSpy = vi.spyOn(db, "listArticles");

    await expect(caller.articles.list()).rejects.toThrow(
      "No tiene acceso al catálogo de artículos"
    );

    expect(listArticlesSpy).not.toHaveBeenCalled();
    listArticlesSpy.mockRestore();
  });
});

// ============================================================
// Tests: Suppliers catalog
// ============================================================
describe("BuildReq - Suppliers catalog", () => {
  it("Authorized users can list suppliers with filters and pagination", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const listSupplierCatalogSpy = vi
      .spyOn(db, "listSupplierCatalog")
      .mockResolvedValue({
        items: [
          {
            id: 5,
            supplierCode: "PL-00005",
            name: "Proveedor Demo",
            email: "proveedor@example.com",
            allowsTaxWithholding: true,
            subjectToAccountPayments: true,
            isActive: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      } as any);

    await expect(
      caller.suppliers.list({
        search: "Proveedor",
        isActive: true,
        page: 1,
        pageSize: 25,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({ allowsTaxWithholding: true })],
      })
    );

    expect(listSupplierCatalogSpy).toHaveBeenCalledWith({
      search: "Proveedor",
      isActive: true,
      page: 1,
      pageSize: 25,
    });

    listSupplierCatalogSpy.mockRestore();
  });

  it("Project Administrator can list suppliers to manage project contacts", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const listSupplierCatalogSpy = vi
      .spyOn(db, "listSupplierCatalog")
      .mockResolvedValue({
        items: [
          {
            id: 5,
            supplierCode: "PL-00005",
            name: "Proveedor Demo",
            email: "proveedor@example.com",
            allowsTaxWithholding: true,
            subjectToAccountPayments: true,
            isActive: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        totalPages: 1,
      } as any);

    await expect(
      caller.suppliers.list({ page: 1, pageSize: 25 })
    ).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        items: [expect.objectContaining({ supplierCode: "PL-00005" })],
      })
    );

    listSupplierCatalogSpy.mockRestore();
  });

  it("Authorized users can update supplier fiscal flags", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateSupplierSpy = vi.spyOn(db, "updateSupplier").mockResolvedValue({
      id: 5,
      allowsTaxWithholding: false,
      subjectToAccountPayments: false,
    } as any);

    await expect(
      caller.suppliers.update({
        id: 5,
        allowsTaxWithholding: false,
        subjectToAccountPayments: false,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        allowsTaxWithholding: false,
        subjectToAccountPayments: false,
      })
    );

    expect(updateSupplierSpy).toHaveBeenCalledWith(5, {
      allowsTaxWithholding: false,
      subjectToAccountPayments: false,
    });

    updateSupplierSpy.mockRestore();
  });

  it("Project Administrator cannot update supplier fiscal flags", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const updateSupplierSpy = vi.spyOn(db, "updateSupplier");

    await expect(
      caller.suppliers.update({
        id: 5,
        allowsTaxWithholding: false,
        subjectToAccountPayments: false,
      })
    ).rejects.toThrow(
      "No tiene permisos para modificar el catálogo de proveedores"
    );

    expect(updateSupplierSpy).not.toHaveBeenCalled();
    updateSupplierSpy.mockRestore();
  });

  it("Blocks supplier listing for unauthorized roles", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const listSupplierCatalogSpy = vi.spyOn(db, "listSupplierCatalog");

    await expect(caller.suppliers.list({})).rejects.toThrow(
      "No tiene acceso al catálogo de proveedores"
    );

    expect(listSupplierCatalogSpy).not.toHaveBeenCalled();
    listSupplierCatalogSpy.mockRestore();
  });

  it("Blocks supplier Excel import analysis for unauthorized roles", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const analyzeSupplierExcelImportSpy = vi.spyOn(
      db,
      "analyzeSupplierExcelImport"
    );

    await expect(
      caller.suppliers.analyzeExcelImport({
        fileName: "proveedores.xlsx",
        fileBase64: "ZXhjZWw=",
      })
    ).rejects.toThrow("No tiene acceso al catálogo de proveedores");

    expect(analyzeSupplierExcelImportSpy).not.toHaveBeenCalled();
    analyzeSupplierExcelImportSpy.mockRestore();
  });

  it("Authorized users can analyze supplier Excel without importing", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const analyzeSupplierExcelImportSpy = vi
      .spyOn(db, "analyzeSupplierExcelImport")
      .mockResolvedValue({
        sheetName: "PROVEEDORES",
        totalRows: 2,
        validRows: 2,
        insertCount: 2,
        updateCount: 0,
        generatedCodeCount: 2,
        errors: [],
        warnings: [],
        preview: [],
      } as any);
    const importSupplierExcelSpy = vi.spyOn(db, "importSupplierExcel");

    await expect(
      caller.suppliers.analyzeExcelImport({
        fileName: "proveedores.xlsx",
        fileBase64: "ZXhjZWw=",
      })
    ).resolves.toMatchObject({
      totalRows: 2,
      insertCount: 2,
      generatedCodeCount: 2,
    });

    expect(analyzeSupplierExcelImportSpy).toHaveBeenCalledWith({
      fileName: "proveedores.xlsx",
      fileBase64: "ZXhjZWw=",
    });
    expect(importSupplierExcelSpy).not.toHaveBeenCalled();

    analyzeSupplierExcelImportSpy.mockRestore();
    importSupplierExcelSpy.mockRestore();
  });

  it("Authorized users can import supplier Excel", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const importSupplierExcelSpy = vi
      .spyOn(db, "importSupplierExcel")
      .mockResolvedValue({
        sheetName: "PROVEEDORES",
        totalRows: 2,
        validRows: 2,
        insertCount: 1,
        updateCount: 1,
        generatedCodeCount: 1,
        inserted: 1,
        updated: 1,
        errors: [],
        warnings: [],
        preview: [],
      } as any);

    await expect(
      caller.suppliers.importExcel({
        fileName: "proveedores.xlsx",
        fileBase64: "ZXhjZWw=",
      })
    ).resolves.toMatchObject({
      inserted: 1,
      updated: 1,
    });

    expect(importSupplierExcelSpy).toHaveBeenCalledWith({
      fileName: "proveedores.xlsx",
      fileBase64: "ZXhjZWw=",
    });

    importSupplierExcelSpy.mockRestore();
  });

  it("Authorized users can create and deactivate supplier document types", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const createSupplierDocumentTypeSpy = vi
      .spyOn(db, "createSupplierDocumentType")
      .mockResolvedValue({
        id: 9,
        code: "constancia_pago_a_cuenta",
        name: "Constancia de pagos a cuenta",
        expirationMode: "required",
        isActive: true,
      } as any);
    const updateSupplierDocumentTypeSpy = vi
      .spyOn(db, "updateSupplierDocumentType")
      .mockResolvedValue({ id: 9, isActive: false } as any);

    await expect(
      caller.suppliers.createDocumentType({
        name: "Constancia de pagos a cuenta",
        expirationMode: "required",
        isActive: true,
      })
    ).resolves.toEqual(expect.objectContaining({ id: 9 }));

    expect(createSupplierDocumentTypeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "constancia_de_pagos_a_cuenta",
        expirationMode: "required",
      })
    );

    await expect(
      caller.suppliers.deactivateDocumentType({ id: 9 })
    ).resolves.toEqual(expect.objectContaining({ isActive: false }));
    expect(updateSupplierDocumentTypeSpy).toHaveBeenCalledWith(9, {
      isActive: false,
    });

    createSupplierDocumentTypeSpy.mockRestore();
    updateSupplierDocumentTypeSpy.mockRestore();
  });

  it("Rejects supplier documents with required expiration and no expiration date", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getSupplierByIdSpy = vi
      .spyOn(db, "getSupplierById")
      .mockResolvedValue({ id: 5, name: "Proveedor Demo" } as any);
    const getSupplierDocumentTypeByIdSpy = vi
      .spyOn(db, "getSupplierDocumentTypeById")
      .mockResolvedValue({
        id: 1,
        name: "Constancia de pagos a cuenta",
        expirationMode: "required",
        isActive: true,
      } as any);
    const storagePutSpy = vi.spyOn(storage, "storagePut");
    const createAttachmentSpy = vi.spyOn(db, "createAttachment");

    await expect(
      caller.suppliers.createDocument({
        supplierId: 5,
        documentTypeId: 1,
        documentDate: "2026-05-01",
        expirationDate: "",
        description: "Constancia vigente",
        fileName: "constancia.pdf",
        fileData: VALID_PDF_BASE64,
        mimeType: "application/pdf",
        fileSize: 40,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Ingrese la fecha de vencimiento para este tipo de documento",
    });

    expect(storagePutSpy).not.toHaveBeenCalled();
    expect(createAttachmentSpy).not.toHaveBeenCalled();

    getSupplierByIdSpy.mockRestore();
    getSupplierDocumentTypeByIdSpy.mockRestore();
    storagePutSpy.mockRestore();
    createAttachmentSpy.mockRestore();
  });

  it("Allows supplier RTN documents without expiration date", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const documentType = {
      id: 3,
      code: "rtn",
      name: "RTN",
      description: null,
      expirationMode: "none",
      isActive: true,
    };
    const attachment = {
      id: 101,
      entityType: "supplier",
      entityId: 5,
      fileName: "rtn.pdf",
      fileKey: "buildreq/supplier/5/rtn.pdf",
      fileUrl: "https://storage.local/old-rtn.pdf",
      mimeType: "application/pdf",
      fileSize: 40,
      category: "documento_proveedor",
      uploadedById: ctx.user!.id,
      createdAt: new Date(),
    };
    const supplierDocument = {
      id: 44,
      supplierId: 5,
      documentTypeId: 3,
      attachmentId: 101,
      documentDate: new Date("2026-05-01T00:00:00"),
      expirationDate: null,
      description: "RTN actualizado",
      createdById: ctx.user!.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const getSupplierByIdSpy = vi
      .spyOn(db, "getSupplierById")
      .mockResolvedValue({ id: 5, name: "Proveedor Demo" } as any);
    const getSupplierDocumentTypeByIdSpy = vi
      .spyOn(db, "getSupplierDocumentTypeById")
      .mockResolvedValue(documentType as any);
    const storagePutSpy = vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: attachment.fileKey,
      url: "https://storage.local/rtn.pdf",
    });
    const createAttachmentSpy = vi
      .spyOn(db, "createAttachment")
      .mockResolvedValue({ id: attachment.id });
    const createSupplierDocumentSpy = vi
      .spyOn(db, "createSupplierDocument")
      .mockResolvedValue(supplierDocument as any);
    const getSupplierDocumentByIdSpy = vi
      .spyOn(db, "getSupplierDocumentById")
      .mockResolvedValue({
        document: supplierDocument,
        documentType,
        attachment,
        createdBy: { id: ctx.user!.id, name: "Admin", email: "admin@test.com" },
      } as any);
    const storageGetSpy = vi.spyOn(storage, "storageGet").mockResolvedValue({
      key: attachment.fileKey,
      url: "https://storage.local/signed-rtn.pdf",
    });

    await expect(
      caller.suppliers.createDocument({
        supplierId: 5,
        documentTypeId: 3,
        documentDate: "2026-05-01",
        description: "RTN actualizado",
        fileName: "rtn.pdf",
        fileData: VALID_PDF_BASE64,
        mimeType: "application/pdf",
        fileSize: 40,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: 44,
        expirationDate: null,
        status: "sin_vencimiento",
        attachment: expect.objectContaining({
          fileUrl: "https://storage.local/signed-rtn.pdf",
        }),
      })
    );

    expect(createAttachmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "supplier",
        entityId: 5,
        category: "documento_proveedor",
      })
    );
    expect(createSupplierDocumentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId: 5,
        documentTypeId: 3,
        expirationDate: null,
      })
    );

    getSupplierByIdSpy.mockRestore();
    getSupplierDocumentTypeByIdSpy.mockRestore();
    storagePutSpy.mockRestore();
    createAttachmentSpy.mockRestore();
    createSupplierDocumentSpy.mockRestore();
    getSupplierDocumentByIdSpy.mockRestore();
    storageGetSpy.mockRestore();
  });

  it("Lists supplier documents with computed expired status", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getSupplierByIdSpy = vi
      .spyOn(db, "getSupplierById")
      .mockResolvedValue({ id: 5, name: "Proveedor Demo" } as any);
    const listSupplierDocumentsSpy = vi
      .spyOn(db, "listSupplierDocuments")
      .mockResolvedValue([
        {
          document: {
            id: 45,
            supplierId: 5,
            documentTypeId: 2,
            attachmentId: 102,
            documentDate: new Date("2026-01-01T00:00:00"),
            expirationDate: new Date("2000-01-01T00:00:00"),
            description: "Contrato vencido",
            createdById: 4,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          documentType: {
            id: 2,
            code: "contrato",
            name: "Contrato",
            expirationMode: "required",
            isActive: true,
          },
          attachment: {
            id: 102,
            entityType: "supplier",
            entityId: 5,
            fileName: "contrato.pdf",
            fileKey: "buildreq/supplier/5/contrato.pdf",
            fileUrl: "https://storage.local/old-contrato.pdf",
            mimeType: "application/pdf",
            fileSize: 40,
            category: "documento_proveedor",
            uploadedById: 4,
            createdAt: new Date(),
          },
          createdBy: { id: 4, name: "Admin", email: "admin@test.com" },
        } as any,
      ]);
    const storageGetSpy = vi.spyOn(storage, "storageGet").mockResolvedValue({
      key: "buildreq/supplier/5/contrato.pdf",
      url: "https://storage.local/signed-contrato.pdf",
    });

    await expect(
      caller.suppliers.listDocuments({ supplierId: 5 })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 45,
        status: "vencido",
        attachment: expect.objectContaining({
          fileUrl: "https://storage.local/signed-contrato.pdf",
        }),
      }),
    ]);

    getSupplierByIdSpy.mockRestore();
    listSupplierDocumentsSpy.mockRestore();
    storageGetSpy.mockRestore();
  });

  it("Blocks supplier document listing for unauthorized roles", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const listSupplierDocumentsSpy = vi.spyOn(db, "listSupplierDocuments");

    await expect(
      caller.suppliers.listDocuments({ supplierId: 5 })
    ).rejects.toThrow("No tiene acceso al catálogo de proveedores");
    expect(listSupplierDocumentsSpy).not.toHaveBeenCalled();

    listSupplierDocumentsSpy.mockRestore();
  });

  it("Project Administrator can create supplier contacts for the assigned project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const getSupplierByIdSpy = vi
      .spyOn(db, "getSupplierById")
      .mockResolvedValue({ id: 5, name: "Proveedor Demo" } as any);
    const getProjectByIdSpy = vi
      .spyOn(db, "getProjectById")
      .mockResolvedValue({ id: 1, code: "P-001", name: "Proyecto Uno" } as any);
    const createSupplierContactSpy = vi
      .spyOn(db, "createSupplierContact")
      .mockResolvedValue({
        id: 30,
        supplierId: 5,
        projectId: 1,
        contactType: "ventas",
        name: "Contacto Proyecto",
        isActive: true,
      } as any);

    await expect(
      caller.suppliers.createContact({
        supplierId: 5,
        projectId: 1,
        contactType: "ventas",
        name: "Contacto Proyecto",
        phone: "9999-9999",
        email: "contacto@proveedor.com",
        isActive: true,
      })
    ).resolves.toEqual(expect.objectContaining({ id: 30, projectId: 1 }));

    expect(createSupplierContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId: 5,
        projectId: 1,
        name: "Contacto Proyecto",
      })
    );

    getSupplierByIdSpy.mockRestore();
    getProjectByIdSpy.mockRestore();
    createSupplierContactSpy.mockRestore();
  });

  it("Project Administrator cannot create supplier contacts for another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const createSupplierContactSpy = vi.spyOn(db, "createSupplierContact");

    await expect(
      caller.suppliers.createContact({
        supplierId: 5,
        projectId: 2,
        contactType: "ventas",
        name: "Contacto Otro Proyecto",
        isActive: true,
      })
    ).rejects.toThrow("Solo puede gestionar contactos del proyecto asignado");

    expect(createSupplierContactSpy).not.toHaveBeenCalled();
    createSupplierContactSpy.mockRestore();
  });

  it("Project Administrator cannot update supplier contacts from another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const getSupplierContactByIdSpy = vi
      .spyOn(db, "getSupplierContactById")
      .mockResolvedValue({
        id: 31,
        supplierId: 5,
        projectId: 2,
        contactType: "ventas",
        name: "Contacto Otro Proyecto",
        isActive: true,
      } as any);
    const updateSupplierContactSpy = vi.spyOn(db, "updateSupplierContact");

    await expect(
      caller.suppliers.updateContact({
        id: 31,
        name: "No debe actualizar",
      })
    ).rejects.toThrow("Solo puede gestionar contactos del proyecto asignado");

    expect(updateSupplierContactSpy).not.toHaveBeenCalled();
    getSupplierContactByIdSpy.mockRestore();
    updateSupplierContactSpy.mockRestore();
  });

  it("Deletes supplier document files and attachment records", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const attachment = {
      id: 102,
      fileKey: "buildreq/supplier/5/contrato.pdf",
    };
    const getSupplierDocumentByIdSpy = vi
      .spyOn(db, "getSupplierDocumentById")
      .mockResolvedValue({
        document: { id: 45, supplierId: 5 },
        documentType: { id: 2, name: "Contrato" },
        attachment,
        createdBy: null,
      } as any);
    const storageDeleteSpy = vi
      .spyOn(storage, "storageDelete")
      .mockResolvedValue({
        key: attachment.fileKey,
      });
    const deleteAttachmentSpy = vi
      .spyOn(db, "deleteAttachment")
      .mockResolvedValue(undefined);

    await expect(caller.suppliers.deleteDocument({ id: 45 })).resolves.toEqual({
      success: true,
    });
    expect(storageDeleteSpy).toHaveBeenCalledWith(attachment.fileKey);
    expect(deleteAttachmentSpy).toHaveBeenCalledWith(attachment.id);

    getSupplierDocumentByIdSpy.mockRestore();
    storageDeleteSpy.mockRestore();
    deleteAttachmentSpy.mockRestore();
  });
});

// ============================================================
// Tests: Project subprojects
// ============================================================
describe("BuildReq - Project subprojects", () => {
  it("Admin can create subprojects under a parent project", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const getProjectByIdSpy = vi
      .spyOn(db, "getProjectById")
      .mockResolvedValue({ id: 1, code: "001", name: "Proyecto" } as any);
    const getProjectSubprojectByCodeSpy = vi
      .spyOn(db, "getProjectSubprojectByCode")
      .mockResolvedValue(undefined);
    const createProjectSubprojectSpy = vi
      .spyOn(db, "createProjectSubproject")
      .mockResolvedValue({ id: 10, projectId: 1, code: "SP-001" } as any);

    await expect(
      caller.projects.createSubproject({
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        description: "Movimiento de tierra",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        isActive: true,
      })
    ).resolves.toEqual(expect.objectContaining({ id: 10, code: "SP-001" }));

    expect(createProjectSubprojectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        description: "Movimiento de tierra",
        startDate: expect.any(Date),
        endDate: expect.any(Date),
        isActive: true,
      })
    );

    getProjectByIdSpy.mockRestore();
    getProjectSubprojectByCodeSpy.mockRestore();
    createProjectSubprojectSpy.mockRestore();
  });

  it("Rejects duplicate subproject codes within the same project", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const getProjectByIdSpy = vi
      .spyOn(db, "getProjectById")
      .mockResolvedValue({ id: 1, code: "001", name: "Proyecto" } as any);
    const getProjectSubprojectByCodeSpy = vi
      .spyOn(db, "getProjectSubprojectByCode")
      .mockResolvedValue({ id: 11, projectId: 1, code: "SP-001" } as any);
    const createProjectSubprojectSpy = vi
      .spyOn(db, "createProjectSubproject")
      .mockResolvedValue({ id: 12 } as any);

    await expect(
      caller.projects.createSubproject({
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        isActive: true,
      })
    ).rejects.toThrow("Ya existe un subproyecto con ese código");

    expect(createProjectSubprojectSpy).not.toHaveBeenCalled();

    getProjectByIdSpy.mockRestore();
    getProjectSubprojectByCodeSpy.mockRestore();
    createProjectSubprojectSpy.mockRestore();
  });

  it("Allows the same subproject code in different parent projects", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const getProjectByIdSpy = vi
      .spyOn(db, "getProjectById")
      .mockResolvedValue({ id: 2, code: "002", name: "Proyecto 2" } as any);
    const getProjectSubprojectByCodeSpy = vi
      .spyOn(db, "getProjectSubprojectByCode")
      .mockResolvedValue(undefined);
    const createProjectSubprojectSpy = vi
      .spyOn(db, "createProjectSubproject")
      .mockResolvedValue({ id: 13, projectId: 2, code: "SP-001" } as any);

    await expect(
      caller.projects.createSubproject({
        projectId: 2,
        code: "SP-001",
        name: "Etapa espejo",
        isActive: true,
      })
    ).resolves.toEqual(
      expect.objectContaining({ projectId: 2, code: "SP-001" })
    );

    expect(getProjectSubprojectByCodeSpy).toHaveBeenCalledWith(2, "SP-001");

    getProjectByIdSpy.mockRestore();
    getProjectSubprojectByCodeSpy.mockRestore();
    createProjectSubprojectSpy.mockRestore();
  });

  it("Admin can update project dates and active status", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const updateProjectSpy = vi
      .spyOn(db, "updateProject")
      .mockResolvedValue({ success: true });

    await expect(
      caller.projects.update({
        id: 1,
        startDate: "2026-06-01",
        endDate: "2026-08-15",
        status: "inactivo",
      })
    ).resolves.toEqual({ success: true });

    expect(updateProjectSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        startDate: expect.any(Date),
        endDate: expect.any(Date),
        status: "inactivo",
      })
    );

    updateProjectSpy.mockRestore();
  });

  it("Rejects project or subproject date ranges where end date is before start date", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.projects.update({
        id: 1,
        startDate: "2026-08-15",
        endDate: "2026-06-01",
      })
    ).rejects.toThrow("La fecha de fin no puede ser anterior");

    await expect(
      caller.projects.createSubproject({
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        startDate: "2026-08-15",
        endDate: "2026-06-01",
        isActive: true,
      })
    ).rejects.toThrow("La fecha de fin no puede ser anterior");
  });

  it("Blocks non-admin users from creating or editing subprojects", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.projects.createSubproject({
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        isActive: true,
      })
    ).rejects.toThrow("required permission");

    await expect(
      caller.projects.updateSubproject({
        id: 1,
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        isActive: false,
      })
    ).rejects.toThrow("required permission");
  });
});

// ============================================================
// Tests: Role-based access control
// ============================================================
describe("BuildReq - Role-based Access Control", () => {
  it("Ingeniero Residente cannot change material request status", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.updateStatus({ id: 1, status: "en_proceso" })
    ).rejects.toThrow("No tiene permisos para cambiar el estatus");
  });

  it("Ingeniero Residente cannot assign supply flows via direct purchase", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.createDirectPurchase({
        requestId: 1,
        requestItemId: 1,
        paymentMethod: "caja_chica",
      })
    ).rejects.toThrow("No tiene permisos para registrar compras directas");
  });

  it("Ingeniero Residente can view their scoped supply flow queue", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const listPendingFlowQueueItemsSpy = vi
      .spyOn(db, "listPendingFlowQueueItems")
      .mockResolvedValue([
        {
          item: { id: 11, assignedFlow: "despacho_bodega" },
          request: { id: 21, requestedById: 2 },
          project: { id: 1 },
        },
      ] as any);

    await expect(
      caller.supplyFlows.pendingQueue({ flowType: "despacho_bodega" })
    ).resolves.toHaveLength(1);
    expect(listPendingFlowQueueItemsSpy).toHaveBeenCalledWith({
      flowType: "despacho_bodega",
      requestedById: 2,
    });

    listPendingFlowQueueItemsSpy.mockRestore();
  });

  it("Ingeniero Residente can view their scoped supply flow history", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const listSupplyFlowRecordsSpy = vi
      .spyOn(db, "listSupplyFlowRecords")
      .mockResolvedValue([
        {
          flow: { id: 31, flowType: "despacho_bodega", status: "pendiente" },
          request: { id: 21, requestedById: 2 },
          project: { id: 1 },
        },
      ] as any);

    await expect(
      caller.supplyFlows.list({
        flowType: "despacho_bodega",
        status: "pendiente",
      })
    ).resolves.toHaveLength(1);
    expect(listSupplyFlowRecordsSpy).toHaveBeenCalledWith({
      flowType: "despacho_bodega",
      status: "pendiente",
      requestedById: 2,
    });

    listSupplyFlowRecordsSpy.mockRestore();
  });

  it("Ingeniero Residente sees dashboard stats scoped to their user", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getDashboardStatsSpy = vi
      .spyOn(db, "getDashboardStats")
      .mockResolvedValue({
        totalRequests: 1,
        totalActiveProjects: 1,
        totalReturns: 0,
        pendingReturns: 0,
        requestsByStatus: [],
        requestsByProject: [],
        requestsByFlow: [],
        recentRequests: [],
      } as any);

    await expect(caller.dashboard.stats()).resolves.toEqual(
      expect.objectContaining({
        totalRequests: 1,
        totalActiveProjects: 1,
      })
    );
    expect(getDashboardStatsSpy).toHaveBeenCalledWith({
      requestedById: 2,
      projectIds: [1],
    });

    getDashboardStatsSpy.mockRestore();
  });

  it("Ingeniero Residente sees sidebar flow counts scoped to their requests", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPendingFlowQueueItemsSpy = vi
      .spyOn(db, "listPendingFlowQueueItems")
      .mockResolvedValue([{}, {}] as any);

    await expect(caller.dashboard.sidebarCounts()).resolves.toEqual(
      expect.objectContaining({
        supplyFlowsPending: 2,
        purchaseRequestsPending: 0,
        purchaseOrdersEmitted: 0,
        transferRequestsPending: 0,
      })
    );
    expect(listMaterialRequestsSpy).toHaveBeenCalledWith({
      status: "pendiente_aprobar",
      requestedById: 2,
      projectIds: [1],
    });
    expect(listPendingFlowQueueItemsSpy).toHaveBeenCalledWith({
      requestedById: 2,
    });

    listMaterialRequestsSpy.mockRestore();
    listPendingFlowQueueItemsSpy.mockRestore();
  });

  it("Superuser sees sidebar invoice counts by attention and reviewed status", async () => {
    const { ctx } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPendingFlowQueueItemsSpy = vi
      .spyOn(db, "listPendingFlowQueueItems")
      .mockResolvedValue([] as any);
    const listPurchaseRequestsSpy = vi
      .spyOn(db, "listPurchaseRequests")
      .mockResolvedValue([] as any);
    const listPurchaseOrdersSpy = vi
      .spyOn(db, "listPurchaseOrders")
      .mockResolvedValue([] as any);
    const listTransferRequestsSpy = vi
      .spyOn(db, "listTransferRequests")
      .mockResolvedValue([] as any);
    const listInvoicesSpy = vi
      .spyOn(db, "listInvoices")
      .mockImplementation(async (filters?: any) => {
        if (filters?.status === "borrador") return [{}, {}] as any;
        if (filters?.status === "rechazada") return [{}] as any;
        if (filters?.status === "revisada") return [{}, {}] as any;
        return [] as any;
      });

    await expect(caller.dashboard.sidebarCounts()).resolves.toEqual(
      expect.objectContaining({
        invoicesPendingAttention: 3,
        invoicesReviewed: 2,
      })
    );
    expect(listInvoicesSpy).toHaveBeenCalledWith({ status: "borrador" });
    expect(listInvoicesSpy).toHaveBeenCalledWith({ status: "rechazada" });
    expect(listInvoicesSpy).toHaveBeenCalledWith({ status: "revisada" });

    listMaterialRequestsSpy.mockRestore();
    listPendingFlowQueueItemsSpy.mockRestore();
    listPurchaseRequestsSpy.mockRestore();
    listPurchaseOrdersSpy.mockRestore();
    listTransferRequestsSpy.mockRestore();
    listInvoicesSpy.mockRestore();
  });

  it("Admin Central sees sidebar reviewed invoice count", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPendingFlowQueueItemsSpy = vi
      .spyOn(db, "listPendingFlowQueueItems")
      .mockResolvedValue([] as any);
    const listPurchaseRequestsSpy = vi
      .spyOn(db, "listPurchaseRequests")
      .mockResolvedValue([] as any);
    const listPurchaseOrdersSpy = vi
      .spyOn(db, "listPurchaseOrders")
      .mockResolvedValue([] as any);
    const listTransferRequestsSpy = vi
      .spyOn(db, "listTransferRequests")
      .mockResolvedValue([] as any);
    const listInvoicesSpy = vi
      .spyOn(db, "listInvoices")
      .mockImplementation(async (filters?: any) => {
        if (filters?.status === "revisada") return [{}, {}] as any;
        return [] as any;
      });

    await expect(caller.dashboard.sidebarCounts()).resolves.toEqual(
      expect.objectContaining({
        invoicesPendingAttention: 0,
        invoicesReviewed: 2,
      })
    );
    expect(listInvoicesSpy).toHaveBeenCalledWith({ status: "revisada" });

    listMaterialRequestsSpy.mockRestore();
    listPendingFlowQueueItemsSpy.mockRestore();
    listPurchaseRequestsSpy.mockRestore();
    listPurchaseOrdersSpy.mockRestore();
    listTransferRequestsSpy.mockRestore();
    listInvoicesSpy.mockRestore();
  });

  it("Project Administrator without assigned project sees empty scoped purchase sidebar counts", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: null });
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPendingFlowQueueItemsSpy = vi
      .spyOn(db, "listPendingFlowQueueItems")
      .mockResolvedValue([] as any);
    const listPurchaseRequestsSpy = vi
      .spyOn(db, "listPurchaseRequests")
      .mockResolvedValue([] as any);
    const listPurchaseOrdersSpy = vi
      .spyOn(db, "listPurchaseOrders")
      .mockResolvedValue([] as any);
    const listTransferRequestsSpy = vi
      .spyOn(db, "listTransferRequests")
      .mockResolvedValue([] as any);
    const listInvoicesSpy = vi
      .spyOn(db, "listInvoices")
      .mockResolvedValue([] as any);

    await expect(caller.dashboard.sidebarCounts()).resolves.toEqual(
      expect.objectContaining({
        purchaseRequestsPending: 0,
        purchaseOrdersEmitted: 0,
        transferRequestsPending: 0,
      })
    );

    expect(listMaterialRequestsSpy).toHaveBeenCalledWith({
      projectIds: [],
      status: "pendiente_aprobar",
    });
    expect(listPurchaseRequestsSpy).toHaveBeenCalledWith({
      projectIds: [],
      status: "pendiente",
    });
    expect(listPurchaseOrdersSpy).toHaveBeenCalledWith({
      projectIds: [],
      status: "emitida",
    });
    expect(listTransferRequestsSpy).toHaveBeenCalledWith({
      projectIds: [],
      status: "pendiente",
    });

    listMaterialRequestsSpy.mockRestore();
    listPendingFlowQueueItemsSpy.mockRestore();
    listPurchaseRequestsSpy.mockRestore();
    listPurchaseOrdersSpy.mockRestore();
    listTransferRequestsSpy.mockRestore();
    listInvoicesSpy.mockRestore();
  });

  it("Project Administrator without assigned project has empty scoped purchase and project lists only", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: null });
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPurchaseRequestsSpy = vi
      .spyOn(db, "listPurchaseRequests")
      .mockResolvedValue([] as any);
    const listPurchaseOrdersSpy = vi
      .spyOn(db, "listPurchaseOrders")
      .mockResolvedValue([] as any);
    const listTransferRequestsSpy = vi
      .spyOn(db, "listTransferRequests")
      .mockResolvedValue([] as any);
    const listTransfersSpy = vi
      .spyOn(db, "listTransfers")
      .mockResolvedValue([] as any);
    const listReceiptsSpy = vi
      .spyOn(db, "listReceipts")
      .mockResolvedValue([] as any);
    const listInventoryItemsSpy = vi
      .spyOn(db, "listInventoryItems")
      .mockResolvedValue([] as any);
    const listProjectsSpy = vi
      .spyOn(db, "listProjects")
      .mockResolvedValue([] as any);

    await expect(caller.materialRequests.list()).resolves.toEqual([]);
    await expect(caller.purchaseRequests.list()).resolves.toEqual([]);
    await expect(caller.purchaseOrders.list()).resolves.toEqual([]);
    await expect(caller.transferRequests.list()).resolves.toEqual([]);
    await expect(caller.transfers.list()).resolves.toEqual([]);
    await expect(caller.receipts.list()).resolves.toEqual([]);
    await expect(caller.inventory.list()).resolves.toEqual([]);
    await expect(caller.projects.list()).resolves.toEqual([]);

    expect(listMaterialRequestsSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listPurchaseRequestsSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listPurchaseOrdersSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listTransferRequestsSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listTransfersSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listReceiptsSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listInventoryItemsSpy).toHaveBeenCalledWith({ projectIds: [] });
    expect(listProjectsSpy).not.toHaveBeenCalled();

    listMaterialRequestsSpy.mockRestore();
    listPurchaseRequestsSpy.mockRestore();
    listPurchaseOrdersSpy.mockRestore();
    listTransferRequestsSpy.mockRestore();
    listTransfersSpy.mockRestore();
    listReceiptsSpy.mockRestore();
    listInventoryItemsSpy.mockRestore();
    listProjectsSpy.mockRestore();
  });

  it("Project Administrator can only view transfer requests and transfers for their project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 6 });
    const caller = appRouter.createCaller(ctx);
    const listTransferRequestsSpy = vi
      .spyOn(db, "listTransferRequests")
      .mockResolvedValue([] as any);
    const listTransfersSpy = vi
      .spyOn(db, "listTransfers")
      .mockResolvedValue([] as any);

    await expect(
      caller.transferRequests.list({ projectId: 99, status: "pendiente" })
    ).resolves.toEqual([]);
    await expect(
      caller.transfers.list({ sourceProjectId: 99, status: "confirmado" })
    ).resolves.toEqual([]);
    await expect(
      caller.transfers.list({ receivableOnly: true, destinationProjectId: 99 })
    ).resolves.toEqual([]);

    expect(listTransferRequestsSpy).toHaveBeenCalledWith({
      projectId: 99,
      projectIds: [],
      status: "pendiente",
    });
    expect(listTransfersSpy).toHaveBeenNthCalledWith(1, {
      sourceProjectId: 99,
      projectIds: [6],
      status: "confirmado",
    });
    expect(listTransfersSpy).toHaveBeenNthCalledWith(2, {
      receivableOnly: true,
      destinationProjectId: 99,
      projectIds: [6],
    });

    listTransferRequestsSpy.mockRestore();
    listTransfersSpy.mockRestore();
  });

  it("Project Administrator with multiple assigned projects lists all assigned project data", async () => {
    const { ctx } = createProjectAdminContext({
      assignedProjectId: 1,
      assignedProjectIds: [1, 2],
    });
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPurchaseOrdersSpy = vi
      .spyOn(db, "listPurchaseOrders")
      .mockResolvedValue([] as any);
    const listInvoicesSpy = vi.spyOn(db, "listInvoices").mockResolvedValue([]);
    const getProjectByIdSpy = vi.spyOn(db, "getProjectById").mockImplementation(
      async (projectId: number) =>
        ({
          id: projectId,
          code: `00${projectId}`,
          name: `Proyecto ${projectId}`,
          status: "activo",
        }) as any
    );

    await expect(caller.materialRequests.list()).resolves.toEqual([]);
    await expect(caller.purchaseOrders.list()).resolves.toEqual([]);
    await expect(caller.invoices.list()).resolves.toEqual([]);
    await expect(caller.projects.list()).resolves.toEqual([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 }),
    ]);

    expect(listMaterialRequestsSpy).toHaveBeenCalledWith({
      projectIds: [1, 2],
    });
    expect(listPurchaseOrdersSpy).toHaveBeenCalledWith({ projectIds: [1, 2] });
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [1, 2] })
    );
    expect(getProjectByIdSpy).toHaveBeenCalledWith(1);
    expect(getProjectByIdSpy).toHaveBeenCalledWith(2);

    listMaterialRequestsSpy.mockRestore();
    listPurchaseOrdersSpy.mockRestore();
    listInvoicesSpy.mockRestore();
    getProjectByIdSpy.mockRestore();
  });

  it("Superintendente sees dashboard and requisitions scoped to assigned projects", async () => {
    const { ctx } = createSuperintendentContext({
      assignedProjectId: 1,
      assignedProjectIds: [1, 2],
    });
    const caller = appRouter.createCaller(ctx);
    const getDashboardStatsSpy = vi
      .spyOn(db, "getDashboardStats")
      .mockResolvedValue({
        totalRequests: 2,
        totalActiveProjects: 2,
        totalReturns: 0,
        pendingReturns: 0,
        requestsByStatus: [],
        requestsByProject: [],
        requestsByFlow: [],
        recentRequests: [],
      } as any);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);

    await expect(caller.dashboard.stats()).resolves.toEqual(
      expect.objectContaining({
        totalRequests: 2,
        totalActiveProjects: 2,
      })
    );
    await expect(caller.materialRequests.list()).resolves.toEqual([]);

    expect(getDashboardStatsSpy).toHaveBeenCalledWith({
      projectIds: [1, 2],
    });
    expect(listMaterialRequestsSpy).toHaveBeenCalledWith({
      projectIds: [1, 2],
    });

    getDashboardStatsSpy.mockRestore();
    listMaterialRequestsSpy.mockRestore();
  });

  it("Superintendente cannot view requisitions outside assigned projects", async () => {
    const { ctx } = createSuperintendentContext({
      assignedProjectId: 1,
      assignedProjectIds: [1],
    });
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 22,
          requestedById: 99,
          projectId: 3,
          status: "pendiente_aprobar",
        },
        items: [],
      } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false } as any);

    await expect(
      caller.materialRequests.getById({ id: 22 })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    getMaterialRequestByIdSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Superintendente cannot mutate requisitions", async () => {
    const { ctx } = createSuperintendentContext();
    const caller = appRouter.createCaller(ctx);
    const createMaterialRequestSpy = vi.spyOn(db, "createMaterialRequest");
    const updateMaterialRequestStatusSpy = vi.spyOn(
      db,
      "updateMaterialRequestStatus"
    );
    const assignFlowSpy = vi.spyOn(db, "assignFlow");

    await expect(
      caller.materialRequests.create({
        projectId: 1,
        requestType: "bienes",
        purchaseUrgency: "no_urgente",
        items: [{ itemName: "Cemento", quantity: "1", unit: "und" }],
      })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");
    await expect(
      caller.materialRequests.update({
        id: 22,
        projectId: 1,
        requestType: "bienes",
        purchaseUrgency: "no_urgente",
        items: [{ itemName: "Cemento", quantity: "1", unit: "und" }],
      })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");
    await expect(
      caller.materialRequests.updateStatus({
        id: 22,
        status: "anulada",
      })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");
    await expect(
      caller.materialRequests.assignFlow({
        requestId: 22,
        flowType: "compra_directa",
      })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");
    await expect(
      caller.materialRequests.reviewItems({
        requestId: 22,
        itemIds: [1],
        decision: "aprobada",
      })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");
    await expect(caller.materialRequests.approve({ id: 22 })).rejects.toThrow(
      "El Superintendente solo puede consultar requisiciones"
    );
    await expect(
      caller.materialRequests.reject({ id: 22, reason: "No aplica" })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");
    await expect(
      caller.materialRequests.sendToSap({ requestId: 22 })
    ).rejects.toThrow("El Superintendente solo puede consultar requisiciones");

    expect(createMaterialRequestSpy).not.toHaveBeenCalled();
    expect(updateMaterialRequestStatusSpy).not.toHaveBeenCalled();
    expect(assignFlowSpy).not.toHaveBeenCalled();

    createMaterialRequestSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
    assignFlowSpy.mockRestore();
  });

  it("Project Administrator cannot create transfer requests", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 6 });
    const caller = appRouter.createCaller(ctx);
    const createTransferRequestSpy = vi.spyOn(db, "createTransferRequest");

    await expect(
      caller.transferRequests.create({
        projectId: 6,
        destinationType: "proyecto",
        destinationProjectId: 3,
        items: [
          {
            itemName: "Cemento",
            quantity: "10.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("No tiene permisos para crear solicitudes de traslado");
    expect(createTransferRequestSpy).not.toHaveBeenCalled();

    createTransferRequestSpy.mockRestore();
  });

  it("Ingeniero Residente cannot access inventory", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.inventory.list()).rejects.toThrow(
      "No tiene acceso al inventario"
    );
  });

  it("Ingeniero Residente cannot access warehouse exits", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.warehouseExits.list()).rejects.toThrow(
      "No tiene acceso a salidas de bodega"
    );
  });

  it("Bodega users can query inventory with pagination and sorting", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.inventory.list({
      page: 2,
      pageSize: 25,
      sortBy: "currentStock",
      sortDir: "desc",
      search: "diesel",
    });

    expect(result).toHaveProperty("items");
    expect(result.pageSize).toBe(25);
    expect(result.sortBy).toBe("currentStock");
    expect(result.sortDir).toBe("desc");
  });

  it("Bodega users can query warehouses", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.warehouses.list();

    expect(Array.isArray(result)).toBe(true);
  });

  it("Ingeniero Residente cannot access warehouses", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.warehouses.list()).rejects.toThrow(
      "No tiene acceso a los almacenes"
    );
  });

  it("Ingeniero Residente cannot create direct purchases", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.createDirectPurchase({
        requestId: 1,
        requestItemId: 1,
        paymentMethod: "caja_chica",
      })
    ).rejects.toThrow("No tiene permisos para registrar compras directas");
  });

  it("Ingeniero Residente cannot create warehouse dispatches", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.createWarehouseDispatch({
        requestId: 1,
        requestItemId: 1,
        sourceWarehouse: "Bodega Central",
      })
    ).rejects.toThrow(
      "Solo el Jefe de Bodega Central, Administración Central o Bodeguero de Proyecto pueden despachar materiales"
    );
  });

  it("Ingeniero Residente cannot create project transfers", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.createProjectTransfer({
        requestId: 1,
        requestItemId: 1,
        sourceProjectId: 1,
        destinationProjectId: 2,
      })
    ).rejects.toThrow(
      "Solo el Jefe de Bodega Central o Administración Central pueden gestionar traslados"
    );
  });

  it("Ingeniero Residente cannot translate items to SAP codes", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.requestItems.translateToSap({
        id: 1,
        sapItemCode: "MAT-001",
      })
    ).rejects.toThrow("No tiene permisos para traducir ítems a códigos SAP");
  });

  it("Project Administrator and Bodeguero de Proyecto can translate items in their assigned project", async () => {
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "aprobada",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);

    for (const createContext of [
      createProjectAdminContext,
      createProjectBodegueroContext,
    ]) {
      const { ctx } = createContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.requestItems.translateToSap({
          id: 41,
          sapItemCode: "05050200058",
          sapItemDescription: "CEMENTO GRANEL",
        })
      ).resolves.toEqual({ success: true });
    }

    expect(updateRequestItemSpy).toHaveBeenCalledTimes(2);
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      sapItemCode: "05050200058",
      sapItemDescription: "CEMENTO GRANEL",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
  });

  it("Project-scoped users cannot translate items from another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "aprobada",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 2,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const updateRequestItemSpy = vi.spyOn(db, "updateRequestItem");

    await expect(
      caller.requestItems.translateToSap({
        id: 41,
        sapItemCode: "05050200058",
      })
    ).rejects.toThrow("No tiene acceso a esta solicitud");
    expect(updateRequestItemSpy).not.toHaveBeenCalled();

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
  });

  it("Admin Central cannot update reverse logistics status", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.updateStatus({ id: 1, status: "aprobada" })
    ).rejects.toThrow(
      "Solo el Jefe de Bodega Central puede actualizar el estatus de devoluciones"
    );
  });

  it("Administración Central can see the same flow options as an admin", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.supplyFlows.availableFlows()).resolves.toEqual([
      "despacho_bodega",
      "compra_directa",
      "traslado_proyecto",
      "solicitud_compra",
    ]);
  });

  it("Jefe de Bodega can see all flow options", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.supplyFlows.availableFlows()).resolves.toEqual([
      "despacho_bodega",
      "compra_directa",
      "traslado_proyecto",
      "solicitud_compra",
    ]);
  });

  it("Administrador de Proyecto can see direct-purchase and purchase-request flow options", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.supplyFlows.availableFlows()).resolves.toEqual([
      "compra_directa",
      "solicitud_compra",
    ]);
  });

  it("Bodeguero de Proyecto sees only project-scoped requisitions and project warehouse flow options", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const listMaterialRequestsSpy = vi
      .spyOn(db, "listMaterialRequests")
      .mockResolvedValue([] as any);
    const listPendingFlowQueueItemsSpy = vi
      .spyOn(db, "listPendingFlowQueueItems")
      .mockResolvedValue([] as any);

    await expect(caller.materialRequests.list()).resolves.toEqual([]);
    await expect(
      caller.supplyFlows.pendingQueue({ flowType: "despacho_bodega" })
    ).resolves.toEqual([]);
    await expect(caller.supplyFlows.availableFlows()).resolves.toEqual([
      "compra_directa",
      "traslado_proyecto",
    ]);

    expect(listMaterialRequestsSpy).toHaveBeenCalledWith({ projectIds: [1] });
    expect(listPendingFlowQueueItemsSpy).toHaveBeenCalledWith({
      flowType: "despacho_bodega",
      projectIds: [1],
    });

    listMaterialRequestsSpy.mockRestore();
    listPendingFlowQueueItemsSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can consult project-scoped purchase orders and receipts", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const listPurchaseOrdersSpy = vi
      .spyOn(db, "listPurchaseOrders")
      .mockResolvedValue([] as any);
    const listReceiptsSpy = vi
      .spyOn(db, "listReceipts")
      .mockResolvedValue([] as any);

    await expect(caller.purchaseOrders.list()).resolves.toEqual([]);
    await expect(caller.receipts.list()).resolves.toEqual([]);

    expect(listPurchaseOrdersSpy).toHaveBeenCalledWith({ projectIds: [1] });
    expect(listReceiptsSpy).toHaveBeenCalledWith({ projectIds: [1] });

    listPurchaseOrdersSpy.mockRestore();
    listReceiptsSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can consult project-scoped warehouse exits", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const listWarehouseExitsSpy = vi
      .spyOn(db, "listWarehouseExits")
      .mockResolvedValue([] as any);

    await expect(
      caller.warehouseExits.list({ projectId: 99, status: "borrador" })
    ).resolves.toEqual([]);

    expect(listWarehouseExitsSpy).toHaveBeenCalledWith({
      projectId: 99,
      projectIds: [],
      status: "borrador",
    });

    listWarehouseExitsSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can consult receivable transfers for their destination project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const listTransfersSpy = vi
      .spyOn(db, "listTransfers")
      .mockResolvedValue([] as any);

    await expect(
      caller.transfers.list({ receivableOnly: true })
    ).resolves.toEqual([]);

    expect(listTransfersSpy).toHaveBeenCalledWith({
      receivableOnly: true,
      projectIds: [1],
    });

    listTransfersSpy.mockRestore();
  });

  it("Bodeguero de Proyecto cannot edit purchase orders", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          projectId: 1,
          status: "borrador",
        },
        items: [],
      } as any);
    const updatePurchaseOrderSpy = vi.spyOn(db, "updatePurchaseOrder");

    await expect(
      caller.purchaseOrders.update({
        id: 4,
        notes: "Intento de edición",
      })
    ).rejects.toThrow(
      "El Bodeguero de Proyecto solo puede consultar órdenes de compra"
    );
    expect(updatePurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can assign warehouse dispatch, direct purchase or transfer in their project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "compra_directa",
      })
    ).resolves.toEqual({ success: true });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "compra_directa",
      warehouseId: null,
      status: "pendiente",
    });

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "traslado_proyecto",
      })
    ).resolves.toEqual({ success: true });

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "solicitud_compra",
      })
    ).rejects.toThrow(
      "El Bodeguero de Proyecto solo puede enviar ítems a Salida de bodega, Compra directa o Solicitud de traslado"
    );
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "traslado_proyecto",
      warehouseId: null,
      status: "pendiente",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Rejects warehouse dispatch assignment without warehouseId", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        itemName: "Disco de frenos",
        quantity: "5.00",
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const updateRequestItemSpy = vi.spyOn(db, "updateRequestItem");

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "despacho_bodega",
      })
    ).rejects.toThrow("Seleccione una bodega para la salida de inventario");
    expect(updateRequestItemSpy).not.toHaveBeenCalled();

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
  });

  it("Rejects warehouse dispatch assignment for a warehouse not assigned to the project", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        itemName: "Disco de frenos",
        quantity: "5.00",
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const listWarehousesSpy = vi
      .spyOn(db, "listWarehouses")
      .mockResolvedValue([] as any);
    const listProjectStockForItemsSpy = vi.spyOn(
      db,
      "listProjectStockForItems"
    );
    const updateRequestItemSpy = vi.spyOn(db, "updateRequestItem");

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "despacho_bodega",
        warehouseId: 999,
      })
    ).rejects.toThrow(
      "La bodega seleccionada no está activa o no está asignada al proyecto"
    );
    expect(listProjectStockForItemsSpy).not.toHaveBeenCalled();
    expect(updateRequestItemSpy).not.toHaveBeenCalled();

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    listWarehousesSpy.mockRestore();
    listProjectStockForItemsSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
  });

  it("Rejects warehouse dispatch assignment when selected warehouse lacks stock", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        itemName: "Disco de frenos",
        quantity: "5.00",
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const listWarehousesSpy = vi
      .spyOn(db, "listWarehouses")
      .mockResolvedValue([DEFAULT_PROJECT_WAREHOUSE] as any);
    const listProjectStockForItemsSpy = vi
      .spyOn(db, "listProjectStockForItems")
      .mockResolvedValue([
        {
          itemId: 41,
          quantity: "1.00",
          warehouses: [
            {
              warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
              quantity: "1.00",
            },
          ],
        },
      ] as any);
    const updateRequestItemSpy = vi.spyOn(db, "updateRequestItem");

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "despacho_bodega",
        warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
      })
    ).rejects.toThrow("Stock insuficiente en la bodega seleccionada");
    expect(updateRequestItemSpy).not.toHaveBeenCalled();

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    listWarehousesSpy.mockRestore();
    listProjectStockForItemsSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
  });

  it("Saves warehouseId when assigning warehouse dispatch", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        itemName: "Disco de frenos",
        quantity: "5.00",
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const listWarehousesSpy = vi
      .spyOn(db, "listWarehouses")
      .mockResolvedValue([DEFAULT_PROJECT_WAREHOUSE] as any);
    const listProjectStockForItemsSpy = vi
      .spyOn(db, "listProjectStockForItems")
      .mockResolvedValue([
        {
          itemId: 41,
          quantity: "10.00",
          warehouses: [
            {
              warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
              quantity: "10.00",
            },
          ],
        },
      ] as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "despacho_bodega",
        warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
      })
    ).resolves.toEqual({ success: true });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "despacho_bodega",
      warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
      status: "pendiente",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    listWarehousesSpy.mockRestore();
    listProjectStockForItemsSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Clears warehouseId when removing or changing warehouse dispatch flow", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        itemName: "Disco de frenos",
        quantity: "5.00",
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        assignedFlow: "despacho_bodega",
        warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: null,
      })
    ).resolves.toEqual({ success: true });
    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "compra_directa",
      })
    ).resolves.toEqual({ success: true });

    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: null,
      warehouseId: null,
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "compra_directa",
      warehouseId: null,
      status: "pendiente",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Services can only be assigned to direct purchase or purchase request", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "no_requiere",
        sapItemCode: "SER-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "servicios",
          approvalStatus: "aprobada",
          status: "en_proceso",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const getActivePurchaseRequestByMaterialRequestItemIdSpy = vi
      .spyOn(db, "getActivePurchaseRequestByMaterialRequestItemId")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "compra_directa",
      })
    ).resolves.toEqual({ success: true });

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "solicitud_compra",
      })
    ).resolves.toEqual({ success: true });

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "despacho_bodega",
      })
    ).rejects.toThrow(
      "Salida de bodega y solicitud de traslado no aplican para servicios"
    );

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "traslado_proyecto",
      })
    ).rejects.toThrow(
      "Salida de bodega y solicitud de traslado no aplican para servicios"
    );

    expect(updateRequestItemSpy).toHaveBeenCalledTimes(2);
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "compra_directa",
      warehouseId: null,
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "solicitud_compra",
      warehouseId: null,
      status: "pendiente",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    getActivePurchaseRequestByMaterialRequestItemIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Administrador de Proyecto can assign direct purchase or purchase request in their project", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "aprobada",
        sapItemCode: "SAP-001",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_espera",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const getActivePurchaseRequestByMaterialRequestItemIdSpy = vi
      .spyOn(db, "getActivePurchaseRequestByMaterialRequestItemId")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "compra_directa",
      })
    ).resolves.toEqual({ success: true });

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "solicitud_compra",
      })
    ).resolves.toEqual({ success: true });

    await expect(
      caller.requestItems.assignFlow({
        id: 41,
        flowType: "traslado_proyecto",
      })
    ).rejects.toThrow(
      "El Administrador de Proyecto solo puede enviar ítems a Compra directa o Solicitud de compra"
    );

    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "compra_directa",
      warehouseId: null,
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "solicitud_compra",
      warehouseId: null,
      status: "pendiente",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    getActivePurchaseRequestByMaterialRequestItemIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Project Administrator can return selected direct-purchase items to requisition", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockImplementation(
        async (id: number) =>
          ({
            id,
            requestId: 9,
            assignedFlow: "compra_directa",
            approvalStatus: "aprobada",
            deliveredQuantity: "0.00",
            dispatchedQuantity: "0.00",
          }) as any
      );
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_proceso",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: true, status: "en_espera" } as any);

    await expect(
      caller.requestItems.returnQueuedToRequisition({
        flowType: "compra_directa",
        itemIds: [41, 42],
      })
    ).resolves.toEqual({
      success: true,
      returnedItems: 2,
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: null,
      warehouseId: null,
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(42, {
      assignedFlow: null,
      warehouseId: null,
      status: "pendiente",
    });
    expect(syncMaterialRequestFulfillmentStatusSpy).toHaveBeenCalledWith(9, 5);

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Project Administrator cannot return queued items from another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        assignedFlow: "compra_directa",
        approvalStatus: "aprobada",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 2,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_proceso",
        },
      } as any);
    const updateRequestItemSpy = vi.spyOn(db, "updateRequestItem");

    await expect(
      caller.requestItems.returnQueuedToRequisition({
        flowType: "compra_directa",
        itemIds: [41],
      })
    ).rejects.toThrow("No tiene acceso a esta solicitud");
    expect(updateRequestItemSpy).not.toHaveBeenCalled();

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
  });

  it("Project Administrator can return selected purchase-request items to requisition", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        assignedFlow: "solicitud_compra",
        approvalStatus: "aprobada",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "en_proceso",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([] as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: true, status: "en_espera" } as any);

    await expect(
      caller.requestItems.returnQueuedToRequisition({
        flowType: "solicitud_compra",
        itemIds: [41],
      })
    ).resolves.toEqual({
      success: true,
      returnedItems: 1,
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: null,
      warehouseId: null,
      status: "pendiente",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can create warehouse exits for their assigned project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "aprobada",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const recordWarehouseExitBatchSpy = vi
      .spyOn(db, "recordWarehouseExitBatch")
      .mockResolvedValue({
        success: true,
        id: 88,
        exitNumber: "SB-2026-0001",
        status: "borrador",
        itemCount: 1,
      } as any);

    await expect(
      caller.requestItems.recordWarehouseExitBatch({
        requestId: 9,
        items: [
          {
            requestItemId: 41,
            dispatchedQuantity: "5.00",
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            targetType: "subproyecto",
            subProjectId: 301,
          },
        ],
        note: "Salida del proyecto",
        receivedByName: "Juan Perez",
      })
    ).resolves.toEqual({
      success: true,
      id: 88,
      exitNumber: "SB-2026-0001",
      status: "borrador",
      itemCount: 1,
    });

    expect(recordWarehouseExitBatchSpy).toHaveBeenCalledWith({
      requestId: 9,
      items: [
        expect.objectContaining({
          requestItemId: 41,
          quantity: "5.00",
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          targetType: "subproyecto",
          subProjectId: 301,
        }),
      ],
      note: "Salida del proyecto",
      receivedByName: "Juan Perez",
      processedById: 6,
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    recordWarehouseExitBatchSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can emit warehouse exits from their assigned project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getWarehouseExitByIdSpy = vi
      .spyOn(db, "getWarehouseExitById")
      .mockResolvedValue({
        warehouseExit: { id: 33, projectId: 1, status: "borrador" },
        items: [],
      } as any);
    const emitWarehouseExitSpy = vi
      .spyOn(db, "emitWarehouseExit")
      .mockResolvedValue({
        success: true,
        exitNumber: "SB-2026-0001",
        materialRequestIds: [],
      } as any);

    await expect(caller.warehouseExits.emit({ id: 33 })).resolves.toEqual({
      success: true,
      exitNumber: "SB-2026-0001",
      materialRequestIds: [],
    });
    expect(getWarehouseExitByIdSpy).toHaveBeenCalledWith(33);
    expect(emitWarehouseExitSpy).toHaveBeenCalledWith(33, 6);

    getWarehouseExitByIdSpy.mockRestore();
    emitWarehouseExitSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can update draft warehouse exits from their assigned project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getWarehouseExitByIdSpy = vi
      .spyOn(db, "getWarehouseExitById")
      .mockResolvedValue({
        warehouseExit: { id: 33, projectId: 1, status: "borrador" },
        items: [],
      } as any);
    const updateWarehouseExitDraftSpy = vi
      .spyOn(db, "updateWarehouseExitDraft")
      .mockResolvedValue({
        warehouseExit: {
          id: 33,
          projectId: 1,
          status: "borrador",
          receivedByName: "Maria Perez",
          notes: "Entrega parcial",
        },
        items: [{ id: 501, quantity: "4.00", notes: "Línea revisada" }],
      } as any);

    await expect(
      caller.warehouseExits.updateDraft({
        id: 33,
        receivedByName: "Maria Perez",
        notes: "Entrega parcial",
        items: [{ id: 501, quantity: "4.00", notes: "Línea revisada" }],
      })
    ).resolves.toEqual({
      warehouseExit: {
        id: 33,
        projectId: 1,
        status: "borrador",
        receivedByName: "Maria Perez",
        notes: "Entrega parcial",
      },
      items: [{ id: 501, quantity: "4.00", notes: "Línea revisada" }],
    });
    expect(getWarehouseExitByIdSpy).toHaveBeenCalledWith(33);
    expect(updateWarehouseExitDraftSpy).toHaveBeenCalledWith(33, {
      receivedByName: "Maria Perez",
      notes: "Entrega parcial",
      items: [{ id: 501, quantity: "4.00", notes: "Línea revisada" }],
    });

    getWarehouseExitByIdSpy.mockRestore();
    updateWarehouseExitDraftSpy.mockRestore();
  });

  it("Bodeguero de Proyecto cannot update draft warehouse exits from another project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getWarehouseExitByIdSpy = vi
      .spyOn(db, "getWarehouseExitById")
      .mockResolvedValue({
        warehouseExit: { id: 34, projectId: 2, status: "borrador" },
        items: [],
      } as any);
    const updateWarehouseExitDraftSpy = vi.spyOn(
      db,
      "updateWarehouseExitDraft"
    );

    await expect(
      caller.warehouseExits.updateDraft({
        id: 34,
        receivedByName: "Maria Perez",
        items: [{ id: 501, quantity: "4.00" }],
      })
    ).rejects.toThrow("No tiene acceso a salidas de bodega de otro proyecto");
    expect(updateWarehouseExitDraftSpy).not.toHaveBeenCalled();

    getWarehouseExitByIdSpy.mockRestore();
    updateWarehouseExitDraftSpy.mockRestore();
  });

  it("Bodeguero de Proyecto cannot emit warehouse exits from another project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getWarehouseExitByIdSpy = vi
      .spyOn(db, "getWarehouseExitById")
      .mockResolvedValue({
        warehouseExit: { id: 34, projectId: 2, status: "borrador" },
        items: [],
      } as any);
    const emitWarehouseExitSpy = vi.spyOn(db, "emitWarehouseExit");

    await expect(caller.warehouseExits.emit({ id: 34 })).rejects.toThrow(
      "No tiene acceso a salidas de bodega de otro proyecto"
    );
    expect(emitWarehouseExitSpy).not.toHaveBeenCalled();

    getWarehouseExitByIdSpy.mockRestore();
    emitWarehouseExitSpy.mockRestore();
  });

  it("Direct purchase processing belongs to the project administrator, not the Bodeguero de Proyecto", async () => {
    const { ctx: bodegueroCtx } = createProjectBodegueroContext();
    const bodegueroCaller = appRouter.createCaller(bodegueroCtx);

    await expect(
      bodegueroCaller.supplyFlows.createDirectPurchaseBatch({
        supplierId: 7,
        paymentMethod: "caja_chica",
        items: [{ requestId: 9, requestItemId: 41, quantity: "5.00" }],
      })
    ).rejects.toThrow("No tiene permisos para registrar compras directas");

    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestNumber: "REQ-2026-0009",
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: null,
        },
        items: [
          {
            id: 41,
            requestId: 9,
            itemName: "cemento",
            quantity: "5.00",
            unit: "und",
            sapItemCode: "SAP-001",
            sapItemDescription: "Cemento",
            approvalStatus: "aprobada",
            committedQuantity: "0.00",
            projectStock: "0.00",
            sapStock: "0.00",
            notes: null,
          },
        ],
      } as any);
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({
        id: 77,
        requestNumber: "SC-2026-0001",
      } as any);
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 88 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);

    await expect(
      caller.supplyFlows.createDirectPurchaseBatch({
        paymentMethod: "caja_chica",
        items: [{ requestId: 9, requestItemId: 41, quantity: "5.00" }],
      })
    ).resolves.toEqual({
      success: true,
      purchaseRequestId: 77,
      purchaseRequestNumber: "SC-2026-0001",
      processedItems: 1,
    });
    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        createdById: 5,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          materialRequestItemId: 41,
          itemName: "Cemento",
          quantity: "5.00",
        }),
      ])
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 9,
        requestItemId: 41,
        flowType: "compra_directa",
        supplierId: null,
        processedById: 5,
        status: "pendiente",
      })
    );

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Administrador de Proyecto can process purchase-request flows in their project", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestNumber: "REQ-2026-0009",
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: null,
        },
        items: [
          {
            id: 41,
            requestId: 9,
            itemName: "cemento",
            quantity: "5.00",
            unit: "und",
            sapItemCode: "SAP-001",
            sapItemDescription: "Cemento",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const getActivePurchaseRequestByMaterialRequestItemIdSpy = vi
      .spyOn(db, "getActivePurchaseRequestByMaterialRequestItemId")
      .mockResolvedValue(undefined as any);
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ id: 41 } as any);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({
        id: 77,
        requestNumber: "SC-2026-0001",
      } as any);
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 88 } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([] as any);
    const createNotificationSpy = vi.spyOn(db, "createNotification");

    await expect(
      caller.supplyFlows.createPurchaseRequest({
        requestId: 9,
        requestItemId: 41,
        purchaseType: "compra_directa",
        notes: "Compra solicitada por proyecto",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: 88,
        purchaseRequestId: 77,
        purchaseRequestNumber: "SC-2026-0001",
      })
    );
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "solicitud_compra",
      status: "pendiente",
    });
    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        createdById: 5,
        purchaseType: "compra_directa",
      }),
      expect.arrayContaining([
        expect.objectContaining({
          materialRequestItemId: 41,
          itemName: "Cemento",
          quantity: "5.00",
        }),
      ])
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 9,
        requestItemId: 41,
        flowType: "solicitud_compra",
        processedById: 5,
        status: "pendiente",
      })
    );
    expect(createNotificationSpy).not.toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    getActivePurchaseRequestByMaterialRequestItemIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Administrador de Proyecto can consolidate selected purchase-request flow items", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestNumber: "REQ-2026-0009",
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: null,
        },
        items: [
          {
            id: 41,
            requestId: 9,
            itemName: "cemento",
            quantity: "5.00",
            unit: "und",
            sapItemCode: "SAP-001",
            sapItemDescription: "Cemento",
            approvalStatus: "aprobada",
          },
          {
            id: 42,
            requestId: 9,
            itemName: "arena",
            quantity: "7.00",
            unit: "m3",
            sapItemCode: "SAP-002",
            sapItemDescription: "Arena",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const getActivePurchaseRequestByMaterialRequestItemIdSpy = vi
      .spyOn(db, "getActivePurchaseRequestByMaterialRequestItemId")
      .mockResolvedValue(undefined as any);
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({
        id: 77,
        requestNumber: "SC-2026-0001",
      } as any);
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockImplementation(
        async (data: any) => ({ id: data.requestItemId }) as any
      );
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({ changed: false, status: "en_proceso" } as any);
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([] as any);
    const createNotificationSpy = vi.spyOn(db, "createNotification");

    await expect(
      caller.supplyFlows.createPurchaseRequestBatch({
        purchaseType: "compra_directa",
        notes: "Consolidada",
        items: [
          { requestId: 9, requestItemId: 41 },
          { requestId: 9, requestItemId: 42 },
        ],
      })
    ).resolves.toEqual({
      success: true,
      purchaseRequestId: 77,
      purchaseRequestNumber: "SC-2026-0001",
      processedItems: 2,
      flowIds: [41, 42],
    });
    expect(createPurchaseRequestSpy).toHaveBeenCalledTimes(1);
    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        materialRequestId: 9,
        projectId: 1,
        createdById: 5,
        purchaseType: "compra_directa",
      }),
      [
        expect.objectContaining({
          materialRequestItemId: 41,
          itemName: "Cemento",
          quantity: "5.00",
        }),
        expect.objectContaining({
          materialRequestItemId: 42,
          itemName: "Arena",
          quantity: "7.00",
        }),
      ]
    );
    expect(updateRequestItemSpy).toHaveBeenCalledWith(41, {
      assignedFlow: "solicitud_compra",
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(42, {
      assignedFlow: "solicitud_compra",
      status: "pendiente",
    });
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledTimes(2);
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 9,
        requestItemId: 41,
        sapDocumentNumber: "SC-2026-0001",
      })
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 9,
        requestItemId: 42,
        sapDocumentNumber: "SC-2026-0001",
      })
    );
    expect(syncMaterialRequestFulfillmentStatusSpy).toHaveBeenCalledWith(9, 5);
    expect(createNotificationSpy).not.toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    getActivePurchaseRequestByMaterialRequestItemIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Purchase-request consolidation rejects items from different projects", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockImplementation(
        async (requestId: number) =>
          ({
            request: {
              id: requestId,
              requestNumber: `REQ-2026-${requestId}`,
              requestedById: 2,
              projectId: requestId === 9 ? 1 : 2,
              requestType: "bienes",
              approvalStatus: "aprobada",
              neededBy: null,
            },
            items: [
              {
                id: requestId === 9 ? 41 : 42,
                requestId,
                itemName: "cemento",
                quantity: "5.00",
                unit: "und",
                sapItemCode: "SAP-001",
                sapItemDescription: "Cemento",
                approvalStatus: "aprobada",
              },
            ],
          }) as any
      );
    const getActivePurchaseRequestByMaterialRequestItemIdSpy = vi
      .spyOn(db, "getActivePurchaseRequestByMaterialRequestItemId")
      .mockResolvedValue(undefined as any);
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined as any);
    const createPurchaseRequestSpy = vi.spyOn(db, "createPurchaseRequest");

    await expect(
      caller.supplyFlows.createPurchaseRequestBatch({
        purchaseType: "local",
        items: [
          { requestId: 9, requestItemId: 41 },
          { requestId: 10, requestItemId: 42 },
        ],
      })
    ).rejects.toThrow(
      "Seleccione ítems del mismo proyecto para consolidar en una sola solicitud de compra"
    );
    expect(createPurchaseRequestSpy).not.toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    getActivePurchaseRequestByMaterialRequestItemIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
  });

  it("Administrador de Proyecto cannot process purchase-request flows from another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestNumber: "REQ-2026-0009",
          requestedById: 2,
          projectId: 2,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: null,
        },
        items: [
          {
            id: 41,
            requestId: 9,
            itemName: "cemento",
            quantity: "5.00",
            unit: "und",
            sapItemCode: "SAP-001",
            sapItemDescription: "Cemento",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const createPurchaseRequestSpy = vi.spyOn(db, "createPurchaseRequest");

    await expect(
      caller.supplyFlows.createPurchaseRequest({
        requestId: 9,
        requestItemId: 41,
        purchaseType: "local",
      })
    ).rejects.toThrow("No tiene acceso a esta solicitud");
    expect(createPurchaseRequestSpy).not.toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
  });

  it("Administración Central can register warehouse exits", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        approvalStatus: "aprobada",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const recordWarehouseExitSpy = vi
      .spyOn(db, "recordWarehouseExit")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.requestItems.recordWarehouseExit({
        requestId: 9,
        requestItemId: 41,
        dispatchedQuantity: "25.00",
        warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        note: "Salida aprobada por administración central",
        receivedByName: "Luis Mejia",
      })
    ).resolves.toEqual({ success: true });

    expect(recordWarehouseExitSpy).toHaveBeenCalledWith({
      requestId: 9,
      requestItemId: 41,
      quantity: "25.00",
      warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
      note: "Salida aprobada por administración central",
      receivedByName: "Luis Mejia",
      processedById: 4,
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    recordWarehouseExitSpy.mockRestore();
  });

  it("Administración Central can register one warehouse exit with multiple items", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockImplementation(
        async (id: number) =>
          ({
            id,
            requestId: 9,
            approvalStatus: "aprobada",
          }) as any
      );
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const recordWarehouseExitBatchSpy = vi
      .spyOn(db, "recordWarehouseExitBatch")
      .mockResolvedValue({
        success: true,
        id: 88,
        exitNumber: "SB-2026-0001",
        status: "borrador",
        itemCount: 2,
      } as any);

    await expect(
      caller.requestItems.recordWarehouseExitBatch({
        requestId: 9,
        items: [
          {
            requestItemId: 41,
            dispatchedQuantity: "25.00",
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          },
          {
            requestItemId: 42,
            dispatchedQuantity: "10.00",
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          },
        ],
        note: "Salida aprobada por administración central",
        receivedByName: "Luis Mejia",
      })
    ).resolves.toEqual({
      success: true,
      id: 88,
      exitNumber: "SB-2026-0001",
      status: "borrador",
      itemCount: 2,
    });

    expect(recordWarehouseExitBatchSpy).toHaveBeenCalledWith({
      requestId: 9,
      items: [
        {
          requestItemId: 41,
          quantity: "25.00",
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        },
        {
          requestItemId: 42,
          quantity: "10.00",
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        },
      ],
      note: "Salida aprobada por administración central",
      receivedByName: "Luis Mejia",
      processedById: 4,
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    recordWarehouseExitBatchSpy.mockRestore();
  });

  it("Bodega users cannot reject an approved request item administratively", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.requestItems.rejectApproved({
        id: 41,
        reason: "Saldo ya no requerido",
      })
    ).rejects.toThrow(
      "Solo el Administrador del Proyecto o Administración Central pueden rechazar ítems aprobados"
    );
  });

  it("Administración Central can reject an approved request item with a reason", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        assignedFlow: null,
        approvalStatus: "aprobada",
        deliveredQuantity: "0.00",
        dispatchedQuantity: "0.00",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestType: "bienes",
          approvalStatus: "aprobada",
          status: "parcialmente_atendida",
        },
      } as any);
    const getSupplyFlowByRequestIdSpy = vi
      .spyOn(db, "getSupplyFlowByRequestId")
      .mockResolvedValue([]);
    const rejectApprovedRequestItemSpy = vi
      .spyOn(db, "rejectApprovedRequestItem")
      .mockResolvedValue({
        success: true,
        requestId: 9,
        rejectedItemId: 41,
        rejectedQuantity: "25.00",
      } as any);

    await expect(
      caller.requestItems.rejectApproved({
        id: 41,
        reason: "Saldo ya no requerido",
      })
    ).resolves.toEqual({
      success: true,
      requestId: 9,
      rejectedItemId: 41,
      rejectedQuantity: "25.00",
    });

    expect(rejectApprovedRequestItemSpy).toHaveBeenCalledWith({
      requestItemId: 41,
      rejectedById: 4,
      rejectionReason: "Saldo ya no requerido",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    getSupplyFlowByRequestIdSpy.mockRestore();
    rejectApprovedRequestItemSpy.mockRestore();
  });

  it("Bodega users can return a warehouse dispatch item to the requisition", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        assignedFlow: "despacho_bodega",
        approvalStatus: "aprobada",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const returnWarehouseDispatchItemToRequisitionSpy = vi
      .spyOn(db, "returnWarehouseDispatchItemToRequisition")
      .mockResolvedValue({
        success: true,
        requestId: 9,
        returnedItemId: 41,
        pendingRequestItemId: 77,
        pendingQuantity: "50.00",
      } as any);

    await expect(
      caller.requestItems.returnDispatchToRequisition({ id: 41 })
    ).resolves.toEqual({
      success: true,
      requestId: 9,
      returnedItemId: 41,
      pendingRequestItemId: 77,
      pendingQuantity: "50.00",
    });

    expect(returnWarehouseDispatchItemToRequisitionSpy).toHaveBeenCalledWith({
      requestItemId: 41,
      processedById: 3,
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    returnWarehouseDispatchItemToRequisitionSpy.mockRestore();
  });

  it("Bodega users can reject a remaining item balance", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 41,
        requestId: 9,
        quantity: "10.00",
        deliveredQuantity: "5.00",
        dispatchedQuantity: "5.00",
        approvalStatus: "aprobada",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 9,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
      } as any);
    const rejectRequestItemPendingQuantitySpy = vi
      .spyOn(db, "rejectRequestItemPendingQuantity")
      .mockResolvedValue({
        success: true,
        requestId: 9,
        processedItemId: 41,
        rejectedItemId: 78,
        rejectedQuantity: "5.00",
      } as any);

    await expect(
      caller.requestItems.rejectPendingQuantity({
        id: 41,
        reason: "Saldo ya no requerido",
      })
    ).resolves.toEqual({
      success: true,
      requestId: 9,
      processedItemId: 41,
      rejectedItemId: 78,
      rejectedQuantity: "5.00",
    });

    expect(rejectRequestItemPendingQuantitySpy).toHaveBeenCalledWith({
      requestItemId: 41,
      rejectedById: 3,
      rejectionReason: "Saldo ya no requerido",
    });

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
    rejectRequestItemPendingQuantitySpy.mockRestore();
  });

  it("Bodega users can emit warehouse exit documents created from flows", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const emitWarehouseExitSpy = vi
      .spyOn(db, "emitWarehouseExit")
      .mockResolvedValue({
        success: true,
        exitNumber: "SB-2026-0001",
      } as any);

    await expect(caller.warehouseExits.emit({ id: 33 })).resolves.toEqual({
      success: true,
      exitNumber: "SB-2026-0001",
    });
    expect(emitWarehouseExitSpy).toHaveBeenCalledWith(33, 3);

    emitWarehouseExitSpy.mockRestore();
  });

  it("syncs the material request status after emitting a warehouse exit", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const emitWarehouseExitSpy = vi
      .spyOn(db, "emitWarehouseExit")
      .mockResolvedValue({
        success: true,
        exitNumber: "SB-2026-0008",
        materialRequestIds: [25],
      } as any);
    const syncMaterialRequestFulfillmentStatusSpy = vi
      .spyOn(db, "syncMaterialRequestFulfillmentStatus")
      .mockResolvedValue({
        success: true,
        status: "cerrada",
        changed: true,
      } as any);

    await expect(caller.warehouseExits.emit({ id: 88 })).resolves.toEqual({
      success: true,
      exitNumber: "SB-2026-0008",
      materialRequestIds: [25],
    });
    expect(emitWarehouseExitSpy).toHaveBeenCalledWith(88, 3);
    expect(syncMaterialRequestFulfillmentStatusSpy).toHaveBeenCalledWith(25, 3);

    emitWarehouseExitSpy.mockRestore();
    syncMaterialRequestFulfillmentStatusSpy.mockRestore();
  });

  it("Administración Central can create project transfers", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 12,
          projectId: 7,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: new Date("2026-04-20"),
        },
        items: [
          {
            id: 51,
            itemName: "Cemento",
            sapItemCode: "05050200058",
            sapItemDescription: "CEMENTO GRANEL",
            quantity: "100.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);
    const listProjectStockForItemsSpy = vi
      .spyOn(db, "listProjectStockForItems")
      .mockResolvedValue([
        {
          itemId: 51,
          quantity: "100.00",
          warehouses: [
            { warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID, quantity: "100.00" },
          ],
        },
      ] as any);
    const createTransferRequestSpy = vi
      .spyOn(db, "createTransferRequest")
      .mockResolvedValue({ id: 88, requestNumber: "ST-2026-0088" } as any);
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 701 } as any);
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([
        { id: 51, assignedFlow: "traslado_proyecto" },
      ] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.supplyFlows.createProjectTransfer({
        requestId: 12,
        requestItemId: 51,
        sourceProjectId: 3,
        destinationProjectId: 7,
        sourceWarehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        notes: "Traslado aprobado por administración central",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: 701,
        transferRequestId: 88,
        transferRequestNumber: "ST-2026-0088",
      })
    );

    expect(updateRequestItemSpy).toHaveBeenCalledWith(51, {
      assignedFlow: "traslado_proyecto",
      status: "pendiente",
    });
    expect(createTransferRequestSpy).toHaveBeenCalled();
    expect(createSupplyFlowRecordSpy).toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    listProjectStockForItemsSpy.mockRestore();
    createTransferRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("Administración Central can create one transfer request for selected items", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 12,
          projectId: 7,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: new Date("2026-04-20"),
        },
        items: [
          {
            id: 51,
            itemName: "Cemento",
            sapItemCode: "05050200058",
            sapItemDescription: "CEMENTO GRANEL",
            quantity: "100.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
          {
            id: 52,
            itemName: "Pala",
            sapItemCode: "03030100036",
            sapItemDescription: "PALA PUNTA REDONDA",
            quantity: "2.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);
    const listProjectStockForItemsSpy = vi
      .spyOn(db, "listProjectStockForItems")
      .mockResolvedValue([
        {
          itemId: 51,
          quantity: "100.00",
          warehouses: [
            { warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID, quantity: "100.00" },
          ],
        },
        {
          itemId: 52,
          quantity: "2.00",
          warehouses: [
            { warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID, quantity: "2.00" },
          ],
        },
      ] as any);
    const createTransferRequestSpy = vi
      .spyOn(db, "createTransferRequest")
      .mockResolvedValue({ id: 88, requestNumber: "ST-2026-0088" } as any);
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValueOnce({ id: 701 } as any)
      .mockResolvedValueOnce({ id: 702 } as any);
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([
        { id: 51, assignedFlow: "traslado_proyecto" },
        { id: 52, assignedFlow: "traslado_proyecto" },
      ] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.supplyFlows.createProjectTransferBatch({
        notes: "Traslado consolidado",
        items: [
          {
            requestId: 12,
            requestItemId: 51,
          },
          {
            requestId: 12,
            requestItemId: 52,
          },
        ],
      })
    ).resolves.toEqual({
      success: true,
      transferRequestId: 88,
      transferRequestNumber: "ST-2026-0088",
      processedItems: 2,
      flowIds: [701, 702],
    });

    expect(createTransferRequestSpy).toHaveBeenCalledTimes(1);
    expect(createTransferRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        materialRequestId: 12,
        projectId: 7,
        destinationProjectId: 7,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          materialRequestItemId: 51,
          sourceWarehouseId: null,
        }),
        expect.objectContaining({
          materialRequestItemId: 52,
          sourceWarehouseId: null,
        }),
      ])
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledTimes(2);

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    listProjectStockForItemsSpy.mockRestore();
    createTransferRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("creates project transfer requests without selecting source warehouse", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 12,
          projectId: 7,
          requestType: "bienes",
          approvalStatus: "aprobada",
        },
        items: [
          {
            id: 51,
            itemName: "Diesel",
            sapItemCode: "01010100001",
            quantity: "1000.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true } as any);
    const createTransferRequestSpy = vi
      .spyOn(db, "createTransferRequest")
      .mockResolvedValue({ id: 88, requestNumber: "ST-2026-0088" } as any);
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 701 } as any);
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([
        { id: 51, assignedFlow: "traslado_proyecto" },
      ] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.supplyFlows.createProjectTransferBatch({
        items: [
          {
            requestId: 12,
            requestItemId: 51,
          },
        ],
      })
    ).resolves.toEqual({
      success: true,
      transferRequestId: 88,
      transferRequestNumber: "ST-2026-0088",
      processedItems: 1,
      flowIds: [701],
    });
    expect(createTransferRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        destinationProjectId: 7,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          materialRequestItemId: 51,
          sourceWarehouseId: null,
        }),
      ])
    );

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createTransferRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can view transfer flow options but cannot process transfers", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const createTransferRequestSpy = vi.spyOn(db, "createTransferRequest");

    await expect(caller.supplyFlows.availableFlows()).resolves.toEqual([
      "compra_directa",
      "traslado_proyecto",
    ]);

    await expect(
      caller.supplyFlows.createProjectTransferBatch({
        sourceProjectId: 3,
        notes: "Traslado visible para seguimiento",
        items: [
          {
            requestId: 12,
            requestItemId: 51,
            sourceWarehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          },
        ],
      })
    ).rejects.toThrow(
      "Solo el Jefe de Bodega Central o Administración Central pueden gestionar traslados"
    );
    expect(createTransferRequestSpy).not.toHaveBeenCalled();

    createTransferRequestSpy.mockRestore();
  });

  it("Bodeguero de Proyecto cannot create transfer requests for another project", async () => {
    const { ctx } = createProjectBodegueroContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const createTransferRequestSpy = vi.spyOn(db, "createTransferRequest");

    await expect(
      caller.supplyFlows.createProjectTransferBatch({
        sourceProjectId: 3,
        items: [
          {
            requestId: 12,
            requestItemId: 51,
            sourceWarehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          },
        ],
      })
    ).rejects.toThrow(
      "Solo el Jefe de Bodega Central o Administración Central pueden gestionar traslados"
    );
    expect(createTransferRequestSpy).not.toHaveBeenCalled();

    createTransferRequestSpy.mockRestore();
  });

  it("Bodega user cannot convert to PO from supply flow", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.convertToPurchaseOrder({
        flowId: 1,
      })
    ).rejects.toThrow(
      "Solo Administración Central o el Administrador del Proyecto puede convertir a Orden de Compra"
    );
  });
});

// ============================================================
// Tests: Reverse Logistics validations
// ============================================================
describe("BuildReq - Reverse Logistics Validations", () => {
  beforeEach(() => {
    vi.spyOn(db, "listProjectWarehouses").mockResolvedValue([
      DEFAULT_PROJECT_WAREHOUSE,
    ] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Requires justification with minimum 10 characters", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_bodega_central",
        reasonCategory: "material_defectuoso",
        justification: "corta", // Less than 10 chars
        receivedByName: "Juan Perez",
        sourceProjectId: 1,
        items: [
          {
            itemName: "Cemento Portland",
            quantity: "10",
            condition: "defectuoso",
          },
        ],
      })
    ).rejects.toThrow();
  });

  it("Requires completed receipt for vendor returns", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_proveedor",
        reasonCategory: "material_defectuoso",
        justification:
          "Material llegó defectuoso del proveedor, no cumple especificaciones",
        receivedByName: "Juan Perez",
        sourceProjectId: 1,
        supplierName: "Proveedor de prueba",
        items: [
          {
            itemName: "Varilla de acero",
            quantity: "50",
            condition: "defectuoso",
          },
        ],
        // Missing sourceReceiptId
      })
    ).rejects.toThrow(
      "Para devoluciones a proveedor, debe seleccionar una recepción completada"
    );
  });

  it("Requires destination project for inter-project returns", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_entre_proyectos",
        reasonCategory: "excedente",
        justification:
          "Material excedente que puede ser utilizado en otro proyecto",
        receivedByName: "Juan Perez",
        sourceProjectId: 1,
        // Missing destinationProjectId
        items: [
          {
            itemName: "Bloques de concreto",
            quantity: "100",
            condition: "nuevo",
          },
        ],
      })
    ).rejects.toThrow(
      "Para devoluciones entre proyectos, debe indicar el proyecto destino"
    );
  });

  it("Requires at least one item in return", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_bodega_central",
        reasonCategory: "excedente",
        justification:
          "Material sobrante del proyecto que debe retornarse a bodega",
        receivedByName: "Juan Perez",
        sourceProjectId: 1,
        items: [], // Empty items
      })
    ).rejects.toThrow();
  });

  it("Allows creating returns to a project warehouse", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const createReverseLogisticSpy = vi
      .spyOn(db, "createReverseLogistic")
      .mockResolvedValue({
        id: 77,
        returnNumber: "DEV-2026-0007",
      });
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([]);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_bodega_proyecto",
        reasonCategory: "excedente",
        justification:
          "Material devuelto al proyecto despues de una salida de bodega",
        receivedByName: "Juan Perez",
        sourceProjectId: 1,
        items: [
          {
            itemName: "Pala",
            sapItemCode: "01010200099",
            quantity: "100.00",
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            unit: "und",
            condition: "usado_buen_estado",
          },
        ],
      })
    ).resolves.toEqual({
      id: 77,
      returnNumber: "DEV-2026-0007",
    });

    expect(createReverseLogisticSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        returnType: "devolucion_bodega_proyecto",
        sourceProjectId: 1,
        receivedByName: "Juan Perez",
        createdById: ctx.user?.id,
      }),
      [
        expect.objectContaining({
          itemName: "Pala",
          sapItemCode: "01010200099",
          quantity: "100.00",
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        }),
      ]
    );

    createReverseLogisticSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Creates vendor returns as credit notes from completed receipts", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getReceiptByIdSpy = vi.spyOn(db, "getReceiptById").mockResolvedValue({
      receipt: {
        id: 44,
        receiptNumber: "TR-2026-0044",
        sourceType: "purchase_order",
        sourceId: 12,
        projectId: 1,
        status: "completa",
      },
      project: null,
      purchaseOrder: null,
      supplier: null,
      items: [
        {
          sourceItemId: 15,
          itemName: "Varilla de acero",
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        },
      ],
    } as any);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 12,
          orderNumber: "OC-2026-0012",
        },
        purchaseRequest: null,
        project: null,
        supplier: {
          id: 5,
          supplierCode: "PL-00005",
          name: "Proveedor Demo",
        },
        items: [],
        summary: {},
      } as any);
    const createReverseLogisticSpy = vi
      .spyOn(db, "createReverseLogistic")
      .mockResolvedValue({
        id: 88,
        returnNumber: "DEV-2026-0088",
      });
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([]);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_proveedor",
        reasonCategory: "material_defectuoso",
        justification:
          "Material recibido defectuoso y debe devolverse al proveedor",
        sourceProjectId: 1,
        receivedByName: "Juan Perez",
        sourceReceiptId: 44,
        supplierName: "Proveedor escrito a mano",
        items: [
          {
            itemName: "Varilla de acero",
            sapItemCode: "01010200055",
            quantity: "50.00",
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            unit: "und",
            condition: "defectuoso",
          },
        ],
      })
    ).resolves.toEqual({
      id: 88,
      returnNumber: "DEV-2026-0088",
    });

    expect(createReverseLogisticSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        returnType: "devolucion_proveedor",
        sourceReceiptId: 44,
        sourceProjectId: 1,
        supplierName: "PL-00005 — Proveedor Demo",
        sapDocumentType: "nota_credito",
        receivedByName: "Juan Perez",
        createdById: ctx.user?.id,
      }),
      [
        expect.objectContaining({
          itemName: "Varilla de acero",
          sapItemCode: "01010200055",
          quantity: "50.00",
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        }),
      ]
    );

    getReceiptByIdSpy.mockRestore();
    getPurchaseOrderByIdSpy.mockRestore();
    createReverseLogisticSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Allows bodega users to generate supplier credit notes", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const generateCreditNoteSpy = vi
      .spyOn(db, "generateSupplierReturnCreditNote")
      .mockResolvedValue({
        success: true,
        status: "aprobada",
        sapDocumentNumber: "NC-2026-0088",
      });
    const getReverseLogisticByIdSpy = vi
      .spyOn(db, "getReverseLogisticById")
      .mockResolvedValue({
        return: {
          id: 88,
          returnNumber: "DEV-2026-0088",
          createdById: 3,
        },
        sourceProject: null,
        sourceWarehouseExit: null,
        items: [],
      } as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.reverseLogistics.generateCreditNote({ id: 88 })
    ).resolves.toEqual({
      success: true,
      status: "aprobada",
      sapDocumentNumber: "NC-2026-0088",
    });

    expect(generateCreditNoteSpy).toHaveBeenCalledWith(88, ctx.user?.id);
    expect(createNotificationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        title: "Nota de crédito generada",
        relatedEntityType: "reverse_logistic",
        relatedEntityId: 88,
      })
    );

    generateCreditNoteSpy.mockRestore();
    getReverseLogisticByIdSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Allows bodega users to create central warehouse transfer requests from returns", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const createCentralTransferSpy = vi
      .spyOn(db, "createCentralWarehouseTransferFromReverseLogistic")
      .mockResolvedValue({
        id: 55,
        requestNumber: "ST-001-00000055",
      });
    const getReverseLogisticByIdSpy = vi
      .spyOn(db, "getReverseLogisticById")
      .mockResolvedValue({
        return: {
          id: 88,
          returnNumber: "DEV-001-00000088",
          createdById: 7,
        },
        items: [],
      } as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.reverseLogistics.createCentralWarehouseTransfer({ id: 88 })
    ).resolves.toEqual({
      id: 55,
      requestNumber: "ST-001-00000055",
    });

    expect(createCentralTransferSpy).toHaveBeenCalledWith(88, ctx.user?.id);
    expect(createNotificationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        title: "Traslado creado para devolución",
        relatedEntityType: "reverse_logistic",
        relatedEntityId: 88,
      })
    );

    createCentralTransferSpy.mockRestore();
    getReverseLogisticByIdSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Only bodega users can create central warehouse transfer requests from returns", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const createCentralTransferSpy = vi.spyOn(
      db,
      "createCentralWarehouseTransferFromReverseLogistic"
    );

    await expect(
      caller.reverseLogistics.createCentralWarehouseTransfer({ id: 88 })
    ).rejects.toThrow(
      "Solo el Jefe de Bodega Central puede crear traslados de devoluciones"
    );

    expect(createCentralTransferSpy).not.toHaveBeenCalled();
    createCentralTransferSpy.mockRestore();
  });
});

// ============================================================
// Tests: Material Request validations
// ============================================================
describe("BuildReq - Material Request Validations", () => {
  it("Ingeniero Residente cannot create material requests for another project", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.create({
        projectId: 2,
        recipient: "bodega_central",
        items: [{ itemName: "Cemento", quantity: "10", unit: "saco" }],
      })
    ).rejects.toThrow("No tiene acceso a requisiciones de otro proyecto");
  });

  it("Requires at least one item in request", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.create({
        projectId: 1,
        recipient: "bodega_central",
        items: [], // Empty items
      })
    ).rejects.toThrow();
  });

  it("Validates recipient enum values", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.create({
        projectId: 1,
        recipient: "invalid_recipient" as any,
        items: [{ itemName: "Cemento", quantity: "10" }],
      })
    ).rejects.toThrow();
  });

  it("Validates status enum values", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.updateStatus({
        id: 1,
        status: "invalid_status" as any,
      })
    ).rejects.toThrow();
  });

  it("Requires neededBy when request is urgent", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.create({
        projectId: 1,
        recipient: "bodega_central",
        purchaseUrgency: "urgente",
        items: [{ itemName: "Cemento", quantity: "10", unit: "saco" }],
      })
    ).rejects.toThrow(
      "La fecha necesaria es obligatoria para compras urgentes"
    );
  });

  it("Rejects urgent requests outside the 5-day policy window", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.create({
        projectId: 1,
        recipient: "bodega_central",
        purchaseUrgency: "urgente",
        neededBy: "2099-12-31",
        items: [{ itemName: "Cemento", quantity: "10", unit: "saco" }],
      })
    ).rejects.toThrow("Para clasificarla como urgente");
  });

  it("Allows saving a material request as draft without items", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const createMaterialRequestSpy = vi
      .spyOn(db, "createMaterialRequest")
      .mockResolvedValue({ id: 91, requestNumber: "REQ-2026-0091" });
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);
    const getProjectAdminsSpy = vi
      .spyOn(db, "getUsersByBuildreqRoleAndProject")
      .mockResolvedValue([]);

    await expect(
      caller.materialRequests.create({
        saveMode: "draft",
        projectId: 1,
        requestType: "bienes",
        items: [],
      })
    ).resolves.toEqual({
      id: 91,
      requestNumber: "REQ-2026-0091",
      status: "borrador",
    });

    expect(createMaterialRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
        requestedById: 2,
        status: "borrador",
      }),
      []
    );
    expect(getProjectAdminsSpy).not.toHaveBeenCalled();
    expect(createNotificationSpy).not.toHaveBeenCalled();

    createMaterialRequestSpy.mockRestore();
    createNotificationSpy.mockRestore();
    getProjectAdminsSpy.mockRestore();
  });

  it("Can create a material request linked to a valid project subproject", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getProjectSubprojectByIdSpy = vi
      .spyOn(db, "getProjectSubprojectById")
      .mockResolvedValue({
        id: 10,
        projectId: 1,
        code: "SP-001",
        name: "Etapa 1",
        isActive: true,
      } as any);
    const createMaterialRequestSpy = vi
      .spyOn(db, "createMaterialRequest")
      .mockResolvedValue({ id: 93, requestNumber: "REQ-2026-0093" });

    await expect(
      caller.materialRequests.create({
        saveMode: "draft",
        projectId: 1,
        items: [
          {
            itemName: "Filtro",
            quantity: "1",
            unit: "und",
            targetType: "subproyecto",
            subProjectId: 10,
          },
        ],
      })
    ).resolves.toEqual({
      id: 93,
      requestNumber: "REQ-2026-0093",
      status: "borrador",
    });

    expect(createMaterialRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
      }),
      [
        expect.objectContaining({
          itemName: "Filtro",
          targetType: "subproyecto",
          subProjectId: 10,
          fixedAssetSapItemCode: null,
          fixedAssetName: null,
        }),
      ]
    );

    getProjectSubprojectByIdSpy.mockRestore();
    createMaterialRequestSpy.mockRestore();
  });

  it("Rejects subproject targets from another project", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getProjectSubprojectByIdSpy = vi
      .spyOn(db, "getProjectSubprojectById")
      .mockResolvedValue({
        id: 10,
        projectId: 2,
        code: "SP-001",
        name: "Etapa 1",
        isActive: true,
      } as any);
    const createMaterialRequestSpy = vi.spyOn(db, "createMaterialRequest");

    await expect(
      caller.materialRequests.create({
        saveMode: "draft",
        projectId: 1,
        items: [
          {
            itemName: "Filtro",
            quantity: "1",
            unit: "und",
            targetType: "subproyecto",
            subProjectId: 10,
          },
        ],
      })
    ).rejects.toThrow("El subproyecto seleccionado no pertenece");

    expect(createMaterialRequestSpy).not.toHaveBeenCalled();

    getProjectSubprojectByIdSpy.mockRestore();
    createMaterialRequestSpy.mockRestore();
  });

  it("Can create a material request linked to an active fixed asset", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getActiveFixedAssetByCodeSpy = vi
      .spyOn(db, "getActiveFixedAssetByCode")
      .mockResolvedValue({
        itemCode: "AF-001",
        description: "Camión mezclador",
        tipoArticulo: 3,
        isActive: true,
      } as any);
    const createMaterialRequestSpy = vi
      .spyOn(db, "createMaterialRequest")
      .mockResolvedValue({ id: 94, requestNumber: "REQ-2026-0094" });

    await expect(
      caller.materialRequests.create({
        saveMode: "draft",
        projectId: 1,
        items: [
          {
            itemName: "Mantenimiento",
            quantity: "1",
            unit: "und",
            targetType: "activo_fijo",
            fixedAssetSapItemCode: "AF-001",
          },
        ],
      })
    ).resolves.toEqual({
      id: 94,
      requestNumber: "REQ-2026-0094",
      status: "borrador",
    });

    expect(createMaterialRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 1,
      }),
      [
        expect.objectContaining({
          itemName: "Mantenimiento",
          targetType: "activo_fijo",
          subProjectId: null,
          fixedAssetSapItemCode: "AF-001",
          fixedAssetName: "Camión mezclador",
        }),
      ]
    );

    getActiveFixedAssetByCodeSpy.mockRestore();
    createMaterialRequestSpy.mockRestore();
  });

  it("Rejects fixed asset targets that are inactive or not fixed assets", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getActiveFixedAssetByCodeSpy = vi
      .spyOn(db, "getActiveFixedAssetByCode")
      .mockResolvedValue(undefined);
    const createMaterialRequestSpy = vi.spyOn(db, "createMaterialRequest");

    await expect(
      caller.materialRequests.create({
        saveMode: "draft",
        projectId: 1,
        items: [
          {
            itemName: "Mantenimiento",
            quantity: "1",
            unit: "und",
            targetType: "activo_fijo",
            fixedAssetSapItemCode: "MAT-001",
          },
        ],
      })
    ).rejects.toThrow("El activo fijo seleccionado no existe");

    expect(createMaterialRequestSpy).not.toHaveBeenCalled();

    getActiveFixedAssetByCodeSpy.mockRestore();
    createMaterialRequestSpy.mockRestore();
  });

  it("Can submit an existing draft material request", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 44,
          requestNumber: "REQ-2026-0044",
          requestedById: 2,
          projectId: 1,
          status: "borrador",
        },
        items: [],
      } as any);
    const updateMaterialRequestSpy = vi
      .spyOn(db, "updateMaterialRequest")
      .mockResolvedValue({ success: true });
    const replaceRequestItemsSpy = vi
      .spyOn(db, "replaceRequestItems")
      .mockResolvedValue({ success: true });
    const getProjectAdminsSpy = vi
      .spyOn(db, "getUsersByBuildreqRoleAndProject")
      .mockResolvedValue([{ id: 7 }] as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.materialRequests.update({
        id: 44,
        saveMode: "submit",
        projectId: 1,
        requestType: "bienes",
        purchaseUrgency: "no_urgente",
        items: [{ itemName: "Cemento", quantity: "10", unit: "saco" }],
      })
    ).resolves.toEqual({
      id: 44,
      requestNumber: "REQ-2026-0044",
      status: "pendiente_aprobar",
    });

    expect(updateMaterialRequestSpy).toHaveBeenCalledWith(
      44,
      expect.objectContaining({
        status: "pendiente_aprobar",
        projectId: 1,
        approvalStatus: "pendiente",
        workflowStage: "administrador_proyecto",
        recipient: "administrador_proyecto",
      })
    );
    expect(replaceRequestItemsSpy).toHaveBeenCalledWith(44, [
      {
        itemName: "Cemento",
        quantity: "10",
        unit: "saco",
        notes: undefined,
        targetType: null,
        subProjectId: null,
        fixedAssetSapItemCode: null,
        fixedAssetName: null,
        approvalStatus: "pendiente",
        approvedById: null,
        approvedAt: null,
        rejectionReason: null,
      },
    ]);
    expect(getProjectAdminsSpy).toHaveBeenCalledWith(
      "administrador_proyecto",
      1
    );
    expect(createNotificationSpy).toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    updateMaterialRequestSpy.mockRestore();
    replaceRequestItemsSpy.mockRestore();
    getProjectAdminsSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Can clear the request target while editing a draft", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 45,
          requestNumber: "REQ-2026-0045",
          requestedById: 2,
          projectId: 1,
          status: "borrador",
        },
        items: [],
      } as any);
    const updateMaterialRequestSpy = vi
      .spyOn(db, "updateMaterialRequest")
      .mockResolvedValue({ success: true });
    const replaceRequestItemsSpy = vi
      .spyOn(db, "replaceRequestItems")
      .mockResolvedValue({ success: true });

    await expect(
      caller.materialRequests.update({
        id: 45,
        saveMode: "draft",
        projectId: 1,
        requestType: "bienes",
        items: [
          {
            itemName: "Cemento",
            quantity: "10",
            unit: "saco",
            targetType: null,
          },
        ],
      })
    ).resolves.toEqual({
      id: 45,
      requestNumber: "REQ-2026-0045",
      status: "borrador",
    });

    expect(replaceRequestItemsSpy).toHaveBeenCalledWith(45, [
      expect.objectContaining({
        itemName: "Cemento",
        targetType: null,
        subProjectId: null,
        fixedAssetSapItemCode: null,
        fixedAssetName: null,
      }),
    ]);

    getMaterialRequestByIdSpy.mockRestore();
    updateMaterialRequestSpy.mockRestore();
    replaceRequestItemsSpy.mockRestore();
  });

  it("sends submitted goods requests to project administrator authorization", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);
    const createMaterialRequestSpy = vi
      .spyOn(db, "createMaterialRequest")
      .mockResolvedValue({ id: 92, requestNumber: "REQ-2026-0092" });
    const getProjectAdminsSpy = vi
      .spyOn(db, "getUsersByBuildreqRoleAndProject")
      .mockResolvedValue([{ id: 5 }] as any);
    const getAdminCentralUsersSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([{ id: 4 }] as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.materialRequests.create({
        saveMode: "submit",
        projectId: 1,
        requestType: "bienes",
        purchaseUrgency: "no_urgente",
        items: [{ itemName: "Cemento", quantity: "10", unit: "saco" }],
      })
    ).resolves.toEqual({
      id: 92,
      requestNumber: "REQ-2026-0092",
      status: "pendiente_aprobar",
    });

    expect(createMaterialRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedById: 2,
        workflowStage: "administrador_proyecto",
        recipient: "administrador_proyecto",
        approvalStatus: "pendiente",
      }),
      [
        expect.objectContaining({
          itemName: "Cemento",
          approvalStatus: "pendiente",
        }),
      ]
    );
    expect(getProjectAdminsSpy).toHaveBeenCalledWith(
      "administrador_proyecto",
      1
    );
    expect(getAdminCentralUsersSpy).toHaveBeenCalledWith(
      "administracion_central"
    );
    expect(createNotificationSpy).toHaveBeenCalled();

    createMaterialRequestSpy.mockRestore();
    getProjectAdminsSpy.mockRestore();
    getAdminCentralUsersSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Project Administrator can review request items and release the request to bodega", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 55,
          requestNumber: "REQ-2026-0055",
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          status: "pendiente_aprobar",
          approvalStatus: "pendiente",
        },
        items: [
          {
            id: 201,
            itemName: "Cemento",
            approvalStatus: "pendiente",
            assignedFlow: null,
            sapItemCode: null,
            deliveredQuantity: "0.00",
            dispatchedQuantity: "0.00",
          },
        ],
      } as any);
    const reviewMaterialRequestItemsSpy = vi
      .spyOn(db, "reviewMaterialRequestItems")
      .mockResolvedValue({
        pendingCount: 0,
        approvedCount: 1,
        rejectedCount: 0,
        requestStatus: "en_espera",
        approvalStatus: "aprobada",
        workflowStage: "bodega_proyecto",
      } as any);
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([{ id: 3 }] as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.materialRequests.reviewItems({
        requestId: 55,
        itemIds: [201],
        decision: "aprobada",
      })
    ).resolves.toEqual({
      pendingCount: 0,
      approvedCount: 1,
      rejectedCount: 0,
      requestStatus: "en_espera",
      approvalStatus: "aprobada",
      workflowStage: "bodega_proyecto",
    });

    expect(reviewMaterialRequestItemsSpy).toHaveBeenCalledWith({
      requestId: 55,
      itemIds: [201],
      approvalStatus: "aprobada",
      approvedById: 5,
      rejectionReason: undefined,
    });
    expect(getUsersByBuildreqRoleSpy).toHaveBeenCalledWith(
      "jefe_bodega_central"
    );
    expect(createNotificationSpy).toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    reviewMaterialRequestItemsSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Admin Central can review request items and release the request to bodega", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 56,
          requestNumber: "REQ-2026-0056",
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          status: "pendiente_aprobar",
          approvalStatus: "pendiente",
        },
        items: [
          {
            id: 202,
            itemName: "Arena",
            approvalStatus: "pendiente",
            assignedFlow: null,
            sapItemCode: null,
            deliveredQuantity: "0.00",
            dispatchedQuantity: "0.00",
          },
        ],
      } as any);
    const reviewMaterialRequestItemsSpy = vi
      .spyOn(db, "reviewMaterialRequestItems")
      .mockResolvedValue({
        pendingCount: 0,
        approvedCount: 1,
        rejectedCount: 0,
        requestStatus: "en_espera",
        approvalStatus: "aprobada",
        workflowStage: "bodega_proyecto",
      } as any);
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([{ id: 3 }] as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.materialRequests.reviewItems({
        requestId: 56,
        itemIds: [202],
        decision: "aprobada",
      })
    ).resolves.toEqual({
      pendingCount: 0,
      approvedCount: 1,
      rejectedCount: 0,
      requestStatus: "en_espera",
      approvalStatus: "aprobada",
      workflowStage: "bodega_proyecto",
    });

    expect(reviewMaterialRequestItemsSpy).toHaveBeenCalledWith({
      requestId: 56,
      itemIds: [202],
      approvalStatus: "aprobada",
      approvedById: 4,
      rejectionReason: undefined,
    });
    expect(getUsersByBuildreqRoleSpy).toHaveBeenCalledWith(
      "jefe_bodega_central"
    );
    expect(createNotificationSpy).toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    reviewMaterialRequestItemsSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Jefe de Bodega can review request items and release the request to processing", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 58,
          requestNumber: "REQ-2026-0058",
          requestedById: 2,
          projectId: 1,
          requestType: "bienes",
          status: "pendiente_aprobar",
          approvalStatus: "pendiente",
        },
        items: [
          {
            id: 203,
            itemName: "Gasolina",
            approvalStatus: "pendiente",
            assignedFlow: null,
            sapItemCode: null,
            deliveredQuantity: "0.00",
            dispatchedQuantity: "0.00",
          },
        ],
      } as any);
    const reviewMaterialRequestItemsSpy = vi
      .spyOn(db, "reviewMaterialRequestItems")
      .mockResolvedValue({
        pendingCount: 0,
        approvedCount: 1,
        rejectedCount: 0,
        requestStatus: "en_espera",
        approvalStatus: "aprobada",
        workflowStage: "bodega_proyecto",
      } as any);
    const getUsersByBuildreqRoleSpy = vi
      .spyOn(db, "getUsersByBuildreqRole")
      .mockResolvedValue([{ id: 3 }] as any);
    const getUsersByBuildreqRoleAndProjectSpy = vi
      .spyOn(db, "getUsersByBuildreqRoleAndProject")
      .mockResolvedValue([] as any);
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.materialRequests.reviewItems({
        requestId: 58,
        itemIds: [203],
        decision: "aprobada",
      })
    ).resolves.toEqual({
      pendingCount: 0,
      approvedCount: 1,
      rejectedCount: 0,
      requestStatus: "en_espera",
      approvalStatus: "aprobada",
      workflowStage: "bodega_proyecto",
    });

    expect(reviewMaterialRequestItemsSpy).toHaveBeenCalledWith({
      requestId: 58,
      itemIds: [203],
      approvalStatus: "aprobada",
      approvedById: 3,
      rejectionReason: undefined,
    });

    getMaterialRequestByIdSpy.mockRestore();
    reviewMaterialRequestItemsSpy.mockRestore();
    getUsersByBuildreqRoleSpy.mockRestore();
    getUsersByBuildreqRoleAndProjectSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("Admin Central can approve service requests", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 57,
          requestNumber: "REQ-2026-0057",
          requestedById: 2,
          projectId: 1,
          requestType: "servicios",
          status: "pendiente_aprobar",
        },
        items: [],
      } as any);
    const approveMaterialRequestSpy = vi
      .spyOn(db, "approveMaterialRequest")
      .mockResolvedValue({ success: true });
    const createNotificationSpy = vi
      .spyOn(db, "createNotification")
      .mockResolvedValue({ id: 1 } as any);

    await expect(caller.materialRequests.approve({ id: 57 })).resolves.toEqual({
      success: true,
    });

    expect(approveMaterialRequestSpy).toHaveBeenCalledWith(57, 4);
    expect(createNotificationSpy).toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    approveMaterialRequestSpy.mockRestore();
    createNotificationSpy.mockRestore();
  });

  it("blocks SAP translation while a goods request is pending item authorization", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 201,
        requestId: 55,
        approvalStatus: "pendiente",
      } as any);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 55,
          requestType: "bienes",
          approvalStatus: "pendiente",
        },
      } as any);

    await expect(
      caller.requestItems.translateToSap({
        id: 201,
        sapItemCode: "05050200058",
      })
    ).rejects.toThrow(
      "pendiente de autorización del Administrador del Proyecto, Administración Central o Jefe de Bodega"
    );

    getRequestItemByIdSpy.mockRestore();
    getMaterialRequestByIdSpy.mockRestore();
  });

  it("requires a rejection note when rejecting request items", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.reviewItems({
        requestId: 55,
        itemIds: [201],
        decision: "rechazada",
      })
    ).rejects.toThrow("Escriba un motivo de rechazo de al menos 5 caracteres");
  });
});

// ============================================================
// Tests: Supply Flow type validations
// ============================================================
describe("BuildReq - Supply Flow Validations", () => {
  it("Validates payment method for direct purchase", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.createDirectPurchase({
        requestId: 1,
        paymentMethod: "invalid" as any,
      })
    ).rejects.toThrow();
  });

  it("Validates purchase type for purchase request", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.createPurchaseRequest({
        requestId: 1,
        purchaseType: "invalid" as any,
      })
    ).rejects.toThrow();
  });

  it("Validates flow type enum in assignFlow", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.materialRequests.assignFlow({
        requestId: 1,
        flowType: "invalid_flow" as any,
      })
    ).rejects.toThrow();
  });
});

// ============================================================
// Tests: Invitation System
// ============================================================
describe("BuildReq - Invitation System", () => {
  it("Non-admin users cannot create invitations", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.invitations.create({
        email: "nuevo@empresa.com",
        name: "Nuevo Usuario",
        buildreqRole: "ingeniero_residente",
        assignedProjectId: 1,
        origin: "https://buildreq.example.com",
      })
    ).rejects.toThrow();
  });

  it("Non-admin users cannot list invitations", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.invitations.list()).rejects.toThrow();
  });

  it("Non-admin users cannot cancel invitations", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.invitations.cancel({ invitationId: 1 })
    ).rejects.toThrow();
  });

  it("Admin can create invitation with valid data", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);

    // This should not throw validation errors (it may throw DB error in test env)
    try {
      const result = await caller.invitations.create({
        email: "test-invite@empresa.com",
        name: "Invitado Test",
        buildreqRole: "jefe_bodega_central",
        origin: "https://buildreq.example.com",
      });
      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("emailData");
      expect(result.emailData.to).toBe("test-invite@empresa.com");
      expect(result.emailData.subject).toContain("Jefe de Bodega Central");
    } catch (e: any) {
      // DB not available in test env is acceptable
      if (
        !e.message?.includes("DB not available") &&
        !e.message?.includes("database")
      ) {
        throw e;
      }
    }
  });

  it("Admin can create invitation for Contable without a project", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const createInvitationSpy = vi
      .spyOn(db, "createInvitation")
      .mockResolvedValue({ id: 77 } as any);

    await expect(
      caller.invitations.create({
        email: "contable@empresa.com",
        name: "Contable Invitado",
        buildreqRole: "contable",
        origin: "https://buildreq.example.com",
      })
    ).resolves.toMatchObject({
      id: 77,
      emailData: {
        to: "contable@empresa.com",
      },
    });
    expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        buildreqRole: "contable",
        assignedProjectId: null,
      })
    );

    createInvitationSpy.mockRestore();
  });

  it("Admin can create invitation for Superintendente with assigned projects", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const createInvitationSpy = vi
      .spyOn(db, "createInvitation")
      .mockResolvedValue({ id: 78 } as any);
    const getProjectByIdSpy = vi.spyOn(db, "getProjectById").mockImplementation(
      async (projectId: number) =>
        ({
          id: projectId,
          code: `00${projectId}`,
          name: `Proyecto ${projectId}`,
        }) as any
    );

    await expect(
      caller.invitations.create({
        email: "super@empresa.com",
        name: "Super Intendente",
        buildreqRole: "superintendente",
        assignedProjectIds: [1, 2],
        origin: "https://buildreq.example.com",
      })
    ).resolves.toMatchObject({
      id: 78,
      emailData: {
        to: "super@empresa.com",
      },
    });
    expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        buildreqRole: "superintendente",
        assignedProjectId: 1,
        assignedProjectIds: [1, 2],
      })
    );

    createInvitationSpy.mockRestore();
    getProjectByIdSpy.mockRestore();
  });

  it("Admin cannot create Superintendente invitation without projects", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const createInvitationSpy = vi.spyOn(db, "createInvitation");

    await expect(
      caller.invitations.create({
        email: "super@empresa.com",
        name: "Super Intendente",
        buildreqRole: "superintendente",
        origin: "https://buildreq.example.com",
      })
    ).rejects.toThrow("Debe asignar al menos un proyecto a este rol.");
    expect(createInvitationSpy).not.toHaveBeenCalled();

    createInvitationSpy.mockRestore();
  });

  it("Validates email format in invitation", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.invitations.create({
        email: "not-an-email",
        name: "Test",
        buildreqRole: "ingeniero_residente",
        origin: "https://buildreq.example.com",
      })
    ).rejects.toThrow();
  });

  it("Validates name is required in invitation", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.invitations.create({
        email: "valid@email.com",
        name: "",
        buildreqRole: "ingeniero_residente",
        origin: "https://buildreq.example.com",
      })
    ).rejects.toThrow();
  });
});

// ============================================================
// Tests: User Management
// ============================================================
describe("BuildReq - User Management", () => {
  it("Administracion Central can list users", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const users = [
      {
        id: 2,
        openId: "user-002",
        email: "usuario@buildreq.com",
        name: "Usuario Test",
        role: "user",
        buildreqRole: "ingeniero_residente",
      },
    ];
    const listUsersSpy = vi
      .spyOn(db, "listUsers")
      .mockResolvedValue(users as any);

    await expect(caller.userManagement.list()).resolves.toEqual(users);
    expect(listUsersSpy).toHaveBeenCalled();

    listUsersSpy.mockRestore();
  });

  it("Administracion Central can reset user passwords", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const getSupabaseAdminClientSpy = vi
      .spyOn(supabaseAdmin, "getSupabaseAdminClient")
      .mockReturnValue({
        auth: {
          admin: {
            updateUserById,
          },
        },
      } as any);
    const getUserByIdSpy = vi.spyOn(db, "getUserById").mockResolvedValue({
      id: 2,
      openId: "auth-user-002",
      email: "usuario@buildreq.com",
      name: "Usuario Test",
    } as any);
    const updatePasswordChangeSpy = vi
      .spyOn(db, "updateUserPasswordChangeRequirement")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.userManagement.resetPasswordAdmin({
        userId: 2,
        password: "12345678",
      })
    ).resolves.toEqual({ success: true });

    expect(updateUserById).toHaveBeenCalledWith("auth-user-002", {
      password: "12345678",
    });
    expect(updatePasswordChangeSpy).toHaveBeenCalledWith(2, true);

    getSupabaseAdminClientSpy.mockRestore();
    getUserByIdSpy.mockRestore();
    updatePasswordChangeSpy.mockRestore();
  });

  it("Administracion Central cannot assign roles", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateUserRoleSpy = vi.spyOn(db, "updateUserRole");

    await expect(
      caller.userManagement.updateRole({
        userId: 2,
        buildreqRole: "contable",
      })
    ).rejects.toThrow();

    expect(updateUserRoleSpy).not.toHaveBeenCalled();
    updateUserRoleSpy.mockRestore();
  });

  it("Admin can assign Project Administrator with explicit projects", async () => {
    const { ctx } = createUserContext({
      role: "admin",
      assignedProjectId: null,
    });
    const caller = appRouter.createCaller(ctx);
    const updateUserRoleSpy = vi
      .spyOn(db, "updateUserRole")
      .mockResolvedValue({ success: true });

    await expect(
      caller.userManagement.updateRole({
        userId: 2,
        buildreqRole: "administrador_proyecto",
        assignedProjectIds: [1, 2],
      })
    ).resolves.toEqual({ success: true });

    expect(updateUserRoleSpy).toHaveBeenCalledWith(
      2,
      "administrador_proyecto",
      1,
      [1, 2]
    );

    updateUserRoleSpy.mockRestore();
  });

  it("Admin cannot assign required project roles without a project", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const updateUserRoleSpy = vi.spyOn(db, "updateUserRole");

    await expect(
      caller.userManagement.updateRole({
        userId: 2,
        buildreqRole: "ingeniero_residente",
        assignedProjectId: null,
      })
    ).rejects.toThrow("Debe asignar al menos un proyecto a este rol.");

    expect(updateUserRoleSpy).not.toHaveBeenCalled();
    updateUserRoleSpy.mockRestore();
  });

  it("Admin can assign Contable without a project", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const updateUserRoleSpy = vi
      .spyOn(db, "updateUserRole")
      .mockResolvedValue({ success: true });

    await expect(
      caller.userManagement.updateRole({
        userId: 8,
        buildreqRole: "contable",
        assignedProjectId: null,
      })
    ).resolves.toEqual({ success: true });

    expect(updateUserRoleSpy).toHaveBeenCalledWith(8, "contable", null, []);

    updateUserRoleSpy.mockRestore();
  });

  it("Admin can assign Superintendente with multiple projects", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const updateUserRoleSpy = vi
      .spyOn(db, "updateUserRole")
      .mockResolvedValue({ success: true });

    await expect(
      caller.userManagement.updateRole({
        userId: 9,
        buildreqRole: "superintendente",
        assignedProjectIds: [1, 2],
      })
    ).resolves.toEqual({ success: true });

    expect(updateUserRoleSpy).toHaveBeenCalledWith(
      9,
      "superintendente",
      1,
      [1, 2]
    );

    updateUserRoleSpy.mockRestore();
  });

  it("Admin cannot assign Superintendente without projects", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);
    const updateUserRoleSpy = vi.spyOn(db, "updateUserRole");

    await expect(
      caller.userManagement.updateRole({
        userId: 9,
        buildreqRole: "superintendente",
      })
    ).rejects.toThrow("Debe asignar al menos un proyecto a este rol.");
    expect(updateUserRoleSpy).not.toHaveBeenCalled();

    updateUserRoleSpy.mockRestore();
  });

  it("plans automatic warehouse access for Project Administrators", () => {
    expect(
      db.calculateProjectScopedWarehouseAssignmentChanges({
        buildreqRole: "administrador_proyecto",
        projectWarehouseIds: [101, 102, 101],
        existingAssignments: [],
      })
    ).toEqual({
      warehouseIdsToInsert: [101, 102],
      assignmentIdsToDelete: [],
    });
  });

  it("removes only stale automatic warehouse access when project scope changes", () => {
    expect(
      db.calculateProjectScopedWarehouseAssignmentChanges({
        buildreqRole: "administrador_proyecto",
        projectWarehouseIds: [102, 103],
        existingAssignments: [
          {
            id: 1,
            warehouseId: 101,
            assignmentSource: "project_scope",
            isResponsible: false,
          },
          {
            id: 2,
            warehouseId: 102,
            assignmentSource: "project_scope",
            isResponsible: false,
          },
        ],
      })
    ).toEqual({
      warehouseIdsToInsert: [103],
      assignmentIdsToDelete: [1],
    });
  });

  it("preserves manual and responsible warehouse access during automatic sync", () => {
    expect(
      db.calculateProjectScopedWarehouseAssignmentChanges({
        buildreqRole: "administrador_proyecto",
        projectWarehouseIds: [],
        existingAssignments: [
          {
            id: 1,
            warehouseId: 101,
            assignmentSource: "manual",
            isResponsible: false,
          },
          {
            id: 2,
            warehouseId: 102,
            assignmentSource: "project_scope",
            isResponsible: true,
          },
          {
            id: 3,
            warehouseId: 103,
            assignmentSource: "project_scope",
            isResponsible: false,
          },
        ],
      })
    ).toEqual({
      warehouseIdsToInsert: [],
      assignmentIdsToDelete: [3],
    });
  });

  it("plans automatic warehouse access for Project Warehouse users", () => {
    expect(
      db.calculateProjectScopedWarehouseAssignmentChanges({
        buildreqRole: "bodeguero_proyecto",
        projectWarehouseIds: [201],
        existingAssignments: [],
      })
    ).toEqual({
      warehouseIdsToInsert: [201],
      assignmentIdsToDelete: [],
    });
  });

  it("does not create automatic warehouse access for other project roles", () => {
    for (const buildreqRole of [
      "ingeniero_residente",
      "superintendente",
      "contable",
    ]) {
      expect(
        db.calculateProjectScopedWarehouseAssignmentChanges({
          buildreqRole,
          projectWarehouseIds: [301],
          existingAssignments: [],
        })
      ).toEqual({
        warehouseIdsToInsert: [],
        assignmentIdsToDelete: [],
      });
    }
  });
});

// ============================================================
// Tests: Purchase Requests
// ============================================================
describe("BuildReq - Purchase Requests", () => {
  it("can update purchase request item quantities and prices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 33,
          projectId: 1,
          status: "pendiente",
          purchaseType: "local",
        },
        items: [
          {
            id: 501,
            itemName: "CEMENTO GRANEL",
            quantity: "10.00",
            receivedQuantity: "2.00",
            unitPrice: "0.00",
            sourceProject: { id: 1 },
          },
        ],
      } as any);
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const updatePurchaseRequestItemSpy = vi
      .spyOn(db, "updatePurchaseRequestItem")
      .mockResolvedValue({ success: true } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("pendiente" as any);

    await expect(
      caller.purchaseRequests.update({
        id: 33,
        purchaseType: "local",
        neededBy: "2026-05-20",
        notes: "Cotización revisada",
        items: [{ id: 501, quantity: "12.00", unitPrice: "125.50" }],
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseRequestSpy).toHaveBeenCalledWith(
      33,
      expect.objectContaining({
        purchaseType: "local",
        neededBy: expect.any(Date),
        notes: "Cotización revisada",
      })
    );
    expect(updatePurchaseRequestItemSpy).toHaveBeenCalledWith(501, {
      quantity: "12.00",
      unitPrice: "125.50",
    });
    expect(syncPurchaseRequestConversionStatusSpy).toHaveBeenCalledWith(33);

    getPurchaseRequestByIdSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    updatePurchaseRequestItemSpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("allows only project or central admins to change purchase request item destination", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 36,
          projectId: 1,
          status: "pendiente",
          purchaseType: "local",
        },
        items: [
          {
            id: 504,
            itemName: "ARENA",
            quantity: "12.00",
            receivedQuantity: "0.00",
            convertedQuantity: "0.00",
            unitPrice: "0.00",
            sourceProject: { id: 1 },
          },
        ],
      } as any);
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const updatePurchaseRequestItemSpy = vi
      .spyOn(db, "updatePurchaseRequestItem")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseRequests.update({
        id: 36,
        items: [
          {
            id: 504,
            quantity: "12.00",
            targetType: "subproyecto",
            subProjectId: 10,
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Solo el Administrador del Proyecto o Administración Central puede cambiar el destino",
    });

    expect(updatePurchaseRequestSpy).not.toHaveBeenCalled();
    expect(updatePurchaseRequestItemSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    updatePurchaseRequestItemSpy.mockRestore();
  });

  it("does not allow reducing a purchase request item below the received quantity", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 34,
          projectId: 1,
          status: "pendiente",
          purchaseType: "local",
        },
        items: [
          {
            id: 502,
            itemName: "BLOQUE",
            quantity: "20.00",
            receivedQuantity: "8.00",
            unitPrice: "10.00",
            sourceProject: { id: 1 },
          },
        ],
      } as any);
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const updatePurchaseRequestItemSpy = vi
      .spyOn(db, "updatePurchaseRequestItem")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseRequests.update({
        id: 34,
        items: [{ id: 502, quantity: "7.00", unitPrice: "10.00" }],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La cantidad no puede ser menor a lo ya recibido",
    });

    expect(updatePurchaseRequestSpy).not.toHaveBeenCalled();
    expect(updatePurchaseRequestItemSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    updatePurchaseRequestItemSpy.mockRestore();
  });

  it("does not allow reducing a purchase request item below the converted quantity", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 35,
          projectId: 1,
          status: "parcialmente_convertida",
          purchaseType: "local",
        },
        items: [
          {
            id: 503,
            itemName: "CEMENTO",
            quantity: "200.00",
            convertedQuantity: "100.00",
            receivedQuantity: "0.00",
            unitPrice: "100.00",
            sourceProject: { id: 1 },
          },
        ],
      } as any);
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const updatePurchaseRequestItemSpy = vi
      .spyOn(db, "updatePurchaseRequestItem")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseRequests.update({
        id: 35,
        items: [{ id: 503, quantity: "99.00", unitPrice: "100.00" }],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La cantidad no puede ser menor a lo ya convertido a OC",
    });

    expect(updatePurchaseRequestSpy).not.toHaveBeenCalled();
    expect(updatePurchaseRequestItemSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    updatePurchaseRequestItemSpy.mockRestore();
  });
});

// ============================================================
// Tests: Purchase Orders
// ============================================================
describe("BuildReq - Purchase Orders", () => {
  it("createFromPurchaseRequest requires contract scheduling fields", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const createPurchaseOrderSpy = vi.spyOn(db, "createPurchaseOrder");

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 72,
        appliesContract: true,
        itemsToConvert: [
          {
            purchaseRequestItemId: 7201,
            quantity: "100.00",
            unitPrice: "125.50",
          },
        ],
      })
    ).rejects.toThrow("Seleccione la frecuencia de pago del contrato");

    expect(createPurchaseOrderSpy).not.toHaveBeenCalled();
    createPurchaseOrderSpy.mockRestore();
  });

  it("createFromPurchaseRequest stores contract terms on the generated OC", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 72,
          projectId: 3,
          requestNumber: "SC-2026-0072",
          purchaseType: "local",
          neededBy: new Date("2026-05-20"),
          notes: "Contrato mensual",
        },
        items: [
          {
            id: 7201,
            itemName: "SERVICIO MENSUAL",
            quantity: "12.00",
            convertedQuantity: "0.00",
            pendingConversionQuantity: "12.00",
            receivedQuantity: "0.00",
            unit: "mes",
            unitPrice: "1000.00",
          },
        ],
      } as any);
    const listDirectPurchaseFlowItemsByOrderSpy = vi
      .spyOn(db, "listDirectPurchaseFlowItemsByOrder")
      .mockResolvedValue([] as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValue({ id: 1701, orderNumber: "OC-2026-0170" });
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 72 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("convertida" as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 72,
        appliesContract: true,
        contractPaymentFrequency: "mensual",
        contractFirstPaymentDate: "2026-01-01",
        contractEndDate: "2026-12-31",
        itemsToConvert: [
          {
            purchaseRequestItemId: 7201,
            quantity: "12.00",
            unitPrice: "1000.00",
          },
        ],
      })
    ).resolves.toEqual({
      success: true,
      purchaseOrderId: 1701,
      purchaseOrderNumber: "OC-2026-0170",
    });

    expect(createPurchaseOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        appliesContract: true,
        contractPaymentFrequency: "mensual",
        contractFirstPaymentDate: expect.any(Date),
        contractEndDate: expect.any(Date),
        contractExpiryNotifiedAt: null,
      }),
      [expect.objectContaining({ purchaseRequestItemId: 7201 })]
    );

    getPurchaseRequestByIdSpy.mockRestore();
    listDirectPurchaseFlowItemsByOrderSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("updates an emitted contract line price and writes audit log", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 15,
          purchaseOrderId: 4,
          unitPrice: "100.00",
        } as any,
        purchaseOrder: {
          id: 4,
          projectId: 1,
          status: "emitida",
          appliesContract: true,
        } as any,
      });
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const createPurchaseOrderAuditLogSpy = vi
      .spyOn(db, "createPurchaseOrderAuditLog")
      .mockResolvedValue({ id: 1 } as any);

    await expect(
      caller.purchaseOrders.updateContractItemPrice({
        purchaseOrderItemId: 15,
        unitPrice: "125.50",
        note: "Ajuste aprobado",
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(15, {
      unitPrice: "125.50",
    });
    expect(createPurchaseOrderAuditLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseOrderId: 4,
        purchaseOrderItemId: 15,
        action: "actualizar_precio_contrato",
        field: "unitPrice",
        oldValue: "100.00",
        newValue: "125.50",
        changedById: 4,
        note: "Ajuste aprobado",
      })
    );

    getPurchaseOrderItemSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
    createPurchaseOrderAuditLogSpy.mockRestore();
  });

  it("allows changing only the end date on an emitted contract OC", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          projectId: 1,
          status: "emitida",
          appliesContract: true,
          contractPaymentFrequency: "mensual",
          contractFirstPaymentDate: new Date("2026-01-01T12:00:00"),
          contractEndDate: new Date("2026-12-31T12:00:00"),
        },
        items: [],
      } as any);
    const updatePurchaseOrderContractTermsSpy = vi
      .spyOn(db, "updatePurchaseOrderContractTerms")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseOrders.updateContractTerms({
        id: 4,
        appliesContract: true,
        contractPaymentFrequency: "mensual",
        contractFirstPaymentDate: "2026-01-01",
        contractEndDate: "2027-01-31",
        contractNote: "Prórroga aprobada",
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseOrderContractTermsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseOrderId: 4,
        changedById: 4,
        appliesContract: true,
        contractPaymentFrequency: "mensual",
        contractFirstPaymentDate: expect.any(Date),
        contractEndDate: expect.any(Date),
        note: "Prórroga aprobada",
      })
    );

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderContractTermsSpy.mockRestore();
  });

  it("Admin Central can update pricing and tax code for a PO item", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4 } as any,
        purchaseOrder: { id: 4, projectId: 1 } as any,
      });
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.updateItemPricing({
        purchaseOrderItemId: 15,
        unitPrice: "125.50",
        taxCode: "isv_15",
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(
      15,
      expect.objectContaining({
        unitPrice: "125.50",
        taxCode: "isv_15",
        additionalTaxCodes: [],
        taxBreakdown: [
          expect.objectContaining({ taxCode: "isv_15", ratePercent: 15 }),
        ],
      })
    );

    getPurchaseOrderItemSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
  });

  it("Admin Central can update quantity, pricing and tax code for a PO item line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4, receivedQuantity: "10.00" } as any,
        purchaseOrder: { id: 4, projectId: 1 } as any,
      });
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.updateItemLine({
        purchaseOrderItemId: 15,
        quantity: "125.00",
        unitPrice: "125.50",
        taxCode: "isv_15",
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(
      15,
      expect.objectContaining({
        quantity: "125.00",
        unitPrice: "125.50",
        taxCode: "isv_15",
        additionalTaxCodes: [],
        taxBreakdown: [
          expect.objectContaining({
            taxCode: "isv_15",
            amount: 2353.125,
          }),
        ],
      })
    );

    getPurchaseOrderItemSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can save a fixed asset draft line", async () => {
    const { ctx } = createProjectBodegueroContext({ assignedProjectId: 1 });
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4 } as any,
        purchaseOrder: { id: 4, projectId: 1, status: "emitida" } as any,
      });
    const savePurchaseOrderFixedAssetDraftLineSpy = vi
      .spyOn(db, "savePurchaseOrderFixedAssetDraftLine")
      .mockResolvedValue({
        article: {
          id: 80,
          itemCode: "OC-006-0001",
          temporaryItemCode: "OC-006-0001",
          tipoArticulo: 3,
          fixedAssetStatus: "pendiente",
        },
        item: {
          id: 15,
          isFixedAsset: true,
          currentSapItemCode: "OC-006-0001",
        },
      } as any);

    await expect(
      caller.purchaseOrders.saveFixedAssetDraftLine({
        purchaseOrderItemId: 15,
        isLeasing: true,
        lineObservation: "Equipo asignado a gerencia",
        assetDetail: {
          serialNumber: "SN-001",
          condition: "nuevo",
          color: "Negro",
          model: "OptiPlex",
          brand: "Dell",
          chassisSeries: "",
          motorSeries: "",
          plateOrCode: "PLACA-001",
        },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        article: expect.objectContaining({
          temporaryItemCode: "OC-006-0001",
          fixedAssetStatus: "pendiente",
        }),
      })
    );

    expect(savePurchaseOrderFixedAssetDraftLineSpy).toHaveBeenCalledWith({
      purchaseOrderItemId: 15,
      isLeasing: true,
      lineObservation: "Equipo asignado a gerencia",
      assetDetail: expect.objectContaining({
        serialNumber: "SN-001",
        condition: "nuevo",
      }),
    });

    getPurchaseOrderItemSpy.mockRestore();
    savePurchaseOrderFixedAssetDraftLineSpy.mockRestore();
  });

  it("adjusts converted SC quantity when editing a draft PO line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 15,
          purchaseOrderId: 4,
          purchaseRequestItemId: 503,
          quantity: "100.00",
          receivedQuantity: "0.00",
        } as any,
        purchaseOrder: { id: 4, projectId: 1, status: "borrador" } as any,
      });
    const getPurchaseRequestItemSpy = vi
      .spyOn(db, "getPurchaseRequestItemById")
      .mockResolvedValue({
        id: 503,
        purchaseRequestId: 35,
        quantity: "200.00",
        convertedQuantity: "100.00",
      } as any);
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 35 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("parcialmente_convertida" as any);

    await expect(
      caller.purchaseOrders.updateItemLine({
        purchaseOrderItemId: 15,
        quantity: "80.00",
        unitPrice: "125.50",
        taxCode: "exe",
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(
      15,
      expect.objectContaining({
        quantity: "80.00",
        unitPrice: "125.50",
        taxCode: "exe",
        additionalTaxCodes: [],
        taxBreakdown: [],
      })
    );
    expect(adjustPurchaseRequestItemConvertedQuantitySpy).toHaveBeenCalledWith(
      503,
      -20
    );
    expect(syncPurchaseRequestConversionStatusSpy).toHaveBeenCalledWith(35);

    getPurchaseOrderItemSpy.mockRestore();
    getPurchaseRequestItemSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("does not allow reducing quantity below received quantity", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4, receivedQuantity: "10.00" } as any,
        purchaseOrder: { id: 4, projectId: 1 } as any,
      });

    await expect(
      caller.purchaseOrders.updateItemLine({
        purchaseOrderItemId: 15,
        quantity: "9.00",
        unitPrice: "125.50",
        taxCode: "exe",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La cantidad no puede ser menor a lo ya recibido",
    });

    getPurchaseOrderItemSpy.mockRestore();
  });

  it("does not allow editing a received purchase order line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4, receivedQuantity: "100.00" } as any,
        purchaseOrder: { id: 4, projectId: 1, status: "recibida" } as any,
      });

    await expect(
      caller.purchaseOrders.updateItemLine({
        purchaseOrderItemId: 15,
        quantity: "125.00",
        unitPrice: "125.50",
        taxCode: "isv_15",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue recibida y solo está disponible en modo lectura",
    });

    getPurchaseOrderItemSpy.mockRestore();
  });

  it("does not allow editing an emitted purchase order line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4, receivedQuantity: "0.00" } as any,
        purchaseOrder: { id: 4, projectId: 1, status: "emitida" } as any,
      });
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.updateItemLine({
        purchaseOrderItemId: 15,
        quantity: "125.00",
        unitPrice: "125.50",
        taxCode: "isv_15",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue emitida y no permite editar lineas ni proveedor",
    });

    expect(updatePurchaseOrderItemSpy).not.toHaveBeenCalled();

    getPurchaseOrderItemSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
  });

  it("Admin Central can delete a PO item line when there are other lines and no receipts", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 15,
          purchaseOrderId: 4,
          materialRequestItemId: 21,
          receivedQuantity: "0.00",
        } as any,
        purchaseOrder: { id: 4, projectId: 1 } as any,
      });
    const countPurchaseOrderItemsSpy = vi
      .spyOn(db, "countPurchaseOrderItems")
      .mockResolvedValue(2);
    const deletePurchaseOrderItemSpy = vi
      .spyOn(db, "deletePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockResolvedValue({
        id: 21,
        requestId: 9,
        assignedFlow: "compra_directa",
      } as any);
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true });
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue({ id: 88 } as any);
    const updateSupplyFlowRecordSpy = vi
      .spyOn(db, "updateSupplyFlowRecord")
      .mockResolvedValue({ success: true });
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([{ id: 21, assignedFlow: null }] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true });
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.deleteItem({
        purchaseOrderItemId: 15,
      })
    ).resolves.toEqual({ success: true, orderCancelled: false });

    expect(deletePurchaseOrderItemSpy).toHaveBeenCalledWith(15);
    expect(updateRequestItemSpy).toHaveBeenCalledWith(21, {
      assignedFlow: null,
      status: "pendiente",
    });
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(88, {
      status: "cancelado",
      notes: "Flujo cancelado por eliminar la linea de la orden de compra",
    });
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      9,
      "en_espera",
      4
    );

    getPurchaseOrderItemSpy.mockRestore();
    countPurchaseOrderItemsSpy.mockRestore();
    deletePurchaseOrderItemSpy.mockRestore();
    getRequestItemByIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("deleting the last PO item line annuls the order", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4, receivedQuantity: "0.00" } as any,
        purchaseOrder: { id: 4, projectId: 1 } as any,
      });
    const countPurchaseOrderItemsSpy = vi
      .spyOn(db, "countPurchaseOrderItems")
      .mockResolvedValue(1);
    const deletePurchaseOrderItemSpy = vi
      .spyOn(db, "deletePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.deleteItem({
        purchaseOrderItemId: 15,
      })
    ).resolves.toEqual({ success: true, orderCancelled: true });

    expect(deletePurchaseOrderItemSpy).toHaveBeenCalledWith(15);
    expect(updatePurchaseOrderSpy).toHaveBeenCalledWith(4, {
      status: "anulada",
      emailStatus: "pendiente",
      emailedAt: null,
      emailError: "Orden anulada por eliminar su ultima linea",
    });

    getPurchaseOrderItemSpy.mockRestore();
    countPurchaseOrderItemsSpy.mockRestore();
    deletePurchaseOrderItemSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("does not allow deleting a PO item line from an emitted order", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: { id: 15, purchaseOrderId: 4, receivedQuantity: "0.00" } as any,
        purchaseOrder: { id: 4, projectId: 1, status: "emitida" } as any,
      });
    const deletePurchaseOrderItemSpy = vi
      .spyOn(db, "deletePurchaseOrderItem")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.deleteItem({
        purchaseOrderItemId: 15,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "La orden de compra ya fue emitida y no permite editar lineas ni proveedor",
    });

    expect(deletePurchaseOrderItemSpy).not.toHaveBeenCalled();

    getPurchaseOrderItemSpy.mockRestore();
    deletePurchaseOrderItemSpy.mockRestore();
  });

  it("cancelOrder annuls the PO and releases direct purchase items back to the request", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          { id: 15, materialRequestItemId: 21, receivedQuantity: "0.00" },
          { id: 16, materialRequestItemId: 22, receivedQuantity: "0.00" },
        ],
      } as any);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockImplementation(
        async (id: number) =>
          ({
            21: { id: 21, requestId: 9, assignedFlow: "compra_directa" },
            22: { id: 22, requestId: 9, assignedFlow: "compra_directa" },
          })[id] as any
      );
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true });
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockImplementation(
        async ({ requestItemId }: { requestItemId: number }) =>
          ({ id: requestItemId + 100 }) as any
      );
    const updateSupplyFlowRecordSpy = vi
      .spyOn(db, "updateSupplyFlowRecord")
      .mockResolvedValue({ success: true });
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([
        { id: 21, assignedFlow: null },
        { id: 22, assignedFlow: null },
      ] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true });
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.cancelOrder({
        id: 4,
      })
    ).resolves.toEqual({ success: true });

    expect(updateRequestItemSpy).toHaveBeenCalledWith(21, {
      assignedFlow: null,
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(22, {
      assignedFlow: null,
      status: "pendiente",
    });
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(121, {
      status: "cancelado",
      notes: "Flujo cancelado por anular la orden OC-2026-0005",
    });
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(122, {
      status: "cancelado",
      notes: "Flujo cancelado por anular la orden OC-2026-0005",
    });
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      9,
      "en_espera",
      4
    );
    expect(updatePurchaseOrderSpy).toHaveBeenCalledWith(4, {
      status: "anulada",
      emailStatus: "pendiente",
      emailedAt: null,
      emailError: "Orden anulada manualmente",
    });

    getPurchaseOrderByIdSpy.mockRestore();
    getRequestItemByIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("cancelOrder returns draft PO quantities to the source purchase request", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 8,
          orderNumber: "OC-2026-0088",
          projectId: 1,
          status: "borrador",
          classification: "oc",
        },
        items: [
          {
            id: 81,
            materialRequestItemId: null,
            purchaseRequestItemId: 503,
            quantity: "100.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 35 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("pendiente" as any);

    await expect(
      caller.purchaseOrders.cancelOrder({
        id: 8,
      })
    ).resolves.toEqual({ success: true });

    expect(adjustPurchaseRequestItemConvertedQuantitySpy).toHaveBeenCalledWith(
      503,
      -100
    );
    expect(syncPurchaseRequestConversionStatusSpy).toHaveBeenCalledWith(35);
    expect(updatePurchaseOrderSpy).toHaveBeenCalledWith(8, {
      status: "anulada",
      emailStatus: "pendiente",
      emailedAt: null,
      emailError: "Orden anulada manualmente",
    });

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("sendToSupplier emits the PO without emailing the provider", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "borrador",
          supplierId: 7,
        },
        items: [{ id: 15, unitPrice: "125.50", receivedQuantity: "0.00" }],
      } as any);
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });
    const sendPurchaseOrderEmailSpy = vi
      .spyOn(db, "sendPurchaseOrderEmail")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseOrders.sendToSupplier({
        id: 4,
      })
    ).resolves.toEqual({ success: true });

    expect(updatePurchaseOrderSpy).toHaveBeenCalledWith(4, {
      status: "emitida",
      emailStatus: "pendiente",
      emailedAt: null,
      emailError: null,
    });
    expect(sendPurchaseOrderEmailSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
    sendPurchaseOrderEmailSpy.mockRestore();
  });

  it("does not allow emitting a PO without supplier", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "borrador",
          supplierId: null,
        },
        items: [{ id: 15, unitPrice: "125.50", receivedQuantity: "0.00" }],
      } as any);
    const updatePurchaseOrderSpy = vi.spyOn(db, "updatePurchaseOrder");

    await expect(
      caller.purchaseOrders.sendToSupplier({
        id: 4,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Seleccione un proveedor antes de emitir la OC",
    });
    expect(updatePurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("does not allow emitting a PO with zero unit prices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "borrador",
          supplierId: 7,
        },
        items: [{ id: 15, unitPrice: "0.00", receivedQuantity: "0.00" }],
      } as any);
    const updatePurchaseOrderSpy = vi.spyOn(db, "updatePurchaseOrder");

    await expect(
      caller.purchaseOrders.sendToSupplier({
        id: 4,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Ingrese un precio unitario mayor que cero antes de emitir la OC",
    });
    expect(updatePurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("does not allow emitting an already emitted PO", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [{ id: 15, receivedQuantity: "0.00" }],
      } as any);
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.sendToSupplier({
        id: 4,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La orden de compra ya fue emitida",
    });

    expect(updatePurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("does not allow emitting a PO that already has receptions", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "recibida",
        },
        items: [{ id: 15, receivedQuantity: "10.00" }],
      } as any);
    const updatePurchaseOrderSpy = vi
      .spyOn(db, "updatePurchaseOrder")
      .mockResolvedValue({ success: true });

    await expect(
      caller.purchaseOrders.sendToSupplier({
        id: 4,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "No se puede emitir una orden que ya tiene recepciones registradas",
    });

    expect(updatePurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    updatePurchaseOrderSpy.mockRestore();
  });

  it("adds the BORRADOR watermark only when the procurement PDF is still a draft", () => {
    const draftPdf = buildProcurementPdfBase64({
      title: "Orden de Compra",
      documentNumber: "OC-2026-0002",
      badgeText: "OC",
      primaryFields: [
        { label: "Proyecto", value: "004 - CA5" },
        { label: "Proveedor", value: "Proveedor pendiente" },
      ],
      secondaryFields: [
        { label: "Clasificación", value: "OC" },
        { label: "Fecha necesaria", value: "18/04/2026" },
        { label: "Generado", value: "15/04/2026" },
      ],
      items: [
        {
          description: "ACEITE HTF UNIVERSAL",
          quantityLabel: "10 und",
          amountLabel: "L 0.00",
        },
      ],
      generatedLabel: "15/04/2026",
      footerNote: "Documento generado en borrador por BuildReq.",
      watermarkText: "BORRADOR",
    });

    const emittedPdf = buildProcurementPdfBase64({
      title: "Orden de Compra",
      documentNumber: "OC-2026-0002",
      badgeText: "OC",
      primaryFields: [
        { label: "Proyecto", value: "004 - CA5" },
        { label: "Proveedor", value: "Proveedor pendiente" },
      ],
      secondaryFields: [
        { label: "Clasificación", value: "OC" },
        { label: "Fecha necesaria", value: "18/04/2026" },
        { label: "Generado", value: "15/04/2026" },
      ],
      items: [
        {
          description: "ACEITE HTF UNIVERSAL",
          quantityLabel: "10 und",
          amountLabel: "L 0.00",
        },
      ],
      generatedLabel: "15/04/2026",
      footerNote: "Orden emitida automáticamente por BuildReq.",
    });

    const draftPdfText = Buffer.from(draftPdf, "base64").toString("latin1");
    const emittedPdfText = Buffer.from(emittedPdf, "base64").toString("latin1");
    const encodedWatermark = Buffer.from("BORRADOR", "latin1")
      .toString("hex")
      .toUpperCase();

    expect(draftPdfText).toContain(`<${encodedWatermark}> Tj`);
    expect(draftPdfText).toContain("/Subtype /Image");
    expect(draftPdfText).toContain("/HehLogo Do");
    expect(emittedPdfText).not.toContain(`<${encodedWatermark}> Tj`);
    expect(emittedPdfText).toContain("/Subtype /Image");
    expect(emittedPdfText).toContain("/HehLogo Do");
  });

  it("prints the preferred supplier contact as the purchase order sales advisor", () => {
    const salesAdvisorLabel = "ANA JOAQUINA MUNOZ";
    const pdf = buildPurchaseOrderPrintPdfBase64({
      orderNumber: "CD-006-00000006",
      orderId: "88",
      projectLabel: "006 CA5 - MANTENIMIENTO PERIODICO",
      supplierLabel: "LARACH Y CIA S DE RL DE CV",
      createdDateLabel: "26/05/2026",
      destinationLabel: "CA5 - MANTENIMIENTO PERIODICO",
      deliveryDateLabel: "31/05/2026",
      requestedByLabel: "Edwin Barahona",
      salesAdvisorLabel,
      observations: "Compra directa por Linea de credito",
      quoteLabel: "-",
      items: [
        {
          itemNumber: "1",
          description: "MASCARILLA MEDIA CARA GASES DOBLE FILTRO",
          partNumber: "05050100046",
          quantityLabel: "30",
          unitPriceLabel: "450.00",
          subtotalLabel: "13,500.00",
        },
      ],
      summaryRows: [
        { label: "Subtotal", value: "13,500.00" },
        { label: "ISV 15%", value: "2,025.00" },
        { label: "Total", value: "15,525.00", emphasized: true },
        { label: "(-) Ret. ISV", value: "0.00" },
        { label: "(-) Ret. ISR y Hon.", value: "0.00" },
        { label: "Neto Pagar", value: "15,525.00", emphasized: true },
      ],
    });

    const pdfText = Buffer.from(pdf, "base64").toString("latin1");
    const encodedSalesAdvisor = Buffer.from(salesAdvisorLabel, "latin1")
      .toString("hex")
      .toUpperCase();

    expect(pdfText).toContain(`<${encodedSalesAdvisor}> Tj`);
    expect(pdfText).toContain("/Subtype /Image");
  });
});

// ============================================================
// Tests: Receipts
// ============================================================
describe("BuildReq - Receipts", () => {
  beforeEach(() => {
    vi.spyOn(db, "listProjectWarehouses").mockResolvedValue([
      DEFAULT_PROJECT_WAREHOUSE,
    ] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves or updates a purchase order receipt draft", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantity: "1.00",
            receivedQuantity: "0.00",
            targetType: "activo_fijo",
            fixedAssetSapItemCode: "AF-001",
            fixedAssetName: "Equipo administración",
          },
        ],
      } as any);
    const saveReceiptDraftSpy = vi
      .spyOn(db, "saveReceiptDraft")
      .mockResolvedValue({
        id: 9,
        receiptNumber: "RC-006-0001",
        status: "borrador",
        updated: false,
      } as any);

    await expect(
      caller.receipts.saveDraft({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        isFiscalDocument: true,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantityExpected: "1.00",
            quantityReceived: "1",
            unit: "und",
            unitPrice: "1000.00",
            notes: "Activo temporal",
            targetType: "activo_fijo",
            fixedAssetSapItemCode: "AF-001",
            fixedAssetName: "Equipo administración",
            isFixedAsset: true,
            isLeasing: true,
            assetDetails: [
              {
                serialNumber: "SN-001",
                condition: "nuevo",
                color: "Negro",
              },
            ],
          },
        ],
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "borrador",
        receiptNumber: "RC-006-0001",
      })
    );

    expect(saveReceiptDraftSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        receivedById: 6,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 15,
          targetType: "activo_fijo",
          fixedAssetSapItemCode: "AF-001",
          fixedAssetName: "Equipo administración",
          isFixedAsset: true,
          isLeasing: true,
          assetDetails: [
            expect.objectContaining({
              serialNumber: "SN-001",
              condition: "nuevo",
            }),
          ],
        }),
      ])
    );

    getPurchaseOrderByIdSpy.mockRestore();
    saveReceiptDraftSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can register purchase order receipts for their project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "100.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const getProjectSubprojectByIdSpy = vi
      .spyOn(db, "getProjectSubprojectById")
      .mockResolvedValue({
        id: 77,
        projectId: 1,
        code: "SP-001",
        name: "Subproyecto Oeste",
        isActive: true,
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: "338827 15203e A419E0 63BE03 0909A6 53",
        invoiceNumber: "000 001 01 00010571",
        documentRangeStart: "000 001 01 00000001",
        documentRangeEnd: "000 001 01 99999999",
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
            targetType: "subproyecto",
            subProjectId: 77,
          },
        ],
      })
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "completa",
    });

    expect(registerReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        receivedById: 6,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 15,
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          quantityReceived: "100.00",
          targetType: "subproyecto",
          subProjectId: 77,
          fixedAssetSapItemCode: null,
        }),
      ])
    );

    getPurchaseOrderByIdSpy.mockRestore();
    getProjectSubprojectByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows receiving purchase order services without warehouse inventory entry", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "MANTENIMIENTO PREVENTIVO DE VEHÍCULOS",
            quantity: "1.00",
            receivedQuantity: "0.00",
            unit: "und",
            currentSapItemCode: "100000005",
            catalogItem: {
              itemCode: "100000005",
              description: "MANTENIMIENTO PREVENTIVO DE VEHÍCULOS",
              tipoArticulo: 2,
            },
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "MANTENIMIENTO PREVENTIVO DE VEHÍCULOS",
            quantityExpected: "1.00",
            quantityReceived: "1.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "completa",
    });

    const receiptItems = registerReceiptSpy.mock.calls[0]?.[1] as any[];
    expect(receiptItems[0]).toEqual(
      expect.objectContaining({
        sourceItemId: 15,
        sapItemCode: "100000005",
        quantityReceived: "1.00",
      })
    );
    expect(receiptItems[0].warehouseId).toBeUndefined();

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("uses receipt line taxes and totals when registering purchase order receipts", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "10.00",
            receivedQuantity: "0.00",
            unitPrice: "100.00",
            taxCode: "exe",
            additionalTaxCodes: [],
            taxBreakdown: [],
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "parcial",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "10.00",
            quantityReceived: "3.00",
            unit: "und",
            unitPrice: "10.1234",
            taxCode: "isv_15",
          },
        ],
        otherCharges: [
          {
            concept: "Flete",
            amount: "125.1234",
          },
        ],
      })
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "parcial",
    });

    const receiptItems = registerReceiptSpy.mock.calls[0]?.[1] as any[];
    expect(receiptItems[0]).toEqual(
      expect.objectContaining({
        taxCode: "isv_15",
        additionalTaxCodes: [],
        subtotal: "30.3702",
        taxAmount: "4.5555",
        total: "34.9257",
      })
    );
    expect(receiptItems[0].taxBreakdown).toEqual([
      expect.objectContaining({
        taxCode: "isv_15",
        amount: 4.5555,
        baseAmount: 30.3702,
      }),
    ]);
    expect(registerReceiptSpy.mock.calls[0]?.[2]).toEqual([
      {
        concept: "Flete",
        amount: "125.1234",
      },
    ]);

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("rejects invalid receipt line tax codes", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "10.00",
            receivedQuantity: "0.00",
            unitPrice: "100.00",
            taxCode: "exe",
            additionalTaxCodes: [],
          },
        ],
      } as any);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "10.00",
            quantityReceived: "2.00",
            unit: "und",
            unitPrice: "100.00",
            taxCode: "no_existe",
          },
        ],
      })
    ).rejects.toThrow("Seleccione un impuesto válido");
    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows receiving more than the pending purchase order quantity", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "10.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "10.00",
            quantityReceived: "12.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "completa",
    });

    expect(registerReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 15,
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          quantityExpected: "10.00",
          quantityReceived: "12.00",
        }),
      ])
    );

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("stores fixed asset details and line notes on receipt items", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantity: "1.00",
            receivedQuantity: "0.00",
            isFixedAsset: true,
            isLeasing: true,
            fixedAssetArticleId: 80,
            fixedAssetStatus: "resuelto",
            lineObservation: "Equipo recibido con caja sellada",
            assetDetails: [
              {
                serialNumber: "SN-001",
                condition: "nuevo",
                color: "Negro",
                model: "OptiPlex",
                brand: "Dell",
                chassisSeries: "CH-001",
                motorSeries: "",
                plateOrCode: "PLACA-001",
              },
            ],
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "completa",
      } as any);
    const getActiveFixedAssetByCodeSpy = vi
      .spyOn(db, "getActiveFixedAssetByCode")
      .mockResolvedValue({
        itemCode: "AF-001",
        description: "Equipo administración",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "COMPUTADORA ESCRITORIO",
            quantityExpected: "1.00",
            quantityReceived: "1",
            unit: "und",
            notes: "Esta nota se reemplaza por la observación de la línea OC",
            targetType: "activo_fijo",
            fixedAssetSapItemCode: "AF-001",
            fixedAssetName: "Equipo administración",
            isFixedAsset: true,
            isLeasing: true,
            assetDetails: [
              {
                serialNumber: "SN-001",
                condition: "nuevo",
                color: "Negro",
                model: "OptiPlex",
                brand: "Dell",
                chassisSeries: "CH-001",
                motorSeries: "",
                plateOrCode: "PLACA-001",
              },
            ],
          },
        ],
      })
    ).resolves.toEqual(expect.objectContaining({ id: 6 }));

    expect(registerReceiptSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 15,
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          notes: "Equipo recibido con caja sellada",
          isFixedAsset: true,
          isLeasing: true,
          assetDetails: [
            expect.objectContaining({
              serialNumber: "SN-001",
              condition: "nuevo",
              color: "Negro",
              brand: "Dell",
            }),
          ],
        }),
      ])
    );

    getPurchaseOrderByIdSpy.mockRestore();
    getActiveFixedAssetByCodeSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("blocks receipt while fixed asset code is pending in accounting", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantity: "1.00",
            receivedQuantity: "0.00",
            isFixedAsset: true,
            fixedAssetArticleId: 80,
            fixedAssetStatus: "pendiente",
          },
        ],
      } as any);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantityExpected: "1.00",
            quantityReceived: "1",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("pendiente de código real");

    expect(registerReceiptSpy).not.toHaveBeenCalled();
    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("rejects fixed asset receipt lines with decimal quantities", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantityExpected: "2.00",
            quantityReceived: "1.5",
            unit: "und",
            isFixedAsset: true,
            assetDetails: [
              { serialNumber: "SN-001", condition: "nuevo" },
              { serialNumber: "SN-002", condition: "nuevo" },
            ],
          },
        ],
      })
    ).rejects.toThrow(
      "Activo fijo requiere que la cantidad recibida sea exactamente 1"
    );

    expect(registerReceiptSpy).not.toHaveBeenCalled();
    registerReceiptSpy.mockRestore();
  });

  it("rejects fixed asset receipt lines without serial number", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "COMPUTADORA ESCRITORIO",
            quantityExpected: "1.00",
            quantityReceived: "1",
            unit: "und",
            isFixedAsset: true,
            assetDetails: [{ serialNumber: "", condition: "nuevo" }],
          },
        ],
      })
    ).rejects.toThrow("Ingrese el número de serie del activo");

    expect(registerReceiptSpy).not.toHaveBeenCalled();
    registerReceiptSpy.mockRestore();
  });

  it("Bodeguero de Proyecto cannot register receipts for another project's purchase order", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 2,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "100.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 2,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("No tiene acceso a recepciones de otro proyecto");
    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("Bodeguero de Proyecto can register transfer receipts for their destination project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "confirmado",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 1,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "10.00",
            receivedQuantity: "0.00",
            returnedToOriginQuantity: "0.00",
            sapItemCode: "01010100001",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 7,
        receiptNumber: "RC-2026-0002",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 31,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "VARILLA #4",
            quantityExpected: "10.00",
            quantityReceived: "10.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 7,
      receiptNumber: "RC-2026-0002",
      status: "completa",
    });
    expect(registerReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        receivedById: 6,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 31,
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          quantityReceived: "10.00",
        }),
      ])
    );

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("Bodeguero de Proyecto cannot register transfer receipts for another destination project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "confirmado",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 2,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "10.00",
            receivedQuantity: "0.00",
            returnedToOriginQuantity: "0.00",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 2,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 31,
            itemName: "VARILLA #4",
            quantityExpected: "10.00",
            quantityReceived: "10.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("No tiene acceso a recepciones de otro proyecto");
    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("register stores invoice metadata for an emitted purchase order receipt", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "100.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        notes: "Factura de prueba",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "completa",
    });

    const receiptPayload = registerReceiptSpy.mock.calls[0]?.[0] as any;
    expect(receiptPayload.cai).toBe(VALID_CAI);
    expect(receiptPayload.invoiceNumber).toBe(VALID_INVOICE_NUMBER);
    expect(receiptPayload.documentRangeStart).toBe(VALID_DOCUMENT_RANGE_START);
    expect(receiptPayload.documentRangeEnd).toBe(VALID_DOCUMENT_RANGE_END);
    expect(receiptPayload.documentDate).toBeInstanceOf(Date);
    expect(receiptPayload.documentDueDate).toBeInstanceOf(Date);
    expect(receiptPayload.emissionDeadline).toBeInstanceOf(Date);
    expect(receiptPayload.postingDate).toBeInstanceOf(Date);
    expect(receiptPayload.receiptDate).toBeInstanceOf(Date);

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("requires emission deadline for purchase order receipts", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("Seleccione la fecha límite de emisión");

    expect(registerReceiptSpy).not.toHaveBeenCalled();
    registerReceiptSpy.mockRestore();
  });

  it("requires document due date for fiscal purchase order receipts", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("Seleccione la fecha de vencimiento del documento");

    expect(registerReceiptSpy).not.toHaveBeenCalled();
    registerReceiptSpy.mockRestore();
  });

  it("rejects invalid CAI and invoice number formats for purchase order receipts", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: "BFHJGJKH",
        invoiceNumber: "3654756",
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toThrow("El CAI debe tener el formato");

    expect(registerReceiptSpy).not.toHaveBeenCalled();
    registerReceiptSpy.mockRestore();
  });

  it("allows foreign purchase order receipts without fiscal document format", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "emitida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "100.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 6,
        receiptNumber: "RC-2026-0001",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        isFiscalDocument: false,
        cai: "AUTH-EXT/001",
        invoiceNumber: "INV-USA-45",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "100.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "completa",
    });

    const receiptPayload = registerReceiptSpy.mock.calls[0]?.[0] as any;
    expect(receiptPayload).toEqual(
      expect.objectContaining({
        isFiscalDocument: false,
        cai: "AUTH-EXT/001",
        invoiceNumber: "INV-USA-45",
        documentDate: null,
        documentDueDate: null,
        emissionDeadline: null,
      })
    );

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows registering a receipt from a confirmed transfer without invoice metadata", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "confirmado",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 1,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "20.00",
            receivedQuantity: "5.00",
            sapItemCode: "01010100001",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 7,
        receiptNumber: "RC-2026-0002",
        status: "parcial",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        notes: "Ingreso parcial de traslado",
        items: [
          {
            sourceItemId: 31,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "VARILLA #4",
            quantityExpected: "15.00",
            quantityReceived: "10.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 7,
      receiptNumber: "RC-2026-0002",
      status: "parcial",
    });

    const receiptPayload = registerReceiptSpy.mock.calls[0]?.[0] as any;
    expect(receiptPayload.sourceType).toBe("transfer");
    expect(receiptPayload.sourceId).toBe(8);
    expect(receiptPayload.projectId).toBe(1);
    expect(receiptPayload.cai).toBeNull();
    expect(receiptPayload.invoiceNumber).toBeNull();
    expect(receiptPayload.documentDate).toBeNull();
    expect(receiptPayload.documentDueDate).toBeNull();

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows the destination project admin to close a transfer receipt balance", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "parcialmente_recibido",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 1,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "100.00",
            receivedQuantity: "50.00",
            returnedToOriginQuantity: "0.00",
            sapItemCode: "01010100001",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 7,
        receiptNumber: "RC-2026-0002",
        status: "parcial",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 31,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "VARILLA #4",
            quantityExpected: "50.00",
            quantityReceived: "20.00",
            unit: "und",
            closeRemaining: true,
            closeReason: "No se va a recibir",
            closeNote: "El saldo fue confirmado como devuelto al origen",
          },
        ],
      })
    ).resolves.toEqual({
      id: 7,
      receiptNumber: "RC-2026-0002",
      status: "parcial",
    });

    const receiptItems = registerReceiptSpy.mock.calls[0]?.[1] as any[];
    expect(receiptItems[0]).toEqual(
      expect.objectContaining({
        sourceItemId: 31,
        warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
        quantityReceived: "20.00",
        closeRemaining: true,
        closeReason: "No se va a recibir",
        closeNote: "El saldo fue confirmado como devuelto al origen",
        closedById: 5,
      })
    );
    expect(receiptItems[0].notes).toContain("Cierre incompleto");

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows central administration to close a transfer receipt balance", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "parcialmente_recibido",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 1,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "100.00",
            receivedQuantity: "50.00",
            returnedToOriginQuantity: "0.00",
            sapItemCode: "01010100001",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 7,
        receiptNumber: "RC-2026-0002",
        status: "parcial",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 31,
            itemName: "VARILLA #4",
            quantityExpected: "50.00",
            quantityReceived: "0.00",
            unit: "und",
            closeRemaining: true,
            closeReason: "No se va a recibir",
            closeNote: "El saldo fue confirmado como devuelto al origen",
          },
        ],
      })
    ).resolves.toEqual({
      id: 7,
      receiptNumber: "RC-2026-0002",
      status: "parcial",
    });

    expect((registerReceiptSpy.mock.calls[0]?.[1] as any[])[0]).toEqual(
      expect.objectContaining({
        closeRemaining: true,
        closedById: 4,
      })
    );

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("blocks warehouse users from closing a transfer receipt balance", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "parcialmente_recibido",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 1,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "100.00",
            receivedQuantity: "50.00",
            returnedToOriginQuantity: "0.00",
            sapItemCode: "01010100001",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({} as any);

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 31,
            itemName: "VARILLA #4",
            quantityExpected: "50.00",
            quantityReceived: "0.00",
            unit: "und",
            closeRemaining: true,
            closeReason: "No se va a recibir",
            closeNote: "El saldo fue confirmado como devuelto al origen",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Solo Administración Central o el Administrador del Proyecto destino pueden cerrar saldos de traslado",
    });

    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows receiving more than the pending transfer balance", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferByIdSpy = vi
      .spyOn(db, "getTransferById")
      .mockResolvedValue({
        transfer: {
          id: 8,
          transferNumber: "TR-2026-0003",
          status: "parcialmente_recibido",
        },
        transferRequest: {
          id: 5,
          requestNumber: "ST-2026-0005",
          destinationType: "proyecto",
          destinationProjectId: 1,
        },
        items: [
          {
            id: 31,
            itemName: "VARILLA #4",
            quantity: "20.00",
            receivedQuantity: "5.00",
            sapItemCode: "01010100001",
            unit: "und",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 7,
        receiptNumber: "RC-2026-0002",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 31,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "VARILLA #4",
            quantityExpected: "15.00",
            quantityReceived: "16.00",
            unit: "und",
          },
        ],
      })
    ).resolves.toEqual({
      id: 7,
      receiptNumber: "RC-2026-0002",
      status: "completa",
    });

    expect(registerReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "transfer",
        sourceId: 8,
        projectId: 1,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 31,
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          quantityExpected: "15.00",
          quantityReceived: "16.00",
        }),
      ])
    );

    getTransferByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("does not allow registering a receipt from a purchase order that is not emitted", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "borrador",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "100.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({} as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "100.00",
            quantityReceived: "50.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Solo se pueden recibir órdenes emitidas con saldo pendiente o contratos vigentes",
    });

    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("does not allow registering a receipt for a line already closed in reception", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "parcialmente_recibida",
        },
        items: [
          {
            id: 15,
            itemName: "CEMENTO GRANEL",
            quantity: "100.00",
            receivedQuantity: "40.00",
            receiptClosed: true,
          },
        ],
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "CEMENTO GRANEL",
            quantityExpected: "60.00",
            quantityReceived: "10.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La línea CEMENTO GRANEL fue cerrada y ya no admite recepciones",
    });

    getPurchaseOrderByIdSpy.mockRestore();
  });

  it("allows contract receipts while scheduled invoices remain even if emission is pending", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "borrador",
          appliesContract: true,
          contractPaymentFrequency: "mensual",
          contractFirstPaymentDate: new Date("2026-01-01T12:00:00"),
          contractEndDate: new Date("2026-12-31T12:00:00"),
        },
        contractSummary: {
          expectedInvoiceCount: 12,
          registeredInvoiceCount: 1,
          remainingInvoiceCount: 11,
          isExpired: false,
          isFullyInvoiced: false,
        },
        items: [
          {
            id: 15,
            itemName: "SERVICIO MENSUAL",
            quantity: "12.00",
            receivedQuantity: "12.00",
            receiptClosed: false,
          },
        ],
      } as any);
    const registerReceiptSpy = vi
      .spyOn(db, "registerReceipt")
      .mockResolvedValue({
        id: 8,
        receiptNumber: "RC-2026-0008",
        status: "completa",
      } as any);

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER_ALT,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
            itemName: "SERVICIO MENSUAL",
            quantityExpected: "12.00",
            quantityReceived: "12.00",
            unitPrice: "1100.00",
            unit: "mes",
          },
        ],
      })
    ).resolves.toEqual({
      id: 8,
      receiptNumber: "RC-2026-0008",
      status: "completa",
    });

    expect(registerReceiptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "purchase_order",
        sourceId: 4,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          sourceItemId: 15,
          warehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          quantityExpected: "12.00",
          quantityReceived: "12.00",
          unitPrice: "1100.00",
        }),
      ])
    );

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("blocks registering contract receipts after the contract end date", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "parcialmente_recibida",
          appliesContract: true,
          contractPaymentFrequency: "mensual",
          contractFirstPaymentDate: new Date("2026-01-01T12:00:00"),
          contractEndDate: new Date("2026-01-31T12:00:00"),
        },
        contractSummary: {
          expectedInvoiceCount: 1,
          registeredInvoiceCount: 0,
          remainingInvoiceCount: 1,
          isExpired: true,
          isFullyInvoiced: false,
        },
        items: [
          {
            id: 15,
            itemName: "SERVICIO MENSUAL",
            quantity: "12.00",
            receivedQuantity: "0.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "SERVICIO MENSUAL",
            quantityExpected: "12.00",
            quantityReceived: "1.00",
            unit: "mes",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El contrato está vencido y ya no permite agregar facturas",
    });

    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("blocks registering contract receipts after all expected invoices exist", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0005",
          projectId: 1,
          status: "parcialmente_recibida",
          appliesContract: true,
          contractPaymentFrequency: "mensual",
          contractFirstPaymentDate: new Date("2026-01-01T12:00:00"),
          contractEndDate: new Date("2026-12-31T12:00:00"),
        },
        contractSummary: {
          expectedInvoiceCount: 12,
          registeredInvoiceCount: 12,
          remainingInvoiceCount: 0,
          isExpired: false,
          isFullyInvoiced: true,
        },
        items: [
          {
            id: 15,
            itemName: "SERVICIO MENSUAL",
            quantity: "12.00",
            receivedQuantity: "12.00",
          },
        ],
      } as any);
    const registerReceiptSpy = vi.spyOn(db, "registerReceipt");

    await expect(
      caller.receipts.register({
        sourceType: "purchase_order",
        sourceId: 4,
        projectId: 1,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-04-14",
        documentDueDate: "2026-05-14",
        emissionDeadline: "2026-04-30",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        items: [
          {
            sourceItemId: 15,
            itemName: "SERVICIO MENSUAL",
            quantityExpected: "12.00",
            quantityReceived: "1.00",
            unit: "mes",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La OC de contrato ya alcanzó el total de facturas programadas",
    });

    expect(registerReceiptSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    registerReceiptSpy.mockRestore();
  });

  it("allows closing a partially received purchase order line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemByIdSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 15,
          purchaseOrderId: 4,
          itemName: "CEMENTO GRANEL",
          quantity: "100.00",
          receivedQuantity: "40.00",
          receiptClosed: false,
        },
        purchaseOrder: {
          id: 4,
          projectId: 1,
          status: "parcialmente_recibida",
        },
      } as any);
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const syncPurchaseOrderReceiptStatusSpy = vi
      .spyOn(db, "syncPurchaseOrderReceiptStatus")
      .mockResolvedValue("parcialmente_recibida");

    await expect(
      caller.purchaseOrders.closeReceiptLine({
        purchaseOrderItemId: 15,
      })
    ).resolves.toEqual({
      success: true,
      orderStatus: "parcialmente_recibida",
    });

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(
      15,
      expect.objectContaining({
        receiptClosed: true,
        receiptClosedById: 4,
      })
    );
    expect(syncPurchaseOrderReceiptStatusSpy).toHaveBeenCalledWith(4);

    getPurchaseOrderItemByIdSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
    syncPurchaseOrderReceiptStatusSpy.mockRestore();
  });

  it("does not allow closing a line that is not partially received", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemByIdSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 15,
          purchaseOrderId: 4,
          itemName: "CEMENTO GRANEL",
          quantity: "100.00",
          receivedQuantity: "0.00",
          receiptClosed: false,
        },
        purchaseOrder: {
          id: 4,
          projectId: 1,
          status: "emitida",
        },
      } as any);

    await expect(
      caller.purchaseOrders.closeReceiptLine({
        purchaseOrderItemId: 15,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Solo se pueden cerrar líneas que estén parcialmente recibidas",
    });

    getPurchaseOrderItemByIdSpy.mockRestore();
  });

  it("moves pending balance to a new purchase request and closes the line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemByIdSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 16,
          purchaseOrderId: 4,
          materialRequestItemId: 99,
          itemName: "PALA HOYADORA MANUAL",
          originalSapItemCode: "03030100035",
          currentSapItemCode: "03030100035",
          quantity: "10.00",
          receivedQuantity: "5.00",
          unit: "und",
          receiptClosed: false,
        },
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0044",
          projectId: 1,
          purchaseType: "local",
          status: "parcialmente_recibida",
          neededBy: new Date("2026-05-01"),
        },
      } as any);
    const getReusablePurchaseRequestSpy = vi
      .spyOn(db, "getReusablePurchaseRequestBySourcePurchaseOrderId")
      .mockResolvedValue(undefined);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({ id: 701, requestNumber: "SC-2026-0040" });
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const syncPurchaseOrderReceiptStatusSpy = vi
      .spyOn(db, "syncPurchaseOrderReceiptStatus")
      .mockResolvedValue("parcialmente_recibida");

    await expect(
      caller.purchaseOrders.movePendingToPurchaseRequest({
        purchaseOrderItemId: 16,
      })
    ).resolves.toEqual({
      success: true,
      orderStatus: "parcialmente_recibida",
      reused: false,
      purchaseRequestId: 701,
      purchaseRequestNumber: "SC-2026-0040",
    });

    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePurchaseOrderId: 4,
        projectId: 1,
        purchaseType: "local",
      }),
      [
        expect.objectContaining({
          materialRequestItemId: 99,
          sourcePurchaseOrderItemId: 16,
          quantity: "5.00",
        }),
      ]
    );
    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(
      16,
      expect.objectContaining({
        receiptClosed: true,
        receiptClosedById: 4,
      })
    );

    getPurchaseOrderItemByIdSpy.mockRestore();
    getReusablePurchaseRequestSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
    syncPurchaseOrderReceiptStatusSpy.mockRestore();
  });

  it("reuses the same pending purchase request for another line of the same order", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderItemByIdSpy = vi
      .spyOn(db, "getPurchaseOrderItemById")
      .mockResolvedValue({
        item: {
          id: 17,
          purchaseOrderId: 4,
          materialRequestItemId: 100,
          itemName: "CEMENTO GRANEL",
          originalSapItemCode: "05050200058",
          currentSapItemCode: "05050200058",
          quantity: "100.00",
          receivedQuantity: "40.00",
          unit: "und",
          receiptClosed: false,
        },
        purchaseOrder: {
          id: 4,
          orderNumber: "OC-2026-0044",
          projectId: 1,
          purchaseType: "local",
          status: "parcialmente_recibida",
          neededBy: new Date("2026-05-01"),
        },
      } as any);
    const getReusablePurchaseRequestSpy = vi
      .spyOn(db, "getReusablePurchaseRequestBySourcePurchaseOrderId")
      .mockResolvedValue({
        id: 702,
        requestNumber: "SC-2026-0041",
        status: "pendiente",
      } as any);
    const addPurchaseRequestItemsSpy = vi
      .spyOn(db, "addPurchaseRequestItems")
      .mockResolvedValue({ success: true } as any);
    const updatePurchaseOrderItemSpy = vi
      .spyOn(db, "updatePurchaseOrderItem")
      .mockResolvedValue({ success: true });
    const syncPurchaseOrderReceiptStatusSpy = vi
      .spyOn(db, "syncPurchaseOrderReceiptStatus")
      .mockResolvedValue("parcialmente_recibida");

    await expect(
      caller.purchaseOrders.movePendingToPurchaseRequest({
        purchaseOrderItemId: 17,
      })
    ).resolves.toEqual({
      success: true,
      orderStatus: "parcialmente_recibida",
      reused: true,
      purchaseRequestId: 702,
      purchaseRequestNumber: "SC-2026-0041",
    });

    expect(addPurchaseRequestItemsSpy).toHaveBeenCalledWith(702, [
      expect.objectContaining({
        materialRequestItemId: 100,
        sourcePurchaseOrderItemId: 17,
        quantity: "60.00",
      }),
    ]);

    getPurchaseOrderItemByIdSpy.mockRestore();
    getReusablePurchaseRequestSpy.mockRestore();
    addPurchaseRequestItemsSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
    syncPurchaseOrderReceiptStatusSpy.mockRestore();
  });
});

// ============================================================
// Tests: Invoices
// ============================================================
describe("BuildReq - Invoices", () => {
  const invoiceDetail = {
    invoice: {
      id: 10,
      invoiceDocumentNumber: "FT-2026-0001",
      projectId: 1,
      supplierId: 5,
      purchaseOrderId: 4,
      receiptId: 6,
      status: "borrador",
      isFiscalDocument: true,
      cai: VALID_CAI,
      invoiceNumber: VALID_INVOICE_NUMBER,
      documentRangeStart: VALID_DOCUMENT_RANGE_START,
      documentRangeEnd: VALID_DOCUMENT_RANGE_END,
      documentDate: new Date("2026-05-01T12:00:00"),
      documentDueDate: new Date("2026-06-01T12:00:00"),
      postingDate: new Date("2026-05-02T12:00:00"),
      receiptDate: new Date("2026-05-02T12:00:00"),
      emissionDeadline: new Date("2026-05-31T12:00:00"),
      retentionReceiptNumber: "CR-2026-0001",
      total: "1000.00",
      retentionTotal: "0.00",
      netPayable: "1000.00",
    },
    receipt: { id: 6, receiptNumber: "RC-2026-0001" },
    purchaseOrder: { id: 4, orderNumber: "OC-2026-0005" },
    project: { id: 1, code: "020", name: "Proyecto Test" },
    supplier: {
      id: 5,
      supplierCode: "PL-00005",
      name: "Proveedor Demo",
      rtn: "08011990123456",
    },
    items: [],
    retentions: [],
  } as any;

  it("Bodeguero de Proyecto can list invoices only for their assigned project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const listInvoicesSpy = vi.spyOn(db, "listInvoices").mockResolvedValue([]);

    await expect(
      caller.invoices.list({ projectId: 2, search: VALID_INVOICE_NUMBER })
    ).resolves.toEqual([]);
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 2,
        projectIds: [],
        search: VALID_INVOICE_NUMBER,
      })
    );

    listInvoicesSpy.mockRestore();
  });

  it("Contable can list reviewed and accounted invoices", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const listInvoicesSpy = vi.spyOn(db, "listInvoices").mockResolvedValue([]);

    await expect(
      caller.invoices.list({ status: "borrador" as any })
    ).resolves.toEqual([]);
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: undefined,
        statuses: ["revisada", "registrada"],
      })
    );

    await expect(
      caller.invoices.list({ status: "registrada" })
    ).resolves.toEqual([]);
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "registrada",
        statuses: undefined,
      })
    );

    listInvoicesSpy.mockRestore();
  });

  it("Administracion Central can list reviewed invoices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const listInvoicesSpy = vi.spyOn(db, "listInvoices").mockResolvedValue([]);

    await expect(caller.invoices.list({ status: "revisada" })).resolves.toEqual(
      []
    );
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "revisada",
      })
    );
    expect(listInvoicesSpy.mock.calls[0]?.[0]?.excludeStatus).toBeUndefined();

    listInvoicesSpy.mockRestore();
  });

  it("Project administrators can list invoices in every status for assigned projects", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const listInvoicesSpy = vi.spyOn(db, "listInvoices").mockResolvedValue([]);

    await expect(caller.invoices.list({ status: "revisada" })).resolves.toEqual(
      []
    );
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectIds: [1],
        status: "revisada",
      })
    );

    await expect(caller.invoices.list({})).resolves.toEqual([]);
    expect(listInvoicesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectIds: [1],
        excludeStatus: undefined,
      })
    );

    listInvoicesSpy.mockRestore();
  });

  it("Project administrators can consult reviewed invoice details for assigned projects", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
    } as any);

    await expect(caller.invoices.getById({ id: 10 })).resolves.toEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({ status: "revisada" }),
      })
    );

    getInvoiceByIdSpy.mockRestore();
  });

  it("blocks Contable from consulting draft invoices", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);

    await expect(caller.invoices.getById({ id: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Contabilidad solo puede ver facturas revisadas o contabilizadas",
    });

    getInvoiceByIdSpy.mockRestore();
  });

  it("Contable can consult accounted invoices", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "registrada",
      },
    } as any);

    await expect(caller.invoices.getById({ id: 10 })).resolves.toEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({ status: "registrada" }),
      })
    );

    getInvoiceByIdSpy.mockRestore();
  });

  it("Administracion Central can consult reviewed invoices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
    } as any);

    await expect(caller.invoices.getById({ id: 10 })).resolves.toEqual(
      expect.objectContaining({
        invoice: expect.objectContaining({ status: "revisada" }),
      })
    );

    getInvoiceByIdSpy.mockRestore();
  });

  it("blocks project-scoped users from consulting invoices from another project", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        projectId: 2,
      },
    } as any);

    await expect(caller.invoices.getById({ id: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "No tiene acceso a facturas de otro proyecto",
    });

    getInvoiceByIdSpy.mockRestore();
  });

  it("looks up a fiscal range for a draft invoice by supplier RTN and document number", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const emissionDeadline = new Date("2026-05-31T12:00:00");
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const lookupSupplierFiscalDocumentRangeSpy = vi
      .spyOn(db, "lookupSupplierFiscalDocumentRange")
      .mockResolvedValue({
        cai: VALID_CAI,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        emissionDeadline,
      } as any);

    await expect(
      caller.invoices.lookupFiscalDocumentRange({
        id: 10,
        invoiceNumber: "000 001 01 00010572",
      })
    ).resolves.toEqual({
      cai: VALID_CAI,
      documentRangeStart: VALID_DOCUMENT_RANGE_START,
      documentRangeEnd: VALID_DOCUMENT_RANGE_END,
      emissionDeadline,
    });

    expect(lookupSupplierFiscalDocumentRangeSpy).toHaveBeenCalledWith({
      invoiceId: 10,
      invoiceNumber: VALID_INVOICE_NUMBER_ALT,
    });

    getInvoiceByIdSpy.mockRestore();
    lookupSupplierFiscalDocumentRangeSpy.mockRestore();
  });

  it("returns no fiscal range for invalid document numbers", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const lookupSupplierFiscalDocumentRangeSpy = vi.spyOn(
      db,
      "lookupSupplierFiscalDocumentRange"
    );

    await expect(
      caller.invoices.lookupFiscalDocumentRange({
        id: 10,
        invoiceNumber: "3654756",
      })
    ).resolves.toBeNull();

    expect(lookupSupplierFiscalDocumentRangeSpy).not.toHaveBeenCalled();

    getInvoiceByIdSpy.mockRestore();
    lookupSupplierFiscalDocumentRangeSpy.mockRestore();
  });

  it("Project administrator can review a draft invoice with attachments", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const getAttachmentsByEntitySpy = vi
      .spyOn(db, "getAttachmentsByEntity")
      .mockResolvedValue([{ id: 99 }] as any);
    const reviewInvoiceSpy = vi.spyOn(db, "reviewInvoice").mockResolvedValue({
      ...invoiceDetail.invoice,
      status: "revisada",
    } as any);

    await expect(caller.invoices.review({ id: 10 })).resolves.toEqual(
      expect.objectContaining({ status: "revisada" })
    );
    expect(getAttachmentsByEntitySpy).toHaveBeenCalledWith("invoice", 10);
    expect(reviewInvoiceSpy).toHaveBeenCalledWith(10, ctx.user!.id);

    getInvoiceByIdSpy.mockRestore();
    getAttachmentsByEntitySpy.mockRestore();
    reviewInvoiceSpy.mockRestore();
  });

  it("blocks reviewing invoices without attachments", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const getAttachmentsByEntitySpy = vi
      .spyOn(db, "getAttachmentsByEntity")
      .mockResolvedValue([]);
    const reviewInvoiceSpy = vi.spyOn(db, "reviewInvoice");

    await expect(caller.invoices.review({ id: 10 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Adjunte al menos un archivo antes de enviar a revisión",
    });
    expect(reviewInvoiceSpy).not.toHaveBeenCalled();

    getInvoiceByIdSpy.mockRestore();
    getAttachmentsByEntitySpy.mockRestore();
    reviewInvoiceSpy.mockRestore();
  });

  it("blocks reviewing invoices with invalid fiscal data", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        cai: "",
      },
    } as any);
    const getAttachmentsByEntitySpy = vi.spyOn(db, "getAttachmentsByEntity");
    const reviewInvoiceSpy = vi.spyOn(db, "reviewInvoice");

    await expect(caller.invoices.review({ id: 10 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Ingrese el CAI del documento antes de enviar a revisión",
    });
    expect(getAttachmentsByEntitySpy).not.toHaveBeenCalled();
    expect(reviewInvoiceSpy).not.toHaveBeenCalled();

    getInvoiceByIdSpy.mockRestore();
    getAttachmentsByEntitySpy.mockRestore();
    reviewInvoiceSpy.mockRestore();
  });

  it("Contable can account reviewed invoices", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
    } as any);
    const accountInvoiceSpy = vi.spyOn(db, "accountInvoice").mockResolvedValue({
      ...invoiceDetail.invoice,
      status: "registrada",
      accountingComment: "Listo",
    } as any);

    await expect(
      caller.invoices.account({ id: 10, accountingComment: "Listo" })
    ).resolves.toEqual(expect.objectContaining({ status: "registrada" }));
    expect(accountInvoiceSpy).toHaveBeenCalledWith({
      id: 10,
      accountedById: ctx.user!.id,
      accountingComment: "Listo",
    });

    getInvoiceByIdSpy.mockRestore();
    accountInvoiceSpy.mockRestore();
  });

  it("Superuser can account reviewed invoices", async () => {
    const { ctx } = createUserContext({ role: "admin", buildreqRole: null });
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
    } as any);
    const accountInvoiceSpy = vi.spyOn(db, "accountInvoice").mockResolvedValue({
      ...invoiceDetail.invoice,
      status: "registrada",
    } as any);

    await expect(caller.invoices.account({ id: 10 })).resolves.toEqual(
      expect.objectContaining({ status: "registrada" })
    );
    expect(accountInvoiceSpy).toHaveBeenCalledWith({
      id: 10,
      accountedById: ctx.user!.id,
      accountingComment: undefined,
    });

    getInvoiceByIdSpy.mockRestore();
    accountInvoiceSpy.mockRestore();
  });

  it("Contable can reject reviewed invoices with a comment", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
    } as any);
    const rejectInvoiceSpy = vi
      .spyOn(db, "rejectInvoiceFromAccounting")
      .mockResolvedValue({
        ...invoiceDetail.invoice,
        status: "rechazada",
        rejectionComment: "Falta soporte",
      } as any);

    await expect(
      caller.invoices.reject({
        id: 10,
        rejectionComment: "Falta soporte",
      })
    ).resolves.toEqual(expect.objectContaining({ status: "rechazada" }));
    expect(rejectInvoiceSpy).toHaveBeenCalledWith({
      id: 10,
      rejectedById: ctx.user!.id,
      rejectionComment: "Falta soporte",
    });

    getInvoiceByIdSpy.mockRestore();
    rejectInvoiceSpy.mockRestore();
  });

  it("Administracion Central can correct a receipt from a reviewed invoice", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
    } as any);
    const correctReceiptSpy = vi
      .spyOn(db, "correctInvoiceReceiptFromInvoice")
      .mockResolvedValue({
        invoice: { ...invoiceDetail.invoice, status: "anulada" },
        receipt: { id: 6, receiptNumber: "RC-2026-0001", status: "anulada" },
        replacementReceipt: {
          id: 12,
          receiptNumber: "RC-2026-0002",
          status: "borrador",
        },
      } as any);

    await expect(
      caller.invoices.correctReceipt({
        id: 10,
        reason: "Cantidad recibida incorrecta",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        replacementReceipt: expect.objectContaining({
          status: "borrador",
        }),
      })
    );
    expect(correctReceiptSpy).toHaveBeenCalledWith({
      invoiceId: 10,
      correctedById: ctx.user!.id,
      reason: "Cantidad recibida incorrecta",
    });

    getInvoiceByIdSpy.mockRestore();
    correctReceiptSpy.mockRestore();
  });

  it("blocks receipt correction for accounted invoices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "registrada",
      },
    } as any);
    const correctReceiptSpy = vi.spyOn(db, "correctInvoiceReceiptFromInvoice");

    await expect(
      caller.invoices.correctReceipt({
        id: 10,
        reason: "Cantidad recibida incorrecta",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No se puede corregir una factura contabilizada",
    });
    expect(correctReceiptSpy).not.toHaveBeenCalled();

    getInvoiceByIdSpy.mockRestore();
    correctReceiptSpy.mockRestore();
  });

  it("surfaces stock validation errors when correcting receipt invoices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const correctReceiptSpy = vi
      .spyOn(db, "correctInvoiceReceiptFromInvoice")
      .mockRejectedValue(
        new Error(
          "Stock insuficiente para CEMENTO. Disponible: 0.00, necesario para corregir: 10.00."
        )
      );

    await expect(
      caller.invoices.correctReceipt({
        id: 10,
        reason: "Cantidad recibida incorrecta",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Stock insuficiente para CEMENTO. Disponible: 0.00, necesario para corregir: 10.00.",
    });

    getInvoiceByIdSpy.mockRestore();
    correctReceiptSpy.mockRestore();
  });

  it("Contable cannot edit invoice metadata", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice");

    await expect(
      caller.invoices.update({
        id: 10,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-05-01",
        documentDueDate: "2026-06-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        emissionDeadline: "2026-05-31",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "No tiene permisos para editar facturas",
    });
    expect(updateInvoiceSpy).not.toHaveBeenCalled();

    updateInvoiceSpy.mockRestore();
  });

  it("Administracion Central can update draft invoice metadata", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice").mockResolvedValue({
      ...invoiceDetail.invoice,
      invoiceNumber: VALID_INVOICE_NUMBER_ALT,
      documentRangeStart: VALID_DOCUMENT_RANGE_START,
      documentRangeEnd: VALID_DOCUMENT_RANGE_END,
    } as any);

    await expect(
      caller.invoices.update({
        id: 10,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER_ALT,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-05-01",
        documentDueDate: "2026-06-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        emissionDeadline: "2026-05-31",
        notes: "Ajuste de factura",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        invoiceNumber: VALID_INVOICE_NUMBER_ALT,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
      })
    );
    expect(updateInvoiceSpy).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER_ALT,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: expect.any(Date),
        documentDueDate: expect.any(Date),
        emissionDeadline: expect.any(Date),
      })
    );

    getInvoiceByIdSpy.mockRestore();
    updateInvoiceSpy.mockRestore();
  });

  it("requires valid CAI and invoice number when updating invoice metadata", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice");

    await expect(
      caller.invoices.update({
        id: 10,
        cai: "",
        invoiceNumber: "3654756",
        documentDate: "2026-05-01",
        documentDueDate: "2026-06-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        emissionDeadline: "2026-05-31",
        notes: "Ajuste de factura",
      })
    ).rejects.toThrow("Ingrese el CAI del documento");

    expect(updateInvoiceSpy).not.toHaveBeenCalled();
    updateInvoiceSpy.mockRestore();
  });

  it("requires document due date when updating fiscal invoice metadata", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice");

    await expect(
      caller.invoices.update({
        id: 10,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-05-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        emissionDeadline: "2026-05-31",
      })
    ).rejects.toThrow("Seleccione la fecha de vencimiento del documento");

    expect(updateInvoiceSpy).not.toHaveBeenCalled();
    updateInvoiceSpy.mockRestore();
  });

  it("requires emission deadline when updating fiscal invoice metadata", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice");

    await expect(
      caller.invoices.update({
        id: 10,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: VALID_DOCUMENT_RANGE_START,
        documentRangeEnd: VALID_DOCUMENT_RANGE_END,
        documentDate: "2026-05-01",
        documentDueDate: "2026-06-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
      })
    ).rejects.toThrow("Seleccione la fecha límite de emisión");

    expect(updateInvoiceSpy).not.toHaveBeenCalled();
    updateInvoiceSpy.mockRestore();
  });

  it("requires ordered fiscal ranges when updating invoice metadata", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice");

    await expect(
      caller.invoices.update({
        id: 10,
        cai: VALID_CAI,
        invoiceNumber: VALID_INVOICE_NUMBER,
        documentRangeStart: "000-001-01-00010572",
        documentRangeEnd: "000-001-01-00010571",
        documentDate: "2026-05-01",
        documentDueDate: "2026-06-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        emissionDeadline: "2026-05-31",
      })
    ).rejects.toThrow(
      "El rango autorizado final debe ser mayor o igual al inicial"
    );

    expect(updateInvoiceSpy).not.toHaveBeenCalled();
    updateInvoiceSpy.mockRestore();
  });

  it("requires fiscal document number inside authorized range", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice");

    await expect(
      caller.invoices.update({
        id: 10,
        cai: VALID_CAI,
        invoiceNumber: "000-001-01-00010571",
        documentRangeStart: "000-001-01-00010572",
        documentRangeEnd: "000-001-01-00010580",
        documentDate: "2026-05-01",
        documentDueDate: "2026-06-01",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        emissionDeadline: "2026-05-31",
      })
    ).rejects.toThrow(
      "El número documento debe estar dentro del rango autorizado"
    );

    expect(updateInvoiceSpy).not.toHaveBeenCalled();
    updateInvoiceSpy.mockRestore();
  });

  it("allows updating foreign document invoice metadata without fiscal format", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const updateInvoiceSpy = vi.spyOn(db, "updateInvoice").mockResolvedValue({
      ...invoiceDetail.invoice,
      isFiscalDocument: false,
      invoiceNumber: "INV-USA-45",
    } as any);

    await expect(
      caller.invoices.update({
        id: 10,
        isFiscalDocument: false,
        cai: "AUTH-EXT/001",
        invoiceNumber: "INV-USA-45",
        postingDate: "2026-05-02",
        receiptDate: "2026-05-02",
        notes: "Documento extranjero",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        isFiscalDocument: false,
        invoiceNumber: "INV-USA-45",
      })
    );
    expect(updateInvoiceSpy).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        isFiscalDocument: false,
        cai: "AUTH-EXT/001",
        invoiceNumber: "INV-USA-45",
        emissionDeadline: expect.any(Date),
      })
    );

    getInvoiceByIdSpy.mockRestore();
    updateInvoiceSpy.mockRestore();
  });

  it("Administracion Central can update draft invoice fixed asset details", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      items: [
        {
          id: 77,
          invoiceId: 10,
          itemName: "COMPUTADORA ESCRITORIO",
          quantity: "1.00",
          targetType: "activo_fijo",
        },
      ],
    } as any);
    const updateInvoiceItemAssetDetailsSpy = vi
      .spyOn(db, "updateInvoiceItemAssetDetails")
      .mockResolvedValue({
        id: 77,
        isFixedAsset: true,
        isLeasing: true,
      } as any);

    await expect(
      caller.invoices.updateItemAssetDetails({
        id: 10,
        invoiceItemId: 77,
        isFixedAsset: true,
        isLeasing: true,
        lineObservation: "Activo recibido en buen estado",
        assetDetails: [
          {
            serialNumber: "SN-001",
            condition: "nuevo",
            color: "Negro",
          },
        ],
      })
    ).resolves.toEqual(expect.objectContaining({ id: 77 }));

    expect(updateInvoiceItemAssetDetailsSpy).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        isFixedAsset: true,
        isLeasing: true,
        lineObservation: "Activo recibido en buen estado",
        assetDetails: [
          expect.objectContaining({
            serialNumber: "SN-001",
            condition: "nuevo",
            color: "Negro",
          }),
        ],
      })
    );

    getInvoiceByIdSpy.mockRestore();
    updateInvoiceItemAssetDetailsSpy.mockRestore();
  });

  it("blocks fixed asset invoice updates outside draft statuses", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        status: "revisada",
      },
      items: [{ id: 77, quantity: "1.00" }],
    } as any);
    const updateInvoiceItemAssetDetailsSpy = vi.spyOn(
      db,
      "updateInvoiceItemAssetDetails"
    );

    await expect(
      caller.invoices.updateItemAssetDetails({
        id: 10,
        invoiceItemId: 77,
        isFixedAsset: true,
        assetDetails: [{ serialNumber: "SN-001", condition: "nuevo" }],
      })
    ).rejects.toThrow(
      "Solo se pueden editar facturas en borrador o rechazadas"
    );

    expect(updateInvoiceItemAssetDetailsSpy).not.toHaveBeenCalled();
    getInvoiceByIdSpy.mockRestore();
    updateInvoiceItemAssetDetailsSpy.mockRestore();
  });

  it("rejects invoice fixed asset details when quantity is decimal", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      items: [{ id: 77, quantity: "1.50" }],
    } as any);
    const updateInvoiceItemAssetDetailsSpy = vi.spyOn(
      db,
      "updateInvoiceItemAssetDetails"
    );

    await expect(
      caller.invoices.updateItemAssetDetails({
        id: 10,
        invoiceItemId: 77,
        isFixedAsset: true,
        assetDetails: [{ serialNumber: "SN-001", condition: "nuevo" }],
      })
    ).rejects.toThrow(
      "Activo fijo requiere que la cantidad de la línea sea exactamente 1"
    );

    expect(updateInvoiceItemAssetDetailsSpy).not.toHaveBeenCalled();
    getInvoiceByIdSpy.mockRestore();
    updateInvoiceItemAssetDetailsSpy.mockRestore();
  });

  it("saves catalog retentions for draft invoices", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const replaceInvoiceRetentionsSpy = vi
      .spyOn(db, "replaceInvoiceRetentions")
      .mockResolvedValue({
        ...invoiceDetail.invoice,
        retentionTotal: "70.00",
        netPayable: "930.00",
      } as any);

    await expect(
      caller.invoices.replaceRetentions({
        id: 10,
        retentions: [
          {
            retentionCatalogId: 1,
            baseAmount: "1000.00",
          },
          {
            retentionCatalogId: 2,
            baseAmount: "500.00",
          },
        ],
      })
    ).resolves.toEqual(
      expect.objectContaining({
        retentionTotal: "70.00",
        netPayable: "930.00",
      })
    );
    expect(replaceInvoiceRetentionsSpy).toHaveBeenCalledWith(
      10,
      [
        expect.objectContaining({
          retentionCatalogId: 1,
          baseAmount: "1000.00",
        }),
        expect.objectContaining({
          retentionCatalogId: 2,
          baseAmount: "500.00",
        }),
      ],
      undefined
    );

    getInvoiceByIdSpy.mockRestore();
    replaceInvoiceRetentionsSpy.mockRestore();
  });

  it("requires retention receipt number before saving retentions", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      invoice: {
        ...invoiceDetail.invoice,
        retentionReceiptNumber: null,
      },
    } as any);
    const replaceInvoiceRetentionsSpy = vi.spyOn(
      db,
      "replaceInvoiceRetentions"
    );

    await expect(
      caller.invoices.replaceRetentions({
        id: 10,
        retentions: [
          {
            retentionCatalogId: 1,
            baseAmount: "1000.00",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Ingrese el número de comprobante de retención para guardar retenciones",
    });

    expect(replaceInvoiceRetentionsSpy).not.toHaveBeenCalled();
    getInvoiceByIdSpy.mockRestore();
    replaceInvoiceRetentionsSpy.mockRestore();
  });

  it("allows two different retentions on the same invoice line", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const replaceInvoiceRetentionsSpy = vi
      .spyOn(db, "replaceInvoiceRetentions")
      .mockResolvedValue({
        ...invoiceDetail.invoice,
        retentionTotal: "135.00",
        netPayable: "865.00",
      } as any);

    await expect(
      caller.invoices.replaceRetentions({
        id: 10,
        retentions: [
          {
            invoiceItemId: 77,
            retentionCatalogId: 1,
            baseAmount: "1000.00",
          },
          {
            invoiceItemId: 77,
            retentionCatalogId: 2,
            baseAmount: "1000.00",
          },
        ],
      })
    ).resolves.toEqual(
      expect.objectContaining({
        retentionTotal: "135.00",
        netPayable: "865.00",
      })
    );
    expect(replaceInvoiceRetentionsSpy).toHaveBeenCalledWith(
      10,
      [
        expect.objectContaining({
          invoiceItemId: 77,
          retentionCatalogId: 1,
          baseAmount: "1000.00",
        }),
        expect.objectContaining({
          invoiceItemId: 77,
          retentionCatalogId: 2,
          baseAmount: "1000.00",
        }),
      ],
      undefined
    );

    getInvoiceByIdSpy.mockRestore();
    replaceInvoiceRetentionsSpy.mockRestore();
  });

  it("returns a validation error when retentions exceed the invoice total", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const replaceInvoiceRetentionsSpy = vi
      .spyOn(db, "replaceInvoiceRetentions")
      .mockRejectedValue(
        new Error("El total de retenciones no puede exceder la factura")
      );

    await expect(
      caller.invoices.replaceRetentions({
        id: 10,
        retentions: [
          {
            retentionCatalogId: 1,
            baseAmount: "1000.00",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El total de retenciones no puede exceder la factura",
    });

    getInvoiceByIdSpy.mockRestore();
    replaceInvoiceRetentionsSpy.mockRestore();
  });

  it("returns a validation error when supplier does not allow retentions", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      ...invoiceDetail,
      supplier: {
        ...invoiceDetail.supplier,
        allowsTaxWithholding: false,
      },
    } as any);
    const replaceInvoiceRetentionsSpy = vi
      .spyOn(db, "replaceInvoiceRetentions")
      .mockRejectedValue(
        new Error("El proveedor no permite retención de impuestos")
      );

    await expect(
      caller.invoices.replaceRetentions({
        id: 10,
        retentions: [
          {
            retentionCatalogId: 1,
            baseAmount: "100.00",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El proveedor no permite retención de impuestos",
    });

    getInvoiceByIdSpy.mockRestore();
    replaceInvoiceRetentionsSpy.mockRestore();
  });

  it("returns a validation error when retentions exceed withholding base", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi
      .spyOn(db, "getInvoiceById")
      .mockResolvedValue(invoiceDetail);
    const replaceInvoiceRetentionsSpy = vi
      .spyOn(db, "replaceInvoiceRetentions")
      .mockRejectedValue(
        new Error(
          "El total de retenciones no puede exceder la base imponible de la factura"
        )
      );

    await expect(
      caller.invoices.replaceRetentions({
        id: 10,
        retentions: [
          {
            retentionCatalogId: 1,
            baseAmount: "600.00",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "El total de retenciones no puede exceder la base imponible de la factura",
    });

    getInvoiceByIdSpy.mockRestore();
    replaceInvoiceRetentionsSpy.mockRestore();
  });
});

// ============================================================
// Tests: Attachments
// ============================================================
describe("BuildReq - Document attachments", () => {
  const pdfBuffer = Buffer.from("%PDF-1.4\n% BuildReq test\n");
  const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

  function oversizedPdfBuffer() {
    const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
    buffer.write("%PDF-", 0, "ascii");
    return buffer;
  }

  function oversizedJpegBuffer() {
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    buffer[0] = 0xff;
    buffer[1] = 0xd8;
    buffer[2] = 0xff;
    return buffer;
  }

  it("accepts valid PDFs and stores the real decoded size", () => {
    expect(
      validateDocumentAttachmentFile({
        fileName: "factura.pdf",
        mimeType: "application/pdf",
        buffer: pdfBuffer,
      })
    ).toEqual(
      expect.objectContaining({
        fileName: "factura.pdf",
        mimeType: "application/pdf",
        fileSize: pdfBuffer.byteLength,
      })
    );
  });

  it("rejects oversized PDFs", () => {
    expect(() =>
      validateDocumentAttachmentFile({
        fileName: "factura.pdf",
        mimeType: "application/pdf",
        buffer: oversizedPdfBuffer(),
      })
    ).toThrow("El PDF no puede superar 10 MB");
  });

  it("rejects unsupported file types", () => {
    expect(() =>
      validateDocumentAttachmentFile({
        fileName: "nota.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hola"),
      })
    ).toThrow("Solo se permiten archivos PDF o imagenes JPG, PNG y WebP");
  });

  it("rejects files with a false MIME or extension", () => {
    expect(() =>
      validateDocumentAttachmentFile({
        fileName: "factura.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("no soy pdf"),
      })
    ).toThrow("El archivo no parece ser un PDF valido");
  });

  it("rejects images over the compressed image limit", () => {
    expect(() =>
      validateDocumentAttachmentFile({
        fileName: "evidencia.jpg",
        mimeType: "image/jpeg",
        buffer: oversizedJpegBuffer(),
      })
    ).toThrow("La imagen comprimida no puede superar 5 MB");
  });

  it("allows project administrators to upload purchase order attachments", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 44,
          projectId: 1,
          status: "emitida",
        },
      } as any);
    const storagePutSpy = vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "buildreq/purchase_order/44/test-factura.pdf",
      url: "https://storage.local/factura.pdf",
    });
    const createAttachmentSpy = vi
      .spyOn(db, "createAttachment")
      .mockResolvedValue({ id: 700 });

    await expect(
      caller.attachments.upload({
        entityType: "purchase_order",
        entityId: 44,
        fileName: "factura.pdf",
        fileData: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileSize: 1,
        category: "orden_compra",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: 700,
        url: "https://storage.local/factura.pdf",
      })
    );
    expect(createAttachmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "purchase_order",
        entityId: 44,
        fileName: "factura.pdf",
        mimeType: "application/pdf",
        fileSize: pdfBuffer.byteLength,
      })
    );

    getPurchaseOrderByIdSpy.mockRestore();
    storagePutSpy.mockRestore();
    createAttachmentSpy.mockRestore();
  });

  it("blocks project warehouse users from uploading purchase order attachments", async () => {
    const { ctx } = createProjectBodegueroContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 44,
          projectId: 1,
          status: "emitida",
        },
      } as any);
    const storagePutSpy = vi.spyOn(storage, "storagePut");

    await expect(
      caller.attachments.upload({
        entityType: "purchase_order",
        entityId: 44,
        fileName: "factura.pdf",
        fileData: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileSize: pdfBuffer.byteLength,
        category: "orden_compra",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "No tiene permisos para administrar adjuntos de órdenes de compra",
    });
    expect(storagePutSpy).not.toHaveBeenCalled();

    getPurchaseOrderByIdSpy.mockRestore();
    storagePutSpy.mockRestore();
  });

  it("lets Contable view reviewed and accounted invoice attachments but not upload them", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      invoice: {
        id: 10,
        projectId: 1,
        status: "revisada",
      },
    } as any);
    const getAttachmentsByEntitySpy = vi
      .spyOn(db, "getAttachmentsByEntity")
      .mockResolvedValue([
        {
          id: 99,
          fileName: "factura.pdf",
          fileKey: "buildreq/invoice/10/factura.pdf",
        },
      ] as any);
    const storageGetSpy = vi.spyOn(storage, "storageGet").mockResolvedValue({
      key: "buildreq/invoice/10/factura.pdf",
      url: "https://storage.local/factura.pdf",
    });
    const storagePutSpy = vi.spyOn(storage, "storagePut");

    await expect(
      caller.attachments.getByEntity({
        entityType: "invoice",
        entityId: 10,
      })
    ).resolves.toEqual([expect.objectContaining({ id: 99 })]);

    getInvoiceByIdSpy.mockResolvedValue({
      invoice: {
        id: 10,
        projectId: 1,
        status: "registrada",
      },
    } as any);
    await expect(
      caller.attachments.getByEntity({
        entityType: "invoice",
        entityId: 10,
      })
    ).resolves.toEqual([expect.objectContaining({ id: 99 })]);

    await expect(
      caller.attachments.upload({
        entityType: "invoice",
        entityId: 10,
        fileName: "factura.pdf",
        fileData: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileSize: pdfBuffer.byteLength,
        category: "factura",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "No tiene permisos para administrar adjuntos de facturas",
    });
    expect(storagePutSpy).not.toHaveBeenCalled();

    getInvoiceByIdSpy.mockRestore();
    getAttachmentsByEntitySpy.mockRestore();
    storageGetSpy.mockRestore();
    storagePutSpy.mockRestore();
  });

  it("lets Superintendente view assigned requisition attachments but not upload them", async () => {
    const { ctx } = createSuperintendentContext({
      assignedProjectId: 1,
      assignedProjectIds: [1],
    });
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 55,
          requestedById: 99,
          projectId: 1,
        },
      } as any);
    const getAttachmentsByEntitySpy = vi
      .spyOn(db, "getAttachmentsByEntity")
      .mockResolvedValue([
        {
          id: 99,
          fileName: "soporte.pdf",
          fileKey: "buildreq/material_request/55/soporte.pdf",
        },
      ] as any);
    const storageGetSpy = vi.spyOn(storage, "storageGet").mockResolvedValue({
      key: "buildreq/material_request/55/soporte.pdf",
      url: "https://storage.local/soporte.pdf",
    });
    const storagePutSpy = vi.spyOn(storage, "storagePut");

    await expect(
      caller.attachments.getByEntity({
        entityType: "material_request",
        entityId: 55,
      })
    ).resolves.toEqual([expect.objectContaining({ id: 99 })]);

    await expect(
      caller.attachments.upload({
        entityType: "material_request",
        entityId: 55,
        fileName: "soporte.pdf",
        fileData: pdfBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileSize: pdfBuffer.byteLength,
        category: "otro",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "No tiene permisos para administrar adjuntos de esta requisicion",
    });
    expect(storagePutSpy).not.toHaveBeenCalled();

    getMaterialRequestByIdSpy.mockRestore();
    getAttachmentsByEntitySpy.mockRestore();
    storageGetSpy.mockRestore();
    storagePutSpy.mockRestore();
  });

  it("blocks Contable from viewing draft invoice attachments", async () => {
    const { ctx } = createContableContext();
    const caller = appRouter.createCaller(ctx);
    const getInvoiceByIdSpy = vi.spyOn(db, "getInvoiceById").mockResolvedValue({
      invoice: {
        id: 10,
        projectId: 1,
        status: "borrador",
      },
    } as any);
    const getAttachmentsByEntitySpy = vi.spyOn(db, "getAttachmentsByEntity");

    await expect(
      caller.attachments.getByEntity({
        entityType: "invoice",
        entityId: 10,
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Contabilidad solo puede ver adjuntos de facturas revisadas o contabilizadas",
    });
    expect(getAttachmentsByEntitySpy).not.toHaveBeenCalled();

    getInvoiceByIdSpy.mockRestore();
    getAttachmentsByEntitySpy.mockRestore();
  });

  it("deletes attachment files from storage after authorization", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getAttachmentByIdSpy = vi
      .spyOn(db, "getAttachmentById")
      .mockResolvedValue({
        id: 700,
        entityType: "purchase_order",
        entityId: 44,
        fileKey: "buildreq/purchase_order/44/factura.pdf",
      } as any);
    const getPurchaseOrderByIdSpy = vi
      .spyOn(db, "getPurchaseOrderById")
      .mockResolvedValue({
        purchaseOrder: {
          id: 44,
          projectId: 1,
          status: "emitida",
        },
      } as any);
    const storageDeleteSpy = vi
      .spyOn(storage, "storageDelete")
      .mockResolvedValue({ key: "buildreq/purchase_order/44/factura.pdf" });
    const deleteAttachmentSpy = vi
      .spyOn(db, "deleteAttachment")
      .mockResolvedValue({ success: true });

    await expect(caller.attachments.delete({ id: 700 })).resolves.toEqual({
      success: true,
    });
    expect(storageDeleteSpy).toHaveBeenCalledWith(
      "buildreq/purchase_order/44/factura.pdf"
    );

    getAttachmentByIdSpy.mockRestore();
    getPurchaseOrderByIdSpy.mockRestore();
    storageDeleteSpy.mockRestore();
    deleteAttachmentSpy.mockRestore();
  });
});

// ============================================================
// Tests: Transfer Requests
// ============================================================
describe("BuildReq - Transfer Requests", () => {
  it("convertToTransfer accepts partial and zero quantities for open-flow remainders", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferRequestByIdSpy = vi
      .spyOn(db, "getTransferRequestById")
      .mockResolvedValue({
        transferRequest: {
          id: 6,
          requestNumber: "ST-2026-0001",
          status: "pendiente",
        },
        items: [
          { id: 31, materialRequestItemId: 21, quantity: "10.00" },
          { id: 32, materialRequestItemId: 22, quantity: "5.00" },
        ],
      } as any);
    const createTransferFromRequestSpy = vi
      .spyOn(db, "createTransferFromRequest")
      .mockResolvedValue({
        id: 44,
        transferNumber: "TR-2026-0001",
        guideNumber: "GR-2026-0001",
        sapCorrelative: "SAP-GR-2026-0001",
      } as any);

    await expect(
      caller.transferRequests.convertToTransfer({
        id: 6,
        items: [
          {
            transferRequestItemId: 31,
            quantity: "6.00",
            sourceProjectId: 3,
            sourceWarehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
          },
          { transferRequestItemId: 32, quantity: "0.00" },
        ],
      })
    ).resolves.toEqual(
      expect.objectContaining({
        id: 44,
        transferNumber: "TR-2026-0001",
      })
    );

    expect(createTransferFromRequestSpy).toHaveBeenCalledWith(6, 3, [
      {
        transferRequestItemId: 31,
        quantity: "6.00",
        sourceProjectId: 3,
        sourceWarehouseId: DEFAULT_PROJECT_WAREHOUSE_ID,
      },
      { transferRequestItemId: 32, quantity: "0.00" },
    ]);

    getTransferRequestByIdSpy.mockRestore();
    createTransferFromRequestSpy.mockRestore();
  });

  it("cancel annuls a pending transfer request and returns transfer items to open flow selection", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferRequestByIdSpy = vi
      .spyOn(db, "getTransferRequestById")
      .mockResolvedValue({
        transferRequest: {
          id: 6,
          requestNumber: "ST-2026-0001",
          status: "pendiente",
          materialRequestId: 9,
        },
        items: [
          { id: 31, materialRequestItemId: 21 },
          { id: 32, materialRequestItemId: 22 },
        ],
      } as any);
    const getRequestItemByIdSpy = vi
      .spyOn(db, "getRequestItemById")
      .mockImplementation(
        async (id: number) =>
          ({
            21: { id: 21, requestId: 9, assignedFlow: "traslado_proyecto" },
            22: { id: 22, requestId: 9, assignedFlow: "traslado_proyecto" },
          })[id] as any
      );
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true });
    const getActiveSupplyFlowForRequestItemSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockImplementation(
        async ({ requestItemId }: { requestItemId: number }) =>
          ({ id: requestItemId + 300 }) as any
      );
    const updateSupplyFlowRecordSpy = vi
      .spyOn(db, "updateSupplyFlowRecord")
      .mockResolvedValue({ success: true });
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([
        { id: 21, assignedFlow: null },
        { id: 22, assignedFlow: null },
      ] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true });
    const updateTransferRequestSpy = vi
      .spyOn(db, "updateTransferRequest")
      .mockResolvedValue({ success: true });

    await expect(caller.transferRequests.cancel({ id: 6 })).resolves.toEqual({
      success: true,
    });

    expect(updateRequestItemSpy).toHaveBeenCalledWith(21, {
      assignedFlow: null,
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(22, {
      assignedFlow: null,
      status: "pendiente",
    });
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(321, {
      status: "cancelado",
      notes: "Flujo cancelado por anular la solicitud ST-2026-0001",
    });
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(322, {
      status: "cancelado",
      notes: "Flujo cancelado por anular la solicitud ST-2026-0001",
    });
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      9,
      "en_espera",
      3
    );
    expect(updateTransferRequestSpy).toHaveBeenCalledWith(6, {
      status: "anulada",
      rejectionReason: "Solicitud anulada manualmente",
    });

    getTransferRequestByIdSpy.mockRestore();
    getRequestItemByIdSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
    updateTransferRequestSpy.mockRestore();
  });

  it("cancel returns linked reverse logistics to pending status", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferRequestByIdSpy = vi
      .spyOn(db, "getTransferRequestById")
      .mockResolvedValue({
        transferRequest: {
          id: 6,
          requestNumber: "ST-001-00000006",
          status: "pendiente",
          reverseLogisticId: 88,
        },
        items: [],
      } as any);
    const updateTransferRequestSpy = vi
      .spyOn(db, "updateTransferRequest")
      .mockResolvedValue({ success: true });
    const updateReverseLogisticStatusSpy = vi
      .spyOn(db, "updateReverseLogisticStatus")
      .mockResolvedValue({ success: true });

    await expect(caller.transferRequests.cancel({ id: 6 })).resolves.toEqual({
      success: true,
    });

    expect(updateTransferRequestSpy).toHaveBeenCalledWith(6, {
      status: "anulada",
      rejectionReason: "Solicitud anulada manualmente",
    });
    expect(updateReverseLogisticStatusSpy).toHaveBeenCalledWith(
      88,
      "pendiente"
    );

    getTransferRequestByIdSpy.mockRestore();
    updateTransferRequestSpy.mockRestore();
    updateReverseLogisticStatusSpy.mockRestore();
  });

  it("cancel only allows pending transfer requests", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getTransferRequestByIdSpy = vi
      .spyOn(db, "getTransferRequestById")
      .mockResolvedValue({
        transferRequest: {
          id: 6,
          requestNumber: "ST-2026-0001",
          status: "convertida",
        },
        items: [],
      } as any);

    await expect(caller.transferRequests.cancel({ id: 6 })).rejects.toThrow(
      "Solo se puede cancelar una solicitud de traslado pendiente"
    );

    getTransferRequestByIdSpy.mockRestore();
  });
});

// ============================================================
// Tests: v6 Fixes - Auto-numbering and Supplier
// ============================================================
describe("BuildReq - v6 Auto-numbering and Supplier", () => {
  it("builds project-scoped document numbers by type and project", () => {
    expect(
      db.buildProjectScopedDocumentNumber({
        prefix: "OC",
        projectCode: "004",
        existingNumbers: [],
      })
    ).toBe("OC-004-00000001");

    expect(
      db.buildProjectScopedDocumentNumber({
        prefix: "OC",
        projectCode: "004",
        existingNumbers: ["OC-004-00000001"],
      })
    ).toBe("OC-004-00000002");

    expect(
      db.buildProjectScopedDocumentNumber({
        prefix: "OC",
        projectCode: "006",
        existingNumbers: ["OC-004-00000001", "OC-004-00000002"],
      })
    ).toBe("OC-006-00000001");

    expect(
      db.buildProjectScopedDocumentNumber({
        prefix: "SC",
        projectCode: "004",
        existingNumbers: ["OC-004-00000001", "OC-004-00000002"],
      })
    ).toBe("SC-004-00000001");

    expect(
      db.buildProjectScopedDocumentNumber({
        prefix: "OC",
        projectCode: "004B",
        existingNumbers: [],
      })
    ).toBe("OC-004B-00000001");

    expect(
      db.buildProjectScopedDocumentNumber({
        prefix: "OC",
        projectCode: "004",
        existingNumbers: [
          "OC-2026-0004",
          "OC-004-00000002",
          "OC-004-00000010",
          "OC-004-9999",
        ],
      })
    ).toBe("OC-004-00000011");
  });

  it("createDirectPurchase accepts optional supplierId", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    // Should not throw validation error for supplierId (DB error is acceptable)
    try {
      await caller.supplyFlows.createDirectPurchase({
        requestId: 999,
        requestItemId: 999,
        paymentMethod: "linea_credito",
        supplierId: 5,
      });
    } catch (e: any) {
      // DB not available or record not found is acceptable
      if (
        !e.message?.includes("DB not available") &&
        !e.message?.includes("database") &&
        !e.message?.includes("ECONNRESET") &&
        !e.message?.includes("Cannot read")
      ) {
        // If it's a validation error, that's a real failure
        if (e.code === "BAD_REQUEST") throw e;
      }
    }
  });

  it("project administrator can query latest supplier prices scoped to their project", async () => {
    const { ctx } = createProjectAdminContext();
    const caller = appRouter.createCaller(ctx);
    const getLatestSupplierPurchasePricesSpy = vi
      .spyOn(db, "getLatestSupplierPurchasePrices")
      .mockResolvedValue({
        "05050200058": {
          unitPrice: "125.50",
          supplierId: 7,
          supplierCode: "PL-00889",
          supplierName: "AC/DC INGENERIA INTEGRAL S DE R L DE C V",
          orderNumber: "OC-2026-0010",
          purchasedAt: new Date("2026-04-12"),
        },
      } as any);

    await expect(
      caller.purchaseOrders.latestSupplierPrices({
        supplierId: 7,
        sapCodes: ["05050200058"],
      })
    ).resolves.toEqual({
      "05050200058": {
        unitPrice: "125.50",
        supplierId: 7,
        supplierCode: "PL-00889",
        supplierName: "AC/DC INGENERIA INTEGRAL S DE R L DE C V",
        orderNumber: "OC-2026-0010",
        purchasedAt: new Date("2026-04-12"),
      },
    });

    expect(getLatestSupplierPurchasePricesSpy).toHaveBeenCalledWith({
      supplierId: 7,
      sapCodes: ["05050200058"],
      projectIds: [1],
    });

    getLatestSupplierPurchasePricesSpy.mockRestore();
  });

  it("createDirectPurchase works without supplierId", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    try {
      await caller.supplyFlows.createDirectPurchase({
        requestId: 999,
        requestItemId: 999,
        paymentMethod: "caja_chica",
        // No supplierId - should be fine
      });
    } catch (e: any) {
      if (
        !e.message?.includes("DB not available") &&
        !e.message?.includes("database") &&
        !e.message?.includes("ECONNRESET") &&
        !e.message?.includes("Cannot read")
      ) {
        if (e.code === "BAD_REQUEST") throw e;
      }
    }
  });

  it("createDirectPurchaseBatch creates one purchase request for the selected direct purchase items", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockResolvedValue({
        request: {
          id: 10,
          projectId: 3,
          requestType: "bienes",
          approvalStatus: "aprobada",
          neededBy: new Date("2026-04-30"),
        },
        items: [
          {
            id: 101,
            itemName: "Cal",
            sapItemCode: "02020100044",
            quantity: "100.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
          {
            id: 102,
            itemName: "Cemento",
            sapItemCode: "05050200058",
            quantity: "200.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
          {
            id: 103,
            itemName: "Aceite",
            sapItemCode: "01010200002",
            quantity: "20.00",
            unit: "und",
            approvalStatus: "aprobada",
          },
        ],
      } as any);
    const getActiveSupplyFlowSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({ id: 501, requestNumber: "SC-2026-0005" });
    const createRequestItemSpy = vi
      .spyOn(db, "createRequestItem")
      .mockResolvedValue({ id: 301 });
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true });
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 900 } as any);
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([
        { id: 101, assignedFlow: "compra_directa" },
        { id: 102, assignedFlow: "compra_directa" },
        { id: 103, assignedFlow: "compra_directa" },
      ] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true });

    await expect(
      caller.supplyFlows.createDirectPurchaseBatch({
        requestId: 10,
        paymentMethod: "linea_credito",
        supplierId: 7,
        notes: "Compra agrupada por proveedor",
        items: [
          { requestItemId: 101, quantity: "100.00" },
          { requestItemId: 103, quantity: "10.00" },
        ],
      })
    ).resolves.toEqual({
      success: true,
      purchaseRequestId: 501,
      purchaseRequestNumber: "SC-2026-0005",
      processedItems: 2,
    });

    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        materialRequestId: 10,
        projectId: 3,
        purchaseType: "compra_directa",
        status: "pendiente",
      }),
      [
        expect.objectContaining({ materialRequestItemId: 101 }),
        expect.objectContaining({
          materialRequestItemId: 301,
          quantity: "10.00",
        }),
      ]
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 10,
        purchaseOrderNumber: "SC-2026-0005",
        sapDocumentType: "solicitud_compra",
        status: "pendiente",
      })
    );
    expect(updateRequestItemSpy).toHaveBeenCalledWith(103, {
      quantity: "10.00",
    });
    expect(createRequestItemSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 10,
        itemName: "Aceite",
        quantity: "10.00",
        assignedFlow: "compra_directa",
        approvalStatus: "aprobada",
      })
    );

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    createRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("createDirectPurchaseBatch consolidates same-project items into one purchase request and merges same SAP quantities", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockImplementation(async (requestId: number) => {
        const details: Record<number, any> = {
          10: {
            request: {
              id: 10,
              projectId: 3,
              requestType: "bienes",
              approvalStatus: "aprobada",
              neededBy: new Date("2026-04-30"),
            },
            items: [
              {
                id: 101,
                itemName: "Cemento",
                sapItemCode: "05050200058",
                sapItemDescription: "CEMENTO GRANEL",
                quantity: "100.00",
                unit: "und",
                approvalStatus: "aprobada",
              },
            ],
          },
          11: {
            request: {
              id: 11,
              projectId: 3,
              requestType: "bienes",
              approvalStatus: "aprobada",
              neededBy: new Date("2026-04-28"),
            },
            items: [
              {
                id: 201,
                itemName: "Cemento",
                sapItemCode: "05050200058",
                sapItemDescription: "CEMENTO GRANEL",
                quantity: "200.00",
                unit: "und",
                approvalStatus: "aprobada",
              },
            ],
          },
        };

        return details[requestId] as any;
      });
    const getActiveSupplyFlowSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({ id: 601, requestNumber: "SC-2026-0010" });
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true });
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 901 } as any);
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([{ id: 1, assignedFlow: "compra_directa" }] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true });

    await expect(
      caller.supplyFlows.createDirectPurchaseBatch({
        paymentMethod: "linea_credito",
        supplierId: 7,
        notes: "Compra consolidada",
        items: [
          { requestId: 10, requestItemId: 101, quantity: "100.00" },
          { requestId: 11, requestItemId: 201, quantity: "200.00" },
        ],
      })
    ).resolves.toEqual({
      success: true,
      purchaseRequestId: 601,
      purchaseRequestNumber: "SC-2026-0010",
      processedItems: 2,
    });

    expect(createPurchaseRequestSpy).toHaveBeenCalledTimes(1);
    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 3,
        materialRequestId: null,
        purchaseType: "compra_directa",
        neededBy: new Date("2026-04-28"),
      }),
      [
        expect.objectContaining({
          materialRequestItemId: 101,
          currentSapItemCode: "05050200058",
          quantity: "300.00",
        }),
      ]
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledTimes(2);
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 10,
        requestItemId: 101,
        purchaseOrderNumber: "SC-2026-0010",
      })
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 11,
        requestItemId: 201,
        purchaseOrderNumber: "SC-2026-0010",
      })
    );
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      10,
      "en_proceso",
      ctx.user.id
    );
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      11,
      "en_proceso",
      ctx.user.id
    );
    expect(updateRequestItemSpy).toHaveBeenCalledWith(101, {
      assignedFlow: "compra_directa",
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(201, {
      assignedFlow: "compra_directa",
      status: "pendiente",
    });

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("createDirectPurchaseBatch creates a single purchase request for same-supplier items across different projects", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);
    const getMaterialRequestByIdSpy = vi
      .spyOn(db, "getMaterialRequestById")
      .mockImplementation(async (requestId: number) => {
        const details: Record<number, any> = {
          15: {
            request: {
              id: 15,
              projectId: 6,
              requestType: "bienes",
              approvalStatus: "aprobada",
              neededBy: new Date("2026-04-30"),
            },
            items: [
              {
                id: 41,
                itemName: "PRODUCTO 4",
                quantity: "250.00",
                unit: "und",
                approvalStatus: "aprobada",
              },
            ],
          },
          17: {
            request: {
              id: 17,
              projectId: 4,
              requestType: "bienes",
              approvalStatus: "aprobada",
              neededBy: new Date("2026-04-28"),
            },
            items: [
              {
                id: 47,
                itemName: "llantas",
                sapItemCode: "03030200025",
                sapItemDescription: "CALIBRADOR AIRE LLANTAS 150PSI",
                quantity: "40.00",
                unit: "und",
                approvalStatus: "aprobada",
              },
              {
                id: 48,
                itemName: "palas",
                sapItemCode: "03030100035",
                sapItemDescription: "PALA HOYADORA MANUAL",
                quantity: "400.00",
                unit: "und",
                approvalStatus: "aprobada",
              },
            ],
          },
        };

        return details[requestId] as any;
      });
    const getActiveSupplyFlowSpy = vi
      .spyOn(db, "getActiveSupplyFlowForRequestItem")
      .mockResolvedValue(undefined);
    const createPurchaseRequestSpy = vi
      .spyOn(db, "createPurchaseRequest")
      .mockResolvedValue({ id: 777, requestNumber: "SC-2026-0099" });
    const updateRequestItemSpy = vi
      .spyOn(db, "updateRequestItem")
      .mockResolvedValue({ success: true });
    const createSupplyFlowRecordSpy = vi
      .spyOn(db, "createSupplyFlowRecord")
      .mockResolvedValue({ id: 903 } as any);
    const getRequestItemsByRequestIdSpy = vi
      .spyOn(db, "getRequestItemsByRequestId")
      .mockResolvedValue([{ id: 1, assignedFlow: "compra_directa" }] as any);
    const updateMaterialRequestStatusSpy = vi
      .spyOn(db, "updateMaterialRequestStatus")
      .mockResolvedValue({ success: true });

    await expect(
      caller.supplyFlows.createDirectPurchaseBatch({
        paymentMethod: "linea_credito",
        supplierId: 8,
        notes: "Unificar SC por proveedor",
        items: [
          { requestId: 17, requestItemId: 47, quantity: "40.00" },
          { requestId: 17, requestItemId: 48, quantity: "400.00" },
          { requestId: 15, requestItemId: 41, quantity: "250.00" },
        ],
      })
    ).resolves.toEqual({
      success: true,
      purchaseRequestId: 777,
      purchaseRequestNumber: "SC-2026-0099",
      processedItems: 3,
    });

    expect(createPurchaseRequestSpy).toHaveBeenCalledTimes(1);
    expect(createPurchaseRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        materialRequestId: null,
        purchaseType: "compra_directa",
      }),
      [
        expect.objectContaining({ materialRequestItemId: 47 }),
        expect.objectContaining({ materialRequestItemId: 48 }),
        expect.objectContaining({ materialRequestItemId: 41 }),
      ]
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledTimes(3);
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      17,
      "en_proceso",
      ctx.user.id
    );
    expect(updateMaterialRequestStatusSpy).toHaveBeenCalledWith(
      15,
      "en_proceso",
      ctx.user.id
    );

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowSpy.mockRestore();
    createPurchaseRequestSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("createFromPurchaseRequest can convert a partial quantity and leave SC pending", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 72,
          projectId: 3,
          requestNumber: "SC-2026-0072",
          purchaseType: "local",
          neededBy: new Date("2026-05-20"),
          sapDocumentNumber: null,
          notes: "Compra parcial",
        },
        items: [
          {
            id: 7201,
            materialRequestItemId: 101,
            originalSapItemCode: "05050200059",
            currentSapItemCode: "05050200059",
            itemName: "CEMENTO GU EN SACO ARGOS 42.5 KG",
            quantity: "200.00",
            convertedQuantity: "0.00",
            pendingConversionQuantity: "200.00",
            receivedQuantity: "0.00",
            unit: "und",
            unitPrice: "100.00",
            notes: null,
          },
        ],
      } as any);
    const listDirectPurchaseFlowItemsByOrderSpy = vi
      .spyOn(db, "listDirectPurchaseFlowItemsByOrder")
      .mockResolvedValue([] as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValue({ id: 1701, orderNumber: "OC-2026-0170" });
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 72 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("parcialmente_convertida" as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 72,
        itemsToConvert: [
          {
            purchaseRequestItemId: 7201,
            quantity: "100.00",
            unitPrice: "125.50",
            taxCode: "isv_15",
          },
        ],
      })
    ).resolves.toEqual({
      success: true,
      purchaseOrderId: 1701,
      purchaseOrderNumber: "OC-2026-0170",
    });

    expect(createPurchaseOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseRequestId: 72 }),
      [
        expect.objectContaining({
          purchaseRequestItemId: 7201,
          quantity: "100.00",
          receivedQuantity: "0.00",
          unitPrice: "125.50",
          taxCode: "isv_15",
        }),
      ]
    );
    expect(adjustPurchaseRequestItemConvertedQuantitySpy).toHaveBeenCalledWith(
      7201,
      "100.00"
    );
    expect(syncPurchaseRequestConversionStatusSpy).toHaveBeenCalledWith(72);

    getPurchaseRequestByIdSpy.mockRestore();
    listDirectPurchaseFlowItemsByOrderSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("createFromPurchaseRequest rejects quantities above the pending SC balance", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 73,
          projectId: 3,
          requestNumber: "SC-2026-0073",
          purchaseType: "local",
          status: "pendiente",
        },
        items: [
          {
            id: 7301,
            itemName: "CEMENTO",
            quantity: "200.00",
            convertedQuantity: "0.00",
            pendingConversionQuantity: "200.00",
            receivedQuantity: "0.00",
            unit: "und",
          },
        ],
      } as any);
    const createPurchaseOrderSpy = vi.spyOn(db, "createPurchaseOrder");

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 73,
        itemsToConvert: [{ purchaseRequestItemId: 7301, quantity: "201.00" }],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La cantidad a convertir de CEMENTO excede el saldo pendiente",
    });

    expect(createPurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
  });

  it("createFromPurchaseRequest keeps direct purchase requests as CD and updates their flow to the generated OC", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 55,
          projectId: 3,
          requestNumber: "SC-2026-0012",
          purchaseType: "local",
          neededBy: new Date("2026-05-02"),
          sapDocumentNumber: null,
          notes: "SC desde compra directa",
        },
        items: [
          {
            id: 501,
            materialRequestItemId: 101,
            originalSapItemCode: "05050200058",
            currentSapItemCode: "05050200058",
            itemName: "CEMENTO GRANEL",
            quantity: "300.00",
            receivedQuantity: "0.00",
            unit: "und",
            unitPrice: "118.75",
            notes: "Compra consolidada",
          },
        ],
      } as any);
    const listDirectPurchaseFlowItemsByOrderSpy = vi
      .spyOn(db, "listDirectPurchaseFlowItemsByOrder")
      .mockResolvedValue([
        {
          flow: { id: 81, notes: "SC desde compra directa", supplierId: 7 },
          item: { id: 101 },
        },
      ] as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValue({ id: 901, orderNumber: "OC-2026-0042" });
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 55 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("convertida" as any);
    const updateSupplyFlowRecordSpy = vi
      .spyOn(db, "updateSupplyFlowRecord")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 55,
        selectedItemIds: [501],
      })
    ).resolves.toEqual({
      success: true,
      purchaseOrderId: 901,
      purchaseOrderNumber: "OC-2026-0042",
    });

    expect(createPurchaseOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseRequestId: 55,
        classification: "cd",
        supplierId: 7,
      }),
      [
        expect.objectContaining({
          purchaseRequestItemId: 501,
          unitPrice: "118.75",
        }),
      ]
    );
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledTimes(1);
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(
      81,
      expect.objectContaining({
        purchaseOrderNumber: "OC-2026-0042",
        sapDocumentType: "orden_compra",
        status: "en_proceso",
      })
    );

    getPurchaseRequestByIdSpy.mockRestore();
    listDirectPurchaseFlowItemsByOrderSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
    updateSupplyFlowRecordSpy.mockRestore();
  });

  it("Project admin can create an OC from an own-project direct purchase request", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 3 });
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 58,
          projectId: 3,
          requestNumber: "SC-2026-0015",
          purchaseType: "compra_directa",
          neededBy: new Date("2026-05-08"),
          sapDocumentNumber: null,
          notes: "SC proyecto",
        },
        items: [
          {
            id: 701,
            materialRequestItemId: null,
            originalSapItemCode: "03030200025",
            currentSapItemCode: "03030200025",
            itemName: "CALIBRADOR AIRE LLANTAS",
            quantity: "4.00",
            receivedQuantity: "0.00",
            unit: "und",
            notes: null,
          },
        ],
      } as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValue({ id: 1003, orderNumber: "OC-2026-0052" });
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 58 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("convertida" as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 58,
        selectedItemIds: [701],
      })
    ).resolves.toEqual({
      success: true,
      purchaseOrderId: 1003,
      purchaseOrderNumber: "OC-2026-0052",
    });

    expect(createPurchaseOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseRequestId: 58,
        projectId: 3,
        classification: "oc",
        createdById: 5,
      }),
      [expect.objectContaining({ purchaseRequestItemId: 701 })]
    );

    getPurchaseRequestByIdSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("Project admin can create an OC from an own-project local purchase request", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 3 });
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 62,
          projectId: 3,
          requestNumber: "SC-2026-0019",
          status: "pendiente",
          purchaseType: "local",
          neededBy: new Date("2026-05-12"),
          sapDocumentNumber: null,
          notes: null,
        },
        items: [
          {
            id: 1001,
            materialRequestItemId: null,
            originalSapItemCode: "01010100001",
            currentSapItemCode: "01010100001",
            itemName: "PRODUCTO LOCAL",
            quantity: "1.00",
            unit: "und",
          },
        ],
      } as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValue({ id: 1004, orderNumber: "OC-2026-0053" });
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 62 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("convertida" as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 62,
        selectedItemIds: [1001],
      })
    ).resolves.toEqual({
      success: true,
      purchaseOrderId: 1004,
      purchaseOrderNumber: "OC-2026-0053",
    });
    expect(createPurchaseOrderSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseRequestId: 62,
        projectId: 3,
        purchaseType: "local",
        createdById: 5,
      }),
      [expect.objectContaining({ purchaseRequestItemId: 1001 })]
    );

    getPurchaseRequestByIdSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("Project admin cannot create an OC for another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 3 });
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 59,
          projectId: 4,
          requestNumber: "SC-2026-0016",
          status: "pendiente",
        },
        items: [
          {
            id: 801,
            itemName: "PRODUCTO",
            quantity: "1.00",
            unit: "und",
          },
        ],
      } as any);
    const createPurchaseOrderSpy = vi.spyOn(db, "createPurchaseOrder");

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 59,
        selectedItemIds: [801],
      })
    ).rejects.toThrow("No tiene acceso a órdenes de compra de otro proyecto");
    expect(createPurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
  });

  it("Project admin without assigned projects cannot create an OC for another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: null });
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 63,
          projectId: 4,
          requestNumber: "SC-2026-0020",
          status: "pendiente",
          purchaseType: "local",
          neededBy: new Date("2026-05-14"),
          sapDocumentNumber: null,
          notes: null,
        },
        items: [
          {
            id: 1002,
            materialRequestItemId: null,
            originalSapItemCode: "01010100002",
            currentSapItemCode: "01010100002",
            itemName: "PRODUCTO GLOBAL",
            quantity: "2.00",
            unit: "und",
          },
        ],
      } as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValue({ id: 1005, orderNumber: "OC-2026-0054" });
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockResolvedValue({ purchaseRequestId: 63 } as any);
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("convertida" as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 63,
        selectedItemIds: [1002],
      })
    ).rejects.toThrow("No tiene acceso a órdenes de compra de otro proyecto");
    expect(createPurchaseOrderSpy).not.toHaveBeenCalled();
    expect(
      adjustPurchaseRequestItemConvertedQuantitySpy
    ).not.toHaveBeenCalled();
    expect(syncPurchaseRequestConversionStatusSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
  });

  it("Project admin cannot create an OC with source items from another project", async () => {
    const { ctx } = createProjectAdminContext({ assignedProjectId: 3 });
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 60,
          projectId: 3,
          requestNumber: "SC-2026-0017",
          status: "pendiente",
          purchaseType: "compra_directa",
        },
        items: [
          {
            id: 901,
            materialRequestItemId: null,
            itemName: "PRODUCTO OTRO PROYECTO",
            quantity: "1.00",
            unit: "und",
            sourceProject: {
              id: 4,
              code: "004",
              name: "CA5 - MANTENIMIENTO RUTINARIO",
            },
          },
        ],
      } as any);
    const createPurchaseOrderSpy = vi.spyOn(db, "createPurchaseOrder");

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 60,
        selectedItemIds: [901],
      })
    ).rejects.toThrow("No tiene acceso a órdenes de compra de otro proyecto");
    expect(createPurchaseOrderSpy).not.toHaveBeenCalled();

    getPurchaseRequestByIdSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
  });

  it("createFromPurchaseRequest splits a mixed-project purchase request into one OC per project", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 56,
          projectId: 4,
          requestNumber: "SC-2026-0013",
          purchaseType: "local",
          neededBy: new Date("2026-05-04"),
          sapDocumentNumber: null,
          notes: "SC mixta por proveedor",
        },
        items: [
          {
            id: 601,
            materialRequestItemId: 47,
            originalSapItemCode: "03030200025",
            currentSapItemCode: "03030200025",
            itemName: "CALIBRADOR AIRE LLANTAS 150PSI",
            quantity: "40.00",
            receivedQuantity: "0.00",
            unit: "und",
            notes: "Compra directa",
            sourceProject: {
              id: 4,
              code: "004",
              name: "CA5 - MANTENIMIENTO RUTINARIO",
            },
          },
          {
            id: 602,
            materialRequestItemId: 41,
            originalSapItemCode: null,
            currentSapItemCode: null,
            itemName: "PRODUCTO 4",
            quantity: "250.00",
            receivedQuantity: "0.00",
            unit: "und",
            notes: "Compra directa",
            sourceProject: {
              id: 6,
              code: "006",
              name: "CA5 - MANTENIMIENTO PERIÓDICO",
            },
          },
        ],
      } as any);
    const listDirectPurchaseFlowItemsByOrderSpy = vi
      .spyOn(db, "listDirectPurchaseFlowItemsByOrder")
      .mockResolvedValue([
        {
          flow: { id: 91, notes: "SC mixta", supplierId: 8 },
          item: { id: 47 },
        },
        {
          flow: { id: 92, notes: "SC mixta", supplierId: 8 },
          item: { id: 41 },
        },
      ] as any);
    const createPurchaseOrderSpy = vi
      .spyOn(db, "createPurchaseOrder")
      .mockResolvedValueOnce({ id: 1001, orderNumber: "OC-2026-0050" })
      .mockResolvedValueOnce({ id: 1002, orderNumber: "OC-2026-0051" });
    const updatePurchaseRequestSpy = vi
      .spyOn(db, "updatePurchaseRequest")
      .mockResolvedValue({ success: true } as any);
    const adjustPurchaseRequestItemConvertedQuantitySpy = vi
      .spyOn(db, "adjustPurchaseRequestItemConvertedQuantity")
      .mockImplementation(
        async (id: number) =>
          ({
            id,
            purchaseRequestId: 56,
          }) as any
      );
    const syncPurchaseRequestConversionStatusSpy = vi
      .spyOn(db, "syncPurchaseRequestConversionStatus")
      .mockResolvedValue("convertida" as any);
    const updateSupplyFlowRecordSpy = vi
      .spyOn(db, "updateSupplyFlowRecord")
      .mockResolvedValue({ success: true } as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 56,
        selectedItemIds: [601, 602],
      })
    ).resolves.toEqual({
      success: true,
      purchaseOrders: [
        {
          projectId: 4,
          purchaseOrderId: 1001,
          purchaseOrderNumber: "OC-2026-0050",
        },
        {
          projectId: 6,
          purchaseOrderId: 1002,
          purchaseOrderNumber: "OC-2026-0051",
        },
      ],
    });

    expect(createPurchaseOrderSpy).toHaveBeenCalledTimes(2);
    expect(createPurchaseOrderSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        purchaseRequestId: 56,
        projectId: 4,
        classification: "cd",
        supplierId: 8,
      }),
      [expect.objectContaining({ purchaseRequestItemId: 601 })]
    );
    expect(createPurchaseOrderSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        purchaseRequestId: 56,
        projectId: 6,
        classification: "cd",
        supplierId: 8,
      }),
      [expect.objectContaining({ purchaseRequestItemId: 602 })]
    );
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(
      91,
      expect.objectContaining({ purchaseOrderNumber: "OC-2026-0050" })
    );
    expect(updateSupplyFlowRecordSpy).toHaveBeenCalledWith(
      92,
      expect.objectContaining({ purchaseOrderNumber: "OC-2026-0051" })
    );

    getPurchaseRequestByIdSpy.mockRestore();
    listDirectPurchaseFlowItemsByOrderSpy.mockRestore();
    createPurchaseOrderSpy.mockRestore();
    updatePurchaseRequestSpy.mockRestore();
    adjustPurchaseRequestItemConvertedQuantitySpy.mockRestore();
    syncPurchaseRequestConversionStatusSpy.mockRestore();
    updateSupplyFlowRecordSpy.mockRestore();
  });

  it("createFromPurchaseRequest rejects converted purchase requests", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);
    const getPurchaseRequestByIdSpy = vi
      .spyOn(db, "getPurchaseRequestById")
      .mockResolvedValue({
        purchaseRequest: {
          id: 57,
          projectId: 4,
          requestNumber: "SC-2026-0014",
          status: "convertida",
        },
        items: [],
      } as any);

    await expect(
      caller.purchaseOrders.createFromPurchaseRequest({
        purchaseRequestId: 57,
        selectedItemIds: [1],
      })
    ).rejects.toThrow(
      "La solicitud de compra ya fue convertida y solo está disponible en modo lectura"
    );

    getPurchaseRequestByIdSpy.mockRestore();
  });

  it("convertToPurchaseOrder no longer requires purchaseOrderNumber", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);

    // Should not throw validation error (DB error is acceptable)
    try {
      await caller.supplyFlows.convertToPurchaseOrder({
        flowId: 999,
        notes: "Test conversion",
      });
    } catch (e: any) {
      if (
        !e.message?.includes("DB not available") &&
        !e.message?.includes("database") &&
        !e.message?.includes("ECONNRESET") &&
        !e.message?.includes("Cannot read")
      ) {
        if (e.code === "BAD_REQUEST") throw e;
      }
    }
  });

  it("Bodega user cannot convert to PO", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.convertToPurchaseOrder({
        flowId: 1,
      })
    ).rejects.toThrow(
      "Solo Administración Central o el Administrador del Proyecto puede convertir a Orden de Compra"
    );
  });

  it("Ingeniero Residente cannot convert to PO", async () => {
    const { ctx } = createIngenieroContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.convertToPurchaseOrder({
        flowId: 1,
      })
    ).rejects.toThrow(
      "Solo Administración Central o el Administrador del Proyecto puede convertir a Orden de Compra"
    );
  });
});

// ============================================================
// Tests: Demo Data module
// ============================================================
describe("BuildReq - Demo Data module", () => {
  it("Non-admin users cannot see demo data status", async () => {
    const { ctx } = createAdminCentralContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.demoData.status()).rejects.toThrow();
  });

  it("Non-admin users cannot inspect import progress", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.demoData.latestImport()).rejects.toThrow();
  });

  it("Non-admin users cannot import demo data", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.demoData.import({
        projectsTsv:
          "Codigo de proyecto\tNombre de proyecto\n001\tOFICINA CENTRAL",
      })
    ).rejects.toThrow();
  });

  it("Admin can trigger demo data import with valid pasted content", async () => {
    const { ctx } = createUserContext({ role: "admin" });
    const caller = appRouter.createCaller(ctx);

    const result = await caller.demoData.import({
      projectsTsv:
        "Codigo de proyecto\tNombre de proyecto\n001\tOFICINA CENTRAL",
      articlesTsv:
        "Numero de articulo\tCodigo de almacen\tNombre de almacen\tDescripcion del articulo\tDescripcion del articulo (sin recortar)\tFecha capitalizacion (AF)\tEn stock\n01010100001\t010\tSAN JOSE\tDIESEL\tDIESEL\t\t6500",
      suppliersTsv:
        "Codigo SN\tNombre SN\tCodigo de grupo\tNombre de grupo\nPL-0666\tABCO HONDURAS SA DE CV\t186\tMANTENIMIENTO",
    });

    expect(result).toHaveProperty("jobId");
    expect(result.totalRows).toBeGreaterThan(0);
  });
});
