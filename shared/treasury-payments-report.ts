import type { PurchaseCurrency } from "./purchase-orders";

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
  "COD DE JOB",
  "COD FINANCIERO",
  "GRUPO FINANCIERO",
  "Moneda",
  "Total factura",
  "Anticipos",
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
  jobCode: string;
  financialCode: string;
  financialGroupDescription: string;
  currency: PurchaseCurrency;
  invoiceTotal: number | null;
  advances: number | null;
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
  invoiceTotal: number;
  invoiceNetPayable: number;
  appliedAdvanceAmount: number;
  bankPaidAmount: number;
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

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
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
}) {
  const productsByInvoiceId = new Map<
    number,
    TreasuryPaymentsSourceProduct[]
  >();
  for (const product of input.products) {
    const current = productsByInvoiceId.get(product.invoiceId) ?? [];
    current.push(product);
    productsByInvoiceId.set(product.invoiceId, current);
  }
  const chargesByInvoiceId = new Map<
    number,
    TreasuryPaymentsSourceOtherCharge[]
  >();
  for (const charge of input.otherCharges) {
    const current = chargesByInvoiceId.get(charge.invoiceId) ?? [];
    current.push(charge);
    chargesByInvoiceId.set(charge.invoiceId, current);
  }

  return input.payments.flatMap(payment => {
    const products: TreasuryPaymentResolvedDetail[] = (
      productsByInvoiceId.get(payment.invoiceId) ?? []
    )
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(product => ({
        detailType: "PRODUCTO" as const,
        itemCode:
          product.currentSapItemCode.trim() ||
          product.originalSapItemCode.trim(),
        description: product.itemName.trim(),
        quantity: product.quantity,
        unit: product.unit.trim(),
        unitCost: roundMoney(product.unitPrice),
        itemSubtotal: roundMoney(product.subtotal),
        itemTax: roundMoney(product.taxAmount),
        itemTotal: roundMoney(product.total),
        financialCode: product.financialCode,
        financialGroupDescription:
          product.financialGroupDescription || "SIN ASIGNAR",
      }));
    const charges: TreasuryPaymentResolvedDetail[] = (
      chargesByInvoiceId.get(payment.invoiceId) ?? []
    )
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(charge => ({
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
      }));
    const details: TreasuryPaymentResolvedDetail[] = [...products, ...charges];
    if (!details.length) {
      details.push({
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
      });
    }

    const invoiceTotal = roundMoney(payment.invoiceTotal);
    const invoiceNetBeforeAdvance = roundMoney(payment.invoiceNetPayable);
    const advances = roundMoney(payment.appliedAdvanceAmount);
    return details.map((detail, index): TreasuryPaymentsReportRow => {
      const showInvoiceTotals = index === 0;
      return {
        batchNumber: payment.batchNumber,
        bankReference: payment.bankReference,
        invoiceDate: payment.invoiceDate,
        invoiceNumber: payment.invoiceNumber,
        supplierName: payment.supplierName,
        ...detail,
        jobCode: payment.jobCode,
        currency: payment.currency,
        invoiceTotal: showInvoiceTotals ? invoiceTotal : null,
        advances: showInvoiceTotals ? advances : null,
        totalRetentions: showInvoiceTotals
          ? roundMoney(Math.max(0, invoiceTotal - invoiceNetBeforeAdvance))
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
