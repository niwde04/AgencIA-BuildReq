import { randomUUID } from "node:crypto";
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

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key, url: `/test/${key}` })),
  storageDelete: vi.fn(async () => undefined),
  storageGet: vi.fn(async (key: string) => ({ key, url: `/test/${key}` })),
}));

const testUrl = process.env.TREASURY_REVERSAL_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
const central = { id: 1, role: "user", buildreqRole: "administracion_central" };
const accountant = { id: 2, role: "user", buildreqRole: "contable" };
const secondAccountant = { ...accountant, id: 3 };
const evidence = {
  fileName: "evidencia.pdf",
  mimeType: "application/pdf",
  base64: Buffer.from("%PDF-1.4\n% test evidence\n%%EOF\n").toString("base64"),
};

suite(
  "supplier advance payment reversal in local PostgreSQL",
  { timeout: 30000 },
  () => {
    let client: Client;
    let treasury: typeof import("./treasury");
    let dbModule: typeof import("./db");
    let storage: typeof import("./storage");

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
      vi.stubEnv("TREASURY_PAYMENT_REVERSALS_ENABLED", "true");
      client = new Client({ connectionString: testUrl });
      await client.connect();
      dbModule = await import("./db");
      treasury = await import("./treasury");
      storage = await import("./storage");
    });

    afterAll(async () => {
      await (await dbModule?.getDb())?.$client.end();
      await client?.end();
      vi.unstubAllEnvs();
    });

    beforeEach(async () => {
      vi.clearAllMocks();
      await client.query(`
      TRUNCATE "treasuryPaymentReversalItems", "treasuryPaymentReversals",
        "treasuryPaymentEvents", "treasuryPaymentItems", "treasuryPaymentBatches",
        "purchaseOrderAdvances", "purchaseOrders", attachments, suppliers,
        projects, warehouses, users RESTART IDENTITY CASCADE;

      INSERT INTO users(id,"openId",name,"buildreqRole") VALUES
        (1,'treasury-central','Administración Central','administracion_central'),
        (2,'treasury-accounting','Contabilidad','contable'),
        (3,'treasury-accounting-second','Contabilidad 2','contable');
      INSERT INTO warehouses(id,code,name,"displayName")
        VALUES (1,'W1','Bodega de prueba','Bodega de prueba');
      INSERT INTO projects(id,code,name,"warehouseId") VALUES (1,'P1','Proyecto',1);
      INSERT INTO suppliers(id,"supplierCode",name) VALUES (1,'S1','Proveedor');
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById")
        VALUES (11,'OC-11',1,1,1), (12,'OC-12',1,1,1);
      INSERT INTO "purchaseOrderAdvances"(id,"advanceNumber","purchaseOrderId","projectId",
        "supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") VALUES
        (21,'ANT-21',11,1,1,'HNL',14156.99,'2026-11-02',1),
        (22,'ANT-22',12,1,1,'HNL',2499,'2026-11-02',1);
      INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,
        "requestedPaymentDate","paymentKind",status,"createdById") VALUES
        (31,'TES-31',1,'HNL','2026-11-02','purchase_order_advance','pendiente_contabilizacion',1);
      INSERT INTO "treasuryPaymentItems"(id,"batchId","sourceType","purchaseOrderAdvanceId",
        "supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,
        "invoiceNetPayable","requestedAmount","approvedAmount","bankPaidAmount",status,
        "bankPaidDate","bankReference") VALUES
        (41,31,'purchase_order_advance',21,1,'S1','Proveedor','ANT-21','HNL',
          14156.99,14156.99,14156.99,14156.99,'pagada','2026-11-04','BANK-ORIGINAL'),
        (42,31,'purchase_order_advance',22,1,'S1','Proveedor','ANT-22','HNL',
          2499,2499,2499,2499,'pagada','2026-11-04','BANK-ORIGINAL');
      INSERT INTO attachments("entityType","entityId","fileName","fileKey","fileUrl",category,"uploadedById")
        VALUES ('treasury_payment_batch',31,'original.pdf','tests/original','/tests/original','comprobante_pago',1);
    `);
    });

    function submission(itemIds = [41], clientRequestId = randomUUID()) {
      return {
        batchId: 31,
        clientRequestId,
        cause: "bank_return" as const,
        items: itemIds.map(itemId => ({
          itemId,
          reason: "Devolución bancaria confirmada",
        })),
        attachment: evidence,
        actor: central,
      };
    }

    function decide(reversalId: number, actor = accountant) {
      return treasury.decideTreasuryPaymentReversal({
        batchId: 31,
        reversalId,
        decision: "approve",
        actor,
      });
    }

    async function paymentRows() {
      return (
        await client.query(`
      SELECT id,status,"activeReservation","bankPaidAmount","bankPaidDate"::text,
        "bankReference","accountedAt" FROM "treasuryPaymentItems" ORDER BY id
    `)
      ).rows;
    }

    it("preserves banking history, holds the reversed advance, and lets accounting process the other payment", async () => {
      const original = await paymentRows();
      const request =
        await treasury.submitTreasuryPaymentReversal(submission());
      expect(request).toMatchObject({
        status: "pending",
        amountCents: 1415699,
      });
      await expect(
        treasury.accountTreasuryItems({
          batchId: 31,
          itemIds: [42],
          actor: accountant,
        })
      ).rejects.toThrow("reversión pendiente");

      const result = await decide(request.id);
      expect(result).toMatchObject({
        status: "approved",
        decidedById: accountant.id,
      });
      expect(await paymentRows()).toEqual([
        { ...original[0], status: "revertida", activeReservation: false },
        original[1],
      ]);
      expect(
        (
          await client.query(
            'SELECT "reversalHoldId" FROM "purchaseOrderAdvances" ORDER BY id'
          )
        ).rows
      ).toEqual([{ reversalHoldId: request.id }, { reversalHoldId: null }]);
      expect(
        (await client.query("SELECT category FROM attachments ORDER BY id"))
          .rows
      ).toEqual([
        { category: "comprobante_pago" },
        { category: "comprobante_reversion_pago" },
      ]);
      const report = await treasury.getTreasuryPaymentDetailReport(31);
      expect(report.paymentTotals).toEqual({
        originalBankPaidTotal: 16655.99,
        reversedBankPaidTotal: 14156.99,
        effectiveBankPaidTotal: 2499,
      });
      expect(report.reversalRequests).toMatchObject([
        { id: request.id, status: "approved", amountCents: 1415699 },
      ]);
      expect(report.lines).toMatchObject([
        { paymentItem: { id: 42, reportAmount: 2499 } },
      ]);

      await treasury.accountTreasuryItems({
        batchId: 31,
        itemIds: [42],
        actor: accountant,
      });
      expect(
        (
          await client.query(
            'SELECT status FROM "treasuryPaymentBatches" WHERE id=31'
          )
        ).rows[0].status
      ).toBe("cerrado");
      expect((await paymentRows()).map(row => row.status)).toEqual([
        "revertida",
        "contabilizada",
      ]);
    });

    it("closes a fully reversed batch from accounting rejection and applies a decision only once", async () => {
      await client.query(
        `UPDATE "treasuryPaymentBatches" SET status='rechazado_contabilidad' WHERE id=31`
      );
      const input = submission([41, 42]);
      const request = await treasury.submitTreasuryPaymentReversal(input);
      const decisions = await Promise.allSettled([
        decide(request.id),
        decide(request.id, secondAccountant),
      ]);
      const [approved] = decisions.filter(
        decision => decision.status === "fulfilled"
      );
      expect(
        decisions.filter(decision => decision.status === "rejected")
      ).toHaveLength(1);
      expect(approved.value).toMatchObject({
        status: "approved",
        amountCents: 1665599,
      });
      const winningAccountant =
        approved.value.decidedById === accountant.id
          ? accountant
          : secondAccountant;
      expect(await decide(request.id, winningAccountant)).toEqual(
        approved.value
      );
      expect(await treasury.submitTreasuryPaymentReversal(input)).toEqual(
        approved.value
      );
      expect(
        (
          await client.query(
            'SELECT status FROM "treasuryPaymentBatches" WHERE id=31'
          )
        ).rows[0].status
      ).toBe("anulado");
      const report = await treasury.getTreasuryPaymentDetailReport(31);
      expect(report.paymentTotals).toEqual({
        originalBankPaidTotal: 16655.99,
        reversedBankPaidTotal: 16655.99,
        effectiveBankPaidTotal: 0,
      });
      expect(report.reversalRequests).toMatchObject([
        { id: request.id, status: "approved", amountCents: 1665599 },
      ]);
      expect(report.batch.paymentStatusLabel).toBe("ANULADO POR REVERSIÓN");
      expect(report.lines).toHaveLength(0);
      expect(
        (
          await client.query(`
      SELECT count(*)::int AS count FROM "treasuryPaymentEvents"
      WHERE action='aprobar_reversion_pago'
    `)
        ).rows[0].count
      ).toBe(1);
    });

    it("allows resubmission after a rejected request and prevents self-approval", async () => {
      const request =
        await treasury.submitTreasuryPaymentReversal(submission());
      await expect(
        treasury.decideTreasuryPaymentReversal({
          batchId: 31,
          reversalId: request.id,
          decision: "approve",
          actor: { ...central, role: "admin" },
        })
      ).rejects.toThrow("usuario distinto");
      const result = await treasury.decideTreasuryPaymentReversal({
        batchId: 31,
        reversalId: request.id,
        decision: "reject",
        comment: "Soporte sin detalle de la devolución",
        actor: accountant,
      });
      expect(result.status).toBe("rejected");
      expect((await paymentRows()).map(row => row.status)).toEqual([
        "pagada",
        "pagada",
      ]);
      const retried =
        await treasury.submitTreasuryPaymentReversal(submission());
      expect(retried.id).not.toBe(request.id);
      expect(retried.status).toBe("pending");
    });

    it("deduplicates concurrent submissions and rejects the same key with different data", async () => {
      const input = submission();
      const submitted = await Promise.all([
        treasury.submitTreasuryPaymentReversal(input),
        treasury.submitTreasuryPaymentReversal(input),
      ]);
      expect(submitted).toEqual([submitted[0], submitted[0]]);
      await expect(
        treasury.submitTreasuryPaymentReversal(
          submission([42], input.clientRequestId)
        )
      ).rejects.toThrow("otros datos");
      expect(
        (await client.query("SELECT count(*)::int AS count FROM attachments"))
          .rows[0].count
      ).toBe(2);
      expect(
        vi.mocked(storage.storagePut).mock.calls.length -
          vi.mocked(storage.storageDelete).mock.calls.length
      ).toBe(1);
    });

    it("serializes a reversal request against accounting for the same payment", async () => {
      const outcomes = await Promise.allSettled([
        treasury.submitTreasuryPaymentReversal(submission()),
        treasury.accountTreasuryItems({
          batchId: 31,
          itemIds: [41],
          actor: accountant,
        }),
      ]);
      expect(
        outcomes.filter(outcome => outcome.status === "fulfilled")
      ).toHaveLength(1);
      const payment = (await paymentRows())[0];
      const reversals = await client.query(
        'SELECT status FROM "treasuryPaymentReversals"'
      );
      if (outcomes[0].status === "fulfilled") {
        expect(payment.status).toBe("pagada");
        expect(reversals.rows).toEqual([{ status: "pending" }]);
      } else {
        expect(payment.status).toBe("contabilizada");
        expect(reversals.rows).toEqual([]);
      }
    });

    it("serializes approval against accounting for the same payment", async () => {
      const request =
        await treasury.submitTreasuryPaymentReversal(submission());
      const [accounting, approval] = await Promise.allSettled([
        treasury.accountTreasuryItems({
          batchId: 31,
          itemIds: [41],
          actor: accountant,
        }),
        decide(request.id),
      ]);
      expect(approval).toMatchObject({
        status: "fulfilled",
        value: { status: "approved" },
      });
      expect(accounting).toMatchObject({
        status: "rejected",
        reason: { name: "TreasuryRuleError" },
      });
      expect((await paymentRows())[0]).toMatchObject({
        status: "revertida",
        accountedAt: null,
      });
    });

    it("serializes full reversal approval against correction of the same batch", async () => {
      await treasury.rejectTreasuryPaymentForCorrection({
        batchId: 31,
        actor: accountant,
        reason: "referencia_incorrecta",
        comment: "Referencia bancaria por comprobar",
      });
      const request = await treasury.submitTreasuryPaymentReversal(
        submission([41, 42])
      );
      const [correction, approval] = await Promise.allSettled([
        treasury.correctTreasuryPayment({
          batchId: 31,
          actor: central,
          bankReference: "BANK-CORREGIDA",
          comment: "Referencia bancaria corregida",
        }),
        decide(request.id),
      ]);
      expect(approval).toMatchObject({
        status: "fulfilled",
        value: { status: "approved" },
      });
      expect(correction).toMatchObject({
        status: "rejected",
        reason: { name: "TreasuryRuleError" },
      });
      expect((await paymentRows()).map(row => row.bankReference)).toEqual([
        "BANK-ORIGINAL",
        "BANK-ORIGINAL",
      ]);
    });

    it("rejects a paid line without an active reservation at submission and approval", async () => {
      const setReservation = (active: boolean) =>
        client.query(
          'UPDATE "treasuryPaymentItems" SET "activeReservation"=$1 WHERE id=41',
          [active]
        );
      await setReservation(false);
      await expect(
        treasury.submitTreasuryPaymentReversal(submission())
      ).rejects.toThrow("pagos vigentes de anticipos");
      expect(
        (await client.query('SELECT id FROM "treasuryPaymentReversals"')).rows
      ).toEqual([]);

      await setReservation(true);
      const request =
        await treasury.submitTreasuryPaymentReversal(submission());
      await setReservation(false);
      await expect(decide(request.id)).rejects.toThrow(
        "pagos vigentes de anticipos"
      );
      expect((await paymentRows())[0]).toMatchObject({
        status: "pagada",
        activeReservation: false,
        bankReference: "BANK-ORIGINAL",
      });
      expect(
        (await client.query('SELECT status FROM "treasuryPaymentReversals"'))
          .rows
      ).toEqual([{ status: "pending" }]);
    });

    it("rolls back the payment status and hold if applying the reversal fails", async () => {
      const original = await paymentRows();
      const request =
        await treasury.submitTreasuryPaymentReversal(submission());
      await client.query(`
      CREATE FUNCTION private.test_reversal_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
      CREATE TRIGGER test_reversal_failure BEFORE UPDATE ON "treasuryPaymentReversalItems"
      FOR EACH ROW EXECUTE FUNCTION private.test_reversal_failure();
    `);
      try {
        await expect(decide(request.id)).rejects.toThrow();
        expect(await paymentRows()).toEqual(original);
        expect(
          (
            await client.query(
              'SELECT "reversalHoldId" FROM "purchaseOrderAdvances" WHERE id=21'
            )
          ).rows[0].reversalHoldId
        ).toBeNull();
        expect(
          (
            await client.query(
              'SELECT status FROM "treasuryPaymentReversals" WHERE id=$1',
              [request.id]
            )
          ).rows[0].status
        ).toBe("pending");
      } finally {
        await client.query(`
        DROP TRIGGER test_reversal_failure ON "treasuryPaymentReversalItems";
        DROP FUNCTION private.test_reversal_failure();
      `);
      }
      expect((await decide(request.id)).status).toBe("approved");
    });

    it("keeps reversal records protected by RLS and rejects changing their history", async () => {
      const request =
        await treasury.submitTreasuryPaymentReversal(submission());
      await expect(
        client.query(
          `UPDATE "treasuryPaymentItems" SET status='revertida' WHERE id=41`
        )
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          'UPDATE "treasuryPaymentReversals" SET "amountCents"=1 WHERE id=$1',
          [request.id]
        )
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          'DELETE FROM "treasuryPaymentReversalItems" WHERE "reversalId"=$1',
          [request.id]
        )
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await client.query(`
      SELECT relrowsecurity FROM pg_class
      WHERE oid IN ('"treasuryPaymentReversals"'::regclass, '"treasuryPaymentReversalItems"'::regclass)
    `)
        ).rows
      ).toEqual([{ relrowsecurity: true }, { relrowsecurity: true }]);
      expect(
        (
          await client.query(`
      SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') AND (
        has_table_privilege(rolname, '"treasuryPaymentReversals"', 'SELECT')
        OR has_table_privilege(rolname, '"treasuryPaymentReversalItems"', 'SELECT')
      )
    `)
        ).rows
      ).toEqual([]);
    });
  }
);
