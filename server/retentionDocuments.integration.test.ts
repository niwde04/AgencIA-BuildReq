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
    const migration = readFileSync(
      new URL(
        "../drizzle/20260930120000_retention_documents.sql",
        import.meta.url
      ),
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
    });
    afterAll(async () => {
      await ((await db?.getDb()) as any)?.$client?.end();
      await client?.end();
    });
    beforeEach(async () => {
      // Owner-only fixture setup in a verified disposable database. Restore every guard before assertions.
      await client.query(`DO $$ DECLARE r record; BEGIN FOR r IN SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgname IN ('closed_invoice_guard','closed_invoice_child_guard','legacy_retention_guard','retention_attachment_guard','accounted_retention_required') LOOP EXECUTE format('DROP TRIGGER %I ON %I',r.tgname,r.relname); END LOOP; END $$;
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
    });
    async function account(id = 1) {
      return db.accountInvoice({ id, accountedById: 1 });
    }
    async function migrate() {
      return (await db.getDb())!.transaction(tx =>
        service.reclassifyRetentionDocuments(tx)
      );
    }
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
      expect(html).toContain("Comprobante de retención");
      expect(html).not.toContain("<script>");
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
      expect(buildRetentionPrintHtml(document)).toContain(
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
