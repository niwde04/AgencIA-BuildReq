import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { noteDraftSchema } from "../shared/financial-notes";

const testUrl = process.env.INVOICE_SETTLEMENT_TEST_DATABASE_URL;
const describeDb = testUrl ? describe : describe.skip;
const admin = { id: 1, role: "admin", name: "Settlement Admin" };
const accountant = { id: 1, role: "user", buildreqRole: "contable" };

describeDb(
  "document-cent settlement: isolated PostgreSQL workflows",
  { timeout: 30000 },
  () => {
    let client: Client;
    let database: typeof import("./db");
    let settlement: typeof import("./invoiceSettlement");
    let treasury: typeof import("./treasury");
    let advances: typeof import("./purchaseOrderAdvances");
    let notes: typeof import("./financialNotes");
    let quality: typeof import("./qualityRetentionReleases");
    let creditConcept: number, debitConcept: number;

    beforeAll(async () => {
      const url = new URL(testUrl!);
      const token = process.env.INVOICE_SETTLEMENT_TEST_TOKEN;
      if (
        !token ||
        !/^[0-9a-f]{16}$/.test(token) ||
        url.pathname !== `/buildreq_settlement_test_${token}` ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "A runner-created local disposable database is required"
        );
      process.env.DATABASE_URL = testUrl;
      client = new Client({ connectionString: testUrl });
      await client.connect();
      database = await import("./db");
      settlement = await import("./invoiceSettlement");
      treasury = await import("./treasury");
      advances = await import("./purchaseOrderAdvances");
      notes = await import("./financialNotes");
      quality = await import("./qualityRetentionReleases");
    });
    afterAll(async () => {
      await ((await database?.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(`TRUNCATE "invoiceSettlementActivations",users,projects,suppliers,"purchaseOrders",receipts,invoices,"treasuryPaymentBatches" RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,email,role,"isActive") VALUES(1,'settlement-admin','Settlement Admin','ed_barah@hotmail.com','admin',true);
      INSERT INTO projects(id,code,name) VALUES(1,'TEST','Settlement project');
      INSERT INTO suppliers(id,"supplierCode",name) VALUES(1,'SUP-TEST','Settlement supplier');
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById","paymentMethod",status,"appliesContract") SELECT i,'OC-TEST-'||i,1,1,1,'contado','parcialmente_recibida',true FROM generate_series(1,12) i;
      INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") SELECT i,'RE-TEST-'||i,'purchase_order',i,1,1 FROM generate_series(1,12) i;
      INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",subtotal,total,"retentionTotal","netPayable","accountedAt")
      SELECT i,'FT-TEST-'||i,i,i,1,1,'registrada',now(),now(),now()+interval '1 year',57492.22,57492.22,14373.0550,43119.1650,now() FROM generate_series(1,12) i;
      UPDATE invoices SET subtotal=2460.8160,total=2460.8160,"retentionTotal"=342.3744,"netPayable"=2118.4416 WHERE id=2;
      UPDATE invoices SET subtotal=100.0055,total=100.0055,"retentionTotal"=0,"netPayable"=100.0055 WHERE id=3;
      INSERT INTO "invoiceRetentions"("invoiceId","retentionType","retentionCode",description,percentage,"baseAmount",amount) VALUES(1,'percentage','RT25','Retention 25%',25,57492.22,14373.0550);
      INSERT INTO "systemSettings"(id,"treasuryEnabled","purchaseOrderApprovalMinimumHnl","purchaseOrderApprovalMinimumUsd") VALUES(1,true,0,0) ON CONFLICT(id) DO UPDATE SET "treasuryEnabled"=true;
      INSERT INTO "invoiceSettlementSettings"(id,enabled) VALUES(1,false) ON CONFLICT(id) DO UPDATE SET enabled=false;
      UPDATE "financialNoteSettings" SET enabled=true,"activatedAt"=now()-interval '1 minute';
      UPDATE "financialNoteConcepts" SET "isActive"=true;`);
      creditConcept = (
        await client.query(
          `select id from "financialNoteConcepts" where code='NC-C01'`
        )
      ).rows[0].id;
      debitConcept = (
        await client.query(
          `select id from "financialNoteConcepts" where code='ND-C01'`
        )
      ).rows[0].id;
    });
    async function db() {
      return (await database.getDb())!;
    }
    async function policy(id = 1) {
      return (await settlement.getInvoiceSettlementMap(await db(), [id])).get(
        id
      )!;
    }
    async function enroll(id = 1) {
      await client.query(
        'UPDATE "invoiceSettlementSettings" SET enabled=true,"activatedById"=1,"activatedAt"=now() WHERE id=1'
      );
      await client.query("UPDATE invoices SET status='borrador' WHERE id=$1", [
        id,
      ]);
      const inserted = await (
        await db()
      ).transaction(tx => settlement.enrollNewInvoiceSettlement(tx, id, 1));
      await client.query(
        "UPDATE invoices SET status='registrada' WHERE id=$1",
        [id]
      );
      return inserted;
    }
    async function eligible(id = 1) {
      return (
        await treasury.listEligibleTreasuryInvoices({ projectId: 1 })
      ).find(row => row.invoice.id === id);
    }
    async function createBatch(amount: number, invoiceId = 1) {
      const currency = (
        await client.query("select currency from invoices where id=$1", [
          invoiceId,
        ])
      ).rows[0].currency;
      return treasury.createTreasuryBatch({
        actor: admin,
        projectId: 1,
        currency,
        requestedPaymentDate: new Date("2026-10-30T12:00:00Z"),
        items: [{ invoiceId, requestedAmount: amount }],
      });
    }
    async function accountBatch(batchId: number) {
      await client.query(
        `update "treasuryPaymentBatches" set status='pendiente_contabilizacion' where id=$1`,
        [batchId]
      );
      const ids = (
        await client.query(
          `update "treasuryPaymentItems" set status='pagada',"bankPaidAmount"="requestedAmount","bankPaidDate"=current_date where "batchId"=$1 returning id`,
          [batchId]
        )
      ).rows.map(r => r.id);
      return treasury.accountTreasuryItems({
        batchId,
        itemIds: ids,
        actor: admin,
      });
    }
    async function pay(amount: number, invoiceId = 1) {
      const batch = await createBatch(amount, invoiceId);
      await accountBatch(batch.id);
      return batch;
    }
    async function rawInvoices() {
      return (
        await client.query(
          "select to_jsonb(i) data from invoices i order by id"
        )
      ).rows;
    }
    async function noteBalance(id = 1) {
      return notes.invoiceNoteAvailable(await db(), id);
    }
    function draftNote(
      type: "credit" | "debit",
      amount: string,
      invoiceId = 1
    ) {
      return noteDraftSchema.parse({
        type,
        lines: [
          {
            conceptId: type === "credit" ? creditConcept : debitConcept,
            baseAmount: amount,
            taxAmount: "0",
          },
        ],
        allocations: [{ invoiceId, amount }],
      });
    }
    async function createNote(
      type: "credit" | "debit",
      amount: string,
      invoiceId = 1
    ) {
      return notes.createFinancialNote(
        { ...draftNote(type, amount, invoiceId), requestKey: randomUUID() },
        admin
      );
    }
    async function postNote(
      type: "credit" | "debit",
      amount: string,
      invoiceId = 1
    ) {
      const note = await createNote(type, amount, invoiceId);
      await notes.updateFinancialNote(
        note.id,
        {
          ...draftNote(type, amount, invoiceId),
          cai: "338827-15203E-A419E0-63BE03-0909A6-53",
          fiscalNumber: `001-001-01-${String(note.id).padStart(8, "0")}`,
          documentRangeStart: "001-001-01-00000001",
          documentRangeEnd: "001-001-01-99999999",
          documentDate: "2026-10-29",
          documentDueDate: "2026-11-29",
          emissionDeadline: "2027-12-31",
        },
        admin
      );
      await notes.createFinancialNoteAttachment(
        {
          entityId: note.id,
          fileName: "note.pdf",
          fileKey: `test/${note.id}`,
          fileUrl: "/test.pdf",
          mimeType: "application/pdf",
          fileSize: 20,
          uploadedById: 1,
        },
        admin
      );
      await notes.transitionFinancialNote(note.id, "review", undefined, admin);
      await notes.transitionFinancialNote(
        note.id,
        "account",
        undefined,
        accountant
      );
      return note;
    }
    async function fundedAdvance(
      mode: "direct" | "contractual" | "legacy_manual" = "direct",
      amount = 50000
    ) {
      const rule =
        mode === "contractual"
          ? ["amount", "10", "subtotal"]
          : [null, null, null];
      const advance = (
        await client.query(
          `insert into "purchaseOrderAdvances"("advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById","applicationMode","amortizationMode","amortizationValue","amortizationBase") values($1,1,1,1,'HNL',$2,current_date,1,$3,$4,$5,$6) returning id`,
          [`ANT-${mode}`, amount, mode, ...rule]
        )
      ).rows[0];
      const batch = (
        await client.query(
          `insert into "treasuryPaymentBatches"("batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind",status) values($1,1,'HNL',current_date,1,'purchase_order_advance','cerrado') returning id`,
          [`TES-ADV-${mode}`]
        )
      ).rows[0];
      await client.query(
        `insert into "treasuryPaymentItems"("batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation","accountedAt") values($1,'purchase_order_advance',$2,1,'SUP-TEST','Supplier',$3,'HNL',$4,$4,$4,'contabilizada',false,now())`,
        [batch.id, advance.id, `ANT-${mode}`, amount]
      );
      return advance.id;
    }
    async function applyAdvances() {
      return (await db()).transaction(executor =>
        advances.applyAvailableAdvancesForPurchaseOrder({
          executor,
          purchaseOrderId: 1,
          actorId: 1,
        })
      );
    }
    async function activate(
      options: Parameters<
        typeof settlement.activateInvoiceSettlementPolicies
      >[1] = {}
    ) {
      return (await db()).transaction(tx =>
        settlement.activateInvoiceSettlementPolicies(tx, {
          actorId: 1,
          beforeApply: async () => {},
          ...options,
        })
      );
    }

    it("preserves legacy policy and original four-decimal values while disabled", async () => {
      const before = await rawInvoices();
      expect((await policy()).policy).toBe("legacy");
      expect((await policy()).amount).toBe(43119.17);
      expect(
        await (
          await db()
        ).transaction(tx => settlement.enrollNewInvoiceSettlement(tx, 1, 1))
      ).toBe(false);
      expect(await rawInvoices()).toEqual(before);
      expect((await eligible())?.money.availableAmount).toBe(43119.17);
    });
    it.each(["HNL", "USD"] as const)(
      "settles the document cents in %s, rejects a genuine extra cent, and preserves originals",
      async currency => {
        if (currency === "USD")
          await client.query(
            `update invoices set currency='USD',"exchangeRate"=27.0359,"exchangeRateDate"=current_date where id=1; update "purchaseOrders" set currency='USD',"exchangeRate"=27.0359,"exchangeRateDate"=current_date where id=1`
          );
        const before = await rawInvoices();
        expect(await enroll()).toBe(true);
        expect((await policy()).amount).toBe(43119.16);
        expect((await eligible())?.money.availableAmount).toBe(43119.16);
        await expect(createBatch(43119.17)).rejects.toThrow(/43119.16/);
        await pay(43119.16);
        expect(await eligible()).toBeUndefined();
        expect(await noteBalance()).toBe("0.0000");
        expect(await rawInvoices()).toEqual(before);
        expect(
          (
            await client.query(
              'select "invoiceNetPayable" from "treasuryPaymentItems" where "invoiceId"=1'
            )
          ).rows[0].invoiceNetPayable
        ).toBe("43119.1600");
        await expect(createNote("credit", "0.0001")).rejects.toThrow(
          /saldo disponible/
        );
      }
    );
    it("accepts a positive one-cent difference and still rejects one cent above its official net", async () => {
      await enroll(2);
      expect((await policy(2)).amount).toBe(2118.45);
      await expect(createBatch(2118.46, 2)).rejects.toThrow(/2118.45/);
      await pay(2118.45, 2);
      expect(await noteBalance(2)).toBe("0.0000");
      expect(
        (await client.query('select "netPayable" from invoices where id=2'))
          .rows[0].netPayable
      ).toBe("2118.4416");
    });
    it("keeps one stable policy through partial payments and closes without a repeated cent", async () => {
      await enroll();
      await pay(20000);
      expect((await policy()).amount).toBe(43119.16);
      expect((await eligible())?.money.availableAmount).toBe(23119.16);
      await pay(23119.16);
      expect(await eligible()).toBeUndefined();
      expect(await noteBalance()).toBe("0.0000");
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementPolicies" where "invoiceId"=1'
          )
        ).rows[0].n
      ).toBe(1);
      expect(
        (
          await client.query(
            'select sum("bankPaidAmount")::text n from "treasuryPaymentItems" where "invoiceId"=1'
          )
        ).rows[0].n
      ).toBe("43119.1600");
      await expect(createBatch(0.01)).rejects.toThrow(/0.00/);
    });
    it("enrolls a new invoice once and rejects an inconsistent original formula", async () => {
      expect(await enroll()).toBe(true);
      expect(await enroll()).toBe(false);
      await client.query(
        'update invoices set "netPayable"=2118.4516 where id=2'
      );
      await expect(enroll(2)).rejects.toThrow(/neto original/);
      expect((await policy(2)).policy).toBe("legacy");
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementPolicies"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("preserves raw credit precision and closes a full original-value credit at zero", async () => {
      await enroll();
      expect(await noteBalance()).toBe("43119.1650");
      await expect(createNote("credit", "43119.1700")).rejects.toThrow(
        /saldo disponible/
      );
      const note = await postNote("credit", "43119.1650");
      expect((await policy()).amount).toBe(0);
      expect(await noteBalance()).toBe("0.0000");
      const detail = await notes.getFinancialNote(note.id, admin);
      expect(detail.note.total).toBe("43119.1650");
      expect(
        (
          await client.query(
            'select "netPayable","creditNoteTotal" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual({ netPayable: "0.0000", creditNoteTotal: "43119.1650" });
    });
    it("retains four-decimal maximum credit on a no-difference invoice", async () => {
      await enroll(3);
      expect(await noteBalance(3)).toBe("100.0055");
      await expect(createNote("credit", "100.0100", 3)).rejects.toThrow(
        /saldo disponible/
      );
      await postNote("credit", "100.0055", 3);
      expect(await noteBalance(3)).toBe("0.0000");
    });
    it("preserves four-decimal partial-credit precision when effective payments stay covered", async () => {
      await enroll();
      await pay(0.1);
      expect(await noteBalance()).toBe("43119.0650");
      await postNote("credit", "43119.0649");
      expect((await policy()).amount).toBe(0.1);
      expect(await noteBalance()).toBe("0.0000");
      expect(
        (await client.query('select "netPayable" from invoices where id=1'))
          .rows[0].netPayable
      ).toBe("0.1001");
    });
    it("rejects a raw-valid credit if its rounded components would uncover a real payment", async () => {
      await enroll();
      await pay(0.1);
      expect(await noteBalance()).toBe("43119.0650");
      await expect(postNote("credit", "43119.0650")).rejects.toThrow();
      expect((await policy()).amount).toBe(43119.16);
      expect(
        (
          await client.query(
            'select "netPayable","creditNoteTotal" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual({ netPayable: "43119.1650", creditNoteTotal: "0.0000" });
      expect(
        (
          await client.query(
            "select status from \"financialNotes\" where origin='manual'"
          )
        ).rows.every(row => row.status !== "registrada")
      ).toBe(true);
    });
    it("rechecks the effective limit when voiding a debit under an existing reservation", async () => {
      await enroll();
      const note = await postNote("debit", "0.0050");
      expect((await policy()).amount).toBe(43119.17);
      await createBatch(43119.17);
      await expect(
        notes.transitionFinancialNote(
          note.id,
          "void",
          "Revertir débito reservado",
          admin
        )
      ).rejects.toThrow();
      expect((await notes.getFinancialNote(note.id, admin)).note.status).toBe(
        "registrada"
      );
      expect((await policy()).amount).toBe(43119.17);
    });
    it("applies a direct advance to the effective net exactly once", async () => {
      await fundedAdvance();
      await enroll();
      await applyAdvances();
      expect(
        (
          await client.query(
            'select amount from "purchaseOrderAdvanceApplications" where "invoiceId"=1'
          )
        ).rows
      ).toEqual([{ amount: "43119.1600" }]);
      expect(await applyAdvances()).toEqual([]);
      expect(await noteBalance()).toBe("0.0000");
      expect(await eligible()).toBeUndefined();
    });
    it.each(["contractual", "legacy_manual"] as const)(
      "does not subtract %s documentary amortization twice",
      async mode => {
        const advanceId = await fundedAdvance(mode, 100);
        await client.query(`update invoices set "otherRetentionTotal"=10,"netPayable"=43109.1650 where id=1;
      insert into "invoiceDocumentAdjustments"(id,"invoiceId","adjustmentType","inputMode",percentage,"baseAmount",amount) values(900,1,'advance_amortization','amount',0.017394,57492.22,10);
      insert into "invoiceContractualAmortizations"("invoiceId","purchaseOrderId",treatment,"invoiceDocumentAdjustmentId","inputMode","inputValue","baseKind","baseAmount","proposedAmount",amount) values(1,1,'${mode}',900,'amount',10,'subtotal',57492.22,${mode === "contractual" ? 10 : 0},10)`);
        await enroll();
        await applyAdvances();
        expect(
          (
            await client.query(
              'select amount,"applicationMode" from "purchaseOrderAdvanceApplications" where "purchaseOrderAdvanceId"=$1',
              [advanceId]
            )
          ).rows
        ).toEqual([{ amount: "10.0000", applicationMode: mode }]);
        expect((await eligible())?.money.availableAmount).toBe(43109.16);
        expect((await policy()).amount).toBe(43109.16);
      }
    );
    it("unlocks quality retention after the new ordinary net is completely paid", async () => {
      await client.query(`update invoices set "otherRetentionTotal"=10,"netPayable"=43109.1650 where id=1;
      insert into "invoiceDocumentAdjustments"("invoiceId","adjustmentType","inputMode",percentage,"baseAmount",amount) values(1,'quality_retention','amount',0.017394,57492.22,10)`);
      await enroll();
      await expect(
        quality.requestQualityRetentionRelease({
          invoiceId: 1,
          requestedAmount: 10,
          justification: "Prueba antes de cierre",
          requestedById: 1,
        })
      ).rejects.toThrow(/completamente pagado/);
      await pay(43109.16);
      const release = await quality.requestQualityRetentionRelease({
        invoiceId: 1,
        requestedAmount: 10,
        justification: "Neto ordinario liquidado",
        requestedById: 1,
      });
      expect(release.requestedAmount).toBe("10.0000");
    });
    it("does not permit removing a policy after a payment reservation", async () => {
      await enroll();
      await createBatch(100);
      await expect(
        client.query(
          'delete from "invoiceSettlementPolicies" where "invoiceId"=1'
        )
      ).rejects.toThrow();
      expect((await policy()).policy).toBe("document_cents_v1");
    });
    it("cascades a policy only when deleting a draft without payment history", async () => {
      await enroll();
      await expect(
        client.query("delete from invoices where id=1")
      ).rejects.toThrow();
      await client.query("update invoices set status='borrador' where id=1");
      await client.query("delete from invoices where id=1");
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementPolicies" where "invoiceId"=1'
          )
        ).rows[0].n
      ).toBe(0);
      await enroll(2);
      await createBatch(10, 2);
      await client.query("update invoices set status='borrador' where id=2");
      await expect(
        client.query("delete from invoices where id=2")
      ).rejects.toThrow();
      expect((await policy(2)).policy).toBe("document_cents_v1");
    });
    it("activates unpaid invoices in one audited batch while preserving all history", async () => {
      // Different histories are intentional: cancelled and excluded lines also freeze legacy semantics.
      const paid = await createBatch(10, 4);
      await accountBatch(paid.id);
      const bank = await createBatch(10, 5);
      await client.query(
        `update "treasuryPaymentBatches" set status='pendiente_contabilizacion' where id=$1`,
        [bank.id]
      );
      await client.query(
        `update "treasuryPaymentItems" set status='pagada',"bankPaidAmount"=10 where "batchId"=$1`,
        [bank.id]
      );
      const cancelled = await createBatch(10, 6);
      await client.query(
        `update "treasuryPaymentBatches" set status='anulado' where id=$1`,
        [cancelled.id]
      );
      await client.query(
        `update "treasuryPaymentItems" set status='excluida',"activeReservation"=false where "batchId"=$1`,
        [cancelled.id]
      );
      const before = await rawInvoices();
      const history = (
        await client.query(
          'select to_jsonb(t) data from "treasuryPaymentItems" t order by id'
        )
      ).rows;
      const preview = await activate();
      expect(preview.changed).toBe(false);
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementPolicies"'
          )
        ).rows[0].n
      ).toBe(0);
      let backedUp = false;
      const result = await activate({
        apply: true,
        beforeApply: async snapshot => {
          backedUp = true;
          expect(snapshot.eligibleInvoices.length).toBeGreaterThan(0);
        },
      });
      expect(backedUp).toBe(true);
      expect(result.changed).toBe(true);
      const ids = (
        await client.query(
          'select "invoiceId" from "invoiceSettlementPolicies" order by "invoiceId"'
        )
      ).rows.map(r => r.invoiceId);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      for (const id of [4, 5, 6]) {
        expect(ids).not.toContain(id);
        expect((await policy(id)).policy).toBe("legacy");
      }
      expect(await rawInvoices()).toEqual(before);
      expect(
        (
          await client.query(
            'select to_jsonb(t) data from "treasuryPaymentItems" t order by id'
          )
        ).rows
      ).toEqual(history);
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementActivations"'
          )
        ).rows[0].n
      ).toBe(1);
      const repeat = await activate({ apply: true });
      expect(repeat.changed).toBe(false);
      expect(repeat.alreadyApplied).toBe(true);
    });
    it("serializes concurrent activation into one operation", async () => {
      const results = await Promise.all([
        activate({ apply: true }),
        activate({ apply: true }),
      ]);
      expect(results.filter(r => r.changed)).toHaveLength(1);
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementActivations"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("detects a newly committed receipt during activation and enrolls it on retry", async () => {
      let releaseReceipt!: () => void;
      let receiverReady!: () => void;
      let receiverPid = 0;
      const ready = new Promise<void>(resolve => {
        receiverReady = resolve;
      });
      const holdReceipt = new Promise<void>(resolve => {
        releaseReceipt = resolve;
      });
      const receiving = (await db()).transaction(async tx => {
        await tx.execute(
          sql`insert into "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById") values(13,'OC-TEST-13',1,1,1)`
        );
        await tx.execute(
          sql`insert into receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") values(13,'RE-TEST-13','purchase_order',13,1,1)`
        );
        await tx.execute(
          sql`insert into invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",total,"netPayable") values(13,'FT-TEST-13',13,13,1,1,'borrador',now(),now(),now()+interval '1 year',100,100)`
        );
        expect(await settlement.enrollNewInvoiceSettlement(tx, 13, 1)).toBe(
          false
        );
        receiverPid = (await tx.execute(sql`select pg_backend_pid() pid`))
          .rows[0].pid as number;
        receiverReady();
        await holdReceipt;
      });
      await Promise.race([
        ready,
        receiving.then(() => {
          throw new Error(
            "Receipt transaction ended before its synchronization point"
          );
        }),
      ]);
      const activation = activate({ apply: true }).then(
        result => ({ result, error: undefined }),
        error => ({ result: undefined, error })
      );
      try {
        let waitingForReceipt = false;
        const deadline = Date.now() + 4000;
        while (!waitingForReceipt && Date.now() < deadline) {
          waitingForReceipt = (
            await client.query(
              `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%invoiceSettlementSettings%' and $1=any(pg_blocking_pids(pid))) waiting`,
              [receiverPid]
            )
          ).rows[0].waiting;
          if (!waitingForReceipt)
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(waitingForReceipt).toBe(true);
      } finally {
        releaseReceipt();
      }
      await receiving;
      const outcome = await activation;
      expect(outcome.error?.message).toMatch(/Cambió el conjunto de facturas/);
      expect(
        (
          await client.query(
            'select enabled from "invoiceSettlementSettings" where id=1'
          )
        ).rows[0].enabled
      ).toBe(false);
      expect((await policy(13)).policy).toBe("legacy");
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementActivations"'
          )
        ).rows[0].n
      ).toBe(0);
      expect((await activate({ apply: true })).changed).toBe(true);
      expect((await policy(13)).policy).toBe("document_cents_v1");
    });
    it.each(["direct", "contractual", "legacy_manual"] as const)(
      "preserves legacy on any existing %s advance application",
      async mode => {
        const advanceId = await fundedAdvance(mode, 100);
        if (mode !== "direct") {
          await client.query(`update invoices set "otherRetentionTotal"=10,"netPayable"=43109.1650 where id=1;
        insert into "invoiceDocumentAdjustments"(id,"invoiceId","adjustmentType","inputMode",percentage,"baseAmount",amount) values(900,1,'advance_amortization','amount',0.017394,57492.22,10);
        insert into "invoiceContractualAmortizations"("invoiceId","purchaseOrderId",treatment,"invoiceDocumentAdjustmentId","inputMode","inputValue","baseKind","baseAmount","proposedAmount",amount) values(1,1,'${mode}',900,'amount',10,'subtotal',57492.22,${mode === "contractual" ? 10 : 0},10)`);
        }
        await client.query(
          `insert into "purchaseOrderAdvanceApplications"("purchaseOrderAdvanceId","invoiceId",amount,"applicationMode","invoiceDocumentAdjustmentId","appliedById") values($1,1,10,$2,$3,1)`,
          [advanceId, mode, mode === "direct" ? null : 900]
        );
        const applications = (
          await client.query(
            'select to_jsonb(a) data from "purchaseOrderAdvanceApplications" a order by id'
          )
        ).rows;
        const result = await activate({ apply: true });
        expect(result.changed).toBe(true);
        expect((await policy()).policy).toBe("legacy");
        expect((await policy(2)).policy).toBe("document_cents_v1");
        expect(
          (
            await client.query(
              'select to_jsonb(a) data from "purchaseOrderAdvanceApplications" a order by id'
            )
          ).rows
        ).toEqual(applications);
      }
    );
    it("requires a backup and rolls the entire activation back if backup fails", async () => {
      await expect(
        activate({ apply: true, beforeApply: undefined })
      ).rejects.toThrow();
      await expect(
        activate({
          apply: true,
          beforeApply: async () => {
            throw new Error("backup failed");
          },
        })
      ).rejects.toThrow("backup failed");
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceSettlementPolicies"'
          )
        ).rows[0].n
      ).toBe(0);
      expect(
        (
          await client.query(
            'select enabled from "invoiceSettlementSettings" where id=1'
          )
        ).rows[0].enabled
      ).toBe(false);
    });
    it("rolls back policies and enabled settings if audit insertion fails", async () => {
      await client.query(`create function private.reject_settlement_test_event() returns trigger language plpgsql as $$begin raise exception 'audit failed';end$$;
      create trigger reject_settlement_test_event before insert on "invoiceSettlementActivations" for each row execute function private.reject_settlement_test_event()`);
      try {
        await expect(activate({ apply: true })).rejects.toThrow();
        expect(
          (
            await client.query(
              'select count(*)::int n from "invoiceSettlementPolicies"'
            )
          ).rows[0].n
        ).toBe(0);
        expect(
          (
            await client.query(
              'select enabled from "invoiceSettlementSettings" where id=1'
            )
          ).rows[0].enabled
        ).toBe(false);
      } finally {
        await client.query(
          'drop trigger reject_settlement_test_event on "invoiceSettlementActivations"; drop function private.reject_settlement_test_event()'
        );
      }
    });
    it("keeps activation and policies inaccessible to browser roles", async () => {
      for (const role of ["anon", "authenticated"]) {
        await client.query(`set role ${role}`);
        try {
          for (const table of [
            "invoiceSettlementSettings",
            "invoiceSettlementPolicies",
            "invoiceSettlementActivations",
          ])
            await expect(
              client.query(`select * from "${table}" limit 0`)
            ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await client.query("reset role");
        }
      }
      const tables = (
        await client.query(
          `select relname,relrowsecurity from pg_class where relname=any($1::text[])`,
          [
            [
              "invoiceSettlementSettings",
              "invoiceSettlementPolicies",
              "invoiceSettlementActivations",
            ],
          ]
        )
      ).rows;
      expect(tables).toHaveLength(3);
      expect(tables.every(r => r.relrowsecurity)).toBe(true);
    });
    it("reapplies the additive migration without changing active policy, settings, or original invoice data", async () => {
      await enroll();
      const before = await rawInvoices();
      const policyBefore = (
        await client.query(
          'select * from "invoiceSettlementPolicies" order by "invoiceId"'
        )
      ).rows;
      const migration = process.env.INVOICE_SETTLEMENT_TEST_MIGRATION;
      expect(migration).toBeTruthy();
      const content = readFileSync(
        new URL(`../supabase/migrations/${migration}`, import.meta.url),
        "utf8"
      );
      await client.query(content);
      await client.query(content);
      expect(await rawInvoices()).toEqual(before);
      expect(
        (
          await client.query(
            'select * from "invoiceSettlementPolicies" order by "invoiceId"'
          )
        ).rows
      ).toEqual(policyBefore);
      expect(
        (
          await client.query(
            'select enabled from "invoiceSettlementSettings" where id=1'
          )
        ).rows[0].enabled
      ).toBe(true);
    });
  }
);
