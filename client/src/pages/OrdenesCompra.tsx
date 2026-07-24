import { trpc } from "@/lib/trpc";
import { DataPagination } from "@/components/DataPagination";
import { CompactProcurementApprovalPanel } from "@/components/CompactProcurementApprovalPanel";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { fetchAllFilteredPages } from "@/lib/paginated-export";
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
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
  ChevronDown,
  ChevronsUpDown,
  Download,
  FileText,
  ImageIcon,
  Loader2,
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
  getReadablePrintStyles,
  getReadablePurchaseOrderPrintStyles,
} from "@/lib/readable-print-styles";
import { useProcurementApprovalSettings } from "@/hooks/useProcurementApprovalSettings";
import {
  calculatePurchaseOrderLineAmounts,
  DEFAULT_SALES_TAXES,
  formatPurchaseOrderCurrency,
  formatPurchaseOrderPaymentMethodPrintLabel,
  getPurchaseCurrencyLabel,
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
  type PurchaseCurrency,
  type SalesTaxCatalogItem,
} from "@shared/purchase-orders";
import {
  getBuildReqRoleLabel,
  isProcurementApproverRole,
} from "@shared/buildreq-roles";
import {
  isPurchaseOrderDraftLike,
  isPurchaseOrderApprovalEnabled,
  isPurchaseRequestConversionReady,
  purchaseOrderRequiresApproval,
} from "@shared/procurement-approvals";

const PAGE_SIZE = 50;

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente_aprobacion: "Pendiente de aprobación",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  emitida: "Emitida",
  enviada: "Enviada",
  parcialmente_recibida: "Parcialmente recibida",
  recibida: "Recibida",
  anulada: "Anulada",
};
const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  pendiente_aprobacion: "border-amber-300 bg-amber-50 text-amber-800",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-rose-300 bg-rose-50 text-rose-700",
  emitida: "border-blue-300 bg-blue-50 text-blue-700",
  enviada: "border-blue-300 bg-blue-50 text-blue-700",
  parcialmente_recibida: "border-cyan-300 bg-cyan-50 text-cyan-700",
  recibida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};

const getStatusFilterOptions = (approvalsEnabled: boolean) =>
  Object.entries(STATUS_LABELS).filter(
    ([status]) =>
      approvalsEnabled ||
      !["pendiente_aprobacion", "rechazada"].includes(status)
  );

function getEffectivePurchaseOrderStatus(
  status?: string | null,
  approvalStatus?: string | null
) {
  return !isPurchaseOrderApprovalEnabled() &&
    isPurchaseOrderDraftLike(status, approvalStatus)
    ? "borrador"
    : (status ?? "");
}
const PURCHASE_TYPE_LABELS: Record<string, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
};

const CONTRACT_AUDIT_FIELD_LABELS: Record<string, string> = {
  appliesContract: "Aplica contrato",
  contractPaymentFrequency: "Frecuencia de pago",
  contractFirstPaymentDate: "Primera fecha de pago",
  contractEndDate: "Fecha de terminación",
};

function formatContractAuditValue(field: string, value?: string | null) {
  if (!value) return "-";
  if (field === "appliesContract") return value === "true" ? "Sí" : "No";
  if (field === "contractPaymentFrequency") {
    return (
      PURCHASE_ORDER_CONTRACT_FREQUENCY_LABELS[
        value as PurchaseOrderContractFrequency
      ] ?? value
    );
  }
  if (field === "contractFirstPaymentDate" || field === "contractEndDate") {
    return value.slice(0, 10);
  }
  return value;
}
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
  pendiente_aprobacion: "Pendiente",
  aprobada: "Pendiente",
  rechazada: "Pendiente",
  emitida: "Emitida",
  enviada: "Emitida",
  parcialmente_recibida: "Emitida",
  recibida: "Emitida",
  anulada: "Anulada",
};

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente de aprobación",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  no_requiere: "No requiere",
};

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-800",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-rose-300 bg-rose-50 text-rose-700",
  no_requiere: "border-slate-300 bg-slate-50 text-slate-700",
};

const APPROVAL_ACTION_LABELS: Record<string, string> = {
  submit: "Enviada a aprobación",
  submitted: "Enviada a aprobación",
  submit_for_approval: "Enviada a aprobación",
  submitted_for_approval: "Enviada a aprobación",
  approval_submitted: "Enviada a aprobación",
  enviada_aprobacion: "Enviada a aprobación",
  approve: "Aprobada",
  approved: "Aprobada",
  approval_approved: "Aprobada",
  aprobada: "Aprobada",
  reject: "Rechazada",
  rejected: "Rechazada",
  approval_rejected: "Rechazada",
  rechazada: "Rechazada",
  partially_approved: "Aprobada parcialmente",
  rejected_and_cancelled: "Rechazada y anulada",
  reopen: "Reabierta para corrección",
  reopened: "Reabierta para corrección",
  reopen_rejected: "Reabierta para corrección",
  corregida: "Reabierta para corrección",
  reopened_by_settings: "Reabierta por cambio de configuración",
};

function getApprovalStatusLabel(status?: string | null) {
  if (!status) return "No enviada";
  return APPROVAL_STATUS_LABELS[status] ?? status;
}

function getApprovalStatusColor(status?: string | null) {
  if (!status) return "border-slate-300 bg-white text-slate-600";
  return (
    APPROVAL_STATUS_COLORS[status] ??
    "border-slate-300 bg-slate-50 text-slate-700"
  );
}

function formatApprovalTimelineStatus(status?: string | null) {
  if (!status) return "No enviada";
  return (
    APPROVAL_STATUS_LABELS[status] ??
    STATUS_LABELS[status] ??
    status.replaceAll("_", " ")
  );
}

function formatApprovalAction(action?: string | null) {
  if (!action) return "Actualización";
  return (
    APPROVAL_ACTION_LABELS[action] ??
    action.replaceAll("_", " ").replace(/^./, value => value.toUpperCase())
  );
}

function formatApprovalActorRole(role?: string | null) {
  if (!role) return "Rol no disponible";
  return getBuildReqRoleLabel(role);
}

