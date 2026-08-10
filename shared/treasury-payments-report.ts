import {
  buildDmcReportPayload,
  type DmcReportSourceDocumentAdjustment,
  type DmcReportSourceItem,
  type DmcReportSourceRetention,
} from "./dmc-report";
import { getInvoiceDocumentAdjustment } from "./invoice-document-adjustments";
import type {
  PurchaseCurrency,
  PurchaseOrderTaxBreakdownEntry,
} from "./purchase-orders";

export const TREASURY_PAYMENTS_HEADERS = [
  "Lote",
  "Referencia Bancaria",
  "Fecha emisión",
  "Nro. Factura",
  "Razón Social",
  "Tipo detalle",
  "Código artículo",
  "Descripción",
  "Cantidad",
  "Unidad",
  "Costo unitario",
  "Subtotal",
  "Impuesto",
  "Total producto/cargo",
  "Base ISV 15%",
  "Base ISV 18%",
  "Base ISV 4%",
  "Base ISV 0%",
  "Total base",
  "ISV 15%",
  "ISV 18%",
  "Turismo 4%",
  "Total ISV",
  "Ret ISR 1%",
  "Ret ISR 12.5%",
  "Ret ISR 25%",
  "Ret ISV 15%",
  "Total retención fiscal",
  "Neto a pagar línea",
  "COD DE JOB",
  "COD FINANCIERO",
  "GRUPO FINANCIERO",
  "Moneda",
  "Total factura",
  "Anticipos",
  "Retención calidad %",
  "Retención calidad",
  "Amortización anticipo %",
  "Amortización anticipo",
  "Pronto pago %",
  "Pronto pago",
  "TC %",
  "TC",
  "Otras retenciones",
  "Descuentos documento",
  "Total retenciones",
  "Neto factura",
  "Pago efectuado en lote",
] as const;

export type TreasuryPaymentDetailType =
  | "PRODUCTO"
  | "OTRO CARGO"
  | "SIN DETALLE";

export type TreasuryPaymentsReportRow = {
  batchNumber: string;
  bankReference: string;
  invoiceDate: Date | string | null;
  invoiceNumber: string;
  supplierName: string;
  detailType: TreasuryPaymentDetailType;
  itemCode: string;
  description: string;
  quantity: number | null;
  unit: string;
  unitCost: number | null;
  itemSubtotal: number | null;
  itemTax: number | null;
  itemTotal: number | null;
  baseIsv15: number;
  baseIsv18: number;
  baseIsv4: number;
  baseIsv0: number;
  totalBase: number;
  isv15: number;
  isv18: number;
  isv4: number;
  totalIsv: number;
  retIsr1: number;
  retIsr12_5: number;
  retIsr25: number;
  retIsv: number;
  fiscalRetentionTotal: number;
  lineNetPayable: number;
  jobCode: string;
  financialCode: string;
  financialGroupDescription: string;
  currency: PurchaseCurrency;
  invoiceTotal: number | null;
  advances: number | null;
  qualityRetentionPercentage: number | null;
  qualityRetentionAmount: number | null;
  advanceAmortizationPercentage: number | null;
  advanceAmortizationAmount: number | null;
  promptPaymentPercentage: number | null;
  promptPaymentAmount: number | null;
  tcPercentage: number | null;
  tcAmount: number | null;
  otherRetentionTotal: number | null;
  documentDiscountTotal: number | null;
  totalRetentions: number | null;
  invoiceNetPayable: number | null;
  paidAmount: number | null;
};

export type TreasuryPaymentsReportPayload = {
  generatedAt: Date;
  payments: TreasuryPaymentsReportRow[];
};

export type TreasuryPaymentsSourcePayment = {
  paymentItemId: number;
  batchNumber: string;
  bankReference: string;
  invoiceId: number;
  invoiceDate: Date | string | null;
  invoiceNumber: string;
  supplierName: string;
  jobCode: string;
  currency: PurchaseCurrency;
  invoiceSubtotal: number;
  invoiceTaxAmount: number;
  invoiceTotal: number;
  fiscalRetentionTotal: number;
  otherRetentionTotal: number;
  documentDiscountTotal: number;
  invoiceNetPayable: number;
  appliedAdvanceAmount: number;
  bankPaidAmount: number;
  hasOceExemption: boolean;
  oceExemptAmount: number;
};

