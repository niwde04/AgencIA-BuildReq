import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import * as db from "./db";
import * as storage from "./storage";
import type { TrpcContext } from "./_core/context";

const file = Buffer.from("%PDF-1.4\nRespaldo sintético para pruebas\n%%EOF");
const upload = {
  entityType: "purchase_order" as const,
  entityId: 44,
  fileName: "continuidad-obra.pdf",
  fileData: file.toString("base64"),
  fileSize: file.length,
  mimeType: "application/pdf",
  category: "otro" as const,
  billingSupport: true,
};

function caller(overrides: Record<string, unknown> = {}) {
  return appRouter.createCaller({
    user: {
      id: 1,
      openId: "billing-support-test",
      email: "pruebas@example.com",
      name: "Central de prueba",
      role: "user",
      buildreqRole: "administracion_central",
      isActive: true,
      mustChangePassword: false,
      assignedProjectId: null,
      assignedProjectIds: [],
      ...overrides,
    },
    req: { protocol: "https", headers: {} },
    res: {},
  } as TrpcContext);
}

describe("Respaldo específico de autorización contractual", () => {
  beforeEach(() => {
    vi.spyOn(db, "getPurchaseOrderById").mockResolvedValue({
      purchaseOrder: {
        id: 44,
        projectId: 1,
        status: "recibida",
        approvalStatus: "aprobada",
        appliesContract: true,
      },
      approvalHistory: [],
      summary: { total: 1000 },
    } as any);
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      url: "/archivo-qa.pdf",
      key: "qa",
    } as any);
    vi.spyOn(storage, "storageDelete").mockResolvedValue(undefined);
    vi.spyOn(
      db,
      "createPurchaseOrderBillingSupportAttachment"
    ).mockResolvedValue({ id: 701 } as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("permite agregar respaldo en una OC recibida y usa la inserción con revalidación transaccional", async () => {
    const result = await caller().attachments.upload(upload);
    expect(result.id).toBe(701);
    expect(db.createPurchaseOrderBillingSupportAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "purchase_order",
        entityId: 44,
        category: "otro",
        uploadedById: 1,
      }),
      expect.objectContaining({ buildreqRole: "administracion_central" })
    );
    expect(storage.storageDelete).not.toHaveBeenCalled();
  });

  it.each([
    {
      role: "user",
      buildreqRole: "administrador_proyecto",
      assignedProjectId: 1,
    },
    { role: "user", buildreqRole: "contable" },
    { role: "admin", buildreqRole: "gerente" },
  ])(
    "rechaza roles sin facultad aunque conozcan el ID o tengan rol base admin: %o",
    async role => {
      await expect(
        caller(role).attachments.upload(upload)
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(storage.storagePut).not.toHaveBeenCalled();
      expect(
        db.createPurchaseOrderBillingSupportAttachment
      ).not.toHaveBeenCalled();
    }
  );

  it("rechaza usar el permiso para otro tipo de documento", async () => {
    await expect(
      caller().attachments.upload({ ...upload, entityType: "invoice" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storagePut).not.toHaveBeenCalled();
  });

  it("rechaza usar el permiso para adjuntar una factura en lugar del respaldo", async () => {
    await expect(
      caller().attachments.upload({ ...upload, category: "factura" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storagePut).not.toHaveBeenCalled();
  });

  it.each([
    { status: "recibida", appliesContract: false },
    { status: "borrador", appliesContract: true },
    { status: "anulada", appliesContract: true },
  ])("exige una OC contractual emitida: %o", async state => {
    vi.mocked(db.getPurchaseOrderById).mockResolvedValue({
      purchaseOrder: {
        id: 44,
        projectId: 1,
        approvalStatus: "no_requiere",
        ...state,
      },
      approvalHistory: [],
      summary: { total: 1000 },
    } as any);
    await expect(caller().attachments.upload(upload)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(storage.storagePut).not.toHaveBeenCalled();
  });

  it("mantiene el bloqueo de subida general y de borrado de una OC recibida", async () => {
    await expect(
      caller().attachments.upload({ ...upload, billingSupport: false })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.spyOn(db, "getAttachmentById").mockResolvedValue({
      id: 701,
      entityType: "purchase_order",
      entityId: 44,
      fileKey: "qa.pdf",
    } as any);
    await expect(
      caller().attachments.delete({ id: 701 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storagePut).not.toHaveBeenCalled();
    expect(storage.storageDelete).not.toHaveBeenCalled();
  });

  it("elimina solo el objeto recién subido si la revalidación transaccional rechaza el registro", async () => {
    vi.mocked(db.createPurchaseOrderBillingSupportAttachment).mockRejectedValue(
      new Error("La OC cambió de estado")
    );
    await expect(caller().attachments.upload(upload)).rejects.toThrow(
      "La OC cambió de estado"
    );
    expect(storage.storageDelete).toHaveBeenCalledTimes(1);
    expect(storage.storageDelete).toHaveBeenCalledWith(
      expect.stringContaining("buildreq/purchase_order/44/")
    );
  });
});
