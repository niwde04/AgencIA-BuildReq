import { trpc } from "@/lib/trpc";
import { buildDatedCsvFileName, downloadCsv } from "@/lib/csv-export";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import {
  FiscalSummaryCard,
  PurchaseOrderTaxControls,
} from "@/components/PurchaseOrderFiscalControls";
import {
  formatAttachmentSize,
  prepareDocumentAttachment,
  type PreparedDocumentAttachment,
} from "@/lib/document-attachments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowRightLeft,
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Send,
  ShoppingCart,
  ShieldX,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import {
  calculatePurchaseOrderLineAmounts,
  DEFAULT_SALES_TAXES,
  formatPurchaseOrderCurrency,
  getPurchaseOrderFiscalSummaryRows,
  getPurchaseOrderContractSummary,
  normalizePurchaseOrderAdditionalTaxCodes,
  normalizePurchaseOrderTaxCode,
  parsePurchaseOrderAdditionalTaxCodes,
  PURCHASE_ORDER_CONTRACT_FREQUENCIES,
  PURCHASE_ORDER_CONTRACT_FREQUENCY_LABELS,
  summarizePurchaseOrderLines,
  toPurchaseOrderNumber,
  type PurchaseOrderContractFrequency,
  type PurchaseOrderTaxCode,
  type SalesTaxCatalogItem,
} from "@shared/purchase-orders";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  enviada: "Enviada",
  parcialmente_recibida: "Parcialmente recibida",
  recibida: "Recibida",
  anulada: "Anulada",
};
const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  emitida: "border-blue-300 bg-blue-50 text-blue-700",
  enviada: "border-blue-300 bg-blue-50 text-blue-700",
  parcialmente_recibida: "border-cyan-300 bg-cyan-50 text-cyan-700",
  recibida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};
const PURCHASE_TYPE_LABELS: Record<string, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
};
type DirectPurchasePaymentMethod =
  | "linea_credito"
  | "fondo_proyecto"
  | "caja_chica";
const DIRECT_PURCHASE_PAYMENT_METHOD_LABELS: Record<
  DirectPurchasePaymentMethod,
  string
> = {
  linea_credito: "Línea de Crédito",
  fondo_proyecto: "Fondo del proyecto",
  caja_chica: "Fondo del proyecto",
};
function formatDirectPurchasePaymentMethod(value?: string | null) {
  return (
    DIRECT_PURCHASE_PAYMENT_METHOD_LABELS[
      value as DirectPurchasePaymentMethod
    ] ?? "Pendiente"
  );
}

const EMISSION_STATUS_LABELS: Record<string, string> = {
  borrador: "Pendiente",
  emitida: "Emitida",
  enviada: "Emitida",
  parcialmente_recibida: "Emitida",
  recibida: "Emitida",
  anulada: "Anulada",
};

const RECEIVED_ORDER_STATUSES = new Set(["parcialmente_recibida", "recibida"]);
const RECEIPT_CLOSABLE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
]);
const ORDER_STRUCTURE_EDITABLE_STATUSES = new Set(["borrador"]);
const PURCHASE_REQUEST_ORIGIN_STATUSES = new Set([
  "pendiente",
  "en_revision",
  "aprobada",
  "parcialmente_convertida",
]);

function formatSupplierOptionLabel(supplier?: any | null) {
  if (!supplier) return "Seleccione proveedor";
  return [supplier.supplierCode, supplier.name].filter(Boolean).join(" — ");
}

function formatSupplierRtnLabel(supplier?: any | null) {
  const rtn = String(supplier?.rtn ?? "").trim();
  return rtn || "RTN no configurado";
}

function formatSupplierContactPrintLabel(contact?: any | null) {
  if (!contact) return "-";

  return (
    [contact.name, contact.phone, contact.email]
      .map(value => String(value ?? "").trim())
      .filter(Boolean)
      .join(" / ") || "-"
  );
}