export type TreasuryPaymentsSourceProduct = {
  id: number;
  invoiceId: number;
  currentSapItemCode: string;
  originalSapItemCode: string;
  itemName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  taxCode: string;
  taxBreakdown: PurchaseOrderTaxBreakdownEntry[] | string | null;
  financialCode: string;
  financialGroupDescription: string;
};

export type TreasuryPaymentsSourceOtherCharge = {
  id: number;
  invoiceId: number;
  concept: string;
  amount: number;
};

export type TreasuryPaymentCatalogFinancialGroup = {
  itemCode: string;
  financialCode: string;
  financialGroupDescription: string;
};

export type TreasuryPaymentsSourceRetention = DmcReportSourceRetention & {
  invoiceId: number;
};

export type TreasuryPaymentsSourceDocumentAdjustment =
  DmcReportSourceDocumentAdjustment & {
    invoiceId: number;
  };

type TreasuryPaymentResolvedDetail = Pick<
  TreasuryPaymentsReportRow,
  | "detailType"
  | "itemCode"
  | "description"
  | "quantity"
  | "unit"
  | "unitCost"
  | "itemSubtotal"
  | "itemTax"
  | "itemTotal"
  | "financialCode"
  | "financialGroupDescription"
>;

type TreasuryPaymentPreparedDetail = {
  report: TreasuryPaymentResolvedDetail;
  fiscalItem: DmcReportSourceItem;
};

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function fiscalMoney(value: unknown) {
  const parsed = Number(value ?? 0);
  return roundMoney(Number.isFinite(parsed) ? parsed : 0);
}

function groupTreasuryPaymentRowsByInvoiceId<T extends { invoiceId: number }>(
  rows: T[]
) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.invoiceId) ?? [];
    current.push(row);
    grouped.set(row.invoiceId, current);
  }
  return grouped;
}

export function resolveTreasuryPaymentFinancialGroup(
  product: Pick<
    TreasuryPaymentsSourceProduct,
    "currentSapItemCode" | "originalSapItemCode"
  >,
  catalogByCode: ReadonlyMap<string, TreasuryPaymentCatalogFinancialGroup>
) {
  const currentCode = product.currentSapItemCode.trim();
  const originalCode = product.originalSapItemCode.trim();
  const current = currentCode ? catalogByCode.get(currentCode) : undefined;
  const original = originalCode ? catalogByCode.get(originalCode) : undefined;
  const resolved = current?.financialCode ? current : original;
  return {
    itemCode: currentCode || originalCode,
    financialCode: resolved?.financialCode ?? "",
    financialGroupDescription:
      resolved?.financialGroupDescription || "SIN ASIGNAR",
  };
}

