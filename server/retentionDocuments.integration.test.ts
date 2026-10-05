import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { buildRetentionPrintHtml } from "../client/src/lib/retention-document-print";
const testUrl = process.env.FINANCIAL_NOTES_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
const admin = { id: 1, role: "admin" };
const accountant = { id: 1, role: "user", buildreqRole: "contable" };
const central = { id: 1, role: "user", buildreqRole: "administracion_central" };
const denied = {
  id: 1,
  role: "user",
  buildreqRole: "administrador_proyecto",
  assignedProjectId: 1,
};
suite(
  "retention documents: atomic accounting, closed documents and archival migration",
  { timeout: 30000 },
  () => {
    let client: Client,
      db: typeof import("./db"),
      service: typeof import("./retentionDocuments"),
      notes: typeof import("./financialNotes");
    let reversals: typeof import("./invoiceReversals");
    const reversalMigration = readFileSync(
      new URL(
        "../drizzle/20261001155841_invoice_accounting_reversal.sql",
        import.meta.url
      ),
      "utf8"
    );
    const migration = readFileSync(
      new URL(
        "../drizzle/20260930120000_retention_documents.sql",
        import.meta.url
      ),
      "utf8"
    );
    const printMigration = readFileSync(
      new URL("../drizzle/20261005120000_retention_print.sql", import.meta.url),
      "utf8"
    );
    beforeAll(async () => {
      const token = process.env.FINANCIAL_NOTES_TEST_TOKEN,
        url = new URL(testUrl!);
      if (
        !token ||
        !/^[0-9a-f]{16}$/.test(token) ||
        url.pathname !== "/buildreq_notes_test_" + token ||
        !["127.0.0.1", "localhost"].includes(url.hostname)
      )
        throw Error("Disposable local database required");
      process.env.DATABASE_URL = testUrl;
      client = new Client({ connectionString: testUrl });
      await client.connect();
      db = await import("./db");
      service = await import("./retentionDocuments");
      notes = await import("./financialNotes");
      reversals = await import("./invoiceReversals");
    });
    afterAll(async () => {
      await ((await db?.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      // Owner-only fixture setup in a verified disposable database. Restore every guard before assertions.
      await client.query(`DO $$ DECLARE r record; BEGIN FOR r IN SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname IN ('closed_invoice_guard','closed_invoice_child_guard','legacy_retention_guard','retention_attachment_guard','accounted_retention_required','retention_document_guard') LOOP EXECUTE format('DROP TRIGGER %I ON %I',r.tgname,r.relname); END LOOP; END $$;
  TRUNCATE attachments,"financialNotes","financialNoteSequences","treasuryPaymentBatches","purchaseOrderAdvanceApplications","reverseLogistics","inventoryItems","invoiceRetentions","invoiceItems","receiptItems",invoices,receipts,"purchaseOrders",suppliers,projects,warehouses,users RESTART IDENTITY CASCADE;
  INSERT INTO users(id,"openId",name) VALUES(1,'retention-test','Contador de prueba');
  INSERT INTO warehouses(id,code,name,"displayName") VALUES(1,'W1','Bodega','Bodega');
  INSERT INTO projects(id,code,name,"warehouseId") VALUES(1,'P1','Proyecto Uno',1);
  INSERT INTO suppliers(id,"supplierCode",name,rtn) VALUES(1,'S1','Proveedor Uno','08011999000001');
  INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById") VALUES(1,'OC1',1,1,1);
  INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") SELECT i,'REC-'||i,'purchase_order',1,1,1 FROM generate_series(1,5)i;
  INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"postingDate","receiptDate","emissionDeadline",total,"retentionTotal","netPayable","retentionReceiptNumber","retentionCai","retentionDocumentRangeStart","retentionDocumentRangeEnd","retentionDocumentDate","retentionEmissionDeadline","accountedAt","accountedById")
  SELECT i,'FT-'||i,i,1,1,1,CASE WHEN i=3 THEN 'registrada'::"invoice_status" WHEN i=4 THEN 'revisada'::"invoice_status" WHEN i=5 THEN 'anulada'::"invoice_status" ELSE 'pendiente_contabilizar'::"invoice_status" END,
  now(),now(),now()+interval '1 year',1000,CASE WHEN i IN(2,5) THEN 0 ELSE 60 END,CASE WHEN i IN(2,5) THEN 1000 ELSE 940 END,
  '001-001-01-'||lpad(i::text,8,'0'),'338827-15203E-A419E0-63BE03-0909A6-53','001-001-01-00000001','001-001-01-99999999','2026-09-22','2027-12-31',CASE WHEN i=3 THEN now() ELSE NULL END,CASE WHEN i=3 THEN 1 ELSE NULL END FROM generate_series(1,5)i;
  INSERT INTO "receiptItems"(id,"receiptId","itemName","quantityExpected","quantityReceived","warehouseId") VALUES(1,1,'Material original',1,1,1);
  INSERT INTO "invoiceItems"("invoiceId","receiptItemId","itemName",quantity,"unitPrice",subtotal,"taxAmount",total) VALUES(1,1,'Material original',1,1000,1000,0,1000);
  INSERT INTO "taxRetentions"(id,"taxCode",description,"ratePercent") VALUES(101,'RT01','Retención 1%',1),(102,'RT02','Retención 5%',5) ON CONFLICT(id) DO NOTHING;
  INSERT INTO "invoiceRetentions"("invoiceId","retentionCatalogId","retentionType",description,"retentionCode","baseAmount",percentage,amount)
  SELECT i,101,'percentage','Retención 1%','RT01',1000,1,10 FROM generate_series(1,4)i WHERE i<>2;
  INSERT INTO "invoiceRetentions"("invoiceId","retentionCatalogId","retentionType",description,"retentionCode","baseAmount",percentage,amount)
  SELECT i,102,'percentage','Retención 5%','RT02',1000,5,50 FROM generate_series(1,4)i WHERE i<>2;
  INSERT INTO "financialNotes"(id,type,origin,"documentNumber","projectId","supplierId",currency,status,"sourceInvoiceId","createdById",subtotal,total)
  VALUES(100,'credit','retentions','NC-ANT-100',1,1,'HNL','revisada',3,1,60,60),(101,'credit','retentions','NC-ANT-101',1,1,'HNL','anulada',3,1,30,30),(102,'credit','retentions','NC-ANT-102',1,1,'HNL','borrador',4,1,60,60),(103,'credit','retentions','NC-ANT-103',1,1,'HNL','anulada',5,1,40,40);
  INSERT INTO "financialNoteEvents"("noteId","actorId",action,comment) SELECT i,1,'creada','Evento original' FROM generate_series(100,103)i;
  INSERT INTO attachments("entityType","entityId","fileName","fileKey","fileUrl","mimeType","fileSize","uploadedById") VALUES('invoice',1,'factura.pdf','tests/factura','/factura.pdf','application/pdf',20,1),('financial_note',100,'antigua.pdf','tests/antigua','/antigua.pdf','application/pdf',20,1);
  UPDATE "financialNoteSettings" SET enabled=true,"activatedAt"=now()-interval '1 day';`);
      const database = (await db.getDb())!;
      await database.transaction(async tx => {
        await notes.syncRetentionConcept(tx, 101);
        await notes.syncRetentionConcept(tx, 102);
      });
      await client.query(`INSERT INTO "financialNoteLines"("noteId","conceptId",code,description,"baseAmount","taxAmount",total) SELECT n.id,c.id,c.code,c.description,n.total,0,n.total FROM "financialNotes" n CROSS JOIN "financialNoteConcepts" c WHERE n.origin='retentions' AND c."retentionCatalogId"=101;
  INSERT INTO "financialNoteInvoices"("noteId","invoiceId",amount) SELECT id,"sourceInvoiceId",total FROM "financialNotes";
  SELECT setval(pg_get_serial_sequence('"financialNotes"','id'),103);`);
      await client.query(migration);
      await client.query(
        "INSERT INTO users(id,\"openId\",name,email,role) VALUES(2,'reversal-admin','Ed Reversal','ed_barah@hotmail.com','admin')"
      );
      await client.query(reversalMigration);
      await client.query(reversalMigration);
      await client.query(printMigration);
    });
    async function account(id = 1) {
      return db.accountInvoice({ id, accountedById: 1 });
    }
    async function migrate() {
      return (await db.getDb())!.transaction(tx =>
        service.reclassifyRetentionDocuments(tx)
      );
    }
    it("creates a normal registered retention from a saved draft invoice through the authenticated endpoint", async () => {
      await client.query("update invoices set status='borrador' where id=1");
      const { invoicesRouter } = await import("./routers/invoices");
      const caller = invoicesRouter.createCaller({
        user: denied,
        req: { headers: {} },
        res: {},
      } as any);
      const document = await caller.printRetention({ id: 1 });
      expect(document).toMatchObject({
        invoiceId: 1,
        status: "registrada",
        total: "60.0000",
        createdById: 1,
      });
      expect(document.snapshot).toMatchObject({
        accountedAt: null,
        accountedById: null,
        actorName: null,
      });
      expect(buildRetentionPrintHtml(document)).toContain("size: letter;");
      expect(
        (await service.listRetentionDocuments({ status: "registrada" }, admin))
          .items
      ).toHaveLength(1);
      expect((await service.listRetentionDocuments({}, admin)).totals).toEqual([
        { currency: "HNL", total: "60.0000" },
      ]);
      expect(
        (
          await client.query(
            'select status,"netPayable" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual({ status: "borrador", netPayable: "940.0000" });
      expect(
        (
          await client.query(
            'select count(*)::int n from "financialNotes" where "sourceInvoiceId"=1'
          )
        ).rows[0].n
      ).toBe(0);
    });
    it("prints the selected purchase order contact address and original invoice fiscal fields", async () => {
      await client.query(`update suppliers set address='Dirección general' where id=1;
        insert into "supplierContacts" (id,"supplierId","projectId",name,address) values(1,1,1,'Contacto de prueba','Dirección seleccionada');
        update "purchaseOrders" set "supplierContactId"=1 where id=1;
        update invoices set "documentDate"='2026-09-20',cai='CAI-DE-FACTURA' where id=1`);
      const document = await service.prepareInvoiceRetentionPrint(1, admin);
      expect(document.snapshot.supplierAddress).toBe("Dirección seleccionada");
      const html = buildRetentionPrintHtml(document);
      expect(html).toContain(
        'supplier-address multiline">Dirección seleccionada</div>'
      );
      expect(html).toContain('invoice-cai">CAI-DE-FACTURA</div>');
      expect(html).toContain('print-date">20/09/2026</div>');
      await account();
      await client.query(
        "update suppliers set address='Cambio posterior' where id=1; update \"supplierContacts\" set address='Cambio posterior' where id=1"
      );
      expect(
        (await service.prepareInvoiceRetentionPrint(1, admin)).snapshot
          .supplierAddress
      ).toBe("Dirección seleccionada");
    });
    it("accepts the previous Honduras accounting timestamp producer while rejecting an unclosed printed retention", async () => {
      const printed = await service.prepareInvoiceRetentionPrint(1, admin);
      await (await db.getDb())!.transaction(async tx => {
        await tx.execute(
          sql`update invoices set status='registrada',"accountedAt"='2026-10-05 12:00:00',"accountedById"=1 where id=1`
        );
        await tx.execute(
          sql`update "retentionDocuments" set snapshot=jsonb_set(jsonb_set(snapshot,'{accountedAt}','"2026-10-05T18:00:00.000Z"'),'{accountedById}'::text[],'1') where id=${printed.id}`
        );
      });
      const closed = (await service.getRetentionDocument(printed.id, admin))
        .document;
      expect(closed.snapshot.accountedAt).toBe("2026-10-05T18:00:00.000Z");
      await expect(
        client.query('update "retentionDocuments" set total=1 where id=$1', [
          printed.id,
        ])
      ).rejects.toThrow(/cerrado/);
    });
    it("enriches old closed snapshots for preprinted reprints without changing the stored document", async () => {
      await account();
      await client.query(
        "update suppliers set address='Dirección de prueba' where id=1"
      );
      // Represent the deployed snapshots created before supplierAddress was added.
      await client.query(
        'ALTER TABLE "retentionDocuments" DISABLE TRIGGER retention_document_guard'
      );
      try {
        await client.query(
          `update "retentionDocuments" set snapshot=snapshot-'supplierAddress' where "invoiceId"=1`
        );
      } finally {
        await client.query(
          'ALTER TABLE "retentionDocuments" ENABLE TRIGGER retention_document_guard'
        );
      }
      const before = (
        await client.query(
          'select * from "retentionDocuments" where "invoiceId"=1'
        )
      ).rows[0];
      const printed = await service.prepareInvoiceRetentionPrint(1, admin);
      expect(buildRetentionPrintHtml(printed)).toContain(
        'supplier-address multiline">Dirección de prueba</div>'
      );
      expect(
        (
          await client.query(
            'select * from "retentionDocuments" where "invoiceId"=1'
          )
        ).rows[0]
      ).toEqual(before);
    });
    it("reuses one retention across concurrent and repeated prints", async () => {
      const documents = await Promise.all(
        Array.from({ length: 4 }, () =>
          service.prepareInvoiceRetentionPrint(1, admin)
        )
      );
      expect(new Set(documents.map(d => d.id)).size).toBe(1);
      expect(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).total
      ).toBe(1);
    });
    it("updates the same printed retention after accounting rejects and the user corrects lines and fiscal data", async () => {
      const printed = await service.prepareInvoiceRetentionPrint(1, admin);
      await db.rejectInvoiceFromAccounting({
        id: 1,
        rejectedById: 1,
        rejectionComment: "Corregir la base",
      });
      await db.replaceInvoiceRetentions(
        1,
        [
          { retentionCatalogId: 101, baseAmount: "500" },
          { retentionCatalogId: 102, baseAmount: "500" },
        ],
        undefined,
        undefined,
        1
      );
      await db.updateInvoice(1, {
        retentionReceiptNumber: "001-001-01-00000009",
        retentionDocumentDate: new Date("2026-10-05T00:00:00Z"),
      });
      const corrected = (await service.getRetentionDocument(printed.id, admin))
        .document;
      expect(corrected).toMatchObject({
        id: printed.id,
        status: "registrada",
        total: "30.0000",
        documentNumber: "001-001-01-00000009",
      });
      expect(corrected.snapshot.documentDate).toBe("2026-10-05");
      expect(corrected.snapshot.lines.map(l => l.amount)).toEqual([
        "5.0000",
        "25.0000",
      ]);
      expect(
        (await client.query('select "netPayable" from invoices where id=1'))
          .rows[0].netPayable
      ).toBe("970.0000");
      expect((await service.prepareInvoiceRetentionPrint(1, admin)).id).toBe(
        printed.id
      );
    });
    it("finalizes the same retention at accounting and keeps its snapshot immutable", async () => {
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await account();
      const document = await service.prepareInvoiceRetentionPrint(1, denied);
      expect(document).toMatchObject({
        id: retention.id,
        status: "registrada",
        total: "60.0000",
      });
      expect(document.snapshot.accountedById).toBe(1);
      expect(document.snapshot.accountedAt).not.toBeNull();
      expect(
        (await service.getRetentionDocument(retention.id, admin)).attachments
      ).toHaveLength(1);
      await expect(
        db.updateInvoice(1, { retentionReceiptNumber: "001-001-01-00000009" })
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/cerrada/) },
      });
      await expect(
        client.query(
          "update \"retentionDocuments\" set status='borrador' where id=$1",
          [retention.id]
        )
      ).rejects.toThrow(/cerrado/);
      expect(
        (await service.getRetentionDocument(retention.id, admin)).document
          .snapshot
      ).toEqual(document.snapshot);
    });
    it("removes a printed retention when all retentions are removed", async () => {
      await service.prepareInvoiceRetentionPrint(1, admin);
      await client.query("update invoices set status='rechazada' where id=1");
      await db.replaceInvoiceRetentions(1, [], undefined, undefined, 1);
      expect(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).total
      ).toBe(0);
      await expect(
        service.prepareInvoiceRetentionPrint(1, admin)
      ).rejects.toThrow(/no tiene retenciones/);
      expect(
        (await client.query('select "netPayable" from invoices where id=1'))
          .rows[0].netPayable
      ).toBe("1000.0000");
    });
    it("keeps retention supports editable and freezes only current attachments at accounting", async () => {
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await service.assertRetentionAttachmentUnchanged(1);
      await client.query("delete from attachments where id=1");
      expect(
        (await service.getRetentionDocument(retention.id, admin)).attachments
      ).toEqual([]);
      await client.query(
        `INSERT INTO attachments("entityType","entityId","fileName","fileKey","fileUrl","fileSize","uploadedById") VALUES('invoice',1,'corregida.pdf','tests/corregida','/corregida.pdf',20,1)`
      );
      await account();
      expect(
        (await service.getRetentionDocument(retention.id, admin)).attachments[0]
          .fileName
      ).toBe("corregida.pdf");
      await expect(
        client.query("delete from attachments where id=3")
      ).rejects.toThrow(/cerrados|soporte/);
    });
    it("denies printing across project boundaries, unauthorized roles, annulled and empty invoices", async () => {
      await expect(
        service.prepareInvoiceRetentionPrint(1, {
          ...denied,
          assignedProjectId: 99,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        service.prepareInvoiceRetentionPrint(1, {
          ...denied,
          buildreqRole: "bodeguero_proyecto",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        service.prepareInvoiceRetentionPrint(5, admin)
      ).rejects.toThrow(/anulada/);
      await expect(
        service.prepareInvoiceRetentionPrint(2, admin)
      ).rejects.toThrow(/no tiene retenciones/);
      expect((await service.listRetentionDocuments({}, admin)).total).toBe(0);
    });
    it("serializes a concurrent correction and print without stale persisted amounts or duplicates", async () => {
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await client.query("update invoices set status='rechazada' where id=1");
      await Promise.all([
        service.prepareInvoiceRetentionPrint(1, admin),
        db.replaceInvoiceRetentions(
          1,
          [{ retentionCatalogId: 101, baseAmount: "500" }],
          undefined,
          undefined,
          1
        ),
      ]);
      expect(
        (await service.getRetentionDocument(retention.id, admin)).document.total
      ).toBe("5.0000");
      expect(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).total
      ).toBe(1);
    });
    it("rolls corrections back if the printed retention cannot be synchronized", async () => {
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await client.query("update invoices set status='rechazada' where id=1");
      await client.query(`CREATE FUNCTION private.test_draft_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced retention error'; END $$;
        CREATE TRIGGER test_draft_failure BEFORE UPDATE ON "retentionDocuments" FOR EACH ROW EXECUTE FUNCTION private.test_draft_failure();`);
      try {
        await expect(
          db.replaceInvoiceRetentions(
            1,
            [{ retentionCatalogId: 101, baseAmount: "500" }],
            undefined,
            undefined,
            1
          )
        ).rejects.toMatchObject({
          cause: { message: "forced retention error" },
        });
        await expect(
          db.updateInvoice(1, { retentionReceiptNumber: "001-001-01-00000009" })
        ).rejects.toMatchObject({
          cause: { message: "forced retention error" },
        });
        expect(
          (
            await client.query(
              'select "retentionTotal","netPayable","retentionReceiptNumber" from invoices where id=1'
            )
          ).rows[0]
        ).toEqual({
          retentionTotal: "60.0000",
          netPayable: "940.0000",
          retentionReceiptNumber: "001-001-01-00000001",
        });
        expect(
          (await service.getRetentionDocument(retention.id, admin)).document
            .total
        ).toBe("60.0000");
        expect(
          (
            await client.query(
              'select amount from "invoiceRetentions" where "invoiceId"=1 order by id'
            )
          ).rows.map(r => r.amount)
        ).toEqual(["10.0000", "50.0000"]);
      } finally {
        await client.query(
          'DROP TRIGGER test_draft_failure ON "retentionDocuments"; DROP FUNCTION private.test_draft_failure()'
        );
      }
    });
    it("rejects incomplete fiscal data without creating a retention and denies early finalization", async () => {
      await client.query('update invoices set "retentionCai"=null where id=1');
      await expect(
        service.prepareInvoiceRetentionPrint(1, admin)
      ).rejects.toThrow(/CAI/);
      expect((await service.listRetentionDocuments({}, admin)).total).toBe(0);
      await client.query('update invoices set "retentionCai"=$1 where id=1', [
        "338827-15203E-A419E0-63BE03-0909A6-53",
      ]);
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await expect(
        client.query(
          "update \"retentionDocuments\" set snapshot=jsonb_set(jsonb_set(snapshot,'{accountedAt}','\"2026-10-05T00:00:00.000Z\"'),'{accountedById}','1') where id=$1",
          [retention.id]
        )
      ).rejects.toThrow(/estado/);
    });
    it("preserves the printed retention if accounting fails while copying supports", async () => {
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await client.query(`CREATE FUNCTION private.test_retention_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced copy error'; END $$;
        CREATE TRIGGER test_retention_failure BEFORE INSERT ON "retentionDocumentAttachments" FOR EACH ROW EXECUTE FUNCTION private.test_retention_failure();`);
      try {
        await expect(account()).rejects.toThrow();
        expect(
          (await client.query("select status from invoices where id=1")).rows[0]
            .status
        ).toBe("pendiente_contabilizar");
        expect(
          (await service.getRetentionDocument(retention.id, admin)).document
        ).toEqual({ ...retention, voidedByName: null });
        expect(
          (
            await client.query(
              'select count(*)::int n from "retentionDocumentAttachments"'
            )
          ).rows[0].n
        ).toBe(0);
      } finally {
        await client.query(
          'DROP TRIGGER test_retention_failure ON "retentionDocumentAttachments"; DROP FUNCTION private.test_retention_failure()'
        );
      }
    });
    it("removes an open retention when its source invoice is annulled by correction", async () => {
      const retention = await service.prepareInvoiceRetentionPrint(1, admin);
      await (await db.getDb())!.transaction(async tx => {
        await tx.execute(sql`update invoices set status='anulada' where id=1`);
        await service.syncInvoiceRetentionDocument(tx, 1);
      });
      await expect(
        service.getRetentionDocument(retention.id, admin)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        service.prepareInvoiceRetentionPrint(1, admin)
      ).rejects.toThrow(/anulada/);
    });
    it("repeats both migrations without altering normal retentions, closed snapshots or balances", async () => {
      await service.prepareInvoiceRetentionPrint(1, admin);
      await (await db.getDb())!.transaction(tx =>
        service.createInvoiceRetentionDocument(tx, 3)
      );
      const documents = (
        await client.query('select * from "retentionDocuments" order by id')
      ).rows;
      const balances = (
        await client.query('select id,"netPayable" from invoices order by id')
      ).rows;
      await client.query(migration);
      await client.query(migration);
      expect(
        (await client.query('select * from "retentionDocuments" order by id'))
          .rows
      ).toEqual(documents);
      expect(
        (await client.query('select id,"netPayable" from invoices order by id'))
          .rows
      ).toEqual(balances);
      await expect(
        client.query(
          'insert into "retentionDocuments" ("invoiceId","projectId","supplierId",status,"documentNumber",currency,total,"documentDate","createdById",snapshot) select "invoiceId","projectId","supplierId",status,"documentNumber",currency,total,"documentDate","createdById",snapshot from "retentionDocuments" where "invoiceId"=1'
        )
      ).rejects.toThrow(/duplicate/);
    });
    it("creates exactly one fixed complete document at accounting, with no extra financial effect", async () => {
      expect((await service.listRetentionDocuments({}, admin)).total).toBe(0);
      const original = (
        await client.query('select "netPayable" from invoices where id=1')
      ).rows[0];
      await account();
      const page = await service.listRetentionDocuments(
        { invoiceId: 1 },
        admin
      );
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        documentNumber: "001-001-01-00000001",
        total: "60.0000",
        status: "registrada",
      });
      const detail = await service.getRetentionDocument(
        page.items[0].id,
        accountant
      );
      expect(detail.document.snapshot.lines).toHaveLength(2);
      expect(detail.document.snapshot.original?.invoiceItems).toEqual([
        expect.objectContaining({
          itemName: "Material original",
          subtotal: "1000.0000",
        }),
      ]);
      expect(detail.document.snapshot).toMatchObject({
        supplierRtn: "08011999000001",
        actorName: "Contador de prueba",
        documentDate: "2026-09-22",
      });
      expect(detail.attachments[0].fileName).toBe("factura.pdf");
      expect(
        (await client.query('select "netPayable" from invoices where id=1'))
          .rows[0]
      ).toEqual(original);
      expect(
        (
          await client.query(
            'select count(*)::int n from "financialNotes" where "sourceInvoiceId"=1'
          )
        ).rows[0].n
      ).toBe(0);
      await client.query(
        "update suppliers set name='Nombre posterior' where id=1"
      );
      expect(
        (await service.getRetentionDocument(page.items[0].id, admin)).document
          .snapshot.supplierName
      ).toBe("Proveedor Uno");
    });
    it("reverts an invoice without withholding directly to the treasury queue without changing money", async () => {
      await account(2);
      const before = (
        await client.query(
          'select total,"netPayable","retentionTotal" from invoices where id=2'
        )
      ).rows[0];
      expect(
        await reversals.revertInvoiceToTreasury(2, 2, "Corregir factura")
      ).toMatchObject({
        id: 2,
        status: "pendiente_contabilizar",
        voidedRetentionCount: 0,
      });
      expect(
        (
          await client.query(
            'select status,"accountedAt","accountedById","submittedForAccountingById" from invoices where id=2'
          )
        ).rows[0]
      ).toEqual({
        status: "pendiente_contabilizar",
        accountedAt: null,
        accountedById: null,
        submittedForAccountingById: 2,
      });
      expect(
        (
          await client.query(
            'select total,"netPayable","retentionTotal" from invoices where id=2'
          )
        ).rows[0]
      ).toEqual(before);
      expect((await reversals.getInvoiceReversalHistory(2))[0]).toMatchObject({
        actorName: "Ed Reversal",
        reason: "Corregir factura",
        voidedRetentionCount: 0,
      });
    });
    it("annuls the retention and retains its original snapshot and files through rejection and re-accounting", async () => {
      await account();
      const original = await service.getRetentionDocument(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).items[0]
          .id,
        admin
      );
      await reversals.revertInvoiceToTreasury(1, 2, "Corregir <importe>");
      const cancelled = await service.getRetentionDocument(
        original.document.id,
        admin
      );
      expect(cancelled.document).toMatchObject({
        status: "anulada",
        voidReason: "Corregir <importe>",
        voidedById: 2,
        voidedByName: "Ed Reversal",
        snapshot: original.document.snapshot,
      });
      expect(cancelled.attachments).toEqual(original.attachments);
      expect(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).totals
      ).toEqual([]);
      const html = buildRetentionPrintHtml(cancelled.document);
      expect(html).toContain("ANULADO");
      expect(html).toContain("Corregir &lt;importe&gt;");
      expect(html).not.toContain("Corregir <importe>");
      await db.rejectInvoiceFromAccounting({
        id: 1,
        rejectedById: 1,
        rejectionComment: "Corregir los datos",
        expectedStatus: "pendiente_contabilizar",
      });
      await db.reviewInvoice(1, 1);
      await db.submitInvoiceForAccounting({ id: 1, submittedById: 1 });
      await account();
      const current = await service.listRetentionDocuments(
        { invoiceId: 1, status: "registrada" },
        admin
      );
      expect(current.total).toBe(1);
      expect(current.items[0].id).not.toBe(original.document.id);
      expect(current.totals).toEqual([{ currency: "HNL", total: "60.0000" }]);
      expect(
        (
          await service.listRetentionDocuments(
            { invoiceId: 1, status: "anulada" },
            admin
          )
        ).total
      ).toBe(1);
      expect(
        (
          await client.query(
            'select "netPayable","retentionTotal" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual({ netPayable: "940.0000", retentionTotal: "60.0000" });
      await client.query(reversalMigration);
      expect(
        (await service.getRetentionDocument(original.document.id, admin))
          .document.snapshot
      ).toEqual(original.document.snapshot);
    });
    it("rejects an unauthorized actor at the database boundary", async () => {
      await account();
      await expect(
        reversals.revertInvoiceToTreasury(1, 1, "Corregir factura")
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceAccountingReversals"'
          )
        ).rows[0].n
      ).toBe(0);
    });
    it("serializes simultaneous reversals with only one audit event", async () => {
      await account();
      const results = await Promise.allSettled([
        reversals.revertInvoiceToTreasury(1, 2, "Primera corrección"),
        reversals.revertInvoiceToTreasury(1, 2, "Segunda corrección"),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
      expect(
        (results.find(r => r.status === "rejected") as PromiseRejectedResult)
          .reason
      ).toMatchObject({ code: "CONFLICT" });
      expect(
        (
          await client.query(
            'select count(*)::int n from "invoiceAccountingReversals"'
          )
        ).rows[0].n
      ).toBe(1);
      const eventId = (await reversals.getInvoiceReversalHistory(1))[0].id;
      await expect(
        client.query(
          "update \"invoiceAccountingReversals\" set reason='Cambiar historial' where id=$1",
          [eventId]
        )
      ).rejects.toThrow(/cerrado/);
      await expect(
        client.query('delete from "invoiceAccountingReversals" where id=$1', [
          eventId,
        ])
      ).rejects.toThrow(/cerrado/);
    });
    it("annuls migrated retention documents while preserving their legacy notes, antecedents and attachments", async () => {
      await migrate();
      const doc = (
        await service.listRetentionDocuments({ invoiceId: 3 }, admin)
      ).items[0];
      const before = await service.getRetentionDocument(doc.id, admin);
      const originalNotes = (
        await client.query(
          'select * from "financialNotes" where "sourceInvoiceId"=3 order by id'
        )
      ).rows;
      await reversals.revertInvoiceToTreasury(
        3,
        2,
        "Corregir factura histórica"
      );
      const after = await service.getRetentionDocument(doc.id, admin);
      expect(after.document.status).toBe("anulada");
      expect(after.document.snapshot).toEqual(before.document.snapshot);
      expect(after.antecedents).toEqual(before.antecedents);
      expect(after.attachments).toEqual(before.attachments);
      expect(
        (
          await client.query(
            'select * from "financialNotes" where "sourceInvoiceId"=3 order by id'
          )
        ).rows
      ).toEqual(originalNotes);
      expect(await service.resolveLegacyRetention(100, admin)).toEqual({
        documentId: doc.id,
      });
    });
    it("denies browser-role access to the reversal function and audit table", async () => {
      for (const role of ["anon", "authenticated"]) {
        const privileges = (
          await client.query(
            `select has_table_privilege($1,'"invoiceAccountingReversals"','SELECT') can_read,
          has_table_privilege($1,'"invoiceAccountingReversals"','INSERT') can_insert,
          has_function_privilege($1,'private.revert_accounted_invoice(integer,integer,text)','EXECUTE') can_revert`,
            [role]
          )
        ).rows[0];
        expect(privileges).toEqual({
          can_read: false,
          can_insert: false,
          can_revert: false,
        });
      }
    });
    it("rechecks that Ed is active inside PostgreSQL before modifying any document", async () => {
      await account();
      await client.query('update users set "isActive"=false where id=2');
      await expect(
        reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (
          await service.listRetentionDocuments(
            { invoiceId: 1, status: "registrada" },
            admin
          )
        ).total
      ).toBe(1);
      expect(await reversals.getInvoiceReversalHistory(1)).toEqual([]);
    });
    async function payment(
      status: string,
      reservation: boolean,
      cancelled = false
    ) {
      await client.query(
        `INSERT INTO "treasuryPaymentBatches"(id,"batchNumber","projectId",currency,"requestedPaymentDate","createdById",status)
        VALUES(70,'TES-REV',1,'HNL',current_date,1,$1)`,
        [cancelled ? "anulado" : "borrador"]
      );
      await client.query(
        `INSERT INTO "treasuryPaymentItems"("batchId","sourceType","invoiceId","supplierId","supplierCode","supplierName","invoiceDocumentNumber",currency,"invoiceNetPayable","requestedAmount","bankPaidAmount",status,"activeReservation","accountedAt")
        VALUES(70,'invoice',1,1,'S1','Proveedor Uno','FT-1','HNL',940,100,$1,$2,$3,now())`,
        [reservation ? 0 : 100, status, reservation]
      );
    }
    it.each([
      ["incluida", true],
      ["pagada", false],
      ["con_diferencia", false],
      ["contabilizada", false],
    ] as const)(
      "blocks treasury dependencies in state %s without annulling a retention",
      async (status, reservation) => {
        await account();
        await payment(status, reservation);
        await expect(
          reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("pagos o reservas"),
        });
        expect(
          (
            await service.listRetentionDocuments(
              { invoiceId: 1, status: "registrada" },
              admin
            )
          ).total
        ).toBe(1);
        expect(
          (
            await client.query(
              'select count(*)::int n from "invoiceAccountingReversals"'
            )
          ).rows[0].n
        ).toBe(0);
      }
    );
    it("ignores a stale reservation belonging to a cancelled unexecuted batch", async () => {
      await account();
      await payment("incluida", true, true);
      expect(
        await reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
      ).toMatchObject({ voidedRetentionCount: 1 });
    });
    it("blocks applied advances", async () => {
      await account();
      await client.query(`INSERT INTO "purchaseOrderAdvances"(id,"advanceNumber","purchaseOrderId","projectId","supplierId",currency,"requestedAmount","requestedPaymentDate","createdById") VALUES(1,'ANT-REV',1,1,1,'HNL',100,current_date,1);
        INSERT INTO "purchaseOrderAdvanceApplications"("purchaseOrderAdvanceId","invoiceId",amount,"appliedById") VALUES(1,1,100,1)`);
      await expect(
        reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("anticipos"),
      });
    });
    it("blocks even an unapplied contractual commitment", async () => {
      await account();
      await client.query(
        `INSERT INTO "invoiceContractualAmortizations"("invoiceId","purchaseOrderId","inputMode","inputValue","baseKind","baseAmount","proposedAmount",amount) VALUES(1,1,'amount',100,'total',1000,100,100)`
      );
      await expect(
        reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("amortización"),
      });
    });
    it.each(["credit", "debit"] as const)(
      "blocks active %s notes including drafts",
      async type => {
        await account();
        const concept = (
          await client.query(
            'select id from "financialNoteConcepts" where type=$1 and "retentionCatalogId" is null order by id limit 1',
            [type]
          )
        ).rows[0];
        await notes.createFinancialNote(
          {
            type,
            requestKey: "block-reversal-" + type,
            lines: [
              {
                conceptId: concept.id,
                baseAmount: "20.0000",
                taxAmount: "0.0000",
              },
            ],
            allocations: [{ invoiceId: 1, amount: "20.0000" }],
          },
          admin
        );
        await expect(
          reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("notas activas"),
        });
      }
    );
    it("blocks pending quality releases", async () => {
      await client.query(
        `INSERT INTO "invoiceDocumentAdjustments"(id,"invoiceId","adjustmentType",percentage,"baseAmount",amount) VALUES(20,1,'quality_retention',10,1000,100)`
      );
      await account();
      await client.query(
        `INSERT INTO "qualityRetentionReleases"("invoiceDocumentAdjustmentId","requestedAmount",justification,"requestedById") VALUES(20,50,'Liberar por calidad',1)`
      );
      await expect(
        reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("calidad"),
      });
    });
    it("rolls cancellation and the audit event back if returning the invoice fails", async () => {
      await account();
      await client.query(`CREATE FUNCTION private.test_reversal_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced reversal error'; END $$;
        CREATE TRIGGER test_reversal_failure BEFORE UPDATE OF status ON invoices FOR EACH ROW EXECUTE FUNCTION private.test_reversal_failure()`);
      try {
        await expect(
          reversals.revertInvoiceToTreasury(1, 2, "Corregir factura")
        ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        expect(
          (
            await service.listRetentionDocuments(
              { invoiceId: 1, status: "registrada" },
              admin
            )
          ).total
        ).toBe(1);
        expect(
          (await client.query("select status from invoices where id=1")).rows[0]
            .status
        ).toBe("registrada");
        expect(
          (
            await client.query(
              'select count(*)::int n from "invoiceAccountingReversals"'
            )
          ).rows[0].n
        ).toBe(0);
      } finally {
        await client.query(
          "DROP TRIGGER test_reversal_failure ON invoices; DROP FUNCTION private.test_reversal_failure()"
        );
      }
    });
    it("rejects direct SQL modifications without the authorized reversal event", async () => {
      await account();
      await expect(
        client.query(
          "update invoices set status='pendiente_contabilizar' where id=1"
        )
      ).rejects.toThrow(/cerrada/);
      await expect(
        client.query(
          'update "retentionDocuments" set status=\'anulada\' where "invoiceId"=1'
        )
      ).rejects.toThrow(/cerrado/);
    });
    it("accounts invoices without retentions without a document", async () => {
      await account(2);
      expect(
        (await service.listRetentionDocuments({ invoiceId: 2 }, admin)).total
      ).toBe(0);
    });
    it("serializes concurrent accounting and retries without duplicate documents", async () => {
      const result = await Promise.allSettled([
        account(),
        account(),
        account(),
      ]);
      expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).total
      ).toBe(1);
      const id = await (await db.getDb())!.transaction(tx =>
        service.createInvoiceRetentionDocument(tx, 1)
      );
      expect(id?.id).toBe(
        (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).items[0]
          .id
      );
    });
    it.each(["total", "fiscal", "date", "line"] as const)(
      "rolls the whole accounting transaction back when %s validation fails",
      async kind => {
        if (kind === "total")
          await client.query(
            'update invoices set "retentionTotal"=61 where id=1'
          );
        if (kind === "fiscal")
          await client.query(
            'update invoices set "retentionCai"=null where id=1'
          );
        if (kind === "date")
          await client.query(
            "update invoices set \"retentionDocumentDate\"='2028-01-01' where id=1"
          );
        if (kind === "line")
          await client.query(
            'update "invoiceRetentions" set percentage=null where "invoiceId"=1'
          );
        await expect(account()).rejects.toThrow();
        expect(
          (await client.query("select status from invoices where id=1")).rows[0]
            .status
        ).toBe("pendiente_contabilizar");
        expect(
          (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).total
        ).toBe(0);
      }
    );
    it("rolls accounting back on an attachment-copy database failure", async () => {
      await client.query(`CREATE FUNCTION private.test_retention_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced copy error'; END $$;
  CREATE TRIGGER test_retention_failure BEFORE INSERT ON "retentionDocumentAttachments" FOR EACH ROW EXECUTE FUNCTION private.test_retention_failure();`);
      try {
        await expect(account()).rejects.toThrow();
        expect(
          (await client.query("select status from invoices where id=1")).rows[0]
            .status
        ).toBe("pendiente_contabilizar");
        expect(
          (await service.listRetentionDocuments({ invoiceId: 1 }, admin)).total
        ).toBe(0);
      } finally {
        await client.query(
          'DROP TRIGGER test_retention_failure ON "retentionDocumentAttachments"; DROP FUNCTION private.test_retention_failure()'
        );
      }
    });
    it("denies all modifications and returning to review, including admin and direct SQL", async () => {
      await account();
      await expect(db.returnAccountedInvoiceToReview(1, 1)).rejects.toThrow(
        /cerrada/
      );
      for (const statement of [
        "update invoices set status='revisada' where id=1",
        'update invoices set "retentionTotal"=0 where id=1',
        'update "invoiceRetentions" set amount=0 where "invoiceId"=1',
        'delete from "invoiceRetentions" where "invoiceId"=1',
        'update "invoiceItems" set "itemName"=\'Modificado\' where "invoiceId"=1',
        'update "retentionDocuments" set total=1 where "invoiceId"=1',
        'delete from "retentionDocuments" where "invoiceId"=1',
        'delete from attachments where "entityType"=\'invoice\' and "entityId"=1',
      ])
        await expect(client.query(statement)).rejects.toThrow();
      await expect(
        service.assertRetentionAttachmentUnchanged(1)
      ).rejects.toThrow(/cerrado/);
    });
    it("enforces exact roles for lists, detail, print data, legacy links and attachments", async () => {
      await account();
      const id = (await service.listRetentionDocuments({}, admin)).items[0].id;
      for (const actor of [admin, accountant, central])
        expect(
          (await service.getRetentionDocument(id, actor)).document.id
        ).toBe(id);
      for (const actor of [
        denied,
        { ...denied, buildreqRole: "financiero" },
        { ...denied, buildreqRole: "bodeguero_proyecto" },
      ]) {
        await expect(
          service.listRetentionDocuments({}, actor)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          service.getRetentionDocument(id, actor)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          service.retentionAttachmentUrl(id, 1, actor)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          service.resolveLegacyRetention(100, actor)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });
    it("reclassifies repeatably, preserves originals, attachments and events, and excludes historic amounts", async () => {
      const before = (
        await client.query('select * from "financialNotes" order by id')
      ).rows;
      const balances = (
        await client.query('select id,"netPayable" from invoices order by id')
      ).rows;
      const result = await migrate();
      expect(result).toMatchObject({
        created: 1,
        archived: 4,
        balancesUnchanged: true,
      });
      expect(await migrate()).toMatchObject({
        created: 0,
        archived: 0,
        balancesUnchanged: true,
      });
      await client.query(migration);
      expect(await migrate()).toMatchObject({ created: 0, archived: 0 });
      expect(
        (await client.query('select * from "financialNotes" order by id')).rows
      ).toEqual(before);
      expect(
        (await client.query('select id,"netPayable" from invoices order by id'))
          .rows
      ).toEqual(balances);
      const page = await service.listRetentionDocuments({}, central);
      expect(page.total).toBe(3);
      expect(page.totals).toEqual([{ currency: "HNL", total: "60.0000" }]);
      const current = page.items.find(d => d.status === "registrada")!;
      const detail = await service.getRetentionDocument(current.id, admin);
      expect(detail.antecedents).toHaveLength(2);
      expect(detail.attachments).toHaveLength(1);
      expect(detail.antecedents[0].snapshot.events[0].comment).toBe(
        "Evento original"
      );
      expect(await service.resolveLegacyRetention(100, admin)).toEqual({
        documentId: current.id,
      });
      const history = await service.getRetentionDocument(
        page.items.find(d => d.legacyNoteId === 102)!.id,
        admin
      );
      expect(history.document.snapshot.lines[0]).toMatchObject({
        baseAmount: null,
        percentage: null,
        amount: "60.0000",
      });
      expect(
        (await notes.listFinancialNotes({ type: "credit" }, admin)).total
      ).toBe(0);
      await expect(
        notes.transitionFinancialNote(100, "reject", "No", admin)
      ).rejects.toThrow(/cerrado/);
      await expect(
        client.query(
          "update \"financialNotes\" set status='borrador' where id=100"
        )
      ).rejects.toThrow();
    });
    it("reports manual retention concepts without reclassifying or changing their balance", async () => {
      await client.query(`INSERT INTO "financialNotes"(id,type,origin,"documentNumber","projectId","supplierId",currency,status,"createdById",subtotal,total) VALUES(200,'credit','manual','NC-MANUAL',1,1,'HNL','borrador',1,10,10);
  INSERT INTO "financialNoteLines"("noteId","conceptId",code,description,"baseAmount","taxAmount",total) SELECT 200,id,code,description,10,0,10 FROM "financialNoteConcepts" WHERE "retentionCatalogId"=101;`);
      const result = await migrate();
      expect(result.manualNotes[0]).toMatchObject({
        id: 200,
        documentNumber: "NC-MANUAL",
      });
      expect(
        (
          await client.query(
            'select count(*)::int n from "retentionDocumentAntecedents" where "noteId"=200'
          )
        ).rows[0].n
      ).toBe(0);
      expect(
        (
          await notes.listNoteConcepts({ type: "credit", pageSize: 100 })
        ).items.every(c => !c.retentionCatalogId)
      ).toBe(true);
    });
    it("filters by supplier, project, invoice, number and date and escapes print content", async () => {
      await account();
      await migrate();
      const found = await service.listRetentionDocuments(
        {
          supplierId: 1,
          projectId: 1,
          invoiceId: 1,
          search: "00000001",
          dateFrom: "2026-09-22",
          dateTo: "2026-09-22",
        },
        admin
      );
      expect(found.total).toBe(1);
      expect(
        (
          await service.listRetentionDocuments(
            { supplierSearch: "inexistente" },
            admin
          )
        ).total
      ).toBe(0);
      const detail = await service.getRetentionDocument(
        found.items[0].id,
        admin
      );
      const html = buildRetentionPrintHtml({
        ...detail.document,
        snapshot: {
          ...detail.document.snapshot,
          supplierName: "<script>alert(1)</script>",
        },
      });
      expect(html).toContain("size: letter;");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    });
    it("keeps legitimate credit note accounting compatible with closed invoices without changing the retention snapshot", async () => {
      await account();
      const original = (
        await service.getRetentionDocument(
          (await service.listRetentionDocuments({ invoiceId: 1 }, admin))
            .items[0].id,
          admin
        )
      ).document;
      const concept = (
        await client.query(
          "select id from \"financialNoteConcepts\" where code='NC-C01'"
        )
      ).rows[0].id;
      const draft = {
        type: "credit" as const,
        lines: [
          { conceptId: concept, baseAmount: "50.0000", taxAmount: "0.0000" },
        ],
        allocations: [{ invoiceId: 1, amount: "50.0000" }],
      };
      const note = await notes.createFinancialNote(
        { ...draft, requestKey: "retention-credit-compat" },
        admin
      );
      await notes.updateFinancialNote(
        note.id,
        {
          ...draft,
          cai: "338827-15203E-A419E0-63BE03-0909A6-53",
          fiscalNumber: "001-001-01-00000090",
          documentRangeStart: "001-001-01-00000001",
          documentRangeEnd: "001-001-01-99999999",
          documentDate: "2026-09-22",
          documentDueDate: "2026-10-22",
          emissionDeadline: "2027-12-31",
        },
        admin
      );
      await notes.createFinancialNoteAttachment(
        {
          entityId: note.id,
          fileName: "nota.pdf",
          fileKey: "test/nota",
          fileUrl: "/nota.pdf",
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
      expect(
        (
          await client.query(
            'select "netPayable","creditNoteTotal","retentionTotal" from invoices where id=1'
          )
        ).rows[0]
      ).toEqual({
        netPayable: "890.0000",
        creditNoteTotal: "50.0000",
        retentionTotal: "60.0000",
      });
      expect(
        (await service.getRetentionDocument(original.id, admin)).document
      ).toEqual(original);
    });
    it("enforces the document at commit and denies direct browser database privileges", async () => {
      await service.prepareInvoiceRetentionPrint(1, admin);
      await expect(
        client.query(
          'update invoices set status=\'registrada\', "accountedAt"=now(),"accountedById"=1 where id=1'
        )
      ).rejects.toThrow(/comprobante/);
      expect(
        (await client.query("select status from invoices where id=1")).rows[0]
          .status
      ).toBe("pendiente_contabilizar");
      for (const role of ["anon", "authenticated"]) {
        const result = await client.query(
          `select has_table_privilege($1,'"retentionDocuments"','SELECT') allowed,has_table_privilege($1,'"retentionDocuments"','INSERT') writable`,
          [role]
        );
        expect(result.rows[0]).toEqual({ allowed: false, writable: false });
      }
    });
    it("preserves historical invalid dates, flags them for review and keeps new accounting strict", async () => {
      await client.query(
        "ALTER TABLE invoices DISABLE TRIGGER closed_invoice_guard"
      );
      await client.query(
        "update invoices set \"retentionEmissionDeadline\"='2010-07-02' where id=3"
      );
      await client.query(
        "ALTER TABLE invoices ENABLE TRIGGER closed_invoice_guard"
      );
      const before = (await client.query("select * from invoices where id=3"))
        .rows[0];
      const result = await migrate();
      expect(result.balancesUnchanged).toBe(true);
      expect(result.reviewInvoices).toHaveLength(1);
      expect(result.reviewInvoices[0].invoiceId).toBe(3);
      const page = await service.listRetentionDocuments(
        { invoiceId: 3 },
        admin
      );
      expect(page.items[0].requiresReview).toBe(true);
      const { document } = await service.getRetentionDocument(
        page.items[0].id,
        admin
      );
      expect(document.snapshot.emissionDeadline).toBe("2010-07-02");
      expect(document.snapshot.reviewWarnings).toHaveLength(1);
      expect(buildRetentionPrintHtml(document)).not.toContain(
        "Revisión contable pendiente"
      );
      expect(
        (await client.query("select * from invoices where id=3")).rows[0]
      ).toEqual(before);
      expect(await migrate()).toMatchObject({
        created: 0,
        archived: 0,
        reviewInvoices: result.reviewInvoices,
      });
      await client.query(
        "update invoices set \"retentionEmissionDeadline\"='2010-07-02' where id=1"
      );
      await expect(account()).rejects.toThrow(/fechas/);
    });
    it("aborts archival migration with a clear report on incomplete current invoices", async () => {
      // Fixture changes represent invalid historical data before the closure migration.
      await client.query(
        "ALTER TABLE invoices DISABLE TRIGGER closed_invoice_guard"
      );
      await client.query('update invoices set "retentionCai"=null where id=3');
      await client.query(
        "ALTER TABLE invoices ENABLE TRIGGER closed_invoice_guard"
      );
      await expect(migrate()).rejects.toThrow(/facturas incompletas/);
      expect((await service.listRetentionDocuments({}, admin)).total).toBe(0);
    });
  }
);