const RECEIVED_ORDER_STATUSES = new Set(["parcialmente_recibida", "recibida"]);
const RECEIPT_CLOSABLE_ORDER_STATUSES = new Set([
  "emitida",
  "enviada",
  "parcialmente_recibida",
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
    new Set(users.map((user: any) => getUserLabel(user, "")).filter(Boolean))
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
    (row?.project
      ? `${row.project.code} — ${row.project.name}`
      : "Proyecto pendiente")
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
    requestedQuantity -
      (Number.isFinite(convertedQuantity) ? convertedQuantity : 0),
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
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase("es-HN");
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
  if (
    itemName &&
    normalizeItemText(itemName) !== TEMPORARY_FIXED_ASSET_ITEM_NAME
  ) {
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

function formatUnitPriceDisplay(value: number | string | null | undefined) {
  const [integerPart, decimalPart = ""] =
    formatUnitPricePayload(value).split(".");
  const visibleDecimals = decimalPart.replace(/0+$/, "").padEnd(2, "0");
  return `${integerPart}.${visibleDecimals}`;
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
  if (parsedQuantity <= 0) return "0.00";
  return formatUnitPriceDisplay(
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
  draft: PurchaseOrderItemDraft,
  pricesIncludeTax = false
): PurchaseOrderItemDraft {
  const quantity = draft.quantity.trim()
    ? draft.quantity
    : formatQuantityPayload(draft.quantity);
  if (pricesIncludeTax) {
    const unitPrice = formatUnitPriceDisplay(draft.unitPrice);
    return {
      ...draft,
      quantity,
      unitPrice,
      subtotal: calculateSubtotalDraftValue(quantity, unitPrice),
    };
  }
  const subtotal = formatMoneyDisplay(draft.subtotal);
  return {
    ...draft,
    quantity,
    subtotal,
    unitPrice: calculateUnitPriceDraftValue(quantity, subtotal),
  };
}

function areEditableMoneyValuesEqual(
  left: number | string | null | undefined,
  right: number | string | null | undefined
) {
  return formatMoneyDisplay(left) === formatMoneyDisplay(right);
}

function areEditableUnitPricesEqual(
  left: number | string | null | undefined,
  right: number | string | null | undefined
) {
  return formatUnitPricePayload(left) === formatUnitPricePayload(right);
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

function isPurchaseOrderItemDraftSynced(
  item: any,
  draft: PurchaseOrderItemDraft,
  activeSalesTaxes: SalesTaxCatalogItem[],
  pricesIncludeTax: boolean
) {
  const normalizedDraft = normalizeDraftMoneyValues(draft, pricesIncludeTax);
  const normalizedAmounts = calculatePurchaseOrderLineAmounts({
    quantity: normalizedDraft.quantity,
    unitPrice: normalizedDraft.unitPrice,
    subtotal: normalizedDraft.subtotal,
    pricesIncludeTax,
    taxCode: normalizedDraft.taxCode,
    additionalTaxCodes: normalizedDraft.additionalTaxCodes,
    taxes: activeSalesTaxes,
  });
  return (
    Number(normalizedDraft.quantity || 0) === Number(item.quantity ?? 0) &&
    areEditableUnitPricesEqual(normalizedDraft.unitPrice, item.unitPrice) &&
    areEditableMoneyValuesEqual(normalizedAmounts.subtotal, item.subtotal) &&
    normalizedDraft.taxCode ===
      normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes) &&
    areTaxCodeArraysEqual(
      normalizedDraft.additionalTaxCodes,
      item.additionalTaxCodes
    )
  );
}

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

type PurchaseCurrencyDraft = {
  currency: PurchaseCurrency;
  exchangeRate: string;
  exchangeRateDate: string;
};

function currentDateInputValue() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatExchangeRateDraft(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  return raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
}

const DEFAULT_CURRENCY_DRAFT: PurchaseCurrencyDraft = {
  currency: "HNL",
  exchangeRate: "",
  exchangeRateDate: "",
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
    }
  | {
      kind: "price-tax-mode";
      orderId: number;
      pricesIncludeTax: boolean;
    };

type ApprovalReviewDecision = "approve" | "reject";

export default function OrdenesCompra() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const {
    purchaseOrderApprovalsEnabled: PROCUREMENT_APPROVALS_ENABLED,
    purchaseOrderApprovalMinimumHnl,
    purchaseOrderApprovalMinimumUsd,
  } = useProcurementApprovalSettings();
  const userRole = (user as any)?.buildreqRole;
  const isProcurementApprover = isProcurementApproverRole(userRole);
  const canManagePurchaseOrders =
    !isProcurementApprover &&
    (user?.role === "admin" ||
      userRole === "jefe_bodega_central" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto");
  const canCreatePurchaseOrder =
    !isProcurementApprover &&
    (user?.role === "admin" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto");
  const isProjectAdmin = userRole === "administrador_proyecto";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newOrderDialogOpen, setNewOrderDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearchTerm = useDebouncedValue(searchTerm);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
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
  const [currencyDraft, setCurrencyDraft] = useState<PurchaseCurrencyDraft>(
    DEFAULT_CURRENCY_DRAFT
  );
  const [pricesIncludeTaxDraft, setPricesIncludeTaxDraft] = useState(false);
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
  const [approvalItemDecisions, setApprovalItemDecisions] = useState<
    Record<number, ApprovalReviewDecision | undefined>
  >({});
  const [approvalReviewComment, setApprovalReviewComment] = useState("");

  const {
    data: ordersPage,
    isLoading,
    isPlaceholderData,
  } = trpc.purchaseOrders.listPage.useQuery(
    {
      search: debouncedSearchTerm.trim() || undefined,
      purchaseType:
        purchaseTypeFilter === "all" ? undefined : purchaseTypeFilter,
      status:
        isProcurementApprover || statusFilter === "all"
          ? undefined
          : statusFilter,
      page,
      pageSize: PAGE_SIZE,
    },
    { placeholderData: previousData => previousData }
  );
  const orders = ordersPage?.items ?? [];
  useEffect(() => {
    setApprovalItemDecisions({});
    setApprovalReviewComment("");
  }, [selectedId]);
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
  const activeSalesTaxes = (
    salesTaxes?.length ? salesTaxes : DEFAULT_SALES_TAXES
  ) as SalesTaxCatalogItem[];
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
      void utils.purchaseOrders.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const updatePricesIncludeTaxMutation =
    trpc.purchaseOrders.updatePricesIncludeTax.useMutation({
      onSuccess: () => {
        toast.success("Tipo de precio actualizado");
        setItemDrafts({});
        setConfirmState({ kind: null });
        void utils.purchaseOrders.invalidate();
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: (error: { message: string }) => toast.error(error.message),
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
        void utils.purchaseOrders.invalidate();
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
        void utils.purchaseOrders.invalidate();
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
          utils.purchaseOrders.invalidate(),
          utils.purchaseRequests.invalidate(),
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
        void utils.purchaseOrders.invalidate();
      }
    },
    onError: error => toast.error(error.message),
  });

  const cancelOrderMutation = trpc.purchaseOrders.cancelOrder.useMutation({
    onSuccess: () => {
      toast.success("Orden de compra anulada");
      void utils.purchaseOrders.invalidate();
      if (selectedId) {
        void utils.purchaseOrders.getById.invalidate({ id: selectedId });
      }
    },
    onError: error => toast.error(error.message),
  });

  const submitForApprovalMutation =
    trpc.purchaseOrders.submitForApproval.useMutation({
      onSuccess: () => {
        toast.success("OC enviada a aprobación");
        void utils.purchaseOrders.invalidate();
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: (error: { message: string }) => toast.error(error.message),
    });

  const reviewApprovalMutation = trpc.purchaseOrders.reviewApproval.useMutation(
    {
      onSuccess: result => {
        toast.success(
          result.outcome === "partially_approved"
            ? `OC aprobada parcialmente: ${result.approvedItemCount} ítem(s) aprobados y ${result.rejectedItemCount} devueltos`
            : result.outcome === "cancelled"
              ? "OC rechazada y anulada; sus ítems volvieron a las solicitudes"
              : "OC aprobada"
        );
        setApprovalItemDecisions({});
        setApprovalReviewComment("");
        if (isProcurementApprover) {
          setSelectedId(null);
        }
        void Promise.all([
          utils.purchaseOrders.invalidate(),
          utils.purchaseRequests.invalidate(),
          utils.materialRequests.invalidate(),
          utils.supplyFlows.invalidate(),
        ]);
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: (error: { message: string }) => toast.error(error.message),
    }
  );

  const reopenRejectedMutation = trpc.purchaseOrders.reopenRejected.useMutation(
    {
      onSuccess: () => {
        toast.success("OC reabierta para corrección");
        void utils.purchaseOrders.invalidate();
        if (selectedId) {
          void utils.purchaseOrders.getById.invalidate({ id: selectedId });
        }
      },
      onError: (error: { message: string }) => toast.error(error.message),
    }
  );

  const sendMutation = trpc.purchaseOrders.sendToSupplier.useMutation({
    onSuccess: () => {
      toast.success("OC emitida");
      void utils.purchaseOrders.invalidate();
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
        setCurrencyDraft(DEFAULT_CURRENCY_DRAFT);
        setPricesIncludeTaxDraft(false);
        void Promise.all([
          utils.purchaseOrders.invalidate(),
          utils.purchaseRequests.invalidate(),
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
              toast.error(
                "La OC fue creada, pero no se pudieron subir todos los adjuntos"
              );
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
        currency: detail?.purchaseOrder.currency ?? "HNL",
        pricesIncludeTax: detail?.purchaseOrder.pricesIncludeTax === true,
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
  const orderApprovalStatus = detail?.purchaseOrder.approvalStatus ?? null;
  const approvalHistory = (detail as any)?.approvalHistory ?? [];
  const orderTotal = Number(detail?.summary?.total ?? 0);
  const orderCurrency = detail?.purchaseOrder.currency ?? "HNL";
  const approvalApprovedItemIds = useMemo(
    () =>
      items
        .filter((item: any) => approvalItemDecisions[item.id] === "approve")
        .map((item: any) => item.id),
    [approvalItemDecisions, items]
  );
  const approvalRejectedItemIds = useMemo(
    () =>
      items
        .filter((item: any) => approvalItemDecisions[item.id] === "reject")
        .map((item: any) => item.id),
    [approvalItemDecisions, items]
  );
  const approvalUndecidedItemCount =
    items.length -
    approvalApprovedItemIds.length -
    approvalRejectedItemIds.length;
  useEffect(() => {
    if (approvalRejectedItemIds.length === 0) {
      setApprovalReviewComment("");
    }
  }, [approvalRejectedItemIds.length]);
  const approvalRejectedItemIdSet = useMemo(
    () => new Set(approvalRejectedItemIds),
    [approvalRejectedItemIds]
  );
  const approvalRejectedItems = useMemo(
    () => items.filter((item: any) => approvalRejectedItemIdSet.has(item.id)),
    [approvalRejectedItemIdSet, items]
  );
  const approvalRejectedTotal = useMemo(
    () =>
      approvalRejectedItems.reduce((total: number, item: any) => {
        const lineAmounts = calculatePurchaseOrderLineAmounts({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
          pricesIncludeTax: detail?.purchaseOrder.pricesIncludeTax === true,
          taxCode: item.taxCode,
          additionalTaxCodes: item.additionalTaxCodes,
          taxBreakdown: item.taxBreakdown,
          taxes: activeSalesTaxes,
        });
        return total + lineAmounts.total;
      }, 0),
    [
      activeSalesTaxes,
      approvalRejectedItems,
      detail?.purchaseOrder.pricesIncludeTax,
    ]
  );
  const isTotalApprovalRejection =
    items.length > 0 && approvalRejectedItems.length === items.length;
  const approvalRemainingTotal = Math.max(
    orderTotal - approvalRejectedTotal,
    0
  );
  const updateApprovalItemDecision = (
    itemId: number,
    decision: ApprovalReviewDecision,
    checked: boolean
  ) => {
    setApprovalItemDecisions(current => {
      const next = { ...current };
      if (checked) {
        next[itemId] = decision;
      } else if (next[itemId] === decision) {
        delete next[itemId];
      }
      return next;
    });
  };
  const canFinalizeApprovalReview =
    items.length > 0 &&
    approvalUndecidedItemCount === 0 &&
    (approvalRejectedItemIds.length === 0 ||
      approvalReviewComment.trim().length >= 5) &&
    !reviewApprovalMutation.isPending;
  const handleFinalizeApprovalReview = () => {
    if (!selectedId || !canReviewApproval) return;
    if (approvalUndecidedItemCount > 0) {
      toast.error("Decida si aprueba o rechaza cada artículo");
      return;
    }

    if (approvalRejectedItemIds.length > 0) {
      const comment = approvalReviewComment.trim();
      if (comment.length < 5) {
        toast.error("Ingrese un motivo de rechazo de al menos 5 caracteres");
        return;
      }
      reviewApprovalMutation.mutate({
        id: selectedId,
        decision: "reject",
        comment,
        rejectedItemIds: approvalRejectedItemIds,
      });
      return;
    }

    reviewApprovalMutation.mutate({
      id: selectedId,
      decision: "approve",
    });
  };
  const orderApprovalMinimum =
    orderCurrency === "USD"
      ? purchaseOrderApprovalMinimumUsd
      : purchaseOrderApprovalMinimumHnl;
  const orderRequiresApproval =
    Number.isFinite(orderTotal) &&
    purchaseOrderRequiresApproval(orderCurrency, orderTotal);
  const isApprovalWorkflowState = PROCUREMENT_APPROVALS_ENABLED
    ? ["pendiente_aprobacion", "aprobada", "rechazada"].includes(orderStatus)
    : orderStatus === "aprobada" && orderApprovalStatus === "aprobada";
  const isPostApprovalLocked =
    orderApprovalStatus === "aprobada" && orderStatus !== "aprobada";
  const contractSummary =
    detail?.contractSummary ??
    getPurchaseOrderContractSummary({
      appliesContract: detail?.purchaseOrder.appliesContract,
      contractPaymentFrequency: detail?.purchaseOrder.contractPaymentFrequency,
      contractFirstPaymentDate: detail?.purchaseOrder.contractFirstPaymentDate,
      contractEndDate: detail?.purchaseOrder.contractEndDate,
    });
  const contractAuditLogs = (detail?.auditLogs ?? []).filter((entry: any) =>
    Object.prototype.hasOwnProperty.call(
      CONTRACT_AUDIT_FIELD_LABELS,
      entry.log.field
    )
  );
  const canEditOrderStructure =
    canManagePurchaseOrders &&
    isPurchaseOrderDraftLike(orderStatus, orderApprovalStatus);
  const canEditContractTerms = canEditOrderStructure;
  const canEditNewOrderContract = newOrderDialogOpen && canCreatePurchaseOrder;
  const canEditContractSetup = canEditNewOrderContract || canEditOrderStructure;
  const canEditContractEndDate =
    canEditNewOrderContract || canEditContractTerms;
  const isOrderCancelled = orderStatus === "anulada";
  const isOrderReceived = orderStatus === "recibida";
  const isOrderReadOnly = Boolean(
    !canManagePurchaseOrders ||
      isOrderCancelled ||
      isOrderReceived ||
      isApprovalWorkflowState ||
      isPostApprovalLocked
  );
  const canManagePurchaseOrderAttachments =
    !isProcurementApprover &&
    (user?.role === "admin" ||
      userRole === "administracion_central" ||
      userRole === "administrador_proyecto") &&
    !isOrderCancelled &&
    !isOrderReceived &&
    !isApprovalWorkflowState &&
    !isPostApprovalLocked;
  const hasReceivedItems = items.some(
    (item: any) => Number(item.receivedQuantity ?? 0) > 0
  );
  const hasOrderReceipts =
    hasReceivedItems || RECEIVED_ORDER_STATUSES.has(orderStatus);
  const canSubmitForApproval =
    PROCUREMENT_APPROVALS_ENABLED &&
    canManagePurchaseOrders &&
    orderStatus === "borrador" &&
    orderRequiresApproval;
  const canReviewApproval =
    PROCUREMENT_APPROVALS_ENABLED &&
    isProcurementApprover &&
    orderStatus === "pendiente_aprobacion";
  const isCompactApprovalView = canReviewApproval;
  const canCorrectRejectedOrder =
    PROCUREMENT_APPROVALS_ENABLED &&
    canManagePurchaseOrders &&
    orderStatus === "rechazada";
  const canEmitOrder =
    canManagePurchaseOrders &&
    ((isPurchaseOrderDraftLike(orderStatus, orderApprovalStatus) &&
      !orderRequiresApproval) ||
      (orderStatus === "aprobada" && orderApprovalStatus === "aprobada"));
  const filteredOrders = orders;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearchTerm, purchaseTypeFilter, statusFilter]);

  useEffect(() => {
    if (!isPlaceholderData && ordersPage?.page && ordersPage.page !== page) {
      setPage(ordersPage.page);
    }
  }, [isPlaceholderData, ordersPage?.page, page]);
  const purchaseRequestOriginRows = useMemo(() => {
    const normalizedSearch = originSearch.trim().toLowerCase();

    return (purchaseRequestOrigins ?? []).filter((row: any) => {
      const purchaseRequest = row.purchaseRequest;
      if (
        !isPurchaseRequestConversionReady(
          purchaseRequest.status,
          purchaseRequest.approvalStatus
        )
      ) {
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
        PURCHASE_TYPE_LABELS[purchaseRequest.purchaseType] ||
          purchaseRequest.purchaseType,
        getPurchaseRequestProjectLabel(row),
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(normalizedSearch));
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
      !isPurchaseRequestConversionReady(
        selectedOriginDetail.purchaseRequest.status,
        selectedOriginDetail.purchaseRequest.approvalStatus
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
        item.sourceProject?.id ??
        selectedOriginDetail.purchaseRequest.projectId;
      return assignedProjectIds.includes(itemProjectId);
    });
  }, [isProjectAdmin, selectedOriginAllItems, selectedOriginDetail, user]);
  const getOriginItemDraft = (item: any): PurchaseOrderItemDraft =>
    originItemDrafts[item.id] ?? getDefaultOriginItemDraft(item);
  const selectedOriginItemsToConvert = useMemo(
    () =>
      selectedOriginItems.map((item: any) => {
        const draft = normalizeDraftMoneyValues(
          getOriginItemDraft(item),
          pricesIncludeTaxDraft
        );
        return {
          purchaseRequestItemId: item.id,
          quantity: formatQuantityPayload(draft.quantity),
          unitPrice: formatUnitPricePayload(draft.unitPrice),
          subtotal: formatMoneyPayload(draft.subtotal),
          taxCode: draft.taxCode,
          additionalTaxCodes: draft.additionalTaxCodes,
        };
      }),
    [originItemDrafts, pricesIncludeTaxDraft, selectedOriginItems]
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
          const draft = normalizeDraftMoneyValues(
            getOriginItemDraft(item),
            pricesIncludeTaxDraft
          );
          return {
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            subtotal: draft.subtotal,
            pricesIncludeTax: pricesIncludeTaxDraft,
            taxCode: draft.taxCode,
            additionalTaxCodes: draft.additionalTaxCodes,
          };
        }),
        activeSalesTaxes
      ),
    [
      activeSalesTaxes,
      originItemDrafts,
      pricesIncludeTaxDraft,
      selectedOriginItems,
    ]
  );
  const originDraftValidationMessage = useMemo(() => {
    for (const item of selectedOriginItems) {
      const draft = getOriginItemDraft(item);
      const quantity = Number(draft.quantity);
      const unitPrice = Number(draft.unitPrice);
      const pendingQuantity =
        getPurchaseRequestItemPendingConversionQuantity(item);

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

    if (currencyDraft.currency === "USD") {
      const rawRate = currencyDraft.exchangeRate.trim();
      const rate = Number(rawRate);
      if (
        !/^\d{1,10}(?:\.\d{1,8})?$/.test(rawRate) ||
        !Number.isFinite(rate) ||
        rate <= 0
      ) {
        return "Ingrese una tasa referencial USD válida, positiva y con máximo 8 decimales";
      }
      if (!currencyDraft.exchangeRateDate) {
        return "Seleccione la fecha de la tasa referencial";
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
    currencyDraft.currency,
    currencyDraft.exchangeRate,
    currencyDraft.exchangeRateDate,
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
        canManagePurchaseOrders &&
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
        : (detail?.preferredSupplierContact?.id ??
            detail?.purchaseOrder.supplierContactId ??
            "")
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
    [
      selectedSupplier?.email,
      selectedSupplierContactId,
      selectedSupplierIdNumber,
    ]
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
  const selectedCurrencyCreatePayload = useMemo(
    () =>
      currencyDraft.currency === "USD"
        ? {
            currency: "USD" as const,
            exchangeRate: currencyDraft.exchangeRate.trim(),
            exchangeRateDate: currencyDraft.exchangeRateDate,
          }
        : { currency: "HNL" as const },
    [
      currencyDraft.currency,
      currencyDraft.exchangeRate,
      currencyDraft.exchangeRateDate,
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
        error instanceof Error
          ? error.message
          : "No se pudo preparar el adjunto"
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
    if (!newOrderDialogOpen || !selectedOriginDetail?.purchaseRequest) return;
    const isForeign =
      selectedOriginDetail.purchaseRequest.purchaseType === "extranjera";
    setCurrencyDraft({
      currency: isForeign ? "USD" : "HNL",
      exchangeRate: "",
      exchangeRateDate: isForeign ? currentDateInputValue() : "",
    });
  }, [newOrderDialogOpen, selectedOriginDetail?.purchaseRequest.id]);

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
    if (newOrderDialogOpen || !detail?.purchaseOrder) return;
    setCurrencyDraft({
      currency: detail.purchaseOrder.currency ?? "HNL",
      exchangeRate: formatExchangeRateDraft(detail.purchaseOrder.exchangeRate),
      exchangeRateDate: dateInputValue(detail.purchaseOrder.exchangeRateDate),
    });
  }, [
    detail?.purchaseOrder.id,
    detail?.purchaseOrder.currency,
    detail?.purchaseOrder.exchangeRate,
    detail?.purchaseOrder.exchangeRateDate,
    newOrderDialogOpen,
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
            const unitPrice = detail.purchaseOrder.pricesIncludeTax
              ? formatUnitPriceDisplay(item.unitPrice ?? "0.00")
              : formatMoneyDisplay(item.unitPrice ?? "0.00");
            const subtotal = detail.purchaseOrder.pricesIncludeTax
              ? calculateSubtotalDraftValue(quantity, unitPrice)
              : item.subtotal !== null && item.subtotal !== undefined
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
  }, [
    activeSalesTaxes,
    detail?.items,
    detail?.purchaseOrder.id,
    detail?.purchaseOrder.pricesIncludeTax,
  ]);

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
        unitPrice: detail.purchaseOrder.pricesIncludeTax
          ? formatUnitPriceDisplay(item.unitPrice ?? "0.00")
          : formatMoneyDisplay(item.unitPrice ?? "0.00"),
        subtotal: detail.purchaseOrder.pricesIncludeTax
          ? calculateSubtotalDraftValue(item.quantity, item.unitPrice)
          : item.subtotal !== null && item.subtotal !== undefined
            ? formatMoneyDisplay(item.subtotal)
            : calculateSubtotalDraftValue(item.quantity, item.unitPrice),
        taxCode: normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes),
        additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
          item.additionalTaxCodes,
          item.taxCode,
          activeSalesTaxes
        ),
        itemName:
          getTemporaryFixedAssetRequestedName(item) ??
          String(item.itemName ?? ""),
      };

      if (Number(item.unitPrice ?? 0) > 0) continue;
      if (Number(currentDraft.unitPrice ?? 0) > 0) continue;

      const nextDraft = {
        ...currentDraft,
        unitPrice: formatUnitPriceDisplay(latestPrice.unitPrice),
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
  }, [
    activeSalesTaxes,
    canEditOrderStructure,
    detail?.items,
    detail?.purchaseOrder.pricesIncludeTax,
    latestSupplierPrices,
  ]);

  const getItemDraft = (item: any): PurchaseOrderItemDraft =>
    itemDrafts[item.id] ?? {
      quantity: String(item.quantity ?? "0.00"),
      unitPrice: detail?.purchaseOrder.pricesIncludeTax
        ? formatUnitPriceDisplay(item.unitPrice ?? "0.00")
        : formatMoneyDisplay(item.unitPrice ?? "0.00"),
      subtotal: detail?.purchaseOrder.pricesIncludeTax
        ? calculateSubtotalDraftValue(item.quantity, item.unitPrice)
        : item.subtotal !== null && item.subtotal !== undefined
          ? formatMoneyDisplay(item.subtotal)
          : calculateSubtotalDraftValue(item.quantity, item.unitPrice),
      taxCode: normalizePurchaseOrderTaxCode(item.taxCode, activeSalesTaxes),
      additionalTaxCodes: normalizePurchaseOrderAdditionalTaxCodes(
        item.additionalTaxCodes,
        item.taxCode,
        activeSalesTaxes
      ),
      itemName:
        getTemporaryFixedAssetRequestedName(item) ??
        String(item.itemName ?? ""),
    };

  const pricingSummary = useMemo(
    () =>
      summarizePurchaseOrderLines(
        items.map((item: any) => {
          const draft = normalizeDraftMoneyValues(
            getItemDraft(item),
            detail?.purchaseOrder.pricesIncludeTax === true
          );
          return {
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            subtotal: draft.subtotal,
            pricesIncludeTax: detail?.purchaseOrder.pricesIncludeTax === true,
            taxCode: draft.taxCode,
            additionalTaxCodes: draft.additionalTaxCodes,
          };
        }),
        activeSalesTaxes
      ),
    [
      activeSalesTaxes,
      detail?.purchaseOrder.pricesIncludeTax,
      items,
      itemDrafts,
    ]
  );

  const hasPendingPricingChanges = useMemo(
    () =>
      canEditOrderStructure &&
      items.some((item: any) => {
        return !isPurchaseOrderItemDraftSynced(
          item,
          getItemDraft(item),
          activeSalesTaxes,
          detail?.purchaseOrder.pricesIncludeTax === true
        );
      }),
    [
      activeSalesTaxes,
      canEditOrderStructure,
      detail?.purchaseOrder.pricesIncludeTax,
      items,
      itemDrafts,
    ]
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
    const itemWithoutValidQuantity = items.find((item: any) => {
      const quantity = Number(getItemDraft(item).quantity || 0);
      return !Number.isFinite(quantity) || quantity <= 0;
    });
    if (itemWithoutValidQuantity) {
      return `Ingrese una cantidad mayor que cero para ${itemWithoutValidQuantity.itemName}`;
    }
    if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
      return "El total final de la orden debe ser mayor que cero";
    }
    if (
      detail.purchaseOrder.currency === "USD" &&
      (!detail.purchaseOrder.exchangeRate ||
        Number(detail.purchaseOrder.exchangeRate) <= 0 ||
        !detail.purchaseOrder.exchangeRateDate)
    ) {
      return "Complete la tasa referencial USD y su fecha";
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
  }, [
    contractSummary.expectedInvoiceCount,
    detail,
    items,
    itemDrafts,
    orderTotal,
    selectedSupplierId,
  ]);

  const confirmActionPending =
    deleteItemMutation.isPending ||
    cancelOrderMutation.isPending ||
    closeReceiptLineMutation.isPending ||
    movePendingToPurchaseRequestMutation.isPending ||
    updatePricesIncludeTaxMutation.isPending ||
    updateContractTermsMutation.isPending;
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

  const handleCurrencyDraftChange = (currency: PurchaseCurrency) => {
    if (currency === currencyDraft.currency) return;
    const pricedItems = newOrderDialogOpen
      ? selectedOriginItems.some(
          (item: any) => Number(getOriginItemDraft(item).unitPrice ?? 0) > 0
        )
      : items.some((item: any) => Number(item.unitPrice ?? 0) > 0);
    if (
      pricedItems &&
      !window.confirm(
        "Cambiar la moneda no convertirá precios ni totales. Los valores numéricos actuales se conservarán. ¿Desea continuar?"
      )
    ) {
      return;
    }

    setCurrencyDraft({
      currency,
      exchangeRate: "",
      exchangeRateDate: currency === "USD" ? currentDateInputValue() : "",
    });
  };

  const handleSaveCurrency = () => {
    if (!detail?.purchaseOrder || !canEditOrderStructure) return;
    if (currencyDraft.currency === "USD") {
      const rawRate = currencyDraft.exchangeRate.trim();
      const rate = Number(rawRate);
      if (
        !/^\d{1,10}(?:\.\d{1,8})?$/.test(rawRate) ||
        !Number.isFinite(rate) ||
        rate <= 0
      ) {
        toast.error(
          "Ingrese una tasa referencial válida y con máximo 8 decimales"
        );
        return;
      }
      if (!currencyDraft.exchangeRateDate) {
        toast.error("Seleccione la fecha de la tasa referencial");
        return;
      }
    }

    updateMutation.mutate({
      id: detail.purchaseOrder.id,
      currency: currencyDraft.currency,
      exchangeRate:
        currencyDraft.currency === "USD"
          ? currencyDraft.exchangeRate.trim()
          : null,
      exchangeRateDate:
        currencyDraft.currency === "USD"
          ? currencyDraft.exchangeRateDate
          : null,
    });
  };

  const handleSaveItemLine = (
    item: any,
    draftOverride?: PurchaseOrderItemDraft
  ) => {
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
    const draft = normalizeDraftMoneyValues(
      rawDraft,
      detail?.purchaseOrder.pricesIncludeTax === true
    );
    if (
      isPurchaseOrderItemDraftSynced(
        item,
        draft,
        activeSalesTaxes,
        detail?.purchaseOrder.pricesIncludeTax === true
      ) &&
      !itemNameChanged
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

    if (confirmState.kind === "price-tax-mode") {
      updatePricesIncludeTaxMutation.mutate({
        id: confirmState.orderId,
        pricesIncludeTax: confirmState.pricesIncludeTax,
      });
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
    const shouldPrintDraftWatermark = ![
      "emitida",
      "enviada",
      "parcialmente_recibida",
      "recibida",
      "anulada",
    ].includes(purchaseOrder.status);
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
    const paymentMethodLabel = formatPurchaseOrderPaymentMethodPrintLabel(
      purchaseOrder.paymentMethod ?? detail.directPurchasePaymentMethod
    );
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
          pricesIncludeTax: purchaseOrder.pricesIncludeTax,
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
    const fiscalSummaryRows = getPurchaseOrderFiscalSummaryRows(
      pricingSummary,
      purchaseOrder.currency ?? "HNL"
    )
      .map(
        row => `
        <tr>
          <td>${escapeHtml(
            row.label
              .replace(/\blempiras\b/gi, "")
              .replace(/\s+/g, " ")
              .trim()
          )}</td>
          <td class="numeric">${escapeHtml(formatPrintMoney(row.value))}</td>
        </tr>
      `
      )
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
            ${getReadablePrintStyles()}
            ${getReadablePurchaseOrderPrintStyles()}
          </style>
        </head>
        <body>
          ${shouldPrintDraftWatermark ? '<div class="draft-watermark">NO OFICIAL</div>' : ""}
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
                  <div class="value">${escapeHtml(paymentMethodLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Moneda:</div>
                  <div class="value">${escapeHtml(
                    getPurchaseCurrencyLabel(purchaseOrder.currency)
                  )}</div>
                </div>
                <div class="field">
                  <div class="label">Precios:</div>
                  <div class="value">${
                    purchaseOrder.pricesIncludeTax ? "INCLUYEN ISV" : "SIN ISV"
                  }</div>
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
                  <th style="width: 10%;">${
                    purchaseOrder.pricesIncludeTax ? "Valor U c/ISV" : "Valor U"
                  }</th>
                  <th style="width: 10%;">${
                    purchaseOrder.pricesIncludeTax ? "Base" : "Valor T"
                  }</th>
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

  const exportPurchaseOrdersCsv = async () => {
    if (isExportingCsv) return;
    setIsExportingCsv(true);
    let exportRows: any[];
    try {
      exportRows = await fetchAllFilteredPages((exportPage, pageSize) =>
        utils.purchaseOrders.listPage.fetch({
          search: debouncedSearchTerm.trim() || undefined,
          purchaseType:
            purchaseTypeFilter === "all" ? undefined : purchaseTypeFilter,
          status:
            isProcurementApprover || statusFilter === "all"
              ? undefined
              : statusFilter,
          page: exportPage,
          pageSize,
        })
      );
    } catch {
      toast.error("No se pudo exportar el archivo CSV");
      setIsExportingCsv(false);
      return;
    }
    if (exportRows.length === 0) {
      toast.error("No hay órdenes de compra para exportar");
      setIsExportingCsv(false);
      return;
    }
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
          header: "Moneda",
          value: (row: any) => row.purchaseOrder.currency ?? "HNL",
        },
        {
          header: "Total OC",
          value: (row: any) => Number(row.totalAmount ?? 0).toFixed(2),
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
              : STATUS_LABELS[
                  getEffectivePurchaseOrderStatus(
                    row.purchaseOrder.status,
                    row.purchaseOrder.approvalStatus
                  )
                ] || row.purchaseOrder.status,
        },
        {
          header: "Emisión",
          value: (row: any) =>
            EMISSION_STATUS_LABELS[row.purchaseOrder.status] || "Pendiente",
        },
      ],
      exportRows
    );
    setIsExportingCsv(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Órdenes de Compra</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportPurchaseOrdersCsv()}
            disabled={!ordersPage?.total || isExportingCsv}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExportingCsv ? "Exportando..." : "Exportar CSV"}
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
        <Select
          value={purchaseTypeFilter}
          onValueChange={setPurchaseTypeFilter}
        >
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
        {isProcurementApprover ? (
          <Select value="pendiente_aprobacion" disabled>
            <SelectTrigger className="h-10 w-full lg:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pendiente_aprobacion">
                Pendientes de aprobación
              </SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-full lg:w-56">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {getStatusFilterOptions(PROCUREMENT_APPROVALS_ENABLED).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando órdenes de compra...
            </div>
          ) : !(orders || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              {isProcurementApprover
                ? "No hay órdenes de compra pendientes de aprobación"
                : "No hay órdenes de compra registradas"}
            </div>
          ) : !filteredOrders.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay órdenes de compra que coincidan con los filtros
            </div>
          ) : (
            <>
              <div className="space-y-3 p-3 md:hidden">
                {filteredOrders.map((row: any) => {
                  const effectiveStatus = getEffectivePurchaseOrderStatus(
                    row.purchaseOrder.status,
                    row.purchaseOrder.approvalStatus
                  );
                  return (
                    <article
                      key={row.purchaseOrder.id}
                      className="space-y-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold leading-tight">
                            {row.purchaseOrder.orderNumber}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatPurchaseOrderRequestNumbers(row)}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-[10px] ${
                            STATUS_COLORS[effectiveStatus] || ""
                          }`}
                        >
                          {STATUS_LABELS[effectiveStatus] ||
                            row.purchaseOrder.status}
                        </Badge>
                      </div>

                      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Proyecto
                          </dt>
                          <dd className="mt-1 text-xs leading-snug">
                            {row.project
                              ? `${row.project.code} — ${row.project.name}`
                              : "—"}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Tipo
                          </dt>
                          <dd className="mt-1 text-xs">
                            {PURCHASE_TYPE_LABELS[
                              row.purchaseOrder.purchaseType
                            ] || "—"}
                          </dd>
                        </div>
                        <div className="col-span-2 min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Proveedor
                          </dt>
                          <dd className="mt-1 text-xs leading-snug">
                            {row.supplier?.name || "Proveedor pendiente"}
                            {row.supplier ? (
                              <span className="block text-muted-foreground">
                                RTN: {formatSupplierRtnLabel(row.supplier)}
                              </span>
                            ) : null}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Requiriente
                          </dt>
                          <dd className="mt-1 text-xs leading-snug">
                            {formatPurchaseOrderRequestedBy(row)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Clasificación
                          </dt>
                          <dd className="mt-1 text-xs uppercase">
                            {row.purchaseOrder.classification}
                          </dd>
                        </div>
                      </dl>

                      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                        {PROCUREMENT_APPROVALS_ENABLED ? (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${getApprovalStatusColor(
                              row.purchaseOrder.approvalStatus
                            )}`}
                          >
                            {getApprovalStatusLabel(
                              row.purchaseOrder.approvalStatus
                            )}
                          </Badge>
                        ) : null}
                        {row.purchaseOrder.appliesContract ? (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              row.contractSummary?.isExpired
                                ? "border-rose-300 bg-rose-50 text-rose-700"
                                : row.contractSummary?.expiresSoon
                                  ? "border-amber-300 bg-amber-50 text-amber-800"
                                  : "border-cyan-300 bg-cyan-50 text-cyan-700"
                            }`}
                          >
                            {row.contractSummary?.statusLabel || "Contrato"}
                          </Badge>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto"
                          onClick={() => setSelectedId(row.purchaseOrder.id)}
                        >
                          Ver detalle
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1720px] text-sm">
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
                      {PROCUREMENT_APPROVALS_ENABLED ? (
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Aprobación
                        </th>
                      ) : null}
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Contrato
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
                          {PURCHASE_TYPE_LABELS[
                            row.purchaseOrder.purchaseType
                          ] || "—"}
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
                              STATUS_COLORS[
                                getEffectivePurchaseOrderStatus(
                                  row.purchaseOrder.status,
                                  row.purchaseOrder.approvalStatus
                                )
                              ] || ""
                            }`}
                          >
                            {STATUS_LABELS[
                              getEffectivePurchaseOrderStatus(
                                row.purchaseOrder.status,
                                row.purchaseOrder.approvalStatus
                              )
                            ] || row.purchaseOrder.status}
                          </Badge>
                        </td>
                        {PROCUREMENT_APPROVALS_ENABLED ? (
                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className={`text-xs ${getApprovalStatusColor(
                                row.purchaseOrder.approvalStatus
                              )}`}
                            >
                              {getApprovalStatusLabel(
                                row.purchaseOrder.approvalStatus
                              )}
                            </Badge>
                          </td>
                        ) : null}
                        <td className="p-3">
                          {row.purchaseOrder.appliesContract ? (
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                row.contractSummary?.isExpired
                                  ? "border-rose-300 bg-rose-50 text-rose-700"
                                  : row.contractSummary?.expiresSoon
                                    ? "border-amber-300 bg-amber-50 text-amber-800"
                                    : "border-cyan-300 bg-cyan-50 text-cyan-700"
                              }`}
                            >
                              {row.contractSummary?.statusLabel || "Contrato"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No aplica
                            </span>
                          )}
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
            </>
          )}
          {ordersPage ? (
            <DataPagination
              page={ordersPage.page}
              pageSize={ordersPage.pageSize}
              total={ordersPage.total}
              totalPages={ordersPage.totalPages}
              onPageChange={setPage}
            />
          ) : null}
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
                            <CommandEmpty>
                              No hay orígenes disponibles.
                            </CommandEmpty>
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
                                getPurchaseRequestItemPendingConversionQuantity(
                                  item
                                )
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
                  setCurrencyDraft(DEFAULT_CURRENCY_DRAFT);
                  setPricesIncludeTaxDraft(false);
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
                    pricesIncludeTax: pricesIncludeTaxDraft,
                    ...selectedSupplierCreatePayload,
                    ...selectedContractCreatePayload,
                    ...selectedCurrencyCreatePayload,
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
            setCurrencyDraft(DEFAULT_CURRENCY_DRAFT);
            setPricesIncludeTaxDraft(false);
            setConfirmState({ kind: null });
            setApprovalItemDecisions({});
            setApprovalReviewComment("");
          }
        }}
      >
        <DialogContent
          className={
            isCompactApprovalView
              ? "flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100vh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1000px]"
              : "scrollbar-visible max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1600px] sm:p-6 lg:p-7"
          }
        >
          <DialogHeader
            className={
              isCompactApprovalView
                ? "shrink-0 border-b border-border/70 px-4 py-3 pr-12 sm:px-8 sm:py-5"
                : "border-b border-border/70 pb-4 pr-10"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <DialogTitle
                  className={`font-bold tracking-tight ${
                    isCompactApprovalView
                      ? "text-2xl sm:text-3xl"
                      : "text-[2.1rem] sm:text-[2.5rem]"
                  }`}
                >
                  {newOrderDialogOpen
                    ? "Nueva orden de compra"
                    : detail?.purchaseOrder.orderNumber || "Orden de Compra"}
                </DialogTitle>
                {isCompactApprovalView ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Pendiente de decisión y bloqueada para edición.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {newOrderDialogOpen ? (
                  <Badge
                    variant="outline"
                    className={`text-sm ${STATUS_COLORS.borrador}`}
                  >
                    Borrador
                  </Badge>
                ) : detail?.purchaseOrder.status ? (
                  <>
                    {!isCompactApprovalView ? (
                      <Badge
                        variant="outline"
                        className={`text-sm ${
                          STATUS_COLORS[
                            getEffectivePurchaseOrderStatus(
                              detail.purchaseOrder.status,
                              detail.purchaseOrder.approvalStatus
                            )
                          ] || ""
                        }`}
                      >
                        {STATUS_LABELS[
                          getEffectivePurchaseOrderStatus(
                            detail.purchaseOrder.status,
                            detail.purchaseOrder.approvalStatus
                          )
                        ] || detail.purchaseOrder.status}
                      </Badge>
                    ) : null}
                    {isCompactApprovalView ? (
                      <Badge variant="secondary" className="text-sm">
                        {items.length} ítem(s)
                      </Badge>
                    ) : null}
                    {PROCUREMENT_APPROVALS_ENABLED && !isCompactApprovalView ? (
                      <Badge
                        variant="outline"
                        className={`text-sm ${getApprovalStatusColor(
                          detail.purchaseOrder.approvalStatus
                        )}`}
                      >
                        Aprobación:{" "}
                        {getApprovalStatusLabel(
                          detail.purchaseOrder.approvalStatus
                        )}
                      </Badge>
                    ) : null}
                    {detail.purchaseOrder.appliesContract &&
                    !isCompactApprovalView ? (
                      <Badge
                        variant="outline"
                        className={`text-sm ${
                          contractSummary.isExpired
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : contractSummary.expiresSoon
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-cyan-300 bg-cyan-50 text-cyan-700"
                        }`}
                      >
                        Contrato: {contractSummary.statusLabel}
                      </Badge>
                    ) : null}
                  </>
                ) : null}
              </div>
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
                              <CommandEmpty>
                                No hay orígenes disponibles.
                              </CommandEmpty>
                              <CommandGroup heading="Solicitudes de compra">
                                {purchaseRequestOriginRows.map((row: any) => {
                                  const originId = String(
                                    row.purchaseRequest.id
                                  );
                                  const selected =
                                    selectedOriginId === originId;

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
                        onSelect={supplierId => {
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

              <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
                <div>
                  <h3 className="font-semibold">Moneda de la orden</h3>
                  <p className="text-sm text-muted-foreground">
                    La tasa USD es únicamente referencial; no convierte precios
                    ni totales.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Moneda</Label>
                    <Select
                      value={currencyDraft.currency}
                      onValueChange={value =>
                        handleCurrencyDraftChange(value as PurchaseCurrency)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HNL">LEMPIRA (HNL)</SelectItem>
                        <SelectItem value="USD">
                          DÓLAR ESTADOUNIDENSE (USD)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {currencyDraft.currency === "USD" ? (
                    <>
                      <div className="space-y-2">
                        <Label>Tasa referencial</Label>
                        <Input
                          inputMode="decimal"
                          value={currencyDraft.exchangeRate}
                          onChange={event =>
                            setCurrencyDraft(current => ({
                              ...current,
                              exchangeRate: event.target.value,
                            }))
                          }
                          placeholder="1 USD = 26.00000000 HNL"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha de la tasa</Label>
                        <Input
                          type="date"
                          value={currencyDraft.exchangeRateDate}
                          onChange={event =>
                            setCurrencyDraft(current => ({
                              ...current,
                              exchangeRateDate: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="space-y-2 border-t border-border/70 pt-3">
                  <Label>Los precios digitados</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={pricesIncludeTaxDraft ? "included" : "excluded"}
                    onValueChange={value => {
                      if (!value) return;
                      setPricesIncludeTaxDraft(value === "included");
                    }}
                    className="justify-start"
                  >
                    <ToggleGroupItem value="excluded" className="px-4">
                      Sin impuesto
                    </ToggleGroupItem>
                    <ToggleGroupItem value="included" className="px-4">
                      Impuesto incluido
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <p className="text-sm text-muted-foreground">
                    {pricesIncludeTaxDraft
                      ? "El precio ingresado será el total con impuesto; la base y el ISV se calcularán automáticamente."
                      : "El precio ingresado será la base; el impuesto se agregará al total."}
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

                    {contractAuditLogs.length > 0 ? (
                      <div className="rounded-xl border border-border/70 bg-background p-3">
                        <div className="mb-2 text-sm font-semibold">
                          Bitácora del contrato
                        </div>
                        <div className="space-y-2">
                          {contractAuditLogs.slice(0, 6).map((entry: any) => (
                            <div
                              key={entry.log.id}
                              className="grid gap-2 text-xs text-muted-foreground md:grid-cols-[1fr_1fr_1fr]"
                            >
                              <span className="font-medium text-foreground">
                                {CONTRACT_AUDIT_FIELD_LABELS[entry.log.field] ??
                                  entry.log.field}
                              </span>
                              <span>
                                {formatContractAuditValue(
                                  entry.log.field,
                                  entry.log.oldValue
                                )}{" "}
                                →{" "}
                                {formatContractAuditValue(
                                  entry.log.field,
                                  entry.log.newValue
                                )}
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
                        {pricesIncludeTaxDraft
                          ? "Precio unitario (incluye ISV)"
                          : "Precio unitario"}
                      </th>
                      <th className="whitespace-nowrap p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        Impuesto
                      </th>
                      <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                        {pricesIncludeTaxDraft ? "Base" : "Subtotal"}
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
                    ) : selectedOriginDetail &&
                      selectedOriginItems.length > 0 ? (
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
                          pricesIncludeTax: pricesIncludeTaxDraft,
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
                                step={
                                  pricesIncludeTaxDraft ? "0.00000001" : "0.01"
                                }
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
                                        getDefaultOriginItemDraft(item),
                                      pricesIncludeTaxDraft
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
                                value={
                                  pricesIncludeTaxDraft
                                    ? formatMoneyDisplay(lineAmounts.subtotal)
                                    : draft.subtotal
                                }
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
                                        getDefaultOriginItemDraft(item),
                                      pricesIncludeTaxDraft
                                    ),
                                  }))
                                }
                                className="h-10 w-full min-w-[170px] text-right font-semibold"
                                disabled={pricesIncludeTaxDraft}
                              />
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(
                                lineAmounts.taxAmount,
                                currencyDraft.currency
                              )}
                            </td>
                            <td className="p-3 text-right align-middle font-semibold sm:p-4">
                              {formatPurchaseOrderCurrency(
                                lineAmounts.total,
                                currencyDraft.currency
                              )}
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
                <FiscalSummaryCard
                  summary={originPricingSummary}
                  currency={currencyDraft.currency}
                />
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
                      onClick={() =>
                        newOrderAttachmentInputRef.current?.click()
                      }
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
                      const AttachmentIcon = attachment.mimeType.startsWith(
                        "image/"
                      )
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
                      setCurrencyDraft(DEFAULT_CURRENCY_DRAFT);
                      setPricesIncludeTaxDraft(false);
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
                        pricesIncludeTax: pricesIncludeTaxDraft,
                        ...selectedSupplierCreatePayload,
                        ...selectedContractCreatePayload,
                        ...selectedCurrencyCreatePayload,
                      })
                    }
                    disabled={!canCreateFromSelectedOrigin}
                  >
                    {createFromOriginMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShoppingCart className="mr-2 h-4 w-4" />
                    )}
                    {createFromOriginMutation.isPending
                      ? "Creando..."
                      : "Crear OC"}
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
            isCompactApprovalView ? (
              <CompactProcurementApprovalPanel
                summaryFields={[
                  {
                    label: "Proyecto",
                    value: detail.project
                      ? `${detail.project.code} — ${detail.project.name}`
                      : `Proyecto ${detail.purchaseOrder.projectId}`,
                    icon: "project",
                  },
                  {
                    label: "Proveedor",
                    value: detail.supplier?.name || "Proveedor pendiente",
                    icon: "supplier",
                  },
                  {
                    label: "Tipo de compra",
                    value:
                      PURCHASE_TYPE_LABELS[
                        detail.purchaseOrder.purchaseType ?? ""
                      ] ||
                      detail.purchaseOrder.purchaseType ||
                      "—",
                    icon: "purchase",
                  },
                  {
                    label: "Fecha necesaria",
                    value: detail.purchaseOrder.neededBy
                      ? new Date(
                          detail.purchaseOrder.neededBy
                        ).toLocaleDateString("es-HN")
                      : "—",
                    icon: "date",
                  },
                  {
                    label: "Total con impuestos",
                    value: formatPurchaseOrderCurrency(
                      orderTotal,
                      orderCurrency
                    ),
                    icon: "total",
                    accent: true,
                  },
                ]}
                detailTitle={`Ítems a aprobar (${items.length})`}
                detailContent={
                  <>
                    <div className="space-y-3 p-3 md:hidden">
                      {items.map((item: any) => {
                        const draft = getItemDraft(item);
                        const lineAmounts = calculatePurchaseOrderLineAmounts({
                          quantity: draft.quantity,
                          unitPrice: draft.unitPrice,
                          subtotal: draft.subtotal,
                          pricesIncludeTax:
                            detail.purchaseOrder.pricesIncludeTax,
                          taxCode: draft.taxCode,
                          additionalTaxCodes: draft.additionalTaxCodes,
                          taxes: activeSalesTaxes,
                        });
                        return (
                          <article
                            key={item.id}
                            className="space-y-3 rounded-xl border border-border/70 bg-card p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-medium leading-snug">
                                {getTemporaryFixedAssetDisplayName(item)}
                              </p>
                              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                                {item.currentSapItemCode ||
                                  item.originalSapItemCode ||
                                  "—"}
                              </span>
                            </div>
                            <dl className="grid grid-cols-2 gap-3 border-t border-border/70 pt-3 text-sm">
                              <div>
                                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Cantidad
                                </dt>
                                <dd className="mt-1 font-medium">
                                  {formatQuantity(draft.quantity)}{" "}
                                  {item.unit || ""}
                                </dd>
                              </div>
                              <div className="text-right">
                                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Precio unitario
                                </dt>
                                <dd className="mt-1">
                                  {formatPurchaseOrderCurrency(
                                    Number(draft.unitPrice || 0),
                                    orderCurrency
                                  )}
                                </dd>
                              </div>
                              <div className="col-span-2 grid grid-cols-3 gap-2 border-t border-border/70 pt-2">
                                <div>
                                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Subtotal
                                  </dt>
                                  <dd className="mt-1 font-medium">
                                    {formatPurchaseOrderCurrency(
                                      lineAmounts.subtotal,
                                      orderCurrency
                                    )}
                                  </dd>
                                </div>
                                <div className="text-right">
                                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Impuesto
                                  </dt>
                                  <dd className="mt-1 font-medium">
                                    {formatPurchaseOrderCurrency(
                                      lineAmounts.taxAmount,
                                      orderCurrency
                                    )}
                                  </dd>
                                </div>
                                <div className="text-right">
                                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Total línea
                                  </dt>
                                  <dd className="mt-1 font-semibold text-blue-600">
                                    {formatPurchaseOrderCurrency(
                                      lineAmounts.total,
                                      orderCurrency
                                    )}
                                  </dd>
                                </div>
                              </div>
                            </dl>
                            <div className="grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
                              <label
                                htmlFor={`compact-approve-order-item-${item.id}`}
                                className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                                  approvalItemDecisions[item.id] === "approve"
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                    : "border-border/70 text-muted-foreground hover:bg-muted/30"
                                }`}
                              >
                                <Checkbox
                                  id={`compact-approve-order-item-${item.id}`}
                                  checked={
                                    approvalItemDecisions[item.id] === "approve"
                                  }
                                  onCheckedChange={checked =>
                                    updateApprovalItemDecision(
                                      item.id,
                                      "approve",
                                      checked === true
                                    )
                                  }
                                  disabled={reviewApprovalMutation.isPending}
                                  className="data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
                                  aria-label={`Aprobar ${getTemporaryFixedAssetDisplayName(item)}`}
                                />
                                Aprobar
                              </label>
                              <label
                                htmlFor={`compact-reject-order-item-${item.id}`}
                                className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                                  approvalItemDecisions[item.id] === "reject"
                                    ? "border-red-500 bg-red-50 text-red-700"
                                    : "border-border/70 text-muted-foreground hover:bg-muted/30"
                                }`}
                              >
                                <Checkbox
                                  id={`compact-reject-order-item-${item.id}`}
                                  checked={
                                    approvalItemDecisions[item.id] === "reject"
                                  }
                                  onCheckedChange={checked =>
                                    updateApprovalItemDecision(
                                      item.id,
                                      "reject",
                                      checked === true
                                    )
                                  }
                                  disabled={reviewApprovalMutation.isPending}
                                  className="data-[state=checked]:border-red-600 data-[state=checked]:bg-red-600"
                                  aria-label={`Rechazar ${getTemporaryFixedAssetDisplayName(item)}`}
                                />
                                Rechazar
                              </label>
                            </div>
                          </article>
                        );
                      })}
                    </div>

                    <table className="hidden w-full min-w-[900px] text-sm md:table">
                      <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 text-left">Artículo</th>
                          <th className="px-4 py-3 text-left">SAP</th>
                          <th className="px-4 py-3 text-right">Cantidad</th>
                          <th className="px-4 py-3 text-right">
                            Precio unitario
                          </th>
                          <th className="px-4 py-3 text-right">Total línea</th>
                          <th className="px-3 py-3 text-center">Aprobar</th>
                          <th className="px-3 py-3 text-center">Rechazar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {items.map((item: any) => {
                          const draft = getItemDraft(item);
                          const lineAmounts = calculatePurchaseOrderLineAmounts(
                            {
                              quantity: draft.quantity,
                              unitPrice: draft.unitPrice,
                              subtotal: draft.subtotal,
                              pricesIncludeTax:
                                detail.purchaseOrder.pricesIncludeTax,
                              taxCode: draft.taxCode,
                              additionalTaxCodes: draft.additionalTaxCodes,
                              taxes: activeSalesTaxes,
                            }
                          );
                          return (
                            <tr key={item.id}>
                              <td className="px-4 py-3 font-medium">
                                {getTemporaryFixedAssetDisplayName(item)}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {item.currentSapItemCode ||
                                  item.originalSapItemCode ||
                                  "—"}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">
                                {formatQuantity(draft.quantity)}{" "}
                                {item.unit || ""}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {formatPurchaseOrderCurrency(
                                  Number(draft.unitPrice || 0),
                                  orderCurrency
                                )}
                              </td>
                              <td className="min-w-[170px] px-4 py-3 text-right">
                                <div className="text-xs text-muted-foreground">
                                  Base{" "}
                                  {formatPurchaseOrderCurrency(
                                    lineAmounts.subtotal,
                                    orderCurrency
                                  )}{" "}
                                  + impuesto{" "}
                                  {formatPurchaseOrderCurrency(
                                    lineAmounts.taxAmount,
                                    orderCurrency
                                  )}
                                </div>
                                <div className="mt-1 font-semibold text-blue-600">
                                  {formatPurchaseOrderCurrency(
                                    lineAmounts.total,
                                    orderCurrency
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <Checkbox
                                  checked={
                                    approvalItemDecisions[item.id] === "approve"
                                  }
                                  onCheckedChange={checked =>
                                    updateApprovalItemDecision(
                                      item.id,
                                      "approve",
                                      checked === true
                                    )
                                  }
                                  disabled={reviewApprovalMutation.isPending}
                                  className="mx-auto size-5 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
                                  aria-label={`Aprobar ${getTemporaryFixedAssetDisplayName(item)}`}
                                />
                              </td>
                              <td className="px-3 py-3 text-center">
                                <Checkbox
                                  checked={
                                    approvalItemDecisions[item.id] === "reject"
                                  }
                                  onCheckedChange={checked =>
                                    updateApprovalItemDecision(
                                      item.id,
                                      "reject",
                                      checked === true
                                    )
                                  }
                                  disabled={reviewApprovalMutation.isPending}
                                  className="mx-auto size-5 data-[state=checked]:border-red-600 data-[state=checked]:bg-red-600"
                                  aria-label={`Rechazar ${getTemporaryFixedAssetDisplayName(item)}`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t border-border bg-muted/20">
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-3 text-right text-xs text-muted-foreground"
                          >
                            Subtotal{" "}
                            {formatPurchaseOrderCurrency(
                              pricingSummary.subtotal,
                              orderCurrency
                            )}{" "}
                            · Impuestos{" "}
                            {formatPurchaseOrderCurrency(
                              pricingSummary.totalIsv,
                              orderCurrency
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-blue-600">
                            {formatPurchaseOrderCurrency(
                              pricingSummary.total,
                              orderCurrency
                            )}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </>
                }
                decisionContent={
                  <>
                    <section
                      className={`mt-4 rounded-xl border p-4 text-sm ${
                        approvalUndecidedItemCount > 0
                          ? "border-amber-300 bg-amber-50/60 text-amber-900"
                          : approvalRejectedItemIds.length > 0
                            ? "border-red-200 bg-red-50/30 text-red-900"
                            : "border-emerald-200 bg-emerald-50/40 text-emerald-900"
                      }`}
                    >
                      <p className="font-semibold">
                        {approvalUndecidedItemCount > 0
                          ? `Falta decidir ${approvalUndecidedItemCount} artículo(s).`
                          : approvalRejectedItemIds.length === 0
                            ? `Aprobación total: ${approvalApprovedItemIds.length} artículo(s).`
                            : isTotalApprovalRejection
                              ? "Rechazo total: la OC será anulada."
                              : `Rechazo parcial: ${approvalApprovedItemIds.length} artículo(s) aprobados y ${approvalRejectedItemIds.length} rechazados.`}
                      </p>
                      {approvalRejectedItemIds.length > 0 ? (
                        <p className="mt-1">
                          {isTotalApprovalRejection
                            ? "Todos los artículos regresarán a sus solicitudes de origen."
                            : `La OC quedará aprobada por ${formatPurchaseOrderCurrency(
                                approvalRemainingTotal,
                                orderCurrency
                              )}; los artículos rechazados regresarán a sus solicitudes.`}
                        </p>
                      ) : null}
                    </section>

                    {approvalRejectedItemIds.length > 0 ? (
                      <section className="mt-4 rounded-xl border border-red-200 bg-red-50/30 p-4">
                        <div className="space-y-2">
                          <Label
                            htmlFor="purchase-order-line-rejection-reason"
                            className="text-sm font-semibold"
                          >
                            Motivo de rechazo
                          </Label>
                          <Textarea
                            id="purchase-order-line-rejection-reason"
                            value={approvalReviewComment}
                            onChange={event =>
                              setApprovalReviewComment(event.target.value)
                            }
                            placeholder="Explique por qué se rechazan las líneas seleccionadas"
                            rows={3}
                            minLength={5}
                            maxLength={1000}
                            disabled={reviewApprovalMutation.isPending}
                            className="min-h-[96px] resize-y bg-background text-sm"
                          />
                          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                            <span>
                              Obligatorio, mínimo 5 caracteres. Se aplicará a{" "}
                              {approvalRejectedItemIds.length} línea(s).
                            </span>
                            <span>{approvalReviewComment.length}/1000</span>
                          </div>
                        </div>
                      </section>
                    ) : null}
                  </>
                }
                notes={detail.purchaseOrder.notes}
                documentsDescription="Consulta los archivos de soporte antes de finalizar la revisión."
                documentsContent={
                  <DocumentAttachmentsPanel
                    entityType="purchase_order"
                    entityId={detail.purchaseOrder.id}
                    category="orden_compra"
                    title="Archivos disponibles"
                    canManage={false}
                    canDelete={false}
                    className="rounded-none border-0"
                  />
                }
                history={approvalHistory.map((entry: any, index: number) => ({
                  id: entry.id ?? `${entry.createdAt}-${index}`,
                  title: formatApprovalAction(entry.action),
                  actor: [
                    entry.actorName || "Usuario no disponible",
                    formatApprovalActorRole(entry.actorRole),
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  date: entry.createdAt
                    ? new Date(entry.createdAt).toLocaleString("es-HN")
                    : "Fecha no disponible",
                  comment: entry.comment,
                }))}
                historyDescription="Registro de decisiones de esta OC."
                emptyHistoryMessage="Esta orden todavía no tiene movimientos de aprobación."
                onPrint={handlePrintPurchaseOrder}
                decisionActions={
                  <Button
                    type="button"
                    className="h-11 min-w-48 px-6"
                    onClick={handleFinalizeApprovalReview}
                    disabled={!canFinalizeApprovalReview}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {reviewApprovalMutation.isPending
                      ? "Finalizando..."
                      : "Finalizar revisión"}
                  </Button>
                }
                isPending={reviewApprovalMutation.isPending}
              />
            ) : (
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
                          onSelect={supplierId => {
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

                <div
                  className={`grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4 ${
                    PROCUREMENT_APPROVALS_ENABLED ? "md:grid-cols-3" : ""
                  }`}
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total final
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatPurchaseOrderCurrency(orderTotal, orderCurrency)}
                    </p>
                  </div>
                  {PROCUREMENT_APPROVALS_ENABLED ? (
                    <>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Regla de aprobación
                        </p>
                        <p className="mt-1 text-sm font-medium">
                          {orderRequiresApproval
                            ? "Requiere aprobación"
                            : "Puede emitirse directamente"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Límite:{" "}
                          {formatPurchaseOrderCurrency(
                            orderApprovalMinimum,
                            orderCurrency
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Aprobación
                        </p>
                        <Badge
                          variant="outline"
                          className={`mt-1 ${getApprovalStatusColor(orderApprovalStatus)}`}
                        >
                          {getApprovalStatusLabel(orderApprovalStatus)}
                        </Badge>
                      </div>
                    </>
                  ) : null}
                  {isPostApprovalLocked ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-3">
                      Esta OC conserva un bloqueo histórico después de su
                      emisión. No admite cambios, adjuntos, cancelación ni
                      operaciones posteriores.
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">Moneda de la orden</h3>
                      <p className="text-sm text-muted-foreground">
                        {getPurchaseCurrencyLabel(currencyDraft.currency)}
                        {currencyDraft.currency === "USD" &&
                        currencyDraft.exchangeRate
                          ? ` · 1 USD = ${currencyDraft.exchangeRate} HNL`
                          : ""}
                      </p>
                    </div>
                    {canEditOrderStructure ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleSaveCurrency}
                        disabled={updateMutation.isPending}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Guardar moneda
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Moneda</Label>
                      <Select
                        value={currencyDraft.currency}
                        disabled={!canEditOrderStructure}
                        onValueChange={value =>
                          handleCurrencyDraftChange(value as PurchaseCurrency)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HNL">LEMPIRA (HNL)</SelectItem>
                          <SelectItem value="USD">
                            DÓLAR ESTADOUNIDENSE (USD)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {currencyDraft.currency === "USD" ? (
                      <>
                        <div className="space-y-2">
                          <Label>Tasa referencial</Label>
                          <Input
                            inputMode="decimal"
                            value={currencyDraft.exchangeRate}
                            disabled={!canEditOrderStructure}
                            onChange={event =>
                              setCurrencyDraft(current => ({
                                ...current,
                                exchangeRate: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Fecha de la tasa</Label>
                          <Input
                            type="date"
                            value={currencyDraft.exchangeRateDate}
                            disabled={!canEditOrderStructure}
                            onChange={event =>
                              setCurrencyDraft(current => ({
                                ...current,
                                exchangeRateDate: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </>
                    ) : null}
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
                                    <SelectItem
                                      key={frequency}
                                      value={frequency}
                                    >
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

                    {contractAuditLogs.length > 0 ? (
                      <div className="rounded-xl border border-border/70 bg-background p-3">
                        <div className="mb-2 text-sm font-semibold">
                          Bitácora del contrato
                        </div>
                        <div className="space-y-2">
                          {contractAuditLogs.slice(0, 6).map((entry: any) => (
                            <div
                              key={entry.log.id}
                              className="grid gap-2 text-xs text-muted-foreground md:grid-cols-[1fr_1fr_1fr]"
                            >
                              <span className="font-medium text-foreground">
                                {CONTRACT_AUDIT_FIELD_LABELS[entry.log.field] ??
                                  entry.log.field}
                              </span>
                              <span>
                                {formatContractAuditValue(
                                  entry.log.field,
                                  entry.log.oldValue
                                )}{" "}
                                →{" "}
                                {formatContractAuditValue(
                                  entry.log.field,
                                  entry.log.newValue
                                )}
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

                <div className="flex flex-col gap-3 border-y border-border/70 bg-muted/10 px-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Label className="text-sm font-semibold">
                      Impuesto en precios
                    </Label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {detail.purchaseOrder.pricesIncludeTax
                        ? "Precio digitado: total final con ISV"
                        : "Precio digitado: base sin ISV"}
                    </p>
                  </div>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={
                      detail.purchaseOrder.pricesIncludeTax
                        ? "included"
                        : "excluded"
                    }
                    disabled={
                      !canEditOrderStructure ||
                      updatePricesIncludeTaxMutation.isPending
                    }
                    onValueChange={value => {
                      if (!value) return;
                      const pricesIncludeTax = value === "included";
                      if (
                        pricesIncludeTax ===
                        detail.purchaseOrder.pricesIncludeTax
                      ) {
                        return;
                      }
                      setConfirmState({
                        kind: "price-tax-mode",
                        orderId: detail.purchaseOrder.id,
                        pricesIncludeTax,
                      });
                    }}
                    aria-label="Modo de impuesto de los precios"
                    className="justify-start sm:justify-end"
                  >
                    <ToggleGroupItem
                      value="excluded"
                      className="h-10 min-w-[130px] gap-2 px-4"
                    >
                      {!detail.purchaseOrder.pricesIncludeTax ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <span className="h-4 w-4" aria-hidden="true" />
                      )}
                      Sin ISV
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="included"
                      className="h-10 min-w-[130px] gap-2 px-4"
                    >
                      {detail.purchaseOrder.pricesIncludeTax ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <span className="h-4 w-4" aria-hidden="true" />
                      )}
                      Incluye ISV
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

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
                          {detail.purchaseOrder.pricesIncludeTax
                            ? "Precio unitario (incluye ISV)"
                            : "Precio unitario"}
                        </th>
                        <th className="whitespace-nowrap p-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                          Impuesto
                        </th>
                        <th className="whitespace-nowrap p-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:p-4">
                          {detail.purchaseOrder.pricesIncludeTax
                            ? "Base"
                            : "Subtotal"}
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
                        const canCloseThisReceiptLine =
                          canCloseReceiptLine(item);
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
                          pricesIncludeTax:
                            detail.purchaseOrder.pricesIncludeTax,
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
                                  disabled={
                                    !canEditOrderStructure || isSavingThisLine
                                  }
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
                                  step={
                                    detail.purchaseOrder.pricesIncludeTax
                                      ? "0.00000001"
                                      : "0.01"
                                  }
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
                                  onBlur={() => handleSaveItemLine(item)}
                                  className="h-10 w-full text-right text-sm sm:text-base"
                                  placeholder="0.00"
                                  disabled={
                                    !canEditOrderStructure || isSavingThisLine
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
                                      ...(current[item.id] ??
                                        getItemDraft(item)),
                                      taxCode: nextTaxCode,
                                      additionalTaxCodes:
                                        nextAdditionalTaxCodes,
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
                                value={
                                  detail.purchaseOrder.pricesIncludeTax
                                    ? formatMoneyDisplay(lineAmounts.subtotal)
                                    : draft.subtotal
                                }
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
                                onBlur={() => handleSaveItemLine(item)}
                                className="h-10 w-full min-w-[180px] max-w-[240px] text-right text-sm font-semibold sm:text-base"
                                placeholder="0.00"
                                disabled={
                                  detail.purchaseOrder.pricesIncludeTax ||
                                  !canEditOrderStructure ||
                                  isSavingThisLine
                                }
                              />
                            </td>
                            <td className="p-3 text-right align-middle sm:p-4">
                              <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                                {formatPurchaseOrderCurrency(
                                  lineAmounts.taxAmount,
                                  detail.purchaseOrder.currency
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-right align-middle sm:p-4">
                              <div className="whitespace-nowrap text-base font-semibold sm:text-lg">
                                {formatPurchaseOrderCurrency(
                                  lineAmounts.total,
                                  detail.purchaseOrder.currency
                                )}
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
                                      onClick={() =>
                                        handleCloseReceiptLine(item)
                                      }
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
                  <FiscalSummaryCard
                    summary={pricingSummary}
                    currency={detail.purchaseOrder.currency}
                  />
                </div>

                {PROCUREMENT_APPROVALS_ENABLED ? (
                  <details
                    key={`approval-history-${selectedId}`}
                    className="group overflow-hidden rounded-2xl border border-border/70 bg-muted/10"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/30 sm:p-5 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block font-semibold">
                          Historial de aprobación
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          Envíos, decisiones y correcciones registradas para
                          esta OC.
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <Badge
                          variant="secondary"
                          className="rounded-full px-3 py-1 text-xs"
                        >
                          {approvalHistory.length} movimiento(s)
                        </Badge>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </span>
                    </summary>

                    <div className="border-t border-border/70 p-4 sm:p-5">
                      {approvalHistory.length > 0 ? (
                        <div className="space-y-0">
                          {approvalHistory.map((entry: any, index: number) => (
                            <div
                              key={entry.id ?? `${entry.createdAt}-${index}`}
                              className="relative border-l-2 border-border pb-5 pl-5 last:pb-0"
                            >
                              <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-semibold">
                                    {formatApprovalAction(entry.action)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {entry.actorName || "Usuario no disponible"}{" "}
                                    · {formatApprovalActorRole(entry.actorRole)}
                                  </p>
                                </div>
                                <time className="text-xs text-muted-foreground">
                                  {entry.createdAt
                                    ? new Date(entry.createdAt).toLocaleString(
                                        "es-HN"
                                      )
                                    : "Fecha no disponible"}
                                </time>
                              </div>
                              {entry.previousStatus || entry.newStatus ? (
                                <p className="mt-2 text-sm text-muted-foreground">
                                  {formatApprovalTimelineStatus(
                                    entry.previousStatus
                                  )}{" "}
                                  →{" "}
                                  {formatApprovalTimelineStatus(
                                    entry.newStatus
                                  )}
                                </p>
                              ) : null}
                              {entry.amount !== null &&
                              entry.amount !== undefined ? (
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Monto registrado:{" "}
                                  {formatPurchaseOrderCurrency(
                                    Number(entry.amount),
                                    entry.currency ??
                                      detail.purchaseOrder.currency
                                  )}
                                </p>
                              ) : null}
                              {entry.comment ? (
                                <p className="mt-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                                  {entry.comment}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                          Esta orden todavía no tiene movimientos de aprobación.
                        </p>
                      )}
                    </div>
                  </details>
                ) : null}

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
                              <div className="text-base">
                                {match.description}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {hasPendingPricingChanges ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Hay cambios de cantidad, precio o impuesto pendientes de
                    guardado automático. Sal del campo para terminar la
                    actualización antes de descargar o emitir la OC.
                  </div>
                ) : null}
                {(canSubmitForApproval || canEmitOrder) &&
                emissionBlockReason ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {emissionBlockReason}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-1">
                  {canManagePurchaseOrders &&
                  !isOrderReceived &&
                  !isApprovalWorkflowState &&
                  !isPostApprovalLocked ? (
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
                        deleteItemMutation.isPending ||
                        submitForApprovalMutation.isPending ||
                        reopenRejectedMutation.isPending ||
                        hasPendingPricingChanges
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
                      deleteItemMutation.isPending ||
                      updateMutation.isPending ||
                      cancelOrderMutation.isPending
                    }
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir
                  </Button>

                  {canSubmitForApproval ? (
                    <Button
                      size="lg"
                      className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                      onClick={() => {
                        if (emissionBlockReason) {
                          toast.error(emissionBlockReason);
                          return;
                        }
                        submitForApprovalMutation.mutate({
                          id: detail.purchaseOrder.id,
                        });
                      }}
                      disabled={
                        items.length === 0 ||
                        submitForApprovalMutation.isPending ||
                        updateMutation.isPending ||
                        updateItemLineMutation.isPending ||
                        updateContractTermsMutation.isPending ||
                        deleteItemMutation.isPending ||
                        cancelOrderMutation.isPending ||
                        hasOrderReceipts ||
                        hasPendingPricingChanges
                      }
                    >
                      {submitForApprovalMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      {submitForApprovalMutation.isPending
                        ? "Enviando..."
                        : "Enviar a aprobación"}
                    </Button>
                  ) : null}

                  {canCorrectRejectedOrder ? (
                    <Button
                      size="lg"
                      className="h-10 min-w-[220px] px-5 text-sm font-semibold sm:h-11 sm:text-base"
                      onClick={() =>
                        reopenRejectedMutation.mutate({
                          id: detail.purchaseOrder.id,
                        })
                      }
                      disabled={reopenRejectedMutation.isPending}
                    >
                      {reopenRejectedMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                      )}
                      {reopenRejectedMutation.isPending
                        ? "Reabriendo..."
                        : "Corregir"}
                    </Button>
                  ) : null}

                  {canEmitOrder ? (
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
                        deleteItemMutation.isPending ||
                        cancelOrderMutation.isPending ||
                        hasOrderReceipts ||
                        hasPendingPricingChanges
                      }
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {sendMutation.isPending ? "Emitiendo..." : "Emitir orden"}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
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
                    : confirmState.kind === "price-tax-mode"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-destructive/10 text-destructive"
                }`}
              >
                {confirmState.kind === "delete-item" ? (
                  <Trash2 className="h-5 w-5" />
                ) : confirmState.kind === "close-receipt-line" ? (
                  <ShieldX className="h-5 w-5" />
                ) : confirmState.kind === "price-tax-mode" ? (
                  <ArrowRightLeft className="h-5 w-5" />
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
                      : confirmState.kind === "price-tax-mode"
                        ? "Cambiar tipo de precio"
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
                        : confirmState.kind === "price-tax-mode"
                          ? `Los precios digitados no cambiarán. Se reinterpretarán como ${
                              confirmState.pricesIncludeTax
                                ? "totales con impuesto incluido"
                                : "bases sin impuesto"
                            } y se recalcularán subtotal, ISV y total de todas las líneas.`
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
                  : confirmState.kind === "price-tax-mode"
                    ? "La OC debe permanecer en borrador. El PDF guardado se invalidará para que la próxima impresión use los nuevos valores."
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
                className={`h-11 rounded-xl px-5 text-sm font-semibold ${
                  confirmState.kind === "price-tax-mode"
                    ? "bg-blue-700 text-white hover:bg-blue-800"
                    : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                }`}
              >
                {confirmActionPending
                  ? confirmState.kind === "delete-item"
                    ? "Eliminando..."
                    : confirmState.kind === "close-receipt-line"
                      ? "Cerrando..."
                      : confirmState.kind === "price-tax-mode"
                        ? "Recalculando..."
                        : "Cancelando..."
                  : confirmState.kind === "delete-item"
                    ? "Confirmar eliminación"
                    : confirmState.kind === "close-receipt-line"
                      ? "Confirmar cierre"
                      : confirmState.kind === "price-tax-mode"
                        ? "Recalcular OC"
                        : "Confirmar cancelación"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
