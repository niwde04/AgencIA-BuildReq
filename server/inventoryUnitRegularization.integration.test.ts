import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  applyInventoryUnitRegularization,
  InventoryUnitCommitOutcomeUnknownError,
  inspectInventoryUnitRegularization,
  inventoryUnitFingerprint,
  inventoryUnitScope,
  restoreInventoryUnitRegularization,
  type InventoryUnitResult,
  type InventoryUnitScope,
} from "./inventoryUnitRegularization";

const databaseUrl = process.env.INVENTORY_UNIT_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  const token = process.env.INVENTORY_UNIT_TEST_TOKEN;
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    !token ||
    !/^[0-9a-f]{16}$/.test(token) ||
    url.pathname !== `/buildreq_inventory_units_test_${token}`
  )
    throw new Error(
      "Las pruebas de unidad solo pueden usar la base local nueva y su token"
    );
}

describe.skipIf(!databaseUrl)(
  "inventory unit regularization: disposable PostgreSQL",
  () => {
    let client: Client;
    beforeAll(async () => {
      client = new Client({ connectionString: databaseUrl });
      await client.connect();
      // Minimal physical fixtures include real column types, unrelated columns and high precision financial values.
      await client.query(`
      CREATE TABLE "sapCatalog"(id int PRIMARY KEY,"itemCode" text UNIQUE,description text,unit text,"updatedAt" timestamp DEFAULT now());
      CREATE TABLE "inventoryItems"(id int PRIMARY KEY,"sapItemCode" text,name text,unit text,"currentStock" numeric(12,2),"minimumStock" numeric(12,2),"projectId" int,"warehouseId" int,"warehouseLocation" text,"storageLocation" text,"isActive" bool,"createdAt" timestamp DEFAULT '2026-07-08 10:42:52.812',"updatedAt" timestamp,"extraMetadata" jsonb DEFAULT '{"preserve":true}');
      CREATE TABLE "requestItems"(id int PRIMARY KEY,"requestId" int,"sapItemCode" text,unit text,quantity numeric(12,2),status text);
      CREATE TABLE "purchaseRequestItems"(id int PRIMARY KEY,"purchaseRequestId" int,"currentSapItemCode" text,"originalSapItemCode" text,unit text,quantity numeric(12,2));
      CREATE TABLE "purchaseOrderItems"(id int PRIMARY KEY,"purchaseOrderId" int,"currentSapItemCode" text,"originalSapItemCode" text,unit text,quantity numeric(12,2));
      CREATE TABLE "transferRequestItems"(id int PRIMARY KEY,"transferRequestId" int,"materialRequestItemId" int,"sapItemCode" text,unit text,quantity numeric(12,2),"receivedQuantity" numeric(12,2),"sourceProjectId" int,"sourceWarehouseId" int,"sourceStorageLocation" text);
      CREATE TABLE "receiptItems"(id int PRIMARY KEY,"receiptId" int,"sourceItemId" int,"warehouseId" int,"sapItemCode" text,"requestedSapItemCode" text,unit text,"quantityExpected" numeric(12,2),"quantityReceived" numeric(12,2));
      CREATE TABLE "warehouseExitItems"(id int PRIMARY KEY,"warehouseExitId" int,"sapItemCode" text,unit text,quantity numeric(12,2));
      CREATE TABLE "reverseLogisticsItems"(id int PRIMARY KEY,"sapItemCode" text,unit text,quantity numeric(12,2));
      CREATE TABLE "openingBalanceItems"(id int PRIMARY KEY,"sapItemCode" text,unit text,quantity numeric(12,2));
      CREATE TABLE "invoiceItems"(id int PRIMARY KEY,"invoiceId" int,"currentSapItemCode" text,"originalSapItemCode" text,unit text,quantity numeric(12,2),"unitPrice" numeric(18,8),total numeric(18,8));
      CREATE TABLE "materialRequests"(id int PRIMARY KEY,"requestNumber" text,"projectId" int,status text);
      CREATE TABLE "purchaseRequests"(id int PRIMARY KEY,"requestNumber" text,"projectId" int,status text);
      CREATE TABLE "purchaseOrders"(id int PRIMARY KEY,"orderNumber" text,"projectId" int,status text);
      CREATE TABLE "transferRequests"(id int PRIMARY KEY,"requestNumber" text,"destinationProjectId" int,"destinationWarehouseId" int);
      CREATE TABLE transfers(id int PRIMARY KEY,"transferNumber" text,"transferRequestId" int,status text);
      CREATE TABLE receipts(id int PRIMARY KEY,"receiptNumber" text,"sourceType" text,"sourceId" int,"projectId" int,status text);
      CREATE TABLE "warehouseExits"(id int PRIMARY KEY,"exitNumber" text,"projectId" int,status text);
      CREATE TABLE invoices(id int PRIMARY KEY,"invoiceDocumentNumber" text,total numeric(18,8),"accountedAt" timestamp);
    `);
    });
    afterAll(async () => {
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(
        "SELECT set_config('TimeZone','America/Tegucigalpa',false)"
      );
      await client.query(`DROP TRIGGER IF EXISTS fail_unit_regularization ON "inventoryItems";
      TRUNCATE "sapCatalog","inventoryItems","requestItems","purchaseRequestItems","purchaseOrderItems","transferRequestItems","receiptItems","warehouseExitItems","reverseLogisticsItems","openingBalanceItems","invoiceItems","materialRequests","purchaseRequests","purchaseOrders","transferRequests",transfers,receipts,"warehouseExits",invoices;
      INSERT INTO "sapCatalog"(id,"itemCode",description,unit)VALUES(14805,'010200003','ACEITE 2 TIEMPOS','gal');
      INSERT INTO "inventoryItems"(id,"sapItemCode",name,unit,"currentStock","minimumStock","projectId","warehouseId","warehouseLocation","storageLocation","isActive","updatedAt")VALUES
      (21331,'010200003','ACEITE 2 TIEMPOS','GALON',0,null,14,19,'001 - HEH LA BARCA','PISO BODEGA 1',true,'2026-10-21 11:52:29.896'),
      (21332,'010200003','ACEITE 2 TIEMPOS','GALON',0,null,22,23,'018 - EL ZAMORANO','2C1',true,'2026-10-02 21:36:45.096'),
      (21333,'010200003','ACEITE 2 TIEMPOS','GALON',0,null,24,24,'20 - HEH SAN FRANCISCO DE BECERRA',null,true,'2026-08-31 17:12:46.963'),
      (28801,'010200003','ACEITE 2 TIEMPOS','gal',2,null,14,20,'002 - HEH COMAYAGUA',null,true,'2026-10-29 23:12:22.630'),
      (30645,'010200003','ACEITE 2 TIEMPOS','und',1,null,20,31,'023 - HEH OJO DE AGUA',null,true,'2026-08-31 17:12:31.694174'),
      (31168,'010200003','ACEITE 2 TIEMPOS','gal',2,null,14,19,'001 - HEH LA BARCA',null,true,'2026-10-30 01:04:33.270'),
      (31355,'010200003','ACEITE 2 TIEMPOS','gal',3,null,22,23,'018 - EL ZAMORANO',null,true,'2026-09-24 04:31:25.945'),
      (31956,'010200003','ACEITE 2 TIEMPOS','gal',5,null,14,20,'002 - HEH COMAYAGUA','1B3',true,'2026-10-21 17:52:29.081'),
      (50000,'OTHER','OTRO','und',99,8,20,31,'023 - HEH OJO DE AGUA','OTRO',true,'2026-10-01 00:00:00');
      INSERT INTO "materialRequests" VALUES(1910,'REQ-020-00000082',24,'parcialmente_atendida');
      INSERT INTO "requestItems" VALUES(4166,1910,'010200003','und',1,'completo');
      INSERT INTO "transferRequests" VALUES(63,'ST-020-00000004',20,31);
      INSERT INTO "transferRequestItems" VALUES(234,63,4166,'010200003','und',1,1,24,24,null);
      INSERT INTO transfers VALUES(47,'TR-020-00000003',63,'parcialmente_recibido');
      INSERT INTO receipts VALUES(1503,'RE-023-00000074','transfer',47,20,'parcial');
      INSERT INTO "receiptItems" VALUES(4687,1503,234,31,'010200003',null,'und',1,1);
      INSERT INTO "purchaseRequests" VALUES(699,'SC-004-00000033',14,'parcialmente_convertida');
      INSERT INTO "purchaseRequestItems" VALUES(1339,699,'010200003','010200003','gal',54);
      INSERT INTO "purchaseOrders" VALUES(843,'OC-004-QA',14,'recibida');
      INSERT INTO "purchaseOrderItems" VALUES(1490,843,'010200003','010200003','gal',27);
      INSERT INTO "warehouseExits" VALUES(1,'SB-QA',14,'registrada');
      INSERT INTO "warehouseExitItems" VALUES(1,1,'010200003','gal',2);
      INSERT INTO invoices VALUES(752,'FT-004-00000027',1234567890.12345678,'2026-08-06 05:49:03.330');
      INSERT INTO "invoiceItems" VALUES(1353,752,'010200003','010200003','gal',27,706.69000000,1234567890.12345678);
      INSERT INTO "invoiceItems" VALUES(2000,752,'OTHER','OTHER','und',4,25.00000001,100.00000004);
    `);
    });
    const options = (scope: InventoryUnitScope = "aliases") => ({
      confirmation: inventoryUnitScope(scope).applyToken,
      actor: "QA local",
      reason: "Regularización acotada aprobada con respaldo",
      confirmOneUndIsOneGal: scope === "all",
      confirmCompatibleReaders: true,
      readerEvidence: "qa-local-lectores-verificados",
      beforeApply: async () => {},
      beforeCommit: async () => {},
    });
    const rawAll = async () =>
      (
        await client.query(
          `SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text AS rows FROM "inventoryItems" t`
        )
      ).rows[0].rows;
    const prepare = (scope: InventoryUnitScope = "aliases") =>
      inspectInventoryUnitRegularization(client, scope);
    const apply = async (scope: InventoryUnitScope = "aliases") =>
      applyInventoryUnitRegularization(
        client,
        await prepare(scope),
        options(scope)
      );
    const restore = (receipt: InventoryUnitResult) =>
      restoreInventoryUnitRegularization(client, receipt, {
        ...options(receipt.scope),
        confirmation: inventoryUnitScope(receipt.scope).restoreToken,
      });

    it("dry-run is read-only and leaves every row unchanged", async () => {
      const before = await rawAll();
      const zone = (await client.query("SHOW TimeZone")).rows[0].TimeZone;
      const plan = await prepare();
      expect(plan.classification).toBe("pending");
      expect(plan.targetIds).toEqual([21331, 21332, 21333]);
      expect(await rawAll()).toBe(before);
      expect(plan.before.timeZone).toBe(zone);
      expect((await client.query("SHOW TimeZone")).rows[0].TimeZone).toBe(zone);
      expect(
        JSON.parse(
          plan.before.inventory.find(row => JSON.parse(row).id === 30645)!
        ).updatedAt
      ).toBe("2026-08-31T17:12:31.694174");
    });
    it("exports only inventory images and minimal chain data, with server-side document hashes", async () => {
      const plan = await prepare("all");
      expect(Object.keys(JSON.parse(plan.before.catalog)).sort()).toEqual([
        "id",
        "itemCode",
        "sha256",
        "unit",
      ]);
      for (const table of [
        "purchaseRequestItems",
        "purchaseOrderItems",
        "invoiceItems",
        "purchaseRequests",
        "purchaseOrders",
        "invoices",
      ]) {
        for (const image of plan.before.documents[table]) {
          const row = JSON.parse(image);
          expect(Object.keys(row).sort()).toEqual(["id", "sha256"]);
          expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
        }
      }
      const documents = JSON.stringify(plan.before.documents);
      expect(documents).not.toContain("1234567890.12345678");
      expect(documents).not.toContain("unitPrice");
      expect(documents).not.toContain("accountedAt");
      expect(documents).not.toContain("itemName");
      expect(JSON.parse(plan.before.documents.requestItems[0]).quantity).toBe(
        1
      );
    });
    it("normalizes only the three aliases, preserving und, numbers, metadata and all documents", async () => {
      const result = await apply();
      expect(result.changedInventoryIds).toEqual([21331, 21332, 21333]);
      expect(result.physicalEquivalenceConfirmed).toBe(false);
      expect(inventoryUnitFingerprint(result.before.documents)).toBe(
        inventoryUnitFingerprint(result.after.documents)
      );
      expect(
        result.before.inventory.find(row => JSON.parse(row).id === 30645)
      ).toBe(result.after.inventory.find(row => JSON.parse(row).id === 30645));
      expect(
        (
          await client.query(
            'SELECT unit,"currentStock","minimumStock" FROM "inventoryItems" WHERE id=50000'
          )
        ).rows[0]
      ).toEqual({ unit: "und", currentStock: "99.00", minimumStock: "8.00" });
      expect(
        (
          await client.query(
            'SELECT total::text FROM "invoiceItems" WHERE id=1353'
          )
        ).rows[0].total
      ).toBe("1234567890.12345678");
    });
    it("requires confirmation and then changes all four units without changing quantities", async () => {
      const plan = await prepare("all");
      await expect(
        applyInventoryUnitRegularization(client, plan, {
          ...options("all"),
          confirmOneUndIsOneGal: false,
        })
      ).rejects.toThrow(/físicamente/);
      const result = await applyInventoryUnitRegularization(
        client,
        plan,
        options("all")
      );
      expect(result.changedInventoryIds).toEqual([21331, 21332, 21333, 30645]);
      expect(
        result.after.inventory
          .map(row => JSON.parse(row))
          .reduce((sum, row) => sum + Number(row.currentStock), 0)
      ).toBe(13);
      expect(
        new Set(result.after.inventory.map(row => JSON.parse(row).unit))
      ).toEqual(new Set(["gal"]));
      expect(inventoryUnitFingerprint(result.before.documents)).toBe(
        inventoryUnitFingerprint(result.after.documents)
      );
    });
    it("is idempotent with the same reviewed plan", async () => {
      const plan = await prepare();
      await applyInventoryUnitRegularization(client, plan, options());
      const first = await rawAll();
      const second = await applyInventoryUnitRegularization(
        client,
        plan,
        options()
      );
      expect(second.changed).toBe(false);
      expect(second.alreadyAligned).toBe(true);
      expect(second.changedInventoryIds).toEqual([]);
      expect(await rawAll()).toBe(first);
    });
    it("can apply confirmed und after a separately committed alias stage", async () => {
      await apply();
      const result = await apply("all");
      expect(result.changedInventoryIds).toEqual([30645]);
    });
    it.each([
      ['"currentStock"=2', 30645],
      ['"minimumStock"=1', 21331],
      ['"projectId"=99', 21331],
      ['"warehouseId"=99', 21331],
      ["\"storageLocation\"='OTRO'", 21331],
      ["unit='kg'", 21331],
      ['"updatedAt"=now()', 21331],
    ])("rejects stale reviewed data: %s", async (change, id) => {
      const plan = await prepare();
      await client.query(`UPDATE "inventoryItems" SET ${change} WHERE id=$1`, [
        id,
      ]);
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, options())
      ).rejects.toThrow();
      expect(await rawAll()).toBe(before);
    });
    it("rejects missing rows and altered target manifests", async () => {
      const plan = await prepare();
      const wrong = { ...plan, targetIds: [30645] };
      await expect(
        applyInventoryUnitRegularization(client, wrong, options())
      ).rejects.toThrow(/manifiesto/);
      await client.query('DELETE FROM "inventoryItems" WHERE id=21331');
      await expect(
        applyInventoryUnitRegularization(client, plan, options())
      ).rejects.toThrow(/conjunto/);
    });
    it("rejects a one-microsecond timestamp drift after preview", async () => {
      const plan = await prepare("all");
      await client.query(
        'UPDATE "inventoryItems" SET "updatedAt"="updatedAt"+interval \'1 microsecond\' WHERE id=30645'
      );
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, options("all"))
      ).rejects.toThrow(/fecha/);
      expect(await rawAll()).toBe(before);
    });
    it("rejects a changed session timezone instead of changing it implicitly", async () => {
      const plan = await prepare();
      await client.query("SELECT set_config('TimeZone','UTC',false)");
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, options())
      ).rejects.toThrow(/cambiaron desde/);
      expect(await rawAll()).toBe(before);
      expect((await client.query("SHOW TimeZone")).rows[0].TimeZone).toBe(
        "UTC"
      );
    });
    it("rolls back when durable backup fails", async () => {
      const plan = await prepare();
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, {
          ...options(),
          beforeApply: async () => {
            throw new Error("backup failed");
          },
        })
      ).rejects.toThrow("backup failed");
      expect(await rawAll()).toBe(before);
    });
    it("rolls back the first update if a later database update fails", async () => {
      const plan = await prepare();
      const before = await rawAll();
      await client.query(
        `CREATE OR REPLACE FUNCTION fail_unit_regularization_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=21332 THEN RAISE EXCEPTION 'intentional test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_unit_regularization BEFORE UPDATE ON "inventoryItems" FOR EACH ROW EXECUTE FUNCTION fail_unit_regularization_fn()`
      );
      await expect(
        applyInventoryUnitRegularization(client, plan, options())
      ).rejects.toThrow("intentional test failure");
      expect(await rawAll()).toBe(before);
    });
    it("rolls back all updates when pre-commit auditing fails", async () => {
      const plan = await prepare();
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, {
          ...options(),
          beforeCommit: async () => {
            throw new Error("audit failed");
          },
        })
      ).rejects.toThrow("audit failed");
      expect(await rawAll()).toBe(before);
    });
    it("detects and rolls back a document mutation inside an audit callback", async () => {
      const plan = await prepare();
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, {
          ...options(),
          beforeCommit: async () => {
            await client.query(
              "UPDATE \"invoiceItems\" SET unit='kg' WHERE id=1353"
            );
          },
        })
      ).rejects.toThrow(/después de preparar/);
      expect(await rawAll()).toBe(before);
      expect(
        (await client.query('SELECT unit FROM "invoiceItems" WHERE id=1353'))
          .rows[0].unit
      ).toBe("gal");
    });
    it("holds inventory row locks while the backup is being persisted", async () => {
      const plan = await prepare();
      const other = new Client({ connectionString: databaseUrl });
      await other.connect();
      try {
        await applyInventoryUnitRegularization(client, plan, {
          ...options(),
          beforeApply: async () => {
            await other.query("SET lock_timeout='150ms'");
            await expect(
              other.query(
                'UPDATE "inventoryItems" SET "currentStock"=2 WHERE id=21331'
              )
            ).rejects.toMatchObject({ code: "55P03" });
          },
        });
        expect(
          (
            await client.query(
              'SELECT "currentStock" FROM "inventoryItems" WHERE id=21331'
            )
          ).rows[0].currentStock
        ).toBe("0.00");
      } finally {
        await other.end();
      }
    });
    it("restores only the recorded unit/timestamp images and can repeat safely", async () => {
      const original = await rawAll();
      const receipt = await apply("all");
      const result = await restore(receipt);
      expect(result.changedInventoryIds).toEqual([21331, 21332, 21333, 30645]);
      expect(await rawAll()).toBe(original);
      expect((await restore(receipt)).changed).toBe(false);
    });
    it("refuses restore after subsequent stock or documentary changes", async () => {
      const receipt = await apply("all");
      await client.query(
        'UPDATE "inventoryItems" SET "currentStock"=2 WHERE id=30645'
      );
      const before = await rawAll();
      await expect(restore(receipt)).rejects.toThrow(/posteriores/);
      expect(await rawAll()).toBe(before);
    });
    it("reports an uncertain COMMIT outcome instead of claiming rollback", async () => {
      const plan = await prepare();
      const connection = {
        query: async (...args: any[]) => {
          const result = await (client.query as any).apply(client, args);
          if (args[0] === "COMMIT")
            throw new Error("simulated lost COMMIT response");
          return result;
        },
      };
      await expect(
        applyInventoryUnitRegularization(connection as any, plan, options())
      ).rejects.toBeInstanceOf(InventoryUnitCommitOutcomeUnknownError);
      expect(
        (await client.query('SELECT unit FROM "inventoryItems" WHERE id=21331'))
          .rows[0].unit
      ).toBe("gal");
    });
    it("refuses apply when protected financial data changed after the preview", async () => {
      const plan = await prepare();
      await client.query("UPDATE invoices SET total=123 WHERE id=752");
      const before = await rawAll();
      await expect(
        applyInventoryUnitRegularization(client, plan, options())
      ).rejects.toThrow(/cambiaron desde/);
      expect(await rawAll()).toBe(before);
    });
  }
);
