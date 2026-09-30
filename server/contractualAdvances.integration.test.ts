import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
const testUrl = process.env.FINANCIAL_NOTES_TEST_DATABASE_URL;
const describeDb = testUrl ? describe : describe.skip;
const actor = { id: 1, role: "admin", name: "Contractual test" };
describeDb(
  "contractual advances: isolated PostgreSQL",
  { timeout: 30000 },
  () => {
    let client: Client,
      database: typeof import("./db"),
      advances: typeof import("./purchaseOrderAdvances"),
      treasury: typeof import("./treasury"),
      contracts: typeof import("./contractualAdvances"),
      reconciliation: typeof import("./advanceReconciliation");
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
      advances = await import("./purchaseOrderAdvances");
      treasury = await import("./treasury");
      contracts = await import("./contractualAdvances");
      reconciliation = await import("./advanceReconciliation");
    });
    afterAll(async () => {
      await ((await database?.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(`TRUNCATE users,projects,suppliers,"purchaseOrders",receipts,invoices,"treasuryPaymentBatches" RESTART IDENTITY CASCADE;
   INSERT INTO users(id,"openId",name,role) VALUES(1,'contract-test','Contract test','admin');
   INSERT INTO projects(id,code,name) VALUES(18,'010','San Jose');
   INSERT INTO suppliers(id,"supplierCode",name) VALUES(749,'PROV-000749','GEO STRUCTURES SA DE CV');
   INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById","paymentMethod",status,"appliesContract") VALUES(897,'CD-010-00000150',18,749,1,'contado','parcialmente_recibida',true);
   INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES(2096,'RE-010-00000319','purchase_order',897,18,1);
   INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",subtotal,total,"otherRetentionTotal","netPayable","accountedAt") VALUES(1953,'FT-010-00000306',2096,897,18,749,'registrada',now(),now(),now()+interval '1 year',2061372.47,2061372.47,618411.74,1442960.73,now());
   INSERT INTO "purchaseOrderAdvances"(id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") VALUES(10,'ANT-2026-000010',897,18,749,'HNL',1163051.75,current_date,1);
   INSERT INTO "invoiceDocumentAdjustments"(id,"invoiceId","adjustmentType","inputMode",percentage,"baseAmount",amount) VALUES(21,1953,'quality_retention','amount',5,2061372.47,103068.62),(22,1953,'advance_amortization','amount',25,2061372.47,515343.12);
   INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind",status) VALUES(140,'TES-2026-000140',18,'HNL',current_date,1,'purchase_order_advance','cerrado'),(392,'TES-2026-000392',18,'HNL',current_date,1,'purchase_order_advance','cerrado'),(501,'TES-2026-000501',18,'HNL',current_date,1,'purchase_order_advance','cerrado');
   INSERT INTO "treasuryPaymentItems"("batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation","accountedAt") VALUES(140,'purchase_order_advance',10,749,'PROV-000749','GEO','ANT-2026-000010','HNL',1163051.75,809456.56,809456.56,'contabilizada',false,now()),(392,'purchase_order_advance',10,749,'PROV-000749','GEO','ANT-2026-000010','HNL',1163051.75,223104.80,223104.80,'contabilizada',false,now()),(501,'purchase_order_advance',10,749,'PROV-000749','GEO','ANT-2026-000010','HNL',1163051.75,130490.39,130490.39,'contabilizada',false,now());
   INSERT INTO "purchaseOrderAdvanceApplications"("purchaseOrderAdvanceId","invoiceId",amount,"appliedById") VALUES(10,1953,1163051.75,1);
   INSERT INTO "systemSettings"(id,"treasuryEnabled","purchaseOrderApprovalMinimumHnl","purchaseOrderApprovalMinimumUsd") VALUES(1,true,0,0) ON CONFLICT(id) DO UPDATE SET "treasuryEnabled"=true;
   SELECT setval(pg_get_serial_sequence('"invoiceDocumentAdjustments"','id'),22,true);
   SELECT setval(pg_get_serial_sequence('"treasuryPaymentBatches"','id'),501,true);`);
    });
    async function repair() {
      const db = (await database.getDb())!;
      return db.transaction(tx =>
        reconciliation.regularizeGeo(tx, { apply: true, actorId: 1 })
      );
    }
    async function apply() {
      const db = (await database.getDb())!;
      return db.transaction(tx =>
        advances.applyAvailableAdvancesForPurchaseOrder({
          executor: tx,
          purchaseOrderId: 897,
          actorId: 1,
        })
      );
    }
    async function draft(amount: number) {
      return treasury.createTreasuryBatch({
        actor,
        projectId: 18,
        currency: "HNL",
        requestedPaymentDate: new Date(),
        items: [{ invoiceId: 1953, requestedAmount: amount }],
      });
    }
    it("regularizes GEO, preserves documents/payments, and repeats without effects", async () => {
      const result = await repair();
      expect(result.changed).toBe(true);
      expect(result.expected.pendingAmortization).toBe(647708.63);
      expect((await repair()).alreadyApplied).toBe(true);
      expect(await apply()).toEqual([]);
      const detail = await database.getInvoiceById(1953);
      expect(Number(detail?.appliedAdvanceAmount)).toBe(0);
      expect(detail?.contractualAmortization?.pendingAmortizationAmount).toBe(
        647708.63
      );
      const rows = await treasury.listEligibleTreasuryInvoices({
        projectId: 18,
      });
      expect(rows[0].money.availableAmount).toBe(1442960.73);
      expect(
        await advances.getPurchaseOrderAdvancesSummary(
          (await database.getDb())!,
          897
        )
      ).toMatchObject({
        appliedAmount: 515343.12,
        directAppliedAmount: 0,
        contractualAmortizationAmount: 515343.12,
        unappliedAmount: 647708.63,
      });
      expect(
        (
          await client.query(
            'select count(*)::int n from "advanceFinancialEvents"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("accepts the exact payable and rejects one cent above", async () => {
      await repair();
      await expect(draft(1442960.74)).rejects.toThrow(/superar|saldo/i);
      const b = await draft(1442960.73);
      expect(b).toBeTruthy();
      const row = (
        await client.query(
          'select "appliedAdvanceAmount","contractualAmortizationAmount" from "treasuryPaymentItems" where "invoiceId"=1953'
        )
      ).rows[0];
      expect(Number(row.appliedAdvanceAmount)).toBe(0);
      expect(Number(row.contractualAmortizationAmount)).toBe(515343.12);
    });
    it("refuses historical ambiguity and refuses GEO if a TES changed", async () => {
      await expect(draft(279908.98)).rejects.toThrow(/conciliación/);
      await client.query(
        'update "treasuryPaymentItems" set "bankPaidAmount"=130490.38 where "batchId"=501'
      );
      await expect(repair()).rejects.toThrow(/TES/);
      expect(
        (
          await client.query(
            'select "applicationMode" from "purchaseOrderAdvances" where id=10'
          )
        ).rows[0].applicationMode
      ).toBe("direct");
    });
    it("does not enable quality release or count amortization twice for notes", async () => {
      await repair();
      const db = (await database.getDb())!;
      const notes = await import("./financialNotes");
      expect(Number(await notes.invoiceNoteAvailable(db, 1953))).toBe(
        1442960.73
      );
      const quality = await import("./qualityRetentionReleases");
      await expect(
        quality.requestQualityRetentionRelease({
          invoiceId: 1953,
          requestedAmount: 103068.62,
          justification: "Liberacion de prueba",
          requestedById: 1,
        })
      ).rejects.toThrow(/pago|pagada|pagado|ordinario/i);
    });
    it("consumes future planillas progressively", async () => {
      await repair();
      await client.query(`INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES(2097,'RE-NEXT','purchase_order',897,18,1);
   INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",subtotal,total,"netPayable") VALUES(1954,'FT-NEXT',2097,897,18,749,'borrador',now(),now(),now()+interval '1 year',1000000,1000000,1000000);`);
      await database.replaceInvoiceDocumentAdjustments(
        1954,
        { advanceAmortizationAmount: 250000 },
        1
      );
      await database.reviewInvoice(1954, 1);
      await client.query(
        `update invoices set status='pendiente_contabilizar' where id=1954`
      );
      await database.accountInvoice({ id: 1954, accountedById: 1 });
      expect(
        (
          await contracts.getContractualInvoiceContext(
            (await database.getDb())!,
            1954
          )
        )?.pendingAmortizationAmount
      ).toBe(397708.63);
      expect(
        (
          await client.query(
            'select amount from "purchaseOrderAdvanceApplications" where "invoiceId"=1954'
          )
        ).rows[0].amount
      ).toBe("250000.0000");
    });
    it("blocks payment until full funding, without consuming a whole remaining advance", async () => {
      await repair();
      await client.query(
        'update "treasuryPaymentItems" set "bankPaidAmount"=130490.38 where "batchId"=501'
      );
      await expect(draft(100)).rejects.toThrow(/anticipos pendientes/);
      expect(await apply()).toEqual([]);
    });
    it("rolls back a concurrent duplicate draft", async () => {
      await repair();
      const results = await Promise.allSettled([
        draft(1442960.73),
        draft(1442960.73),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await client.query(
            'select count(*)::int n from "treasuryPaymentItems" where "invoiceId"=1953 and "activeReservation"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("enforces application provenance at the database boundary", async () => {
      await repair();
      await expect(
        client.query(
          `update "purchaseOrderAdvanceApplications" set "invoiceDocumentAdjustmentId"=21 where "invoiceId"=1953`
        )
      ).rejects.toThrow(/documental/);
    });
    it("persists a justified zero and rejects an unexplained change", async () => {
      await repair();
      await client.query(
        `DELETE FROM "purchaseOrderAdvanceApplications" WHERE "invoiceId"=1953; UPDATE invoices SET status='borrador' WHERE id=1953`
      );
      await expect(
        database.replaceInvoiceDocumentAdjustments(
          1953,
          { advanceAmortizationAmount: 0 },
          1
        )
      ).rejects.toThrow(/motivo/);
      await database.replaceInvoiceDocumentAdjustments(
        1953,
        {
          advanceAmortizationAmount: 0,
          advanceAmortizationOverrideReason:
            "Excepcion acordada para esta planilla",
          qualityRetentionAmount: 103068.62,
        },
        1
      );
      const c = await contracts.getContractualInvoiceContext(
        (await database.getDb())!,
        1953
      );
      expect(Number(c?.saved?.amount)).toBe(0);
      expect(c?.saved?.invoiceDocumentAdjustmentId).toBeNull();
      await database.reviewInvoice(1953, 1);
    });
    it("supports a tax-inclusive base and caps the last amortization", async () => {
      await repair();
      await client.query(
        `DELETE FROM "purchaseOrderAdvanceApplications" WHERE "invoiceId"=1953; UPDATE invoices SET status='borrador',subtotal=1000,total=1150,"netPayable"=1150,"otherRetentionTotal"=0 WHERE id=1953; UPDATE "purchaseOrderAdvances" SET "amortizationBase"='total',"amortizationValue"=100 WHERE id=10`
      );
      await database.replaceInvoiceDocumentAdjustments(
        1953,
        { advanceAmortizationPercent: 100 },
        1
      );
      let c = await contracts.getContractualInvoiceContext(
        (await database.getDb())!,
        1953
      );
      expect(c?.saved?.amount).toBe("1150.0000");
      expect(
        Number((await database.getInvoiceById(1953))?.invoice.netPayable)
      ).toBe(0);
      await client.query(
        `UPDATE "purchaseOrderAdvances" SET "requestedAmount"=17.01 WHERE id=10`
      );
      c = await contracts.getContractualInvoiceContext(
        (await database.getDb())!,
        1953
      );
      expect(c?.amount).toBe(17.01);
      await expect(database.reviewInvoice(1953, 1)).rejects.toThrow(
        /saldo disponible cambió/
      );
    });
    it("defers consumption without funding and only applies the defined amortization later", async () => {
      await repair();
      await client.query(
        `DELETE FROM "purchaseOrderAdvanceApplications" WHERE "invoiceId"=1953; UPDATE "treasuryPaymentItems" SET status='pagada',"activeReservation"=false WHERE "purchaseOrderAdvanceId"=10`
      );
      expect(await apply()).toEqual([]);
      await client.query(
        `UPDATE "treasuryPaymentItems" SET status='contabilizada',"activeReservation"=false WHERE "purchaseOrderAdvanceId"=10`
      );
      const allocation = await apply();
      expect(allocation).toHaveLength(1);
      expect(allocation[0].amount).toBe(515343.12);
      expect(await apply()).toEqual([]);
    });
    it("denies browser roles access to contractual snapshots and the audit trail", async () => {
      for (const role of ["anon", "authenticated"]) {
        await client.query(`SET ROLE ${role}`);
        await expect(
          client.query('select * from "invoiceContractualAmortizations"')
        ).rejects.toThrow(/permission denied/);
        await expect(
          client.query('select * from "advanceFinancialEvents"')
        ).rejects.toThrow(/permission denied/);
        await client.query("RESET ROLE");
      }
    });
    it("creates and inherits contractual rules without forcing 25 percent", async () => {
      await client.query(`INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById","paymentMethod",status) VALUES(898,'OC-NEW',18,749,1,'contado','emitida');
      INSERT INTO "purchaseOrderItems"("purchaseOrderId","itemName",quantity,"unitPrice",subtotal,"taxCode") VALUES(898,'Contrato',1,10000,10000,'exe');`);
      const created = await advances.createPurchaseOrderAdvance({
        actor,
        purchaseOrderId: 898,
        requestedAmount: 2000,
        requestedPercentage: 20,
        requestedPaymentDate: new Date(),
        applicationMode: "contractual",
        amortizationMode: "percentage",
        amortizationValue: 10,
        amortizationBase: "total",
      });
      expect(created.applicationMode).toBe("contractual");
      expect(Number(created.amortizationValue)).toBe(10);
      const next = await advances.createPurchaseOrderAdvance({
        actor,
        purchaseOrderId: 898,
        requestedAmount: 1000,
        requestedPaymentDate: new Date(),
      });
      expect(next.amortizationBase).toBe("total");
      expect(Number(next.amortizationValue)).toBe(10);
      await expect(
        advances.createPurchaseOrderAdvance({
          actor,
          purchaseOrderId: 898,
          requestedAmount: 1000,
          requestedPaymentDate: new Date(),
          applicationMode: "direct",
        })
      ).rejects.toThrow(/heredar/);
    });
    it("rejects an advance request or detail outside the user's project", async () => {
      const { appRouter } = await import("./routers");
      const caller = appRouter.createCaller({
        user: {
          ...actor,
          role: "user",
          buildreqRole: "administrador_proyecto",
          assignedProjectId: 99,
          assignedProjectIds: [99],
          mustChangePassword: false,
        },
        req: { headers: {} },
        res: {},
      } as any);
      await expect(
        caller.purchaseOrderAdvances.getById({ id: 10 })
      ).rejects.toThrow(/acceso/);
      await expect(
        caller.purchaseOrderAdvances.create({
          purchaseOrderId: 897,
          requestedAmount: 100,
          requestedPaymentDate: "2026-09-30",
          applicationMode: "contractual",
          amortizationMode: "percentage",
          amortizationValue: 20,
          amortizationBase: "subtotal",
        })
      ).rejects.toThrow(/acceso/);
    });
  }
);
