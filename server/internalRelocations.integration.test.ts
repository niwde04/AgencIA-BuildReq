import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const testUrl = process.env.INTERNAL_RELOCATIONS_TEST_DATABASE_URL;
if (testUrl) {
  const target = new URL(testUrl);
  const token = process.env.INTERNAL_RELOCATIONS_TEST_TOKEN;
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !token ||
    !/^[0-9a-f]{16}$/.test(token) ||
    target.pathname !== `/buildreq_internal_relocations_test_${token}`
  ) {
    throw new Error("Las pruebas requieren una base local nueva y su token");
  }
  process.env.DATABASE_URL = testUrl;
}

describe.skipIf(!testUrl)(
  "internal relocation persistence (PostgreSQL)",
  () => {
    let client: Client;
    let database: typeof import("./db");
    let appRouter: (typeof import("./routers"))["appRouter"];

    beforeAll(async () => {
      client = new Client({ connectionString: testUrl });
      await client.connect();
      database = await import("./db");
      ({ appRouter } = await import("./routers"));
    });

    afterAll(async () => {
      await ((await database?.getDb()) as any)?.$client?.end();
      await client?.end();
    });

    beforeEach(async () => {
      await client.query(`
      DROP TRIGGER IF EXISTS test_relocation_destination_failure ON "inventoryItems";
      TRUNCATE users,warehouses,projects,"projectWarehouseAssignments",
        "transferRequests","transferRequestItems",transfers,"remissionGuides","inventoryItems",
        receipts,"receiptItems" RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,email,role,"buildreqRole")
      VALUES(1,'qa-admin','QA Admin','qa-admin@example.com','admin','administracion_central'),
        (2,'qa-warehouse','QA Warehouse','qa-warehouse@example.com','user','bodeguero_proyecto');
      INSERT INTO warehouses(id,code,name,"displayName")
      VALUES(10,'001','BODEGA A','001 - BODEGA A'),(20,'002','BODEGA B','002 - BODEGA B');
      INSERT INTO projects(id,code,name,"warehouseId")
      VALUES(1,'001','PROYECTO A',10),(2,'002','PROYECTO B',20);
      INSERT INTO "projectWarehouseAssignments"("projectId","warehouseId")
      VALUES(1,10),(1,20),(2,20);
      INSERT INTO "transferRequests"(id,"requestNumber","projectId","destinationType",
        "destinationProjectId","destinationWarehouseId","createdById",status,notes)
      VALUES(11,'ST-001-QA',1,'proyecto',1,10,1,'convertida','Reubicación: ordenar estantes');
      INSERT INTO transfers(id,"transferNumber","transferRequestId",status)
      VALUES(21,'TR-001-QA',11,'confirmado');
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId",
        "sourceWarehouseId","sourceStorageLocation","itemName","sapItemCode",quantity,
        "receivedQuantity",unit)
      VALUES(31,11,1,10,'4B4','FILTRO SIMULADO','SIM-001',6,0,'und');
      INSERT INTO "inventoryItems"(id,"sapItemCode",name,"currentStock","minimumStock",
        "projectId","warehouseId","storageLocation",unit)
      VALUES(1,'SIM-001','FILTRO SIMULADO',10,3,1,10,'4B4','und'),
        (2,'SIM-001','FILTRO SIMULADO',2,null,1,10,'4B5','und'),
        (3,'SIM-001','FILTRO SIMULADO',99,null,2,20,'4B4','und'),
        (4,'OTHER-SKU','OTRO ARTICULO',88,null,1,10,'4B4','und');
      SELECT setval(pg_get_serial_sequence('"inventoryItems"','id'),4);
      SELECT setval(pg_get_serial_sequence('"transferRequests"','id'),11);
      SELECT setval(pg_get_serial_sequence('"transferRequestItems"','id'),31);
      SELECT setval(pg_get_serial_sequence('transfers','id'),21);
    `);
    });

    const caller = (override: Record<string, unknown> = {}) =>
      appRouter.createCaller({
        user: {
          id: 2,
          openId: "qa-warehouse",
          name: "QA Warehouse",
          role: "user",
          buildreqRole: "bodeguero_proyecto",
          assignedProjectId: 1,
          assignedProjectIds: [1],
          ...override,
        },
        req: { headers: {} },
        res: {},
      } as any);

    function item(
      quantity = 3,
      expected = "0.00",
      location: string | null = "4B5",
      override: Record<string, unknown> = {}
    ) {
      return {
        sourceItemId: 31,
        sapItemCode: "SIM-001",
        itemName: "FILTRO SIMULADO",
        quantityExpected: "6.00",
        quantityReceived: quantity.toFixed(2),
        expectedReceivedQuantity: expected,
        unit: "und",
        warehouseId: 10,
        storageLocation: location,
        ...override,
      };
    }

    const receive = (line = item(), sourceId = 21, projectId = 1) =>
      database.registerReceipt(
        {
          sourceType: "transfer",
          sourceId,
          projectId,
          receivedById: 2,
          postingDate: new Date("2026-11-09T12:00:00-06:00"),
          receiptDate: new Date("2026-11-09T12:00:00-06:00"),
          notes: "Recepción de reubicación QA",
        },
        [line] as any
      );

    const state = async () => ({
      stock: (
        await client.query(
          'SELECT id,"sapItemCode","projectId","warehouseId","storageLocation","currentStock","minimumStock" FROM "inventoryItems" ORDER BY id'
        )
      ).rows,
      lines: (
        await client.query(
          'SELECT id,"quantity","receivedQuantity","returnedToOriginQuantity","receiptClosed","sourceStorageLocation" FROM "transferRequestItems" ORDER BY id'
        )
      ).rows,
      transfers: (
        await client.query("SELECT id,status FROM transfers ORDER BY id")
      ).rows,
      receipts: (
        await client.query(
          'SELECT id,"sourceId","receiptNumber","receivedById",status FROM receipts ORDER BY id'
        )
      ).rows,
      receiptItems: (
        await client.query(
          'SELECT "sourceItemId","quantityReceived","warehouseId","storageLocation" FROM "receiptItems" ORDER BY id'
        )
      ).rows,
    });

    const sums = async () =>
      (
        await client.query(`SELECT coalesce(sum("currentStock"),0)::text AS stock,
    coalesce(sum("minimumStock"),0)::text AS minimum FROM "inventoryItems"
    WHERE "sapItemCode"='SIM-001' AND "projectId"=1 AND "warehouseId"=10`)
      ).rows[0];

    it("moves three units between existing locations and conserves unrelated stocks", async () => {
      const original = await state();
      const result = await receive();
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("7.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("5.00");
      expect(final.stock.filter(row => row.id >= 3)).toEqual(
        original.stock.filter(row => row.id >= 3)
      );
      expect(await sums()).toEqual({ stock: "12.00", minimum: "3.00" });
      expect(final.receipts).toHaveLength(1);
      expect(final.receipts[0]).toMatchObject({
        sourceId: 21,
        receivedById: 2,
      });
      expect(result.receiptNumber).toMatch(/^RE-/);
      expect(final.receiptItems[0]).toMatchObject({
        sourceItemId: 31,
        storageLocation: "4B5",
        quantityReceived: "3.00",
      });
    });

    it("moves all stock to a new location while preserving the aggregate minimum", async () => {
      await client.query(
        'UPDATE "transferRequestItems" SET quantity=10 WHERE id=31'
      );
      await receive(item(10, "0.00", "NEW"));
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("0.00");
      expect(
        final.stock.find(row => row.storageLocation === "NEW").currentStock
      ).toBe("10.00");
      expect(await sums()).toEqual({ stock: "12.00", minimum: "3.00" });
      expect(final.transfers[0].status).toBe("recibido");
    });

    it.each([null, "", "   "])(
      "moves an unlocated source represented as %j",
      async location => {
        await client.query(
          'UPDATE "inventoryItems" SET "storageLocation"=$1 WHERE id=1',
          [location]
        );
        await client.query(
          'UPDATE "transferRequestItems" SET "sourceStorageLocation"=null WHERE id=31'
        );
        await receive();
        expect(
          (await state()).stock.find(row => row.id === 1).currentStock
        ).toBe("7.00");
        expect(await sums()).toEqual({ stock: "12.00", minimum: "3.00" });
      }
    );

    it.each(["4B4", " 4b4 ", "", "   ", null])(
      "rejects an unchanged or unidentified destination %j atomically",
      async location => {
        const before = await state();
        await expect(receive(item(3, "0.00", location))).rejects.toThrow();
        expect(await state()).toEqual(before);
      }
    );

    it("merges case variants of an existing destination without a duplicate stock row", async () => {
      await receive(item(3, "0.00", " 4b5 "));
      const final = await state();
      expect(final.stock).toHaveLength(4);
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("5.00");
    });

    it("keeps a replayed partial receipt from consuming stock twice", async () => {
      const payload = item(2);
      await receive(payload);
      const beforeReplay = await state();
      await expect(receive(payload)).rejects.toThrow();
      expect(await state()).toEqual(beforeReplay);
      expect(beforeReplay.lines[0].receivedQuantity).toBe("2.00");
    });

    it("requires the received-quantity snapshot and rejects over-receipt", async () => {
      const before = await state();
      await expect(
        receive(item(3, "0.00", "4B5", { expectedReceivedQuantity: undefined }))
      ).rejects.toThrow();
      await expect(receive(item(7))).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("accepts successive partial receipts using the refreshed snapshot", async () => {
      await receive(item(2));
      await receive(item(4, "2.00"));
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("4.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("8.00");
      expect(final.transfers[0].status).toBe("recibido");
      expect(final.receipts).toHaveLength(2);
      expect(await sums()).toEqual({ stock: "12.00", minimum: "3.00" });
    });

    it("rejects duplicate concurrent submissions of the same partial receipt", async () => {
      const results = await Promise.allSettled([
        receive(item(2)),
        receive(item(2)),
      ]);
      expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
      const final = await state();
      expect(final.receipts).toHaveLength(1);
      expect(final.lines[0].receivedQuantity).toBe("2.00");
      expect(await sums()).toEqual({ stock: "12.00", minimum: "3.00" });
    });

    it("rejects insufficient source stock and restores the entire receipt", async () => {
      await client.query(
        'UPDATE "inventoryItems" SET "currentStock"=2 WHERE id=1'
      );
      const before = await state();
      await expect(receive()).rejects.toThrow(/Stock insuficiente/i);
      expect(await state()).toEqual(before);
    });

    it("rolls back a fault after source stock has been consumed", async () => {
      await client.query(`CREATE OR REPLACE FUNCTION test_relocation_destination_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."storageLocation"='FAIL' THEN RAISE EXCEPTION 'Injected destination failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_relocation_destination_failure BEFORE INSERT OR UPDATE ON "inventoryItems"
      FOR EACH ROW EXECUTE FUNCTION test_relocation_destination_failure();`);
      const before = await state();
      let failure: any;
      try {
        await receive(item(3, "0.00", "FAIL"));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeTruthy();
      expect(failure.cause?.message ?? failure.message).toContain(
        "Injected destination failure"
      );
      expect(await state()).toEqual(before);
    });

    it("validates combined consumption when two lines share one origin", async () => {
      await client.query(`UPDATE "transferRequestItems" SET quantity=6 WHERE id=31;
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","itemName","sapItemCode",quantity,"receivedQuantity",unit)
      VALUES(32,11,1,10,'4B4','FILTRO SIMULADO','SIM-001',6,0,'und');`);
      const before = await state();
      await expect(
        database.registerReceipt(
          {
            sourceType: "transfer",
            sourceId: 21,
            projectId: 1,
            receivedById: 2,
          },
          [item(6), item(6, "0.00", "4B5", { sourceItemId: 32 })] as any
        )
      ).rejects.toThrow(/Stock insuficiente/i);
      expect(await state()).toEqual(before);
    });

    it("rejects the same transfer line included twice in one receipt", async () => {
      const before = await state();
      await expect(
        database.registerReceipt(
          {
            sourceType: "transfer",
            sourceId: 21,
            projectId: 1,
            receivedById: 2,
          },
          [item(2), item(2)] as any
        )
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("corrects a received relocation through a new inverse transfer with its own history", async () => {
      await receive(item(3));
      await client.query(`INSERT INTO "transferRequests"(id,"requestNumber","projectId","destinationType","destinationProjectId","destinationWarehouseId","createdById",status,notes)
      VALUES(12,'ST-001-QA-INVERSE',1,'proyecto',1,10,1,'convertida','Corrección de TR-001-QA');
      INSERT INTO transfers(id,"transferNumber","transferRequestId",status) VALUES(22,'TR-001-QA-INVERSE',12,'confirmado');
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","itemName","sapItemCode",quantity,"receivedQuantity",unit)
      VALUES(32,12,1,10,'4B5','FILTRO SIMULADO','SIM-001',3,0,'und');`);
      await receive(item(3, "0.00", "4B4", { sourceItemId: 32 }), 22);
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("10.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("2.00");
      expect(final.receipts).toHaveLength(2);
      expect(final.lines.find(row => row.id === 31).receivedQuantity).toBe(
        "3.00"
      );
    });

    it("does not oversell a shared source across concurrent transfers", async () => {
      await client.query(`UPDATE "inventoryItems" SET "currentStock"=5 WHERE id=1;
      UPDATE "transferRequestItems" SET quantity=4 WHERE id=31;
      INSERT INTO "transferRequests"(id,"requestNumber","projectId","destinationType","destinationProjectId","destinationWarehouseId","createdById",status,notes)
      VALUES(12,'ST-001-QA-2',1,'proyecto',1,10,1,'convertida','Reubicación concurrente');
      INSERT INTO transfers(id,"transferNumber","transferRequestId",status) VALUES(22,'TR-001-QA-2',12,'confirmado');
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","itemName","sapItemCode",quantity,"receivedQuantity",unit)
      VALUES(32,12,1,10,'4B4','FILTRO SIMULADO','SIM-001',4,0,'und');`);
      const results = await Promise.allSettled([
        receive(item(4)),
        receive(item(4, "0.00", "4B5", { sourceItemId: 32 }), 22),
      ]);
      expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("1.00");
      expect(final.receipts).toHaveLength(1);
      expect((await sums()).stock).toBe("7.00");
    });

    it("records paired actual-quantity kardex movements per receipt, not a requested total exit", async () => {
      const before = await database.getInventoryKardex({
        sapItemCode: "SIM-001",
        projectId: 1,
        warehouseId: 10,
      });
      expect(before.movements).toEqual([]);
      const first = await receive(item(2));
      await receive(item(4, "2.00"));
      const kardex = await database.getInventoryKardex({
        sapItemCode: "SIM-001",
        projectId: 1,
        warehouseId: 10,
      });
      expect(kardex.movements).toHaveLength(4);
      expect(kardex.movements.some(row => row.type === "salida_traslado")).toBe(
        false
      );
      const firstMoves = kardex.movements.filter(
        row => row.documentNumber === first.receiptNumber
      ) as any[];
      expect(firstMoves).toHaveLength(2);
      expect(new Set(firstMoves.map(row => row.type))).toEqual(
        new Set(["reubicacion_salida", "reubicacion_entrada"])
      );
      expect(firstMoves.every(row => row.quantity === "2.00")).toBe(true);
      expect(firstMoves.every(row => row.sourceNumber === "TR-001-QA")).toBe(
        true
      );
      expect(
        firstMoves.every(
          row =>
            row.sourceStorageLocation === "4B4" &&
            row.destinationStorageLocation === "4B5"
        )
      ).toBe(true);
      expect(
        firstMoves.find(row => row.direction === "salida").storageLocation
      ).toBe("4B4");
      expect(
        firstMoves.find(row => row.direction === "entrada").storageLocation
      ).toBe("4B5");
      expect(
        new Set(firstMoves.map(row => new Date(row.date).toISOString())).size
      ).toBe(1);
      expect(
        kardex.movements.reduce(
          (sum, row) =>
            sum + (row.direction === "entrada" ? 1 : -1) * Number(row.quantity),
          0
        )
      ).toBe(0);
    });

    it("keeps ordinary inter-project transfers and their previous kardex representation", async () => {
      await client.query(
        'UPDATE "transferRequests" SET "destinationProjectId"=2,"destinationWarehouseId"=20 WHERE id=11'
      );
      const received = await receive(
        item(3, "0.00", "DEST", { warehouseId: 20 }),
        21,
        2
      );
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("7.00");
      expect(
        final.stock.find(
          row => row.projectId === 2 && row.storageLocation === "DEST"
        ).currentStock
      ).toBe("3.00");
      const sourceKardex = await database.getInventoryKardex({
        sapItemCode: "SIM-001",
        projectId: 1,
        warehouseId: 10,
      });
      expect(
        sourceKardex.movements.some(
          row => row.type === "salida_traslado" && row.quantity === "6.00"
        )
      ).toBe(true);
      const targetKardex = await database.getInventoryKardex({
        sapItemCode: "SIM-001",
        projectId: 2,
        warehouseId: 20,
      });
      expect(
        targetKardex.movements.some(
          row =>
            row.type === "recepcion_traslado" &&
            row.documentNumber === received.receiptNumber
        )
      ).toBe(true);
    });

    it("handles two-decimal inventory quantities without changing the total", async () => {
      await client.query(`UPDATE "inventoryItems" SET "currentStock"=1.25 WHERE id=1;
      UPDATE "inventoryItems" SET "currentStock"=.50 WHERE id=2;
      UPDATE "transferRequestItems" SET quantity=.75 WHERE id=31;`);
      await receive(item(0.75));
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("0.50");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("1.25");
      expect((await sums()).stock).toBe("1.75");
    });

    it("rejects a destination warehouse or project that changes an internal document's scope", async () => {
      const before = await state();
      await expect(
        receive(item(3, "0.00", "DEST", { warehouseId: 20 }))
      ).rejects.toThrow();
      await expect(receive(item(), 21, 2)).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("does not receive an internal document without its relocation reason", async () => {
      await client.query(
        "UPDATE \"transferRequests\" SET notes='  ' WHERE id=11"
      );
      const before = await state();
      await expect(receive()).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("does not mix internal relocation and inter-project movement in one document", async () => {
      await client.query(`INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","itemName","sapItemCode",quantity,"receivedQuantity",unit)
        VALUES(32,11,2,20,'4B4','FILTRO SIMULADO','SIM-001',3,0,'und');`);
      const before = await state();
      await expect(
        database.registerReceipt(
          {
            sourceType: "transfer",
            sourceId: 21,
            projectId: 1,
            receivedById: 2,
          },
          [item(3), item(3, "0.00", "4B5", { sourceItemId: 32 })] as any
        )
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("keeps requisition-linked same-scope movements prohibited", async () => {
      await client.query(
        'UPDATE "transferRequests" SET "materialRequestId"=77 WHERE id=11'
      );
      const before = await state();
      await expect(receive()).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("keeps internal source corrections within the same project and warehouse", async () => {
      const sources = await import("./transferReceiptSource");
      const db = (await database.getDb())!;
      const scope = { transferId: 21, lineId: 31, projectIds: [1] };
      const options = await sources.listTransferReceiptSources(db, scope);
      expect(new Set(options.items.map(row => row.id))).toEqual(
        new Set([1, 2])
      );
      const before = await state();
      await expect(
        sources.changeTransferReceiptSource(db, {
          ...scope,
          inventoryItemId: 3,
          actorId: 2,
        })
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
      await sources.changeTransferReceiptSource(db, {
        ...scope,
        inventoryItemId: 2,
        actorId: 2,
      });
      expect((await state()).lines[0].sourceStorageLocation).toBe("4B5");
    });

    it("preserves the historical internal source once a partial receipt exists", async () => {
      const sources = await import("./transferReceiptSource");
      await receive(item(2));
      const before = await state();
      await expect(
        sources.changeTransferReceiptSource((await database.getDb())!, {
          transferId: 21,
          lineId: 31,
          projectIds: [1],
          inventoryItemId: 2,
          actorId: 2,
        })
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("rejects a source-location snapshot made stale before the first receipt", async () => {
      const sources = await import("./transferReceiptSource");
      await sources.changeTransferReceiptSource((await database.getDb())!, {
        transferId: 21,
        lineId: 31,
        projectIds: [1],
        inventoryItemId: 2,
        actorId: 2,
      });
      const before = await state();
      await expect(
        receive(
          item(1, "0.00", "4B4", { expectedSourceStorageLocation: "4B4" })
        )
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
      await receive(
        item(1, "0.00", "4B4", { expectedSourceStorageLocation: "4B5" })
      );
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("11.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("1.00");
    });

    it("enforces project and role access through the receipt API", async () => {
      const before = await state();
      const input = {
        sourceType: "transfer" as const,
        sourceId: 21,
        projectId: 1,
        postingDate: "2026-11-09",
        receiptDate: "2026-11-09",
        items: [item()],
      };
      await expect(
        caller({
          assignedProjectId: 2,
          assignedProjectIds: [2],
        }).receipts.register(input as any)
      ).rejects.toThrow(/otro proyecto|acceso/i);
      await expect(
        caller({ buildreqRole: "ingeniero_residente" }).receipts.register(
          input as any
        )
      ).rejects.toThrow(/permisos|acceso/i);
      expect(await state()).toEqual(before);
    });

    it("receives an internal relocation through the existing authorized API", async () => {
      await caller().receipts.register({
        sourceType: "transfer",
        sourceId: 21,
        projectId: 1,
        postingDate: "2026-11-09",
        receiptDate: "2026-11-09",
        items: [item()],
      } as any);
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("7.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("5.00");
      expect(final.receipts).toHaveLength(1);
    });

    it("carries the stale source snapshot through the receipt API without dropping it", async () => {
      const sources = await import("./transferReceiptSource");
      await sources.changeTransferReceiptSource((await database.getDb())!, {
        transferId: 21,
        lineId: 31,
        projectIds: [1],
        inventoryItemId: 2,
        actorId: 2,
      });
      const before = await state();
      await expect(
        caller().receipts.register({
          sourceType: "transfer",
          sourceId: 21,
          projectId: 1,
          postingDate: "2026-11-09",
          receiptDate: "2026-11-09",
          items: [
            item(1, "0.00", "4B4", { expectedSourceStorageLocation: "4B4" }),
          ],
        } as any)
      ).rejects.toThrow();
      expect(await state()).toEqual(before);
    });

    it("uses the full independent request, confirmation and receipt API flow", async () => {
      const admin = caller({
        id: 1,
        role: "admin",
        buildreqRole: "administracion_central",
      });
      const requested = await admin.transferRequests.create({
        projectId: 1,
        destinationType: "proyecto",
        destinationProjectId: 1,
        destinationWarehouseId: 10,
        items: [
          {
            itemName: "FILTRO SIMULADO",
            sapItemCode: "SIM-001",
            unit: "und",
            quantity: "3.00",
          },
        ],
      } as any);
      const detail = (await database.getTransferRequestById(requested.id))!;
      const sourceItemId = detail.items[0].id;
      const confirmed = await admin.transferRequests.convertToTransfer({
        id: requested.id,
        relocationReason: "Ordenar estantes API",
        items: [
          {
            transferRequestItemId: sourceItemId,
            quantity: "3.00",
            sourceProjectId: 1,
            sourceWarehouseId: 10,
            sourceStorageLocation: "4B4",
          },
        ],
      } as any);
      expect((await sums()).stock).toBe("12.00");
      const reason = (
        await client.query(
          'SELECT notes,"materialRequestId" FROM "transferRequests" WHERE id=$1',
          [requested.id]
        )
      ).rows[0];
      expect(reason.notes).toContain("Ordenar estantes API");
      expect(reason.materialRequestId).toBeNull();
      await caller().receipts.register({
        sourceType: "transfer",
        sourceId: confirmed.id,
        projectId: 1,
        postingDate: "2026-11-09",
        receiptDate: "2026-11-09",
        items: [
          item(3, "0.00", "4B5", {
            sourceItemId,
            quantityExpected: "3.00",
            expectedSourceStorageLocation: "4B4",
          }),
        ],
      } as any);
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("7.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("5.00");
      expect((await sums()).stock).toBe("12.00");
    });

    it("preserves the existing restriction on who may create an independent request", async () => {
      const before = (
        await client.query(
          'SELECT count(*)::int AS count FROM "transferRequests"'
        )
      ).rows[0].count;
      await expect(
        caller().transferRequests.create({
          projectId: 1,
          destinationType: "proyecto",
          destinationProjectId: 1,
          destinationWarehouseId: 10,
          notes: "Ordenar estantes",
          items: [
            {
              itemName: "FILTRO SIMULADO",
              sapItemCode: "SIM-001",
              unit: "und",
              quantity: "3.00",
            },
          ],
        } as any)
      ).rejects.toThrow(/permisos/i);
      expect(
        (
          await client.query(
            'SELECT count(*)::int AS count FROM "transferRequests"'
          )
        ).rows[0].count
      ).toBe(before);
    });

    it("does not create an independent request in an inactive destination project", async () => {
      await client.query("UPDATE projects SET status='inactivo' WHERE id=1");
      const before = (
        await client.query(
          'SELECT count(*)::int AS count FROM "transferRequests"'
        )
      ).rows[0].count;
      const admin = caller({
        id: 1,
        role: "admin",
        buildreqRole: "administracion_central",
      });
      await expect(
        admin.transferRequests.create({
          projectId: 1,
          destinationType: "proyecto",
          destinationProjectId: 1,
          destinationWarehouseId: 10,
          notes: "Ordenar estantes",
          items: [
            {
              itemName: "FILTRO SIMULADO",
              sapItemCode: "SIM-001",
              unit: "und",
              quantity: "3.00",
            },
          ],
        } as any)
      ).rejects.toThrow(/activo/i);
      expect(
        (
          await client.query(
            'SELECT count(*)::int AS count FROM "transferRequests"'
          )
        ).rows[0].count
      ).toBe(before);
      expect((await sums()).stock).toBe("12.00");
    });

    it("confirms an independent same-scope request without moving stock", async () => {
      await client.query(
        "DELETE FROM transfers WHERE id=21; UPDATE \"transferRequests\" SET status='pendiente' WHERE id=11"
      );
      const beforeStock = (await state()).stock;
      const result = await database.createTransferFromRequest(
        11,
        1,
        [
          {
            transferRequestItemId: 31,
            quantity: "3.00",
            sourceProjectId: 1,
            sourceWarehouseId: 10,
            sourceStorageLocation: "4B4",
          },
        ],
        { relocationReason: "Cambiar al estante vecino" } as any
      );
      const final = await state();
      expect(final.stock).toEqual(beforeStock);
      expect(final.transfers).toHaveLength(1);
      expect(final.transfers[0].status).toBe("confirmado");
      expect(result.transferNumber).toMatch(/^TR-/);
      const request = (
        await client.query(
          'SELECT status,notes,"materialRequestId" FROM "transferRequests" WHERE id=11'
        )
      ).rows[0];
      expect(request.status).toBe("convertida");
      expect(request.materialRequestId).toBeNull();
      expect(request.notes).toContain("Cambiar al estante vecino");
    });

    it("can stop new internal confirmations without changing stock or documents", async () => {
      await client.query(
        "DELETE FROM transfers WHERE id=21; UPDATE \"transferRequests\" SET status='pendiente' WHERE id=11"
      );
      const before = await state();
      const previous = process.env.INTERNAL_RELOCATIONS_ENABLED;
      process.env.INTERNAL_RELOCATIONS_ENABLED = "false";
      try {
        await expect(
          database.createTransferFromRequest(
            11,
            1,
            [
              {
                transferRequestItemId: 31,
                quantity: "3.00",
                sourceProjectId: 1,
                sourceWarehouseId: 10,
                sourceStorageLocation: "4B4",
              },
            ],
            { relocationReason: "Ordenar estante" } as any
          )
        ).rejects.toThrow();
        expect(await state()).toEqual(before);
      } finally {
        if (previous === undefined)
          delete process.env.INTERNAL_RELOCATIONS_ENABLED;
        else process.env.INTERNAL_RELOCATIONS_ENABLED = previous;
      }
    });

    it("can stop new internal receipts while preserving the actual historical kardex", async () => {
      await receive(item(2));
      const before = await state();
      const previous = process.env.INTERNAL_RELOCATIONS_ENABLED;
      process.env.INTERNAL_RELOCATIONS_ENABLED = "false";
      try {
        await expect(receive(item(1, "2.00"))).rejects.toThrow();
        expect(await state()).toEqual(before);
        const kardex = await database.getInventoryKardex({
          sapItemCode: "SIM-001",
          projectId: 1,
          warehouseId: 10,
        });
        expect(kardex.movements).toHaveLength(2);
        expect(kardex.movements.every(row => row.quantity === "2.00")).toBe(
          true
        );
        expect(new Set(kardex.movements.map(row => row.type))).toEqual(
          new Set(["reubicacion_salida", "reubicacion_entrada"])
        );
      } finally {
        if (previous === undefined)
          delete process.env.INTERNAL_RELOCATIONS_ENABLED;
        else process.env.INTERNAL_RELOCATIONS_ENABLED = previous;
      }
    });

    it("serializes concurrent confirmations of one internal request", async () => {
      await client.query(
        "DELETE FROM transfers WHERE id=21; UPDATE \"transferRequests\" SET status='pendiente' WHERE id=11"
      );
      const lines = [
        {
          transferRequestItemId: 31,
          quantity: "3.00",
          sourceProjectId: 1,
          sourceWarehouseId: 10,
          sourceStorageLocation: "4B4",
        },
      ];
      const results = await Promise.allSettled([
        database.createTransferFromRequest(11, 1, lines, {
          relocationReason: "Ordenar estante",
        } as any),
        database.createTransferFromRequest(11, 1, lines, {
          relocationReason: "Ordenar estante",
        } as any),
      ]);
      expect(
        results.filter(result => result.status === "fulfilled"),
        JSON.stringify(
          results.map(result =>
            result.status === "rejected"
              ? {
                  message:
                    result.reason?.cause?.message ??
                    result.reason?.message?.slice(0, 180),
                }
              : { status: result.status }
          )
        )
      ).toHaveLength(1);
      expect(
        results.filter(result => result.status === "rejected")
      ).toHaveLength(1);
      expect((await state()).transfers).toHaveLength(1);
      expect((await sums()).stock).toBe("12.00");
    });

    it("does not change the destination using a pending request snapshot after confirmation", async () => {
      await client.query(
        "DELETE FROM transfers WHERE id=21; UPDATE \"transferRequests\" SET status='pendiente' WHERE id=11"
      );
      let transactionOpen = true;
      await client.query("BEGIN");
      try {
        await client.query(
          'SELECT id FROM "transferRequests" WHERE id=11 FOR UPDATE'
        );
        const update = caller({
          id: 1,
          role: "admin",
          buildreqRole: "administracion_central",
        })
          .transferRequests.updateDestinationWarehouse({
            id: 11,
            projectId: 1,
            warehouseId: 20,
          })
          .then(
            value => ({ value, error: undefined }),
            error => ({ value: undefined, error })
          );
        let blocked = false;
        for (let attempt = 0; attempt < 75; attempt += 1) {
          await client.query("SELECT pg_stat_clear_snapshot()");
          const waits = await client.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query ILIKE '%update%transferRequests%' LIMIT 1"
          );
          if (waits.rowCount) {
            blocked = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        await client.query(
          "UPDATE \"transferRequests\" SET status='convertida' WHERE id=11"
        );
        await client.query("COMMIT");
        transactionOpen = false;
        const result = await update;
        expect(result.error).toBeTruthy();
        expect(result.error.code).toBe("CONFLICT");
        const request = (
          await client.query(
            'SELECT status,"destinationWarehouseId" FROM "transferRequests" WHERE id=11'
          )
        ).rows[0];
        expect(request).toEqual({
          status: "convertida",
          destinationWarehouseId: 10,
        });
        expect((await sums()).stock).toBe("12.00");
      } finally {
        if (transactionOpen) await client.query("ROLLBACK");
      }
    });
  }
);
