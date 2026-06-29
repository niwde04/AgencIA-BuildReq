import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ArrowLeft,
  Package,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  Trash2,
  Check,
  ChevronsUpDown,
  Search,
  AlertCircle,
  Pencil,
  XCircle,
  Send,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import {
  formatDateForDisplay,
  getDueDateStatus,
  getNeededByDate,
  PURCHASE_URGENCY_LABELS,
  STANDARD_PURCHASE_LEAD_DAYS,
} from "@shared/material-requests";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente_aprobar: "Pendiente de aprobar",
  en_espera: "En espera",
  en_proceso: "En proceso de atención",
  parcialmente_atendida: "Parcialmente atendida",
  flujo_completado: "Flujo completado",
  cerrada: "Cerrada",
  cerrada_incompleta: "Cerrada incompleta",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 text-slate-700 bg-slate-50",
  pendiente_aprobar: "border-orange-300 text-orange-700 bg-orange-50",
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  parcialmente_atendida: "border-cyan-300 text-cyan-700 bg-cyan-50",
  flujo_completado: "border-emerald-300 text-emerald-700 bg-emerald-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
  cerrada_incompleta: "border-yellow-300 text-yellow-700 bg-yellow-50",
  anulada: "border-rose-300 text-rose-700 bg-rose-50",
};

const RECIPIENT_LABELS: Record<string, string> = {
  bodega_central: "Bodega Central",
  bodega_proyecto: "Bodega del Proyecto",
  administrador_proyecto: "Administrador del Proyecto",
  oficina_central: "Oficina Central",
  solicitud_compra: "Solicitud de Compra",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  bienes: "Bienes",
  servicios: "Servicios",
};
const PURCHASE_TYPE_LABELS: Record<string, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
};
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  linea_credito: "Línea de Crédito",
  fondo_proyecto: "Fondo del proyecto",
  caja_chica: "Fondo del proyecto",
};

const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  bodega_proyecto: "Bodega del Proyecto",
  administrador_proyecto: "Administrador del Proyecto",
  oficina_central: "Oficina Central",
  compra_local: "Compra Local",
  compra_internacional: "Compra Internacional",
  traslado: "Traslado",
  recepcion: "Recepción",
  cerrada: "Cerrada",
  cerrada_incompleta: "Cerrada incompleta",
  rechazada: "Rechazada",
};

const FLOW_LABELS: Record<string, string> = {
  compra_directa: "Compra Directa del Proyecto",
  despacho_bodega: "Salida de Bodega (legado)",
  traslado_proyecto: "Solicitud de traslado",
  solicitud_compra: "Solicitud de Compra",
};

const SAP_DOC_LABELS: Record<string, string> = {
  compra_directa: "OC → Entrada de Mercancías",
  despacho_bodega: "Salida de Inventario",
  traslado_proyecto: "Solicitud de Transferencia",
  solicitud_compra: "Solicitud de Compra",
};

const FLOW_ICONS: Record<string, any> = {
  compra_directa: Package,
  despacho_bodega: Truck,
  traslado_proyecto: ArrowLeftRight,
  solicitud_compra: ShoppingCart,
};

const FLOW_COLORS: Record<string, string> = {
  compra_directa: "bg-blue-50 border-blue-200 text-blue-700",
  despacho_bodega: "bg-green-50 border-green-200 text-green-700",
  traslado_proyecto: "bg-amber-50 border-amber-200 text-amber-700",
  solicitud_compra: "bg-purple-50 border-purple-200 text-purple-700",
};

type QueueFlowType =
  | "compra_directa"
  | "despacho_bodega"
  | "traslado_proyecto"
  | "solicitud_compra";

const QUEUE_FLOW_ORDER: QueueFlowType[] = [
  "despacho_bodega",
  "compra_directa",
  "traslado_proyecto",
  "solicitud_compra",
];

const QUEUE_FLOW_LABELS: Record<QueueFlowType, string> = {
  despacho_bodega: "Salida de bodega",
  compra_directa: "Compra directa",
  traslado_proyecto: "Solicitud de traslado",
  solicitud_compra: "Solicitud de compra",
};

const SERVICE_QUEUE_FLOW_TYPES = new Set<QueueFlowType>([
  "compra_directa",
  "solicitud_compra",
]);

const QUEUE_FLOW_DESCRIPTIONS: Record<QueueFlowType, string> = {
  despacho_bodega: "Despacho desde inventario disponible del proyecto.",
  compra_directa: "Genera compra directa para los ítems seleccionados.",
  traslado_proyecto: "Genera una solicitud de traslado desde otro proyecto.",
  solicitud_compra: "Genera solicitud de compra para Oficina Central.",
};

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  no_requiere: "No requiere",
};

const ITEM_APPROVAL_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 text-amber-700 bg-amber-50",
  aprobada: "border-emerald-300 text-emerald-700 bg-emerald-50",
  rechazada: "border-rose-300 text-rose-700 bg-rose-50",
  mixta: "border-sky-300 text-sky-700 bg-sky-50",
};

const URGENCY_COLORS: Record<string, string> = {
  urgente: "border-red-300 text-red-700 bg-red-50",
  no_urgente: "border-emerald-300 text-emerald-700 bg-emerald-50",
};

const DUE_STATUS_COLORS: Record<string, string> = {
  late: "text-red-600",
  today: "text-red-600",
  soon: "text-amber-600",
  ok: "text-emerald-700",
};

type ItemDisplayRow = {
  key: string;
  baseItem: any;
  editableItem: any | null;
  allItems: any[];
  assignedItems: any[];
  pendingItems: any[];
  approvedItems: any[];
  pendingApprovalItems: any[];
  rejectedItems: any[];
  originalQuantity: number;
  processedQuantity: number;
  remainingQuantity: number;
  pendingApprovalQuantity: number;
  rejectedQuantity: number;
  assignedFlowTypes: string[];
  flowEvents: Array<{
    key: string;
    flowType: string;
    status: string;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
  }>;
  hasSapCode: boolean;
};

const parseQuantityValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantityValue = (value: unknown) => parseQuantityValue(value).toFixed(2);

const formatProjectStockWarehouseLabel = (warehouse: any) => {
  const localCode = warehouse.localCode || warehouse.warehouseCode;
  const name = warehouse.warehouseName || warehouse.displayName;
  if (localCode && name) return `${localCode} - ${name}`;
  return name || warehouse.displayName || "Almacén";
};

