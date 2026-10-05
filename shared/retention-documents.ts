export function canReadRetentionDocuments(
  user:
    | { role?: string | null; buildreqRole?: string | null }
    | null
    | undefined
) {
  return (
    !!user &&
    (user.role === "admin" ||
      ["contable", "administracion_central"].includes(user.buildreqRole ?? ""))
  );
}
/** Invoice preparation can print within its project without accessing the accounting list. */
export function canPrintInvoiceRetention(
  user: Parameters<typeof canReadRetentionDocuments>[0]
) {
  return (
    canReadRetentionDocuments(user) ||
    user?.buildreqRole === "administrador_proyecto"
  );
}

export type RetentionLineSnapshot = {
  id: number;
  retentionCatalogId?: number | null;
  description: string;
  retentionCode?: string | null;
  retentionErpCode?: string | null;
  retentionType?: string;
  baseAmount: string | null;
  percentage: string | null;
  amount: string;
  financialGroupCode?: string | null;
  financialGroupDescription?: string | null;
};
export type RetentionSnapshot = {
  supplierName: string;
  supplierRtn: string | null;
  supplierAddress?: string | null;
  projectName: string;
  invoiceDocumentNumber: string | null;
  invoiceNumber: string | null;
  cai: string | null;
  documentRangeStart: string | null;
  documentRangeEnd: string | null;
  documentDate: string | null;
  emissionDeadline: string | null;
  accountedAt: string | null;
  accountedById: number | null;
  actorName: string | null;
  lines: RetentionLineSnapshot[];
  reviewWarnings?: string[];
  original?: Record<string, unknown>;
};
