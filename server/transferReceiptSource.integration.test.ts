import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  changeTransferReceiptSource,
  listTransferReceiptSources,
} from "./transferReceiptSource";
import { registerReceipt } from "./db";
import { appRouter } from "./routers";

const testUrl = process.env.TRANSFER_SOURCES_TEST_DATABASE_URL;
if (testUrl) {
  const target = new URL(testUrl);
  if (
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/buildreq_transfer_source_test"
  ) {
    throw new Error(
      "Las pruebas requieren PostgreSQL local y la base buildreq_transfer_source_test"
    );
  }
  process.env.DATABASE_URL = testUrl;
}

describe.skipIf(!testUrl)(
  "transfer receipt source selection (PostgreSQL)",
  () => {
    const pool = new Pool({ connectionString: testUrl });
    const database = drizzle(pool);
    const scope = { transferId: 93, lineId: 777, projectIds: [22] };
    const change = (inventoryItemId = 2, overrides = {}) =>
      changeTransferReceiptSource(database, {
        ...scope,
        inventoryItemId,
        actorId: 1,
        ...overrides,
      });
    const receive = (sourceId = 93, sourceItemId = 777) =>
      registerReceipt(
        { sourceType: "transfer", sourceId, projectId: 22, receivedById: 1 },
        [
          {
            sourceItemId,
            sapItemCode: "090200598",
            itemName: "FILTRO ACEITE",
            quantityExpected: "1",
            quantityReceived: "1",
            unit: "und",
            warehouseId: 23,
            storageLocation: "INGRESO",
          },
        ]
      );
    const state = async () => ({
      lines: (
        await pool.query(
          'select id,"sourceProjectId","sourceStorageLocation","receivedQuantity",notes from "transferRequestItems" order by id'
        )
      ).rows,
      stock: (
        await pool.query(
          'select id,"projectId","currentStock","storageLocation" from "inventoryItems" order by id'
        )
      ).rows,
      receipts: (await pool.query("select id,status from receipts")).rows,
    });
    const caller = (overrides = {}) =>
      appRouter.createCaller({
        user: {
          id: 1,
          role: "user",
          buildreqRole: "bodeguero_proyecto",
          assignedProjectId: 22,
          assignedProjectIds: [22],
          ...overrides,
        },
        req: { headers: {} },
        res: {},
      } as any);

    beforeAll(async () => {
      await pool.query("select 1");
    });
    afterAll(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await pool.query(`TRUNCATE users,warehouses,projects,"projectWarehouseAssignments","transferRequests","transferRequestItems",transfers,"inventoryItems",receipts,"receiptItems" RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,email,role,"buildreqRole") VALUES(1,'qa','QA','qa@example.com','admin','administracion_central');
      INSERT INTO warehouses(id,code,name,"displayName") VALUES(19,'001','LA BARCA','001 - LA BARCA'),(23,'018','ZAMORANO','018 - ZAMORANO');
      INSERT INTO projects(id,code,name,"warehouseId") VALUES(13,'001','CENTRAL',19),(14,'004','MANTENIMIENTO',19),(22,'018','ZAMORANO',23);
      INSERT INTO "projectWarehouseAssignments"("projectId","warehouseId") VALUES(13,19),(14,19),(22,23);
      INSERT INTO "transferRequests"(id,"requestNumber","projectId","destinationType","destinationProjectId","destinationWarehouseId","createdById",status) VALUES(11,'ST-018-QA',22,'proyecto',22,23,1,'convertida');
      INSERT INTO transfers(id,"transferNumber","transferRequestId",status) VALUES(93,'TR-018-QA',11,'confirmado');
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","sourceStorageLocation","itemName","sapItemCode",quantity,"receivedQuantity",unit,notes) VALUES(777,11,13,19,'4B4','FILTRO ACEITE','090200598',1,0,'und','Observación original');
      INSERT INTO "inventoryItems"(id,"sapItemCode",name,"currentStock","projectId","warehouseId","storageLocation",unit) VALUES
      (1,'090200598','FILTRO ACEITE',0,13,19,'4B4','und'),(2,'090200598','FILTRO ACEITE',1,14,19,null,'und'),
      (3,'090200598','FILTRO ACEITE',9,22,23,'OTRA BODEGA','und'),(4,'OTRO-SAP','FILTRO ACEITE',8,14,19,null,'und');
      SELECT setval(pg_get_serial_sequence('"inventoryItems"','id'),4);`);
    });

    it("offers the real stock from another project in the same warehouse", async () => {
      const result = await caller().receipts.transferSourceOptions(scope);
      expect(result.items.map(row => row.id)).toEqual([2]);
      expect(result.items[0]).toMatchObject({
        projectCode: "004",
        storageLocation: null,
        quantity: "1.00",
      });
    });

    it("receives from project 004 into 018, preserving the old stock and audit note", async () => {
      const before = await state();
      await change();
      const selected = await state();
      expect(selected.stock).toEqual(before.stock);
      expect(selected.receipts).toEqual([]);
      expect(selected.lines[0]).toMatchObject({
        sourceProjectId: 14,
        sourceStorageLocation: null,
      });
      expect(selected.lines[0].notes).toContain("Observación original");
      expect(selected.lines[0].notes).toContain(
        "Origen cambiado en recepción por usuario 1"
      );
      await receive();
      const final = await state();
      expect(final.stock.find(row => row.id === 1).currentStock).toBe("0.00");
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("0.00");
      expect(
        final.stock.find(
          row => row.projectId === 22 && row.storageLocation === "INGRESO"
        ).currentStock
      ).toBe("1.00");
      expect(final.lines[0].receivedQuantity).toBe("1.00");
      expect(final.receipts).toHaveLength(1);
    });

    it.each([1, 3, 4, 999])(
      "rejects unavailable, other warehouse, other SKU or unknown stock (%s)",
      async id => {
        const before = await state();
        await expect(change(id)).rejects.toThrow("ya no está disponible");
        expect(await state()).toEqual(before);
      }
    );

    it("rejects scope tampering for both reads and changes", async () => {
      const other = caller({ assignedProjectId: 14, assignedProjectIds: [14] });
      await expect(other.receipts.transferSourceOptions(scope)).rejects.toThrow(
        "otro proyecto"
      );
      await expect(
        other.receipts.changeTransferSource({ ...scope, inventoryItemId: 2 })
      ).rejects.toThrow("otro proyecto");
      await expect(change(2, { lineId: 888 })).rejects.toThrow("no encontrado");
    });

    it("denies non-receiving roles", async () => {
      const resident = caller({ buildreqRole: "ingeniero_residente" });
      await expect(
        resident.receipts.changeTransferSource({ ...scope, inventoryItemId: 2 })
      ).rejects.toThrow("permisos");
    });

    it.each(["recibido", "anulado", "pendiente"])(
      "rejects a transfer in state %s",
      async status => {
        await pool.query("update transfers set status=$1 where id=93", [
          status,
        ]);
        await expect(change()).rejects.toThrow("Solo puede cambiar");
      }
    );

    it("preserves the source of partially received lines", async () => {
      await pool.query(
        'update "transferRequestItems" set "receivedQuantity"=0.5 where id=777'
      );
      await expect(change()).rejects.toThrow("Solo puede cambiar");
    });

    it("protects historical receipts, including cancelled ones", async () => {
      await change();
      await receive();
      await pool.query(
        `update receipts set status='anulada'; update "transferRequestItems" set "receivedQuantity"=0; update transfers set status='confirmado'; update "inventoryItems" set "currentStock"=1 where id=2;`
      );
      await expect(change()).rejects.toThrow("origen histórico");
    });

    it("does not change return transfers", async () => {
      await pool.query('update "transferRequests" set "reverseLogisticId"=1');
      await expect(change()).rejects.toThrow("Solo puede cambiar");
    });

    it("rejects the same destination project and warehouse", async () => {
      await pool.query(
        'update "transferRequests" set "destinationProjectId"=14,"destinationWarehouseId"=19'
      );
      await expect(change(2, { projectIds: [14] })).rejects.toThrow(
        "mismos del origen"
      );
      expect(
        (
          await listTransferReceiptSources(database, {
            ...scope,
            projectIds: [14],
          })
        ).items
      ).toEqual([]);
    });

    it("rolls back the entire receipt when the chosen stock is depleted", async () => {
      await change();
      await pool.query(
        'update "inventoryItems" set "currentStock"=0 where id=2'
      );
      const before = await state();
      await expect(receive()).rejects.toThrow("Stock insuficiente");
      expect(await state()).toEqual(before);
    });

    it("does not oversell shared stock across simultaneous transfers", async () => {
      await change();
      await pool.query(`INSERT INTO "transferRequests"(id,"requestNumber","projectId","destinationType","destinationProjectId","destinationWarehouseId","createdById",status) VALUES(12,'ST-018-QA-2',22,'proyecto',22,23,1,'convertida');
      INSERT INTO transfers(id,"transferNumber","transferRequestId",status) VALUES(94,'TR-018-QA-2',12,'confirmado');
      INSERT INTO "transferRequestItems"(id,"transferRequestId","sourceProjectId","sourceWarehouseId","itemName","sapItemCode",quantity,"receivedQuantity",unit) VALUES(778,12,14,19,'FILTRO ACEITE','090200598',1,0,'und');`);
      const results = await Promise.allSettled([receive(), receive(94, 778)]);
      expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
      const final = await state();
      expect(final.stock.find(row => row.id === 2).currentStock).toBe("0.00");
      expect(final.receipts).toHaveLength(1);
      expect(
        final.lines.reduce(
          (total, row) => total + Number(row.receivedQuantity),
          0
        )
      ).toBe(1);
    });

    it("bounds and paginates source options", async () => {
      await pool.query(
        `insert into "inventoryItems"("sapItemCode",name,"currentStock","projectId","warehouseId","storageLocation") select '090200598','FILTRO ACEITE',1,14,19,'UB-'||n from generate_series(10,65) n`
      );
      const first = await listTransferReceiptSources(database, scope);
      expect(first.items).toHaveLength(50);
      const second = await listTransferReceiptSources(database, {
        ...scope,
        cursor: first.nextCursor!,
      });
      expect(second.items).toHaveLength(7);
      expect(
        new Set([...first.items, ...second.items].map(row => row.id)).size
      ).toBe(57);
    });
  }
);
