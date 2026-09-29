import { sql, type SQL } from "drizzle-orm";

/** Same per-payment cent precision used by the Treasury UI and advance maps. */
export function invoiceCommittedMoneySql(invoiceId: SQL): SQL {
  return sql`(
    coalesce((select sum(case
      when payment.status = 'contabilizada' then round(coalesce(payment."bankPaidAmount", 0), 2)
      when payment."activeReservation" then round(coalesce(payment."bankPaidAmount", payment."approvedAmount", payment."requestedAmount", 0), 2)
      else 0 end)
      from "treasuryPaymentItems" payment
      where payment."invoiceId" = ${invoiceId} and payment."sourceType" = 'invoice'), 0)
    + coalesce((select sum(round(advance.amount, 2))
      from "purchaseOrderAdvanceApplications" advance where advance."invoiceId" = ${invoiceId}), 0)
  )`;
}

/**
 * Notes retain four-decimal precision. A completed cent-rounded payment must
 * not leave a fictitious negative balance, nor enable an additional credit.
 * Real overcommitments remain negative so note transitions still reject them.
 */
export function invoiceNoteBalanceSql(invoiceId: SQL, netPayable: SQL): SQL {
  return sql`(select case
    when round(balance.net, 2) >= balance.committed
      then greatest(balance.net - balance.committed, 0)
    else balance.net - balance.committed end
    from (select ${netPayable} as net,
      ${invoiceCommittedMoneySql(invoiceId)} as committed) balance)`;
}
