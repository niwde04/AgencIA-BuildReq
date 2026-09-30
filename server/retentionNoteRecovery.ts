import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { noteRows, syncInvoiceRetentionNote } from "./financialNotes";
import { groupNoteRetentions, sumNoteMoney } from "../shared/financial-notes";

type RecoveryInput = {
  invoiceId: number;
  invoiceNumber: string;
  retentionCode: string;
  expectedAmount: string;
  mode: "dry-run" | "apply";
};

type SourceInvoice = {
  id: number;
  invoiceDocumentNumber: string;
  status: string;
  accountedById: number | null;
  retentionTotal: string;
};

/** Explicit maintenance operation. Never called by invoice accounting or at startup. */
export async function recoverInvoiceRetentionNote(input: RecoveryInput) {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  return db.transaction(async tx => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '30s'`);
    const [invoice] = await noteRows<SourceInvoice>(
      tx,
      sql`select id,"invoiceDocumentNumber",status,"accountedById","retentionTotal"
          from invoices where id=${input.invoiceId} for update`
    );
    if (!invoice || invoice.invoiceDocumentNumber !== input.invoiceNumber)
      throw new Error("La factura no coincide con el destino de recuperación");
    if (invoice.status !== "registrada")
      throw new Error("La factura debe estar contabilizada");

    const [existing] = await noteRows<{
      id: number;
      documentNumber: string;
      status: string;
      total: string;
    }>(
      tx,
      sql`select id,"documentNumber",status,total from "financialNotes"
          where "sourceInvoiceId"=${invoice.id} and origin='retentions' and status<>'anulada'
          for update`
    );
    if (existing)
      return {
        outcome: "already_exists" as const,
        mode: input.mode,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceDocumentNumber,
        note: existing,
      };

    const [settings] = await noteRows<{ enabled: boolean }>(
      tx,
      sql`select enabled from "financialNoteSettings" where id=1`
    );
    if (!settings?.enabled)
      throw new Error("Las nuevas operaciones de notas están deshabilitadas");
    if (!invoice.accountedById)
      throw new Error(
        "La factura no tiene responsable original de contabilización"
      );
    const [actor] = await noteRows<{ id: number }>(
      tx,
      sql`select id from users where id=${invoice.accountedById}`
    );
    if (!actor)
      throw new Error("No existe el responsable original de contabilización");

    const retentions = await noteRows<{
      retentionCatalogId: number | null;
      description: string;
      amount: string;
      code: string | null;
    }>(
      tx,
      sql`select r."retentionCatalogId",r.description,r.amount,t."taxCode" as code
        from "invoiceRetentions" r left join "taxRetentions" t on t.id=r."retentionCatalogId"
        where r."invoiceId"=${invoice.id} order by r.id`
    );
    if (
      !retentions.length ||
      retentions.some(row => row.code !== input.retentionCode)
    )
      throw new Error(
        "Las retenciones fiscales no coinciden con la recuperación autorizada"
      );
    const grouped = groupNoteRetentions(retentions);
    const amount = sumNoteMoney(grouped.map(row => row.amount));
    if (
      !grouped.length ||
      amount !== sumNoteMoney([input.expectedAmount]) ||
      amount !== sumNoteMoney([invoice.retentionTotal])
    )
      throw new Error(
        "El importe de la retención cambió; revise antes de recuperar la nota"
      );

    const fingerprint = async () => {
      const [row] = await noteRows<{ snapshot: unknown }>(
        tx,
        sql`
        select jsonb_build_object(
          'invoice',to_jsonb(i),
          'retentions',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb)
            from "invoiceRetentions" r where r."invoiceId"=i.id),
          'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb)
            from "treasuryPaymentItems" p where p."invoiceId"=i.id),
          'advances',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)
            from "purchaseOrderAdvanceApplications" a where a."invoiceId"=i.id)
        ) as snapshot from invoices i where i.id=${invoice.id}`
      );
      return createHash("sha256")
        .update(JSON.stringify(row.snapshot))
        .digest("hex");
    };
    const sourceFingerprint = await fingerprint();
    const summary = {
      mode: input.mode,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceDocumentNumber,
      amount,
      originalAccountedById: actor.id,
      sourceFingerprint,
    };
    if (input.mode === "dry-run")
      return { ...summary, outcome: "would_create" as const };

    const note = await syncInvoiceRetentionNote(tx, invoice.id, actor.id, {
      create: true,
    });
    if (!note) throw new Error("No se generó la nota de retenciones");
    const [verified] = await noteRows<{
      total: string;
      status: string;
      allocations: number;
      allocated: string;
    }>(
      tx,
      sql`select n.total,n.status,
          (select count(*)::int from "financialNoteInvoices" a where a."noteId"=n.id) as allocations,
          (select sum(a.amount)::text from "financialNoteInvoices" a
            where a."noteId"=n.id and a."invoiceId"=${invoice.id}) as allocated
          from "financialNotes" n where n.id=${note.id} and n.origin='retentions'
            and n."sourceInvoiceId"=${invoice.id}`
    );
    if (
      !verified ||
      verified.status !== "borrador" ||
      sumNoteMoney([verified.total]) !== amount ||
      verified.allocations !== 1 ||
      sumNoteMoney([verified.allocated]) !== amount
    )
      throw new Error("La nota generada no coincide con la retención");
    if ((await fingerprint()) !== sourceFingerprint)
      throw new Error(
        "La recuperación alteró la factura, retenciones, pagos o anticipos"
      );
    await tx.execute(sql`insert into "financialNoteEvents" ("noteId","actorId",action,comment)
      values (${note.id},${actor.id},'recuperada',
        ${"Recuperación técnica puntual solicitada de NC omitida por corte de fecha. Vinculada al responsable original de contabilización; sin cambios de saldo, pagos ni anticipos."})`);
    return { ...summary, outcome: "created" as const, note };
  });
}
