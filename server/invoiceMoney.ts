import { sql, type SQL } from "drizzle-orm";

/** An absent enrollment preserves the existing final-net rounding forever. */
export function invoiceSettlementPolicyExistsSql(invoiceId: SQL): SQL {
  return sql`exists(select 1 from "invoiceSettlementPolicies" settlement_policy
    where settlement_policy."invoiceId"=${invoiceId}
      and settlement_policy.version='document_cents_v1')`;
}

/**
 * Official cash payable; original invoice/receipt amounts remain four decimals.
 * A caller-supplied raw net is retained by the legacy branch (including callers
 * validating a provisional value). The document-cents branch always reads the
 * current invoice components, so legitimate NC/ND updates cannot stale a cache.
 */
export function invoiceSettlementNetSql(invoiceId: SQL, netPayable?: SQL): SQL {
  const legacyNet = netPayable ?? sql`settlement_invoice."netPayable"`;
  return sql`(select case
    when ${invoiceSettlementPolicyExistsSql(sql`settlement_invoice.id`)} then greatest(0,
      round(settlement_invoice.total,2)
      -round(settlement_invoice."retentionTotal",2)
      -round(settlement_invoice."otherRetentionTotal",2)
      -round(settlement_invoice."documentDiscountTotal",2)
      -round(settlement_invoice."creditNoteTotal",2)
      +round(settlement_invoice."debitNoteTotal",2))
    else round(${legacyNet},2) end
    from invoices settlement_invoice where settlement_invoice.id=${invoiceId})`;
}

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
      from "purchaseOrderAdvanceApplications" advance where advance."invoiceId" = ${invoiceId} and advance."applicationMode" = 'direct'), 0)
  )`;
}

/**
 * Notes retain four-decimal precision. A completed cent-rounded payment must
 * not leave a fictitious negative balance, nor enable an additional credit.
 * Real overcommitments remain negative so note transitions still reject them.
 */
export function invoiceNoteBalanceSql(invoiceId: SQL, netPayable: SQL): SQL {
  return sql`(select case
    when balance.document_cents then case
      when balance.net < 0 then balance.net
      when balance.settlement_net < balance.committed
        then balance.settlement_net - balance.committed
      when balance.settlement_net = balance.committed then 0
      -- Preserve original credit precision; transitions validate the resulting
      -- effective amount again, after the actual NC/ND totals are updated.
      else greatest(balance.net-balance.committed,0) end
    when round(balance.net, 2) >= balance.committed
      then greatest(balance.net - balance.committed, 0)
    else balance.net - balance.committed end
    from (select ${netPayable} as net,
      ${invoiceCommittedMoneySql(invoiceId)} as committed,
      ${invoiceSettlementPolicyExistsSql(invoiceId)} as document_cents,
      ${invoiceSettlementNetSql(invoiceId, netPayable)} as settlement_net) balance)`;
}
