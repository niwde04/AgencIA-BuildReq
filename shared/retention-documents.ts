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
export type RetentionLineSnapshot = {
  id: number;
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
