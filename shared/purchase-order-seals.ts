export const PURCHASE_ORDER_SEAL_TYPES = [
  "approval",
  "issued_without_approval",
] as const;

export type PurchaseOrderSealType = (typeof PURCHASE_ORDER_SEAL_TYPES)[number];

export type PurchaseOrderSealStatus = "valid" | "annulled";

export type PurchaseOrderPrintDocument = {
  base64: string;
  fileName: string;
  mimeType: "application/pdf";
  isOfficial: boolean;
  verificationCode: string | null;
  sealStatus: PurchaseOrderSealStatus | null;
};

export type PurchaseOrderSealVerification = {
  status: PurchaseOrderSealStatus;
  orderNumber: string;
  totalAmount: number;
  currency: "HNL" | "USD";
  signerName: string;
  signerRole: string;
  signedAt: Date;
  sealedAt: Date;
  sealType: PurchaseOrderSealType;
  verificationCode: string;
  officialPdfHash: string;
};
