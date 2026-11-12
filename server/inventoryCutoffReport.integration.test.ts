import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../drizzle/schema";
import * as financialSchema from "../drizzle/financial-notes-schema";
import { cutoffDayStart, hondurasDate } from "./inventoryCutoffReconstruction";

const state = vi.hoisted(() => ({ database: undefined as any }));
vi.mock("./db", () => ({ getDb: async () => state.database }));
import {
  getInventoryCutoffMetadata,
  getInventoryCutoffReport,
} from "./inventoryCutoffReport";

const source = process.env.INVENTORY_REPORT_LOCAL_DATABASE_URL;
if (
  source &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(source).hostname)
) {
  throw new Error(
    "Inventory cutoff service integration requires an explicit local database."
  );
}
const today = hondurasDate(new Date());
const dateBefore = (days: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400_000)
    .toISOString()
    .slice(0, 10);
const legacyDay = dateBefore(1);
const baselineDay = dateBefore(4);

describe.skipIf(!source)(
  "inventory cutoff full service (isolated PostgreSQL)",
  () => {
    const name = `buildreq_cutoff_report_${randomBytes(8).toString("hex")}`;
    let admin: Client,
      client: Client,
      created = false;

    beforeAll(async () => {
      admin = new Client({ connectionString: source });
      await admin.connect();
      await admin.query(`create database "${name}"`);
      created = true;
      const target = new URL(source!);
      target.pathname = `/${name}`;
      client = new Client({ connectionString: target.toString() });
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
      set timezone='UTC';
      insert into users(id,"openId",name) values(1,'report-fixture','Usuario simulado');
      insert into warehouses(id,code,name,"displayName") values(10,'W10','Almacén A','W10 - Almacén A'),(20,'W20','Almacén B','W20 - Almacén B'),(30,'W30','Almacén oculto','W30 - Almacén oculto');
      insert into projects(id,code,name,"warehouseId") values(1,'001','Proyecto A',10),(2,'002','Proyecto B',20),(3,'003','Proyecto oculto',30);
      insert into "projectWarehouseAssignments"("projectId","warehouseId") values(1,10),(2,20),(3,30);
      insert into "sapCatalog"(id,"itemCode",description,"itemGroup",unit,brand,"partNumber","tipoArticulo") values
        (1,'0001','Repuesto real','0101 - REPUESTOS','und','Marca actual','PARTE-1',1),
        (2,'0002','Artículo con ubicación desconocida','0101 - REPUESTOS','und',null,null,1),
        (3,'0003','Artículo oculto','0101 - REPUESTOS','und',null,null,1);
      insert into "inventoryItems"(id,"sapItemCode",name,unit,"currentStock","projectId","warehouseId","storageLocation") values
        (1,'0001','Repuesto real','und',6,1,10,'A1'),(2,'0001','Repuesto real','und',4,2,20,'B1'),
        (3,'0001','Repuesto real','und',1,1,10,'C1'),(4,'0001','Repuesto real','und',2,1,10,'D1'),
        (5,'0002','Artículo con ubicación desconocida','und',3,1,10,'X1'),
        (6,'0003','Artículo oculto','und',99,3,30,'OCULTO');
      select setval(pg_get_serial_sequence('"inventoryItems"','id'),6);
      insert into "materialRequests"(id,"requestNumber","projectId","requestedById",status) values(1,'REQ-001-00000001',1,1,'en_proceso');
      insert into "requestItems"("requestId","itemName",quantity,"deliveredQuantity",unit,"sapItemCode",status) values(1,'Repuesto real',10,2,'und','0001','parcial');
      insert into "purchaseOrders"(id,"orderNumber","projectId","createdById",status) values(1,'OC-001-00000001',1,1,'emitida');
      insert into "purchaseOrderItems"("purchaseOrderId","currentSapItemCode","originalSapItemCode","itemName",quantity,"receivedQuantity",unit) values(1,'0001','0001','Repuesto real',8,1,'und');
      insert into "transferRequests"(id,"requestNumber","projectId","destinationType","destinationProjectId","destinationWarehouseId","createdById") values(1,'ST-001-00000001',1,'proyecto',2,20,1);
      insert into "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","sapItemCode","itemName",quantity,unit) values(1,1,1,10,'A1','0001','Repuesto real',4,'und');
      insert into transfers(id,"transferNumber","transferRequestId",status) values(1,'TR-001-00000001',1,'recibido');
    `);
      const firstReceiptAt = `${legacyDay}T18:00:00Z`;
      const boundaryAt = cutoffDayStart(today);
      await client.query(
        `insert into receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById",status,"receiptDate") values
      (1,'RE-002-00000001','transfer',1,2,1,'parcial',$1),(2,'RE-002-00000002','transfer',1,2,1,'completa',$2)`,
        [firstReceiptAt, boundaryAt]
      );
      await client.query(
        `insert into "receiptItems"(id,"receiptId","sourceItemId","sapItemCode","itemName","quantityExpected","quantityReceived",unit,"warehouseId","storageLocation","createdAt") values
      (1,1,1,'0001','Repuesto real',4,3,'und',20,'B1',$1),(2,2,1,'0001','Repuesto real',1,1,'und',20,'B1',$2)`,
        [firstReceiptAt, boundaryAt]
      );
      await client.query(
        `insert into "warehouseExits"(id,"exitNumber","projectId","warehouseId","createdById",status,"exitDate","emittedAt") values(1,'SB-001-00000001',1,10,1,'emitida',$1,$1)`,
        [`${legacyDay}T19:00:00Z`]
      );
      await client.query(
        `insert into "warehouseExitItems"(id,"warehouseExitId","warehouseId","sapItemCode","itemName",quantity,unit,"storageLocation") values(1,1,10,'0002','Artículo con ubicación desconocida',2,'und',null)`
      );
      await client.query(
        readFileSync(
          new URL(
            "../drizzle/20261112170000_inventory_cutoff_report.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      const baseline = [
        {
          id: 1,
          sapItemCode: "0001",
          name: "Repuesto real",
          unit: "und",
          currentStock: "10.00",
          projectId: 1,
          warehouseId: 10,
          storageLocation: "A1",
          isActive: true,
        },
        {
          id: 2,
          sapItemCode: "0001",
          name: "Repuesto real",
          unit: "und",
          currentStock: "0.00",
          projectId: 2,
          warehouseId: 20,
          storageLocation: "B1",
          isActive: true,
        },
        {
          id: 3,
          sapItemCode: "0001",
          name: "Repuesto real",
          unit: "und",
          currentStock: "1.00",
          projectId: 1,
          warehouseId: 10,
          storageLocation: "C1",
          isActive: true,
        },
        {
          id: 4,
          sapItemCode: "0001",
          name: "Repuesto real",
          unit: "und",
          currentStock: "2.00",
          projectId: 1,
          warehouseId: 10,
          storageLocation: "D1",
          isActive: true,
        },
        {
          id: 5,
          sapItemCode: "0002",
          name: "Artículo con ubicación desconocida",
          unit: "und",
          currentStock: "5.00",
          projectId: 1,
          warehouseId: 10,
          storageLocation: "X1",
          isActive: true,
        },
        {
          id: 6,
          sapItemCode: "0003",
          name: "Artículo oculto",
          unit: "und",
          currentStock: "99.00",
          projectId: 3,
          warehouseId: 30,
          storageLocation: "OCULTO",
          isActive: true,
        },
      ];
      const snapshot = await client.query(
        `insert into "inventoryReportSnapshots"("sourceKey","sourceHash","capturedAt",kind,"rowsCount",metadata) values('cloud-backup-local-fixture',$1,$2,'backup',6,$3) returning id`,
        [
          "c".repeat(64),
          cutoffDayStart(baselineDay),
          {
            earliestOfferedDay: baselineDay,
            captureStartedAt: cutoffDayStart(baselineDay),
            approximate: false,
          },
        ]
      );
      await client.query(
        `insert into "inventoryReportSnapshotRows"("snapshotId","inventoryItemId","rowData") select $1,(x->>'id')::int,x from jsonb_array_elements($2::jsonb) x`,
        [snapshot.rows[0].id, JSON.stringify(baseline)]
      );
      state.database = drizzle(client);
    }, 60_000);

    afterAll(async () => {
      state.database = undefined;
      await client?.end();
      if (created && /^buildreq_cutoff_report_[0-9a-f]{16}$/.test(name))
        await admin.query(`drop database "${name}" with(force)`);
      await admin?.end();
    });

    it("identifies source coverage and rejects dates before the verified baseline", async () => {
      await expect(getInventoryCutoffMetadata()).resolves.toMatchObject({
        ready: true,
        earliestDate: baselineDay,
        today,
      });
      await expect(
        getInventoryCutoffReport({ cutoffDate: dateBefore(5) }, {})
      ).rejects.toThrow("Hay información disponible desde");
    });

    it("reconstructs known transfer legs while excluding the exact next-day boundary", async () => {
      const report = await getInventoryCutoffReport(
        { cutoffDate: legacyDay },
        {}
      );
      expect(report.coverage.kind).toBe("documentary_partial");
      expect(
        report.inventory.find(
          row => row.sapItemCode === "0001" && row.storageLocation === "A1"
        )
      ).toMatchObject({ stock: 7, coverage: "documentary" });
      expect(
        report.inventory.find(
          row => row.sapItemCode === "0001" && row.storageLocation === "B1"
        )
      ).toMatchObject({ stock: 3, coverage: "documentary" });
      expect(report.entries.map(row => row.receiptNumber)).toEqual([
        "RE-002-00000001",
      ]);
      expect(
        report.exits.find(row => row.exitNumber === "RE-002-00000001")?.quantity
      ).toBe(3);
      expect(
        report.entries.some(row => row.receiptNumber === "RE-002-00000002")
      ).toBe(false);
      expect(
        report.inventory.every(
          row => row.totalRequired === null && row.pendingReceipt === null
        )
      ).toBe(true);
    });

    it("returns unavailable legacy stock instead of a fabricated allocation or numeric zero", async () => {
      const report = await getInventoryCutoffReport(
        { cutoffDate: legacyDay },
        { projectIds: [1], warehouseIds: [10] }
      );
      expect(
        report.inventory.find(row => row.sapItemCode === "0002")
      ).toMatchObject({ stock: null, coverage: "unavailable" });
      expect(
        report.exits.find(row => row.exitNumber === "SB-001-00000001")
      ).toMatchObject({ storageLocation: "Ubicación histórica no registrada" });
      expect(
        report.inventory.some(
          row =>
            row.storageLocation === "OCULTO" ||
            row.projectLabel.includes("Proyecto B")
        )
      ).toBe(false);
      expect(
        report.entries.some(row => row.projectLabel.includes("Proyecto B"))
      ).toBe(false);
      expect(
        report.exits.some(row => row.exitNumber === "RE-002-00000001")
      ).toBe(true);
      const denied = await getInventoryCutoffReport(
        { cutoffDate: legacyDay },
        { projectIds: [], warehouseIds: [] }
      );
      expect(denied.inventory).toEqual([]);
      expect(denied.entries).toEqual([]);
      expect(denied.exits).toEqual([]);
    });

    it("uses recorded current balances and counts current commercial pending only once across locations", async () => {
      const report = await getInventoryCutoffReport(
        { cutoffDate: today },
        { projectIds: [1], warehouseIds: [10] }
      );
      expect(report.coverage.kind).toBe("recorded");
      expect(
        report.inventory.find(
          row => row.sapItemCode === "0001" && row.storageLocation === "A1"
        )
      ).toMatchObject({ stock: 6, coverage: "recorded" });
      expect(
        report.inventory.find(row => row.sapItemCode === "0002")
      ).toMatchObject({ stock: 3, coverage: "recorded" });
      const article = report.inventory.filter(
        row => row.sapItemCode === "0001"
      );
      expect(article).toHaveLength(3);
      expect(
        article.reduce((total, row) => total + (row.totalRequired ?? 0), 0)
      ).toBe(8);
      expect(
        article.reduce((total, row) => total + (row.pendingReceipt ?? 0), 0)
      ).toBe(7);
      expect(article.filter(row => row.pendingReferenceOnly)).toHaveLength(2);
    });

    it("applies insert/delete/reclassification history and never exposes the opposite scoped leg", async () => {
      await client.query(`begin;
      update "inventoryItems" set "projectId"=2,"warehouseId"=20,"storageLocation"='Z1' where id=1;
      delete from "inventoryItems" where id=3;
      insert into "inventoryItems"("sapItemCode",name,unit,"currentStock","projectId","warehouseId","storageLocation") values('0001','Repuesto real','und',9,2,20,'Z1');
      commit;
      select pg_sleep(0.003)`);
      const origin = await getInventoryCutoffReport(
        { cutoffDate: today },
        { projectIds: [1], warehouseIds: [10] }
      );
      expect(
        origin.inventory
          .filter(row => row.sapItemCode === "0001")
          .map(row => row.storageLocation)
      ).toEqual(["D1"]);
      expect(
        origin.inventory.some(
          row =>
            row.storageLocation === "Z1" || row.storageLocation === "OCULTO"
        )
      ).toBe(false);
      const destination = await getInventoryCutoffReport(
        { cutoffDate: today },
        { projectIds: [2], warehouseIds: [20] }
      );
      expect(
        destination.inventory.find(row => row.storageLocation === "Z1")
      ).toMatchObject({ stock: 15, coverage: "recorded" });
      expect(
        destination.inventory.some(
          row =>
            row.storageLocation === "D1" ||
            row.sapItemCode === "0002" ||
            row.storageLocation === "OCULTO"
        )
      ).toBe(false);
    });
  }
);
