type RecoveryInput = {
  invoiceId: number;
  invoiceNumber: string;
  retentionCode: string;
  expectedAmount: string;
  mode: "dry-run" | "apply";
};
/** Obsolete maintenance entry point: source notes must remain unchanged for audit. */
export async function recoverInvoiceRetentionNote(_input: RecoveryInput): Promise<never> {
  throw new Error("La recuperación de notas de retención fue retirada. Ejecute db:migrate-retention-documents.");
}
