import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import {
  billingToday,
  getContractBillingDecision,
} from "../shared/purchase-order-billing";
import { getPurchaseOrderContractSummary } from "../shared/purchase-orders";
import * as service from "./purchaseOrderBilling";

const testUrl = process.env.PURCHASE_ORDER_BILLING_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
const central = { id: 1, role: "user", buildreqRole: "administracion_central" };
suite(
  "purchase order billing authorization: isolated PostgreSQL",
  { timeout: 30000 },
  () => {
    let client: Client, pool: Pool, database: ReturnType<typeof drizzle>;
    const today = billingToday();
    const day = (offset: number) =>
      billingToday(
        new Date(new Date(`${today}T18:00:00Z`).getTime() + offset * 86400000)
      );
    const migration = readFileSync(
      new URL(
        "../drizzle/20261102120000_purchase_order_billing_authorizations.sql",
        import.meta.url
      ),
      "utf8"
    );
    beforeAll(async () => {
      const url = new URL(testUrl!),
        token = process.env.PURCHASE_ORDER_BILLING_TEST_TOKEN;
      if (
        !token ||
        !/^[0-9a-f]{16}$/.test(token) ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== `/buildreq_billing_test_${token}`
      )
        throw new Error("Disposable local billing database required");
      client = new Client({ connectionString: testUrl });
      await client.connect();
      pool = new Pool({ connectionString: testUrl, max: 4 });
      database = drizzle(pool);
      await client.query(migration);
      await client.query(migration);
    });
    afterAll(async () => {
      await pool?.end();
      await client?.end();
    });
    beforeEach(async () => {
      await client.query(`TRUNCATE "purchaseOrderBillingAuthorizationUses","purchaseOrderBillingAuthorizations",attachments,invoices,receipts,"purchaseOrders",suppliers,projects,warehouses,users RESTART IDENTITY CASCADE;
      INSERT INTO users(id,"openId",name) VALUES(1,'billing-test','Central de prueba');
      INSERT INTO warehouses(id,code,name,"displayName") VALUES(1,'B1','Bodega de prueba','Bodega de prueba');
      INSERT INTO projects(id,code,name,"warehouseId") VALUES(1,'P1','Proyecto Uno',1),(2,'P2','Proyecto Dos',1);
      INSERT INTO suppliers(id,"supplierCode",name) VALUES(1,'S1','Proveedor de prueba');
      INSERT INTO "purchaseOrders"(id,"orderNumber","projectId","supplierId","createdById",status,"appliesContract","contractPaymentFrequency","contractFirstPaymentDate","contractEndDate") VALUES(1,'OC1',1,1,1,'recibida',true,'semanal','${day(-8)}T12:00:00','${day(-1)}T12:00:00'),(2,'OC2',2,1,1,'emitida',true,'semanal','${day(-8)}T12:00:00','${day(-1)}T12:00:00');
      INSERT INTO attachments(id,"entityType","entityId","fileName","fileKey","fileUrl",category,"uploadedById") VALUES(1,'purchase_order',1,'autorizacion.pdf','qa/auth1','/qa/auth1','otro',1),(2,'purchase_order',2,'ajeno.pdf','qa/auth2','/qa/auth2','otro',1);
      INSERT INTO receipts(id,"receiptNumber","sourceType","sourceId","projectId","receivedById") VALUES(1,'REC-ORIGINAL','purchase_order',1,1,1);
      INSERT INTO invoices(id,"invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"documentDate","postingDate","receiptDate","emissionDeadline",total,"netPayable") VALUES(1,'FT-ORIGINAL',1,1,1,1,'borrador','${day(-1)}T12:00:00',now(),now(),now(),100,100);
      SELECT setval(pg_get_serial_sequence('receipts','id'),1); SELECT setval(pg_get_serial_sequence('invoices','id'),1);`);
    });
    const grant = (
      input: Partial<
        Parameters<typeof service.grantPurchaseOrderBilling>[2]
      > = {}
    ) =>
      database.transaction(tx =>
        service.grantPurchaseOrderBilling(tx, central, {
          id: 1,
          authorizedUntil: day(30),
          additionalInvoiceCount: 1,
          maxAmount: "100.0000",
          reason: "Continuidad de obra autorizada",
          supportAttachmentId: 1,
          ...input,
        })
      );
    async function reception(amount: string) {
      return database.transaction(async tx => {
        const order = await service.lockPurchaseOrderForBilling(tx, 1);
        const count = (
          await tx.execute(
            sql`select count(*)::int n from invoices where "purchaseOrderId"=1 and status <> 'anulada'`
          )
        ).rows[0].n;
        const map = await service.getPurchaseOrderBillingMap(tx, [1]);
        const summary = getPurchaseOrderContractSummary({
          ...order,
          registeredInvoiceCount: Number(count),
          billingAuthorization: map.authorizations.get(1),
        });
        const decision = getContractBillingDecision({
          contractSummary: summary,
          contractEndDate: order.contractEndDate,
          documentDate: today,
        });
        if (!decision.allowed) throw new Error(decision.error!);
        const suffix = Math.random().toString(36).slice(2);
        const receipt = (
          await tx.execute(
            sql`insert into receipts ("receiptNumber","sourceType","sourceId","projectId","receivedById") values (${`REC-${suffix}`},'purchase_order',1,1,1) returning id`
          )
        ).rows[0];
        const invoice = (
          await tx.execute(
            sql`insert into invoices ("invoiceDocumentNumber","receiptId","purchaseOrderId","projectId","supplierId",status,"documentDate","postingDate","receiptDate","emissionDeadline",total,"netPayable") values (${`FT-${suffix}`},${receipt.id},1,1,1,'borrador',${today}::date,now(),now(),now(),${amount},${amount}) returning id`
          )
        ).rows[0];
        await service.recordPurchaseOrderBillingUse(tx, {
          authorizationId: decision.authorizationId!,
          purchaseOrderId: 1,
          invoiceId: Number(invoice.id),
          receiptId: Number(receipt.id),
          documentDate: today,
          contractEndDate: order.contractEndDate,
          contractSummary: summary,
        });
        return Number(invoice.id);
      });
    }
    it("creates a scoped authorization without changing the original contract and preserves support", async () => {
      const before = (
        await client.query(
          'select "contractEndDate","contractFirstPaymentDate","contractPaymentFrequency" from "purchaseOrders" where id=1'
        )
      ).rows[0];
      const granted = await grant();
      const state = await service.getPurchaseOrderBillingHistory(database, 1);
      expect(state.active).toMatchObject({
        id: granted.id,
        originalExpectedInvoiceCount: 2,
        maxInvoiceCount: 3,
        additionalInvoiceCount: 1,
        usedAmount: "0.0000",
        isUsable: true,
      });
      expect(
        (
          await client.query(
            'select "contractEndDate","contractFirstPaymentDate","contractPaymentFrequency" from "purchaseOrders" where id=1'
          )
        ).rows[0]
      ).toEqual(before);
      await expect(
        client.query("delete from attachments where id=1")
      ).rejects.toMatchObject({ code: "23503" });
    });
    it("rejects support from another order, unauthorized roles and unissued orders", async () => {
      await expect(grant({ supportAttachmentId: 2 })).rejects.toThrow(
        "adjunto a esta OC"
      );
      await expect(
        database.transaction(tx =>
          service.grantPurchaseOrderBilling(
            tx,
            {
              ...central,
              buildreqRole: "administrador_proyecto",
              assignedProjectId: 2,
            },
            {
              id: 1,
              authorizedUntil: day(30),
              additionalInvoiceCount: 1,
              reason: "Continuidad de obra",
              supportAttachmentId: 1,
            }
          )
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await client.query(
        `update "purchaseOrders" set status='borrador' where id=1`
      );
      await expect(grant()).rejects.toThrow("emitida");
    });
    it("denies duplicate active grants, permits only immutable revocation and preserves used documents", async () => {
      const auth = await grant();
      await expect(grant()).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        client.query(
          'update "purchaseOrderBillingAuthorizations" set "additionalInvoiceCount"=2,"maxInvoiceCount"=4 where id=$1',
          [auth.id]
        )
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        database.transaction(tx =>
          service.revokePurchaseOrderBilling(tx, central, {
            id: 2,
            authorizationId: auth.id,
            reason: "Cierre autorizado de permiso",
          })
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await reception("40.0000");
      await database.transaction(tx =>
        service.revokePurchaseOrderBilling(tx, central, {
          id: 1,
          authorizationId: auth.id,
          reason: "Cierre autorizado de permiso",
        })
      );
      expect(
        (await service.getPurchaseOrderBillingHistory(database, 1)).active
      ).toBe(null);
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderBillingAuthorizationUses"'
          )
        ).rows[0].n
      ).toBe(1);
      await expect(reception("10.0000")).rejects.toThrow(
        "total de facturas programadas"
      );
    });
    it("rolls back the receipt and invoice if it exceeds the precise amount cap", async () => {
      await grant({ maxAmount: "50.0000" });
      await expect(reception("50.0001")).rejects.toThrow(
        "saldo de la autorización"
      );
      expect(
        (await client.query("select count(*)::int n from invoices")).rows[0].n
      ).toBe(1);
      expect(
        (await client.query("select count(*)::int n from receipts")).rows[0].n
      ).toBe(1);
      await reception("50.0000");
      expect(
        (await service.getPurchaseOrderBillingHistory(database, 1)).active
          ?.remainingAmount
      ).toBe("0.0000");
    });
    it("serializes simultaneous receptions at the final invoice slot", async () => {
      await grant({ additionalInvoiceCount: 0, maxAmount: null });
      const results = await Promise.allSettled([
        reception("1.0000"),
        reception("1.0000"),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
      expect(
        (await client.query("select count(*)::int n from invoices")).rows[0].n
      ).toBe(2);
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderBillingAuthorizationUses"'
          )
        ).rows[0].n
      ).toBe(1);
    });
    it("releases only the count and captured amount of annulled invoices", async () => {
      await grant({ additionalInvoiceCount: 0, maxAmount: "50.0000" });
      const invoiceId = await reception("50.0000");
      await client.query("update invoices set status='anulada' where id=$1", [
        invoiceId,
      ]);
      expect(
        (await service.getPurchaseOrderBillingHistory(database, 1)).active
          ?.usedAmount
      ).toBe("0.0000");
      await reception("50.0000");
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderBillingAuthorizationUses"'
          )
        ).rows[0].n
      ).toBe(2);
    });
    it("prevents a normal contractual invoice from bypassing authorization by changing its date", async () => {
      await client.query('update invoices set "documentDate"=$1 where id=1', [
        day(-2),
      ]);
      await expect(
        client.query('update invoices set "documentDate"=$1 where id=1', [
          today,
        ])
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await client.query(
            'select "documentDate"::date::text as date from invoices where id=1'
          )
        ).rows[0].date
      ).toBe(day(-2));
      expect(
        (
          await client.query(
            'select count(*)::int n from "purchaseOrderBillingAuthorizationUses"'
          )
        ).rows[0].n
      ).toBe(0);
    });
    it("keeps invoice corrections inside the linked date and current amount limits after revocation", async () => {
      const auth = await grant();
      const first = await reception("40.0000");
      await client.query(
        'update invoices set "documentDate"=$1,total=60 where id=$2',
        [day(5), first]
      );
      expect(
        (await service.getPurchaseOrderBillingHistory(database, 1)).active
          ?.usedAmount
      ).toBe("60.0000");
      await expect(
        client.query('update invoices set "documentDate"=$1 where id=$2', [
          day(31),
          first,
        ])
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query('update invoices set "purchaseOrderId"=2 where id=$1', [
          first,
        ])
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query('update invoices set "receiptId"=1 where id=$1', [first])
      ).rejects.toMatchObject({ code: "23514" });
      const second = await reception("40.0000");
      await expect(
        client.query("update invoices set total=60.0001 where id=$1", [first])
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("update invoices set status='anulada' where id=$1", [
        second,
      ]);
      await client.query("update invoices set total=100 where id=$1", [first]);
      await expect(
        client.query("update invoices set status='borrador' where id=$1", [
          second,
        ])
      ).rejects.toMatchObject({ code: "23514" });
      await database.transaction(tx =>
        service.revokePurchaseOrderBilling(tx, central, {
          id: 1,
          authorizationId: auth.id,
          reason: "Cierre de autorización para nuevas recepciones",
        })
      );
      await client.query(
        'update invoices set "documentDate"=$1,total=95 where id=$2',
        [day(10), first]
      );
      expect(
        (await service.getPurchaseOrderBillingHistory(database, 1)).history[0]
          .usedAmount
      ).toBe("95.0000");
      expect(
        (
          await client.query(
            'select amount::text from "purchaseOrderBillingAuthorizationUses" where "invoiceId"=$1',
            [first]
          )
        ).rows[0].amount
      ).toBe("40.0000");
      await expect(
        client.query(
          'update "purchaseOrderBillingAuthorizationUses" set amount=95 where "invoiceId"=$1',
          [first]
        )
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("serializes concurrent amount corrections so two invoices cannot overspend one authorization", async () => {
      await grant();
      const first = await reception("40.0000"),
        second = await reception("40.0000");
      const results = await Promise.allSettled([
        pool.query("update invoices set total=60 where id=$1", [first]),
        pool.query("update invoices set total=60 where id=$1", [second]),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
      expect(
        (await service.getPurchaseOrderBillingHistory(database, 1)).active
          ?.usedAmount
      ).toBe("100.0000");
    });
    it("keeps the two tables and their sequences inaccessible to browser roles", async () => {
      for (const role of ["anon", "authenticated"]) {
        await client.query("begin");
        try {
          await client.query(`set local role ${role}`);
          await expect(
            client.query('select * from "purchaseOrderBillingAuthorizations"')
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await client.query("rollback");
        }
        const privileges = (
          await client.query(
            "select has_sequence_privilege($1,'\"purchaseOrderBillingAuthorizations_id_seq\"','USAGE') as allowed",
            [role]
          )
        ).rows[0];
        expect(privileges.allowed).toBe(false);
      }
      expect(
        (
          await client.query(
            "select count(*)::int n from pg_class where relname in ('purchaseOrderBillingAuthorizations','purchaseOrderBillingAuthorizationUses') and relrowsecurity"
          )
        ).rows[0].n
      ).toBe(2);
    });
  }
);
