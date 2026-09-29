import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { calculatePurchaseOrderLineAmounts } from "../shared/purchase-orders";
const testUrl = process.env.SALES_TAXES_TEST_DATABASE_URL;
const describeDb = testUrl ? describe : describe.skip;
const migration = readFileSync(
  new URL(
    "../drizzle/20260929035318_sales_tax_financial_groups.sql",
    import.meta.url
  ),
  "utf8"
);

describeDb("sales taxes: catalog links and financial groups", () => {
  let client: Client;
  let database: typeof import("./db");
  const taxData = {
    taxCode: "tax_new",
    description: "Nuevo impuesto",
    shortLabel: "Nuevo",
    ratePercent: "7",
    taxType: "base" as const,
    fiscalCategory: "gravado" as const,
    isActive: true,
    displayOrder: 100,
    appliesToTaxCodes: [],
    note: null,
    erpCode: null,
  };
  const snapshot = [
    {
      taxCode: "isv_15",
      label: "ISV 15%",
      shortLabel: "ISV 15%",
      ratePercent: 15,
      rate: 0.15,
      taxType: "base",
      fiscalCategory: "gravado",
      baseAmount: 100,
      amount: 15,
      displayOrder: 20,
    },
  ];
  beforeAll(async () => {
    const token = process.env.SALES_TAXES_TEST_TOKEN;
    const url = new URL(testUrl!);
    if (
      !token ||
      !/^[0-9a-f]{16}$/.test(token) ||
      url.pathname !== `/buildreq_taxes_test_${token}` ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Only the local disposable sales-tax database is allowed"
      );
    process.env.DATABASE_URL = testUrl;
    client = new Client({ connectionString: testUrl });
    await client.connect();
    database = await import("./db");
    await client.query(`INSERT INTO users (id,"openId",name) VALUES (1,'tax-test','Test');
      INSERT INTO projects (id,code,name) VALUES (1,'P1','Project');
      INSERT INTO suppliers (id,"supplierCode",name) VALUES (1,'S1','Supplier');
      INSERT INTO "purchaseOrders" (id,"orderNumber","projectId","supplierId","createdById") VALUES (1,'OC-1',1,1,1);
      INSERT INTO receipts (id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES (1,'REC-1','purchase_order',1,1,1);
      INSERT INTO invoices (id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId","postingDate","receiptDate","emissionDeadline",subtotal,"taxAmount",total,"netPayable") VALUES (1,'FT-1',1,1,1,1,now(),now(),now()+interval '1 year',200,15,215,215);
      ALTER TABLE "salesTaxes" ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON "salesTaxes" FROM anon,authenticated;`);
  });
  afterAll(async () => {
    if (database) await ((await database.getDb()) as any)?.$client?.end();
    await client?.end();
  });
  beforeEach(async () => {
    await client.query(
      'DELETE FROM "invoiceItems"; DELETE FROM "receiptItems"; DELETE FROM "purchaseOrderItems"; DELETE FROM "salesTaxes"'
    );
    await client.query(
      `INSERT INTO "financialGroups" ("financialGroupCode","financialGroupDescription","codN2",nivel2,"isActive") VALUES ('FG-TAX1','Impuesto recuperable','01','Impuestos',true),('FG-TAX2','Impuesto no recuperable','01','Impuestos',true),('FG-OFF','Inactivo','01','Impuestos',false) ON CONFLICT ("financialGroupCode") DO UPDATE SET "isActive"=excluded."isActive"`
    );
    await client.query(
      `INSERT INTO "receiptItems" (id,"receiptId","itemName","quantityExpected","quantityReceived","taxCode",subtotal,"taxAmount",total,"taxBreakdown") VALUES (1,1,'Material',1,1,'isv_15',100,15,115,$1), (2,1,'Exento',1,1,'exe',100,0,100,'[]');
    `,
      [JSON.stringify(snapshot)]
    );
    await client.query(
      `INSERT INTO "invoiceItems" ("invoiceId","receiptItemId","itemName",quantity,"taxCode",subtotal,"taxAmount",total,"taxBreakdown") SELECT 1,id,"itemName",1,"taxCode",subtotal,"taxAmount",total,"taxBreakdown" FROM "receiptItems"`
    );
  });
  async function documents() {
    return (
      await client.query(
        `select jsonb_build_object('invoices',(select jsonb_agg(to_jsonb(t) order by id) from invoices t),'items',(select jsonb_agg(to_jsonb(t) order by id) from "invoiceItems" t),'receipts',(select jsonb_agg(to_jsonb(t) order by id) from "receiptItems" t)) data`
      )
    ).rows[0].data;
  }
  async function existingTax(code = "isv_15") {
    return (
      await client.query('select * from "salesTaxes" where "taxCode"=$1', [
        code,
      ])
    ).rows[0];
  }
  it("restores exact legacy codes without touching document snapshots or totals, even on repeat", async () => {
    const before = await documents();
    await client.query(migration);
    await client.query(migration);
    expect((await database.listSalesTaxes()).items.map(t => t.taxCode)).toEqual(
      ["exe", "isv_15", "isv_18", "isv_4"]
    );
    expect(
      (
        await client.query(
          'select count(*)::int n from "invoiceItems" i left join "salesTaxes" t on t."taxCode"=i."taxCode" where t.id is null'
        )
      ).rows[0].n
    ).toBe(0);
    expect(await documents()).toEqual(before);
    const beforeAmount = calculatePurchaseOrderLineAmounts({
      quantity: 1,
      unitPrice: 100,
      taxCode: "isv_15",
      taxes: [],
    });
    expect(
      calculatePurchaseOrderLineAmounts({
        quantity: 1,
        unitPrice: 100,
        taxCode: "isv_15",
        taxes: await database.getActiveSalesTaxCatalog(),
      })
    ).toEqual(beforeAmount);
  });
  it("assigns, searches, preserves omitted groups and clears only explicit null", async () => {
    await client.query(migration);
    const tax = await existingTax();
    const before = await documents();
    await database.updateSalesTax(tax.id, { financialGroupCode: "FG-TAX1" });
    expect(
      (await database.listSalesTaxes({ search: "FG-TAX1" })).items[0]
        .financialGroupDescription
    ).toBe("Impuesto recuperable");
    expect(
      (await database.listSalesTaxes({ search: "recuperable" })).total
    ).toBe(1);
    await database.updateSalesTax(tax.id, {
      description: "ISV actualizado",
      financialGroupCode: undefined,
    });
    expect((await existingTax()).financialGroupCode).toBe("FG-TAX1");
    await database.updateSalesTax(tax.id, { financialGroupCode: null });
    expect((await existingTax()).financialGroupCode).toBeNull();
    expect(await documents()).toEqual(before);
  });
  it("validates active groups atomically and preserves an already assigned inactive group", async () => {
    await client.query(migration);
    const tax = await existingTax();
    for (const financialGroupCode of ["MISSING", "FG-OFF"]) {
      await expect(
        database.updateSalesTax(tax.id, {
          description: "Should rollback",
          financialGroupCode,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        database.createSalesTax({ ...taxData, financialGroupCode })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await existingTax()).description).toBe("ISV 15%");
    expect((await database.listSalesTaxes()).total).toBe(4);
    await database.updateSalesTax(tax.id, { financialGroupCode: "FG-TAX1" });
    await client.query(
      `update "financialGroups" set "isActive"=false where "financialGroupCode"='FG-TAX1'`
    );
    await database.updateSalesTax(tax.id, {
      financialGroupCode: "FG-TAX1",
      description: "Mantener grupo",
    });
    await expect(
      client.query(
        `delete from "financialGroups" where "financialGroupCode"='FG-TAX1'`
      )
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("rejects renaming the linking code and keeps old lines tied to their own tax when new taxes are created", async () => {
    await client.query(migration);
    const tax = await existingTax();
    const before = await documents();
    await expect(
      database.updateSalesTax(tax.id, {
        taxCode: "nuevo_codigo",
        financialGroupCode: "FG-TAX1",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const added = await database.createSalesTax({
      ...taxData,
      financialGroupCode: "FG-TAX2",
    });
    expect(added.financialGroupCode).toBe("FG-TAX2");
    expect(
      (
        await client.query(
          'select distinct t."taxCode" from "invoiceItems" i join "salesTaxes" t on t."taxCode"=i."taxCode" order by 1'
        )
      ).rows
    ).toEqual([{ taxCode: "exe" }, { taxCode: "isv_15" }]);
    expect(await documents()).toEqual(before);
    expect((await existingTax()).financialGroupCode).toBeNull();
    await expect(
      database.createSalesTax({ ...taxData, taxCode: "!!!" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("does not overwrite existing rates, labels, activation or financial mapping when rerun", async () => {
    await client.query(migration);
    const tax = await existingTax();
    await database.updateSalesTax(tax.id, {
      description: "Personalizado",
      ratePercent: "12",
      isActive: false,
      financialGroupCode: "FG-TAX1",
    });
    const before = await existingTax();
    await client.query(migration);
    expect(await existingTax()).toEqual(before);
  });
  it("deactivates used taxes including receipt-only references, and leaves document links intact", async () => {
    await client.query(migration);
    const before = await documents();
    const tax = await existingTax();
    expect((await database.removeSalesTax(tax.id)).action).toBe("deactivated");
    expect(await documents()).toEqual(before);
    const added = await database.createSalesTax({
      ...taxData,
      taxCode: "receipt_only",
    });
    await client.query(
      `update "receiptItems" set "additionalTaxCodes"='["receipt_only"]' where id=1`
    );
    expect((await database.removeSalesTax(added.id)).action).toBe(
      "deactivated"
    );
    expect((await existingTax("receipt_only")).isActive).toBe(false);
  });
  it("keeps server-only RLS and grants unchanged", async () => {
    await client.query(migration);
    const row = (
      await client.query(
        `select relrowsecurity,has_table_privilege('anon','public."salesTaxes"','SELECT') anon_select,has_table_privilege('authenticated','public."salesTaxes"','UPDATE') auth_update from pg_class where oid='public."salesTaxes"'::regclass`
      )
    ).rows[0];
    expect(row).toEqual({
      relrowsecurity: true,
      anon_select: false,
      auth_update: false,
    });
    await client.query("SET ROLE authenticated");
    try {
      await expect(
        client.query('select * from "salesTaxes"')
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("RESET ROLE");
    }
  });
});
