import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  ArrowLeft,
  Package,
  Truck,
  ArrowLeftRight,
  ShoppingCart,
  Upload,
  FileText,
  Trash2,
  Check,
  Search,
  Send,
  AlertCircle,
  Pencil,
} from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";
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
  cerrada: "Cerrada",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 text-slate-700 bg-slate-50",
  pendiente_aprobar: "border-orange-300 text-orange-700 bg-orange-50",
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
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

const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  bodega_proyecto: "Bodega del Proyecto",
  administrador_proyecto: "Administrador del Proyecto",
  oficina_central: "Oficina Central",
  compra_local: "Compra Local",
  compra_internacional: "Compra Internacional",
  traslado: "Traslado",
  recepcion: "Recepción",
  cerrada: "Cerrada",
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
  hasSapCode: boolean;
};

const parseQuantityValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatQuantityValue = (value: unknown) => parseQuantityValue(value).toFixed(2);

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
  disabled,
}: {
  itemId: number;
  currentCode: string | null;
  currentDescription: string | null;
  onSelect: (code: string, desc: string) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: results } = trpc.requestItems.searchSapCatalog.useQuery(
    { search },
    { enabled: search.length >= 2 }
  );

  if (currentCode) {
    return (
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs font-bold text-primary">{currentCode}</span>
        {currentDescription && (
          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
            {currentDescription}
          </span>
        )}
      </div>
    );
  }

  if (disabled) {
    return <span className="text-xs text-muted-foreground italic">Sin traducir</span>;
  }

  const hasResults = results && results.length > 0;
  const noResults = results && results.length === 0 && search.length >= 2;

  return (
    <Popover open={open && (!!hasResults || !!noResults)} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value.length >= 2) {
                setOpen(true);
              } else {
                setOpen(false);
              }
            }}
            onFocus={() => {
              if (search.length >= 2) setOpen(true);
            }}
            placeholder="Buscar código SAP..."
            className="h-7 text-xs pl-7 pr-2"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[320px] max-h-[240px] overflow-y-auto"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {hasResults && results.map((item: any) => (
          <button
            key={item.id}
            onClick={() => {
              onSelect(item.itemCode, item.description);
              setSearch("");
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border last:border-0 flex items-center gap-2"
          >
            <span className="font-mono text-xs font-bold text-primary shrink-0">
              {item.itemCode}
            </span>
            <span className="text-xs text-foreground truncate">
              {item.description}
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
  );
}

