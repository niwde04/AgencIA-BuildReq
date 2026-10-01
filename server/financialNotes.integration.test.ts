import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  noteDraftSchema,
  type NoteDraftInput,
} from "../shared/financial-notes";

const testUrl = process.env.FINANCIAL_NOTES_TEST_DATABASE_URL;
const describeDb = testUrl ? describe : describe.skip;
const admin = { id: 1, role: "admin", name: "Test Admin" };
const accountant = { id: 1, role: "user", buildreqRole: "contable" };
const fiscal = {
  cai: "338827-15203E-A419E0-63BE03-0909A6-53",
  fiscalNumber: "001-001-01-00000001",
  documentRangeStart: "001-001-01-00000001",
  documentRangeEnd: "001-001-01-99999999",
  documentDate: "2026-09-22",
  documentDueDate: "2026-10-22",
  emissionDeadline: "2027-12-31",
};

describeDb(
  "financial notes: PostgreSQL transactions and integrations",
  { timeout: 30000 },
  () => {
    let client: Client;
    let database: typeof import("./db");
    let service: typeof import("./financialNotes");
    let treasury: typeof import("./treasury");
    let creditConcept: number, debitConcept: number;
    beforeAll(async () => {
      const url = new URL(testUrl!);
      const token = process.env.FINANCIAL_NOTES_TEST_TOKEN;
      if (
        !token ||
        !/^[0-9a-f]{16}$/.test(token) ||
        url.pathname !== `/buildreq_notes_test_${token}`
      )
        throw new Error(
          "Only a database created by scripts/test-financial-notes-db.ts is allowed"
        );
      process.env.DATABASE_URL = testUrl;
      client = new Client({ connectionString: testUrl });
      await client.connect();
      database = await import("./db");
      service = await import("./financialNotes");
      treasury = await import("./treasury");
    });
    afterAll(async () => {
      if (database) await ((await database.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(
        'TRUNCATE attachments, "financialNotes", "financialNoteSequences", "treasuryPaymentBatches", "purchaseOrderAdvanceApplications", "reverseLogistics", "inventoryItems", "invoiceRetentions", "invoiceItems", "receiptItems", invoices, receipts, "purchaseOrders", suppliers, projects, warehouses, users RESTART IDENTITY CASCADE'
      );
      await client.query(`INSERT INTO users (id,"openId",name) VALUES (1,'notes-test','Test Admin');
      INSERT INTO warehouses (id,code,name,"displayName") VALUES (1,'W1','Warehouse','Warehouse');
      INSERT INTO projects (id,code,name,"warehouseId") VALUES (1,'P1','Project One',1),(2,'P2','Project Two',1);
      INSERT INTO "projectWarehouseAssignments" ("projectId","warehouseId","isPrimary") VALUES (1,1,true),(2,1,true);
      INSERT INTO suppliers (id,"supplierCode",name) VALUES (1,'S1','Supplier One'),(2,'S2','Supplier Two');
      INSERT INTO "purchaseOrders" (id,"orderNumber","projectId","supplierId","createdById") VALUES (1,'OC-P1-1',1,1,1);
      INSERT INTO receipts (id,"receiptNumber","sourceType","sourceId","projectId","receivedById") SELECT i,'REC-'||i,'purchase_order',1,1,1 FROM generate_series(1,5) i;
      INSERT INTO invoices (id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",total,"netPayable") SELECT i,'FT-P1-'||i,i,1,1,1,'registrada',now(),now(),now()+interval '1 year',1000,1000 FROM generate_series(1,5) i;
      UPDATE "financialNoteSettings" SET enabled=true,"activatedAt"=now()-interval '1 minute';
      UPDATE "financialNoteConcepts" SET "isActive"=true;
      INSERT INTO "salesTaxes" ("taxCode",description,"shortLabel","ratePercent") VALUES ('ISV15','ISV 15%','15%',15) ON CONFLICT ("taxCode") DO UPDATE SET "ratePercent"=15,"isActive"=true;
      INSERT INTO "taxRetentions" (id,"taxCode",description,"ratePercent") VALUES (101,'RT01','RETENCIÓN UNO',1),(102,'RTEXTRA','RETENCIÓN ESPECIAL',5) ON CONFLICT (id) DO NOTHING;`);
      const db = (await database.getDb())!;
      await db.transaction(async tx => {
        await service.syncRetentionConcept(tx, 101);
        await service.syncRetentionConcept(tx, 102);
      });
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
    function draft(
      type: "credit" | "debit" = "credit",
      amount = "100",
      invoiceId = 1
    ): NoteDraftInput {
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
    async function create(input = draft()) {
      return service.createFinancialNote(
        { ...input, requestKey: randomUUID() },
        admin
      );
    }
    async function prepare(id: number, input: NoteDraftInput) {
      await service.updateFinancialNote(
        id,
        {
          ...input,
          ...fiscal,
          fiscalNumber: `001-001-01-${String(id).padStart(8, "0")}`,
        },
        admin
      );
      await service.createFinancialNoteAttachment(
        {
          entityId: id,
          fileName: "note.pdf",
          fileKey: `test/${id}`,
          fileUrl: "/test.pdf",
          mimeType: "application/pdf",
          fileSize: 20,
          uploadedById: 1,
        },
        admin
      );
      await service.transitionFinancialNote(id, "review", undefined, admin);
    }
    async function post(input = draft()) {
      const n = await create(input);
      await prepare(n.id, input);
      await service.transitionFinancialNote(
        n.id,
        "account",
        undefined,
        accountant
      );
      return n;
    }
    async function balance(invoiceId = 1) {
      return service.invoiceNoteAvailable((await database.getDb())!, invoiceId);
    }
    async function reserve(amount: number) {
      return treasury.createTreasuryBatch({
        actor: admin,
        projectId: 1,
        currency: "HNL",
        requestedPaymentDate: new Date("2026-09-22T12:00:00Z"),
        items: [{ invoiceId: 1, requestedAmount: amount }],
      });
    }

    async function retentionGroups() {
      await client.query(
        `INSERT INTO "financialGroups" ("financialGroupCode","financialGroupDescription","codN2","nivel2","isActive") VALUES ('TEST-RET-01','Retención financiera uno','TEST','Pruebas',true),('TEST-RET-02','Retención financiera dos','TEST','Pruebas',true) ON CONFLICT ("financialGroupCode") DO UPDATE SET "isActive"=true`
      );
    }
    it("assigns financial groups through retentions and searches the shared concept by code and description", async () => {
      await retentionGroups();
      const retention = await database.createTaxRetention({
        taxCode: "TEST-" + randomUUID().slice(0, 8),
        description: "Prueba de grupo",
        ratePercent: "1",
        isActive: true,
        financialGroupCode: "TEST-RET-01",
      });
      for (const search of ["TEST-RET-01", "Retención financiera uno"]) {
        const listed = await database.listTaxRetentions({ search });
        expect(listed.items.find(r => r.id === retention.id)).toMatchObject({
          financialGroupCode: "TEST-RET-01",
          financialGroupDescription: "Retención financiera uno",
        });
      }
      await database.updateTaxRetention(retention.id, {
        financialGroupCode: "TEST-RET-02",
      });
      await database.updateTaxRetention(retention.id, {
        description: "Cliente antiguo sin campo",
      });
      await (await database.getDb())!.transaction(tx =>
        service.syncRetentionConcept(tx, retention.id)
      );
      expect(
        (await database.listTaxRetentions({ search: retention.taxCode }))
          .items[0].financialGroupCode
      ).toBe("TEST-RET-02");
      await database.updateTaxRetention(retention.id, {
        financialGroupCode: null,
      });
      expect(
        (await database.listTaxRetentions({ search: retention.taxCode }))
          .items[0].financialGroupCode
      ).toBeNull();
    });
    it("rejects invalid or newly selected inactive groups atomically and preserves an existing inactive assignment", async () => {
      await retentionGroups();
      const retention = await database.createTaxRetention({
        taxCode: "TEST-" + randomUUID().slice(0, 8),
        description: "Descripción original",
        ratePercent: "1",
        isActive: true,
        financialGroupCode: "TEST-RET-01",
      });
      await client.query(
        `UPDATE "financialGroups" SET "isActive"=false WHERE "financialGroupCode" IN ('TEST-RET-01','TEST-RET-02')`
      );
      await expect(
        database.updateTaxRetention(retention.id, {
          description: "No guardar",
          financialGroupCode: "TEST-RET-02",
        })
      ).rejects.toThrow(/grupo financiero activo/);
      await expect(
        database.updateTaxRetention(retention.id, {
          description: "No guardar",
          financialGroupCode: "NOT-A-GROUP",
        })
      ).rejects.toThrow(/grupo financiero activo/);
      expect(
        (await database.listTaxRetentions({ search: retention.taxCode }))
          .items[0]
      ).toMatchObject({
        description: "Descripción original",
        financialGroupCode: "TEST-RET-01",
      });
      await expect(
        database.updateTaxRetention(retention.id, {
          description: "Grupo previo conservado",
          financialGroupCode: "TEST-RET-01",
        })
      ).resolves.toHaveProperty("id", retention.id);
      const code = "TEST-" + randomUUID().slice(0, 8);
      await expect(
        database.createTaxRetention({
          taxCode: code,
          description: "No crear",
          ratePercent: "1",
          isActive: true,
          financialGroupCode: "NOT-A-GROUP",
        })
      ).rejects.toThrow(/grupo financiero activo/);
      expect((await database.listTaxRetentions({ search: code })).total).toBe(
        0
      );
    });
    it("seeds 30 credit, 6 debit and every retention idempotently; denies browser access", async () => {
      const before = (
        await client.query('select "activatedAt" from "financialNoteSettings"')
      ).rows[0].activatedAt;
      await client.query(
        readFileSync(
          new URL("../drizzle/0142_financial_notes.sql", import.meta.url),
          "utf8"
        )
      );
      expect(
        (
          await client.query(
            `select count(*)::int total from "financialNoteConcepts" where code ~ '^NC-C[0-9]{2}$'`
          )
        ).rows[0].total
      ).toBe(30);
      expect(
        (
          await client.query(
            `select count(*)::int total from "financialNoteConcepts" where type='debit'`
          )
        ).rows[0].total
      ).toBe(6);
      expect(
        (
          await client.query(
            `select description,"retentionCatalogId" from "financialNoteConcepts" where code='NC-RTEXTRA'`
          )
        ).rows[0]
      ).toEqual({ description: "RETENCIÓN ESPECIAL", retentionCatalogId: 102 });
      expect(
        (
          await client.query(
            'select "activatedAt" from "financialNoteSettings"'
          )
        ).rows[0].activatedAt
      ).toEqual(before);
      const access = (
        await client.query(
          `select relname,relrowsecurity,has_table_privilege('anon',oid,'SELECT') anon,has_table_privilege('authenticated',oid,'INSERT') browser from pg_class where relname in ('financialNotes','financialNoteConcepts','financialNoteLines','financialNoteInvoices','financialNoteEvents','financialNoteSequences','financialNoteSettings')`
        )
      ).rows;
      expect(access).toHaveLength(7);
      expect(access.every(r => r.relrowsecurity && !r.anon && !r.browser)).toBe(
        true
      );
    });
    it("applies a credit across invoices and reverses it without changing original tax/base", async () => {
      const input = draft();
      input.lines[0].baseAmount = "300";
      input.allocations = [
        { invoiceId: 1, amount: "100" },
        { invoiceId: 2, amount: "200" },
      ];
      const n = await post(input);
      expect(await balance(1)).toBe("900.0000");
      expect(await balance(2)).toBe("800.0000");
      await service.transitionFinancialNote(
        n.id,
        "void",
        "Corrección autorizada",
        accountant
      );
      expect(await balance()).toBe("1000.0000");
      expect(
        (
          await client.query(
            'select total,"taxAmount" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual({ total: "1000.0000", taxAmount: "0.0000" });
    });
    it("rejects mixed supplier/project/currency and restricts a debit to one invoice", async () => {
      for (const changes of [
        `"supplierId"=2`,
        `"projectId"=2`,
        `currency='USD',"exchangeRate"=25,"exchangeRateDate"=current_date`,
      ]) {
        await client.query(`update invoices set ${changes} where id=2`);
        const input = draft();
        input.allocations = [
          { invoiceId: 1, amount: "50" },
          { invoiceId: 2, amount: "50" },
        ];
        await expect(create(input)).rejects.toThrow(/mismo proveedor/);
        await client.query(
          `update invoices set "supplierId"=1,"projectId"=1,currency='HNL',"exchangeRate"=null,"exchangeRateDate"=null where id=2`
        );
      }
      const nd = draft("debit");
      nd.allocations = [
        { invoiceId: 1, amount: "50" },
        { invoiceId: 2, amount: "50" },
      ];
      await expect(create(nd)).rejects.toThrow(/exactamente una/);
    });
    it("keeps catalog snapshots during fiscal-only edits and supports tax-only corrections", async () => {
      const input = draft();
      input.lines[0].taxCode = "ISV15";
      input.lines[0].taxAmount = "15";
      input.allocations[0].amount = "115";
      const n = await create(input);
      const before = await service.getFinancialNote(n.id, admin);
      await client.query(
        `update "financialNoteConcepts" set description='Catálogo modificado',"isActive"=false where id=$1`,
        [creditConcept]
      );
      await client.query(
        `update "salesTaxes" set "ratePercent"=18 where "taxCode"='ISV15'`
      );
      await service.updateFinancialNote(n.id, { ...input, ...fiscal }, admin);
      const after = await service.getFinancialNote(n.id, admin);
      expect(after.lines[0].description).toBe(before.lines[0].description);
      expect(after.lines[0].taxSnapshot).toEqual(before.lines[0].taxSnapshot);
      expect(after.note.documentDate).toBe("2026-09-22");
      expect(after.allocations[0].available).toBe("1000.0000");
      const taxOnly = draft();
      taxOnly.lines = [
        {
          conceptId: (
            await client.query(
              `select id from "financialNoteConcepts" where code='NC-C11'`
            )
          ).rows[0].id,
          baseAmount: "0",
          taxAmount: "100",
        },
      ];
      await expect(create(taxOnly)).resolves.toHaveProperty("id");
    });
    it("allows optional groups, deletes unused concepts and deactivates used ones", async () => {
      const input = {
        type: "credit" as const,
        code: "CUSTOM",
        description: "Custom",
        applicability: "Test",
        isActive: true,
        allowsTaxOnly: false,
      };
      const concept = await service.saveNoteConcept(input);
      expect(concept.financialGroupCode).toBeNull();
      await expect(service.removeNoteConcept(concept.id)).resolves.toEqual({
        deactivated: false,
      });
      await create();
      await expect(service.removeNoteConcept(creditConcept)).resolves.toEqual({
        deactivated: true,
      });
    });
    it("rejects retention concepts for new manual notes", async () => {
      const concept = (await client.query('select id from "financialNoteConcepts" where "retentionCatalogId"=101')).rows[0];
      const input = draft();
      input.lines[0].conceptId = concept.id;
      await expect(create(input)).rejects.toThrow(/desde Facturas/);
    });
    it("keeps sequences after deletion and project rename and starts after historic return references", async () => {
      await client.query(
        `insert into "reverseLogistics" ("returnNumber","returnType","reasonCategory",justification,"sourceProjectId","createdById",status,"sapDocumentNumber") values ('DEV-HIST','devolucion_proveedor','otro','Historic',1,1,'aprobada','NC-P1-00000042')`
      );
      const n = await create();
      expect(n.documentNumber).toBe("NC-P1-00000043");
      await service.transitionFinancialNote(n.id, "remove", undefined, admin);
      await client.query(`update projects set code='RENAMED' where id=1`);
      expect((await create()).documentNumber).toBe("NC-RENAMED-00000044");
      expect((await create(draft("debit"))).documentNumber).toBe(
        "ND-RENAMED-00000001"
      );
    });
    it("serializes duplicate requests and simultaneous credit postings", async () => {
      const input = { ...draft("credit", "700"), requestKey: randomUUID() };
      const repeated = await Promise.all([
        service.createFinancialNote(input, admin),
        service.createFinancialNote(input, admin),
      ]);
      expect(repeated[0].id).toBe(repeated[1].id);
      const second = await create(draft("credit", "700"));
      await prepare(repeated[0].id, input);
      await prepare(second.id, input);
      const results = await Promise.allSettled([
        service.transitionFinancialNote(
          repeated[0].id,
          "account",
          undefined,
          accountant
        ),
        service.transitionFinancialNote(
          second.id,
          "account",
          undefined,
          accountant
        ),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(await balance()).toBe("300.0000");
    });
    it("serializes a treasury reservation against credit posting", async () => {
      const input = draft("credit", "700");
      const n = await create(input);
      await prepare(n.id, input);
      const results = await Promise.allSettled([
        reserve(700),
        service.transitionFinancialNote(n.id, "account", undefined, accountant),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(await balance()).toBe("300.0000");
    });
    it("a debit reopens a paid invoice and cannot be annulled after the new balance is reserved", async () => {
      const b = await reserve(1000);
      await client.query(
        `update "treasuryPaymentItems" set status='contabilizada',"bankPaidAmount"=1000,"activeReservation"=false where "batchId"=$1`,
        [b.id]
      );
      expect(await balance()).toBe("0.0000");
      const nd = await post(draft("debit", "100"));
      expect(await balance()).toBe("100.0000");
      await reserve(100);
      await expect(
        service.transitionFinancialNote(
          nd.id,
          "void",
          "Intento de anulación",
          accountant
        )
      ).rejects.toThrow(/pagos, anticipos o reservas/);
      expect((await service.getFinancialNote(nd.id, admin)).note.status).toBe(
        "registrada"
      );
    });
    it("requires fiscal data/attachment and enforces roles/project access for detail and selectors", async () => {
      const n = await create();
      await expect(
        service.transitionFinancialNote(n.id, "review", undefined, admin)
      ).rejects.toThrow(/Complete/);
      await service.updateFinancialNote(n.id, { ...draft(), ...fiscal }, admin);
      await expect(
        service.transitionFinancialNote(n.id, "review", undefined, admin)
      ).rejects.toThrow(/Adjunte/);
      const outsider = {
        id: 1,
        role: "user",
        buildreqRole: "administrador_proyecto",
        assignedProjectId: 2,
      };
      await expect(service.getFinancialNote(n.id, outsider)).rejects.toThrow(
        /permisos/
      );
      expect(
        (await service.eligibleNoteInvoices({ type: "credit" }, outsider)).items
      ).toHaveLength(0);
      await expect(
        service.createFinancialNote(
          { ...draft(), requestKey: randomUUID() },
          accountant
        )
      ).rejects.toThrow(/permisos/);
    });
    it("subtracts partial payments, reserves and applied advances exactly once", async () => {
      const paid = await reserve(200);
      await client.query(
        `update "treasuryPaymentItems" set status='contabilizada',"bankPaidAmount"=200,"activeReservation"=false where "batchId"=$1`,
        [paid.id]
      );
      await reserve(200);
      await client.query(
        `insert into "purchaseOrderAdvances" (id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") values (1,'ANT-1',1,1,1,'HNL',300,current_date,1); insert into "purchaseOrderAdvanceApplications" ("purchaseOrderAdvanceId","invoiceId",amount,"appliedById") values (1,1,300,1)`
      );
      expect(await balance()).toBe("300.0000");
      await expect(create(draft("credit", "300.0001"))).rejects.toThrow(
        /saldo disponible/
      );
      await post(draft("credit", "300"));
      expect(await balance()).toBe("0.0000");
    });
    async function setupRetentions() {
      await client.query(`insert into "invoiceRetentions" ("invoiceId","retentionCatalogId","retentionType",description,"baseAmount",percentage,amount) values (1,101,'percentage','Retención fiscal',1000,10,100),(1,101,'percentage','Retención fiscal',1000,15,150);
        update suppliers set rtn='08011999000001' where id=1;
        update invoices set "retentionTotal"=250,"otherRetentionTotal"=30,"documentDiscountTotal"=20,"netPayable"=700,
        "retentionReceiptNumber"='001-001-01-00000001',"retentionCai"='338827-15203E-A419E0-63BE03-0909A6-53',
        "retentionDocumentRangeStart"='001-001-01-00000001',"retentionDocumentRangeEnd"='001-001-01-99999999',
        "retentionDocumentDate"='2026-09-22',"retentionEmissionDeadline"='2027-12-31' where id=1`);
    }
    it("generates the retention document within posting and rejects double posting and returning to review", async () => {
      await setupRetentions();
      await client.query("update invoices set status='revisada' where id=1");
      await database.submitInvoiceForAccounting({ id:1, submittedById:1 });
      await database.accountInvoice({ id:1, accountedById:1 });
      await expect(database.accountInvoice({ id:1, accountedById:1 })).rejects.toThrow(/cambió de estado/);
      expect((await service.listFinancialNotes({type:"credit",invoiceId:1},admin)).items).toHaveLength(0);
      expect((await client.query('select status,total from "retentionDocuments" where "invoiceId"=1')).rows).toEqual([{status:"registrada",total:"250.0000"}]);
      await expect(database.returnAccountedInvoiceToReview(1,1)).rejects.toThrow(/cerrada/);
    });
    it("queues without notes or advances, then posts and applies the paid advance once", async () => {
      await setupRetentions();
      await client.query(`update invoices set status='borrador'; update invoices set status='revisada' where id=1;
            insert into "purchaseOrderAdvances" (id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") values (1,'ANT-QUEUE',1,1,1,'HNL',300,current_date,1);
            insert into "treasuryPaymentBatches" (id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind") values (1,'TES-QUEUE',1,'HNL',current_date,1,'purchase_order_advance');
            insert into "treasuryPaymentItems" ("batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation","accountedAt") values (1,'purchase_order_advance',1,1,'S1','Supplier One','ANT-QUEUE','HNL',300,300,300,'contabilizada',false,now());`);
      const before = (
        await client.query(
          'select total, "taxAmount", "retentionTotal", "netPayable" from invoices where id=1'
        )
      ).rows[0];
      const sent = await database.submitInvoiceForAccounting({
        id: 1,
        submittedById: 1,
        accountingComment: "Listo",
      });
      expect(sent.status).toBe("pendiente_contabilizar");
      expect(sent.submittedForAccountingAt).toBeInstanceOf(Date);
      expect(sent.accountedAt).toBeNull();
      expect(
        (await client.query('select count(*)::int n from "retentionDocuments"'))
          .rows[0].n
      ).toBe(0);
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderAdvanceApplications"'
          )
        ).rows[0].n
      ).toBe(0);
      expect(
        (
          await client.query(
            'select total, "taxAmount", "retentionTotal", "netPayable" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual(before);
      await expect(
        database.submitInvoiceForAccounting({ id: 1, submittedById: 1 })
      ).rejects.toThrow(/cambió de estado/);
      await database.accountInvoice({ id: 1, accountedById: 1 });
      expect(
        (
          await client.query(
            'select amount from "purchaseOrderAdvanceApplications" where "invoiceId"=1'
          )
        ).rows
      ).toEqual([{ amount: "300.0000" }]);
      expect(
        (await client.query('select count(*)::int n from "retentionDocuments"'))
          .rows[0].n
      ).toBe(1);
      const { listInvoiceAccountingQueue } = await import(
        "./invoiceAccounting"
      );
      const queue = await listInvoiceAccountingQueue({ status: "registrada" });
      expect(queue.items).toHaveLength(1);
      expect(queue.items[0]).toMatchObject({
        net: 700,
        appliedAdvance: 300,
        balance: 400,
      });
      await expect(
        database.accountInvoice({ id: 1, accountedById: 1 })
      ).rejects.toThrow(/cambió de estado/);
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderAdvanceApplications"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("serializes competing accounting and rejection decisions", async () => {
      await setupRetentions();
      await client.query(`update invoices set status='revisada' where id=1`);
      await database.submitInvoiceForAccounting({ id: 1, submittedById: 1 });
      const results = await Promise.allSettled([
        database.accountInvoice({ id: 1, accountedById: 1 }),
        database.rejectInvoiceFromAccounting({
          id: 1,
          rejectedById: 1,
          rejectionComment: "Corregir soporte",
        }),
      ]);
      expect(
        results.filter(result => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter(result => result.status === "rejected")
      ).toHaveLength(1);
      const invoice = (
        await client.query(
          'select status, "accountedAt", "rejectionComment" from invoices where id=1'
        )
      ).rows[0];
      const noteCount = (
        await client.query('select count(*)::int n from "retentionDocuments"')
      ).rows[0].n;
      if (invoice.status === "registrada") {
        expect(invoice.accountedAt).toBeInstanceOf(Date);
        expect(noteCount).toBe(1);
      } else {
        expect(invoice.status).toBe("rechazada");
        expect(invoice.accountedAt).toBeNull();
        expect(invoice.rejectionComment).toBe("Corregir soporte");
        expect(noteCount).toBe(0);
      }
    });
    it("rejects in the invoice validation without financial movements, then follows both validations again", async () => {
      await setupRetentions();
      await client.query("update invoices set status='revisada' where id=1");
      const rejected = await database.rejectInvoiceFromAccounting({
        id: 1,
        rejectedById: 1,
        rejectionComment: "Corregir primera revisión",
        expectedStatus: "revisada",
      });
      expect(rejected.status).toBe("rechazada");
      expect(rejected.submittedForAccountingAt).toBeNull();
      expect(rejected.accountedAt).toBeNull();
      expect(rejected.rejectedById).toBe(1);
      expect(rejected.rejectionComment).toBe("Corregir primera revisión");
      const { listInvoiceAccountingQueue } = await import(
        "./invoiceAccounting"
      );
      expect(
        (await listInvoiceAccountingQueue({ status: "rechazada" })).items
      ).toHaveLength(0);
      expect(
        (await client.query('select count(*)::int n from "retentionDocuments"'))
          .rows[0].n
      ).toBe(0);
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderAdvanceApplications"'
          )
        ).rows[0].n
      ).toBe(0);
      const reviewed = await database.reviewInvoice(1, 1);
      expect(reviewed.status).toBe("revisada");
      expect(reviewed.rejectionComment).toBeNull();
      await expect(
        database.accountInvoice({ id: 1, accountedById: 1 })
      ).rejects.toThrow(/cambió de estado/);
      await database.submitInvoiceForAccounting({ id: 1, submittedById: 1 });
      await database.accountInvoice({ id: 1, accountedById: 1 });
      expect(
        (await client.query('select count(*)::int n from "retentionDocuments"'))
          .rows[0].n
      ).toBe(1);
    });
    it("does not let a stale rejection cross validation stages", async () => {
      await client.query("update invoices set status='revisada' where id=1");
      await database.submitInvoiceForAccounting({ id: 1, submittedById: 1 });
      await expect(
        database.rejectInvoiceFromAccounting({
          id: 1,
          rejectedById: 1,
          rejectionComment: "Primera revisión desactualizada",
          expectedStatus: "revisada",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await database.rejectInvoiceFromAccounting({
        id: 1,
        rejectedById: 1,
        rejectionComment: "Corregir desde Tesorería",
      });
      await database.reviewInvoice(1, 1);
      await expect(
        database.rejectInvoiceFromAccounting({
          id: 1,
          rejectedById: 1,
          rejectionComment: "Tesorería desactualizada",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await client.query("select status from invoices where id=1")).rows[0]
          .status
      ).toBe("revisada");
    });
    it("allows only one decision when the first approval and rejection compete", async () => {
      await client.query("update invoices set status='revisada' where id=1");
      const results = await Promise.allSettled([
        database.submitInvoiceForAccounting({ id: 1, submittedById: 1 }),
        database.rejectInvoiceFromAccounting({
          id: 1,
          rejectedById: 1,
          rejectionComment: "Corregir primera revisión",
          expectedStatus: "revisada",
        }),
      ]);
      expect(
        results.filter(result => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter(result => result.status === "rejected")
      ).toHaveLength(1);
      const invoice = (
        await client.query(
          'select status, "accountedAt" from invoices where id=1'
        )
      ).rows[0];
      expect(["pendiente_contabilizar", "rechazada"]).toContain(invoice.status);
      expect(invoice.accountedAt).toBeNull();
      expect(
        (await client.query('select count(*)::int n from "retentionDocuments"'))
          .rows[0].n
      ).toBe(0);
    });
    it("rejects with a reason, permits correction and requires resubmission", async () => {
      await client.query(`update invoices set status='revisada' where id=1`);
      await database.submitInvoiceForAccounting({ id: 1, submittedById: 1 });
      await expect(database.reviewInvoice(1, 1)).rejects.toThrow(
        /cambió de estado/
      );
      const rejected = await database.rejectInvoiceFromAccounting({
        id: 1,
        rejectedById: 1,
        rejectionComment: "Corregir factura",
      });
      expect(rejected.submittedForAccountingAt).toBeInstanceOf(Date);
      const reviewed = await database.reviewInvoice(1, 1);
      expect(reviewed.status).toBe("revisada");
      expect(reviewed.submittedForAccountingAt).toBeNull();
      await expect(
        database.accountInvoice({ id: 1, accountedById: 1 })
      ).rejects.toThrow(/cambió de estado/);
      await database.submitInvoiceForAccounting({ id: 1, submittedById: 1 });
      await database.accountInvoice({ id: 1, accountedById: 1 });
    });
    it("paginates only submitted documents and combines currency, project, dates and invoice search", async () => {
      await client.query(
        `update invoices set status='revisada', "documentDate"='2026-09-20', "invoiceNumber"='001-001-01-00000001' where id in (1,2,3); update invoices set currency='USD', "exchangeRate"=26, "exchangeRateDate"='2026-09-20', "projectId"=2 where id=2;`
      );
      for (const id of [1, 2, 3])
        await database.submitInvoiceForAccounting({ id, submittedById: 1 });
      await database.rejectInvoiceFromAccounting({
        id: 3,
        rejectedById: 1,
        rejectionComment: "Revisar factura",
      });
      const { listInvoiceAccountingQueue } = await import(
        "./invoiceAccounting"
      );
      const page = await listInvoiceAccountingQueue({
        status: "pendiente_contabilizar",
        currency: "USD",
        projectIds: [2],
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        search: "OC-P1",
        page: 99,
        pageSize: 10,
      });
      expect(page).toMatchObject({ total: 1, page: 1, totalPages: 1 });
      expect(page.items.map(item => item.id)).toEqual([2]);
      expect(
        (
          await listInvoiceAccountingQueue({
            status: "pendiente_contabilizar",
            projectIds: [1],
            currency: "USD",
          })
        ).total
      ).toBe(0);
      expect(
        (await listInvoiceAccountingQueue({ status: "rechazada" })).items.map(
          item => item.id
        )
      ).toEqual([3]);
      expect((await listInvoiceAccountingQueue({})).total).toBe(3);
      expect(
        (await listInvoiceAccountingQueue({ dateFrom: "2027-01-01" })).total
      ).toBe(0);
    });

    it("retires automatic retention credit note creation", async () => {
      await expect((await database.getDb())!.transaction(tx => service.syncInvoiceRetentionNote(tx, 1, 1, { create: true })))
        .rejects.toThrow(/retirada/);
      expect((await client.query('select count(*)::int n from "financialNotes"')).rows[0].n).toBe(0);
    });

    async function setupReturn(mapped = true, stock = 10) {
      await client.query(`insert into "receiptItems" (id,"receiptId","itemName","sapItemCode","quantityExpected","quantityReceived","warehouseId") values (1,1,'Material','ITEM1',10,10,1);
      insert into "invoiceItems" ("invoiceId","receiptItemId","itemName","currentSapItemCode",quantity,subtotal,"taxAmount",total,"taxCode") values (1,1,'Material','ITEM1',10,1000,150,1150,'ISV15');
      insert into "reverseLogistics" (id,"returnNumber","returnType","reasonCategory",justification,"sourceProjectId","sourceReceiptId","createdById") values (1,'DEV-P1-00000001','devolucion_proveedor','excedente','Excedente documentado',1,1,1);`);
      await client.query(
        `insert into "reverseLogisticsItems" ("reverseLogisticId","sourceReceiptItemId","itemName",quantity) values (1,$1,'Material',2)`,
        [mapped ? 1 : null]
      );
      await client.query(
        `insert into "inventoryItems" ("sapItemCode",name,"currentStock","projectId","warehouseId") values ('ITEM1','Material',$1,1,1)`,
        [stock]
      );
    }
    it("creates one proportional return draft and one stock movement despite retries; void does not restore stock", async () => {
      await setupReturn();
      await client.query(`update invoices set status='borrador' where id=1`);
      const [a, b] = await Promise.all([
        database.generateSupplierReturnCreditNote(1, 1),
        database.generateSupplierReturnCreditNote(1, 1),
      ]);
      expect(a.noteId).toBe(b.noteId);
      const note = await service.getFinancialNote(a.noteId!, admin);
      expect(note.note).toMatchObject({
        origin: "supplier_return",
        total: "230.0000",
        status: "borrador",
      });
      expect(note.lines[0]).toMatchObject({
        baseAmount: "200.0000",
        taxAmount: "30.0000",
      });
      expect(
        (await client.query('select "currentStock" from "inventoryItems"'))
          .rows[0].currentStock
      ).toBe("8.00");
      await expect(
        service.transitionFinancialNote(
          note.note.id,
          "review",
          undefined,
          admin
        )
      ).rejects.toThrow(/contabilizadas/);
      await service.transitionFinancialNote(
        note.note.id,
        "void",
        "Anulación financiera",
        accountant
      );
      expect(
        (await client.query('select "currentStock" from "inventoryItems"'))
          .rows[0].currentStock
      ).toBe("8.00");
    });
    it("requires explicit legacy mapping and rolls back both note and stock when stock is insufficient", async () => {
      await setupReturn(false, 1);
      await expect(
        database.generateSupplierReturnCreditNote(1, 1)
      ).rejects.toThrow(/renglón/);
      const item = (
        await client.query('select id from "reverseLogisticsItems"')
      ).rows[0];
      await service.mapSupplierReturnReceiptItems(
        1,
        [{ itemId: item.id, sourceReceiptItemId: 1 }],
        admin
      );
      await expect(
        database.generateSupplierReturnCreditNote(1, 1)
      ).rejects.toThrow();
      expect(
        (await client.query('select count(*)::int count from "financialNotes"'))
          .rows[0].count
      ).toBe(0);
      expect(
        (await client.query('select status from "reverseLogistics"')).rows[0]
          .status
      ).toBe("pendiente");
      expect(
        (await client.query('select "currentStock" from "inventoryItems"'))
          .rows[0].currentStock
      ).toBe("1.00");
    });

    it("blocks reopening or restoring reservations consumed by a posted credit", async () => {
      const batch = await reserve(600);
      await client.query(
        `update "treasuryPaymentItems" set status='rechazada_banco',"activeReservation"=false where "batchId"=$1;`,
        [batch.id]
      );
      await client.query(
        `update "treasuryPaymentBatches" set status='cerrado' where id=$1`,
        [batch.id]
      );
      await post(draft("credit", "700"));
      await expect(
        treasury.reopenClosedTreasuryBatch({
          batchId: batch.id,
          actor: admin,
          reason: "Reintentar pago",
        })
      ).rejects.toThrow(/saldo vigente/);
      expect(await balance()).toBe("300.0000");
      await client.query(
        `update "treasuryPaymentItems" set status='aprobada',"activeReservation"=true,"approvedAmount"=100 where "batchId"=$1`,
        [batch.id]
      );
      await client.query(
        `update "treasuryPaymentBatches" set status='aprobado' where id=$1`,
        [batch.id]
      );
      await expect(
        treasury.returnTreasuryBatchToDraft({
          batchId: batch.id,
          actor: admin,
          reason: "Corregir borrador",
        })
      ).rejects.toThrow(/saldo vigente/);
      expect(await balance()).toBe("200.0000");
    });
    it.each(["HNL", "USD"] as const)(
      "settles the displayed cent balance in %s without changing the four-decimal invoice",
      async currency => {
        await client.query(
          `update invoices set total=216733.1055, "netPayable"=216733.1055, currency=$1, "exchangeRate"=$2, "exchangeRateDate"=$3 where id=1`,
          [
            currency,
            currency === "USD" ? 26 : null,
            currency === "USD" ? "2026-09-29" : null,
          ]
        );
        const eligible = await treasury.listEligibleTreasuryInvoices({
          projectId: 1,
          currency,
        });
        const invoice = eligible.find(row => row.invoice.id === 1)!;
        expect(invoice.money.availableAmount).toBe(216733.11);
        const request = {
          actor: admin,
          projectId: 1,
          currency,
          requestedPaymentDate: new Date("2026-09-29T12:00:00Z"),
          items: [
            { invoiceId: 1, requestedAmount: invoice.money.availableAmount },
          ],
        };
        const batch = await treasury.createTreasuryBatch(request);
        await treasury.updateTreasuryDraft({ ...request, batchId: batch.id });
        expect(await balance()).toBe("0.0000");
        await expect(
          treasury.createTreasuryBatch({
            ...request,
            items: [{ invoiceId: 1, requestedAmount: 0.01 }],
          })
        ).rejects.toThrow(/no superar 0.00/);
        // Simulate the bank's paid result, then run the real accounting transaction.
        await client.query(
          `update "treasuryPaymentBatches" set status='pendiente_contabilizacion' where id=$1`,
          [batch.id]
        );
        const itemIds = (
          await client.query(
            `update "treasuryPaymentItems" set status='pagada', "bankPaidAmount"="requestedAmount", "bankPaidDate"=current_date where "batchId"=$1 returning id`,
            [batch.id]
          )
        ).rows.map(row => row.id);
        await treasury.accountTreasuryItems({
          actor: admin,
          batchId: batch.id,
          itemIds,
        });
        expect(await balance()).toBe("0.0000");
        expect(
          (await client.query('select "netPayable" from invoices where id=1'))
            .rows[0].netPayable
        ).toBe("216733.1055");
        expect(
          (
            await treasury.listEligibleTreasuryInvoices({
              projectId: 1,
              currency,
            })
          ).some(row => row.invoice.id === 1)
        ).toBe(false);
        const overCredit = draft("credit", "0.0001");
        await expect(create(overCredit)).rejects.toThrow(/saldo disponible/);
      }
    );
    it("keeps genuine excesses blocked by one cent and rolls back the entire batch", async () => {
      await client.query(
        'update invoices set total=216733.1055, "netPayable"=216733.1055 where id=1'
      );
      await expect(reserve(216733.12)).rejects.toThrow(/no superar 216733.11/);
      expect(
        (
          await client.query(
            'select count(*)::int n from "treasuryPaymentBatches"'
          )
        ).rows[0].n
      ).toBe(0);
      expect(
        (
          await client.query(
            'select count(*)::int n from "treasuryPaymentItems"'
          )
        ).rows[0].n
      ).toBe(0);
      const firstPayment = await reserve(100000);
      await client.query(
        `update "treasuryPaymentItems" set status='contabilizada', "bankPaidAmount"=100000, "activeReservation"=false where "batchId"=$1`,
        [firstPayment.id]
      );
      await reserve(116733.11);
      expect(await balance()).toBe("0.0000");
      await expect(reserve(0.01)).rejects.toThrow(/no superar 0.00/);
    });
    it("settles a fractional remainder in cents while preserving the exact credit amount", async () => {
      const note = await post(draft("credit", "999.9950"));
      expect(await balance()).toBe("0.0050");
      await reserve(0.01);
      expect(await balance()).toBe("0.0000");
      const detail = await service.getFinancialNote(note.id, admin);
      expect(detail.note.total).toBe("999.9950");
      expect(detail.allocations[0].available).toBe("0.0000");
      const candidates = await service.eligibleNoteInvoices(
        { type: "credit", projectId: 1 },
        admin
      );
      expect(candidates.items.find(row => row.id === 1)?.available).toBe(
        "0.0000"
      );
      await expect(reserve(0.01)).rejects.toThrow(/no superar 0.00/);
    });
    it("does not round the maximum credit above the original invoice amount", async () => {
      await client.query(
        'update invoices set total=100.0055, "netPayable"=100.0055 where id=1'
      );
      expect(await balance()).toBe("100.0055");
      await expect(create(draft("credit", "100.0100"))).rejects.toThrow(
        /saldo disponible/
      );
      await post(draft("credit", "100.0055"));
      expect(await balance()).toBe("0.0000");
    });
    it("applies advances to the same cent-rounded payable and does not create a false note deficit", async () => {
      await client.query(`update invoices set status='borrador' where id<>1;
      update invoices set total=216733.1055, "netPayable"=216733.1055 where id=1;
      insert into "purchaseOrderAdvances" (id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") values (1,'ANT-ROUND',1,1,1,'HNL',216733.11,current_date,1);
      insert into "treasuryPaymentBatches" (id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind") values (1,'TES-ROUND',1,'HNL',current_date,1,'purchase_order_advance');
      insert into "treasuryPaymentItems" ("batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation") values (1,'purchase_order_advance',1,1,'S1','Supplier','ANT-ROUND','HNL',216733.11,216733.11,216733.11,'contabilizada',false)`);
      const advances = await import("./purchaseOrderAdvances");
      await (await database.getDb())!.transaction(tx =>
        advances.applyAvailableAdvancesForPurchaseOrder({
          executor: tx,
          purchaseOrderId: 1,
          actorId: 1,
        })
      );
      expect(
        (
          await client.query(
            'select amount from "purchaseOrderAdvanceApplications" where "invoiceId"=1'
          )
        ).rows
      ).toEqual([{ amount: "216733.1100" }]);
      expect(await balance()).toBe("0.0000");
      await (await database.getDb())!.transaction(tx =>
        advances.applyAvailableAdvancesForPurchaseOrder({
          executor: tx,
          purchaseOrderId: 1,
          actorId: 1,
        })
      );
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderAdvanceApplications"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("uses the same per-payment rounding as the UI for legacy bank amounts", async () => {
      await client.query(
        'update invoices set total=100.0055, "netPayable"=100.0055 where id=1'
      );
      for (let index = 0; index < 2; index += 1) {
        const payment = await reserve(10.01);
        await client.query(
          `update "treasuryPaymentItems" set status='contabilizada', "bankPaidAmount"=10.0050, "activeReservation"=false where "batchId"=$1`,
          [payment.id]
        );
      }
      const eligible = await treasury.listEligibleTreasuryInvoices({
        projectId: 1,
      });
      expect(
        eligible.find(row => row.invoice.id === 1)?.money.availableAmount
      ).toBe(79.99);
      await reserve(79.99);
      expect(await balance()).toBe("0.0000");
    });
    it("serializes actual advance application and a simultaneous credit", async () => {
      const input = draft("credit", "700");
      const note = await create(input);
      await prepare(note.id, input);
      await client.query(`update invoices set status='borrador' where id<>1;
      insert into "purchaseOrderAdvances" (id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") values (1,'ANT-1',1,1,1,'HNL',600,current_date,1);
      insert into "treasuryPaymentBatches" (id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById","paymentKind") values (1,'TES-ANT-1',1,'HNL',current_date,1,'purchase_order_advance');
      insert into "treasuryPaymentItems" ("batchId","sourceType","purchaseOrderAdvanceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation") values (1,'purchase_order_advance',1,1,'S1','Supplier','ANT-1','HNL',600,600,600,'contabilizada',false)`);
      const advances = await import("./purchaseOrderAdvances");
      const results = await Promise.allSettled([
        (await database.getDb())!.transaction(tx =>
          advances.applyAvailableAdvancesForPurchaseOrder({
            executor: tx,
            purchaseOrderId: 1,
            actorId: 1,
          })
        ),
        service.transitionFinancialNote(
          note.id,
          "account",
          undefined,
          accountant
        ),
      ]);
      expect(results[0].status).toBe("fulfilled");
      expect(Number(await balance())).toBeGreaterThanOrEqual(0);
      const row = (
        await client.query(
          `select i."netPayable",coalesce(sum(a.amount),0)::text applied from invoices i left join "purchaseOrderAdvanceApplications" a on a."invoiceId"=i.id where i.id=1 group by i.id`
        )
      ).rows[0];
      expect(Number(row.applied)).toBeLessThanOrEqual(Number(row.netPayable));
    });

    it("operation toggle preserves consultation and balances", async () => {
      const n = await post();
      await client.query('update "financialNoteSettings" set enabled=false');
      await expect(create()).rejects.toThrow(/deshabilitadas/);
      expect((await service.getFinancialNote(n.id, admin)).note.status).toBe(
        "registrada"
      );
      expect(await balance()).toBe("900.0000");
    });
  }
);
