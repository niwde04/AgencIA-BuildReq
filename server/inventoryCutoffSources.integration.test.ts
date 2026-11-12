import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Client } from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../drizzle/schema";
import * as financialSchema from "../drizzle/financial-notes-schema";
import {
  loadInventoryCutoffCurrentPending,
  loadInventoryCutoffSources,
  type InventoryCutoffExecutor,
} from "./inventoryCutoffSources";

const source = process.env.INVENTORY_CUTOFF_SOURCES_LOCAL_URL;
if (
  source &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(source).hostname)
) {
  throw new Error(
    "Las pruebas de fuentes requieren PostgreSQL local explícito."
  );
}
const period = { fromDate: "2026-10-01", throughDate: "2026-11-12" };

describe.skipIf(!source)(
  "inventory cutoff sources (isolated PostgreSQL)",
  () => {
    let admin: Client;
    let client: Client;
    let created = false;
    const name = `buildreq_cutoff_sources_${randomBytes(8).toString("hex")}`;
    const dialect = new PgDialect();
    const executor: InventoryCutoffExecutor = {
      execute: query => {
        const compiled = dialect.sqlToQuery(query);
        return client.query(compiled.sql, compiled.params);
      },
    };

    beforeAll(async () => {
      const url = new URL(source!);
      admin = new Client({ connectionString: source });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      url.pathname = `/${name}`;
      client = new Client({ connectionString: url.toString() });
      await client.connect();
      const { generateDrizzleJson, generateMigration } = createRequire(
        import.meta.url
      )("drizzle-kit/api") as typeof import("drizzle-kit/api");
      for (const statement of await generateMigration(
        generateDrizzleJson({}),
        generateDrizzleJson({ ...schema, ...financialSchema })
      ))
        await client.query(statement);

      await client.query(`
      INSERT INTO users(id,"openId",name) VALUES(1,'cutoff-fixture','Usuario simulado');
      INSERT INTO warehouses(id,code,name,"displayName") VALUES
        (10,'W10','Almacén A','W10 - Almacén A'),(20,'W20','Almacén B','W20 - Almacén B');
      INSERT INTO projects(id,code,name,"warehouseId") VALUES(1,'001','Proyecto A',10),(2,'002','Proyecto B',20);
      INSERT INTO "sapCatalog"(id,"itemCode",description,"itemGroup",unit,brand,"partNumber","tipoArticulo") VALUES
        (1,'0001','Repuesto','0101 - REPUESTOS','und','Catálogo actual','CAT-1',1),
        (2,'SVC','Servicio','SERVICIOS','global',null,null,2);
      INSERT INTO "inventoryItems"(id,"sapItemCode",name,unit,"currentStock","projectId","warehouseId","storageLocation") VALUES
        (1,'0001','Repuesto','und',5,1,10,'A1'),(2,'0001','Repuesto','und',2,1,10,null),(3,'0001','Repuesto','und',7,2,20,'B1');
      INSERT INTO "openingBalances"(id,"balanceNumber","projectId","warehouseId","createdById","openingDate")
        VALUES(1,'SI-001-00000001',1,10,1,'2026-09-01');
      INSERT INTO "openingBalanceItems"(id,"openingBalanceId","projectId","sapItemCode","itemName",quantity,unit,"storageLocation","createdAt")
        VALUES(1,1,1,'0001','Repuesto',3,'und','A1','2026-10-02');
      INSERT INTO "materialRequests"(id,"requestNumber","projectId","requestedById") VALUES(1,'REQ-001-00000001',1,1);
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","createdById") VALUES(1,'OC-001-00000001',1,1);
      INSERT INTO "purchaseOrderItems"(id,"purchaseOrderId","currentSapItemCode","originalSapItemCode","itemName",quantity,unit) VALUES
        (1,1,'0001','0001','Repuesto',10,'und'),(2,1,'SVC','SVC','Servicio',1,'global');
      INSERT INTO "transferRequests"(id,"requestNumber","projectId","destinationType","destinationProjectId","destinationWarehouseId","createdById")
        VALUES(1,'ST-001-00000001',1,'proyecto',2,20,1);
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","sapItemCode","itemName",quantity,unit)
        VALUES(1,1,1,10,'A1','0001','Repuesto',10,'und');
      INSERT INTO transfers(id,"transferNumber","transferRequestId",status) VALUES(1,'TR-001-00000001',1,'parcialmente_recibido');
      INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById",status,"receiptDate","voidedAt") VALUES
        (1,'RE-001-00000001','purchase_order',1,1,1,'completa','2026-09-10',null),
        (2,'RE-002-00000002','transfer',1,2,1,'parcial','2026-10-05',null),
        (3,'RE-001-00000003','purchase_order',1,1,1,'anulada','2026-09-15','2026-10-06'),
        (4,'RE-001-00000004','purchase_order',1,1,1,'borrador','2026-10-04',null),
        (5,'RE-001-00000005','purchase_order',1,1,1,'completa','2026-10-05',null);
      INSERT INTO "receiptItems"(id,"receiptId","sourceItemId","sapItemCode","itemName","quantityExpected","quantityReceived",unit,"warehouseId","storageLocation","receivedBrand","receivedPartNumber","createdAt") VALUES
        (1,1,1,'0001','Repuesto recibido',10,3,'und',10,'A1','Marca recibida','PARTE-REAL','2026-10-04'),
        (2,2,1,'0001','Repuesto traslado',10,2,'und',20,'B1',null,null,'2026-10-05'),
        (3,3,1,'0001','Recepción revertida',1,1,'und',10,'A1',null,null,'2026-09-25'),
        (4,4,1,'0001','Borrador copiado',9,9,'und',10,'A1',null,null,'2026-10-04'),
        (5,5,2,'SVC','Servicio',1,1,'global',null,null,null,null,'2026-10-05');
      INSERT INTO "warehouseExits"(id,"exitNumber","projectId","warehouseId","materialRequestId","createdById",status,"exitDate","emittedAt") VALUES
        (1,'SB-001-00000001',1,10,1,1,'emitida','2026-09-20','2026-10-07'),
        (2,'SB-002-00000002',2,20,1,1,'emitida','2026-10-08','2026-10-08');
      INSERT INTO "warehouseExitItems"(id,"warehouseExitId","warehouseId","sapItemCode","itemName",quantity,unit,"storageLocation",notes) VALUES
        (1,1,10,'0001','Repuesto',4,'und',null,'Referencia de línea'),(2,2,20,'0001','Repuesto',1,'und','B1',null);
      INSERT INTO "reverseLogistics"(id,"returnNumber","returnType","reasonCategory",justification,"sourceProjectId","sourceWarehouseExitId","createdById",status,"createdAt","processedAt") VALUES
        (1,'DEV-001-00000001','devolucion_bodega_proyecto','excedente','Devolución vinculada',1,1,1,'recibida','2026-10-09','2026-10-09'),
        (2,'DEV-001-00000002','devolucion_bodega_proyecto','excedente','Devolución genérica',1,null,1,'recibida','2026-10-10','2026-10-10');
      INSERT INTO "reverseLogisticsItems"(id,"reverseLogisticId","sourceWarehouseExitItemId","warehouseId","sapItemCode","itemName",quantity,unit,"createdAt") VALUES
        (1,1,1,10,'0001','Repuesto',1,'und','2026-10-09'),(2,2,null,10,'0001','Repuesto',1,'und','2026-10-10');
      INSERT INTO "inventoryItems"(id,"sapItemCode",name,unit,"currentStock","warehouseId","storageLocation")
        VALUES(4,'0001','Repuesto sin clasificar','und',1,10,'C1');
      INSERT INTO "projectWarehouseAssignments"("projectId","warehouseId") VALUES(1,10),(2,10),(2,20);
      UPDATE "materialRequests" SET status='en_proceso' WHERE id=1;
      INSERT INTO "materialRequests"(id,"requestNumber","projectId","requestedById",status) VALUES(2,'REQ-002-00000002',2,1,'en_proceso');
      INSERT INTO "requestItems"(id,"requestId","itemName",quantity,"deliveredQuantity",unit,"sapItemCode",status) VALUES
        (1,1,'Repuesto',10,3,'und','0001','parcial'),(2,2,'Repuesto',5,1,'und','0001','parcial');
      INSERT INTO "purchaseRequests"(id,"requestNumber","projectId","createdById","purchaseType",status)
        VALUES(1,'SC-001-00000001',1,1,'local','aprobada');
      INSERT INTO "purchaseRequestItems"("purchaseRequestId","itemName",quantity,"receivedQuantity",unit,"currentSapItemCode","originalSapItemCode")
        VALUES(1,'Repuesto',8,2,'und','0001','0001');
      INSERT INTO "purchaseOrderItems"(id,"purchaseOrderId","currentSapItemCode","originalSapItemCode","itemName",quantity,"receivedQuantity",unit,"receiptClosed")
        VALUES(3,1,'0001','0001','Repuesto cerrado',100,0,'und',true);
      INSERT INTO suppliers(id,"supplierCode",name) VALUES(1,'PROV-1','Proveedor simulado');
      INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId","postingDate","receiptDate","emissionDeadline")
        VALUES(1,'FT-001-00000001',1,1,1,1,'2026-10-04','2026-10-04','2026-12-31');
      INSERT INTO "reverseLogistics"(id,"returnNumber","returnType","reasonCategory",justification,"sourceProjectId","sourceReceiptId","createdById",status,"createdAt")
        VALUES(3,'DEV-001-00000003','devolucion_proveedor','excedente','Devolución a proveedor',1,1,1,'aprobada','2026-09-20');
      INSERT INTO "reverseLogisticsItems"(id,"reverseLogisticId","sourceReceiptItemId","warehouseId","sapItemCode","itemName",quantity,unit,"createdAt")
        VALUES(3,3,1,10,'0001','Repuesto',1,'und','2026-09-20');
      INSERT INTO "financialNotes"(id,type,origin,"documentNumber","projectId","supplierId",currency,"sourceInvoiceId","sourceReturnId","createdById","createdAt")
        VALUES(1,'credit','supplier_return','NC-001-00000001',1,1,'HNL',1,3,1,'2026-10-10T12:00:00Z');
      SET default_transaction_read_only = on;
    `);
    }, 60_000);

    beforeEach(async () => {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    });
    afterEach(async () => {
      await client?.query("ROLLBACK");
    });
    afterAll(async () => {
      await client?.end();
      if (created && /^buildreq_cutoff_sources_[0-9a-f]{16}$/.test(name)) {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      }
      await admin?.end();
    });

    it("executes all queries, preserves actual received details and identifies noninventory", async () => {
      const rows = await loadInventoryCutoffSources(executor, period);
      expect(rows.currentInventory).toHaveLength(4);
      expect(
        rows.receiptLines.find(row => row.receiptItemId === 1)
      ).toMatchObject({
        sapItemCode: "0001",
        quantity: "3.00",
        brand: "Marca recibida",
        partNumber: "PARTE-REAL",
        classification: "inventory",
      });
      expect(
        rows.receiptLines.find(row => row.receiptItemId === 5)
      ).toMatchObject({
        classification: "non_inventory",
        warehouseId: null,
      });
      expect(rows.receiptLines.some(row => row.receiptItemId === 4)).toBe(
        false
      );
      expect(rows.exitLines.find(row => row.exitId === 2)).toMatchObject({
        projectId: 2,
        requestProjectId: 1,
      });
    });

    it("includes outgoing transfers by source leg and blocks crossed project/warehouse legs", async () => {
      const outgoing = await loadInventoryCutoffSources(executor, {
        ...period,
        projectIds: [1],
        warehouseIds: [10],
      });
      expect(
        outgoing.receiptLines.find(row => row.receiptItemId === 2)
      ).toMatchObject({
        projectId: 2,
        warehouseId: 20,
        sourceProjectId: 1,
        sourceWarehouseId: 10,
      });
      const crossed = await loadInventoryCutoffSources(executor, {
        ...period,
        projectIds: [1],
        warehouseIds: [20],
      });
      expect(crossed.receiptLines).toEqual([]);
      expect(crossed.currentInventory).toEqual([]);
      expect(crossed.exitLines).toEqual([]);
    });

    it("loads late additions, backdated registrations and an older receipt reversed during the period", async () => {
      const rows = await loadInventoryCutoffSources(executor, period);
      expect(rows.openingLines[0]).toMatchObject({
        effectiveAt: "2026-09-01 00:00:00",
        recordedAt: "2026-10-02 00:00:00",
      });
      expect(
        rows.receiptLines.find(row => row.receiptItemId === 1)?.effectiveAt
      ).toBe("2026-09-10 00:00:00");
      expect(
        rows.receiptLines.find(row => row.receiptItemId === 3)
      ).toMatchObject({ status: "anulada", voidedAt: "2026-10-06 00:00:00" });
      expect(rows.exitLines.find(row => row.exitId === 1)).toMatchObject({
        effectiveAt: "2026-09-20 00:00:00",
        recordedAt: "2026-10-07 00:00:00",
      });
    });

    it("distinguishes an omitted exit allocation from a linked return explicitly targeting null location", async () => {
      const rows = await loadInventoryCutoffSources(executor, period);
      expect(rows.exitLines.find(row => row.exitItemId === 1)).toMatchObject({
        storageLocation: null,
        locationKnown: false,
      });
      expect(
        rows.returnLines.find(row => row.returnItemId === 1)
      ).toMatchObject({
        storageLocation: null,
        locationKnown: true,
        sourceExitLinkValid: true,
      });
      expect(
        rows.returnLines.find(row => row.returnItemId === 2)
      ).toMatchObject({
        storageLocation: null,
        locationKnown: false,
        sourceExitLinkValid: false,
      });
    });

    it("uses the stable supplier-note timestamp to load an older return without claiming a shelf allocation", async () => {
      const rows = await loadInventoryCutoffSources(executor, period);
      expect(
        rows.returnLines.find(row => row.returnItemId === 3)
      ).toMatchObject({
        returnType: "devolucion_proveedor",
        financialNoteId: 1,
        locationKnown: false,
        recordedAt: "2026-09-20 00:00:00",
      });
      expect(
        new Date(
          rows.returnLines.find(row => row.returnItemId === 3)!.noteCreatedAt!
        ).toISOString()
      ).toBe("2026-10-10T12:00:00.000Z");
    });

    it("aggregates current requirements and receipts once per article/project and uses assigned-project fallback", async () => {
      const scoped = await loadInventoryCutoffCurrentPending(executor, {
        projectIds: [1],
        warehouseIds: [10],
      });
      expect(scoped).toHaveLength(1);
      expect(scoped[0]).toEqual({
        sapItemCode: "0001",
        projectId: 1,
        warehouseId: null,
        totalRequired: "7.00",
        pendingReceipt: "16.00",
      });
      const warehouse = await loadInventoryCutoffCurrentPending(executor, {
        warehouseIds: [10],
      });
      expect(warehouse.find(row => row.projectId === null)).toEqual({
        sapItemCode: "0001",
        projectId: null,
        warehouseId: 10,
        totalRequired: "11.00",
        pendingReceipt: "16.00",
      });
    });
  }
);
