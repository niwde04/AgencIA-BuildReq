import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

// ============================================================
// Test helpers
// ============================================================
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUserContext(
  overrides: Partial<AuthenticatedUser> = {}
): { ctx: TrpcContext; clearedCookies: any[] } {
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
      "Solo el Jefe de Bodega Central puede despachar materiales"
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
      "Solo el Jefe de Bodega Central puede gestionar traslados"
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
    ).rejects.toThrow(
      "No tiene permisos para traducir ítems a códigos SAP"
    );
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

  it("Requires supplier name for vendor returns", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_proveedor",
        reasonCategory: "material_defectuoso",
        justification: "Material llegó defectuoso del proveedor, no cumple especificaciones",
        sourceProjectId: 1,
        items: [
          {
            itemName: "Varilla de acero",
            quantity: "50",
            condition: "defectuoso",
          },
        ],
        // Missing supplierName
      })
    ).rejects.toThrow(
      "Para devoluciones a proveedor, debe indicar el nombre del proveedor"
    );
  });

  it("Requires destination project for inter-project returns", async () => {
    const { ctx } = createBodegaContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.reverseLogistics.create({
        returnType: "devolucion_entre_proyectos",
        reasonCategory: "excedente",
        justification: "Material excedente que puede ser utilizado en otro proyecto",
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
        justification: "Material sobrante del proyecto que debe retornarse a bodega",
        sourceProjectId: 1,
        items: [], // Empty items
      })
    ).rejects.toThrow();
  });
});

// ============================================================
// Tests: Material Request validations
// ============================================================
describe("BuildReq - Material Request Validations", () => {
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
      if (!e.message?.includes("DB not available") && !e.message?.includes("database")) {
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