export default function SolicitudDetalle() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const requestId = parseInt(params.id || "0");

  const { data, isLoading } = trpc.materialRequests.getById.useQuery(
    { id: requestId },
    { enabled: requestId > 0 }
  );

  const { data: flowData } = trpc.supplyFlows.getByRequestId.useQuery(
    { requestId },
    { enabled: requestId > 0 }
  );

  const { data: availableFlows } = trpc.supplyFlows.availableFlows.useQuery();

  const { data: attachments } = trpc.attachments.getByEntity.useQuery(
    { entityType: "material_request", entityId: requestId },
    { enabled: requestId > 0 }
  );

  const { data: projects } = trpc.projects.list.useQuery({ status: "activo" });

  // Fetch suppliers for Direct Purchase flow
  const { data: suppliersList } = trpc.requestItems.listSuppliers.useQuery();
  const items = data?.items ?? [];

  const translateMutation = trpc.requestItems.translateToSap.useMutation({
    onSuccess: () => {
      toast.success("Código SAP asignado");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendToSapMutation = trpc.materialRequests.sendToSap.useMutation({
    onSuccess: (result) => {
      toast.success(`Enviado a SAP: ${result.itemsProcessed} ítems procesados`);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  // Batch-oriented flow mutations
  const directPurchaseMutation = trpc.supplyFlows.createDirectPurchaseBatch.useMutation();
  const projectTransferMutation = trpc.supplyFlows.createProjectTransfer.useMutation();
  const purchaseRequestMutation = trpc.supplyFlows.createPurchaseRequest.useMutation();
  const warehouseExitMutation = trpc.requestItems.recordWarehouseExit.useMutation();

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

  const uploadMutation = trpc.attachments.upload.useMutation({
    onSuccess: () => {
      toast.success("Archivo adjunto subido");
      utils.attachments.getByEntity.invalidate({
        entityType: "material_request",
        entityId: requestId,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteAttachmentMutation = trpc.attachments.delete.useMutation({
    onSuccess: () => {
      toast.success("Archivo eliminado");
      utils.attachments.getByEntity.invalidate({
        entityType: "material_request",
        entityId: requestId,
      });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [queuedFlowByItemId, setQueuedFlowByItemId] = useState<
    Record<number, QueueFlowType | undefined>
  >({});
  const [queuedDispatchQuantities, setQueuedDispatchQuantities] = useState<Record<number, string>>(
    {}
  );
  const [directPurchasePaymentMethod, setDirectPurchasePaymentMethod] = useState("");
  const [directPurchaseSupplierId, setDirectPurchaseSupplierId] = useState("");
  const [directPurchaseCheckedByItemId, setDirectPurchaseCheckedByItemId] = useState<
    Record<number, boolean>
  >({});
  const [directPurchaseQuantityByItemId, setDirectPurchaseQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [directPurchaseNotes, setDirectPurchaseNotes] = useState("");
  const [transferSourceProjectId, setTransferSourceProjectId] = useState("");
  const [transferNotes, setTransferNotes] = useState("");
  const [purchaseRequestType, setPurchaseRequestType] = useState("");
  const [purchaseRequestNotes, setPurchaseRequestNotes] = useState("");
  const [warehouseExitNotes, setWarehouseExitNotes] = useState("");
  const [processingQueueType, setProcessingQueueType] = useState<QueueFlowType | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [pendingItemRejection, setPendingItemRejection] = useState<{
    itemIds: number[];
    itemLabel: string;
  } | null>(null);
  const [itemRejectReason, setItemRejectReason] = useState("");

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";
  const canManageProcessing =
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central" ||
    isAdmin;
  const canApproveProjectRequests =
    userRole === "administrador_proyecto" ||
    userRole === "administracion_central" ||
    isAdmin;

  const invalidateAll = () =>
    Promise.all([
      utils.materialRequests.getById.invalidate({ id: requestId }),
      utils.supplyFlows.getByRequestId.invalidate({ requestId }),
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

    const buildRow = (groupItems: any[], key: string): ItemDisplayRow => {
      const approvedItems = groupItems.filter((entry) => isItemApprovedForProcessing(entry));
      const pendingApprovalItems = groupItems.filter(
        (entry) => entry.approvalStatus === "pendiente"
      );
      const rejectedItems = groupItems.filter(
        (entry) => entry.approvalStatus === "rechazada"
      );
      const assignedItems = groupItems.filter((entry) => Boolean(entry.assignedFlow));
      const pendingItems = approvedItems.filter((entry) => !entry.assignedFlow);
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
        processedQuantity: assignedItems.reduce(
          (total, entry) => total + parseQuantityValue(entry.quantity),
          0
        ),
        remainingQuantity: pendingItems.reduce(
          (total, entry) => total + parseQuantityValue(entry.quantity),
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
            assignedItems
              .map((entry) => entry.assignedFlow)
              .filter((value): value is string => Boolean(value))
          )
        ),
        hasSapCode:
          approvedItems.length === 0 ||
          approvedItems.every((entry) => Boolean(entry.sapItemCode)),
      };
    };

    return orderedKeys.flatMap((groupKey) => {
      const groupItems = groupedItems.get(groupKey) ?? [];
      const pendingItems = groupItems.filter(
        (entry) => isItemApprovedForProcessing(entry) && !entry.assignedFlow
      );
      const pendingApprovalItems = groupItems.filter(
        (entry) => entry.approvalStatus === "pendiente"
      );
      const hasProcessedItems = groupItems.some((entry) => Boolean(entry.assignedFlow));
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
  }, [items]);

  const handleSapSelect = (itemId: number, code: string, desc: string) => {
    translateMutation.mutate({
      id: itemId,
      sapItemCode: code,
      sapItemDescription: desc,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        entityType: "material_request",
        entityId: requestId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const getVisibleQueueOptionsForItem = () => {
    const options: QueueFlowType[] = [];

    if (user?.role === "admin" || userRole === "jefe_bodega_central") {
      options.push("despacho_bodega");
    }
    if ((availableFlows || []).includes("compra_directa")) {
      options.push("compra_directa");
    }
    if ((availableFlows || []).includes("traslado_proyecto")) {
      options.push("traslado_proyecto");
    }
    if ((availableFlows || []).includes("solicitud_compra")) {
      options.push("solicitud_compra");
    }

    return options.filter((value, index, array) => array.indexOf(value) === index);
  };

  const getQueueDisabledReason = (item: any, flowType: QueueFlowType) => {
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

  const clearQueuedItems = (itemIds: number[]) => {
    setQueuedFlowByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setQueuedDispatchQuantities((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setDirectPurchaseCheckedByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
    setDirectPurchaseQuantityByItemId((current) => {
      const next = { ...current };
      for (const itemId of itemIds) delete next[itemId];
      return next;
    });
  };

  const handleQueuedFlowToggle = (
    item: any,
    flowType: QueueFlowType,
    checked: boolean | "indeterminate"
  ) => {
    const isChecked = checked === true;
    const currentFlow = queuedFlowByItemId[item.id];
    const disabledReason = getQueueDisabledReason(item, flowType);

    if (isChecked && disabledReason) {
      toast.error(disabledReason);
      return;
    }

    setQueuedFlowByItemId((current) => {
      const next = { ...current };
      if (!isChecked || current[item.id] === flowType) {
        delete next[item.id];
      } else {
        next[item.id] = flowType;
      }
      return next;
    });

    if (currentFlow === "despacho_bodega" && flowType !== "despacho_bodega") {
      setQueuedDispatchQuantities((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }

    if (currentFlow === "compra_directa" && flowType !== "compra_directa") {
      setDirectPurchaseCheckedByItemId((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setDirectPurchaseQuantityByItemId((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }

    if (
      isChecked &&
      flowType === "despacho_bodega" &&
      !queuedDispatchQuantities[item.id]
    ) {
      setQueuedDispatchQuantities((current) => ({
        ...current,
        [item.id]: String(item.quantity ?? "0.00"),
      }));
    }

    if (
      isChecked &&
      flowType === "compra_directa" &&
      !directPurchaseQuantityByItemId[item.id]
    ) {
      setDirectPurchaseQuantityByItemId((current) => ({
        ...current,
        [item.id]: String(item.quantity ?? "0.00"),
      }));
    }
  };

  const handleQueuedFlowSelection = (item: any, nextFlow: string) => {
    if (nextFlow === "__clear__") {
      clearQueuedItems([item.id]);
      return;
    }

    handleQueuedFlowToggle(item, nextFlow as QueueFlowType, true);
  };

  const queuedItemsByFlow = useMemo(
    () =>
      items.reduce(
        (groups, item: any) => {
          const queuedFlow = queuedFlowByItemId[item.id];
          if (queuedFlow) {
            groups[queuedFlow].push(item);
          }
          return groups;
        },
        {
          despacho_bodega: [] as any[],
          compra_directa: [] as any[],
          traslado_proyecto: [] as any[],
          solicitud_compra: [] as any[],
        }
      ),
    [items, queuedFlowByItemId]
  );

  const queueSections = QUEUE_FLOW_ORDER.filter(
    (flowType) => queuedItemsByFlow[flowType].length > 0
  );

  const anyQueueProcessing =
    processingQueueType !== null ||
    directPurchaseMutation.isPending ||
    projectTransferMutation.isPending ||
    purchaseRequestMutation.isPending ||
    warehouseExitMutation.isPending;

  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "No se pudo procesar el ítem";

  const processQueuedFlow = async (flowType: QueueFlowType) => {
    const queuedItems = queuedItemsByFlow[flowType];
    if (queuedItems.length === 0) return;

    if (flowType === "compra_directa") {
      if (!directPurchasePaymentMethod) {
        toast.error("Seleccione el método de pago para compra directa");
        return;
      }
      if (!directPurchaseSupplierId) {
        toast.error("Seleccione el proveedor para compra directa");
        return;
      }
    }

    if (flowType === "traslado_proyecto" && !transferSourceProjectId) {
      toast.error("Seleccione el proyecto origen para traslado");
      return;
    }

    if (flowType === "solicitud_compra" && !purchaseRequestType) {
      toast.error("Seleccione el tipo de compra para la solicitud de compra");
      return;
    }

    setProcessingQueueType(flowType);
    const processedItemIds: number[] = [];
    const failedItems: string[] = [];

    if (flowType === "compra_directa") {
      const selectedItems = queuedItems.filter(
        (item: any) => directPurchaseCheckedByItemId[item.id]
      );
      if (selectedItems.length === 0) {
        setProcessingQueueType(null);
        toast.error("Seleccione al menos un detalle de compra directa");
        return;
      }

      const invalidQuantityItem = selectedItems.find((item: any) => {
        const selectedQuantity = Number(
          directPurchaseQuantityByItemId[item.id] ?? String(item.quantity ?? "0.00")
        );
        const maxQuantity = Number(item.quantity ?? 0);
        return !Number.isFinite(selectedQuantity) || selectedQuantity <= 0 || selectedQuantity > maxQuantity;
      });

      if (invalidQuantityItem) {
        setProcessingQueueType(null);
        toast.error(`La cantidad de ${invalidQuantityItem.itemName} no es valida`);
        return;
      }

      try {
        const result = await directPurchaseMutation.mutateAsync({
          requestId,
          paymentMethod: directPurchasePaymentMethod as "linea_credito" | "caja_chica",
          supplierId: parseInt(directPurchaseSupplierId, 10),
          notes: directPurchaseNotes || undefined,
          items: selectedItems.map((item: any) => ({
            requestItemId: item.id,
            quantity:
              directPurchaseQuantityByItemId[item.id] ?? String(item.quantity ?? "0.00"),
          })),
        });

        clearQueuedItems(selectedItems.map((item: any) => item.id));
        await invalidateAll();
        setProcessingQueueType(null);
        toast.success(
          `Se generó la orden ${result.purchaseOrderNumber} para ${result.processedItems} ítem(s)`
        );
        return;
      } catch (error) {
        setProcessingQueueType(null);
        toast.error(getErrorMessage(error));
        return;
      }
    }

    for (const item of queuedItems) {
      try {
        if (flowType === "despacho_bodega") {
          const dispatchedQuantity =
            queuedDispatchQuantities[item.id] ?? String(item.quantity ?? "0.00");
          const dispatchedNumber = Number(dispatchedQuantity);
          const requestedNumber = Number(item.quantity ?? 0);

          if (!Number.isFinite(dispatchedNumber) || dispatchedNumber <= 0) {
            throw new Error("La cantidad despachada debe ser mayor que cero");
          }
          if (dispatchedNumber > requestedNumber) {
            throw new Error("La cantidad despachada no puede ser mayor que la solicitada");
          }

          await warehouseExitMutation.mutateAsync({
            requestId,
            requestItemId: item.id,
            dispatchedQuantity,
            note: warehouseExitNotes || undefined,
          });
        }

        if (flowType === "traslado_proyecto") {
          await projectTransferMutation.mutateAsync({
            requestId,
            requestItemId: item.id,
            sourceProjectId: parseInt(transferSourceProjectId),
            destinationProjectId: data?.request.projectId ?? 0,
            notes: transferNotes || undefined,
          });
        }

        if (flowType === "solicitud_compra") {
          await purchaseRequestMutation.mutateAsync({
            requestId,
            requestItemId: item.id,
            purchaseType: purchaseRequestType as "local" | "extranjera",
            notes: purchaseRequestNotes || undefined,
          });
        }

        processedItemIds.push(item.id);
      } catch (error) {
        failedItems.push(`${item.itemName}: ${getErrorMessage(error)}`);
      }
    }

    if (processedItemIds.length > 0) {
      clearQueuedItems(processedItemIds);
      await invalidateAll();
    }

    if (failedItems.length === 0) {
      toast.success(
        `${QUEUE_FLOW_LABELS[flowType]} procesada para ${processedItemIds.length} ítem(s)`
      );
    } else if (processedItemIds.length > 0) {
      toast.error(
        `Se procesaron ${processedItemIds.length} de ${queuedItems.length} ítems. ${failedItems[0]}`
      );
    } else {
      toast.error(failedItems[0]);
    }

    setProcessingQueueType(null);
  };

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
  const canEditCurrentRequest =
    (isAdmin ||
      request.requestedById === user?.id ||
      (userRole === "administrador_proyecto" &&
        (user as any)?.assignedProjectId === request.projectId)) &&
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
  const canReviewGoodsItems =
    request.requestType === "bienes" &&
    request.status !== "borrador" &&
    request.status !== "cerrada" &&
    request.status !== "anulada" &&
    request.approvalStatus === "pendiente" &&
    canApproveProjectRequests;

  // Check if all items have flow + SAP code for "Send to SAP" button
  const allItemsReady =
    actionableRows.length > 0 &&
    !hasPendingApprovalRows &&
    actionableRows.every(
      (row) =>
        row.remainingQuantity <= 0 &&
        row.assignedFlowTypes.length > 0 &&
        row.hasSapCode
    );

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
                    El Administrador del Proyecto o Administración Central deben aprobar o rechazar antes de continuar a Oficina Central.
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
                    : "Esta requisición está esperando que el Administrador del Proyecto o Administración Central revisen cada ítem antes de habilitar SAP y los flujos."}
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
                Tipo de requisición
              </p>
              <p className="text-sm font-medium mt-1">
                {REQUEST_TYPE_LABELS[request.requestType] || request.requestType}
              </p>
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
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Ítems Solicitados — Asignación de Flujo por Ítem
          </CardTitle>
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
                    Pendiente
                  </th>
                  <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-20">
                    Unidad
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Exist. Proyecto
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Exist. SAP
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Comprometido
                  </th>
                  <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Cant. desp.
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
                  const queuedFlow = editableItem ? queuedFlowByItemId[editableItem.id] : undefined;
                  const queueOptions = getVisibleQueueOptionsForItem();
                  const approvalBadge = getRowApprovalBadge(row);
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
                  const isFlowSelectionLocked =
                    !editableItem || row.remainingQuantity <= 0;
                  const docSapLabels = Array.from(
                    new Set(
                      row.assignedFlowTypes
                        .map((flowType) => SAP_DOC_LABELS[flowType] || flowType)
                        .filter(Boolean)
                    )
                  );

                  return (
                    <tr
                      key={row.key}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="p-3">
                        <p className="font-medium">{item.itemName}</p>
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
                      <td className="p-3 text-right font-mono text-xs">
                        {formatQuantityValue(unresolvedQuantity)}
                      </td>
                      <td className="p-3 text-xs">{item.unit || "—"}</td>
                      <td className="p-3 text-right text-xs">{item.projectStock || "0.00"}</td>
                      <td className="p-3 text-right text-xs">{item.sapStock || "0.00"}</td>
                      <td className="p-3 text-right text-xs">{item.committedQuantity || "0.00"}</td>
                      <td className="p-3 text-right text-xs">{item.dispatchedQuantity || "0.00"}</td>
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
                          disabled={
                            !canManageProcessing ||
                            request.status === "cerrada" ||
                            request.status === "borrador" ||
                            request.status === "anulada" ||
                            !editableItem
                          }
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

                          {row.assignedFlowTypes.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {row.assignedFlowTypes.map((flowType) => (
                                <Badge
                                  key={`${row.key}-${flowType}`}
                                  variant="outline"
                                  className={`text-xs ${FLOW_COLORS[flowType] || ""}`}
                                >
                                  <Check className="mr-1 h-3 w-3" />
                                  {FLOW_LABELS[flowType] || flowType}
                                </Badge>
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

                          {queuedFlow ? (
                            <Badge variant="secondary" className="text-xs">
                              En cola: {QUEUE_FLOW_LABELS[queuedFlow]}
                            </Badge>
                          ) : null}

                          {canManageProcessing &&
                            request.status !== "cerrada" &&
                            request.status !== "borrador" &&
                            request.status !== "anulada" &&
                            request.requestType === "bienes" &&
                            row.pendingApprovalQuantity <= 0 && (
                            <div className="space-y-1.5">
                              <Select
                                value={queuedFlow}
                                onValueChange={(value) => {
                                  if (!editableItem) return;
                                  handleQueuedFlowSelection(editableItem, value);
                                }}
                                disabled={isFlowSelectionLocked}
                              >
                                <SelectTrigger className="h-8 w-full min-w-0 text-xs">
                                  <SelectValue placeholder="Preparar ahora" />
                                </SelectTrigger>
                                <SelectContent align="start">
                                  {queuedFlow ? (
                                    <SelectItem value="__clear__">Quitar de la cola</SelectItem>
                                  ) : null}
                                  {queueOptions.map((flowType) => {
                                    const disabledReason = editableItem
                                      ? getQueueDisabledReason(editableItem, flowType)
                                      : "No hay cantidad pendiente";
                                    return (
                                      <SelectItem
                                        key={`${row.key}-${flowType}`}
                                        value={flowType}
                                        disabled={Boolean(disabledReason) && queuedFlow !== flowType}
                                      >
                                        {QUEUE_FLOW_LABELS[flowType]}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                              {queuedFlow ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => clearQueuedItems([editableItem.id])}
                                  disabled={anyQueueProcessing}
                                >
                                  Quitar de la cola
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

          {canManageProcessing &&
            request.status !== "cerrada" &&
            request.status !== "borrador" &&
            request.status !== "anulada" &&
            request.approvalStatus !== "pendiente" &&
            request.requestType === "bienes" && (
            <div className="border-t border-border bg-muted/5 p-4">
              {queueSections.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  <span>
                    Marca cada ítem con su flujo y aparecerá en la caja correspondiente para procesarlo por lote.
                  </span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-4 w-4 text-primary" />
                    <span>
                      Cada ítem solo puede estar en una caja a la vez. Procesa cada grupo desde su propio botón.
                    </span>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {queueSections.map((flowType) => {
                      const FlowIcon = FLOW_ICONS[flowType] || Package;
                      const queuedGroupItems = queuedItemsByFlow[flowType];

                      return (
                        <Card key={flowType} className="border-border/80 bg-background">
                          <CardHeader className="space-y-3 pb-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
                                  <FlowIcon className="h-4 w-4" />
                                </div>
                                <div>
                                  <CardTitle className="text-base font-semibold">
                                    {QUEUE_FLOW_LABELS[flowType]}
                                  </CardTitle>
                                  <p className="text-xs text-muted-foreground">
                                    {queuedGroupItems.length} ítem(s) listos para procesar
                                  </p>
                                </div>
                              </div>
                              <Badge variant="outline" className={`text-xs ${FLOW_COLORS[flowType] || ""}`}>
                                {queuedGroupItems.length}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {QUEUE_FLOW_DESCRIPTIONS[flowType]}
                            </p>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="overflow-hidden rounded-lg border border-border/70">
                              <table className="w-full table-fixed text-sm">
                                <thead>
                                  <tr className="border-b border-border bg-muted/30">
                                    {flowType === "compra_directa" && (
                                      <th className="p-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Sel.
                                      </th>
                                    )}
                                    <th className="p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Ítem
                                    </th>
                                    <th className="p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Cant.
                                    </th>
                                    {flowType === "compra_directa" && (
                                      <th className="p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Comprar
                                      </th>
                                    )}
                                    <th className="p-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Unidad
                                    </th>
                                    {flowType === "despacho_bodega" && (
                                      <th className="p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Despachar
                                      </th>
                                    )}
                                    <th className="p-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Acción
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {queuedGroupItems.map((item: any) => (
                                    <tr key={`${flowType}-${item.id}`} className="border-b border-border last:border-0">
                                      {flowType === "compra_directa" && (
                                        <td className="p-2 text-center">
                                          <Checkbox
                                            checked={directPurchaseCheckedByItemId[item.id] === true}
                                            onCheckedChange={(checked) =>
                                              setDirectPurchaseCheckedByItemId((current) => ({
                                                ...current,
                                                [item.id]: checked === true,
                                              }))
                                            }
                                            disabled={anyQueueProcessing}
                                          />
                                        </td>
                                      )}
                                      <td className="p-2">
                                        <p className="font-medium">{item.itemName}</p>
                                        <p className="text-[11px] text-muted-foreground">
                                          SAP: {item.sapItemCode || "Pendiente"}
                                        </p>
                                      </td>
                                      <td className="p-2 text-right font-mono">{item.quantity}</td>
                                      {flowType === "compra_directa" && (
                                        <td className="p-2">
                                          <Input
                                            value={
                                              directPurchaseQuantityByItemId[item.id] ??
                                              String(item.quantity ?? "0.00")
                                            }
                                            onChange={(event) =>
                                              setDirectPurchaseQuantityByItemId((current) => ({
                                                ...current,
                                                [item.id]: event.target.value,
                                              }))
                                            }
                                            type="number"
                                            min="0"
                                            step="any"
                                            className="ml-auto h-9 w-28 text-right"
                                            disabled={anyQueueProcessing}
                                          />
                                          <p className="mt-1 text-right text-[10px] text-muted-foreground">
                                            Max: {item.quantity}
                                          </p>
                                        </td>
                                      )}
                                      <td className="p-2 text-xs">{item.unit || "—"}</td>
                                      {flowType === "despacho_bodega" && (
                                        <td className="p-2">
                                          <Input
                                            value={
                                              queuedDispatchQuantities[item.id] ??
                                              String(item.quantity ?? "0.00")
                                            }
                                            onChange={(event) =>
                                              setQueuedDispatchQuantities((current) => ({
                                                ...current,
                                                [item.id]: event.target.value,
                                              }))
                                            }
                                            type="number"
                                            min="0"
                                            step="any"
                                            className="ml-auto h-9 w-28 text-right"
                                          />
                                        </td>
                                      )}
                                      <td className="p-2 text-right">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 px-2 text-xs"
                                          onClick={() => clearQueuedItems([item.id])}
                                          disabled={anyQueueProcessing}
                                        >
                                          Quitar
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {flowType === "compra_directa" && (
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="min-w-0 space-y-2">
                                  <Label className="text-sm font-medium">Método de pago *</Label>
                                  <Select
                                    value={directPurchasePaymentMethod}
                                    onValueChange={setDirectPurchasePaymentMethod}
                                  >
                                    <SelectTrigger className="w-full min-w-0">
                                      <SelectValue placeholder="Seleccione" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="linea_credito">Línea de Crédito</SelectItem>
                                      <SelectItem value="caja_chica">Caja Chica</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="min-w-0 space-y-2">
                                  <Label className="text-sm font-medium">Proveedor *</Label>
                                  <Select
                                    value={directPurchaseSupplierId}
                                    onValueChange={setDirectPurchaseSupplierId}
                                  >
                                    <SelectTrigger className="w-full min-w-0">
                                      <SelectValue placeholder="Seleccione proveedor" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[280px]">
                                      {(suppliersList || []).map((supplier: any) => (
                                        <SelectItem key={supplier.id} value={String(supplier.id)}>
                                          {supplier.supplierCode} — {supplier.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label className="text-sm font-medium">Notas</Label>
                                  <Textarea
                                    value={directPurchaseNotes}
                                    onChange={(event) => setDirectPurchaseNotes(event.target.value)}
                                    placeholder="Observaciones para la compra directa"
                                    rows={3}
                                  />
                                </div>
                                <div className="rounded-lg border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground md:col-span-2">
                                  Marca solo los detalles que quieres incluir en esta orden. También puedes bajar la cantidad para hacer compras parciales; el resto quedará pendiente para volverlo a procesar después.
                                </div>
                              </div>
                            )}

                            {flowType === "despacho_bodega" && (
                              <div className="space-y-2">
                                <Label className="text-sm font-medium">Notas del despacho</Label>
                                <Textarea
                                  value={warehouseExitNotes}
                                  onChange={(event) => setWarehouseExitNotes(event.target.value)}
                                  placeholder="Observaciones para las salidas de bodega seleccionadas"
                                  rows={3}
                                />
                              </div>
                            )}

                            {flowType === "traslado_proyecto" && (
                              <div className="space-y-3">
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Proyecto origen *</Label>
                                  <Select
                                    value={transferSourceProjectId}
                                    onValueChange={setTransferSourceProjectId}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Seleccione proyecto origen" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(projects || [])
                                        .filter((entry: any) => entry.id !== request.projectId)
                                        .map((entry: any) => (
                                          <SelectItem key={entry.id} value={String(entry.id)}>
                                            {entry.code} — {entry.name}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="rounded-lg border border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
                                  Destino: {project ? `${project.code} — ${project.name}` : `Proyecto ${request.projectId}`}
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Notas</Label>
                                  <Textarea
                                    value={transferNotes}
                                    onChange={(event) => setTransferNotes(event.target.value)}
                                    placeholder="Observaciones para el traslado"
                                    rows={3}
                                  />
                                </div>
                              </div>
                            )}

                            {flowType === "solicitud_compra" && (
                              <div className="space-y-3">
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Tipo de compra *</Label>
                                  <Select
                                    value={purchaseRequestType}
                                    onValueChange={setPurchaseRequestType}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Seleccione" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="local">Compra Local</SelectItem>
                                      <SelectItem value="extranjera">Compra Extranjera</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium">Notas</Label>
                                  <Textarea
                                    value={purchaseRequestNotes}
                                    onChange={(event) => setPurchaseRequestNotes(event.target.value)}
                                    placeholder="Observaciones para la solicitud de compra"
                                    rows={3}
                                  />
                                </div>
                              </div>
                            )}

                            <div className="flex justify-end border-t border-border/70 pt-3">
                              <Button
                                onClick={() => void processQueuedFlow(flowType)}
                                disabled={processingQueueType === flowType || anyQueueProcessing}
                              >
                                {processingQueueType === flowType
                                  ? "Procesando..."
                                  : `Procesar ${QUEUE_FLOW_LABELS[flowType].toLowerCase()}`}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status bar below table - ONLY "Enviar a SAP" button here */}
          {canManageProcessing &&
            request.status !== "cerrada" &&
            request.status !== "borrador" &&
            request.status !== "anulada" && (
            <div className="border-t border-border p-3 bg-muted/10 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {hasPendingApprovalRows && (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      Esperando autorización del Administrador del Proyecto o Administración Central para habilitar SAP y los flujos.
                    </span>
                  </>
                )}
                {!hasPendingApprovalRows && !allItemsReady && (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    <span>
                      Asigne flujo y código SAP a todos los ítems para habilitar el envío a SAP
                    </span>
                  </>
                )}
                {allItemsReady && (
                  <>
                    <Check className="h-4 w-4 text-green-600" />
                    <span className="text-green-700 font-medium">
                      Todos los ítems listos. Puede enviar a SAP.
                    </span>
                  </>
                )}
              </div>
              {allItemsReady && (
                <Button
                  onClick={() => sendToSapMutation.mutate({ requestId })}
                  disabled={sendToSapMutation.isPending || anyQueueProcessing}
                  size="sm"
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  {sendToSapMutation.isPending ? "Enviando..." : "Enviar todo a SAP"}
                </Button>
              )}
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
                          Método: {flow.paymentMethod === "linea_credito" ? "Línea de Crédito" : "Caja Chica"}
                        </p>
                      )}
                      {flow.purchaseType && (
                        <p className="text-xs opacity-80">
                          Tipo: {flow.purchaseType === "local" ? "Compra Local" : "Compra Extranjera"}
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

      {/* Attachments */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Archivos Adjuntos
          </CardTitle>
          <div>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              <Upload className="h-4 w-4 mr-1" />
              {uploadMutation.isPending ? "Subiendo..." : "Adjuntar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(attachments || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin archivos adjuntos
            </p>
          ) : (
            <div className="space-y-2">
              {(attachments || []).map((att: any) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between p-2 border border-border rounded"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <a
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium hover:text-primary"
                      >
                        {att.fileName}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {(att.fileSize / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteAttachmentMutation.mutate({ id: att.id })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