function ProjectStockBreakdown({
  item,
  hasSapTranslation,
  canViewQuantities,
}: {
  item: any;
  hasSapTranslation: boolean;
  canViewQuantities: boolean;
}) {
  if (!canViewQuantities) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (!hasSapTranslation) return <span>—</span>;

  const warehouses = Array.isArray(item.warehouseStockWarehouses)
    ? item.warehouseStockWarehouses
    : Array.isArray(item.projectStockWarehouses)
      ? item.projectStockWarehouses
      : [];
  const total = item.warehouseStock ?? item.projectStock ?? "0.00";

  if (warehouses.length === 0) {
    return <span className="font-mono">{formatQuantityValue(total)}</span>;
  }

  return (
    <div className="min-w-[240px] space-y-1 text-left">
      {warehouses.map((warehouse: any, index: number) => {
        const quantity = parseQuantityValue(warehouse.quantity);
        return (
          <div
            key={`${warehouse.warehouseId ?? "legacy"}-${index}`}
            className="flex items-start justify-between gap-3"
          >
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {formatProjectStockWarehouseLabel(warehouse)}
            </span>
            <span
              className={`shrink-0 font-mono text-[11px] ${
                quantity > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {formatQuantityValue(quantity)}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-1">
        <span className="text-[11px] font-semibold text-foreground">
          Total almacén
        </span>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-foreground">
          {formatQuantityValue(total)}
        </span>
      </div>
    </div>
  );
}

const formatEventDateTime = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const getLatestEventDate = (values: Array<string | Date | null | undefined>) => {
  const validDates = values
    .map((value) => (value ? new Date(value) : null))
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return validDates[0] ?? null;
};

const getApprovalEventLabel = (row: ItemDisplayRow) => {
  const eventDate = getLatestEventDate([
    ...row.approvedItems.map((entry) => entry.approvedAt),
    ...row.rejectedItems.map((entry) => entry.approvedAt),
  ]);
  const formatted = formatEventDateTime(eventDate);
  if (!formatted) return null;

  if (row.approvedItems.length > 0 && row.rejectedItems.length > 0) {
    return `Última revisión: ${formatted}`;
  }
  if (row.rejectedItems.length > 0) {
    return `Rechazado: ${formatted}`;
  }
  return `Aprobado: ${formatted}`;
};

const getFlowEventTimeline = (event: ItemDisplayRow["flowEvents"][number]) => {
  const createdAt = formatEventDateTime(event.createdAt);
  const updatedAt = formatEventDateTime(event.updatedAt);
  const lines: string[] = [];

  if (createdAt) {
    lines.push(`Creado: ${createdAt}`);
  }

  if (updatedAt && updatedAt !== createdAt) {
    const label = event.status === "completado" ? "Completado" : "Actualizado";
    lines.push(`${label}: ${updatedAt}`);
  }

  return lines;
};

const normalizeItemFamilyValue = (value: unknown) => String(value ?? "").trim().toLowerCase();

const buildItemFamilyKey = (item: any) =>
  [
    normalizeItemFamilyValue(item.sapItemCode),
    normalizeItemFamilyValue(item.sapItemDescription),
    normalizeItemFamilyValue(item.itemName),
    normalizeItemFamilyValue(item.unit),
    normalizeItemFamilyValue(item.notes),
  ].join("::");

const isItemApprovedForProcessing = (item: any) =>
  item.approvalStatus === "aprobada" || item.approvalStatus === "no_requiere";

const getRowApprovalBadge = (row: ItemDisplayRow) => {
  if (row.pendingApprovalQuantity > 0) {
    return {
      label: "Pendiente autorización",
      className: ITEM_APPROVAL_COLORS.pendiente,
    };
  }

  if (row.approvedItems.length > 0 && row.rejectedItems.length > 0) {
    return {
      label: "Autorización mixta",
      className: ITEM_APPROVAL_COLORS.mixta,
    };
  }

  if (row.rejectedItems.length > 0) {
    return {
      label: "Rechazado",
      className: ITEM_APPROVAL_COLORS.rechazada,
    };
  }

  return {
    label: "Aprobado",
    className: ITEM_APPROVAL_COLORS.aprobada,
  };
};

/** SAP Catalog Search Textbox - uses Popover portal to escape overflow clipping */
function SapSearchBox({
  itemId,
  currentCode,
  currentDescription,
  onSelect,
  onClear,
  disabled,
}: {
  itemId: number;
  currentCode: string | null;
  currentDescription: string | null;
  onSelect: (code: string, desc: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const querySearch = search.trim();

  const { data: results, isFetching } = trpc.requestItems.searchSapCatalog.useQuery(
    { search: querySearch },
    { enabled: querySearch.length >= 2 }
  );

  useEffect(() => {
    if (currentCode) {
      setIsEditing(false);
      setSearch("");
      setOpen(false);
    }
  }, [currentCode]);

  if (currentCode && !isEditing) {
    return (
      <div className="space-y-1">
        <div className="flex min-w-0 items-start gap-2">
          <span className="shrink-0 font-mono text-xs font-bold text-primary">
            {currentCode}
          </span>
          {currentDescription && (
            <span className="min-w-0 flex-1 whitespace-normal break-words text-xs leading-5 text-muted-foreground">
              {currentDescription}
            </span>
          )}
        </div>

        {!disabled ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                setSearch(currentCode);
                setIsEditing(true);
                setOpen(currentCode.trim().length >= 2);
              }}
            >
              <Pencil className="mr-1 h-3 w-3" />
              Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-rose-600 hover:text-rose-700"
              onClick={onClear}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Quitar
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (disabled) {
    return <span className="text-xs text-muted-foreground italic">Sin traducir</span>;
  }

  const hasSearch = querySearch.length >= 2;
  const hasResults = results && results.length > 0;
  const noResults = results && results.length === 0 && hasSearch && !isFetching;

  return (
    <div className="space-y-1">
      <Popover open={open && hasSearch} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                const nextSearch = e.target.value;
                setSearch(nextSearch);
                if (nextSearch.trim().length >= 2) {
                  setOpen(true);
                } else {
                  setOpen(false);
                }
              }}
              onFocus={() => {
                if (querySearch.length >= 2) setOpen(true);
              }}
              placeholder="Buscar código SAP..."
              className="h-7 text-xs pl-7 pr-2"
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-[min(680px,calc(100vw-2rem))] max-h-[300px] overflow-y-auto p-0"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {isFetching ? (
            <div className="p-3">
              <p className="text-xs text-muted-foreground text-center">Buscando...</p>
            </div>
          ) : null}
          {!isFetching && hasResults && results.map((item: any) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(item.itemCode, item.description);
                setSearch("");
                setIsEditing(false);
                setOpen(false);
              }}
              className="flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left transition-colors last:border-0 hover:bg-muted/50"
            >
              <span className="font-mono text-xs font-bold text-primary shrink-0">
                {item.itemCode}
              </span>
              <span className="min-w-0 text-xs text-foreground">
                <span className="block whitespace-normal break-words">
                  {item.description}
                </span>
                {item.brand || item.partNumber ? (
                  <span className="mt-1 block whitespace-normal break-words text-muted-foreground">
                    {[item.brand && `Marca: ${item.brand}`, item.partNumber && `No. parte: ${item.partNumber}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          {noResults && (
            <div className="p-3">
              <p className="text-xs text-muted-foreground text-center">Sin resultados</p>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {currentCode && isEditing ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => {
            setIsEditing(false);
            setSearch("");
            setOpen(false);
          }}
        >
          Cancelar edición
        </Button>
      ) : null}
    </div>
  );
}

export default function SolicitudDetalle() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const userRole = (user as any)?.buildreqRole || "";

  const requestId = parseInt(params.id || "0");

  const { data, isLoading, error } = trpc.materialRequests.getById.useQuery(
    { id: requestId },
    { enabled: requestId > 0 }
  );

  const { data: flowData } = trpc.supplyFlows.getByRequestId.useQuery(
    { requestId },
    { enabled: requestId > 0 }
  );

  const { data: availableFlows } = trpc.supplyFlows.availableFlows.useQuery(
    undefined,
    { refetchOnMount: "always", refetchOnWindowFocus: true }
  );
  const { data: projectWarehouses } = trpc.warehouses.list.useQuery(
    {
      projectId: data?.request.projectId ?? 0,
      isActive: true,
    },
    {
      enabled: Boolean(data?.request.projectId),
    }
  );

  useEffect(() => {
    if (!user) return;
    void utils.supplyFlows.availableFlows.invalidate();
  }, [user?.id, userRole]);

  const items = data?.items ?? [];

  const translateMutation = trpc.requestItems.translateToSap.useMutation({
    onSuccess: () => {
      toast.success("Traducción SAP guardada");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const clearSapTranslationMutation = trpc.requestItems.clearSapTranslation.useMutation({
    onSuccess: (result, variables) => {
      toast.success(
        result.clearedFlow
          ? "Traducción SAP eliminada y flujo retirado"
          : "Traducción SAP eliminada"
      );
      setSelectedWarehouseByItemId((current) => {
        if (!(variables.id in current)) return current;
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      setPendingFlowByItemId((current) => {
        if (!(variables.id in current)) return current;
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const assignFlowMutation = trpc.requestItems.assignFlow.useMutation({
    onSuccess: (_, variables) => {
      toast.success("Flujo actualizado");
      setWarehousePromptItemId((current) =>
        current === variables.id ? null : current
      );
      if (variables.flowType !== "despacho_bodega") {
        setSelectedWarehouseByItemId((current) => {
          if (!(variables.id in current)) return current;
          const next = { ...current };
          delete next[variables.id];
          return next;
        });
      }
      setPendingFlowByItemId((current) => {
        if (!(variables.id in current)) return current;
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectPendingQuantityMutation =
    trpc.requestItems.rejectPendingQuantity.useMutation({
      onSuccess: (result) => {
        setPendingBalanceRejection(null);
        setBalanceRejectReason("");
        toast.success(
          `Saldo rechazado: ${formatQuantityValue(result.rejectedQuantity)}`
        );
        invalidateAll();
      },
      onError: (e) => toast.error(e.message),
    });

  const rejectApprovedItemMutation = trpc.requestItems.rejectApproved.useMutation({
    onSuccess: (result) => {
      setPendingApprovedItemRejection(null);
      setApprovedItemRejectReason("");
      toast.success(
        `Ítem rechazado: ${formatQuantityValue(result.rejectedQuantity)}`
      );
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const approveMutation = trpc.materialRequests.approve.useMutation({
    onSuccess: () => {
      toast.success("Requisición aprobada");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const reviewItemsMutation = trpc.materialRequests.reviewItems.useMutation({
    onSuccess: (_, variables) => {
      setPendingItemRejection(null);
      setItemRejectReason("");
      setPendingBulkReviewDecision(null);
      setBulkRejectReason("");
      toast.success(
        variables.decision === "aprobada"
          ? "Ítem(s) autorizados"
          : "Ítem(s) rechazados"
      );
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = trpc.materialRequests.reject.useMutation({
    onSuccess: () => {
      toast.success("Requisición rechazada");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const [assigningFlowItemId, setAssigningFlowItemId] = useState<number | null>(null);
  const [selectedWarehouseByItemId, setSelectedWarehouseByItemId] = useState<
    Record<number, string>
  >({});
  const [pendingFlowByItemId, setPendingFlowByItemId] = useState<
    Record<number, QueueFlowType>
  >({});
  const [warehousePopoverItemId, setWarehousePopoverItemId] = useState<number | null>(
    null
  );
  const [warehousePromptItemId, setWarehousePromptItemId] = useState<number | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState("");
  const [pendingItemRejection, setPendingItemRejection] = useState<{
    itemIds: number[];
    itemLabel: string;
  } | null>(null);
  const [itemRejectReason, setItemRejectReason] = useState("");
  const [pendingBalanceRejection, setPendingBalanceRejection] = useState<{
    itemId: number;
    itemLabel: string;
    pendingQuantity: number;
    unit?: string | null;
  } | null>(null);
  const [balanceRejectReason, setBalanceRejectReason] = useState("");
  const [pendingApprovedItemRejection, setPendingApprovedItemRejection] = useState<{
    itemId: number;
    itemLabel: string;
    quantity: number;
    unit?: string | null;
  } | null>(null);
  const [approvedItemRejectReason, setApprovedItemRejectReason] = useState("");
  const [pendingBulkReviewDecision, setPendingBulkReviewDecision] = useState<
    "aprobada" | "rechazada" | null
  >(null);
  const [bulkRejectReason, setBulkRejectReason] = useState("");

  const isAdmin = user?.role === "admin";
  const isSuperintendent = userRole === "superintendente";
  const canViewWarehouseQuantities = userRole !== "ingeniero_residente";
  const canManageProcessing =
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    isAdmin;
  const canManageSapTranslation =
    canManageProcessing ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";
  const canAssignQueueFlows =
    canManageProcessing ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";
  const canApproveProjectRequests =
    userRole === "administrador_proyecto" ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    userRole === "bodeguero_proyecto" ||
    isAdmin;
  const canRejectApprovedItems =
    userRole === "administrador_proyecto" ||
    userRole === "administracion_central" ||
    isAdmin;

  const invalidateAll = () =>
    Promise.all([
      utils.materialRequests.getById.invalidate({ id: requestId }),
      utils.materialRequests.list.invalidate(),
      utils.supplyFlows.getByRequestId.invalidate({ requestId }),
      utils.supplyFlows.pendingQueue.invalidate(),
    ]);

  const activePurchaseRequestFlowsByItem = useMemo(() => {
    const entries = new Map<number, any>();

    for (const flow of flowData || []) {
      if (
        flow.requestItemId &&
        flow.flowType === "solicitud_compra" &&
        flow.status !== "cancelado" &&
        !entries.has(flow.requestItemId)
      ) {
        entries.set(flow.requestItemId, flow);
      }
    }

    return entries;
  }, [flowData]);

  const activeFlowTypesByItem = useMemo(() => {
    const entries = new Map<number, Set<string>>();

    for (const flow of flowData || []) {
      if (!flow.requestItemId || flow.status === "cancelado") continue;
      const currentSet = entries.get(flow.requestItemId) ?? new Set<string>();
      currentSet.add(flow.flowType);
      entries.set(flow.requestItemId, currentSet);
    }

    return entries;
  }, [flowData]);

  const activeFlowsByItem = useMemo(() => {
    const entries = new Map<number, any[]>();

    for (const flow of flowData || []) {
      if (!flow.requestItemId || flow.status === "cancelado") continue;
      const current = entries.get(flow.requestItemId) ?? [];
      current.push(flow);
      entries.set(flow.requestItemId, current);
    }

    return entries;
  }, [flowData]);

  const itemRows = useMemo(() => {
    const groupedItems = new Map<string, any[]>();
    const orderedKeys: string[] = [];

    for (const item of items) {
      const groupKey = buildItemFamilyKey(item);
      if (!groupedItems.has(groupKey)) {
        groupedItems.set(groupKey, []);
        orderedKeys.push(groupKey);
      }
      groupedItems.get(groupKey)?.push(item);
    }

    const getEntryFlowTypes = (entry: any) =>
      Array.from(
        new Set([
          ...(entry.assignedFlow ? [entry.assignedFlow] : []),
          ...Array.from(activeFlowTypesByItem.get(entry.id) ?? []),
        ])
      );

    const getEntryFlowEvents = (entry: any) => {
      const activeFlows = activeFlowsByItem.get(entry.id) ?? [];
      const events = activeFlows.map((flow) => ({
        key: `flow-${flow.id}`,
        flowType: flow.flowType,
        status: flow.status,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
      }));

      if (
        entry.assignedFlow &&
        !activeFlows.some((flow) => flow.flowType === entry.assignedFlow)
      ) {
        events.push({
          key: `assigned-${entry.id}-${entry.assignedFlow}`,
          flowType: entry.assignedFlow,
          status: "pendiente",
          createdAt: entry.updatedAt ?? entry.createdAt,
          updatedAt: null,
        });
      }

      return events.sort((a, b) => {
        const left = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const right = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return left - right;
      });
    };

    const getEntryProcessedQuantity = (entry: any) => {
      const quantity = parseQuantityValue(entry.quantity);
      const flowTypes = getEntryFlowTypes(entry);
      const hasNonDispatchFlow = flowTypes.some(
        (flowType) => flowType !== "despacho_bodega"
      );

      if (hasNonDispatchFlow) {
        return quantity;
      }

      const dispatched = parseQuantityValue(entry.dispatchedQuantity);
      return Math.min(dispatched, quantity);
    };

    const getEntryRemainingQuantity = (entry: any) => {
      if (!isItemApprovedForProcessing(entry)) {
        return 0;
      }

      const quantity = parseQuantityValue(entry.quantity);
      const flowTypes = getEntryFlowTypes(entry);
      const hasNonDispatchFlow = flowTypes.some(
        (flowType) => flowType !== "despacho_bodega"
      );

      if (hasNonDispatchFlow) {
        return 0;
      }

      const dispatched = parseQuantityValue(entry.dispatchedQuantity);
      return Math.max(quantity - Math.min(dispatched, quantity), 0);
    };

    const buildRow = (groupItems: any[], key: string): ItemDisplayRow => {
      const approvedItems = groupItems.filter((entry) => isItemApprovedForProcessing(entry));
      const pendingApprovalItems = groupItems.filter(
        (entry) => entry.approvalStatus === "pendiente"
      );
      const rejectedItems = groupItems.filter(
        (entry) => entry.approvalStatus === "rechazada"
      );
      const assignedItems = approvedItems.filter(
        (entry) => getEntryProcessedQuantity(entry) > 0
      );
      const pendingItems = approvedItems.filter(
        (entry) => getEntryRemainingQuantity(entry) > 0
      );
      const editableItem = pendingItems[0] ?? null;
      const baseItem =
        editableItem ?? pendingApprovalItems[0] ?? rejectedItems[0] ?? groupItems[0];

      return {
        key,
        baseItem,
        editableItem,
        allItems: groupItems,
        assignedItems,
        pendingItems,
        approvedItems,
        pendingApprovalItems,
        rejectedItems,
        originalQuantity: groupItems.reduce(
          (total, entry) => total + parseQuantityValue(entry.quantity),
          0
        ),
        processedQuantity: approvedItems.reduce(
          (total, entry) => total + getEntryProcessedQuantity(entry),
          0
        ),
        remainingQuantity: approvedItems.reduce(
          (total, entry) => total + getEntryRemainingQuantity(entry),
          0
        ),
        pendingApprovalQuantity: pendingApprovalItems.reduce(
          (total, entry) => total + parseQuantityValue(entry.quantity),
          0
        ),
        rejectedQuantity: rejectedItems.reduce(
          (total, entry) => total + parseQuantityValue(entry.quantity),
          0
        ),
        assignedFlowTypes: Array.from(
          new Set(
            approvedItems.flatMap((entry) => getEntryFlowTypes(entry))
          )
        ),
        flowEvents: approvedItems.flatMap((entry) => getEntryFlowEvents(entry)),
        hasSapCode:
          approvedItems.length === 0 ||
          approvedItems.every((entry) => Boolean(entry.sapItemCode)),
      };
    };

    return orderedKeys.flatMap((groupKey) => {
      const groupItems = groupedItems.get(groupKey) ?? [];
      const pendingItems = groupItems.filter(
        (entry) => getEntryRemainingQuantity(entry) > 0
      );
      const pendingApprovalItems = groupItems.filter(
        (entry) => entry.approvalStatus === "pendiente"
      );
      const hasProcessedItems = groupItems.some(
        (entry) => getEntryProcessedQuantity(entry) > 0
      );
      const shouldCollapse =
        groupItems.length > 1 &&
        hasProcessedItems &&
        pendingItems.length === 1 &&
        pendingApprovalItems.length === 0;

      if (shouldCollapse) {
        return [buildRow(groupItems, groupKey)];
      }

      return groupItems.map((entry) => buildRow([entry], `${groupKey}:${entry.id}`));
    });
  }, [activeFlowTypesByItem, activeFlowsByItem, items]);

  const handleSapSelect = (itemId: number, code: string, desc: string) => {
    translateMutation.mutate({
      id: itemId,
      sapItemCode: code,
      sapItemDescription: desc,
    });
  };

  const handleClearSapTranslation = (itemId: number) => {
    clearSapTranslationMutation.mutate({ id: itemId });
  };

  const getVisibleQueueOptionsForItem = () => {
    const isServiceRequest = data?.request?.requestType === "servicios";
    const allowedFlows = new Set<QueueFlowType>(
      ((availableFlows || []) as QueueFlowType[]).filter((flowType) =>
        QUEUE_FLOW_ORDER.includes(flowType)
      )
    );

    return QUEUE_FLOW_ORDER.filter((flowType) => {
      if (!allowedFlows.has(flowType)) return false;
      return !isServiceRequest || SERVICE_QUEUE_FLOW_TYPES.has(flowType);
    });
  };

  const getSelectedWarehouseValue = (item: any) =>
    selectedWarehouseByItemId[item.id] ??
    (item.warehouseId ? String(item.warehouseId) : "");

  const getSelectedWarehouseId = (item: any) => {
    const value = getSelectedWarehouseValue(item);
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const getWarehouseOptionLabel = (warehouse: any) =>
    warehouse.displayName ||
    [warehouse.code || warehouse.localCode, warehouse.name]
      .filter(Boolean)
      .join(" - ") ||
    `Almacén #${warehouse.id}`;

  const getItemWarehouseStock = (item: any, warehouseId: number) => {
    const warehouses = Array.isArray(item.warehouseStockWarehouses)
      ? item.warehouseStockWarehouses
      : Array.isArray(item.projectStockWarehouses)
        ? item.projectStockWarehouses
        : [];
    const stockEntry = warehouses.find(
      (warehouse: any) => Number(warehouse.warehouseId) === warehouseId
    );
    return parseQuantityValue(stockEntry?.quantity);
  };

  const getWarehouseDispatchPendingQuantity = (item: any) => {
    const requested = Math.max(parseQuantityValue(item.quantity), 0);
    const dispatched = Math.min(
      Math.max(parseQuantityValue(item.dispatchedQuantity), 0),
      requested
    );
    return Math.max(requested - dispatched, 0);
  };

  const getQueueDisabledReason = (
    item: any,
    flowType: QueueFlowType,
    warehouseId?: number | null
  ) => {
    if (
      data?.request?.requestType === "servicios" &&
      !SERVICE_QUEUE_FLOW_TYPES.has(flowType)
    ) {
      return "Salida de bodega y solicitud de traslado no aplican para servicios";
    }
    if (!item.sapItemCode) {
      return "Debe traducir el ítem a SAP antes de asignar un flujo";
    }
    if (flowType === "despacho_bodega") {
      if (!warehouseId) {
        return "Seleccione una bodega para la salida de inventario";
      }
      const selectedWarehouse = (projectWarehouses ?? []).find(
        (warehouse: any) => Number(warehouse.id) === warehouseId
      );
      if (!selectedWarehouse) {
        return "La bodega seleccionada no está disponible para este proyecto";
      }
      const pendingQuantity = getWarehouseDispatchPendingQuantity(item);
      const availableQuantity = getItemWarehouseStock(item, warehouseId);
      if (
        pendingQuantity > 0 &&
        pendingQuantity - availableQuantity > 0.000001
      ) {
        return `Stock insuficiente en bodega (${formatQuantityValue(
          availableQuantity
        )} disponible)`;
      }
    }
    if (flowType === "solicitud_compra" && activePurchaseRequestFlowsByItem.has(item.id)) {
      return "Este ítem ya tiene una solicitud de compra activa";
    }
    if (
      flowType !== "despacho_bodega" &&
      activeFlowTypesByItem.get(item.id)?.has(flowType)
    ) {
      return `Este ítem ya tiene un flujo activo de ${QUEUE_FLOW_LABELS[flowType].toLowerCase()}`;
    }
    return null;
  };

  const handleQueuedFlowSelection = async (
    item: any,
    nextFlow: string,
    warehouseId?: number | null
  ) => {
    const requestedFlow = nextFlow === "__clear__" ? null : (nextFlow as QueueFlowType);
    const selectedWarehouseId =
      requestedFlow === "despacho_bodega"
        ? warehouseId ?? getSelectedWarehouseId(item)
        : null;

    if (
      requestedFlow &&
      (requestedFlow !== item.assignedFlow ||
        requestedFlow === "despacho_bodega")
    ) {
      const disabledReason = getQueueDisabledReason(
        item,
        requestedFlow,
        selectedWarehouseId
      );
      if (disabledReason) {
        if (
          requestedFlow === "despacho_bodega" &&
          !selectedWarehouseId &&
          disabledReason === "Seleccione una bodega para la salida de inventario"
        ) {
          setWarehousePromptItemId(item.id);
          toast.error(disabledReason);
          return;
        }
        toast.error(disabledReason);
        return;
      }
    }

    const warehouseChanged =
      requestedFlow === "despacho_bodega" &&
      selectedWarehouseId &&
      selectedWarehouseId !== Number(item.warehouseId ?? 0);

    if (requestedFlow === item.assignedFlow && !warehouseChanged) {
      return;
    }

    if (requestedFlow !== "despacho_bodega") {
      setWarehousePromptItemId((current) => (current === item.id ? null : current));
    }

    setAssigningFlowItemId(item.id);
    assignFlowMutation.mutate(
      {
        id: item.id,
        flowType: requestedFlow,
        warehouseId: selectedWarehouseId,
      },
      {
        onSettled: () => {
          setAssigningFlowItemId((current) => (current === item.id ? null : current));
        },
      }
    );
  };

  const renderDispatchWarehouseCombobox = (
    item: any,
    pendingQuantity: number,
    disabled: boolean,
    disabledReason?: string | null
  ) => {
    const warehouses = projectWarehouses ?? [];
    const selectedValue = getSelectedWarehouseValue(item);
    const selectedWarehouseId = Number(selectedValue || 0);
    const selectedWarehouse = warehouses.find(
      (warehouse: any) => Number(warehouse.id) === selectedWarehouseId
    );
    const isOpen = warehousePopoverItemId === item.id;

    return (
      <div className="space-y-1">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bodega
        </Label>
        <Popover
          open={isOpen}
          onOpenChange={(open) => setWarehousePopoverItemId(open ? item.id : null)}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={isOpen}
              className="h-8 w-full justify-between px-2 text-xs font-normal"
              disabled={disabled || warehouses.length === 0}
            >
              <span className="min-w-0 truncate">
                {selectedWarehouse
                  ? getWarehouseOptionLabel(selectedWarehouse)
                  : selectedValue
                    ? `Almacén #${selectedValue}`
                    : "Seleccione bodega"}
              </span>
              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Buscar bodega por código o nombre..." />
              <CommandList>
                <CommandEmpty>No se encontraron bodegas.</CommandEmpty>
                <CommandGroup>
                  {warehouses.map((warehouse: any) => {
                    const warehouseId = Number(warehouse.id);
                    const stockQuantity = getItemWarehouseStock(item, warehouseId);
                    const hasEnoughStock =
                      pendingQuantity <= 0 ||
                      stockQuantity - pendingQuantity >= -0.000001;
                    const isSelected = selectedWarehouseId === warehouseId;
                    const label = getWarehouseOptionLabel(warehouse);

                    return (
                      <CommandItem
                        key={warehouse.id}
                        value={`${warehouse.code ?? ""} ${warehouse.localCode ?? ""} ${
                          warehouse.name ?? ""
                        } ${warehouse.displayName ?? ""}`}
                        keywords={[
                          warehouse.code,
                          warehouse.localCode,
                          warehouse.name,
                          warehouse.displayName,
                        ].filter(Boolean)}
                        disabled={!hasEnoughStock}
                        onSelect={() => {
                          if (!hasEnoughStock) return;
                          setSelectedWarehouseByItemId((current) => ({
                            ...current,
                            [item.id]: String(warehouse.id),
                          }));
                          setWarehousePopoverItemId(null);
                          setWarehousePromptItemId((current) =>
                            current === item.id ? null : current
                          );
                        }}
                      >
                        <Check
                          className={`mt-0.5 h-4 w-4 ${
                            isSelected ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{label}</p>
                          <p
                            className={`text-[10px] ${
                              hasEnoughStock
                                ? "text-muted-foreground"
                                : "text-destructive"
                            }`}
                          >
                            Existencia: {formatQuantityValue(stockQuantity)}
                            {!hasEnoughStock
                              ? ` | Pendiente: ${formatQuantityValue(pendingQuantity)}`
                              : ""}
                          </p>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {disabledReason ? (
          <p className="text-[10px] leading-4 text-muted-foreground">
            {disabledReason}
          </p>
        ) : null}
      </div>
    );
  };

  const anyQueueProcessing =
    assignFlowMutation.isPending ||
    rejectPendingQuantityMutation.isPending ||
    rejectApprovedItemMutation.isPending ||
    translateMutation.isPending ||
    clearSapTranslationMutation.isPending ||
    assigningFlowItemId !== null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-6 w-40 animate-pulse bg-muted rounded" />
        </div>
        <div className="h-64 animate-pulse bg-muted rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1>No se pudo cargar la requisición</h1>
            <p className="text-sm text-muted-foreground">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1>Requisición no encontrada</h1>
        </div>
      </div>
    );
  }

  const { request, project, requestedBy } = data;
  const currentUserLabel =
    (typeof (user as any)?.name === "string" && (user as any).name.trim()) ||
    (typeof (user as any)?.email === "string" && (user as any).email.trim()) ||
    "";
  const requestedByLabel =
    (typeof requestedBy?.name === "string" && requestedBy.name.trim()) ||
    (typeof requestedBy?.email === "string" && requestedBy.email.trim()) ||
    (request.requestedById === user?.id ? currentUserLabel : "") ||
    "—";
  const neededByDate = getNeededByDate(
    request.purchaseUrgency,
    request.neededBy,
    request.createdAt
  );
  const dueStatus = getDueDateStatus(neededByDate);
  const rawAssignedProjectIds = (user as any)?.assignedProjectIds;
  const assignedProjectIds =
    Array.isArray(rawAssignedProjectIds) && rawAssignedProjectIds.length > 0
      ? rawAssignedProjectIds.map(Number)
      : (user as any)?.assignedProjectId
        ? [(user as any).assignedProjectId]
        : [];
  const canUseAllProjects =
    userRole === "administrador_proyecto" && assignedProjectIds.length === 0;
  const canEditCurrentRequest =
    !isSuperintendent &&
    (isAdmin ||
      request.requestedById === user?.id ||
      (userRole === "administrador_proyecto" &&
        (canUseAllProjects || assignedProjectIds.includes(request.projectId)))) &&
    (request.status === "borrador" ||
      ((request.status === "en_espera" ||
        request.status === "pendiente_aprobar") &&
        items.every((item: any) => {
          const hasMovement =
            Number(item.deliveredQuantity ?? 0) > 0 ||
            Number(item.dispatchedQuantity ?? 0) > 0;
          return !item.assignedFlow && !item.sapItemCode && !hasMovement;
        })));
  const actionableRows = itemRows.filter((row) => row.approvedItems.length > 0);
  const completedItemRows = actionableRows.filter(
    (row) => row.remainingQuantity <= 0 && row.assignedFlowTypes.length > 0
  ).length;
  const hasPendingApprovalRows = itemRows.some(
    (row) => row.pendingApprovalQuantity > 0
  );
  const pendingApprovalItemIds = Array.from(
    new Set(
      items
        .filter((item: any) => item.approvalStatus === "pendiente")
        .map((item: any) => item.id)
    )
  );
  const pendingApprovalItemsCount = pendingApprovalItemIds.length;
  const canReviewGoodsItems =
    request.requestType === "bienes" &&
    request.status !== "borrador" &&
    request.status !== "flujo_completado" &&
    request.status !== "cerrada" &&
    request.status !== "cerrada_incompleta" &&
    request.status !== "anulada" &&
    request.approvalStatus === "pendiente" &&
    canApproveProjectRequests;

  const allItemsAssigned =
    actionableRows.length > 0 &&
    !hasPendingApprovalRows &&
    actionableRows.every(
      (row) =>
        row.remainingQuantity <= 0 &&
        row.assignedFlowTypes.length > 0 &&
        row.hasSapCode
    );
  const canShowQueueAssignmentForRequest =
    request.requestType === "bienes" ||
    request.approvalStatus === "aprobada" ||
    request.approvalStatus === "no_requiere";
  const canManageMaterialRequestAttachments = ![
    "anulada",
    "cerrada",
    "cerrada_incompleta",
    "flujo_completado",
    "rechazada",
  ].includes(String(request.status ?? ""));

  return (
    <div className="w-full max-w-none space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/solicitudes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{request.requestNumber}</h1>
            <p className="text-sm text-muted-foreground">
              {project?.name} ({project?.code})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={`text-sm px-3 py-1 ${STATUS_COLORS[request.status] || ""}`}>
            {STATUS_LABELS[request.status]}
          </Badge>
        </div>
      </div>

      {request.status === "borrador" ? (
        <Card className="border-slate-200 bg-slate-50/70">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium">Este documento todavía está en borrador</p>
              <p className="text-xs text-muted-foreground">
                Puedes seguir agregando ítems o ajustando la información antes de crear la requisición formal.
              </p>
            </div>
            {canEditCurrentRequest ? (
              <Button onClick={() => setLocation(`/solicitudes/${requestId}/editar`)}>
                <Pencil className="mr-2 h-4 w-4" />
                Continuar borrador
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {request.requestType === "servicios" &&
        request.status !== "borrador" &&
        request.approvalStatus === "pendiente" &&
        canApproveProjectRequests && (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">Aprobación de servicio pendiente</p>
                  <p className="text-xs text-muted-foreground">
                    El Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto deben aprobar o rechazar antes de continuar a Oficina Central.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => approveMutation.mutate({ id: requestId })}
                    disabled={approveMutation.isPending}
                  >
                    Aprobar
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (rejectReason.trim().length < 5) {
                        toast.error("Escribe un motivo de rechazo de al menos 5 caracteres");
                        return;
                      }
                      rejectMutation.mutate({ id: requestId, reason: rejectReason });
                    }}
                    disabled={rejectMutation.isPending}
                  >
                    Rechazar
                  </Button>
                </div>
              </div>
              <Textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Motivo de rechazo"
                rows={2}
              />
            </CardContent>
          </Card>
        )}

      {request.requestType === "bienes" &&
        request.status !== "borrador" &&
        request.approvalStatus === "pendiente" && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">Autorización pendiente por ítem</p>
                <p className="text-xs text-muted-foreground">
                  {canReviewGoodsItems
                    ? "Autoriza o rechaza cada producto desde la tabla inferior. Cuando termines la revisión, la requisición pasará a Bodega para traducir y asignar flujos."
                    : "Esta requisición está esperando que el Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto revisen cada ítem antes de habilitar SAP y los flujos."}
                </p>
              </div>
              <Badge
                variant="outline"
                className="w-fit border-amber-300 bg-amber-50 text-amber-700"
              >
                {itemRows.filter((row) => row.pendingApprovalQuantity > 0).length} ítem(s) por revisar
              </Badge>
            </CardContent>
          </Card>
        )}

      {/* Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Solicitado por
              </p>
              <p className="text-sm font-medium mt-1">{requestedByLabel}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Enrutada a
              </p>
              <p className="text-sm font-medium mt-1">{RECIPIENT_LABELS[request.recipient]}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Urgencia
              </p>
              <Badge
                variant="outline"
                className={`mt-1 text-xs ${URGENCY_COLORS[request.purchaseUrgency] || ""}`}
              >
                {PURCHASE_URGENCY_LABELS[
                  request.purchaseUrgency as "urgente" | "no_urgente"
                ] || "No urgente"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fecha de creación
              </p>
              <p className="text-sm mt-1">{new Date(request.createdAt).toLocaleString("es")}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fecha necesaria
              </p>
              <p className="text-sm font-medium mt-1">
                {formatDateForDisplay(neededByDate)}
              </p>
              {dueStatus && (
                <p className={`text-xs mt-0.5 ${DUE_STATUS_COLORS[dueStatus.tone] || ""}`}>
                  {dueStatus.label}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Etapa actual
              </p>
              <p className="text-sm font-medium mt-1">
                {WORKFLOW_STAGE_LABELS[request.workflowStage] || request.workflowStage}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                El estatus cambia automáticamente al asignar flujos
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            {request.notes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notas
                </p>
                <p className="text-sm mt-1">{request.notes}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Aprobación
              </p>
              <p className="text-sm mt-1">
                {APPROVAL_STATUS_LABELS[request.approvalStatus] || request.approvalStatus}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Política aplicada
              </p>
              <p className="text-sm mt-1">
                {request.purchaseUrgency === "urgente"
                  ? "La requisición se registró como compra urgente."
                  : `La fecha necesaria se asignó con la política estándar de ${STANDARD_PURCHASE_LEAD_DAYS} días calendario.`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Progreso de ítems
              </p>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${actionableRows.length > 0 ? (completedItemRows / actionableRows.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {completedItemRows}/{actionableRows.length || 0}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Items Table - Inline columns for flow and SAP */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Ítems Solicitados — Asignación de Flujo por Ítem
          </CardTitle>
          {canReviewGoodsItems && pendingApprovalItemsCount > 0 ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {pendingApprovalItemsCount} pendiente(s)
              </Badge>
              <Button
                variant="outline"
                size="sm"
                disabled={reviewItemsMutation.isPending}
                onClick={() => setPendingBulkReviewDecision("aprobada")}
              >
                Aprobar todo
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={reviewItemsMutation.isPending}
                onClick={() => setPendingBulkReviewDecision("rechazada")}
              >
                Rechazar todo
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Ítem Solicitado
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Cant. Original
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Ya procesada
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Cant. desp.
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Pendiente
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-20">
                    Unidad
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground min-w-[260px]">
                    EXIST. ALMACEN
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Comprometido
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground min-w-[220px]">
                    Traducir a SAP
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground min-w-[180px]">
                    Flujo / Salida
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Doc. SAP
                  </th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map((row) => {
                  const item = row.baseItem;
                  const editableItem = row.editableItem;
                  const queuedFlow = editableItem?.assignedFlow as
                    | QueueFlowType
                    | undefined;
                  const pendingFlow = editableItem
                    ? pendingFlowByItemId[editableItem.id]
                    : undefined;
                  const selectedQueueFlow = pendingFlow ?? queuedFlow;
                  const hasPendingFlowDraft = editableItem
                    ? Object.prototype.hasOwnProperty.call(
                        pendingFlowByItemId,
                        editableItem.id
                      )
                    : false;
                  const queueOptions = getVisibleQueueOptionsForItem();
                  const approvalBadge = getRowApprovalBadge(row);
                  const approvalEventLabel = getApprovalEventLabel(row);
                  const rejectionNotes = Array.from(
                    new Set(
                      row.rejectedItems
                        .map((entry) =>
                          typeof entry.rejectionReason === "string"
                            ? entry.rejectionReason.trim()
                            : ""
                        )
                        .filter(Boolean)
                    )
                  );
                  const unresolvedQuantity =
                    row.remainingQuantity + row.pendingApprovalQuantity;
                  const canReviewRow =
                    canReviewGoodsItems && row.pendingApprovalItems.length > 0;
                  const hasEditableItemMovement = editableItem
                    ? Number(editableItem.deliveredQuantity ?? 0) > 0 ||
                      Number(editableItem.dispatchedQuantity ?? 0) > 0
                    : false;
                  const isSapTranslationLocked =
                    !canManageSapTranslation ||
                    request.status === "flujo_completado" ||
                    request.status === "cerrada" ||
                    request.status === "cerrada_incompleta" ||
                    request.status === "borrador" ||
                    request.status === "anulada" ||
                    !editableItem ||
                    (editableItem
                      ? (activeFlowTypesByItem.get(editableItem.id)?.size ?? 0) > 0
                      : false) ||
                    hasEditableItemMovement;
                  const isFlowSelectionLocked =
                    !editableItem ||
                    row.remainingQuantity <= 0 ||
                    (editableItem
                      ? (activeFlowTypesByItem.get(editableItem.id)?.size ?? 0) > 0
                      : false) ||
                    assigningFlowItemId === editableItem?.id;
                  const canRejectPendingBalance =
                    canManageProcessing &&
                    request.status !== "flujo_completado" &&
                    request.status !== "cerrada" &&
                    request.status !== "cerrada_incompleta" &&
                    request.status !== "borrador" &&
                    request.status !== "anulada" &&
                    request.requestType === "bienes" &&
                    row.pendingApprovalQuantity <= 0 &&
                    row.remainingQuantity > 0 &&
                    row.processedQuantity > 0 &&
                    Boolean(editableItem);
                  const approvedRejectableItem = row.approvedItems.find((entry) => {
                    const hasMovement =
                      Number(entry.deliveredQuantity ?? 0) > 0 ||
                      Number(entry.dispatchedQuantity ?? 0) > 0;
                    const hasActiveFlows = (activeFlowsByItem.get(entry.id) ?? []).length > 0;

                    return !entry.assignedFlow && !hasActiveFlows && !hasMovement;
                  });
                  const canRejectApprovedItem =
                    canRejectApprovedItems &&
                    request.requestType === "bienes" &&
                    request.status !== "borrador" &&
                    request.status !== "cerrada" &&
                    request.status !== "cerrada_incompleta" &&
                    request.status !== "anulada" &&
                    request.approvalStatus !== "pendiente" &&
                    row.pendingApprovalQuantity <= 0 &&
                    Boolean(approvedRejectableItem);
                  const docSapLabels = Array.from(
                    new Set(
                      row.assignedFlowTypes
                        .map((flowType) => SAP_DOC_LABELS[flowType] || flowType)
                        .filter(Boolean)
                    )
                  );
                  const translatedSapCode =
                    editableItem?.sapItemCode ?? item.sapItemCode ?? "";
                  const hasSapTranslation = translatedSapCode.trim().length > 0;
                  const shouldShowSapQueueWarning =
                    Boolean(editableItem) && !hasSapTranslation && !queuedFlow;
                  const selectedDispatchWarehouseId = editableItem
                    ? getSelectedWarehouseId(editableItem)
                    : null;
                  const hasPendingWarehouseChange =
                    selectedQueueFlow === "despacho_bodega" &&
                    selectedDispatchWarehouseId !== null &&
                    selectedDispatchWarehouseId !== Number(editableItem?.warehouseId ?? 0);
                  const canSubmitQueuedFlow =
                    Boolean(editableItem && selectedQueueFlow) &&
                    (hasPendingFlowDraft || hasPendingWarehouseChange) &&
                    selectedQueueFlow !== undefined &&
                    (selectedQueueFlow !== queuedFlow || hasPendingWarehouseChange);
                  const shouldShowDispatchWarehouseCombobox =
                    Boolean(editableItem) &&
                    request.requestType === "bienes" &&
                    queueOptions.includes("despacho_bodega") &&
                    (selectedQueueFlow === "despacho_bodega" ||
                      warehousePromptItemId === editableItem?.id ||
                      Boolean(selectedDispatchWarehouseId));

                  return (
                    <tr
                      key={row.key}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="p-3">
                        <p className="font-medium">{item.itemName}</p>
                        {item.target?.label ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.target.label}
                          </p>
                        ) : null}
                        {item.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{item.notes}</p>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatQuantityValue(row.originalQuantity)}
                      </td>
                      <td className="p-3 text-right font-mono text-xs">
                        {formatQuantityValue(row.processedQuantity)}
                      </td>
                      <td className="p-3 text-right text-xs">{item.dispatchedQuantity || "0.00"}</td>
                      <td className="p-3 text-right font-mono text-xs">
                        {formatQuantityValue(unresolvedQuantity)}
                      </td>
                      <td className="p-3 text-xs">{item.unit || "—"}</td>
                      <td className="p-3 align-top text-xs">
                        <ProjectStockBreakdown
                          item={item}
                          hasSapTranslation={hasSapTranslation}
                          canViewQuantities={canViewWarehouseQuantities}
                        />
                      </td>
                      <td className="p-3 text-right text-xs">
                        {hasSapTranslation ? item.committedQuantity || "0.00" : "—"}
                      </td>
                      <td className="p-3">
                        <SapSearchBox
                          itemId={editableItem?.id ?? item.id}
                          currentCode={editableItem?.sapItemCode ?? item.sapItemCode}
                          currentDescription={
                            editableItem?.sapItemDescription ?? item.sapItemDescription
                          }
                          onSelect={(code, desc) =>
                            handleSapSelect(editableItem?.id ?? item.id, code, desc)
                          }
                          onClear={() =>
                            handleClearSapTranslation(editableItem?.id ?? item.id)
                          }
                          disabled={isSapTranslationLocked}
                        />
                      </td>
                      <td className="p-3">
                        <div className="space-y-2">
                          <Badge
                            variant="outline"
                            className={`text-xs ${approvalBadge.className}`}
                          >
                            {approvalBadge.label}
                          </Badge>
                          {approvalEventLabel ? (
                            <p className="text-[10px] leading-4 text-muted-foreground">
                              {approvalEventLabel}
                            </p>
                          ) : null}

                          {row.pendingApprovalQuantity > 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Pendiente de autorización: {formatQuantityValue(row.pendingApprovalQuantity)}
                            </p>
                          ) : null}

                          {row.rejectedQuantity > 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Rechazado: {formatQuantityValue(row.rejectedQuantity)}
                            </p>
                          ) : null}

                          {rejectionNotes.length > 0 ? (
                            <p className="text-[11px] leading-5 text-rose-700">
                              Motivo: {rejectionNotes.join(" | ")}
                            </p>
                          ) : null}

                          {canReviewRow ? (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 px-3 text-xs"
                                disabled={reviewItemsMutation.isPending}
                                onClick={() =>
                                  reviewItemsMutation.mutate({
                                    requestId,
                                    itemIds: row.pendingApprovalItems.map((entry) => entry.id),
                                    decision: "aprobada",
                                  })
                                }
                              >
                                Aprobar
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="h-8 px-3 text-xs"
                                disabled={reviewItemsMutation.isPending}
                                onClick={() => {
                                  setPendingItemRejection({
                                    itemIds: row.pendingApprovalItems.map((entry) => entry.id),
                                    itemLabel: item.itemName,
                                  });
                                  setItemRejectReason("");
                                }}
                              >
                                Rechazar
                              </Button>
                            </div>
                          ) : null}

                          {row.flowEvents.length > 0 ? (
                            <div className="space-y-1.5">
                              {row.flowEvents.map((event) => (
                                <div key={`${row.key}-${event.key}`} className="space-y-0.5">
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${FLOW_COLORS[event.flowType] || ""}`}
                                  >
                                    <Check className="mr-1 h-3 w-3" />
                                    {FLOW_LABELS[event.flowType] || event.flowType}
                                  </Badge>
                                  {getFlowEventTimeline(event).map((line) => (
                                    <p
                                      key={`${row.key}-${event.key}-${line}`}
                                      className="text-[10px] leading-4 text-muted-foreground"
                                    >
                                      {line}
                                    </p>
                                  ))}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin flujo asignado</span>
                          )}

                          {row.assignedFlowTypes.length > 0 && row.remainingQuantity > 0 ? (
                            <p className="text-[11px] text-muted-foreground">
                              Falta por definir: {formatQuantityValue(row.remainingQuantity)}
                            </p>
                          ) : null}

                          {canRejectPendingBalance && editableItem ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              disabled={anyQueueProcessing}
                              onClick={() => {
                                setPendingBalanceRejection({
                                  itemId: editableItem.id,
                                  itemLabel: item.itemName,
                                  pendingQuantity: row.remainingQuantity,
                                  unit: item.unit,
                                });
                                setBalanceRejectReason("");
                              }}
                            >
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                              Rechazar saldo
                            </Button>
                          ) : null}

                          {canRejectApprovedItem && approvedRejectableItem ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              disabled={anyQueueProcessing}
                              onClick={() => {
                                setPendingApprovedItemRejection({
                                  itemId: approvedRejectableItem.id,
                                  itemLabel: item.itemName,
                                  quantity: Number(approvedRejectableItem.quantity ?? 0),
                                  unit: approvedRejectableItem.unit,
                                });
                                setApprovedItemRejectReason("");
                              }}
                            >
                              <XCircle className="mr-1 h-3.5 w-3.5" />
                              Rechazar ítem
                            </Button>
                          ) : null}

                          {editableItem?.assignedFlow ? (
                            <Badge variant="secondary" className="text-xs">
                              En panel:{" "}
                              {QUEUE_FLOW_LABELS[editableItem.assignedFlow as QueueFlowType]}
                            </Badge>
                          ) : null}

                          {canAssignQueueFlows &&
                            request.status !== "cerrada" &&
                            request.status !== "flujo_completado" &&
                            request.status !== "cerrada_incompleta" &&
                            request.status !== "borrador" &&
                            request.status !== "anulada" &&
                            canShowQueueAssignmentForRequest &&
                            row.pendingApprovalQuantity <= 0 && (
                            <div className="space-y-1.5">
                              {shouldShowSapQueueWarning ? (
                                <p className="text-[11px] text-rose-700">
                                  Debe traducir a SAP antes de enviar este ítem al flujo.
                                </p>
                              ) : null}
                              <Select
                                value={selectedQueueFlow}
                                onValueChange={(value) => {
                                  if (!editableItem) return;
                                  const nextFlow = value as QueueFlowType;
                                  setPendingFlowByItemId((current) => {
                                    const next = { ...current };
                                    if (nextFlow === queuedFlow) {
                                      delete next[editableItem.id];
                                    } else {
                                      next[editableItem.id] = nextFlow;
                                    }
                                    return next;
                                  });
                                  setWarehousePromptItemId((current) =>
                                    nextFlow === "despacho_bodega"
                                      ? editableItem.id
                                      : current === editableItem.id
                                        ? null
                                        : current
                                  );
                                }}
                                disabled={isFlowSelectionLocked || anyQueueProcessing}
                              >
                                <SelectTrigger className="h-8 w-full min-w-0 text-xs">
                                  <SelectValue placeholder="Seleccionar flujo" />
                                </SelectTrigger>
                                <SelectContent align="start">
                                  {queueOptions.map((flowType) => {
                                    const disabledReason = editableItem
                                      ? getQueueDisabledReason(
                                          editableItem,
                                          flowType,
                                          selectedDispatchWarehouseId
                                        )
                                      : "No hay cantidad pendiente";
                                    const isMissingWarehousePrompt =
                                      flowType === "despacho_bodega" &&
                                      !selectedDispatchWarehouseId &&
                                      disabledReason ===
                                        "Seleccione una bodega para la salida de inventario";
                                    return (
                                      <SelectItem
                                        key={`${row.key}-${flowType}`}
                                        value={flowType}
                                        disabled={
                                          Boolean(disabledReason) &&
                                          selectedQueueFlow !== flowType &&
                                          !isMissingWarehousePrompt
                                        }
                                      >
                                        {QUEUE_FLOW_LABELS[flowType]}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              {shouldShowDispatchWarehouseCombobox && editableItem ? (
                                renderDispatchWarehouseCombobox(
                                  editableItem,
                                  row.remainingQuantity,
                                  isFlowSelectionLocked ||
                                    anyQueueProcessing ||
                                    !hasSapTranslation,
                                  !hasSapTranslation
                                    ? "Traduce el ítem a SAP para calcular existencia por bodega."
                                    : null
                                )
                              ) : null}
                              <Button
                                variant="default"
                                size="sm"
                                className="h-8 w-full px-2 text-xs"
                                onClick={() => {
                                  if (!editableItem || !selectedQueueFlow) return;
                                  void handleQueuedFlowSelection(
                                    editableItem,
                                    selectedQueueFlow,
                                    selectedDispatchWarehouseId
                                  );
                                }}
                                disabled={
                                  !canSubmitQueuedFlow ||
                                  isFlowSelectionLocked ||
                                  anyQueueProcessing
                                }
                              >
                                <Send className="mr-1.5 h-3.5 w-3.5" />
                                Enviar a flujo
                              </Button>
                              {queuedFlow && editableItem ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => void handleQueuedFlowSelection(editableItem, "__clear__")}
                                  disabled={anyQueueProcessing}
                                >
                                  Quitar flujo
                                </Button>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        {docSapLabels.length > 0 ? (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {docSapLabels.map((label) => (
                              <div key={`${row.key}-${label}`}>{label}</div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canAssignQueueFlows &&
            request.status !== "cerrada" &&
            request.status !== "flujo_completado" &&
            request.status !== "cerrada_incompleta" &&
            request.status !== "borrador" &&
            request.status !== "anulada" &&
            request.approvalStatus !== "pendiente" &&
            canShowQueueAssignmentForRequest && (
            <div className="border-t border-border bg-muted/5 p-4">
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 text-primary" />
                <span>
                  Cuando selecciones un flujo, el ítem se enviará al panel principal de Flujos de Abastecimiento para que se procese en su módulo correspondiente.
                </span>
              </div>
            </div>
          )}

          {/* Status bar below table */}
          {canManageProcessing &&
            request.status !== "cerrada" &&
            request.status !== "flujo_completado" &&
            request.status !== "cerrada_incompleta" &&
            request.status !== "borrador" &&
            request.status !== "anulada" && (
            <div className="border-t border-border p-3 bg-muted/10 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {hasPendingApprovalRows && (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      Esperando autorización del Administrador del Proyecto, Administración Central, Jefe de Bodega o Bodeguero de Proyecto para habilitar SAP y los flujos.
                    </span>
                  </>
                )}
                {!hasPendingApprovalRows && !allItemsAssigned && (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      Asigne flujo y código SAP a todos los ítems para enviarlos al módulo correspondiente.
                    </span>
                  </>
                )}
                {allItemsAssigned && (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <span className="text-green-700 font-medium">
                      Todos los ítems tienen flujo y código SAP asignado.
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flow Records */}
      {flowData && flowData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Registro de Flujos Asignados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {flowData.map((flow: any) => {
                const FlowIcon = FLOW_ICONS[flow.flowType] || Package;
                const relatedItem = (items || []).find((i: any) => i.id === flow.requestItemId);
                return (
                  <div
                    key={flow.id}
                    className={`flex items-start gap-3 p-3 border rounded ${FLOW_COLORS[flow.flowType] || "border-border"}`}
                  >
                    <FlowIcon className="h-5 w-5 mt-0.5 shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{FLOW_LABELS[flow.flowType]}</p>
                        {relatedItem && (
                          <span className="text-xs bg-white/50 px-2 py-0.5 rounded">
                            {relatedItem.itemName}
                          </span>
                        )}
                        <span className="text-xs opacity-60">
                          → SAP: {SAP_DOC_LABELS[flow.flowType]}
                        </span>
                      </div>
                      {flow.paymentMethod && (
                        <p className="text-xs opacity-80">
                          Método: {PAYMENT_METHOD_LABELS[flow.paymentMethod] || "—"}
                        </p>
                      )}
                      {flow.purchaseType && (
                        <p className="text-xs opacity-80">
                          Tipo: {PURCHASE_TYPE_LABELS[flow.purchaseType] || "—"}
                        </p>
                      )}
                      {flow.purchaseOrderNumber && (
                        <p className="text-xs opacity-80">OC: {flow.purchaseOrderNumber}</p>
                      )}
                      {flow.notes && <p className="text-xs opacity-70">{flow.notes}</p>}
                      <Badge variant="outline" className="text-xs capitalize mt-1">
                        {flow.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <DocumentAttachmentsPanel
        entityType="material_request"
        entityId={requestId}
        title="Archivos Adjuntos"
        canManage={canManageMaterialRequestAttachments}
      />

      <Dialog
        open={Boolean(pendingBalanceRejection)}
        onOpenChange={(open) => {
          if (!open && !rejectPendingQuantityMutation.isPending) {
            setPendingBalanceRejection(null);
            setBalanceRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>Rechazar saldo pendiente</DialogTitle>
            <DialogDescription className="leading-6">
              Esta acción rechazará el saldo pendiente de{" "}
              <span className="font-medium text-foreground">
                {pendingBalanceRejection?.itemLabel ?? "este ítem"}
              </span>
              :{" "}
              <span className="font-medium text-foreground">
                {formatQuantityValue(pendingBalanceRejection?.pendingQuantity)}{" "}
                {pendingBalanceRejection?.unit || ""}
              </span>
              . Lo ya procesado se conserva.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="balance-reject-reason">Nota de rechazo *</Label>
            <Textarea
              id="balance-reject-reason"
              value={balanceRejectReason}
              onChange={(event) => setBalanceRejectReason(event.target.value)}
              placeholder="Ejemplo: saldo no requerido, no hay disponibilidad o se cierra por decisión operativa"
              rows={4}
              disabled={rejectPendingQuantityMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Esta nota quedará registrada en el saldo rechazado. Si no queda otro saldo activo, la requisición se cerrará automáticamente.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setPendingBalanceRejection(null);
                setBalanceRejectReason("");
              }}
              disabled={rejectPendingQuantityMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingBalanceRejection) return;
                if (balanceRejectReason.trim().length < 5) {
                  toast.error("Escribe un motivo de rechazo de al menos 5 caracteres");
                  return;
                }

                rejectPendingQuantityMutation.mutate({
                  id: pendingBalanceRejection.itemId,
                  reason: balanceRejectReason,
                });
              }}
              disabled={rejectPendingQuantityMutation.isPending}
            >
              {rejectPendingQuantityMutation.isPending
                ? "Guardando..."
                : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingApprovedItemRejection)}
        onOpenChange={(open) => {
          if (!open && !rejectApprovedItemMutation.isPending) {
            setPendingApprovedItemRejection(null);
            setApprovedItemRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>Rechazar ítem aprobado</DialogTitle>
            <DialogDescription className="leading-6">
              Esta acción rechazará{" "}
              <span className="font-medium text-foreground">
                {pendingApprovedItemRejection?.itemLabel ?? "este ítem"}
              </span>
              :{" "}
              <span className="font-medium text-foreground">
                {formatQuantityValue(pendingApprovedItemRejection?.quantity)}{" "}
                {pendingApprovedItemRejection?.unit || ""}
              </span>
              . Solo aplica a renglones sin flujo activo ni movimientos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="approved-item-reject-reason">Motivo de rechazo *</Label>
            <Textarea
              id="approved-item-reject-reason"
              value={approvedItemRejectReason}
              onChange={(event) => setApprovedItemRejectReason(event.target.value)}
              placeholder="Ejemplo: saldo ya no requerido, cambio de prioridad o cierre administrativo"
              rows={4}
              disabled={rejectApprovedItemMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Esta nota quedará visible en el renglón rechazado.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setPendingApprovedItemRejection(null);
                setApprovedItemRejectReason("");
              }}
              disabled={rejectApprovedItemMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingApprovedItemRejection) return;
                if (approvedItemRejectReason.trim().length < 5) {
                  toast.error("Escribe un motivo de rechazo de al menos 5 caracteres");
                  return;
                }

                rejectApprovedItemMutation.mutate({
                  id: pendingApprovedItemRejection.itemId,
                  reason: approvedItemRejectReason,
                });
              }}
              disabled={rejectApprovedItemMutation.isPending}
            >
              {rejectApprovedItemMutation.isPending
                ? "Guardando..."
                : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingItemRejection)}
        onOpenChange={(open) => {
          if (!open && !reviewItemsMutation.isPending) {
            setPendingItemRejection(null);
            setItemRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>Rechazar ítem</DialogTitle>
            <DialogDescription className="leading-6">
              Escribe una nota para dejar claro por qué se rechazó{" "}
              <span className="font-medium text-foreground">
                {pendingItemRejection?.itemLabel ?? "este ítem"}
              </span>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="item-reject-reason">Motivo de rechazo *</Label>
            <Textarea
              id="item-reject-reason"
              value={itemRejectReason}
              onChange={(event) => setItemRejectReason(event.target.value)}
              placeholder="Ejemplo: no cumple especificación, cantidad no autorizada o compra no prioritaria"
              rows={4}
              disabled={reviewItemsMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Esta nota quedará visible en la requisición.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setPendingItemRejection(null);
                setItemRejectReason("");
              }}
              disabled={reviewItemsMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingItemRejection) return;
                if (itemRejectReason.trim().length < 5) {
                  toast.error("Escribe un motivo de rechazo de al menos 5 caracteres");
                  return;
                }
                reviewItemsMutation.mutate({
                  requestId,
                  itemIds: pendingItemRejection.itemIds,
                  decision: "rechazada",
                  reason: itemRejectReason,
                });
              }}
              disabled={reviewItemsMutation.isPending}
            >
              {reviewItemsMutation.isPending ? "Guardando..." : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingBulkReviewDecision !== null}
        onOpenChange={(open) => {
          if (!open && !reviewItemsMutation.isPending) {
            setPendingBulkReviewDecision(null);
            setBulkRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg rounded-2xl border-border/70">
          <DialogHeader className="space-y-2">
            <DialogTitle>
              {pendingBulkReviewDecision === "aprobada"
                ? "Aprobar todos los ítems pendientes"
                : "Rechazar todos los ítems pendientes"}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {pendingBulkReviewDecision === "aprobada"
                ? `Esta acción aprobará los ${pendingApprovalItemsCount} ítem(s) que siguen pendientes de autorización en esta requisición.`
                : `Esta acción rechazará los ${pendingApprovalItemsCount} ítem(s) que siguen pendientes de autorización en esta requisición.`}
            </DialogDescription>
          </DialogHeader>

          {pendingBulkReviewDecision === "rechazada" ? (
            <div className="space-y-2">
              <Label htmlFor="bulk-reject-reason">Motivo de rechazo *</Label>
              <Textarea
                id="bulk-reject-reason"
                value={bulkRejectReason}
                onChange={(event) => setBulkRejectReason(event.target.value)}
                placeholder="Ejemplo: no cumple especificación, cantidad no autorizada o compra no prioritaria"
                rows={4}
                disabled={reviewItemsMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Esta nota quedará visible en todos los ítems rechazados.
              </p>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setPendingBulkReviewDecision(null);
                setBulkRejectReason("");
              }}
              disabled={reviewItemsMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant={pendingBulkReviewDecision === "rechazada" ? "destructive" : "default"}
              onClick={() => {
                if (!pendingBulkReviewDecision) return;
                if (pendingApprovalItemIds.length === 0) {
                  toast.error("No hay ítems pendientes por revisar");
                  return;
                }
                if (
                  pendingBulkReviewDecision === "rechazada" &&
                  bulkRejectReason.trim().length < 5
                ) {
                  toast.error("Escribe un motivo de rechazo de al menos 5 caracteres");
                  return;
                }
                reviewItemsMutation.mutate({
                  requestId,
                  itemIds: pendingApprovalItemIds,
                  decision: pendingBulkReviewDecision,
                  reason:
                    pendingBulkReviewDecision === "rechazada"
                      ? bulkRejectReason
                      : undefined,
                });
              }}
              disabled={reviewItemsMutation.isPending}
            >
              {reviewItemsMutation.isPending
                ? "Guardando..."
                : pendingBulkReviewDecision === "aprobada"
                  ? "Confirmar aprobación"
                  : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
