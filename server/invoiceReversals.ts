import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const errors: Record<
  string,
  {
    code: "FORBIDDEN" | "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT";
    message: string;
  }
> = {
  BR001: {
    code: "FORBIDDEN",
    message: "Solo ed_barah@hotmail.com puede revertir facturas contabilizadas",
  },
  BR002: {
    code: "BAD_REQUEST",
    message: "Ingrese un motivo de reversión de entre 5 y 2000 caracteres",
  },
  BR003: { code: "NOT_FOUND", message: "Factura no encontrada" },
  BR004: {
    code: "CONFLICT",
    message: "La factura ya no está contabilizada; actualice la pantalla",
  },
  BR005: {
    code: "BAD_REQUEST",
    message:
      "La factura tiene pagos o reservas de Tesorería y no puede revertirse",
  },
  BR006: {
    code: "BAD_REQUEST",
    message:
      "La factura tiene anticipos aplicados o amortización contractual comprometida y no puede revertirse",
  },
  BR007: {
    code: "BAD_REQUEST",
    message: "La factura tiene notas activas y no puede revertirse",
  },
  BR008: {
    code: "BAD_REQUEST",
    message:
      "La factura tiene liberaciones de calidad activas y no puede revertirse",
  },
  BR009: {
    code: "BAD_REQUEST",
    message: "La factura tiene devoluciones activas y no puede revertirse",
  },
};

export async function revertInvoiceToTreasury(
  invoiceId: number,
  actorId: number,
  reason: string
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo conectar para revertir la factura",
    });
  try {
    return await db.transaction(async tx => {
      const result = await tx.execute(
        sql`select private.revert_accounted_invoice(${invoiceId},${actorId},${reason}) as result`
      );
      return result.rows[0].result as {
        id: number;
        status: "pendiente_contabilizar";
        reversalId: number;
        voidedRetentionCount: number;
      };
    });
  } catch (error) {
    let cause: any = error;
    while (cause?.cause) cause = cause.cause;
    if (errors[cause?.code])
      throw new TRPCError({ ...errors[cause.code], cause: error });
    console.error("[Invoice reversal] Operation failed", {
      invoiceId,
      actorId,
      code: cause?.code,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "No se pudo revertir la factura. Actualice la pantalla e intente nuevamente",
      cause: error,
    });
  }
}

export async function getInvoiceReversalHistory(invoiceId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo consultar el historial de reversión",
    });
  const result = await db.execute(sql`
    select r.id,r.reason,r."createdAt",u.name "actorName",
      r."invoiceSnapshot"->>'accountedAt' "originalAccountedAt",
      count(d.id)::int "voidedRetentionCount"
    from "invoiceAccountingReversals" r join users u on u.id=r."actorId"
    left join "retentionDocuments" d on d."reversalId"=r.id
    where r."invoiceId"=${invoiceId} group by r.id,u.name order by r.id desc limit 25
  `);
  return result.rows as {
    id: number;
    reason: string;
    createdAt: Date;
    actorName: string | null;
    originalAccountedAt: string | null;
    voidedRetentionCount: number;
  }[];
}
