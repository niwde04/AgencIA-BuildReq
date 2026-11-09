import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { SystemInvoiceTreasuryPayment } from "@shared/system-workbook-report";
import {
  purchaseOrderAdvanceApplications,
  purchaseOrderAdvances,
  treasuryPaymentBatches,
  treasuryPaymentItems,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getTreasuryInvoiceReportPayments } from "./treasury";

function paymentTime(payment: SystemInvoiceTreasuryPayment) {
  const value = payment.paidDate;
  const time =
    value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function bankCalendarDate(value: SystemInvoiceTreasuryPayment["paidDate"]) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? value.toISOString().slice(0, 10)
      : null;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value))
    ? value.slice(0, 10)
    : null;
}

// Report-only metadata. Advance amounts must never enter the payment map used
// to calculate balances: those balances already include applied advances.
// An advance can fund several invoices; these are its posted bank references,
// not an allocation of each disbursement to an invoice. Applications can grow
// without changing appliedAt, so that date cannot bound the linked payments.
export async function getInvoiceReportPaymentMetadata(invoiceIds: number[]) {
  const result = new Map<number, SystemInvoiceTreasuryPayment[]>();
  const uniqueIds = Array.from(new Set(invoiceIds));
  if (uniqueIds.length === 0) return result;

  const database = await getDb();
  if (!database) return result;

  const [directPayments, advancePayments] = await Promise.all([
    getTreasuryInvoiceReportPayments(uniqueIds),
    database
      .select({
        invoiceId: purchaseOrderAdvanceApplications.invoiceId,
        batchNumber: treasuryPaymentBatches.batchNumber,
        bankReference: treasuryPaymentItems.bankReference,
        paidDate: sql<
          string | null
        >`${treasuryPaymentItems.bankPaidDate}::text`,
      })
      .from(purchaseOrderAdvanceApplications)
      .innerJoin(
        purchaseOrderAdvances,
        eq(
          purchaseOrderAdvances.id,
          purchaseOrderAdvanceApplications.purchaseOrderAdvanceId
        )
      )
      .innerJoin(
        treasuryPaymentItems,
        eq(
          treasuryPaymentItems.purchaseOrderAdvanceId,
          purchaseOrderAdvances.id
        )
      )
      .innerJoin(
        treasuryPaymentBatches,
        eq(treasuryPaymentBatches.id, treasuryPaymentItems.batchId)
      )
      .where(
        and(
          inArray(purchaseOrderAdvanceApplications.invoiceId, uniqueIds),
          eq(purchaseOrderAdvanceApplications.applicationMode, "direct"),
          isNull(purchaseOrderAdvances.cancelledAt),
          eq(treasuryPaymentItems.sourceType, "purchase_order_advance"),
          eq(treasuryPaymentItems.status, "contabilizada"),
          gt(treasuryPaymentItems.bankPaidAmount, "0")
        )
      ),
  ]);

  const advancesByInvoice = new Map<number, SystemInvoiceTreasuryPayment[]>();
  for (const payment of advancePayments) {
    const payments = advancesByInvoice.get(payment.invoiceId) ?? [];
    payments.push(payment);
    advancesByInvoice.set(payment.invoiceId, payments);
  }

  for (const invoiceId of uniqueIds) {
    const payments = [
      ...(directPayments.get(invoiceId) ?? []),
      ...(advancesByInvoice.get(invoiceId) ?? []),
    ].sort(
      (left, right) =>
        paymentTime(left) - paymentTime(right) ||
        left.batchNumber.localeCompare(right.batchNumber)
    );
    const seen = new Set<string>();
    const metadata: SystemInvoiceTreasuryPayment[] = [];
    for (const payment of payments) {
      const item: SystemInvoiceTreasuryPayment = {
        batchNumber: payment.batchNumber.trim(),
        bankReference: payment.bankReference?.trim() || null,
        paidDate: bankCalendarDate(payment.paidDate),
      };
      const key = JSON.stringify([
        item.batchNumber,
        item.bankReference,
        paymentTime(item),
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      metadata.push(item);
    }
    if (metadata.length > 0) result.set(invoiceId, metadata);
  }
  return result;
}
