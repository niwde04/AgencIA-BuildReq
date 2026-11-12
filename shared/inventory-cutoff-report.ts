export type InventoryCutoffInput = {
  cutoffDate: string;
  projectId?: number;
  warehouseId?: number;
};

export type InventoryCutoffMetadata = {
  ready: boolean;
  earliestDate: string | null;
  today: string;
  message: string;
};

export type InventoryCutoffStockRow = {
  sapItemCode: string;
  description: string;
  brand: string;
  partNumber: string;
  category: string;
  unit: string;
  stock: number | null;
  totalRequired: number | null;
  pendingReceipt: number | null;
  pendingReferenceOnly?: boolean;
  projectLabel: string;
  warehouseLabel: string;
  storageLocation: string;
  coverage: "recorded" | "documentary" | "unavailable";
  observations: string;
};

export type InventoryCutoffEntryRow = {
  receiptNumber: string;
  invoiceDate: string;
  invoiceNumber: string;
  entryDate: string;
  projectLabel: string;
  warehouseLabel: string;
  documentType: string;
  destination: string;
  sapItemCode: string;
  itemName: string;
  brand: string;
  partNumber: string;
  unit: string;
  quantity: number;
  storageLocation: string;
  observations: string;
};

export type InventoryCutoffExitRow = {
  exitNumber: string;
  exitDate: string;
  ownerProjectLabel: string;
  requestingProjectLabel: string;
  warehouseLabel: string;
  destination: string;
  sapItemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  reference: string;
  storageLocation: string;
  observations: string;
};

export type InventoryCutoffReport = {
  cutoffDate: string;
  generatedAt: string;
  periodStartDate: string;
  timeZone: "America/Tegucigalpa";
  coverage: {
    kind: "recorded" | "documentary_partial";
    baselineDate: string;
    recordedFrom: string;
    recordedRows: number;
    documentaryRows: number;
    unavailableRows: number;
    message: string;
    warnings: string[];
  };
  inventory: InventoryCutoffStockRow[];
  entries: InventoryCutoffEntryRow[];
  exits: InventoryCutoffExitRow[];
};