function formatSupplierContactMeta(contact?: any | null) {
  if (!contact) return "";

  return [contact.phone, contact.email, contact.address]
    .map(value => String(value ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

function getUserLabel(user: any, fallback = "—") {
  return user?.name?.trim?.() || user?.email?.trim?.() || fallback;
}

function formatPurchaseOrderRequestNumbers(row: any) {
  const requestNumbers = Array.isArray(row.originalRequestNumbers)
    ? row.originalRequestNumbers
    : [];
  const labels = Array.from(
    new Set(
      requestNumbers
        .map((value: any) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  return labels.length > 0 ? labels.join(", ") : "—";
}

function formatPurchaseOrderRequestedBy(row: any) {
  const users = Array.isArray(row.requestedByUsers)
    ? row.requestedByUsers
    : row.originalRequester
      ? [row.originalRequester]
      : [];
  const labels = Array.from(
    new Set(
      users
        .map((user: any) => getUserLabel(user, ""))
        .filter(Boolean)
    )
  );
  return labels.length > 0 ? labels.join(", ") : "—";
}

function formatPurchaseOrderCreatedBy(row: any) {
  return getUserLabel(
    row.createdBy,
    row.purchaseOrder?.createdById
      ? `Usuario #${row.purchaseOrder.createdById}`
      : "—"
  );
}

function formatPurchaseOrderItemTargetLabel(item: any) {
  const target = item?.target ?? item?.sourceTarget;
  if (target?.label) return String(target.label);

  if (target?.type === "subproyecto" && target.subProjectId) {
    return `Subproyecto #${target.subProjectId}`;
  }

  if (target?.type === "activo_fijo" && target.fixedAssetSapItemCode) {
    return target.fixedAssetName
      ? `Activo fijo: ${target.fixedAssetSapItemCode} - ${target.fixedAssetName}`
      : `Activo fijo: ${target.fixedAssetSapItemCode}`;
  }

  if (item?.targetType === "subproyecto" && item.subProjectId) {
    return `Subproyecto #${item.subProjectId}`;
  }

  if (item?.targetType === "activo_fijo" && item.fixedAssetSapItemCode) {
    return item.fixedAssetName
      ? `Activo fijo: ${item.fixedAssetSapItemCode} - ${item.fixedAssetName}`
      : `Activo fijo: ${item.fixedAssetSapItemCode}`;
  }

  return "-";
}

function SupplierCommandList({
  suppliers,
  selectedSupplierId,
  onSelect,
}: {
  suppliers: any[];
  selectedSupplierId: string;
  onSelect: (supplierId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const commandContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = commandContainerRef.current?.querySelector<HTMLElement>(
        '[data-slot="command-list"]'
      );
      list?.scrollTo({ top: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [search]);

  return (
    <div ref={commandContainerRef}>
      <Command>
        <CommandInput
          placeholder="Buscar proveedor por código o nombre..."
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No se encontraron proveedores.</CommandEmpty>
          <CommandGroup>
            {suppliers.map((supplier: any) => {
              const supplierId = String(supplier.id);
              const selected = selectedSupplierId === supplierId;

              return (
                <CommandItem
                  key={supplier.id}
                  value={`${supplier.id} ${supplier.supplierCode} ${supplier.name} ${supplier.rtn ?? ""}`}
                  onSelect={() => onSelect(supplierId)}
                >
                  <Check
                    className={`h-4 w-4 ${
                      selected ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="truncate">
                    {formatSupplierOptionLabel(supplier)}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

function formatSupplierContactOptionLabel(contact?: any | null) {
  if (!contact) return "Seleccione contacto";
  return [contact.name, contact.branchName].filter(Boolean).join(" — ");
}

function SupplierContactCommandList({
  contacts,
  selectedContactId,
  onSelect,
}: {
  contacts: any[];
  selectedContactId: string;
  onSelect: (contactId: string) => void;
}) {
  return (
    <Command>
      <CommandInput placeholder="Buscar contacto por nombre, correo o telefono..." />
      <CommandList>
        <CommandEmpty>No hay contactos disponibles.</CommandEmpty>
        <CommandGroup>
          {contacts.map(contact => {
            const contactId = String(contact.id);
            const selected = selectedContactId === contactId;
            const contactMeta = formatSupplierContactMeta(contact);

            return (
              <CommandItem
                key={contact.id}
                value={[
                  contact.name,
                  contact.branchName,
                  contact.phone,
                  contact.email,
                  contact.address,
                ]
                  .filter(Boolean)
                  .join(" ")}
                onSelect={() => onSelect(contactId)}
              >
                <Check
                  className={`h-4 w-4 ${
                    selected ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {formatSupplierContactOptionLabel(contact)}
                  </span>
                  {contactMeta ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {contactMeta}
                    </span>
                  ) : null}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function getPurchaseRequestProjectLabel(row: any) {
  return (
    row?.projectSummary?.label ||
    (row?.project ? `${row.project.code} — ${row.project.name}` : "Proyecto pendiente")
  );
}

function getPurchaseRequestOriginLabel(row: any) {
  const requestNumber = row?.purchaseRequest?.requestNumber ?? "SC pendiente";
  return `${requestNumber} — ${getPurchaseRequestProjectLabel(row)}`;
}

function getPurchaseRequestItemPendingConversionQuantity(item: any) {
  const explicitPending = item?.pendingConversionQuantity;
  if (explicitPending !== null && explicitPending !== undefined) {
    const parsed = Number(explicitPending);
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
  }

  const requestedQuantity = Number(item?.quantity ?? 0);
  const convertedQuantity = Number(item?.convertedQuantity ?? 0);
  if (!Number.isFinite(requestedQuantity)) return 0;
  return Math.max(
    requestedQuantity - (Number.isFinite(convertedQuantity) ? convertedQuantity : 0),
    0
  );
}

function formatQuantity(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPrintNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatPrintMoney(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0.00";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPrintDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function dateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const TEMPORARY_FIXED_ASSET_ITEM_NAME = "ACTIVO FIJO TEMPORAL";

function normalizeItemText(value: unknown) {
  return String(value ?? "").trim().toLocaleUpperCase("es-HN");
}

function isTemporaryFixedAssetItem(item: any) {
  return (
    normalizeItemText(item?.itemName) === TEMPORARY_FIXED_ASSET_ITEM_NAME ||
    normalizeItemText(item?.catalogItem?.description) ===
      TEMPORARY_FIXED_ASSET_ITEM_NAME
  );
}

function getTemporaryFixedAssetDisplayName(item: any) {
  return isTemporaryFixedAssetItem(item)
    ? TEMPORARY_FIXED_ASSET_ITEM_NAME
    : String(item?.itemName ?? "");
}

function getTemporaryFixedAssetRequestedName(item: any) {
  if (!isTemporaryFixedAssetItem(item)) return null;

  const itemName = String(item?.itemName ?? "").trim();
  if (itemName && normalizeItemText(itemName) !== TEMPORARY_FIXED_ASSET_ITEM_NAME) {
    return itemName;
  }

  const requestedItemName = String(item?.requestedItemName ?? "").trim();
  if (
    requestedItemName &&
    normalizeItemText(requestedItemName) !== TEMPORARY_FIXED_ASSET_ITEM_NAME
  ) {
    return requestedItemName;
  }

  return "";
}

function formatQuantityPayload(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function formatMoneyPayload(value: number | string | null | undefined) {
  const parsed = toPurchaseOrderNumber(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "0.0000";
}

function formatUnitPricePayload(value: number | string | null | undefined) {
  const parsed = toPurchaseOrderNumber(value);
  return Number.isFinite(parsed) ? parsed.toFixed(8) : "0.00000000";
}

function formatMoneyDisplay(value: number | string | null | undefined) {
  const parsed = toPurchaseOrderNumber(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function calculateSubtotalDraftValue(
  quantity: number | string | null | undefined,
  unitPrice: number | string | null | undefined
) {
  return formatMoneyDisplay(
    toPurchaseOrderNumber(quantity) * toPurchaseOrderNumber(unitPrice)
  );
}

function calculateUnitPriceDraftValue(
  quantity: number | string | null | undefined,
  subtotal: number | string | null | undefined
) {
  const parsedQuantity = toPurchaseOrderNumber(quantity);
  if (parsedQuantity <= 0) return "0.00000000";
  return formatUnitPricePayload(
    toPurchaseOrderNumber(subtotal) / parsedQuantity
  );
}

function withDraftQuantity(
  draft: PurchaseOrderItemDraft,
  quantity: string
): PurchaseOrderItemDraft {
  return {
    ...draft,
    quantity,
    subtotal: calculateSubtotalDraftValue(quantity, draft.unitPrice),
  };
}

function withDraftSubtotal(
  draft: PurchaseOrderItemDraft,
  subtotal: string
): PurchaseOrderItemDraft {
  return {
    ...draft,
    subtotal,
    unitPrice: calculateUnitPriceDraftValue(draft.quantity, subtotal),
  };
}

function withDraftUnitPrice(
  draft: PurchaseOrderItemDraft,
  unitPrice: string
): PurchaseOrderItemDraft {
  return {
    ...draft,
    unitPrice,
    subtotal: calculateSubtotalDraftValue(draft.quantity, unitPrice),
  };
}

function normalizeDraftMoneyValues(
  draft: PurchaseOrderItemDraft
): PurchaseOrderItemDraft {
  const quantity = draft.quantity.trim()
    ? draft.quantity
    : formatQuantityPayload(draft.quantity);
  const subtotal = formatMoneyDisplay(draft.subtotal);
  return {
    ...draft,
    quantity,
    subtotal,
    unitPrice: calculateUnitPriceDraftValue(quantity, subtotal),
  };
}

function areTaxCodeArraysEqual(
  left: string[] | string | null | undefined,
  right: string[] | string | null | undefined
) {
  const leftCodes = parsePurchaseOrderAdditionalTaxCodes(left).sort();
  const rightCodes = parsePurchaseOrderAdditionalTaxCodes(right).sort();
  return (
    leftCodes.length === rightCodes.length &&
    leftCodes.every((code, index) => code === rightCodes[index])
  );
}

type PurchaseOrderItemDraft = {
  quantity: string;
  unitPrice: string;
  subtotal: string;
  taxCode: PurchaseOrderTaxCode;
  additionalTaxCodes: string[];
  itemName?: string;
};

type ContractDraft = {
  appliesContract: boolean;
  contractPaymentFrequency: PurchaseOrderContractFrequency;
  contractFirstPaymentDate: string;
  contractEndDate: string;
  contractNote: string;
};

const DEFAULT_CONTRACT_DRAFT: ContractDraft = {
  appliesContract: false,
  contractPaymentFrequency: "mensual",
  contractFirstPaymentDate: "",
  contractEndDate: "",
  contractNote: "",
};

const EMPTY_ORIGIN_ITEMS: any[] = [];

type PendingOrderAttachment = PreparedDocumentAttachment & {
  id: string;
};

function getDefaultOriginItemDraft(item: any): PurchaseOrderItemDraft {
  const taxCode = normalizePurchaseOrderTaxCode(item.taxCode);
  const quantity = formatQuantityPayload(
    getPurchaseRequestItemPendingConversionQuantity(item)
  );
  const unitPrice = formatMoneyDisplay(item.unitPrice ?? "0.00");
  return {
    quantity,
    unitPrice,
    subtotal: calculateSubtotalDraftValue(quantity, unitPrice),
    taxCode,
    additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
      item.additionalTaxCodes,
      taxCode
    ),
  };
}

type PurchaseOrderConfirmState =
  | { kind: null }
  | {
      kind: "delete-item";
      itemId: number;
      itemName: string;
      isLastItem: boolean;
    }
  | {
      kind: "close-receipt-line";
      itemId: number;
      itemName: string;
      pendingQuantity: number;
      unit: string | null;
    }
  | {
      kind: "cancel-order";
      orderId: number;
      orderNumber: string;
    };

export default function OrdenesCompra() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const userRole = (user as any)?.buildreqRole;
  const canManagePurchaseOrders =
    user?.role === "admin" ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const canCreatePurchaseOrder =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const isProjectAdmin = userRole === "administrador_proyecto";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const reopeningDraftOrderIdRef = useRef<number | null>(null);
  const [reopeningDraftOrderId, setReopeningDraftOrderId] = useState<
    number | null
  >(null);
  const [newOrderDialogOpen, setNewOrderDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState("all");
  const [originPopoverOpen, setOriginPopoverOpen] = useState(false);
  const [originSearch, setOriginSearch] = useState("");
  const [selectedOriginId, setSelectedOriginId] = useState("");
  const [replaceItemId, setReplaceItemId] = useState<number | null>(null);
  const [replacementSearch, setReplacementSearch] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedSupplierContactId, setSelectedSupplierContactId] =
    useState("");
  const [supplierPopoverOpen, setSupplierPopoverOpen] = useState(false);
  const [contactPopoverOpen, setContactPopoverOpen] = useState(false);
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [itemDrafts, setItemDrafts] = useState<
    Record<number, PurchaseOrderItemDraft>
  >({});
  const [contractDraft, setContractDraft] = useState<ContractDraft>(
    DEFAULT_CONTRACT_DRAFT
  );
  const [originItemDrafts, setOriginItemDrafts] = useState<
    Record<number, PurchaseOrderItemDraft>
  >({});
  const newOrderAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [pendingOrderAttachments, setPendingOrderAttachments] = useState<
    PendingOrderAttachment[]
  >([]);
  const [preparingOrderAttachment, setPreparingOrderAttachment] =
    useState(false);
  const [confirmState, setConfirmState] = useState<PurchaseOrderConfirmState>({
    kind: null,
  });

  const { data: orders, isLoading } = trpc.purchaseOrders.list.useQuery();
  const {
    data: purchaseRequestOrigins,
    isLoading: isLoadingPurchaseRequestOrigins,
  } = trpc.purchaseRequests.list.useQuery(undefined, {
    enabled: canCreatePurchaseOrder && newOrderDialogOpen,
  });
  const selectedOriginIdNumber = Number(selectedOriginId || 0);
  const {
    data: selectedOriginDetail,
    isLoading: isLoadingSelectedOriginDetail,
  } = trpc.purchaseRequests.getById.useQuery(
    { id: selectedOriginIdNumber },
    {
      enabled:
        canCreatePurchaseOrder &&
        newOrderDialogOpen &&
        selectedOriginIdNumber > 0,
    }
  );
  const { data: suppliersList } = trpc.requestItems.listSuppliers.useQuery();
  const { data: salesTaxes } = trpc.taxes.activeOptions.useQuery(undefined, {
    enabled: Boolean(user),
  });
  const activeSalesTaxes = (salesTaxes?.length
    ? salesTaxes
    : DEFAULT_SALES_TAXES) as SalesTaxCatalogItem[];
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
    refetch: refetchDetail,
  } = trpc.purchaseOrders.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );
  const { data: sapMatches } = trpc.requestItems.searchSapCatalog.useQuery(
    { search: replacementSearch },
    { enabled: replacementSearch.trim().length >= 2 }
  );

  const replaceMutation = trpc.purchaseOrders.replaceItem.useMutation({
    onSuccess: () => {
      toast.success("Ítem actualizado en la OC");
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
      setReplaceItemId(null);
      setReplacementSearch("");
    },
    onError: error => toast.error(error.message),
  });

  const updateMutation = trpc.purchaseOrders.update.useMutation({
    onSuccess: () => {
      toast.success("OC actualizada");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const updateItemLineMutation = trpc.purchaseOrders.updateItemLine.useMutation(
    {
      onSuccess: () => {
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: error => toast.error(error.message),
    }
  );

  const updateContractTermsMutation =
    trpc.purchaseOrders.updateContractTerms.useMutation({
      onSuccess: () => {
        toast.success("Contrato actualizado");
        void utils.purchaseOrders.list.invalidate();
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: error => toast.error(error.message),
    });

  const updateContractItemPriceMutation =
    trpc.purchaseOrders.updateContractItemPrice.useMutation({
      onSuccess: () => {
        toast.success("Precio de contrato actualizado");
        void utils.purchaseOrders.list.invalidate();
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: error => toast.error(error.message),
    });

  const closeReceiptLineMutation =
    trpc.purchaseOrders.closeReceiptLine.useMutation({
      onSuccess: result => {
        toast.success(
          result.orderStatus === "recibida"
            ? "Línea cerrada. La orden ya no tiene recepciones pendientes."
            : "Línea cerrada para recepción"
        );
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
        void utils.purchaseOrders.list.invalidate();
        setConfirmState({ kind: null });
      },
      onError: error => toast.error(error.message),
    });

  const movePendingToPurchaseRequestMutation =
    trpc.purchaseOrders.movePendingToPurchaseRequest.useMutation({
      onSuccess: result => {
        toast.success(
          result.reused
            ? `Saldo pendiente agregado a la ${result.purchaseRequestNumber}`
            : `Saldo pendiente enviado a la ${result.purchaseRequestNumber}`
        );
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
        void Promise.all([
          utils.purchaseOrders.list.invalidate(),
          utils.purchaseRequests.list.invalidate(),
        ]);
        setConfirmState({ kind: null });
      },
      onError: error => toast.error(error.message),
    });

  const deleteItemMutation = trpc.purchaseOrders.deleteItem.useMutation({
    onSuccess: result => {
      toast.success(
        result.orderCancelled
          ? "Se elimino la ultima linea y la OC quedo anulada"
          : "Linea eliminada de la OC"
      );
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        void utils.purchaseOrders.list.invalidate();
      }
    },
    onError: error => toast.error(error.message),
  });

  const cancelOrderMutation = trpc.purchaseOrders.cancelOrder.useMutation({
    onSuccess: () => {
      toast.success("Orden de compra anulada");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const reopenDraftMutation = trpc.purchaseOrders.reopenDraft.useMutation({
    onSuccess: () => {
      toast.success("OC reabierta para edición");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
    onSettled: () => {
      reopeningDraftOrderIdRef.current = null;
      setReopeningDraftOrderId(null);
    },
  });

  const sendMutation = trpc.purchaseOrders.sendToSupplier.useMutation({
    onSuccess: () => {
      toast.success("OC emitida");
      void utils.purchaseOrders.list.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const uploadPendingAttachmentMutation = trpc.attachments.upload.useMutation({
    onError: error => toast.error(error.message),
  });

  const createFromOriginMutation =
    trpc.purchaseOrders.createFromPurchaseRequest.useMutation({
      onSuccess: async result => {
        const purchaseOrderNumbers =
          "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
            ? result.purchaseOrders.map(entry => entry.purchaseOrderNumber)
            : result.purchaseOrderNumber
              ? [result.purchaseOrderNumber]
              : [];
        const purchaseOrderId =
          "purchaseOrderId" in result && result.purchaseOrderId
            ? result.purchaseOrderId
            : "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
              ? result.purchaseOrders[0]?.purchaseOrderId
              : null;

        toast.success(
          purchaseOrderNumbers.length === 1
            ? `OC ${purchaseOrderNumbers[0]} generada`
            : `Se generaron ${purchaseOrderNumbers.length} órdenes de compra`
        );
        setNewOrderDialogOpen(false);
        setSelectedOriginId("");
        setOriginSearch("");
        setOriginPopoverOpen(false);
        setSelectedSupplierContactId("");
        setOriginItemDrafts({});
        setContractDraft(DEFAULT_CONTRACT_DRAFT);
        void Promise.all([
          utils.purchaseOrders.list.invalidate(),
          utils.purchaseRequests.list.invalidate(),
        ]);
        if (purchaseOrderId) {
          setSelectedId(purchaseOrderId);
          if (pendingOrderAttachments.length > 0) {
            try {
              await Promise.all(
                pendingOrderAttachments.map(attachment =>
                  uploadPendingAttachmentMutation.mutateAsync({
                    entityType: "purchase_order",
                    entityId: purchaseOrderId,
                    fileName: attachment.fileName,
                    fileData: attachment.fileData,
                    mimeType: attachment.mimeType,
                    fileSize: attachment.fileSize,
                    category: "orden_compra",
                  })
                )
              );
              toast.success(
                pendingOrderAttachments.length === 1
                  ? "Adjunto subido a la OC"
                  : `${pendingOrderAttachments.length} adjuntos subidos a la OC`
              );
              setPendingOrderAttachments([]);
              void utils.attachments.getByEntity.invalidate({
                entityType: "purchase_order",
                entityId: purchaseOrderId,
              });
            } catch {
              toast.error("La OC fue creada, pero no se pudieron subir todos los adjuntos");
            }
          }
        }
      },
      onError: error => toast.error(error.message),
    });

  const items = useMemo(() => detail?.items ?? [], [detail]);
  const purchaseOrderSapCodes = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map(
              (item: any) => item.currentSapItemCode ?? item.originalSapItemCode
            )
            .filter((value): value is string => Boolean(value))
        )
    ),
    [items]
  );
  const selectedSupplier = useMemo(
    () =>
      (suppliersList || []).find(
        (supplier: any) => supplier.id === Number(selectedSupplierId)
      ) ?? null,
    [selectedSupplierId, suppliersList]
  );
  const { data: latestSupplierPrices } =
    trpc.purchaseOrders.latestSupplierPrices.useQuery(
      {
        supplierId: Number(selectedSupplierId || 0),
        sapCodes: purchaseOrderSapCodes,
      },
      {
        enabled:
          canManagePurchaseOrders &&
          Boolean(selectedId) &&
          Boolean(selectedSupplierId) &&
          purchaseOrderSapCodes.length > 0,
      }
    );
  const currentSupplierEmail =
    detail?.purchaseOrder.supplierEmail ?? detail?.supplier?.email ?? "";
  const orderStatus = detail?.purchaseOrder.status ?? "";
  const isContractOrder = detail?.purchaseOrder.appliesContract === true;
  const contractSummary =
    detail?.contractSummary ??
    getPurchaseOrderContractSummary({
      appliesContract: detail?.purchaseOrder.appliesContract,
      contractPaymentFrequency: detail?.purchaseOrder.contractPaymentFrequency,
      contractFirstPaymentDate: detail?.purchaseOrder.contractFirstPaymentDate,
      contractEndDate: detail?.purchaseOrder.contractEndDate,
    });
  const canEditOrderStructure =
    canManagePurchaseOrders && ORDER_STRUCTURE_EDITABLE_STATUSES.has(orderStatus);
  const canEditIssuedContract =
    canManagePurchaseOrders &&
    isContractOrder &&
    ["emitida", "enviada", "parcialmente_recibida"].includes(orderStatus);
  const canEditContractTerms = canEditOrderStructure || canEditIssuedContract;
  const canEditContractLinePrice =
    canEditIssuedContract && !canEditOrderStructure;
  const canEditNewOrderContract = newOrderDialogOpen && canCreatePurchaseOrder;
  const canEditContractSetup =
    canEditNewOrderContract || canEditOrderStructure;
  const canEditContractEndDate =
    canEditNewOrderContract || canEditContractTerms;
  const isOrderCancelled = orderStatus === "anulada";
  const isOrderReceived = orderStatus === "recibida";
  const isOrderReadOnly = Boolean(
    !canManagePurchaseOrders || isOrderCancelled || isOrderReceived
  );
  const canManagePurchaseOrderAttachments =
    (user?.role === "admin" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto") &&
    !isOrderCancelled &&
    !isOrderReceived;
  const hasReceivedItems = items.some(
    (item: any) => Number(item.receivedQuantity ?? 0) > 0
  );
  const hasOrderReceipts =
    hasReceivedItems || RECEIVED_ORDER_STATUSES.has(orderStatus);
  const canReopenDraft =
    canManagePurchaseOrders &&
    ["emitida", "enviada"].includes(orderStatus) &&
    !hasOrderReceipts;
  const isReopeningSelectedDraft =
    detail?.purchaseOrder.id !== undefined &&
    (reopeningDraftOrderId === detail.purchaseOrder.id ||
      reopenDraftMutation.isPending);
  const filteredOrders = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (orders ?? []).filter((row: any) => {
      const purchaseOrder = row.purchaseOrder;
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const requestNumbers = formatPurchaseOrderRequestNumbers(row);
      const requestedByLabel = formatPurchaseOrderRequestedBy(row);
      const createdByLabel = formatPurchaseOrderCreatedBy(row);
      const matchesSearch =
        !normalizedSearch ||
        [
          purchaseOrder.orderNumber,
          requestNumbers,
          purchaseOrder.classification,
          PURCHASE_TYPE_LABELS[purchaseOrder.purchaseType],
          row.supplier?.name,
          row.supplier?.supplierCode,
          row.supplier?.rtn,
          projectLabel,
          requestedByLabel,
          createdByLabel,
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || purchaseOrder.status === statusFilter;
      const matchesType =
        purchaseTypeFilter === "all" ||
        purchaseOrder.purchaseType === purchaseTypeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orders, purchaseTypeFilter, searchTerm, statusFilter]);
  const purchaseRequestOriginRows = useMemo(() => {
    const normalizedSearch = originSearch.trim().toLowerCase();

    return (purchaseRequestOrigins ?? []).filter((row: any) => {
      const purchaseRequest = row.purchaseRequest;
      if (!PURCHASE_REQUEST_ORIGIN_STATUSES.has(purchaseRequest.status)) {
        return false;
      }
      if (
        row.pendingConversionItemCount !== undefined &&
        Number(row.pendingConversionItemCount) <= 0
      ) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }

      return [
        purchaseRequest.requestNumber,
        purchaseRequest.sapDocumentNumber,
        PURCHASE_TYPE_LABELS[purchaseRequest.purchaseType] || purchaseRequest.purchaseType,
        getPurchaseRequestProjectLabel(row),
      ]
        .filter(Boolean)
        .some(value =>
          String(value).toLowerCase().includes(normalizedSearch)
        );
    });
  }, [isProjectAdmin, originSearch, purchaseRequestOrigins]);
  const selectedOriginRow = useMemo(
    () =>
      purchaseRequestOriginRows.find(
        (row: any) => String(row.purchaseRequest.id) === selectedOriginId
      ) ??
      (purchaseRequestOrigins ?? []).find(
        (row: any) => String(row.purchaseRequest.id) === selectedOriginId
      ) ??
      null,
    [purchaseRequestOriginRows, purchaseRequestOrigins, selectedOriginId]
  );
  const selectedOriginAllItems =
    selectedOriginDetail?.items ?? EMPTY_ORIGIN_ITEMS;
  const selectedOriginItems = useMemo(() => {
    if (!selectedOriginDetail) return [];
    if (
      !PURCHASE_REQUEST_ORIGIN_STATUSES.has(
        selectedOriginDetail.purchaseRequest.status
      )
    ) {
      return [];
    }
    const rawAssignedProjectIds = (user as any)?.assignedProjectIds;
    const assignedProjectIds =
      Array.isArray(rawAssignedProjectIds) && rawAssignedProjectIds.length > 0
        ? rawAssignedProjectIds.map(Number)
        : (user as any)?.assignedProjectId
          ? [(user as any).assignedProjectId]
          : [];
    const canUseAllProjects = isProjectAdmin && assignedProjectIds.length === 0;

    return selectedOriginAllItems.filter((item: any) => {
      if (getPurchaseRequestItemPendingConversionQuantity(item) <= 0) {
        return false;
      }

      if (!isProjectAdmin) return true;
      if (canUseAllProjects) return true;
      const itemProjectId =
        item.sourceProject?.id ?? selectedOriginDetail.purchaseRequest.projectId;
      return assignedProjectIds.includes(itemProjectId);
    });
  }, [isProjectAdmin, selectedOriginAllItems, selectedOriginDetail, user]);
  const getOriginItemDraft = (item: any): PurchaseOrderItemDraft =>
    originItemDrafts[item.id] ?? getDefaultOriginItemDraft(item);
  const selectedOriginItemsToConvert = useMemo(
    () =>
      selectedOriginItems.map((item: any) => {
        const draft = normalizeDraftMoneyValues(getOriginItemDraft(item));
        return {
          purchaseRequestItemId: item.id,
          quantity: formatQuantityPayload(draft.quantity),
          unitPrice: formatUnitPricePayload(draft.unitPrice),
          subtotal: formatMoneyPayload(draft.subtotal),
          taxCode: draft.taxCode,
          additionalTaxCodes: draft.additionalTaxCodes,
        };
      }),
    [originItemDrafts, selectedOriginItems]
  );
  const selectedOriginItemIds = useMemo(
    () =>
      selectedOriginItemsToConvert.map(
        (item: { purchaseRequestItemId: number }) => item.purchaseRequestItemId
      ),
    [selectedOriginItemsToConvert]
  );
  const selectedOriginTotalPendingQuantity = useMemo(
    () =>
      selectedOriginItems.reduce(
        (sum: number, item: any) =>
          sum + getPurchaseRequestItemPendingConversionQuantity(item),
        0
      ),
    [selectedOriginItems]
  );
  const originPricingSummary = useMemo(
    () =>
      summarizePurchaseOrderLines(
        selectedOriginItems.map((item: any) => {
          const draft = normalizeDraftMoneyValues(getOriginItemDraft(item));
          return {
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            subtotal: draft.subtotal,
            taxCode: draft.taxCode,
            additionalTaxCodes: draft.additionalTaxCodes,
          };
        }),
        activeSalesTaxes
      ),
    [activeSalesTaxes, originItemDrafts, selectedOriginItems]
  );
  const originDraftValidationMessage = useMemo(() => {
    for (const item of selectedOriginItems) {
      const draft = getOriginItemDraft(item);
      const quantity = Number(draft.quantity);
      const unitPrice = Number(draft.unitPrice);
      const pendingQuantity = getPurchaseRequestItemPendingConversionQuantity(item);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `Ingrese una cantidad mayor que cero para ${item.itemName}`;
      }
      if (quantity > pendingQuantity) {
        return `La cantidad de ${item.itemName} excede el pendiente`;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return `Ingrese un precio válido para ${item.itemName}`;
      }
    }

    if (contractDraft.appliesContract) {
      if (!contractDraft.contractPaymentFrequency) {
        return "Seleccione la frecuencia de pago del contrato";
      }
      if (!contractDraft.contractFirstPaymentDate) {
        return "Seleccione la primera fecha de pago del contrato";
      }
      if (!contractDraft.contractEndDate) {
        return "Seleccione la fecha de terminación del contrato";
      }
      const firstPaymentDate = new Date(
        `${contractDraft.contractFirstPaymentDate}T12:00:00`
      );
      const endDate = new Date(`${contractDraft.contractEndDate}T12:00:00`);
      if (endDate < firstPaymentDate) {
        return "La fecha de terminación no puede ser anterior a la primera fecha de pago";
      }
      const summary = getPurchaseOrderContractSummary({
        appliesContract: true,
        contractPaymentFrequency: contractDraft.contractPaymentFrequency,
        contractFirstPaymentDate: contractDraft.contractFirstPaymentDate,
        contractEndDate: contractDraft.contractEndDate,
      });
      if (summary.expectedInvoiceCount <= 0) {
        return "La programación del contrato no genera pagos esperados";
      }
    }

    return null;
  }, [
    contractDraft.appliesContract,
    contractDraft.contractEndDate,
    contractDraft.contractFirstPaymentDate,
    contractDraft.contractPaymentFrequency,
    originItemDrafts,
    selectedOriginItems,
  ]);
  const selectedSupplierIdNumber = Number(selectedSupplierId || 0);
  const selectedOriginProjectId =
    selectedOriginDetail?.purchaseRequest.projectId ??
    selectedOriginRow?.project?.id ??
    0;
  const supplierContactProjectId =
    detail?.purchaseOrder.projectId ?? selectedOriginProjectId;
  const { data: supplierContactRows } = trpc.suppliers.listContacts.useQuery(
    {
      supplierId: selectedSupplierIdNumber,
      projectId: supplierContactProjectId,
      includeInactive: false,
    },
    {
      enabled:
        Boolean(supplierContactProjectId) &&
        selectedSupplierIdNumber > 0,
    }
  );
  const supplierContacts = useMemo(
    () => (supplierContactRows ?? []).map((row: any) => row.contact),
    [supplierContactRows]
  );
  useEffect(() => {
    if (!newOrderDialogOpen || !selectedSupplierContactId) return;
    if (
      !supplierContacts.some(
        (contact: any) => String(contact.id) === selectedSupplierContactId
      )
    ) {
      setSelectedSupplierContactId("");
    }
  }, [newOrderDialogOpen, selectedSupplierContactId, supplierContacts]);
  const selectedSupplierContact = useMemo(() => {
    const selectedContactId = String(
      newOrderDialogOpen
        ? selectedSupplierContactId
        : detail?.preferredSupplierContact?.id ??
            detail?.purchaseOrder.supplierContactId ??
            ""
    );

    return (
      supplierContacts.find(
        (contact: any) => String(contact.id) === selectedContactId
      ) ??
      (newOrderDialogOpen ? null : detail?.preferredSupplierContact) ??
      null
    );
  }, [
    detail?.preferredSupplierContact,
    detail?.purchaseOrder.supplierContactId,
    newOrderDialogOpen,
    selectedSupplierContactId,
    supplierContacts,
  ]);
  const selectedSupplierCreatePayload = useMemo(
    () =>
      selectedSupplierIdNumber > 0
        ? {
            supplierId: selectedSupplierIdNumber,
            ...(selectedSupplier?.email
              ? { supplierEmail: selectedSupplier.email }
              : {}),
            ...(selectedSupplierContactId
              ? { supplierContactId: Number(selectedSupplierContactId) }
              : {}),
          }
        : {},
    [selectedSupplier?.email, selectedSupplierContactId, selectedSupplierIdNumber]
  );
  const selectedContractCreatePayload = useMemo(
    () =>
      contractDraft.appliesContract
        ? {
            appliesContract: true,
            contractPaymentFrequency: contractDraft.contractPaymentFrequency,
            contractFirstPaymentDate: contractDraft.contractFirstPaymentDate,
            contractEndDate: contractDraft.contractEndDate,
          }
        : { appliesContract: false },
    [
      contractDraft.appliesContract,
      contractDraft.contractEndDate,
      contractDraft.contractFirstPaymentDate,
      contractDraft.contractPaymentFrequency,
    ]
  );
  const canCreateFromSelectedOrigin =
    selectedOriginIdNumber > 0 &&
    !isLoadingSelectedOriginDetail &&
    selectedOriginItemIds.length > 0 &&
    !originDraftValidationMessage &&
    !createFromOriginMutation.isPending &&
    !preparingOrderAttachment &&
    !uploadPendingAttachmentMutation.isPending;

  const handlePendingOrderAttachmentChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setPreparingOrderAttachment(true);
    try {
      const preparedAttachments: PendingOrderAttachment[] = [];
      for (const file of files) {
        const prepared = await prepareDocumentAttachment(file);
        preparedAttachments.push({
          ...prepared,
          id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()
            .toString(36)
            .slice(2)}`,
        });
      }
      setPendingOrderAttachments(current => [
        ...current,
        ...preparedAttachments,
      ]);
      toast.success(
        preparedAttachments.length === 1
          ? "Adjunto listo para subir"
          : `${preparedAttachments.length} adjuntos listos para subir`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo preparar el adjunto"
      );
    } finally {
      setPreparingOrderAttachment(false);
    }
  };

  const removePendingOrderAttachment = (id: string) => {
    setPendingOrderAttachments(current =>
      current.filter(attachment => attachment.id !== id)
    );
  };

  useEffect(() => {
    if (!newOrderDialogOpen || selectedOriginItems.length === 0) {
      setOriginItemDrafts(current =>
        Object.keys(current).length > 0 ? {} : current
      );
      return;
    }

    setOriginItemDrafts(current => {
      let changed = Object.keys(current).length !== selectedOriginItems.length;
      const nextEntries = selectedOriginItems.map((item: any) => {
        const draft = current[item.id] ?? getDefaultOriginItemDraft(item);
        if (!current[item.id]) {
          changed = true;
        }
        return [item.id, draft];
      });

      return changed ? Object.fromEntries(nextEntries) : current;
    });
  }, [newOrderDialogOpen, selectedOriginItems]);

  useEffect(() => {
    setSelectedSupplierId(
      detail?.purchaseOrder.supplierId
        ? String(detail.purchaseOrder.supplierId)
        : ""
    );
  }, [detail?.purchaseOrder.id, detail?.purchaseOrder.supplierId]);

  useEffect(() => {
    if (!detail?.purchaseOrder) {
      setContractDraft(DEFAULT_CONTRACT_DRAFT);
      return;
    }

    setContractDraft({
      appliesContract: detail.purchaseOrder.appliesContract === true,
      contractPaymentFrequency:
        detail.purchaseOrder.contractPaymentFrequency ?? "mensual",
      contractFirstPaymentDate: dateInputValue(
        detail.purchaseOrder.contractFirstPaymentDate
      ),
      contractEndDate: dateInputValue(detail.purchaseOrder.contractEndDate),
      contractNote: "",
    });
  }, [
    detail?.purchaseOrder.id,
    detail?.purchaseOrder.appliesContract,
    detail?.purchaseOrder.contractPaymentFrequency,
    detail?.purchaseOrder.contractFirstPaymentDate,
    detail?.purchaseOrder.contractEndDate,
  ]);

  useEffect(() => {
    if (!detail?.items) {
      setItemDrafts({});
      return;
    }

    setItemDrafts(
      Object.fromEntries(
        detail.items.map((item: any) => [
          item.id,
          (() => {
            const quantity = String(item.quantity ?? "0.00");
            const unitPrice = formatMoneyDisplay(item.unitPrice ?? "0.00");
            const subtotal =
              item.subtotal !== null && item.subtotal !== undefined
                ? formatMoneyDisplay(item.subtotal)
                : calculateSubtotalDraftValue(quantity, unitPrice);
            return {
              quantity,
              unitPrice,
              subtotal,
              taxCode: normalizePurchaseOrderTaxCode(
                item.taxCode,
                activeSalesTaxes
              ),
              additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
                item.additionalTaxCodes,
                item.taxCode,
                activeSalesTaxes
              ),
              itemName:
                getTemporaryFixedAssetRequestedName(item) ??
                String(item.itemName ?? ""),
            };
          })(),
        ])
      )
    );
  }, [activeSalesTaxes, detail?.items, detail?.purchaseOrder.id]);

  useEffect(() => {
    if (
      !canEditOrderStructure ||
      !detail?.items?.length ||
      !latestSupplierPrices
    ) {
      return;
    }

    const updates: Array<{
      itemId: number;
      draft: PurchaseOrderItemDraft;
    }> = [];
    const nextDrafts = { ...itemDrafts };

    for (const item of detail.items) {
      const sapCode = item.currentSapItemCode ?? item.originalSapItemCode;
      if (!sapCode) continue;

      const latestPrice = latestSupplierPrices[sapCode];
      if (!latestPrice?.unitPrice) continue;

      const currentDraft = itemDrafts[item.id] ?? {
        quantity: String(item.quantity ?? "0.00"),
        unitPrice: formatMoneyDisplay(item.unitPrice ?? "0.00"),
        subtotal:
          item.subtotal !== null && item.subtotal !== undefined
            ? formatMoneyDisplay(item.subtotal)
            : calculateSubtotalDraftValue(item.quantity, item.unitPrice),
        taxCode: normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes),
        additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
          item.additionalTaxCodes,
          item.taxCode,
          activeSalesTaxes
        ),
        itemName:
          getTemporaryFixedAssetRequestedName(item) ?? String(item.itemName ?? ""),
      };

      if (Number(item.unitPrice ?? 0) > 0) continue;
      if (Number(currentDraft.unitPrice ?? 0) > 0) continue;

      const nextDraft = {
        ...currentDraft,
        unitPrice: latestPrice.unitPrice,
        subtotal: calculateSubtotalDraftValue(
          currentDraft.quantity,
          latestPrice.unitPrice
        ),
      };

      nextDrafts[item.id] = nextDraft;
      updates.push({
        itemId: item.id,
        draft: nextDraft,
      });
    }

    if (updates.length === 0) return;

    setItemDrafts(nextDrafts);
    for (const update of updates) {
      updateItemLineMutation.mutate({
        purchaseOrderItemId: update.itemId,
        quantity: update.draft.quantity,
        unitPrice: update.draft.unitPrice,
        subtotal: update.draft.subtotal,
        taxCode: update.draft.taxCode,
        additionalTaxCodes: update.draft.additionalTaxCodes,
      });
    }
  }, [activeSalesTaxes, canEditOrderStructure, detail?.items, latestSupplierPrices]);

  const getItemDraft = (item: any): PurchaseOrderItemDraft =>
    itemDrafts[item.id] ?? {
      quantity: String(item.quantity ?? "0.00"),
      unitPrice: formatMoneyDisplay(item.unitPrice ?? "0.00"),
      subtotal:
        item.subtotal !== null && item.subtotal !== undefined
          ? formatMoneyDisplay(item.subtotal)
          : calculateSubtotalDraftValue(item.quantity, item.unitPrice),
      taxCode: normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes),
      additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
        item.additionalTaxCodes,
        item.taxCode,
        activeSalesTaxes
      ),
      itemName:
        getTemporaryFixedAssetRequestedName(item) ?? String(item.itemName ?? ""),
    };

  const pricingSummary = useMemo(
    () =>
      summarizePurchaseOrderLines(
        items.map((item: any) => {
          const draft = normalizeDraftMoneyValues(getItemDraft(item));
          return {
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            subtotal: draft.subtotal,
            taxCode: draft.taxCode,
            additionalTaxCodes: draft.additionalTaxCodes,
          };
        }),
        activeSalesTaxes
      ),
    [activeSalesTaxes, items, itemDrafts]
  );

  const hasPendingPricingChanges = useMemo(
    () =>
      canEditOrderStructure &&
      items.some((item: any) => {
        const draft = getItemDraft(item);
        return (
          Number(draft.quantity || 0) !== Number(item.quantity ?? 0) ||
          Number(draft.unitPrice || 0) !== Number(item.unitPrice ?? 0) ||
          Number(draft.subtotal || 0) !== Number(item.subtotal ?? 0) ||
          draft.taxCode !==
            normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes) ||
          !areTaxCodeArraysEqual(
            draft.additionalTaxCodes,
            item.additionalTaxCodes
          )
        );
      }),
    [activeSalesTaxes, canEditOrderStructure, items, itemDrafts]
  );
  const hasPendingContractPriceChanges = useMemo(
    () =>
      canEditContractLinePrice &&
      items.some((item: any) => {
        const draft = getItemDraft(item);
        return (
          Number(draft.unitPrice || 0) !== Number(item.unitPrice ?? 0) ||
          Number(draft.subtotal || 0) !== Number(item.subtotal ?? 0)
        );
      }),
    [canEditContractLinePrice, items, itemDrafts]
  );
  const emissionBlockReason = useMemo(() => {
    if (!detail) return null;
    if (!selectedSupplierId && !detail.purchaseOrder.supplierId) {
      return "Seleccione un proveedor antes de emitir la OC";
    }

    const itemWithoutPrice = items.find((item: any) => {
      const unitPrice = Number(getItemDraft(item).unitPrice || 0);
      return !Number.isFinite(unitPrice) || unitPrice <= 0;
    });
    if (itemWithoutPrice) {
      return `Ingrese un precio unitario mayor que cero para ${itemWithoutPrice.itemName}`;
    }
    if (
      detail.purchaseOrder.purchaseType === "compra_directa" &&
      !detail.purchaseOrder.paymentMethod &&
      !detail.directPurchasePaymentMethod
    ) {
      return "Seleccione el método de pago para la orden de compra";
    }
    if (
      detail.purchaseOrder.appliesContract &&
      (!detail.purchaseOrder.contractPaymentFrequency ||
        !detail.purchaseOrder.contractFirstPaymentDate ||
        !detail.purchaseOrder.contractEndDate ||
        contractSummary.expectedInvoiceCount <= 0)
    ) {
      return "Complete frecuencia, primera fecha de pago y fecha de terminación del contrato";
    }

    return null;
  }, [contractSummary.expectedInvoiceCount, detail, items, itemDrafts, selectedSupplierId]);

  const confirmActionPending =
    deleteItemMutation.isPending ||
    cancelOrderMutation.isPending ||
    reopenDraftMutation.isPending ||
    closeReceiptLineMutation.isPending ||
    movePendingToPurchaseRequestMutation.isPending ||
    updateContractTermsMutation.isPending ||
    updateContractItemPriceMutation.isPending;
  const contractDraftSummary = getPurchaseOrderContractSummary({
    appliesContract: contractDraft.appliesContract,
    contractPaymentFrequency: contractDraft.contractPaymentFrequency,
    contractFirstPaymentDate: contractDraft.contractFirstPaymentDate,
    contractEndDate: contractDraft.contractEndDate,
    registeredInvoiceCount: contractSummary.registeredInvoiceCount,
  });

  const handleSupplierChange = (value: string) => {
    setSelectedSupplierId(value);
    if (!detail) return;
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }
    if (!value) {
      toast.error("Seleccione un proveedor");
      return;
    }

    const nextSupplier = (suppliersList || []).find(
      (supplier: any) => supplier.id === Number(value)
    );
    const nextSupplierEmail = nextSupplier?.email ?? "";
    const supplierChanged =
      Number(value) !== detail.purchaseOrder.supplierId ||
      nextSupplierEmail !== currentSupplierEmail;

    if (!supplierChanged) {
      return;
    }

    updateMutation.mutate({
      id: detail.purchaseOrder.id,
      supplierId: Number(value),
      supplierEmail: nextSupplier?.email ?? null,
    });
  };

  const handleSupplierContactChange = (value: string) => {
    if (!detail) return;
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }

    const contact = supplierContacts.find(
      (entry: any) => String(entry.id) === value
    );
    if (!contact) {
      toast.error("Seleccione un contacto valido");
      return;
    }

    const currentContactId = String(
      detail.purchaseOrder.supplierContactId ??
        detail.preferredSupplierContact?.id ??
        ""
    );
    if (currentContactId === value) {
      return;
    }

    updateMutation.mutate({
      id: detail.purchaseOrder.id,
      supplierContactId: Number(value),
    });
  };

  const handlePaymentMethodChange = (value: string) => {
    if (!detail) return;
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }

    const paymentMethod = value as DirectPurchasePaymentMethod;
    if (detail.purchaseOrder.paymentMethod === paymentMethod) {
      return;
    }

    updateMutation.mutate({
      id: detail.purchaseOrder.id,
      paymentMethod,
    });
  };

  const handleSaveItemLine = (item: any, draftOverride?: PurchaseOrderItemDraft) => {
    if (!canEditOrderStructure) {
      toast.error("La OC ya fue emitida y no se puede actualizar");
      return;
    }

    const rawDraft = draftOverride ?? getItemDraft(item);
    const isTemporaryFixedAsset = isTemporaryFixedAssetItem(item);
    const itemNameDraft = isTemporaryFixedAsset
      ? String(rawDraft.itemName ?? "").trim()
      : null;
    const itemNameChanged =
      isTemporaryFixedAsset &&
      Boolean(itemNameDraft) &&
      itemNameDraft !== String(item.itemName ?? "").trim();

    if (isTemporaryFixedAsset && !itemNameDraft) {
      toast.error("Ingrese lo solicitado por el usuario");
      return;
    }
    if (!rawDraft.quantity.trim()) {
      toast.error("Ingrese la cantidad");
      return;
    }
    const draft = normalizeDraftMoneyValues(rawDraft);
    if (
      Number(draft.quantity || 0) === Number(item.quantity ?? 0) &&
      Number(draft.unitPrice || 0) === Number(item.unitPrice ?? 0) &&
      Number(draft.subtotal || 0) === Number(item.subtotal ?? 0) &&
      draft.taxCode === normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes) &&
      areTaxCodeArraysEqual(draft.additionalTaxCodes, item.additionalTaxCodes)
      && !itemNameChanged
    ) {
      return;
    }
    if (!draft.unitPrice.trim()) {
      toast.error("Ingrese el precio unitario");
      return;
    }

    setSavingItemId(item.id);
    setItemDrafts(current => ({ ...current, [item.id]: draft }));
    updateItemLineMutation.mutate(
      {
        purchaseOrderItemId: item.id,
        quantity: draft.quantity,
        unitPrice: draft.unitPrice,
        subtotal: draft.subtotal,
        taxCode: draft.taxCode,
        additionalTaxCodes: draft.additionalTaxCodes,
        ...(isTemporaryFixedAsset && itemNameDraft
          ? { itemName: itemNameDraft }
          : {}),
      },
      {
        onSettled: () => {
          setSavingItemId(current => (current === item.id ? null : current));
        },
      }
    );
  };

  const handleSaveContractItemPrice = (item: any) => {
    if (canEditOrderStructure) {
      handleSaveItemLine(item);
      return;
    }
    if (!canEditContractLinePrice) {
      toast.error("Solo se puede editar precio en una OC contrato emitida");
      return;
    }

    const rawDraft = getItemDraft(item);
    const draft = normalizeDraftMoneyValues(rawDraft);
    if (
      Number(draft.unitPrice || 0) === Number(item.unitPrice ?? 0) &&
      Number(draft.subtotal || 0) === Number(item.subtotal ?? 0)
    ) {
      return;
    }
    if (!draft.unitPrice.trim()) {
      toast.error("Ingrese el precio unitario");
      return;
    }

    setSavingItemId(item.id);
    setItemDrafts(current => ({ ...current, [item.id]: draft }));
    updateContractItemPriceMutation.mutate(
      {
        purchaseOrderItemId: item.id,
        unitPrice: draft.unitPrice,
        subtotal: draft.subtotal,
      },
      {
        onSettled: () => {
          setSavingItemId(current => (current === item.id ? null : current));
        },
      }
    );
  };

  const handleSaveContractTerms = () => {
    if (!detail) return;
    if (!canEditContractTerms) {
      toast.error("No tiene permisos para editar el contrato");
      return;
    }
    if (contractDraft.appliesContract) {
      if (!contractDraft.contractFirstPaymentDate) {
        toast.error("Seleccione la primera fecha de pago");
        return;
      }
      if (!contractDraft.contractEndDate) {
        toast.error("Seleccione la fecha de terminación");
        return;
      }
      if (
        new Date(`${contractDraft.contractEndDate}T12:00:00`) <
        new Date(`${contractDraft.contractFirstPaymentDate}T12:00:00`)
      ) {
        toast.error(
          "La fecha de terminación no puede ser anterior a la primera fecha de pago"
        );
        return;
      }
    }

    updateContractTermsMutation.mutate({
      id: detail.purchaseOrder.id,
      appliesContract: contractDraft.appliesContract,
      contractPaymentFrequency: contractDraft.appliesContract
        ? contractDraft.contractPaymentFrequency
        : null,
      contractFirstPaymentDate: contractDraft.appliesContract
        ? contractDraft.contractFirstPaymentDate
        : null,
      contractEndDate: contractDraft.appliesContract
        ? contractDraft.contractEndDate
        : null,
      contractNote: contractDraft.contractNote,
    });
  };

  const getDeleteBlockReason = (item: any) => {
    if (!canEditOrderStructure) {
      return "No se pueden eliminar lineas de una orden emitida";
    }
    if (Number(item.receivedQuantity ?? 0) > 0) {
      return "No se puede eliminar una linea que ya tiene recepciones registradas";
    }
    return null;
  };

  const canCloseReceiptLine = (item: any) => {
    const orderedQuantity = Number(item.quantity ?? 0);
    const receivedQuantity = Number(item.receivedQuantity ?? 0);
    return (
      !isOrderReadOnly &&
      !item.receiptClosed &&
      RECEIPT_CLOSABLE_ORDER_STATUSES.has(detail?.purchaseOrder.status ?? "") &&
      receivedQuantity > 0 &&
      receivedQuantity < orderedQuantity
    );
  };

  const handleDeleteItem = (item: any) => {
    const blockReason = getDeleteBlockReason(item);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }

    setConfirmState({
      kind: "delete-item",
      itemId: item.id,
      itemName: item.itemName,
      isLastItem: items.length <= 1,
    });
  };

  const handleCloseReceiptLine = (item: any) => {
    if (!canCloseReceiptLine(item)) {
      toast.error(
        "Solo se pueden cerrar líneas que estén parcialmente recibidas"
      );
      return;
    }

    const pendingQuantity = Math.max(
      Number(item.quantity ?? 0) - Number(item.receivedQuantity ?? 0),
      0
    );

    setConfirmState({
      kind: "close-receipt-line",
      itemId: item.id,
      itemName: item.itemName,
      pendingQuantity,
      unit: item.unit ?? null,
    });
  };

  const handleCancelOrder = () => {
    if (!detail) return;
    if (!canManagePurchaseOrders) {
      toast.error("El Bodeguero de Proyecto solo puede consultar la OC");
      return;
    }
    if (hasReceivedItems) {
      toast.error(
        "No se puede cancelar una orden que ya tiene recepciones registradas"
      );
      return;
    }

    setConfirmState({
      kind: "cancel-order",
      orderId: detail.purchaseOrder.id,
      orderNumber: detail.purchaseOrder.orderNumber,
    });
  };

  const handleConfirmAction = () => {
    if (confirmState.kind === "delete-item") {
      setDeletingItemId(confirmState.itemId);
      deleteItemMutation.mutate(
        { purchaseOrderItemId: confirmState.itemId },
        {
          onSuccess: () => {
            setReplaceItemId(current =>
              current === confirmState.itemId ? null : current
            );
            setConfirmState({ kind: null });
          },
          onSettled: () => {
            setDeletingItemId(current =>
              current === confirmState.itemId ? null : current
            );
          },
        }
      );
      return;
    }

    if (confirmState.kind === "cancel-order") {
      cancelOrderMutation.mutate(
        { id: confirmState.orderId },
        {
          onSuccess: () => {
            setConfirmState({ kind: null });
          },
        }
      );
      return;
    }

    if (confirmState.kind === "close-receipt-line") {
      closeReceiptLineMutation.mutate({
        purchaseOrderItemId: confirmState.itemId,
      });
    }
  };

  const handleMovePendingToPurchaseRequest = () => {
    if (confirmState.kind !== "close-receipt-line") return;
    movePendingToPurchaseRequestMutation.mutate({
      purchaseOrderItemId: confirmState.itemId,
    });
  };

  const handlePrintPurchaseOrder = () => {
    if (!detail) return;

    const purchaseOrder = detail.purchaseOrder;
    const shouldPrintDraftWatermark = purchaseOrder.status === "borrador";
    const supplierName = detail.supplier?.name ?? "Proveedor pendiente";
    const supplierRtn = detail.supplier?.rtn || "-";
    const projectLabel = detail.project
      ? `${detail.project.code} ${detail.project.name}`
      : `Proyecto ${purchaseOrder.projectId}`;
    const originalRequester = (detail as any).originalRequester;
    const requestedByLabel =
      originalRequester?.name ||
      originalRequester?.email ||
      detail.createdBy?.name ||
      user?.name ||
      "-";
    const createdByLabel = formatPurchaseOrderCreatedBy(detail);
    const preparedByLabel =
      createdByLabel !== "—"
        ? createdByLabel
        : user?.name || user?.email || "-";
    const originalRequestNumbers = Array.isArray(
      (detail as any).originalRequestNumbers
    )
      ? ((detail as any).originalRequestNumbers as unknown[])
          .map(value => String(value ?? "").trim())
          .filter(Boolean)
      : [];
    const originalRequestLabel =
      originalRequestNumbers.length > 0
        ? Array.from(new Set(originalRequestNumbers)).join(", ")
        : detail.purchaseRequest?.materialRequestId
          ? `REQ #${detail.purchaseRequest.materialRequestId}`
          : "-";
    const salesAdvisorLabel = formatSupplierContactPrintLabel(
      detail.preferredSupplierContact
    );
    const deliveryDate = purchaseOrder.neededBy
      ? formatPrintDate(purchaseOrder.neededBy)
      : "INMEDIATA";
    const observations = purchaseOrder.notes?.trim() || "-";
    const quoteLabel = detail.purchaseRequest?.quoteAttachmentId
      ? String(detail.purchaseRequest.quoteAttachmentId)
      : "-";
    const itemRows = items
      .map((item: any, index: number) => {
        const draft = getItemDraft(item);
        const partNumberLabel =
          item.partNumber ||
          item.catalogItem?.partNumber ||
          item.currentSapItemCode ||
          item.originalSapItemCode ||
          "-";
        const targetLabel = formatPurchaseOrderItemTargetLabel(item);
        const brandLine =
          item.brand || item.catalogItem?.brand
            ? `<div class="item-meta">Marca: ${escapeHtml(
                item.brand || item.catalogItem?.brand
              )}</div>`
            : "";
        const printItemName = isTemporaryFixedAssetItem(item)
          ? draft.itemName?.trim() ||
            getTemporaryFixedAssetRequestedName(item) ||
            item.itemName
          : item.itemName;
        const amounts = calculatePurchaseOrderLineAmounts({
          quantity: draft.quantity,
          unitPrice: draft.unitPrice,
          subtotal: draft.subtotal,
          taxCode: draft.taxCode,
          additionalTaxCodes: draft.additionalTaxCodes,
          taxes: activeSalesTaxes,
        });
        return `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(printItemName)}${brandLine}</td>
            <td>${escapeHtml(targetLabel)}</td>
            <td class="center">${escapeHtml(partNumberLabel)}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(draft.quantity))}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(draft.unitPrice))}</td>
            <td class="numeric">${escapeHtml(formatPrintMoney(amounts.subtotal))}</td>
          </tr>
        `;
      })
      .join("");
    const fiscalSummaryRows = getPurchaseOrderFiscalSummaryRows(pricingSummary)
      .map(row => `
        <tr>
          <td>${escapeHtml(
            row.label.replace(/\blempiras\b/gi, "").replace(/\s+/g, " ").trim()
          )}</td>
          <td class="numeric">${escapeHtml(formatPrintMoney(row.value))}</td>
        </tr>
      `)
      .join("");

    const printWindow = window.open("", "_blank", "width=840,height=1000");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(purchaseOrder.orderNumber)}</title>
          <style>
            @page { size: A4 portrait; margin: 7mm; }
            * { box-sizing: border-box; }
            body {
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9.8px;
              margin: 0;
              background: #fff;
            }
            .draft-watermark {
              align-items: center;
              color: rgba(120, 120, 120, 0.18);
              display: flex;
              font-size: 72px;
              font-weight: 900;
              inset: 0;
              justify-content: center;
              letter-spacing: 12px;
              line-height: 1;
              pointer-events: none;
              position: fixed;
              text-transform: uppercase;
              transform: rotate(-32deg);
              z-index: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 196mm;
              padding: 0 1mm 3mm;
              position: relative;
              z-index: 1;
            }
            .header {
              align-items: start;
              display: grid;
              grid-template-columns: 112px 1fr 86px;
              gap: 8px;
            }
            .logo {
              display: block;
              height: 56px;
              object-fit: contain;
              width: 108px;
            }
            .title {
              font-size: 13px;
              font-weight: 800;
              line-height: 1.15;
              text-align: center;
              text-transform: uppercase;
            }
            .title .company {
              font-size: 15px;
            }
            .rule {
              border-top: 4px double #111;
              margin: 3px 0 8px;
            }
            .meta {
              display: grid;
              gap: 8px;
              grid-template-columns: 1.08fr 0.78fr 1fr;
            }
            .meta-left,
            .meta-mid,
            .meta-right {
              display: grid;
              gap: 3px;
            }
            .field {
              display: grid;
              gap: 4px;
              grid-template-columns: 86px 1fr;
            }
            .meta-mid .field {
              grid-template-columns: 66px 1fr;
            }
            .meta-right .field {
              grid-template-columns: 86px 1fr;
            }
            .label {
              font-weight: 800;
            }
              .value {
                font-weight: 700;
                overflow-wrap: anywhere;
              }
              table {
                border-collapse: collapse;
                margin-top: 8px;
                table-layout: fixed;
                width: 100%;
              }
            th {
              border-bottom: 2px solid #111;
              font-weight: 800;
                padding: 3px 4px;
              text-align: center;
            }
            td {
              border-bottom: 1px solid #111;
                padding: 3px 4px;
                overflow-wrap: anywhere;
              vertical-align: top;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
              .item-meta {
                color: #000;
                font-size: 8.4px;
                margin-top: 1px;
              }
            .summary-row {
              display: flex;
              justify-content: flex-end;
              margin-top: 4px;
            }
            .summary {
              border-collapse: collapse;
              display: inline-table;
              font-size: 8px;
              line-height: 0.95;
              margin-top: 0;
              table-layout: auto;
              width: auto;
            }
            .summary td {
              border-bottom: 1px solid #111;
              font-weight: 800;
              height: 11px;
              padding: 0 3px;
              white-space: nowrap;
            }
            .summary td:first-child {
              min-width: 0;
              padding-right: 10px;
              text-align: left;
            }
            .summary td.numeric {
              min-width: 54px;
            }
            .signatures {
              display: grid;
              gap: 48px;
              grid-template-columns: repeat(2, 150px);
              justify-content: center;
              margin: 16px 0 10px;
            }
            .signature {
              font-size: 9.4px;
              font-weight: 700;
              text-align: center;
            }
            .signature-name {
              font-size: 9px;
              min-height: 18px;
              overflow-wrap: anywhere;
            }
            .signature-line {
              border-top: 2px solid #111;
              padding-top: 5px;
            }
            .note {
              border: 2px solid #111;
              border-radius: 10px;
              font-size: 9.2px;
              line-height: 1.2;
              margin: 8px auto 0;
              max-width: 100%;
              padding: 6px 10px;
              text-align: center;
            }
            .note-title {
              display: block;
              font-weight: 800;
              margin-bottom: 2px;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          ${shouldPrintDraftWatermark ? '<div class="draft-watermark">BORRADOR</div>' : ""}
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS SA DE CV</div>
                <div>RTN: 08019013549808</div>
                <div>ORDEN DE COMPRA</div>
                <div>${escapeHtml(projectLabel)}</div>
              </div>
              <div></div>
            </section>
            <div class="rule"></div>

            <section class="meta">
              <div class="meta-left">
                <div class="field">
                  <div class="label">Fecha:</div>
                  <div class="value">${escapeHtml(formatPrintDate(purchaseOrder.createdAt))}</div>
                </div>
                <div class="field">
                  <div class="label">Proveedor:</div>
                  <div class="value">${escapeHtml(supplierName)}</div>
                </div>
                <div class="field">
                  <div class="label">RTN Proveedor:</div>
                  <div class="value">${escapeHtml(supplierRtn)}</div>
                </div>
                <div class="field">
                  <div class="label">Asesor Vta:</div>
                  <div class="value">${escapeHtml(salesAdvisorLabel)}</div>
                </div>
              </div>
              <div class="meta-mid">
                <div class="field">
                  <div class="label">Pedido:</div>
                  <div class="value">${escapeHtml(purchaseOrder.id)}</div>
                </div>
                <div class="field">
                  <div class="label">F Pago:</div>
                  <div class="value">CREDITO</div>
                </div>
                <div class="field">
                  <div class="label">Moneda:</div>
                  <div class="value">LEMPIRA</div>
                </div>
                <div class="field">
                  <div class="label">O Compra:</div>
                  <div class="value">${escapeHtml(purchaseOrder.orderNumber)}</div>
                </div>
                <div class="field">
                  <div class="label">Entrega:</div>
                  <div class="value">${escapeHtml(deliveryDate)}</div>
                </div>
              </div>
              <div class="meta-right">
                <div class="field">
                  <div class="label">Solicitado:</div>
                  <div class="value">${escapeHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Requisición:</div>
                  <div class="value">${escapeHtml(originalRequestLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Observaciones:</div>
                  <div class="value">${escapeHtml(observations)}</div>
                </div>
                <div class="field">
                  <div class="label">Cotización:</div>
                  <div class="value">${escapeHtml(quoteLabel)}</div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 8%;">Ítem</th>
                  <th style="width: 28%;">Descripcion</th>
                  <th style="width: 20%;">Destino</th>
                  <th style="width: 14%;">No. Parte</th>
                  <th style="width: 10%;">Cantidad</th>
                  <th style="width: 10%;">Valor U</th>
                  <th style="width: 10%;">Valor T</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="7">Sin ítems</td></tr>`}
              </tbody>
            </table>

            <section class="summary-row">
              <table class="summary">
                <tbody>
                  ${fiscalSummaryRows}
                </tbody>
              </table>
            </section>

            <section class="signatures">
              <div class="signature">
                <div class="signature-name">${escapeHtml(preparedByLabel)}</div>
                <div class="signature-line">Elaborado por:</div>
              </div>
              <div class="signature">
                <div class="signature-name">&nbsp;</div>
                <div class="signature-line">Autorizado por:</div>
              </div>
            </section>

            <section class="note">
              <span class="note-title">Tomar Nota:</span>
              Emitir factura a nombre de: HIDALGO e HIDALGO HONDURAS SA DE CV; RTN: 08019013549808;
              Dirección: Blvd. Suyapa, Edificio Metropolis, Torre 2, Piso 20, Ofi. 22004.
              <br />
              Presentar con la factura su constancia de estar sujetos al RÉGIMEN DE PAGOS A CUENTA vigente,
              caso contrario se procederá con las retenciones correspondientes.
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
  };

  const exportPurchaseOrdersCsv = () => {
    downloadCsv(
      buildDatedCsvFileName("ordenes-compra"),
      [
        {
          header: "No. OC",
          value: (row: any) => row.purchaseOrder.orderNumber,
        },
        {
          header: "No. Req.",
          value: (row: any) => formatPurchaseOrderRequestNumbers(row),
        },
        {
          header: "Clasificación",
          value: (row: any) => row.purchaseOrder.classification,
        },
        {
          header: "Proyecto",
          value: (row: any) =>
            row.project ? `${row.project.code} — ${row.project.name}` : "—",
        },
        {
          header: "Requiriente",
          value: (row: any) => formatPurchaseOrderRequestedBy(row),
        },
        {
          header: "Creada por",
          value: (row: any) => formatPurchaseOrderCreatedBy(row),
        },
        {
          header: "Tipo Compra",
          value: (row: any) =>
            PURCHASE_TYPE_LABELS[row.purchaseOrder.purchaseType] || "—",
        },
        {
          header: "Proveedor",
          value: (row: any) => row.supplier?.name || "Proveedor pendiente",
        },
        {
          header: "RTN proveedor",
          value: (row: any) => row.supplier?.rtn || "—",
        },
        {
          header: "Estatus",
          value: (row: any) =>
            row.purchaseOrder.appliesContract
              ? row.contractSummary?.statusLabel || "Contrato"
              : STATUS_LABELS[row.purchaseOrder.status] ||
                row.purchaseOrder.status,
        },
        {
          header: "Emisión",
          value: (row: any) =>
            EMISSION_STATUS_LABELS[row.purchaseOrder.status] || "Pendiente",
        },
      ],
      filteredOrders
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Órdenes de Compra</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={exportPurchaseOrdersCsv}
            disabled={!filteredOrders.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          {canCreatePurchaseOrder ? (
            <Button onClick={() => setNewOrderDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Nueva OC
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por OC, REQ, proyecto, proveedor, requiriente o creador..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={purchaseTypeFilter} onValueChange={setPurchaseTypeFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Tipo de compra" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="compra_directa">Compra Directa</SelectItem>
            <SelectItem value="local">Compra Local</SelectItem>
            <SelectItem value="extranjera">Compra Extranjera</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando órdenes de compra...
            </div>
          ) : !(orders || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay órdenes de compra registradas
            </div>
          ) : !filteredOrders.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay órdenes de compra que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. OC
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Req.
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Clasificación
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Requiriente
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Creada por
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo Compra
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proveedor
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Emisión
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((row: any) => (
                    <tr
                      key={row.purchaseOrder.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-medium">
                        {row.purchaseOrder.orderNumber}
                      </td>
                      <td className="p-3 text-xs font-medium">
                        {formatPurchaseOrderRequestNumbers(row)}
                      </td>
                      <td className="p-3 text-xs uppercase">
                        {row.purchaseOrder.classification}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} — ${row.project.name}`
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {formatPurchaseOrderRequestedBy(row)}
                      </td>
                      <td className="p-3 text-xs">
                        {formatPurchaseOrderCreatedBy(row)}
                      </td>
                      <td className="p-3 text-xs">
                        {PURCHASE_TYPE_LABELS[row.purchaseOrder.purchaseType] || "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.supplier ? (
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">
                              {row.supplier.name}
                            </div>
                            <div className="text-muted-foreground">
                              RTN: {formatSupplierRtnLabel(row.supplier)}
                            </div>
                          </div>
                        ) : (
                          "Proveedor pendiente"
                        )}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            row.purchaseOrder.appliesContract
                              ? row.contractSummary?.isExpired
                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                : row.contractSummary?.expiresSoon
                                  ? "border-amber-300 bg-amber-50 text-amber-800"
                                  : "border-cyan-300 bg-cyan-50 text-cyan-700"
                              : STATUS_COLORS[row.purchaseOrder.status] || ""
                          }`}
                        >
                          {row.purchaseOrder.appliesContract
                            ? row.contractSummary?.statusLabel || "Contrato"
                            : STATUS_LABELS[row.purchaseOrder.status] ||
                              row.purchaseOrder.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {EMISSION_STATUS_LABELS[row.purchaseOrder.status] ||
                          "Pendiente"}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.purchaseOrder.id)}
                        >
                          Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={false}
        onOpenChange={open => {
          setNewOrderDialogOpen(open);
          if (!open) {
            setOriginPopoverOpen(false);
            setOriginSearch("");
            setSelectedOriginId("");
            setOriginItemDrafts({});
          }
        }}
      >
        <DialogContent className="scrollbar-visible max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[980px] overflow-y-auto rounded-2xl p-5 sm:p-6">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <DialogTitle className="text-2xl font-bold tracking-tight">
              Nueva orden de compra
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-12">
              <div className="space-y-2 md:col-span-8">
                <Label>Origen</Label>
                <Popover
                  open={originPopoverOpen}
                  onOpenChange={setOriginPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={originPopoverOpen}
                      className="h-11 w-full justify-between overflow-hidden px-3 font-normal"
                    >
                      <span className="truncate">
                        {selectedOriginRow
                          ? getPurchaseRequestOriginLabel(selectedOriginRow)
                          : "Seleccione una solicitud de compra"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Buscar SC por número, proyecto o documento..."
                        value={originSearch}
                        onValueChange={setOriginSearch}
                      />
                      <CommandList>
                        {isLoadingPurchaseRequestOrigins ? (
                          <div className="p-3 text-sm text-muted-foreground">
                            Cargando orígenes...
                          </div>
                        ) : (
                          <>
                            <CommandEmpty>No hay orígenes disponibles.</CommandEmpty>
                            <CommandGroup heading="Solicitudes de compra">
                              {purchaseRequestOriginRows.map((row: any) => {
                                const originId = String(row.purchaseRequest.id);
                                const selected = selectedOriginId === originId;

                                return (
                                  <CommandItem
                                    key={row.purchaseRequest.id}
                                    value={getPurchaseRequestOriginLabel(row)}
                                    onSelect={() => {
                                      setSelectedOriginId(originId);
                                      setOriginPopoverOpen(false);
                                      setOriginSearch("");
                                    }}
                                  >
                                    <Check
                                      className={`mr-2 h-4 w-4 ${
                                        selected ? "opacity-100" : "opacity-0"
                                      }`}
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">
                                        {getPurchaseRequestOriginLabel(row)}
                                      </p>
                                      <p className="truncate text-xs text-muted-foreground">
                                        {PURCHASE_TYPE_LABELS[
                                          row.purchaseRequest.purchaseType
                                        ] || row.purchaseRequest.purchaseType}
                                        {row.purchaseRequest.sapDocumentNumber
                                          ? ` · ${row.purchaseRequest.sapDocumentNumber}`
                                          : ""}
                                      </p>
                                    </div>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2 md:col-span-4">
                <Label>Tipo de compra</Label>
                <div className="flex h-11 items-center rounded-md border border-input bg-muted/20 px-3 text-sm font-medium">
                  {selectedOriginDetail
                    ? PURCHASE_TYPE_LABELS[
                        selectedOriginDetail.purchaseRequest.purchaseType
                      ] || selectedOriginDetail.purchaseRequest.purchaseType
                    : "Pendiente"}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Ítems del origen</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedOriginDetail
                      ? `${selectedOriginItemIds.length} ítem(s) · ${formatQuantity(
                          selectedOriginTotalPendingQuantity
                        )} pendiente`
                      : "Seleccione un origen para cargar los ítems"}
                  </p>
                </div>
                {selectedOriginDetail ? (
                  <Badge variant="outline" className="text-xs">
                    {selectedOriginDetail.purchaseRequest.requestNumber}
                  </Badge>
                ) : null}
              </div>

              {isLoadingSelectedOriginDetail ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Cargando ítems...
                </div>
              ) : selectedOriginDetail ? (
                <div className="max-h-[340px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/70">
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Ítem
                        </th>
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          SAP
                        </th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Pendiente a convertir
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOriginItems.length > 0 ? (
                        selectedOriginItems.map((item: any) => (
                          <tr
                            key={item.id}
                            className="border-b border-border/70 last:border-0"
                          >
                            <td className="p-3">
                              <p className="font-medium">
                                {getTemporaryFixedAssetDisplayName(item)}
                              </p>
                              {getTemporaryFixedAssetRequestedName(item) ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Solicitado:{" "}
                                  <span className="font-medium text-foreground">
                                    {getTemporaryFixedAssetRequestedName(item)}
                                  </span>
                                </p>
                              ) : null}
                              {item.sourceRequest?.requestNumber ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.sourceRequest.requestNumber}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-3 font-mono text-xs">
                              {item.currentSapItemCode ||
                                item.originalSapItemCode ||
                                "—"}
                            </td>
                            <td className="p-3 text-right font-medium">
                              {formatQuantity(
                                getPurchaseRequestItemPendingConversionQuantity(item)
                              )}{" "}
                              {item.unit || ""}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={3}
                            className="p-6 text-center text-sm text-muted-foreground"
                          >
                            La solicitud no tiene saldo pendiente por convertir.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No hay origen seleccionado.
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewOrderDialogOpen(false);
                  setContractDraft(DEFAULT_CONTRACT_DRAFT);
                }}
                disabled={createFromOriginMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() =>
                  createFromOriginMutation.mutate({
                    purchaseRequestId: selectedOriginIdNumber,
                    itemsToConvert: selectedOriginItemsToConvert,
                    ...selectedSupplierCreatePayload,
                    ...selectedContractCreatePayload,
                  })
                }
                disabled={!canCreateFromSelectedOrigin}
              >
                {createFromOriginMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="mr-2 h-4 w-4" />
                )}
                {createFromOriginMutation.isPending ? "Creando..." : "Crear OC"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newOrderDialogOpen || Boolean(selectedId)}
        onOpenChange={open => {
          if (!open) {
            setNewOrderDialogOpen(false);
            setOriginPopoverOpen(false);
            setOriginSearch("");
            setSelectedOriginId("");
            setSelectedId(null);
            setReplaceItemId(null);
            setReplacementSearch("");
            setSelectedSupplierId("");
            setSelectedSupplierContactId("");
            setSupplierPopoverOpen(false);
            setContactPopoverOpen(false);
            setSavingItemId(null);
            setDeletingItemId(null);
            setItemDrafts({});
            setOriginItemDrafts({});
            setPendingOrderAttachments([]);
            setPreparingOrderAttachment(false);
            setContractDraft(DEFAULT_CONTRACT_DRAFT);
            setConfirmState({ kind: null });
          }
        }}
      >
        <DialogContent className="scrollbar-visible max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1600px] sm:p-6 lg:p-7">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-[2.1rem] font-bold tracking-tight sm:text-[2.5rem]">
                {newOrderDialogOpen
                  ? "Nueva orden de compra"
                  : detail?.purchaseOrder.orderNumber || "Orden de Compra"}
              </DialogTitle>
              {newOrderDialogOpen ? (
                <Badge
                  variant="outline"
                  className={`text-sm ${STATUS_COLORS.borrador}`}
                >
                  Borrador
                </Badge>
              ) : detail?.purchaseOrder.status ? (
                  <Badge
                    variant="outline"
                    className={`text-sm ${
                      detail.purchaseOrder.appliesContract
                        ? contractSummary.isExpired
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : contractSummary.expiresSoon
                            ? "border-amber-300 bg-amber-50 text-amber-800"
                            : "border-cyan-300 bg-cyan-50 text-cyan-700"
                        : STATUS_COLORS[detail.purchaseOrder.status] || ""
                    }`}
                  >
                    {detail.purchaseOrder.appliesContract
                      ? contractSummary.statusLabel
                      : STATUS_LABELS[detail.purchaseOrder.status] ||
                        detail.purchaseOrder.status}
                  </Badge>
              ) : null}
            </div>
          </DialogHeader>

          {newOrderDialogOpen ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(22rem,1.45fr)_minmax(22rem,1.45fr)_minmax(8.5rem,0.65fr)_minmax(14rem,0.8fr)_minmax(8.5rem,0.65fr)]">
                <div className="min-w-0 space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Origen
                  </Label>
                  <Popover
                    open={originPopoverOpen}
                    onOpenChange={setOriginPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={originPopoverOpen}
                        className="h-11 w-full justify-between overflow-hidden px-3 text-sm font-normal sm:h-12 sm:text-base"
                      >
                        <span className="truncate">
                          {selectedOriginRow
                            ? getPurchaseRequestOriginLabel(selectedOriginRow)
                            : "Seleccione una solicitud de compra"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Buscar SC por número, proyecto o documento..."
                          value={originSearch}
                          onValueChange={setOriginSearch}
                        />
                        <CommandList>
                          {isLoadingPurchaseRequestOrigins ? (
                            <div className="p-3 text-sm text-muted-foreground">
                              Cargando orígenes...
                            </div>
                          ) : (
                            <>
                              <CommandEmpty>No hay orígenes disponibles.</CommandEmpty>
                              <CommandGroup heading="Solicitudes de compra">
                                {purchaseRequestOriginRows.map((row: any) => {
                                  const originId = String(row.purchaseRequest.id);
                                  const selected = selectedOriginId === originId;

                                  return (
                                    <CommandItem
                                      key={row.purchaseRequest.id}
                                      value={getPurchaseRequestOriginLabel(row)}
                                      onSelect={() => {
                                        setSelectedOriginId(originId);
                                        setSelectedSupplierContactId("");
                                        setOriginPopoverOpen(false);
                                        setOriginSearch("");
                                      }}
                                    >
                                      <Check
                                        className={`h-4 w-4 ${
                                          selected ? "opacity-100" : "opacity-0"
                                        }`}
                                      />
                                      <span className="truncate">
                                        {getPurchaseRequestOriginLabel(row)}
                                      </span>
                                    </CommandItem>
                                  );
                                })}
                              </CommandGroup>
                            </>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {selectedOriginDetail
                      ? getPurchaseRequestProjectLabel(selectedOriginRow)
                    : "Selecciona el origen para cargar los ítems."}
                  </p>
                </div>

                <div className="min-w-0 space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Proveedor
                  </Label>
                  <Popover
                    open={supplierPopoverOpen}
                    onOpenChange={setSupplierPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={supplierPopoverOpen}
                        className="h-11 w-full justify-between overflow-hidden px-3 text-sm font-normal sm:h-12 sm:text-base"
                      >
                        <span className="truncate">
                          {formatSupplierOptionLabel(selectedSupplier)}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <SupplierCommandList
                        suppliers={suppliersList || []}
                        selectedSupplierId={selectedSupplierId}
                        onSelect={(supplierId) => {
                          setSelectedSupplierId(supplierId);
                          setSelectedSupplierContactId("");
                          setSupplierPopoverOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  {selectedSupplier ? (
                    <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">
                      <p>
                        {selectedSupplier.email ||
                          "Proveedor sin correo configurado"}
                      </p>
                      <p>RTN: {formatSupplierRtnLabel(selectedSupplier)}</p>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Seleccione proveedor antes de crear la OC.
                    </p>
                  )}
                  <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Contacto preferible
                    </p>
                    <Popover
                      open={contactPopoverOpen}
                      onOpenChange={setContactPopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={contactPopoverOpen}
                          className="mt-2 h-10 w-full justify-between overflow-hidden px-3 text-left text-sm font-normal"
                          disabled={
                            !selectedSupplierIdNumber ||
                            !selectedOriginProjectId ||
                            supplierContacts.length === 0
                          }
                        >
                          <span className="truncate">
                            {!selectedSupplierIdNumber ||
                            !selectedOriginProjectId
                              ? "Seleccione origen y proveedor"
                              : supplierContacts.length === 0 &&
                                  !selectedSupplierContact
                                ? "Sin contactos registrados"
                                : formatSupplierContactOptionLabel(
                                    selectedSupplierContact
                                  )}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                      >
                        <SupplierContactCommandList
                          contacts={supplierContacts}
                          selectedContactId={selectedSupplierContactId}
                          onSelect={contactId => {
                            setSelectedSupplierContactId(contactId);
                            setContactPopoverOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    {formatSupplierContactMeta(selectedSupplierContact) ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {formatSupplierContactMeta(selectedSupplierContact)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                  <Label className="break-words text-[11px] uppercase tracking-[0.1em] text-muted-foreground sm:text-xs">
                    Clasificación
                  </Label>
                  <p className="text-base font-semibold uppercase leading-tight sm:text-lg">
                    OC
                  </p>
                </div>

                <div className="min-w-0 space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                  <Label className="break-words text-[11px] uppercase tracking-[0.1em] text-muted-foreground sm:text-xs">
                    Fecha necesaria
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {selectedOriginDetail?.purchaseRequest.neededBy
                      ? new Date(
                          selectedOriginDetail.purchaseRequest.neededBy
                        ).toLocaleDateString("es-HN")
                      : "—"}
                  </p>
                </div>

                <div className="min-w-0 space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4">
                  <Label className="break-words text-[11px] uppercase tracking-[0.1em] text-muted-foreground sm:text-xs">
                    Estado de emisión
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    Pendiente
                  </p>
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="purchase-order-contract"
                      checked={contractDraft.appliesContract}
                      disabled={!canEditContractSetup}
                      onCheckedChange={checked =>
                        setContractDraft(current => ({
                          ...current,
                          appliesContract: checked === true,
                        }))
                      }
                    />
                    <Label
                      htmlFor="purchase-order-contract"
                      className="text-base font-semibold"
                    >
                      Aplica contrato
                    </Label>
                    {contractDraft.appliesContract ? (
                      <Badge
                        variant="outline"
                        className={
                          contractDraftSummary.isExpired
                            ? "border-rose-300 text-rose-700"
                            : contractDraftSummary.expiresSoon
                              ? "border-amber-300 text-amber-700"
                              : "border-emerald-300 text-emerald-700"
                        }
                      >
                        {contractDraftSummary.statusLabel}
                      </Badge>
                    ) : null}
                  </div>
                  {contractDraft.appliesContract ? (
                    <div className="text-sm text-muted-foreground">
                      Facturas creadas:{" "}
                      <span className="font-semibold text-foreground">
                        {contractSummary.registeredInvoiceCount}
                      </span>
                    </div>
                  ) : null}
                </div>

                {contractDraft.appliesContract ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Frecuencia de pago</Label>
                        <Select
                          value={contractDraft.contractPaymentFrequency}
                          disabled={!canEditContractSetup}
                          onValueChange={value =>
                            setContractDraft(current => ({
                              ...current,
                              contractPaymentFrequency:
                                value as PurchaseOrderContractFrequency,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PURCHASE_ORDER_CONTRACT_FREQUENCIES.map(
                              frequency => (
                                <SelectItem key={frequency} value={frequency}>
                                  {
                                    PURCHASE_ORDER_CONTRACT_FREQUENCY_LABELS[
                                      frequency
                                    ]
                                  }
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Primera fecha de pago</Label>
                        <Input
                          type="date"
                          value={contractDraft.contractFirstPaymentDate}
                          disabled={!canEditContractSetup}
                          onChange={event =>
                            setContractDraft(current => ({
                              ...current,
                              contractFirstPaymentDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha de terminación</Label>
                        <Input
                          type="date"
                          value={contractDraft.contractEndDate}
                          disabled={!canEditContractEndDate}
                          onChange={event =>
                            setContractDraft(current => ({
                              ...current,
                              contractEndDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Nota de cambio</Label>
                        <Input
                          value={contractDraft.contractNote}
                          disabled={!canEditContractEndDate}
                          onChange={event =>
                            setContractDraft(current => ({
                              ...current,
                              contractNote: event.target.value,
                            }))
                          }
                          placeholder="Motivo del cambio"
                        />
                      </div>
                    </div>

                    {contractDraftSummary.isExpired ? (
                      <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          El contrato está vencido y no permitirá agregar nuevas
                          facturas.
                        </span>
                      </div>
                    ) : contractDraftSummary.expiresSoon ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          El contrato vence en{" "}
                          {contractDraftSummary.daysUntilEnd} día(s).
                        </span>
                      </div>
                    ) : null}

                    {newOrderDialogOpen ? (
                      <Button type="button" variant="outline" disabled>
                        <Save className="mr-2 h-4 w-4" />
                        Se guarda al crear OC
                      </Button>
                    ) : canEditContractTerms ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSaveContractTerms}
                        disabled={updateContractTermsMutation.isPending}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {updateContractTermsMutation.isPending
                          ? "Guardando..."
                          : "Guardar contrato"}
                      </Button>
                    ) : null}

                    {(detail?.auditLogs ?? []).length > 0 ? (
                      <div className="rounded-xl border border-border/70 bg-background p-3">
                        <div className="mb-2 text-sm font-semibold">
                          Bitácora del contrato
                        </div>
                        <div className="space-y-2">
                          {(detail?.auditLogs ?? [])
                            .slice(0, 6)
                            .map((entry: any) => (
                              <div
                                key={entry.log.id}
                                className="grid gap-2 text-xs text-muted-foreground md:grid-cols-[1fr_1fr_1fr]"
                              >
                                <span className="font-medium text-foreground">
                                  {entry.log.field}
                                </span>
                                <span>
                                  {entry.log.oldValue || "-"} →{" "}
                                  {entry.log.newValue || "-"}
                                </span>
                                <span className="md:text-right">
                                  {entry.changedBy?.name ||
                                    entry.changedBy?.email ||
                                    `Usuario #${entry.log.changedById}`}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-[1280px] table-auto text-sm lg:text-[15px]">
                  <colgroup>
                    <col className="w-[310px]" />
                    <col className="w-[150px]" />
                    <col className="w-[210px]" />
                    <col className="w-[190px]" />
                    <col className="w-[170px]" />
                    <col className="w-[190px]" />
                    <col className="w-[130px]" />
                    <col className="w-[150px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        SAP actual
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Pendiente a convertir
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Precio unitario
                      </th>
                      <th className="whitespace-nowrap p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Impuesto
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Subtotal
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        ISV
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingSelectedOriginDetail ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-sm text-muted-foreground"
                        >
                          Cargando ítems...
                        </td>
                      </tr>
                    ) : selectedOriginDetail && selectedOriginItems.length > 0 ? (
                      selectedOriginItems.map((item: any) => {
                        const draft = getOriginItemDraft(item);
                        const pendingQuantity =
                          getPurchaseRequestItemPendingConversionQuantity(item);
                        const requestedItemName =
                          getTemporaryFixedAssetRequestedName(item);
                        const lineAmounts = calculatePurchaseOrderLineAmounts({
                          quantity: draft.quantity,
                          unitPrice: draft.unitPrice,
                          subtotal: draft.subtotal,
                          taxCode: draft.taxCode,
                          additionalTaxCodes: draft.additionalTaxCodes,
                          taxes: activeSalesTaxes,
                        });

                        return (
                          <tr
                            key={item.id}
                            className="border-b border-border last:border-0"
                          >
                            <td className="p-3 align-middle sm:p-4">
                              <div className="text-base font-semibold leading-snug sm:text-lg">
                                {getTemporaryFixedAssetDisplayName(item)}
                              </div>
                              {requestedItemName ? (
                                <div className="mt-1.5 text-sm text-muted-foreground">
                                  Solicitado:{" "}
                                  <span className="font-medium text-foreground">
                                    {requestedItemName}
                                  </span>
                                </div>
                              ) : null}
                              {(item.currentSapItemCode ||
                                item.originalSapItemCode) && (
                                <div className="mt-1.5 text-sm text-muted-foreground">
                                  Original:{" "}
                                  {item.currentSapItemCode ||
                                    item.originalSapItemCode}
                                </div>
                              )}
                            </td>
                            <td className="p-3 align-middle font-mono text-sm font-medium sm:p-4">
                              {item.currentSapItemCode ||
                                item.originalSapItemCode ||
                                "—"}
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  type="number"
                                  min="0.01"
                                  max={pendingQuantity}
                                  step="0.01"
                                  value={draft.quantity}
                                  onChange={event =>
                                    setOriginItemDrafts(current => ({
                                      ...current,
                                      [item.id]: {
                                        ...withDraftQuantity(
                                          current[item.id] ??
                                            getDefaultOriginItemDraft(item),
                                          event.target.value
                                        ),
                                      },
                                    }))
                                  }
                                  className="h-10 w-28 text-right"
                                />
                                <span className="w-12 text-left font-medium">
                                  {item.unit || ""}
                                </span>
                              </div>
                              <p className="mt-1 text-right text-xs text-muted-foreground">
                                Máx. {formatQuantity(pendingQuantity)}
                              </p>
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.unitPrice}
                                onChange={event =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: withDraftUnitPrice(
                                      current[item.id] ??
                                        getDefaultOriginItemDraft(item),
                                      event.target.value
                                    ),
                                  }))
                                }
                                onBlur={() =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: normalizeDraftMoneyValues(
                                      current[item.id] ??
                                        getDefaultOriginItemDraft(item)
                                    ),
                                  }))
                                }
                                className="h-10 text-right"
                              />
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <PurchaseOrderTaxControls
                                draft={draft}
                                taxes={activeSalesTaxes}
                                onChange={nextDraft =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: {
                                      ...(current[item.id] ??
                                        getDefaultOriginItemDraft(item)),
                                      taxCode: nextDraft.taxCode,
                                      additionalTaxCodes:
                                        nextDraft.additionalTaxCodes,
                                    },
                                  }))
                                }
                              />
                            </td>
                            <td className="p-3 align-middle sm:p-4">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.subtotal}
                                onChange={event =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: withDraftSubtotal(
                                      current[item.id] ??
                                        getDefaultOriginItemDraft(item),
                                      event.target.value
                                    ),
                                  }))
                                }
                                onBlur={() =>
                                  setOriginItemDrafts(current => ({
                                    ...current,
                                    [item.id]: normalizeDraftMoneyValues(
                                      current[item.id] ??
                                        getDefaultOriginItemDraft(item)
                                    ),
                                  }))
                                }
                                className="h-10 w-full min-w-[170px] text-right font-semibold"
                              />
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(lineAmounts.taxAmount)}
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(lineAmounts.total)}
                            </td>
                          </tr>
                        );
                      })
                    ) : selectedOriginDetail ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-sm text-muted-foreground"
                        >
                          La solicitud no tiene saldo pendiente por convertir.
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-sm text-muted-foreground"
                        >
                          Selecciona un origen para cargar los ítems.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t border-border bg-muted/10 px-3 py-4 sm:px-4">
                <FiscalSummaryCard summary={originPricingSummary} />
              </div>

              <section className="min-w-0 space-y-3 rounded-2xl border border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">Adjuntos</h3>
                  <div>
                    <input
                      ref={newOrderAttachmentInputRef}
                      type="file"
                      multiple
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handlePendingOrderAttachmentChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => newOrderAttachmentInputRef.current?.click()}
                      disabled={
                        preparingOrderAttachment ||
                        createFromOriginMutation.isPending ||
                        uploadPendingAttachmentMutation.isPending
                      }
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {preparingOrderAttachment ? "Preparando..." : "Adjuntar"}
                    </Button>
                  </div>
                </div>

                {pendingOrderAttachments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Sin archivos seleccionados.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pendingOrderAttachments.map(attachment => {
                      const AttachmentIcon = attachment.mimeType.startsWith("image/")
                        ? ImageIcon
                        : FileText;
                      return (
                        <div
                          key={attachment.id}
                          className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 p-3"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <AttachmentIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {attachment.fileName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatAttachmentSize(attachment.fileSize)}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              removePendingOrderAttachment(attachment.id)
                            }
                            disabled={
                              createFromOriginMutation.isPending ||
                              uploadPendingAttachmentMutation.isPending
                            }
                            aria-label={`Quitar ${attachment.fileName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-1">
                <p className="min-h-5 text-sm text-destructive">
                  {originDraftValidationMessage ?? ""}
                </p>
                <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 min-w-[180px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={() => {
                    setNewOrderDialogOpen(false);
                    setOriginPopoverOpen(false);
                    setOriginSearch("");
                    setSelectedOriginId("");
                    setSelectedSupplierContactId("");
                    setOriginItemDrafts({});
                    setPendingOrderAttachments([]);
                    setPreparingOrderAttachment(false);
                    setContractDraft(DEFAULT_CONTRACT_DRAFT);
                  }}
                  disabled={
                    createFromOriginMutation.isPending ||
                    uploadPendingAttachmentMutation.isPending
                  }
                >
                  Cancelar
                </Button>
                <Button
                  size="lg"
                  className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={() =>
                    createFromOriginMutation.mutate({
                      purchaseRequestId: selectedOriginIdNumber,
                      itemsToConvert: selectedOriginItemsToConvert,
                      ...selectedSupplierCreatePayload,
                      ...selectedContractCreatePayload,
                    })
                  }
                  disabled={!canCreateFromSelectedOrigin}
                >
                  {createFromOriginMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="mr-2 h-4 w-4" />
                  )}
                  {createFromOriginMutation.isPending ? "Creando..." : "Crear OC"}
                </Button>
                </div>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando detalle de la orden de compra...
            </div>
          ) : detailError ? (
            <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-5 text-sm text-destructive">
              <p>No se pudo cargar la orden de compra. {detailError.message}</p>
              <div>
                <Button variant="outline" onClick={() => void refetchDetail()}>
                  Reintentar
                </Button>
              </div>
            </div>
          ) : detail ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Clasificación
                  </Label>
                  <p className="text-base font-semibold uppercase leading-tight sm:text-lg">
                    {detail.purchaseOrder.classification}
                  </p>
                </div>
                {detail.purchaseOrder.purchaseType === "compra_directa" ||
                detail.purchaseOrder.paymentMethod ||
                detail.directPurchasePaymentMethod ? (
                  <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3 lg:col-span-2">
                    <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                      Método de pago
                    </Label>
                    {canEditOrderStructure ? (
                      <Select
                        value={
                          detail.purchaseOrder.paymentMethod ??
                          detail.directPurchasePaymentMethod ??
                          undefined
                        }
                        onValueChange={handlePaymentMethodChange}
                        disabled={updateMutation.isPending}
                      >
                        <SelectTrigger className="h-10 bg-background sm:h-11">
                          <SelectValue placeholder="Seleccione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="linea_credito">
                            {
                              DIRECT_PURCHASE_PAYMENT_METHOD_LABELS.linea_credito
                            }
                          </SelectItem>
                          <SelectItem value="fondo_proyecto">
                            {
                              DIRECT_PURCHASE_PAYMENT_METHOD_LABELS.fondo_proyecto
                            }
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-base font-semibold leading-tight sm:text-lg">
                        {formatDirectPurchasePaymentMethod(
                          detail.purchaseOrder.paymentMethod ??
                            detail.directPurchasePaymentMethod
                        )}
                      </p>
                    )}
                  </div>
                ) : null}
                <div className="space-y-2.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-6 lg:col-span-4">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Proveedor
                  </Label>
                  <Popover
                    open={supplierPopoverOpen}
                    onOpenChange={setSupplierPopoverOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={supplierPopoverOpen}
                        className="h-11 w-full justify-between overflow-hidden px-3 text-sm font-normal sm:h-12 sm:text-base"
                        disabled={!canEditOrderStructure}
                      >
                        <span className="truncate">
                          {formatSupplierOptionLabel(selectedSupplier)}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                    >
                      <SupplierCommandList
                        suppliers={suppliersList || []}
                        selectedSupplierId={selectedSupplierId}
                        onSelect={(supplierId) => {
                          handleSupplierChange(supplierId);
                          setSupplierPopoverOpen(false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="space-y-1 text-sm leading-relaxed text-muted-foreground">
                      <p>
                        {updateMutation.isPending
                          ? "Guardando proveedor..."
                          : selectedSupplier
                          ? selectedSupplier.email ||
                            "Proveedor sin correo configurado"
                          : detail.supplier?.name || "Proveedor pendiente"}
                      </p>
                      {selectedSupplier || detail.supplier ? (
                        <p>
                          RTN:{" "}
                          {formatSupplierRtnLabel(
                            selectedSupplier ?? detail.supplier
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Contacto preferible
                    </p>
                    <Popover
                      open={contactPopoverOpen}
                      onOpenChange={setContactPopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={contactPopoverOpen}
                          className="mt-2 h-10 w-full justify-between overflow-hidden px-3 text-left text-sm font-normal"
                          disabled={
                            !canEditOrderStructure ||
                            updateMutation.isPending ||
                            supplierContacts.length === 0
                          }
                        >
                          <span className="truncate">
                            {supplierContacts.length === 0 &&
                            !selectedSupplierContact
                              ? "Sin contactos registrados"
                              : formatSupplierContactOptionLabel(
                                  selectedSupplierContact
                                )}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                      >
                        <SupplierContactCommandList
                          contacts={supplierContacts}
                          selectedContactId={String(
                            selectedSupplierContact?.id ?? ""
                          )}
                          onSelect={contactId => {
                            handleSupplierContactChange(contactId);
                            setContactPopoverOpen(false);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    {updateMutation.isPending ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Guardando contacto...
                      </p>
                    ) : formatSupplierContactMeta(selectedSupplierContact) ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {formatSupplierContactMeta(selectedSupplierContact)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3 lg:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Fecha de emisión
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {formatPrintDate(
                      detail.purchaseOrder.printedAt ??
                        detail.purchaseOrder.createdAt
                    )}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3 lg:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Fecha necesaria
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {detail.purchaseOrder.neededBy
                      ? new Date(
                          detail.purchaseOrder.neededBy
                        ).toLocaleDateString("es-HN")
                      : "—"}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-2xl border border-border/70 bg-muted/20 p-3.5 sm:p-4 md:col-span-3 lg:col-span-2">
                  <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                    Estado de emisión
                  </Label>
                  <p className="text-base font-semibold leading-tight sm:text-lg">
                    {EMISSION_STATUS_LABELS[detail.purchaseOrder.status] ||
                      "Pendiente"}
                  </p>
                </div>
              </div>

              {canEditContractSetup ||
              contractDraft.appliesContract ||
              canEditContractTerms ? (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="purchase-order-contract-detail"
                        checked={contractDraft.appliesContract}
                        disabled={!canEditContractSetup}
                        onCheckedChange={checked =>
                          setContractDraft(current => ({
                            ...current,
                            appliesContract: checked === true,
                          }))
                        }
                      />
                      <Label
                        htmlFor="purchase-order-contract-detail"
                        className="text-base font-semibold"
                      >
                        Aplica contrato
                      </Label>
                      {contractDraft.appliesContract ? (
                        <Badge
                          variant="outline"
                          className={
                            contractDraftSummary.isExpired
                              ? "border-rose-300 text-rose-700"
                              : contractDraftSummary.expiresSoon
                                ? "border-amber-300 text-amber-700"
                                : "border-emerald-300 text-emerald-700"
                          }
                        >
                          {contractDraftSummary.statusLabel}
                        </Badge>
                      ) : null}
                    </div>
                    {contractDraft.appliesContract ? (
                      <div className="text-sm text-muted-foreground">
                        Facturas creadas:{" "}
                        <span className="font-semibold text-foreground">
                          {contractSummary.registeredInvoiceCount}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {contractDraft.appliesContract ? (
                    <>
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="space-y-2">
                          <Label>Frecuencia de pago</Label>
                          <Select
                            value={contractDraft.contractPaymentFrequency}
                            disabled={!canEditContractSetup}
                            onValueChange={value =>
                              setContractDraft(current => ({
                                ...current,
                                contractPaymentFrequency:
                                  value as PurchaseOrderContractFrequency,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PURCHASE_ORDER_CONTRACT_FREQUENCIES.map(
                                frequency => (
                                  <SelectItem key={frequency} value={frequency}>
                                    {
                                      PURCHASE_ORDER_CONTRACT_FREQUENCY_LABELS[
                                        frequency
                                      ]
                                    }
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Primera fecha de pago</Label>
                          <Input
                            type="date"
                            value={contractDraft.contractFirstPaymentDate}
                            disabled={!canEditContractSetup}
                            onChange={event =>
                              setContractDraft(current => ({
                                ...current,
                                contractFirstPaymentDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Fecha de terminación</Label>
                          <Input
                            type="date"
                            value={contractDraft.contractEndDate}
                            disabled={!canEditContractEndDate}
                            onChange={event =>
                              setContractDraft(current => ({
                                ...current,
                                contractEndDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Nota de cambio</Label>
                          <Input
                            value={contractDraft.contractNote}
                            disabled={!canEditContractEndDate}
                            onChange={event =>
                              setContractDraft(current => ({
                                ...current,
                                contractNote: event.target.value,
                              }))
                            }
                            placeholder="Motivo del cambio"
                          />
                        </div>
                      </div>

                      {contractDraftSummary.isExpired ? (
                        <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            El contrato está vencido y no permitirá agregar
                            nuevas facturas.
                          </span>
                        </div>
                      ) : contractDraftSummary.expiresSoon ? (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            El contrato vence en{" "}
                            {contractDraftSummary.daysUntilEnd} día(s).
                          </span>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {canEditContractTerms ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSaveContractTerms}
                      disabled={updateContractTermsMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateContractTermsMutation.isPending
                        ? "Guardando..."
                        : "Guardar contrato"}
                    </Button>
                  ) : null}

                  {(detail?.auditLogs ?? []).length > 0 ? (
                    <div className="rounded-xl border border-border/70 bg-background p-3">
                      <div className="mb-2 text-sm font-semibold">
                        Bitácora del contrato
                      </div>
                      <div className="space-y-2">
                        {(detail?.auditLogs ?? [])
                          .slice(0, 6)
                          .map((entry: any) => (
                            <div
                              key={entry.log.id}
                              className="grid gap-2 text-xs text-muted-foreground md:grid-cols-[1fr_1fr_1fr]"
                            >
                              <span className="font-medium text-foreground">
                                {entry.log.field}
                              </span>
                              <span>
                                {entry.log.oldValue || "-"} →{" "}
                                {entry.log.newValue || "-"}
                              </span>
                              <span className="md:text-right">
                                {entry.changedBy?.name ||
                                  entry.changedBy?.email ||
                                  `Usuario #${entry.log.changedById}`}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-[1500px] table-auto text-sm lg:text-[15px]">
                  <colgroup>
                    <col className="w-[250px]" />
                    <col className="w-[150px]" />
                    <col className="w-[230px]" />
                    <col className="w-[190px]" />
                    <col className="w-[150px]" />
                    <col className="w-[200px]" />
                    <col className="w-[110px]" />
                    <col className="w-[130px]" />
                    <col className="w-[160px]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        SAP actual
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Cantidad
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Precio unitario
                      </th>
                      <th className="whitespace-nowrap p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Impuesto
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Subtotal
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        ISV
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Total
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any) => {
                      const draft = getItemDraft(item);
                      const itemSapCode =
                        item.currentSapItemCode ??
                        item.originalSapItemCode ??
                        null;
                      const hasLatestSupplierPrice = Boolean(
                        itemSapCode && latestSupplierPrices?.[itemSapCode]
                      );
                      const shouldShowMissingHistoryHint =
                        Boolean(selectedSupplierId) &&
                        Boolean(itemSapCode) &&
                        Number(draft.unitPrice ?? 0) === 0 &&
                        !hasLatestSupplierPrice;
                      const deleteBlockReason = getDeleteBlockReason(item);
                      const canCloseThisReceiptLine = canCloseReceiptLine(item);
                      const shouldShowLineActions =
                        canEditOrderStructure || canCloseThisReceiptLine;
                      const isSavingThisLine = savingItemId === item.id;
                      const isTemporaryFixedAsset =
                        isTemporaryFixedAssetItem(item);
                      const requestedItemName =
                        draft.itemName ??
                        getTemporaryFixedAssetRequestedName(item) ??
                        "";
                      const lineAmounts = calculatePurchaseOrderLineAmounts({
                        quantity: draft.quantity,
                        unitPrice: draft.unitPrice,
                        subtotal: draft.subtotal,
                        taxCode: draft.taxCode,
                        additionalTaxCodes: draft.additionalTaxCodes,
                        taxes: activeSalesTaxes,
                      });

                      return (
                        <tr
                          key={item.id}
                          className="border-b border-border last:border-0"
                        >
                          <td className="p-3 align-middle sm:p-4">
                            <div className="text-base font-semibold leading-snug sm:text-lg">
                              {getTemporaryFixedAssetDisplayName(item)}
                            </div>
                            {isTemporaryFixedAsset ? (
                              <div className="mt-2 max-w-[280px]">
                                <div className="mb-1 text-xs font-medium text-muted-foreground">
                                  Solicitado
                                </div>
                                {canEditOrderStructure ? (
                                  <Input
                                    value={requestedItemName}
                                    onChange={event => {
                                      const nextItemName = event.target.value;
                                      setItemDrafts(current => ({
                                        ...current,
                                        [item.id]: {
                                          ...(current[item.id] ??
                                            getItemDraft(item)),
                                          itemName: nextItemName,
                                        },
                                      }));
                                    }}
                                    onBlur={() => handleSaveItemLine(item)}
                                    disabled={isSavingThisLine}
                                    className="h-9 text-sm"
                                    placeholder="Detalle solicitado"
                                  />
                                ) : requestedItemName ? (
                                  <div className="text-sm font-medium">
                                    {requestedItemName}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {item.originalSapItemCode && (
                              <div className="mt-1.5 text-sm text-muted-foreground">
                                Original: {item.originalSapItemCode}
                              </div>
                            )}
                            {item.receiptClosed ? (
                              <div className="mt-2">
                                <Badge
                                  variant="outline"
                                  className="text-[11px]"
                                >
                                  Línea cerrada en recepción
                                </Badge>
                              </div>
                            ) : null}
                          </td>
                          <td className="p-3 align-middle font-mono text-sm font-medium sm:p-4">
                            {item.currentSapItemCode || "—"}
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <div className="flex items-center justify-end gap-2">
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={draft.quantity}
                                onChange={event => {
                                  const nextQuantity = event.target.value;
                                  setItemDrafts(current => ({
                                    ...current,
                                    [item.id]: withDraftQuantity(
                                      current[item.id] ?? getItemDraft(item),
                                      nextQuantity
                                    ),
                                  }));
                                }}
                                onBlur={() => handleSaveItemLine(item)}
                                className="h-10 w-full max-w-[190px] text-right text-sm sm:max-w-[200px] sm:text-base"
                                placeholder="0.00"
                                disabled={!canEditOrderStructure || isSavingThisLine}
                              />
                              <span className="min-w-[56px] text-right text-xs font-medium text-muted-foreground sm:min-w-[64px] sm:text-sm">
                                {item.unit || "—"}
                              </span>
                            </div>
                            {isSavingThisLine ? (
                              <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
                                Guardando...
                              </div>
                            ) : null}
                            {Number(item.receivedQuantity ?? 0) > 0 ? (
                              <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
                                Recibido: {item.receivedQuantity}{" "}
                                {item.unit || ""}
                              </div>
                            ) : null}
                            {item.receiptClosed ? (
                              <div className="mt-1 text-right text-[11px] text-muted-foreground">
                                Ya no admite recepciones adicionales
                              </div>
                            ) : null}
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <div
                              className={`ml-auto flex w-full max-w-[220px] flex-col items-end ${
                                shouldShowMissingHistoryHint
                                  ? "min-h-[92px]"
                                  : ""
                              }`}
                            >
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.unitPrice}
                                onChange={event => {
                                  const nextUnitPrice = event.target.value;
                                  setItemDrafts(current => ({
                                    ...current,
                                    [item.id]: withDraftUnitPrice(
                                      current[item.id] ?? getItemDraft(item),
                                      nextUnitPrice
                                    ),
                                  }));
                                }}
                                onBlur={() => handleSaveContractItemPrice(item)}
                                className="h-10 w-full text-right text-sm sm:text-base"
                                placeholder="0.00"
                                disabled={
                                  (!canEditOrderStructure &&
                                    !canEditContractLinePrice) ||
                                  isSavingThisLine
                                }
                              />
                              {shouldShowMissingHistoryHint && (
                                <div className="mt-3 w-full px-1 text-right text-[11px] leading-snug text-muted-foreground">
                                  Sin historial con este proveedor.
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <PurchaseOrderTaxControls
                              draft={draft}
                              taxes={activeSalesTaxes}
                              disabled={
                                !canEditOrderStructure || isSavingThisLine
                              }
                              onChange={nextDraft => {
                                const nextTaxCode = nextDraft.taxCode;
                                const nextAdditionalTaxCodes =
                                  nextDraft.additionalTaxCodes;
                                const draftForSave = {
                                  ...getItemDraft(item),
                                  taxCode: nextTaxCode,
                                  additionalTaxCodes: nextAdditionalTaxCodes,
                                };
                                setItemDrafts(current => ({
                                  ...current,
                                  [item.id]: {
                                    ...(current[item.id] ?? getItemDraft(item)),
                                    taxCode: nextTaxCode,
                                    additionalTaxCodes: nextAdditionalTaxCodes,
                                  },
                                }));
                                handleSaveItemLine(item, draftForSave);
                              }}
                            />
                          </td>
                          <td className="p-3 align-middle sm:p-4">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.subtotal}
                              onChange={event => {
                                const nextSubtotal = event.target.value;
                                setItemDrafts(current => ({
                                  ...current,
                                  [item.id]: withDraftSubtotal(
                                    current[item.id] ?? getItemDraft(item),
                                    nextSubtotal
                                  ),
                                }));
                              }}
                              onBlur={() => handleSaveContractItemPrice(item)}
                              className="h-10 w-full min-w-[180px] max-w-[240px] text-right text-sm font-semibold sm:text-base"
                              placeholder="0.00"
                              disabled={
                                (!canEditOrderStructure &&
                                  !canEditContractLinePrice) ||
                                isSavingThisLine
                              }
                            />
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                              {formatPurchaseOrderCurrency(
                                lineAmounts.taxAmount
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                              {formatPurchaseOrderCurrency(lineAmounts.total)}
                            </div>
                          </td>
                          <td className="p-3 text-right align-middle sm:p-4">
                            {shouldShowLineActions ? (
                              <div className="ml-auto flex w-fit items-center justify-end gap-2">
                                {canEditOrderStructure ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="icon-sm"
                                      onClick={() => {
                                        setReplaceItemId(item.id);
                                        setReplacementSearch("");
                                      }}
                                      title="Reemplazar ítem"
                                      aria-label="Reemplazar ítem"
                                    >
                                      <ArrowRightLeft className="h-4 w-4" />
                                    </Button>
                                  </>
                                ) : null}
                                {canCloseThisReceiptLine ? (
                                  <Button
                                    variant="outline"
                                    size="icon-sm"
                                    disabled={
                                      closeReceiptLineMutation.isPending
                                    }
                                    onClick={() => handleCloseReceiptLine(item)}
                                    title="Cerrar línea para recepción"
                                    aria-label="Cerrar línea para recepción"
                                  >
                                    {closeReceiptLineMutation.isPending &&
                                    confirmState.kind ===
                                      "close-receipt-line" &&
                                    confirmState.itemId === item.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <ShieldX className="h-4 w-4" />
                                    )}
                                  </Button>
                                ) : null}
                                {canEditOrderStructure ? (
                                  <Button
                                    variant="destructive"
                                    size="icon-sm"
                                    disabled={
                                      Boolean(deleteBlockReason) ||
                                      deletingItemId === item.id
                                    }
                                    title={
                                      deleteBlockReason ?? "Eliminar línea"
                                    }
                                    aria-label="Eliminar línea"
                                    onClick={() => handleDeleteItem(item)}
                                  >
                                    {deletingItemId === item.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t border-border bg-muted/10 px-3 py-4 sm:px-4">
                <FiscalSummaryCard summary={pricingSummary} />
              </div>

              <DocumentAttachmentsPanel
                entityType="purchase_order"
                entityId={detail.purchaseOrder.id}
                category="orden_compra"
                canManage={canManagePurchaseOrderAttachments}
              />

              {canEditOrderStructure && replaceItemId && (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-muted/10 p-5 sm:p-6">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold sm:text-base">
                      Buscar reemplazo en SAP
                    </Label>
                    <Input
                      className="h-12 text-base sm:h-14 sm:text-lg"
                      value={replacementSearch}
                      onChange={event =>
                        setReplacementSearch(event.target.value)
                      }
                      placeholder="Buscar por código o descripción"
                    />
                  </div>

                  <div className="max-h-72 overflow-y-auto rounded-2xl border border-border/70 bg-background">
                    {(sapMatches || []).length === 0 ? (
                      <div className="p-4 text-base text-muted-foreground">
                        Escribe al menos 2 caracteres para buscar en SAP.
                      </div>
                    ) : (
                      <div className="divide-y divide-border">
                        {(sapMatches || []).map((match: any) => (
                          <button
                            key={match.id}
                            className="w-full px-4 py-4 text-left hover:bg-muted/50"
                            onClick={() =>
                              replaceMutation.mutate({
                                purchaseOrderItemId: replaceItemId,
                                currentSapItemCode: match.itemCode,
                                itemName: match.description,
                              })
                            }
                          >
                            <div className="font-mono text-sm font-medium text-primary">
                              {match.itemCode}
                            </div>
                            <div className="text-base">{match.description}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {hasPendingPricingChanges ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Hay cambios de cantidad, precio o impuesto pendientes de guardado automático. Sal del campo para terminar la actualización antes de descargar o emitir la OC.
                </div>
              ) : null}
              {hasPendingContractPriceChanges ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Hay cambios de precio del contrato pendientes. Sal del campo
                  para guardar la actualización.
                </div>
              ) : null}
              {canEditOrderStructure && emissionBlockReason ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {emissionBlockReason}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
                {canManagePurchaseOrders && !isOrderReceived ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-10 min-w-[220px] px-5 text-sm font-semibold text-destructive sm:h-11 sm:text-base"
                    onClick={handleCancelOrder}
                    disabled={
                      items.length === 0 ||
                      Boolean(isOrderCancelled) ||
                      hasReceivedItems ||
                      cancelOrderMutation.isPending ||
                      sendMutation.isPending ||
                      updateMutation.isPending ||
                      updateItemLineMutation.isPending ||
                      updateContractTermsMutation.isPending ||
                      updateContractItemPriceMutation.isPending ||
                      deleteItemMutation.isPending ||
                      reopenDraftMutation.isPending ||
                      hasPendingPricingChanges ||
                      hasPendingContractPriceChanges
                    }
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {cancelOrderMutation.isPending
                      ? "Cancelando..."
                      : "Cancelar orden"}
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  size="lg"
                  className="h-10 min-w-[210px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                  onClick={handlePrintPurchaseOrder}
                  disabled={
                    items.length === 0 ||
                    updateItemLineMutation.isPending ||
                    updateContractTermsMutation.isPending ||
                    updateContractItemPriceMutation.isPending ||
                    deleteItemMutation.isPending ||
                    updateMutation.isPending ||
                    cancelOrderMutation.isPending ||
                    reopenDraftMutation.isPending
                  }
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir documento
                </Button>

                {canEditOrderStructure ? (
                  <Button
                    size="lg"
                    className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                    onClick={() => {
                      if (emissionBlockReason) {
                        toast.error(emissionBlockReason);
                        return;
                      }
                      sendMutation.mutate({ id: detail.purchaseOrder.id });
                    }}
                    disabled={
                      items.length === 0 ||
                      sendMutation.isPending ||
                      updateMutation.isPending ||
                      updateItemLineMutation.isPending ||
                      updateContractTermsMutation.isPending ||
                      updateContractItemPriceMutation.isPending ||
                      deleteItemMutation.isPending ||
                      cancelOrderMutation.isPending ||
                      reopenDraftMutation.isPending ||
                      hasOrderReceipts ||
                      hasPendingPricingChanges ||
                      hasPendingContractPriceChanges
                    }
                  >
                    <Send className="mr-2 h-4 w-4" />
                    {sendMutation.isPending ? "Emitiendo..." : "Emitir orden"}
                  </Button>
                ) : null}

                {canReopenDraft && !canEditOrderStructure ? (
                  <Button
                    size="lg"
                    className={`h-10 min-w-[220px] px-5 text-sm font-semibold transition-colors sm:h-11 sm:text-base ${
                      isReopeningSelectedDraft
                        ? "bg-amber-500 text-white hover:bg-amber-500 disabled:bg-amber-500 disabled:text-white disabled:opacity-100"
                        : "bg-sky-700 text-white hover:bg-sky-800"
                    }`}
                    onClick={() => {
                      const orderId = detail.purchaseOrder.id;
                      if (
                        reopeningDraftOrderIdRef.current !== null ||
                        reopenDraftMutation.isPending
                      ) {
                        return;
                      }
                      reopeningDraftOrderIdRef.current = orderId;
                      setReopeningDraftOrderId(orderId);
                      reopenDraftMutation.mutate({
                        id: orderId,
                      });
                    }}
                    disabled={
                      isReopeningSelectedDraft ||
                      reopenDraftMutation.isPending ||
                      updateMutation.isPending ||
                      updateItemLineMutation.isPending ||
                      updateContractTermsMutation.isPending ||
                      updateContractItemPriceMutation.isPending ||
                      deleteItemMutation.isPending ||
                      cancelOrderMutation.isPending ||
                      sendMutation.isPending
                    }
                  >
                    {isReopeningSelectedDraft ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Pencil className="mr-2 h-4 w-4" />
                    )}
                    {isReopeningSelectedDraft
                      ? "Reabriendo..."
                      : "Volver a edición"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmState.kind !== null}
        onOpenChange={open => {
          if (!open && !confirmActionPending) {
            setConfirmState({ kind: null });
          }
        }}
      >
        <AlertDialogContent className="max-w-[560px] overflow-hidden rounded-2xl border-border/70 p-0 shadow-2xl">
          <div className="border-b border-border/70 bg-muted/20 px-6 py-5">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                  confirmState.kind === "close-receipt-line"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-destructive/10 text-destructive"
                }`}
              >
                {confirmState.kind === "delete-item" ? (
                  <Trash2 className="h-5 w-5" />
                ) : confirmState.kind === "close-receipt-line" ? (
                  <ShieldX className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
              </div>
              <AlertDialogHeader className="gap-2 text-left">
                <AlertDialogTitle className="text-xl font-semibold tracking-tight">
                  {confirmState.kind === "delete-item"
                    ? confirmState.isLastItem
                      ? "Eliminar última línea"
                      : "Eliminar línea"
                    : confirmState.kind === "close-receipt-line"
                      ? "Cerrar línea para recepción"
                      : "Cancelar orden de compra"}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
                  {confirmState.kind === "delete-item"
                    ? confirmState.isLastItem
                      ? `Se eliminará la última línea "${confirmState.itemName}" y la orden de compra quedará anulada.`
                      : `Se eliminará la línea "${confirmState.itemName}" de la orden de compra.`
                    : confirmState.kind === "close-receipt-line"
                      ? `La línea "${confirmState.itemName}" quedará cerrada con un saldo pendiente de ${confirmState.pendingQuantity.toLocaleString(
                          "es-HN",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )} ${confirmState.unit || ""}. Después de eso ya no aparecerá en Recepciones. Si lo necesitas, también puedes mandar ese saldo a una nueva solicitud de compra.`
                      : confirmState.kind === "cancel-order"
                        ? `Se anulará la orden ${confirmState.orderNumber}. El detalle no se borrará, pero los ítems volverán a quedar habilitados en la requisición.`
                        : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
            </div>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div className="rounded-2xl border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
              {confirmState.kind === "delete-item"
                ? "Esta acción no se puede deshacer."
                : confirmState.kind === "close-receipt-line"
                  ? "Puedes solo cerrar la línea o enviar el saldo pendiente a una solicitud de compra reutilizable para esta misma orden."
                  : "La orden quedará visible como historial, pero ya no se podrá editar ni enviar al proveedor."}
            </div>

            <AlertDialogFooter className="gap-3 sm:justify-end">
              {confirmState.kind === "close-receipt-line" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleMovePendingToPurchaseRequest}
                  disabled={confirmActionPending}
                  className="h-11 rounded-xl px-5 text-sm font-semibold"
                >
                  {movePendingToPurchaseRequestMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enviando a SC...
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Pasar pendiente a SC
                    </>
                  )}
                </Button>
              ) : null}
              <AlertDialogCancel
                disabled={confirmActionPending}
                className="h-11 rounded-xl px-5 text-sm font-semibold"
              >
                Volver
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmAction}
                disabled={confirmActionPending}
                className="h-11 rounded-xl bg-destructive px-5 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
              >
                {confirmActionPending
                  ? confirmState.kind === "delete-item"
                    ? "Eliminando..."
                    : confirmState.kind === "close-receipt-line"
                      ? "Cerrando..."
                      : "Cancelando..."
                  : confirmState.kind === "delete-item"
                    ? "Confirmar eliminación"
                    : confirmState.kind === "close-receipt-line"
                      ? "Confirmar cierre"
                      : "Confirmar cancelación"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
