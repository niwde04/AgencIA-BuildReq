import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";

const testUrl = process.env.FINANCIAL_NOTES_TEST_DATABASE_URL;
const describeDb = testUrl ? describe : describe.skip;
describeDb(
  "ICA contractual advance regularization: isolated PostgreSQL",
  { timeout: 30000 },
  () => {
    let client: Client;
    let database: typeof import("./db");
    let reconciliation: typeof import("./icaAdvanceReconciliation");
    let advances: typeof import("./purchaseOrderAdvances");
    let treasury: typeof import("./treasury");
    beforeAll(async () => {
      const token = process.env.FINANCIAL_NOTES_TEST_TOKEN;
      const url = new URL(testUrl!);
      if (
        !token ||
        !/^[0-9a-f]{16}$/.test(token) ||
        url.pathname !== `/buildreq_notes_test_${token}` ||
        !["localhost", "127.0.0.1"].includes(url.hostname)
      )
        throw new Error("Disposable local test database required");
      process.env.DATABASE_URL = testUrl;
      client = new Client({ connectionString: testUrl });
      await client.connect();
      database = await import("./db");
      reconciliation = await import("./icaAdvanceReconciliation");
      advances = await import("./purchaseOrderAdvances");
      treasury = await import("./treasury");
    });
    afterAll(async () => {
      await ((await database?.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(`TRUNCATE users,projects,suppliers,"purchaseOrders",receipts,invoices,"treasuryPaymentBatches" RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,role) VALUES(1,'ica-test','ICA test','admin');
      INSERT INTO projects(id,code,name) VALUES(21,'017','CA-4 Ocotepeque - El Portillo');
      INSERT INTO suppliers(id,"supplierCode",name) VALUES(1871,'PROV-001871','INGENIEROS CIVILES ASOCIADOS INVERSIONES SA DE CV');
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById","paymentMethod",status,"appliesContract") VALUES(1058,'OC-017-00000233',21,1871,1,'contado','parcialmente_recibida',true),(1059,'OC-UNRELATED',21,1871,1,'contado','emitida',false);
      INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES(2163,'RE-ANULADA','purchase_order',1058,21,1),(2164,'RE-017-00000640','purchase_order',1058,21,1);
      INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",subtotal,total,"otherRetentionTotal","netPayable","accountedAt") VALUES(2014,'FT-017-00000620',2163,1058,21,1871,'anulada',now(),now(),now()+interval '1 year',5026580,5026580,0,5026580,null),(2015,'FT-017-00000621',2164,1058,21,1871,'registrada',now(),now(),now()+interval '1 year',3663120.18,3663120.18,549468.03,3113652.15,now());
      INSERT INTO "purchaseOrderAdvances"(id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") VALUES(21,'ANT-2026-000021',1058,21,1871,'HNL',753987,current_date,1),(22,'ANT-UNRELATED',1059,21,1871,'HNL',100,current_date,1);
      INSERT INTO "invoiceDocumentAdjustments"(id,"invoiceId","adjustmentType","inputMode",percentage,"baseAmount",amount) VALUES(28,2015,'advance_amortization','amount',15.00000008,3663120.18,549468.03);
      INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind",status) VALUES(169,'TES-2026-000169',21,'HNL',current_date,1,'purchase_order_advance','cerrado');
      INSERT INTO "treasuryPaymentItems"(id,"batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation","accountedAt") VALUES(641,169,'purchase_order_advance',21,1871,'PROV-001871','ICA','ANT-2026-000021','HNL',753987,753987,753987,'contabilizada',false,now());
      INSERT INTO "purchaseOrderAdvanceApplications"(id,"purchaseOrderAdvanceId","invoiceId",amount,"appliedById","appliedAt") VALUES(71,21,2015,753987,1,'2026-09-28T14:30:00');
      INSERT INTO "systemSettings"(id,"treasuryEnabled","purchaseOrderApprovalMinimumHnl","purchaseOrderApprovalMinimumUsd") VALUES(1,true,0,0) ON CONFLICT(id) DO UPDATE SET "treasuryEnabled"=true;
      SELECT setval(pg_get_serial_sequence('"treasuryPaymentBatches"','id'),169,true);
      SELECT setval(pg_get_serial_sequence('"treasuryPaymentItems"','id'),641,true);
      SELECT setval(pg_get_serial_sequence('"invoiceDocumentAdjustments"','id'),28,true);`);
    });
    async function snapshot() {
      return reconciliation.inspectIca((await database.getDb())!);
    }
    async function repair(
      options: Parameters<typeof reconciliation.regularizeIca>[1] = {}
    ) {
      // This explicit no-op is permitted only by this disposable-database fixture.
      return (await database.getDb())!.transaction(tx =>
        reconciliation.regularizeIca(tx, {
          beforeApply: async () => {},
          ...options,
        })
      );
    }
    it("previews without changing any row", async () => {
      const before = await snapshot();
      const result = await repair();
      expect(result.changed).toBe(false);
      expect(result.alreadyApplied).toBe(false);
      expect(result.expected).toEqual({
        invoiceAvailable: 3113652.15,
        advanceCovered: 753987,
        advancePendingFunding: 0,
        amortized: 549468.03,
        pendingAmortization: 204518.97,
      });
      expect(await snapshot()).toEqual(before);
    });
    it("backs up the locked before-image, changes only authorized fields, and repeats without effects", async () => {
      const before = await snapshot();
      const unrelated = (
        await client.query(
          'select to_jsonb(a) data from "purchaseOrderAdvances" a where id=22'
        )
      ).rows;
      let captured: typeof before | undefined;
      const result = await repair({
        apply: true,
        actorId: 1,
        beforeApply: async value => {
          captured = value;
          expect(value).toEqual(before);
          expect(value.applications[0].applicationMode).toBe("direct");
        },
      });
      expect(captured).toEqual(before);
      expect(result.changed).toBe(true);
      const after = await snapshot();
      for (const key of [
        "orders",
        "invoices",
        "adjustments",
        "payments",
        "batches",
        "notes",
        "noteDocuments",
        "quality",
      ] as const)
        expect(after[key]).toEqual(before[key]);
      expect(after.applications[0]).toEqual({
        ...before.applications[0],
        applicationMode: "contractual",
        amount: "549468.0300",
        invoiceDocumentAdjustmentId: 28,
      });
      expect(after.advances[0]).toMatchObject({
        applicationMode: "contractual",
        amortizationMode: "percentage",
        amortizationValue: "15.0000",
        amortizationBase: "subtotal",
        requestedAmount: "753987.0000",
      });
      expect(after.snapshots[0]).toMatchObject({
        invoiceId: 2015,
        purchaseOrderId: 1058,
        treatment: "contractual",
        invoiceDocumentAdjustmentId: 28,
        inputMode: "percentage",
        inputValue: "15.0000",
        baseKind: "subtotal",
        baseAmount: "3663120.1800",
        amount: "549468.0300",
        proposedAmount: "549468.0300",
        overrideReason: null,
      });
      expect(after.adjustments[0].percentage).toBe("15.00000008");
      expect(after.events).toHaveLength(before.events.length + 1);
      expect(after.events.at(-1)).toMatchObject({
        operationKey: reconciliation.ICA_CORRECTION_KEY,
        actorId: 1,
        invoiceId: 2015,
      });
      expect(
        (
          await client.query(
            'select to_jsonb(a) data from "purchaseOrderAdvances" a where id=22'
          )
        ).rows
      ).toEqual(unrelated);
      expect(
        (
          await repair({
            apply: true,
            beforeApply: async () => {
              throw new Error("Must not repeat backup or writes");
            },
          })
        ).alreadyApplied
      ).toBe(true);
      expect(await snapshot()).toEqual(after);
    });
    it("makes only the documented net payable available and never consumes the remainder twice", async () => {
      await repair({ apply: true });
      const db = (await database.getDb())!;
      expect(
        await db.transaction(tx =>
          advances.applyAvailableAdvancesForPurchaseOrder({
            executor: tx,
            purchaseOrderId: 1058,
            actorId: 1,
          })
        )
      ).toEqual([]);
      const rows = await treasury.listEligibleTreasuryInvoices({
        projectId: 21,
      });
      const row = rows.find(
        (value: any) => (value.invoice?.id ?? value.id) === 2015
      );
      expect(row?.money.availableAmount).toBe(3113652.15);
      expect(
        await advances.getPurchaseOrderAdvancesSummary(db, 1058)
      ).toMatchObject({
        appliedAmount: 549468.03,
        directAppliedAmount: 0,
        contractualAmortizationAmount: 549468.03,
        unappliedAmount: 204518.97,
      });
      const detail = await database.getInvoiceById(2015);
      expect(Number(detail?.appliedAdvanceAmount)).toBe(0);
      expect(detail?.contractualAmortization?.pendingAmortizationAmount).toBe(
        204518.97
      );
      await treasury.createTreasuryBatch({
        actor: { id: 1, role: "admin", name: "ICA test" },
        projectId: 21,
        currency: "HNL",
        requestedPaymentDate: new Date(),
        items: [{ invoiceId: 2015, requestedAmount: 3113652.15 }],
      });
      const payment = (
        await client.query(
          'select "appliedAdvanceAmount","contractualAmortizationAmount","requestedAmount" from "treasuryPaymentItems" where "invoiceId"=2015'
        )
      ).rows[0];
      expect(Number(payment.appliedAdvanceAmount)).toBe(0);
      expect(Number(payment.contractualAmortizationAmount)).toBe(549468.03);
      expect(Number(payment.requestedAmount)).toBe(3113652.15);
    });
    it.each([
      [
        'UPDATE "treasuryPaymentItems" SET "bankPaidAmount"=753986 WHERE id=641',
        /TES/,
      ],
      [
        "UPDATE \"treasuryPaymentBatches\" SET status='borrador' WHERE id=169",
        /lote/,
      ],
      ['UPDATE invoices SET "netPayable"=3113652.14 WHERE id=2015', /cálculo/],
      [
        'UPDATE "invoiceDocumentAdjustments" SET amount=549468.02 WHERE id=28',
        /amortización/,
      ],
      [
        'UPDATE "purchaseOrderAdvanceApplications" SET amount=753986 WHERE id=71',
        /tratamiento previo/,
      ],
      [
        'UPDATE "purchaseOrders" SET "appliesContract"=false WHERE id=1058',
        /orden/,
      ],
      ["UPDATE invoices SET status='borrador' WHERE id=2014", /conjunto/],
    ])(
      "refuses changed evidence without writing: %s",
      async (statement, expected) => {
        await client.query(statement);
        const before = await snapshot();
        await expect(repair({ apply: true })).rejects.toThrow(expected);
        expect(await snapshot()).toEqual(before);
      }
    );
    it("refuses a pre-existing contractual snapshot instead of overwriting it", async () => {
      await client.query(
        `INSERT INTO "invoiceContractualAmortizations"("invoiceId","purchaseOrderId","invoiceDocumentAdjustmentId","inputMode","inputValue","baseKind","baseAmount","proposedAmount",amount) VALUES(2015,1058,28,'percentage',15,'subtotal',3663120.18,549468.03,549468.03)`
      );
      const before = await snapshot();
      await expect(repair({ apply: true })).rejects.toThrow(
        /tratamiento previo/
      );
      expect(await snapshot()).toEqual(before);
    });
    it("refuses a draft note linked only by its source invoice", async () => {
      await client.query(
        `INSERT INTO "financialNotes"(type,origin,"documentNumber","projectId","supplierId",currency,status,"sourceInvoiceId","createdById") VALUES('credit','retentions','NC-DRAFT-SOURCE-ONLY',21,1871,'HNL','borrador',2015,1)`
      );
      const before = await snapshot();
      expect(before.notes).toEqual([]);
      expect(before.noteDocuments).toHaveLength(1);
      await expect(repair({ apply: true })).rejects.toThrow(/notas/);
      expect(await snapshot()).toEqual(before);
    });
    it("requires an explicit backup callback before first application", async () => {
      const before = await snapshot();
      await expect(
        (await database.getDb())!.transaction(tx =>
          reconciliation.regularizeIca(tx, { apply: true })
        )
      ).rejects.toThrow(/respaldo durable/);
      expect(await snapshot()).toEqual(before);
    });
    it("rolls back when the backup fails or changes the captured state", async () => {
      const before = await snapshot();
      await expect(
        repair({
          apply: true,
          beforeApply: async () => {
            throw new Error("Backup unavailable");
          },
        })
      ).rejects.toThrow("Backup unavailable");
      expect(await snapshot()).toEqual(before);
      await expect(
        (await database.getDb())!.transaction(tx =>
          reconciliation.regularizeIca(tx, {
            apply: true,
            beforeApply: async () => {
              await tx.execute(
                sql`update invoices set "netPayable"=1 where id=2015`
              );
            },
          })
        )
      ).rejects.toThrow(/durante el respaldo/);
      expect(await snapshot()).toEqual(before);
    });
    it("rolls back all financial changes if the final audit insert fails", async () => {
      const before = await snapshot();
      await expect(
        (await database.getDb())!.transaction(tx =>
          reconciliation.regularizeIca(tx, {
            apply: true,
            beforeApply: async () => {
              await tx.execute(
                sql.raw(
                  `CREATE FUNCTION pg_temp.reject_ica_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END $$`
                )
              );
              await tx.execute(
                sql.raw(
                  `CREATE TRIGGER reject_ica_audit BEFORE INSERT ON "advanceFinancialEvents" FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_ica_audit()`
                )
              );
            },
          })
        )
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "Injected audit failure" }),
      });
      expect(await snapshot()).toEqual(before);
    });
    it("refuses to treat an altered contractual snapshot as an idempotent success", async () => {
      await repair({ apply: true });
      await client.query(
        'UPDATE "invoiceContractualAmortizations" SET "inputValue"=14 WHERE "invoiceId"=2015'
      );
      const before = await snapshot();
      await expect(repair({ apply: true })).rejects.toThrow(
        /control contractual/
      );
      expect(await snapshot()).toEqual(before);
    });
  }
);
