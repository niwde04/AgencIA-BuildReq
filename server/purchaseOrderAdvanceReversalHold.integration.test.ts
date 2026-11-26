import { Client } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const testUrl = process.env.TREASURY_REVERSAL_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
const accountant = { id: 2, role: "user", buildreqRole: "contable" };
const request = {
  advanceId: 21,
  reversalId: 51,
  actor: accountant,
  reason: "Autorizar un nuevo pago del anticipo",
  evidenceNote: "Se confirmó el importe íntegro contra el soporte bancario",
};

suite("advance reversal hold in local PostgreSQL", { timeout: 30000 }, () => {
  let client: Client;
  let database: typeof import("./db");
  let advances: typeof import("./purchaseOrderAdvances");
  let treasury: typeof import("./treasury");

  beforeAll(async () => {
    const url = new URL(testUrl!);
    const token = process.env.TREASURY_REVERSAL_TEST_TOKEN;
    if (
      !token ||
      !/^[0-9a-f]{16}$/.test(token) ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search ||
      url.pathname !== `/buildreq_treasury_reversal_test_${token}`
    ) {
      throw new Error("Disposable local treasury reversal database required");
    }
    vi.stubEnv("DATABASE_URL", testUrl!);
    client = new Client({ connectionString: testUrl });
    await client.connect();
    database = await import("./db");
    advances = await import("./purchaseOrderAdvances");
    treasury = await import("./treasury");
  });

  afterAll(async () => {
    await (await database?.getDb())?.$client.end();
    await client?.end();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await client.query(`
      TRUNCATE "treasuryPaymentReversalItems", "treasuryPaymentReversals",
        "treasuryPaymentEvents", "treasuryPaymentItems", "treasuryPaymentBatches",
        "purchaseOrderAdvances", "purchaseOrders", attachments, suppliers,
        projects, warehouses, users RESTART IDENTITY CASCADE;

      INSERT INTO users(id,"openId",name,"buildreqRole") VALUES
        (1,'treasury-central','Administración Central','administracion_central'),
        (2,'treasury-accounting','Contabilidad','contable');
      INSERT INTO warehouses(id,code,name,"displayName") VALUES (1,'W1','Bodega','Bodega');
      INSERT INTO projects(id,code,name,"warehouseId") VALUES (1,'P1','Proyecto',1);
      INSERT INTO suppliers(id,"supplierCode",name) VALUES (1,'S1','Proveedor');
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById",status,"paymentMethod")
        VALUES (11,'OC-11',1,1,1,'emitida','contado');
      INSERT INTO "purchaseOrderAdvances"(id,"advanceNumber","purchaseOrderId","projectId",
        "supplierId",currency,"requestedAmount","requestedPaymentDate","createdById")
        VALUES (21,'ANT-21',11,1,1,'HNL',14156.99,'2026-11-02',1);
      INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,
        "requestedPaymentDate","paymentKind",status,"createdById")
        VALUES (31,'TES-31',1,'HNL','2026-11-02','purchase_order_advance','anulado',1);
      INSERT INTO "treasuryPaymentItems"(id,"batchId","sourceType","purchaseOrderAdvanceId",
        "supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,
        "invoiceNetPayable","requestedAmount","approvedAmount","bankPaidAmount",status,
        "activeReservation","bankPaidDate","bankReference")
        VALUES (41,31,'purchase_order_advance',21,1,'S1','Proveedor','ANT-21','HNL',
          14156.99,14156.99,14156.99,14156.99,'revertida',false,'2026-11-04','BANK-ORIGINAL');
      INSERT INTO attachments(id,"entityType","entityId","fileName","fileKey","fileUrl",category,"uploadedById")
        VALUES (61,'treasury_payment_batch',31,'proof.pdf','tests/proof','/tests/proof','comprobante_reversion_pago',1);
      INSERT INTO "treasuryPaymentReversals"(id,"clientRequestId","batchId",status,"requestFingerprint",
        "requestedById","decidedById","decidedAt","evidenceAttachmentId",cause,"amountCents")
        VALUES (51,'69372147-6e8e-43b5-b442-85e41ce450d2',31,'approved','test',1,2,now(),61,'bank_return',1415699);
      INSERT INTO "treasuryPaymentReversalItems"("reversalId","paymentItemId",reason,"amountCents","appliedAt")
        VALUES (51,41,'Devolución confirmada',1415699,now());
      UPDATE "purchaseOrderAdvances" SET "reversalHoldId"=51 WHERE id=21;
    `);
  });

  function createDraft() {
    return treasury.createTreasuryBatch({
      actor: accountant,
      projectId: 1,
      currency: "HNL",
      requestedPaymentDate: new Date("2026-11-07T00:00:00Z"),
      items: [
        {
          sourceType: "purchase_order_advance",
          purchaseOrderAdvanceId: 21,
          requestedAmount: 14156.99,
        },
      ],
    });
  }

  it("blocks a new draft until release and keeps the original banking data", async () => {
    expect(await advances.listEligiblePurchaseOrderAdvances()).toEqual([]);
    await expect(createDraft()).rejects.toThrow("retenido por una reversión");

    expect(
      await advances.releasePurchaseOrderAdvanceReversalHold(request)
    ).toEqual({
      advanceId: 21,
      reversalId: 51,
    });

    const [eligible] = await advances.listEligiblePurchaseOrderAdvances();
    expect(eligible).toMatchObject({
      advance: { id: 21, reversalHoldId: null },
      money: { availableToPayAmount: 14156.99, bankPaidPendingAmount: 0 },
    });
    await expect(createDraft()).resolves.toMatchObject({ status: "borrador" });
    const {
      rows: [payment],
    } = await client.query(
      'SELECT status,"bankPaidAmount","bankReference" FROM "treasuryPaymentItems" WHERE id=41'
    );
    expect(payment).toEqual({
      status: "revertida",
      bankPaidAmount: "14156.9900",
      bankReference: "BANK-ORIGINAL",
    });
    const {
      rows: [event],
    } = await client.query(
      'SELECT "actorUserId",comment,metadata FROM "treasuryPaymentEvents" WHERE "batchId"=31 AND "itemId"=41'
    );
    expect(event).toEqual({
      actorUserId: 2,
      comment: request.reason,
      metadata: {
        advanceId: 21,
        reversalId: 51,
        evidenceAttachmentId: 61,
        evidenceNote: request.evidenceNote,
      },
    });
  });

  it("rejects an old hold ID and allows only one concurrent release", async () => {
    await expect(
      advances.releasePurchaseOrderAdvanceReversalHold({
        ...request,
        reversalId: 50,
      })
    ).rejects.toThrow("La retención del anticipo cambió");
    const release = () =>
      advances.releasePurchaseOrderAdvanceReversalHold(request);
    const results = await Promise.allSettled([release(), release()]);
    expect(results.map(result => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const {
      rows: [audit],
    } = await client.query(
      `SELECT count(*)::int AS count FROM "treasuryPaymentEvents"
       WHERE action='liberar_retencion_anticipo_reversion'`
    );
    expect(audit.count).toBe(1);
  });

  it("allows cancellation of a held advance and protects that cancellation", async () => {
    await advances.cancelPurchaseOrderAdvance({
      advanceId: 21,
      actor: accountant,
      reason: "Anular el anticipo después de la devolución",
    });
    await expect(
      advances.releasePurchaseOrderAdvanceReversalHold(request)
    ).rejects.toThrow("retención de un anticipo activo");
    expect(await advances.listEligiblePurchaseOrderAdvances()).toEqual([]);
  });

  it("requires the purchase order and evidence to remain eligible", async () => {
    await client.query(
      `UPDATE "purchaseOrders" SET status='parcialmente_recibida' WHERE id=11`
    );
    await expect(
      advances.releasePurchaseOrderAdvanceReversalHold(request)
    ).rejects.toThrow("La orden de compra ya no reúne las condiciones");
    await client.query(`UPDATE "purchaseOrders" SET status='emitida' WHERE id=11;
      UPDATE attachments SET category='comprobante_pago' WHERE id=61;`);
    await expect(
      advances.releasePurchaseOrderAdvanceReversalHold(request)
    ).rejects.toThrow("respaldo bancario válido");
  });

  it("releases only the remaining balance after an earlier accounted payment", async () => {
    await client.query(`
      UPDATE "purchaseOrderAdvances" SET "requestedAmount"=14356.99 WHERE id=21;
      UPDATE "treasuryPaymentItems" SET "invoiceNetPayable"=14356.99 WHERE id=41;
      INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,
        "requestedPaymentDate","paymentKind",status,"createdById")
        VALUES (32,'TES-32',1,'HNL','2026-10-30','purchase_order_advance','cerrado',1);
      INSERT INTO "treasuryPaymentItems"(id,"batchId","sourceType","purchaseOrderAdvanceId",
        "supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,
        "invoiceNetPayable","requestedAmount","approvedAmount","bankPaidAmount",status,
        "activeReservation","bankPaidDate","bankReference","accountedAt")
        VALUES (42,32,'purchase_order_advance',21,1,'S1','Proveedor','ANT-21','HNL',
          14356.99,200,200,200,'contabilizada',false,'2026-10-30','BANK-OTRO',now());
    `);
    await expect(
      advances.releasePurchaseOrderAdvanceReversalHold(request)
    ).resolves.toEqual({ advanceId: 21, reversalId: 51 });
    const [advance] = await advances.listPurchaseOrderAdvances({
      advanceId: 21,
    });
    expect(advance).toMatchObject({
      advance: { reversalHoldId: null },
      money: {
        accountedAmount: 200,
        availableToPayAmount: 14156.99,
        status: "parcialmente_contabilizado",
      },
    });
  });
});
