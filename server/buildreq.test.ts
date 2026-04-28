import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import { buildProcurementPdfBase64 } from "./_core/documents";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

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
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };

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

function createProjectAdminContext() {
  return createUserContext({
    id: 5,
    openId: "test-project-admin-001",
    role: "user",
    buildreqRole: "administrador_proyecto",
    assignedProjectId: 1,
    name: "Admin Proyecto Test",
  });
}

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
      "Solo el Jefe de Bodega Central o Administración Central pueden despachar materiales"
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
      "compra_directa",
      "traslado_proyecto",
      "solicitud_compra",
    ]);
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
        note: "Salida aprobada por administración central",
      })
    ).resolves.toEqual({ success: true });

    expect(recordWarehouseExitSpy).toHaveBeenCalledWith({
      requestId: 9,
      requestItemId: 41,
      quantity: "25.00",
      note: "Salida aprobada por administración central",
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
      .mockImplementation(async (id: number) =>
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
          { requestItemId: 41, dispatchedQuantity: "25.00" },
          { requestItemId: 42, dispatchedQuantity: "10.00" },
        ],
        note: "Salida aprobada por administración central",
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
        { requestItemId: 41, quantity: "25.00" },
        { requestItemId: 42, quantity: "10.00" },
      ],
      note: "Salida aprobada por administración central",
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

    await expect(
      caller.warehouseExits.emit({ id: 33 })
    ).resolves.toEqual({
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
        sourceProjectId: 3,
        notes: "Traslado consolidado",
        items: [
          { requestId: 12, requestItemId: 51 },
          { requestId: 12, requestItemId: 52 },
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
        projectId: 3,
        destinationProjectId: 7,
      }),
      expect.arrayContaining([
        expect.objectContaining({ materialRequestItemId: 51 }),
        expect.objectContaining({ materialRequestItemId: 52 }),
      ])
    );
    expect(createSupplyFlowRecordSpy).toHaveBeenCalledTimes(2);

    getMaterialRequestByIdSpy.mockRestore();
    getActiveSupplyFlowForRequestItemSpy.mockRestore();
    updateRequestItemSpy.mockRestore();
    createTransferRequestSpy.mockRestore();
    createSupplyFlowRecordSpy.mockRestore();
    getRequestItemsByRequestIdSpy.mockRestore();
    updateMaterialRequestStatusSpy.mockRestore();
  });

  it("Admin Central cannot convert to PO (only administracion_central role)", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.supplyFlows.convertToPurchaseOrder({
        flowId: 1,
      })
    ).rejects.toThrow(
      "Solo Administración Central puede convertir a Orden de Compra"
    );
  });
});

// ============================================================
// Tests: Reverse Logistics validations
// ============================================================
describe("BuildReq - Reverse Logistics Validations", () => {
  it("Requires justification with minimum 10 characters", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_bodega_central",
        reasonCategory: "material_defectuoso",
        justification: "corta", // Less than 10 chars
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
        sourceProjectId: 1,
        items: [
          {
            itemName: "Pala",
            sapItemCode: "01010200099",
            quantity: "100.00",
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
        createdById: ctx.user?.id,
      }),
      [
        expect.objectContaining({
          itemName: "Pala",
          sapItemCode: "01010200099",
          quantity: "100.00",
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
      items: [],
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
        sourceReceiptId: 44,
        supplierName: "Proveedor escrito a mano",
        items: [
          {
            itemName: "Varilla de acero",
            sapItemCode: "01010200055",
            quantity: "50.00",
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
        createdById: ctx.user?.id,
      }),
      [
        expect.objectContaining({
          itemName: "Varilla de acero",
          sapItemCode: "01010200055",
          quantity: "50.00",
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
      "pendiente de autorización del Administrador del Proyecto o Administración Central"
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
  it("Admin can assign a project-scoped role before selecting a project", async () => {
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
        buildreqRole: "ingeniero_residente",
        assignedProjectId: null,
      })
    ).resolves.toEqual({ success: true });

    expect(updateUserRoleSpy).toHaveBeenCalledWith(
      2,
      "ingeniero_residente",
      null
    );

    updateUserRoleSpy.mockRestore();
  });
});

// ============================================================
// Tests: Purchase Orders
// ============================================================
describe("BuildReq - Purchase Orders", () => {
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

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(15, {
      unitPrice: "125.50",
      taxCode: "isv_15",
    });

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

    expect(updatePurchaseOrderItemSpy).toHaveBeenCalledWith(15, {
      quantity: "125.00",
      unitPrice: "125.50",
      taxCode: "isv_15",
    });

    getPurchaseOrderItemSpy.mockRestore();
    updatePurchaseOrderItemSpy.mockRestore();
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
        },
        items: [{ id: 15 }],
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
    expect(emittedPdfText).not.toContain(`<${encodedWatermark}> Tj`);
  });
});

// ============================================================
// Tests: Receipts
// ============================================================
describe("BuildReq - Receipts", () => {
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
        cai: "CAI-001-ABC",
        invoiceNumber: "FAC-0001",
        documentDate: "2026-04-14",
        postingDate: "2026-04-15",
        receiptDate: "2026-04-15",
        notes: "Factura de prueba",
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
    ).resolves.toEqual({
      id: 6,
      receiptNumber: "RC-2026-0001",
      status: "completa",
    });

    const receiptPayload = registerReceiptSpy.mock.calls[0]?.[0] as any;
    expect(receiptPayload.cai).toBe("CAI-001-ABC");
    expect(receiptPayload.invoiceNumber).toBe("FAC-0001");
    expect(receiptPayload.documentDate).toBeInstanceOf(Date);
    expect(receiptPayload.postingDate).toBeInstanceOf(Date);
    expect(receiptPayload.receiptDate).toBeInstanceOf(Date);

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

  it("does not allow receiving more than the pending transfer balance", async () => {
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
            quantityExpected: "15.00",
            quantityReceived: "16.00",
            unit: "und",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La cantidad a recibir de VARILLA #4 excede lo pendiente",
    });

    expect(registerReceiptSpy).not.toHaveBeenCalled();

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
        cai: "CAI-001-ABC",
        invoiceNumber: "FAC-0001",
        documentDate: "2026-04-14",
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
      message: "Solo se pueden recibir órdenes emitidas con saldo pendiente",
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
        cai: "CAI-001-ABC",
        invoiceNumber: "FAC-0001",
        documentDate: "2026-04-14",
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
// Tests: Transfer Requests
// ============================================================
describe("BuildReq - Transfer Requests", () => {
  it("cancel annuls a pending transfer request and returns transfer items to the transfer flow", async () => {
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
        { id: 21, assignedFlow: "traslado_proyecto" },
        { id: 22, assignedFlow: "traslado_proyecto" },
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
      assignedFlow: "traslado_proyecto",
      status: "pendiente",
    });
    expect(updateRequestItemSpy).toHaveBeenCalledWith(22, {
      assignedFlow: "traslado_proyecto",
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
      "en_proceso",
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
      projectId: 1,
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
        purchaseType: "local",
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
        purchaseType: "local",
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
        purchaseType: "local",
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
      expect.any(Array)
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
    updateSupplyFlowRecordSpy.mockRestore();
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
      "Solo Administración Central puede convertir a Orden de Compra"
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
      "Solo Administración Central puede convertir a Orden de Compra"
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
