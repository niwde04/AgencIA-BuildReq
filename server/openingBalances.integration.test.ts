import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const testUrl = process.env.OPENING_BALANCES_TEST_DATABASE_URL;
const describeDatabase = testUrl ? describe : describe.skip;

describeDatabase(
  "opening balances: project and storage location persistence",
  () => {
    let client: Client;
    let database: typeof import("./db");
    const originalUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      const url = new URL(testUrl!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/buildreq_opening_balances_test"
      ) {
        throw new Error(
          "These tests require an isolated localhost database named buildreq_opening_balances_test"
        );
      }
      process.env.DATABASE_URL = testUrl;
      client = new Client({ connectionString: testUrl });
      await client.connect();
      database = await import("./db");
    });

    afterAll(async () => {
      if (database) await ((await database.getDb()) as any)?.$client?.end();
      await client?.end();
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
    });

    beforeEach(async () => {
      await client.query(
        'TRUNCATE TABLE "openingBalances", "openingBalanceItems", "inventoryItems", "projectWarehouseAssignments", projects, warehouses, users RESTART IDENTITY CASCADE'
      );
      await client.query(`INSERT INTO users (id, "openId", name) VALUES (1, 'test-admin', 'Test Admin');
      INSERT INTO warehouses (id, code, name, "displayName", "isSharedWarehouse") VALUES
        (1, 'W1', 'Shared', 'W1 - Shared', true), (2, 'W2', 'Other', 'W2 - Other', false);
      INSERT INTO projects (id, code, name, status, "warehouseId") VALUES
        (1, '001', 'Project One', 'activo', 1), (2, '002', 'Project Two', 'activo', 1),
        (3, '003', 'Other Project', 'activo', 2), (4, '004', 'Inactive', 'inactivo', 1);
      INSERT INTO "projectWarehouseAssignments" ("projectId", "warehouseId", "isPrimary") VALUES
        (1, 1, true), (2, 1, true), (3, 2, true), (4, 1, true);`);
    });

    const item = (
      projectId = 1,
      storageLocation: string | null = "A1",
      quantity = "2"
    ) => ({
      sapItemCode: "090501425",
      itemName: "PIÑÓN",
      quantity,
      unit: "und",
      projectId,
      storageLocation,
    });
    const create = (items = [item()]) =>
      database.createOpeningBalance(
        { projectId: 1, warehouseId: 1, createdById: 1 },
        items
      );
    const stock = async () =>
      (
        await client.query(
          'SELECT "projectId", "storageLocation", "currentStock" FROM "inventoryItems" ORDER BY "projectId", "storageLocation" NULLS LAST'
        )
      ).rows;

    it("keeps the same article separated by project and location when creating and appending", async () => {
      const balance = await create([
        item(1, " A1 "),
        item(2, "A1", "3"),
        item(1, "B2", "4"),
      ]);
      await database.addOpeningBalanceItems(balance.id, [
        item(2, "A1", "5"),
        item(1, null, "1"),
      ]);
      expect(await stock()).toEqual([
        { projectId: 1, storageLocation: "A1", currentStock: "2.00" },
        { projectId: 1, storageLocation: "B2", currentStock: "4.00" },
        { projectId: 1, storageLocation: null, currentStock: "1.00" },
        { projectId: 2, storageLocation: "A1", currentStock: "8.00" },
      ]);
      const detail = await database.getOpeningBalanceById(balance.id);
      expect(detail?.items[1]).toMatchObject({
        projectId: 2,
        storageLocation: "A1",
        project: { code: "002" },
      });
    });

    it("attributes filtered lists and kardex movements to each item's project", async () => {
      const balance = await create([item(1, "A1", "2"), item(2, "B2", "3")]);
      const listed = await database.listOpeningBalances({ projectId: 2 });
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        openingBalance: { id: balance.id },
        itemCount: 1,
        totalQuantity: "3.00",
      });
      const kardex = await database.getInventoryKardex({
        sapItemCode: "090501425",
        projectId: 2,
        warehouseId: 1,
      });
      expect(kardex.movements).toHaveLength(1);
      expect(kardex.movements[0]).toMatchObject({
        type: "saldo_inicial",
        project: { id: 2 },
        quantity: "3.00",
      });
      expect(await database.listOpeningBalances({ projectIds: [] })).toEqual(
        []
      );
    });

    it("rejects projects outside the warehouse and inactive projects without partial entries", async () => {
      const balance = await create();
      for (const projectId of [3, 4, 999]) {
        await expect(
          database.addOpeningBalanceItems(balance.id, [
            item(1),
            item(projectId),
          ])
        ).rejects.toThrow();
      }
      expect(
        (await database.getOpeningBalanceById(balance.id))?.items
      ).toHaveLength(1);
      expect(await stock()).toEqual([
        { projectId: 1, storageLocation: "A1", currentStock: "2.00" },
      ]);
    });

    it("uses the header project for older clients without assigning a guessed location", async () => {
      const { projectId, storageLocation, ...legacyItem } = item();
      const balance = await database.createOpeningBalance(
        { projectId: 1, warehouseId: 1, createdById: 1 },
        [legacyItem]
      );
      expect(
        (await database.getOpeningBalanceById(balance.id))?.items[0]
      ).toMatchObject({ projectId: 1, storageLocation: null });
    });

    it("rolls back header, lines and stock when an inventory write fails", async () => {
      await client.query(`CREATE FUNCTION reject_opening_test_item() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."sapItemCode" = 'FAIL' THEN RAISE EXCEPTION 'test stock failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_opening_test BEFORE INSERT ON "inventoryItems" FOR EACH ROW EXECUTE FUNCTION reject_opening_test_item();`);
      try {
        await expect(
          create([item(), { ...item(), sapItemCode: "FAIL" }])
        ).rejects.toThrow();
        expect(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM "openingBalances"'
            )
          ).rows[0].count
        ).toBe(0);
        expect(
          (
            await client.query(
              'SELECT count(*)::int AS count FROM "openingBalanceItems"'
            )
          ).rows[0].count
        ).toBe(0);
        expect(await stock()).toEqual([]);
      } finally {
        await client.query(
          'DROP TRIGGER reject_opening_test ON "inventoryItems"; DROP FUNCTION reject_opening_test_item()'
        );
      }
    });

    it("serializes concurrent additions without losing quantities", async () => {
      const balance = await create();
      await Promise.all([
        database.addOpeningBalanceItems(balance.id, [item(1, "A1", "3")]),
        database.addOpeningBalanceItems(balance.id, [item(1, "A1", "5")]),
      ]);
      expect(await stock()).toEqual([
        { projectId: 1, storageLocation: "A1", currentStock: "10.00" },
      ]);
      expect(
        (await database.getOpeningBalanceById(balance.id))?.items
      ).toHaveLength(3);
    });

    it("suggests locations only for the selected project and warehouse", async () => {
      await create([item(1, "A1"), item(1, "B2"), item(2, "C3")]);
      expect(
        await database.listOpeningBalanceStorageLocations({
          warehouseId: 1,
          projectId: 1,
        })
      ).toEqual(["A1", "B2"]);
      expect(
        await database.listOpeningBalanceStorageLocations({
          warehouseId: 1,
          projectId: 1,
          search: "B",
        })
      ).toEqual(["B2"]);
      await expect(
        database.listOpeningBalanceStorageLocations({
          warehouseId: 1,
          projectId: 3,
        })
      ).rejects.toThrow();
    });

    it("backfills historical line projects without changing inventory or guessing locations", async () => {
      const balance = await create();
      const before = await stock();
      await client.query(
        'ALTER TABLE "openingBalanceItems" DROP COLUMN "projectId", DROP COLUMN "storageLocation"'
      );
      const migration = readFileSync(
        new URL(
          "../drizzle/0141_opening_balance_item_destinations.sql",
          import.meta.url
        ),
        "utf8"
      );
      await client.query(migration);
      await client.query(migration);
      expect(await stock()).toEqual(before);
      expect(
        (await database.getOpeningBalanceById(balance.id))?.items[0]
      ).toMatchObject({ projectId: 1, storageLocation: null });
    });
  }
);
