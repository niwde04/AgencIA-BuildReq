import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

const source = process.env.INVENTORY_PENDING_TEST_DATABASE_URL;
if (source) {
  const target = new URL(source);
  const token = process.env.INVENTORY_PENDING_TEST_TOKEN;
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !token ||
    !/^[0-9a-f]{16}$/.test(token) ||
    target.pathname !== `/buildreq_inventory_pending_test_${token}`
  ) {
    throw new Error(
      "Las pruebas de pendientes requieren una base nueva local y su token"
    );
  }
  process.env.DATABASE_URL = source;
}

describe.skipIf(!source)("inventory pending persistence (PostgreSQL)", () => {
  let client: Client;
  let database: typeof import("./db");
  let appRouter: (typeof import("./routers"))["appRouter"];
  beforeAll(async () => {
    client = new Client({ connectionString: source });
    await client.connect();
    database = await import("./db");
    ({ appRouter } = await import("./routers"));
  });
  afterAll(async () => {
    await ((await database?.getDb()) as any)?.$client?.end();
    await client?.end();
  });
  beforeEach(async () => {
    await client.query(`TRUNCATE users,warehouses,projects,"projectWarehouseAssignments","warehouseUserAssignments",
      "materialRequests","requestItems","purchaseRequests","purchaseRequestItems","inventoryItems",
      "openingBalances","openingBalanceItems" RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name,role,"buildreqRole") VALUES
        (1,'inventory-admin','QA Admin','admin','administracion_central'),
        (2,'inventory-warehouse','QA Bodega','user','bodeguero_proyecto');
      INSERT INTO warehouses(id,code,name,"displayName") VALUES(10,'001','BODEGA A','001 - BODEGA A'),(20,'002','BODEGA B','002 - BODEGA B');
      INSERT INTO projects(id,code,name,"warehouseId") VALUES(1,'004','PROYECTO A',10),(2,'018','PROYECTO B',20);
      INSERT INTO "projectWarehouseAssignments"("projectId","warehouseId") VALUES(1,10),(1,20),(2,20);
      INSERT INTO "warehouseUserAssignments"("warehouseId","userId") VALUES(10,2);
      INSERT INTO "inventoryItems"(id,"sapItemCode",name,unit,"currentStock","projectId","warehouseId","storageLocation") VALUES
        (1,'SIM-OIL','ACEITE SIMULADO','GALON',0,1,10,'PISO'),
        (2,'SIM-OIL','ACEITE SIMULADO','gal',2,1,10,'A1'),
        (3,'SIM-OIL','ACEITE SIMULADO','gal',2,1,20,null),
        (4,'SIM-OIL','ACEITE SIMULADO','gal',5,1,20,'1B3'),
        (5,'SIM-OIL','ACEITE SIMULADO','gal',3,2,20,null),
        (6,'SIM-OIL','ACEITE SIMULADO','und',0,null,10,null);
      SELECT setval(pg_get_serial_sequence('"inventoryItems"','id'),6);
      INSERT INTO "materialRequests"(id,"requestNumber","projectId","requestedById",status) VALUES
        (1,'REQ-004-QA',1,1,'parcialmente_atendida'),(2,'REQ-018-QA',2,1,'parcialmente_atendida');
      INSERT INTO "requestItems"(id,"requestId","itemName",quantity,"deliveredQuantity",unit,"sapItemCode",status) VALUES
        (1,1,'ACEITE SIMULADO',54,27,'gal','SIM-OIL','parcial'),(2,2,'ACEITE SIMULADO',10,1,'gal','SIM-OIL','parcial');
      INSERT INTO "purchaseRequests"(id,"requestNumber","projectId","createdById","purchaseType",status) VALUES
        (1,'SC-004-QA',1,1,'local','parcialmente_convertida'),(2,'SC-018-QA',2,1,'local','parcialmente_convertida');
      INSERT INTO "purchaseRequestItems"("purchaseRequestId","itemName",quantity,"receivedQuantity",unit,"currentSapItemCode","originalSapItemCode") VALUES
        (1,'ACEITE SIMULADO',54,27,'gal','SIM-OIL','SIM-OIL'),(2,'ACEITE SIMULADO',10,1,'gal','SIM-OIL','SIM-OIL');`);
  });

  it("returns one project scope for multiple warehouses and shelves", async () => {
    const rows = await database.getInventoryPendingQuantitiesByItemIds([
      1, 2, 3, 4, 5,
    ]);
    expect(rows).toHaveLength(5);
    const firstProject = rows.filter(r => r.id <= 4);
    expect(new Set(firstProject.map(r => r.pendingScopeKey)).size).toBe(1);
    expect(
      firstProject.every(
        r =>
          r.totalRequiredQuantity === "27.00" &&
          r.pendingReceiptQuantity === "27.00"
      )
    ).toBe(true);
    expect(rows.find(r => r.id === 5)).toMatchObject({
      totalRequiredQuantity: "9.00",
      pendingReceiptQuantity: "9.00",
    });
    expect(rows.find(r => r.id === 5)?.pendingScopeKey).not.toBe(
      firstProject[0].pendingScopeKey
    );
  });

  it("keeps project and warehouse permission filters in the SQL selection", async () => {
    expect(
      (
        await database.getInventoryPendingQuantitiesByItemIds([1, 2, 3, 4, 5], {
          projectIds: [1],
          warehouseIds: [20],
        })
      )
        .map(r => r.id)
        .sort()
    ).toEqual([3, 4]);
    expect(
      await database.getInventoryPendingQuantitiesByItemIds([1, 2, 3, 4, 5], {
        projectIds: [],
      })
    ).toEqual([]);
    expect(
      await database.getInventoryPendingQuantitiesByItemIds([1, 2, 3, 4, 5], {
        warehouseIds: [],
      })
    ).toEqual([]);
  });

  it("filters unauthorized warehouse inventory in the actual router", async () => {
    const caller = appRouter.createCaller({
      user: {
        id: 2,
        openId: "inventory-warehouse",
        name: "QA Bodega",
        role: "user",
        buildreqRole: "bodeguero_proyecto",
        assignedProjectId: 1,
        assignedProjectIds: [1],
      },
      req: {},
      res: {},
    } as any);
    const rows = await caller.inventory.pendingQuantities({
      ids: [1, 2, 3, 4, 5],
    });
    expect(rows.map(r => r.id).sort()).toEqual([1, 2]);
    expect(rows.every(r => r.totalRequiredQuantity === "27.00")).toBe(true);
  });

  it("keeps forbidden roles outside the pending endpoint", async () => {
    const caller = appRouter.createCaller({
      user: {
        id: 2,
        openId: "inventory-engineer",
        name: "QA Engineer",
        role: "user",
        buildreqRole: "ingeniero_residente",
        assignedProjectId: 1,
        assignedProjectIds: [1],
      },
      req: {},
      res: {},
    } as any);
    await expect(
      caller.inventory.pendingQuantities({ ids: [1] })
    ).rejects.toThrow("No tiene acceso al inventario");
  });

  it("retains warehouse fallback for legacy stock without an assigned project", async () => {
    const rows = await database.getInventoryPendingQuantitiesByItemIds([1, 6]);
    expect(rows.find(r => r.id === 6)).toMatchObject({
      totalRequiredQuantity: "27.00",
      pendingReceiptQuantity: "27.00",
    });
    expect(rows[0].pendingScopeKey).not.toBe(rows[1].pendingScopeKey);
  });

  it("includes matching scope metadata in list/export data", async () => {
    const rows = await database.listInventoryItems({
      projectId: 1,
      pageSize: 200,
      includePendingQuantities: true,
    });
    expect(rows.items).toHaveLength(4);
    expect(new Set(rows.items.map(r => r.pendingScopeKey)).size).toBe(1);
    expect(
      rows.items.every(
        r =>
          r.totalRequiredQuantity === "27.00" &&
          r.pendingReceiptQuantity === "27.00"
      )
    ).toBe(true);
  });

  it("normalizes new and updated stock units without altering quantities", async () => {
    const created = await database.createInventoryItem({
      sapItemCode: "NEW-SIM",
      name: "NUEVO",
      unit: "GALON",
      currentStock: "4.00",
      projectId: 1,
      warehouseId: 10,
    });
    expect(
      (
        await client.query(
          'SELECT unit,"currentStock" FROM "inventoryItems" WHERE id=$1',
          [created.id]
        )
      ).rows[0]
    ).toEqual({ unit: "gal", currentStock: "4.00" });
    await database.updateInventoryItem(created.id, { unit: "UND." });
    expect(
      (
        await client.query(
          'SELECT unit,"currentStock" FROM "inventoryItems" WHERE id=$1',
          [created.id]
        )
      ).rows[0]
    ).toEqual({ unit: "und", currentStock: "4.00" });
    await database.updateInventoryItem(created.id, { name: "RENOMBRADO" });
    expect(
      (
        await client.query('SELECT unit FROM "inventoryItems" WHERE id=$1', [
          created.id,
        ])
      ).rows[0].unit
    ).toBe("und");
  });

  it("normalizes stock additions and kardex reads while preserving documentary units", async () => {
    await database.createOpeningBalance(
      { projectId: 1, warehouseId: 10, createdById: 1 },
      [
        {
          sapItemCode: "SIM-OIL",
          itemName: "ACEITE SIMULADO",
          quantity: "2",
          unit: "GALON",
          storageLocation: "PISO",
        },
        {
          sapItemCode: "NEW-GAL",
          itemName: "OTRO ACEITE",
          quantity: "3",
          unit: "GALON",
          storageLocation: "NUEVO",
        },
      ]
    );
    const rows = (
      await client.query(
        'SELECT "sapItemCode",unit,"currentStock" FROM "inventoryItems" WHERE id=1 OR "sapItemCode"=$1 ORDER BY id',
        ["NEW-GAL"]
      )
    ).rows;
    expect(rows).toEqual([
      { sapItemCode: "SIM-OIL", unit: "gal", currentStock: "2.00" },
      { sapItemCode: "NEW-GAL", unit: "gal", currentStock: "3.00" },
    ]);
    const kardex = await database.getInventoryKardex({
      sapItemCode: "SIM-OIL",
      projectId: 1,
      warehouseId: 10,
    });
    expect(kardex.balances.every(r => r.unit === "gal")).toBe(true);
    expect(kardex.movements).toHaveLength(1);
    expect(kardex.movements[0].unit).toBe("gal");
    expect(
      (
        await client.query('SELECT unit FROM "openingBalanceItems" ORDER BY id')
      ).rows.map(r => r.unit)
    ).toEqual(["GALON", "GALON"]);
  });
});
