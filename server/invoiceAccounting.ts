import { inArray } from "drizzle-orm";
import {
  invoiceItems,
  invoiceRetentions,
  invoiceOtherCharges,
} from "../drizzle/schema";
import { getDb } from "./db";
import { listInvoicesPage, type InvoicePageFilters } from "./paginatedLists";
import { getInvoiceAppliedAdvanceMap } from "./purchaseOrderAdvances";
import { getTreasuryInvoiceReportPayments } from "./treasury";
import {
  invoiceAccountingBalance,
  summarizeInvoiceRetentions,
  summarizeInvoiceTaxes,
} from "../shared/invoice-accounting";

export async function listInvoiceAccountingQueue(filters: InvoicePageFilters) {
  const page = await listInvoicesPage({
    ...filters,
    accountingSubmittedOnly: true,
  });
  const database = await getDb();
  const ids = page.items.map(row => row.invoice.id);
  if (!database) throw new Error("Base de datos no disponible");
  const [items, retentions, charges, advances, payments] = ids.length
    ? await Promise.all([
        database
          .select({
            invoiceId: invoiceItems.invoiceId,
            taxCode: invoiceItems.taxCode,
            taxAmount: invoiceItems.taxAmount,
            taxBreakdown: invoiceItems.taxBreakdown,
          })
          .from(invoiceItems)
          .where(inArray(invoiceItems.invoiceId, ids)),
        database
          .select({
            invoiceId: invoiceRetentions.invoiceId,
            percentage: invoiceRetentions.percentage,
            amount: invoiceRetentions.amount,
          })
          .from(invoiceRetentions)
          .where(inArray(invoiceRetentions.invoiceId, ids)),
        database
          .select({
            invoiceId: invoiceOtherCharges.invoiceId,
            amount: invoiceOtherCharges.amount,
          })
          .from(invoiceOtherCharges)
          .where(inArray(invoiceOtherCharges.invoiceId, ids)),
        getInvoiceAppliedAdvanceMap(database, ids),
        getTreasuryInvoiceReportPayments(ids),
      ])
    : [
        [],
        [],
        [],
        new Map<number, number>(),
        new Map<number, { amount: number }[]>(),
      ];
  return {
    ...page,
    items: page.items.map(({ invoice, project, supplier }) => {
      const appliedAdvance = advances.get(invoice.id) ?? 0;
      const paid = (payments.get(invoice.id) ?? []).reduce(
        (sum, payment) => sum + payment.amount,
        0
      );
      return {
        id: invoice.id,
        document: invoice.invoiceDocumentNumber,
        project: [project?.code, project?.name].filter(Boolean).join(" - "),
        supplier: supplier?.name ?? "-",
        rtn: supplier?.rtn ?? "-",
        number: invoice.invoiceNumber,
        documentDate: invoice.documentDate,
        currency: invoice.currency,
        subtotal: Number(invoice.subtotal),
        tax: Number(invoice.taxAmount),
        taxes: summarizeInvoiceTaxes(
          items.filter(item => item.invoiceId === invoice.id),
          Number(invoice.taxAmount)
        ),
        otherCharges: charges
          .filter(charge => charge.invoiceId === invoice.id)
          .reduce((sum, charge) => sum + Number(charge.amount), 0),
        total: Number(invoice.total),
        retentions: summarizeInvoiceRetentions(
          retentions.filter(retention => retention.invoiceId === invoice.id),
          Number(invoice.retentionTotal),
          Number(invoice.otherRetentionTotal)
        ),
        discount: Number(invoice.documentDiscountTotal),
        net: Number(invoice.netPayable),
        appliedAdvance,
        balance: invoiceAccountingBalance(
          Number(invoice.netPayable),
          appliedAdvance,
          paid
        ),
        paid,
        status: invoice.status,
        accountingComment: invoice.accountingComment,
        rejectionComment: invoice.rejectionComment,
      };
    }),
  };
}