export function buildTreasuryPaymentsReportRows(input: {
  payments: TreasuryPaymentsSourcePayment[];
  products: TreasuryPaymentsSourceProduct[];
  otherCharges: TreasuryPaymentsSourceOtherCharge[];
  retentions?: TreasuryPaymentsSourceRetention[];
  documentAdjustments?: TreasuryPaymentsSourceDocumentAdjustment[];
}) {
  const productsByInvoiceId = groupTreasuryPaymentRowsByInvoiceId(
    input.products
  );
  const chargesByInvoiceId = groupTreasuryPaymentRowsByInvoiceId(
    input.otherCharges
  );
  const retentionsByInvoiceId = groupTreasuryPaymentRowsByInvoiceId(
    input.retentions ?? []
  );
  const adjustmentsByInvoiceId = groupTreasuryPaymentRowsByInvoiceId(
    input.documentAdjustments ?? []
  );

  return input.payments.flatMap(payment => {
    const products: TreasuryPaymentPreparedDetail[] = (
      productsByInvoiceId.get(payment.invoiceId) ?? []
    )
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(product => {
        const itemCode =
          product.currentSapItemCode.trim() ||
          product.originalSapItemCode.trim();
        const financialGroupDescription =
          product.financialGroupDescription || "SIN ASIGNAR";
        return {
          report: {
            detailType: "PRODUCTO" as const,
            itemCode,
            description: product.itemName.trim(),
            quantity: product.quantity,
            unit: product.unit.trim(),
            unitCost: roundMoney(product.unitPrice),
            itemSubtotal: roundMoney(product.subtotal),
            itemTax: roundMoney(product.taxAmount),
            itemTotal: roundMoney(product.total),
            financialCode: product.financialCode,
            financialGroupDescription,
          },
          fiscalItem: {
            id: product.id,
            itemName: product.itemName,
            sapItemCode: itemCode,
            articleDescription: product.itemName,
            financialGroupCode: product.financialCode,
            financialGroupDescription,
            taxCode: product.taxCode,
            subtotal: product.subtotal,
            taxAmount: product.taxAmount,
            total: product.total,
            taxBreakdown: product.taxBreakdown,
          },
        };
      });
    const charges: TreasuryPaymentPreparedDetail[] = (
      chargesByInvoiceId.get(payment.invoiceId) ?? []
    )
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(charge => ({
        report: {
          detailType: "OTRO CARGO" as const,
          itemCode: "",
          description: charge.concept.trim(),
          quantity: 1,
          unit: "",
          unitCost: roundMoney(charge.amount),
          itemSubtotal: roundMoney(charge.amount),
          itemTax: 0,
          itemTotal: roundMoney(charge.amount),
          financialCode: "",
          financialGroupDescription: "NO APLICA",
        },
        fiscalItem: {
          id: -1_000_000 - charge.id,
          itemName: charge.concept,
          taxCode: "exe",
          subtotal: charge.amount,
          taxAmount: 0,
          total: charge.amount,
        },
      }));
    const details: TreasuryPaymentPreparedDetail[] = [...products, ...charges];
    if (!details.length) {
      details.push({
        report: {
          detailType: "SIN DETALLE",
          itemCode: "",
          description: "FACTURA SIN DETALLE",
          quantity: 1,
          unit: "",
          unitCost: roundMoney(payment.invoiceTotal),
          itemSubtotal: roundMoney(payment.invoiceTotal),
          itemTax: 0,
          itemTotal: roundMoney(payment.invoiceTotal),
          financialCode: "",
          financialGroupDescription: "NO APLICA",
        },
        fiscalItem: {
          id: -1,
          itemName: "FACTURA SIN DETALLE",
          taxCode: "exe",
          subtotal: payment.invoiceTotal,
          taxAmount: 0,
          total: payment.invoiceTotal,
        },
      });
    }

    const retentions = retentionsByInvoiceId.get(payment.invoiceId) ?? [];
    const documentAdjustments =
      adjustmentsByInvoiceId.get(payment.invoiceId) ?? [];
    const fiscalRows = buildDmcReportPayload([
      {
        invoiceId: payment.invoiceId,
        invoiceDocumentNumber: payment.invoiceNumber,
        invoiceNumber: payment.invoiceNumber,
        status: "registrada",
        documentDate: payment.invoiceDate,
        hasOceExemption: payment.hasOceExemption,
        oceExemptAmount: payment.oceExemptAmount,
        subtotal: payment.invoiceSubtotal,
        taxAmount: payment.invoiceTaxAmount,
        total: payment.invoiceTotal,
        retentionTotal: payment.fiscalRetentionTotal,
        otherRetentionTotal: payment.otherRetentionTotal,
        documentDiscountTotal: payment.documentDiscountTotal,
        netPayable: payment.invoiceNetPayable,
        appliedAdvanceAmount: payment.appliedAdvanceAmount,
        currency: payment.currency,
        projectCode: payment.jobCode,
        supplierName: payment.supplierName,
        items: details.map(detail => detail.fiscalItem),
        retentions,
        documentAdjustments,
        materialRequests: [],
        subProjectLabels: [],
      },
    ]).rows;
    const qualityRetention = getInvoiceDocumentAdjustment(
      documentAdjustments,
      "quality_retention"
    );
    const advanceAmortization = getInvoiceDocumentAdjustment(
      documentAdjustments,
      "advance_amortization"
    );
    const promptPayment = getInvoiceDocumentAdjustment(
      documentAdjustments,
      "prompt_payment_discount"
    );
    const tcDiscount = getInvoiceDocumentAdjustment(
      documentAdjustments,
      "tc_discount"
    );
    const invoiceTotal = roundMoney(payment.invoiceTotal);
    const invoiceNetBeforeAdvance = roundMoney(payment.invoiceNetPayable);
    const advances = roundMoney(payment.appliedAdvanceAmount);
    return details.map((detail, index): TreasuryPaymentsReportRow => {
      const showInvoiceTotals = index === 0;
      const fiscalRow = fiscalRows[index] ?? fiscalRows[0];
      return {
        batchNumber: payment.batchNumber,
        bankReference: payment.bankReference,
        invoiceDate: payment.invoiceDate,
        invoiceNumber: payment.invoiceNumber,
        supplierName: payment.supplierName,
        ...detail.report,
        baseIsv15: fiscalMoney(fiscalRow?.baseIsv15),
        baseIsv18: fiscalMoney(fiscalRow?.baseIsv18),
        baseIsv4: fiscalMoney(fiscalRow?.baseIsv4),
        baseIsv0: fiscalMoney(fiscalRow?.baseIsv0),
        totalBase: fiscalMoney(fiscalRow?.totalBase),
        isv15: fiscalMoney(fiscalRow?.isv15),
        isv18: fiscalMoney(fiscalRow?.isv18),
        isv4: fiscalMoney(fiscalRow?.isv4),
        totalIsv: fiscalMoney(fiscalRow?.totalIsv),
        retIsr1: fiscalMoney(fiscalRow?.retIsr1),
        retIsr12_5: fiscalMoney(fiscalRow?.retIsr12_5),
        retIsr25: fiscalMoney(fiscalRow?.retIsr25),
        retIsv: fiscalMoney(fiscalRow?.retIsv),
        fiscalRetentionTotal: fiscalMoney(fiscalRow?.totalRetencion),
        lineNetPayable: fiscalMoney(fiscalRow?.netoPagar),
        jobCode: payment.jobCode,
        currency: payment.currency,
        invoiceTotal: showInvoiceTotals ? invoiceTotal : null,
        advances: showInvoiceTotals ? advances : null,
        qualityRetentionPercentage: showInvoiceTotals
          ? fiscalMoney(qualityRetention?.percentage)
          : null,
        qualityRetentionAmount: showInvoiceTotals
          ? fiscalMoney(qualityRetention?.amount)
          : null,
        advanceAmortizationPercentage: showInvoiceTotals
          ? fiscalMoney(advanceAmortization?.percentage)
          : null,
        advanceAmortizationAmount: showInvoiceTotals
          ? fiscalMoney(advanceAmortization?.amount)
          : null,
        promptPaymentPercentage: showInvoiceTotals
          ? fiscalMoney(promptPayment?.percentage)
          : null,
        promptPaymentAmount: showInvoiceTotals
          ? fiscalMoney(promptPayment?.amount)
          : null,
        tcPercentage: showInvoiceTotals
          ? fiscalMoney(tcDiscount?.percentage)
          : null,
        tcAmount: showInvoiceTotals ? fiscalMoney(tcDiscount?.amount) : null,
        otherRetentionTotal: showInvoiceTotals
          ? roundMoney(payment.otherRetentionTotal)
          : null,
        documentDiscountTotal: showInvoiceTotals
          ? roundMoney(payment.documentDiscountTotal)
          : null,
        totalRetentions: showInvoiceTotals
          ? roundMoney(
              payment.fiscalRetentionTotal + payment.otherRetentionTotal
            )
          : null,
        invoiceNetPayable: showInvoiceTotals
          ? roundMoney(Math.max(0, invoiceNetBeforeAdvance - advances))
          : null,
        paidAmount: showInvoiceTotals
          ? roundMoney(payment.bankPaidAmount)
          : null,
      };
    });
  });
}
