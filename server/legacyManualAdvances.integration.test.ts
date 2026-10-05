import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
const testUrl = process.env.FINANCIAL_NOTES_TEST_DATABASE_URL;
const describeDb = testUrl ? describe : describe.skip;
const actor = { id: 1, role: "admin", name: "Legacy manual test" };

describeDb(
  "historical manual advances: isolated PostgreSQL",
  { timeout: 30000 },
  () => {
    let client: Client,
      database: typeof import("./db"),
      advances: typeof import("./purchaseOrderAdvances"),
      treasury: typeof import("./treasury"),
      historical: typeof import("./legacyManualAdvances");
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
      historical = await import("./legacyManualAdvances");
    });
    afterAll(async () => {
      await ((await database?.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      delete process.env.LEGACY_MANUAL_ADVANCES_ENABLED;
      await client.query(`TRUNCATE users,projects,suppliers,"purchaseOrders",receipts,invoices,"treasuryPaymentBatches" RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,role) VALUES(1,'legacy-test','Legacy test','admin');
      INSERT INTO projects(id,code,name) VALUES(22,'018','Project 018');
      INSERT INTO suppliers(id,"supplierCode",name) VALUES(111,'PROV-000111','AC/DC');
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById","paymentMethod",status,"appliesContract") VALUES(2202,'CD-018-00000527',22,111,1,'contado','parcialmente_recibida',true);
      INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES(2356,'RE-018-00000570','purchase_order',2202,22,1);
      INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",subtotal,total,"netPayable") VALUES(2198,'FT-018-00000542',2356,2202,22,111,'borrador',now(),now(),now()+interval '1 year',185387.60,185387.60,185387.60);
      INSERT INTO "purchaseOrderAdvances"(id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") VALUES(114,'ANT-2026-000114',2202,22,111,'HNL',36502.39,current_date,1),(115,'ANT-2026-000115',2202,22,111,'HNL',21155.06,current_date,1),(116,'ANT-2026-000116',2202,22,111,'HNL',71705.15,current_date,1);
      INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind",status) VALUES(556,'TES-2026-000556',22,'HNL',current_date,1,'purchase_order_advance','cerrado'),(557,'TES-2026-000557',22,'HNL',current_date,1,'purchase_order_advance','cerrado'),(558,'TES-2026-000558',22,'HNL',current_date,1,'purchase_order_advance','cerrado');
      INSERT INTO "treasuryPaymentItems"(id,"batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation","accountedAt") VALUES(2534,556,'purchase_order_advance',114,111,'PROV-000111','AC/DC','ANT-2026-000114','HNL',36502.39,36502.39,36502.39,'contabilizada',false,now()-interval '3 day'),(2535,557,'purchase_order_advance',115,111,'PROV-000111','AC/DC','ANT-2026-000115','HNL',21155.06,21155.06,21155.06,'contabilizada',false,now()-interval '2 day'),(2536,558,'purchase_order_advance',116,111,'PROV-000111','AC/DC','ANT-2026-000116','HNL',71705.15,71705.15,71705.15,'contabilizada',false,now()-interval '1 day');
      INSERT INTO "systemSettings"(id,"treasuryEnabled","purchaseOrderApprovalMinimumHnl","purchaseOrderApprovalMinimumUsd") VALUES(1,true,0,0) ON CONFLICT(id) DO UPDATE SET "treasuryEnabled"=true;
      SELECT setval(pg_get_serial_sequence('"treasuryPaymentBatches"','id'),558,true);
      SELECT setval(pg_get_serial_sequence('"treasuryPaymentItems"','id'),2536,true);`);
    });
    async function enable() {
      return (await database.getDb())!.transaction(tx =>
        historical.enableLegacyManualAdvances(tx, { apply: true, actorId: 1 })
      );
    }
    async function consume() {
      return (await database.getDb())!.transaction(tx =>
        advances.applyAvailableAdvancesForPurchaseOrder({
          executor: tx,
          purchaseOrderId: 2202,
          actorId: 1,
        })
      );
    }
    async function post(id = 2198) {
      await database.reviewInvoice(id, 1);
      await database.submitInvoiceForAccounting({ id, submittedById: 1 });
      return database.accountInvoice({ id, accountedById: 1 });
    }
    async function nextInvoice(id = 2199) {
      await client.query(
        `INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES($1,$2,'purchase_order',2202,22,1)`,
        [id + 160, `RE-${id}`]
      );
      await client.query(
        `INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",subtotal,total,"netPayable") VALUES($1,$2,$3,2202,22,111,'borrador',now(),now(),now()+interval '1 year',185387.60,185387.60,185387.60)`,
        [id, `FT-${id}`, id + 160]
      );
    }
    it("previews without mutation, enables only approved metadata and is idempotent", async () => {
      const before = (
        await client.query(
          `select to_jsonb(a) data from "purchaseOrderAdvances" a order by id`
        )
      ).rows;
      const payments = (
        await client.query(
          `select to_jsonb(t) data from "treasuryPaymentItems" t order by id`
        )
      ).rows;
      const invoices = (
        await client.query(
          `select to_jsonb(i) data from invoices i order by id`
        )
      ).rows;
      const db = (await database.getDb())!;
      expect(
        (await db.transaction(tx => historical.enableLegacyManualAdvances(tx)))
          .changed
      ).toBe(false);
      expect(
        (
          await client.query(
            `select to_jsonb(a) data from "purchaseOrderAdvances" a order by id`
          )
        ).rows
      ).toEqual(before);
      expect((await enable()).changed).toBe(true);
      expect((await enable()).alreadyApplied).toBe(true);
      expect(
        (
          await client.query(
            `select to_jsonb(a) data from "purchaseOrderAdvances" a order by id`
          )
        ).rows
      ).toEqual(
        before.map(r => ({
          data: { ...r.data, applicationMode: "legacy_manual" },
        }))
      );
      expect(
        (
          await client.query(
            `select to_jsonb(t) data from "treasuryPaymentItems" t order by id`
          )
        ).rows
      ).toEqual(payments);
      expect(
        (
          await client.query(
            `select to_jsonb(i) data from invoices i order by id`
          )
        ).rows
      ).toEqual(invoices);
      expect(
        (
          await client.query(
            `select count(*)::int n from "advanceFinancialEvents" where "operationKey"=$1`,
            [historical.LEGACY_MANUAL_KEY]
          )
        ).rows[0].n
      ).toBe(1);
    });
    it.each(["payment", "invoice", "application", "advance"])(
      "stops scoped activation if %s evidence changed",
      async kind => {
        if (kind === "payment")
          await client.query(
            `update "treasuryPaymentItems" set "bankPaidAmount"="bankPaidAmount"-0.01 where id=2534`
          );
        if (kind === "invoice")
          await client.query(
            `update invoices set status='revisada' where id=2198`
          );
        if (kind === "application")
          await client.query(
            `insert into "purchaseOrderAdvanceApplications"("purchaseOrderAdvanceId","invoiceId",amount,"appliedById") values(114,2198,1,1)`
          );
        if (kind === "advance")
          await client.query(
            `update "purchaseOrderAdvances" set currency='USD' where id=116`
          );
        await expect(enable()).rejects.toThrow(/detenida/);
        expect(
          (
            await client.query(
              `select distinct "applicationMode" mode from "purchaseOrderAdvances"`
            )
          ).rows
        ).toEqual([{ mode: "direct" }]);
        expect(
          (
            await client.query(
              `select count(*)::int n from "advanceFinancialEvents"`
            )
          ).rows[0].n
        ).toBe(0);
      }
    );
    it("accepts percentage without a contractual rule and deducts once with quality", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationPercent: 10, qualityRetentionPercent: 5 },
        1
      );
      let detail = await database.getInvoiceById(2198);
      expect(detail?.contractualAmortization?.saved).toMatchObject({
        treatment: "legacy_manual",
        inputMode: "percentage",
        inputValue: "10.0000",
        amount: "18538.7600",
        proposedAmount: "0.0000",
        overrideReason: null,
      });
      expect(Number(detail?.invoice.netPayable)).toBe(157579.46);
      await post();
      detail = await database.getInvoiceById(2198);
      expect(Number(detail?.appliedAdvanceAmount)).toBe(0);
      expect(detail?.contractualAmortization?.remainingAmount).toBe(129362.6);
      const rows = await treasury.listEligibleTreasuryInvoices({
        projectId: 22,
      });
      expect(rows[0].money.availableAmount).toBe(157579.46);
      expect(rows[0].money.contractualAmortizationAmount).toBe(18538.76);
      const notes = await import("./financialNotes");
      expect(
        Number(
          await notes.invoiceNoteAvailable((await database.getDb())!, 2198)
        )
      ).toBe(157579.46);
      expect(await consume()).toEqual([]);
      await expect(
        database.accountInvoice({ id: 2198, accountedById: 1 })
      ).rejects.toThrow(/estado/);
      expect(
        (
          await client.query(
            `select sum(amount)::text amount from "purchaseOrderAdvanceApplications"`
          )
        ).rows[0].amount
      ).toBe("18538.7600");
      await expect(
        database.replaceInvoiceDocumentAdjustments(
          2198,
          { advanceAmortizationAmount: 1 },
          1
        )
      ).rejects.toThrow(/borrador o rechazada/);
    });
    it.each([
      {},
      { advanceAmortizationAmount: 0 },
      { advanceAmortizationPercent: "" },
    ])(
      "allows blank/zero capture without consuming the advance: %j",
      async input => {
        await enable();
        await database.replaceInvoiceDocumentAdjustments(2198, input, 1);
        await post();
        expect(
          (
            await client.query(
              `select count(*)::int n from "purchaseOrderAdvanceApplications"`
            )
          ).rows[0].n
        ).toBe(0);
        expect(
          Number((await database.getInvoiceById(2198))?.invoice.netPayable)
        ).toBe(185387.6);
      }
    );
    it("allows review without any saved amortization", async () => {
      await enable();
      await post();
      expect(await consume()).toEqual([]);
    });
    it("reserves only the resulting cash payable in Treasury without consuming another advance", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 60000, qualityRetentionPercent: 5 },
        1
      );
      await post();
      const create = (amount: number) =>
        treasury.createTreasuryBatch({
          actor,
          projectId: 22,
          currency: "HNL",
          requestedPaymentDate: new Date(),
          items: [{ invoiceId: 2198, requestedAmount: amount }],
        });
      await expect(create(116118.23)).rejects.toThrow(/superar|saldo/);
      await create(116118.22);
      const [item] = (
        await client.query(
          `select "requestedAmount","appliedAdvanceAmount","contractualAmortizationAmount" from "treasuryPaymentItems" where "invoiceId"=2198`
        )
      ).rows;
      expect(Number(item.requestedAmount)).toBe(116118.22);
      expect(Number(item.appliedAdvanceAmount)).toBe(0);
      expect(Number(item.contractualAmortizationAmount)).toBe(60000);
      expect(
        (
          await advances.getPurchaseOrderAdvancesSummary(
            (await database.getDb())!,
            2202
          )
        ).unappliedAmount
      ).toBe(69362.6);
    });
    it("serializes duplicate accounting without applying the amortization twice", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 60000 },
        1
      );
      await database.reviewInvoice(2198, 1);
      await database.submitInvoiceForAccounting({ id: 2198, submittedById: 1 });
      const results = await Promise.allSettled([
        database.accountInvoice({ id: 2198, accountedById: 1 }),
        database.accountInvoice({ id: 2198, accountedById: 1 }),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(
        Number(
          (
            await client.query(
              `select sum(amount)::text amount from "purchaseOrderAdvanceApplications"`
            )
          ).rows[0].amount
        )
      ).toBe(60000);
      expect(await consume()).toEqual([]);
    });
    it("rejects invalid values, insufficient paid balance and changed subtotal", async () => {
      await enable();
      for (const input of [
        { advanceAmortizationAmount: -1 },
        { advanceAmortizationPercent: 101 },
        { advanceAmortizationPercent: 1.111 },
        { advanceAmortizationAmount: 129362.61 },
        { advanceAmortizationAmount: NaN },
      ])
        await expect(
          database.replaceInvoiceDocumentAdjustments(2198, input, 1)
        ).rejects.toThrow();
      await client.query(
        `update "treasuryPaymentItems" set "bankPaidAmount"=100 where id=2534`
      );
      await expect(
        database.replaceInvoiceDocumentAdjustments(
          2198,
          { advanceAmortizationAmount: 92960.22 },
          1
        )
      ).rejects.toThrow(/saldo disponible/);
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 92960.21 },
        1
      );
      await client.query(`update invoices set subtotal=90000 where id=2198`);
      await expect(database.reviewInvoice(2198, 1)).rejects.toThrow(
        /base o el saldo/
      );
    });
    it("consumes oldest paid advances FIFO and carries balance into future invoices", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 60000 },
        1
      );
      await post();
      expect(
        (
          await client.query(
            `select "purchaseOrderAdvanceId",amount from "purchaseOrderAdvanceApplications" where "invoiceId"=2198 order by "purchaseOrderAdvanceId"`
          )
        ).rows
      ).toEqual([
        { purchaseOrderAdvanceId: 114, amount: "36502.3900" },
        { purchaseOrderAdvanceId: 115, amount: "21155.0600" },
        { purchaseOrderAdvanceId: 116, amount: "2342.5500" },
      ]);
      await nextInvoice();
      expect(
        (await database.getInvoiceById(2199))?.contractualAmortization
          ?.remainingAmount
      ).toBe(69362.6);
      await database.replaceInvoiceDocumentAdjustments(
        2199,
        { advanceAmortizationAmount: 69362.6 },
        1
      );
      await post(2199);
      expect(
        await advances.getPurchaseOrderAdvancesSummary(
          (await database.getDb())!,
          2202
        )
      ).toMatchObject({
        directAppliedAmount: 0,
        contractualAmortizationAmount: 0,
        legacyManualAmortizationAmount: 129362.6,
        unappliedAmount: 0,
      });
      expect(await consume()).toEqual([]);
    });
    it("reserves at review, releases on rejection and validates stale commitments", async () => {
      await enable();
      await nextInvoice();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 100000 },
        1
      );
      await database.replaceInvoiceDocumentAdjustments(
        2199,
        { advanceAmortizationAmount: 100000 },
        1
      );
      const results = await Promise.allSettled([
        database.reviewInvoice(2198, 1),
        database.reviewInvoice(2199, 1),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const reviewed = (
        await client.query(`select id from invoices where status='revisada'`)
      ).rows[0].id;
      const other = reviewed === 2198 ? 2199 : 2198;
      await database.submitInvoiceForAccounting({
        id: reviewed,
        submittedById: 1,
      });
      await database.rejectInvoiceFromAccounting({
        id: reviewed,
        rejectedById: 1,
        rejectionComment: "Corregir amortización",
      });
      expect(
        (await database.getInvoiceById(other))?.contractualAmortization
          ?.remainingAmount
      ).toBe(129362.6);
      await database.replaceInvoiceDocumentAdjustments(
        reviewed,
        { advanceAmortizationAmount: 20000 },
        1
      );
      await database.reviewInvoice(other, 1);
      await database.reviewInvoice(reviewed, 1);
      expect(
        (await database.getInvoiceById(other))?.contractualAmortization
          ?.remainingAmount
      ).toBe(109362.6);
    });
    it("validates paid funds again at accounting and leaves no partial consumption", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 129362.6 },
        1
      );
      await database.reviewInvoice(2198, 1);
      await database.submitInvoiceForAccounting({ id: 2198, submittedById: 1 });
      await client.query(
        `update "treasuryPaymentItems" set "bankPaidAmount"="bankPaidAmount"-0.01 where id=2534`
      );
      await expect(
        database.accountInvoice({ id: 2198, accountedById: 1 })
      ).rejects.toThrow(/saldo disponible/);
      expect(
        (await client.query(`select status from invoices where id=2198`))
          .rows[0].status
      ).toBe("pendiente_contabilizar");
      expect(
        (
          await client.query(
            `select count(*)::int n from "purchaseOrderAdvanceApplications"`
          )
        ).rows[0].n
      ).toBe(0);
    });
    it("enforces linked treatment and origin at the database boundary", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 100 },
        1
      );
      await post();
      await expect(
        client.query(
          `update "purchaseOrderAdvanceApplications" set "applicationMode"='direct',"invoiceDocumentAdjustmentId"=null`
        )
      ).rejects.toThrow(/tratamiento/);
      await expect(
        client.query(
          `update "purchaseOrderAdvanceApplications" set amount=100.01`
        )
      ).rejects.toThrow(/documental/);
      await expect(
        client.query(
          `update "purchaseOrderAdvanceApplications" set "invoiceDocumentAdjustmentId"=null`
        )
      ).rejects.toThrow(/documental/);
    });
    it("pauses new capture while preserving readers and registered consumption", async () => {
      await enable();
      await database.replaceInvoiceDocumentAdjustments(
        2198,
        { advanceAmortizationAmount: 100 },
        1
      );
      process.env.LEGACY_MANUAL_ADVANCES_ENABLED = "false";
      await expect(
        database.replaceInvoiceDocumentAdjustments(
          2198,
          { advanceAmortizationAmount: 200 },
          1
        )
      ).rejects.toThrow(/deshabilitada/);
      expect(
        (await database.getInvoiceById(2198))?.contractualAmortization?.enabled
      ).toBe(false);
      await post();
      expect(
        (
          await client.query(
            `select sum(amount)::text amount from "purchaseOrderAdvanceApplications"`
          )
        ).rows[0].amount
      ).toBe("100.0000");
      delete process.env.LEGACY_MANUAL_ADVANCES_ENABLED;
    });
    it("rejects capture on direct orders and denies cross-project access", async () => {
      await expect(
        database.replaceInvoiceDocumentAdjustments(
          2198,
          { advanceAmortizationAmount: 1 },
          1
        )
      ).rejects.toThrow(/contractual/);
      await enable();
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
      await expect(caller.invoices.getById({ id: 2198 })).rejects.toThrow(
        /acceso/
      );
      const createCaller = appRouter.createCaller({
        user: { ...actor, isActive: true, mustChangePassword: false },
        req: { headers: {} },
        res: {},
      } as any);
      await expect(
        createCaller.purchaseOrderAdvances.create({
          purchaseOrderId: 2202,
          requestedAmount: 1,
          requestedPaymentDate: "2026-10-05",
          applicationMode: "legacy_manual" as any,
        })
      ).rejects.toThrow();
      for (const role of ["anon", "authenticated"]) {
        await client.query(`SET ROLE ${role}`);
        await expect(
          client.query(`select * from "invoiceContractualAmortizations"`)
        ).rejects.toThrow(/permission denied/);
        await expect(
          client.query(`select * from "advanceFinancialEvents"`)
        ).rejects.toThrow(/permission denied/);
        await client.query("RESET ROLE");
      }
    });
  }
);
