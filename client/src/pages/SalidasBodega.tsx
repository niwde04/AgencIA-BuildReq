import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  Check,
  ChevronsUpDown,
  Eye,
  PackageMinus,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Send,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  emitida: "border-blue-300 bg-blue-50 text-blue-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};

const RETURN_REASON_LABELS: Record<string, string> = {
  material_defectuoso: "Material defectuoso",
  excedente: "Excedente",
  error_pedido: "Error de pedido",
  cambio_especificacion: "Cambio de especificación",
  otro: "Otro",
};

const RETURN_CONDITION_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  usado_buen_estado: "Usado - Buen estado",
  defectuoso: "Defectuoso",
  danado: "Dañado",
};

type DeliveryTargetSelection =
  | {
      targetType: "subproyecto";
      subProjectId: number;
      projectId: number;
      label: string;
    }
  | {
      targetType: "activo_fijo";
      projectId: number;
      fixedAssetSapItemCode: string;
      fixedAssetName: string;
      label: string;
    };

function buildSubprojectDeliveryTargetSelection(
  subproject: any
): DeliveryTargetSelection {
  return {
    targetType: "subproyecto",
    subProjectId: subproject.id,
    projectId: subproject.projectId,
    label: `Subproyecto: ${subproject.code} - ${subproject.name}`,
  };
}

function buildFixedAssetDeliveryTargetSelection(
  asset: any
): DeliveryTargetSelection {
  return {
    targetType: "activo_fijo",
    projectId: asset.projectId,
    fixedAssetSapItemCode: asset.itemCode,
    fixedAssetName: asset.description,
    label: `Activo fijo: ${asset.itemCode} - ${asset.description}`,
  };
}

function mapWarehouseExitLineTargetToSelection(
  item: any,
  projectId?: number | null
): DeliveryTargetSelection | null {
  const target = item?.target;
  if (target?.type === "subproyecto" && target.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: target.subProjectId,
      projectId: target.projectId ?? projectId ?? item?.projectId ?? 0,
      label: target.label ?? `Subproyecto #${target.subProjectId}`,
    };
  }

  if (target?.type === "activo_fijo" && target.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      projectId: target.projectId ?? projectId ?? item?.projectId ?? 0,
      fixedAssetSapItemCode: target.fixedAssetSapItemCode,
      fixedAssetName: target.fixedAssetName ?? "",
      label: target.label ?? `Activo fijo: ${target.fixedAssetSapItemCode}`,
    };
  }

  if (item?.targetType === "subproyecto" && item.subProjectId) {
    const subproject = item.subproject;
    const subprojectLabel = subproject
      ? `${subproject.code} - ${subproject.name}`
      : `Subproyecto #${item.subProjectId}`;
    return {
      targetType: "subproyecto",
      subProjectId: item.subProjectId,
      projectId: projectId ?? item.projectId ?? subproject?.projectId ?? 0,
      label: `Subproyecto: ${subprojectLabel}`,
    };
  }

  if (item?.targetType === "activo_fijo" && item.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      projectId: projectId ?? item.projectId ?? 0,
      fixedAssetSapItemCode: item.fixedAssetSapItemCode,
      fixedAssetName: item.fixedAssetName ?? "",
      label: item.fixedAssetName
        ? `Activo fijo: ${item.fixedAssetSapItemCode} - ${item.fixedAssetName}`
        : `Activo fijo: ${item.fixedAssetSapItemCode}`,
    };
  }

  return null;
}

function getDeliveryTargetPayload(selection: DeliveryTargetSelection | null) {
  if (!selection) {
    return {
      targetType: null,
      subProjectId: null,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  if (selection.targetType === "subproyecto") {
    return {
      targetType: "subproyecto" as const,
      subProjectId: selection.subProjectId,
      fixedAssetSapItemCode: null,
      fixedAssetName: null,
    };
  }

  return {
    targetType: "activo_fijo" as const,
    subProjectId: null,
    fixedAssetSapItemCode: selection.fixedAssetSapItemCode,
    fixedAssetName: selection.fixedAssetName,
  };
}

function formatWarehouseExitTargetLabel(item: any, projectId?: number | null) {
  return mapWarehouseExitLineTargetToSelection(item, projectId)?.label ?? null;
}

function formatWarehouseExitWarehouseLabel(detail: any) {
  const directWarehouse =
    detail?.warehouse?.displayName || detail?.warehouse?.name || null;
  if (directWarehouse) return directWarehouse;

  const itemWarehouseLabels = Array.from(
    new Set(
      (detail?.items || [])
        .map(
          (item: any) => item.warehouse?.displayName || item.warehouse?.name || null
        )
        .filter(Boolean)
    )
  );

  if (itemWarehouseLabels.length === 1) return itemWarehouseLabels[0] as string;
  if (itemWarehouseLabels.length > 1) return "Varios almacenes";
  return "Bodega del proyecto";
}

function formatWarehouseExitDestinationProjectLabel(detail: any) {
  if (detail?.destinationProject) {
    return `${detail.destinationProject.code} - ${detail.destinationProject.name}`;
  }

  const itemProjectLabels = Array.from(
    new Set(
      (detail?.items || [])
        .map((item: any) =>
          item.destinationProject
            ? `${item.destinationProject.code} - ${item.destinationProject.name}`
            : null
        )
        .filter(Boolean)
    )
  );

  if (itemProjectLabels.length === 1) return itemProjectLabels[0] as string;
  if (itemProjectLabels.length > 1) return "Varios destinos";
  if (detail?.warehouseExit?.destinationProjectId) {
    return `Proyecto ${detail.warehouseExit.destinationProjectId}`;
  }
  return "-";
}

function formatWarehouseExitDestinationWarehouseLabel(detail: any) {
  const directWarehouse =
    detail?.destinationWarehouse?.displayName ||
    detail?.destinationWarehouse?.name ||
    null;
  if (directWarehouse) return directWarehouse;

  const itemWarehouseLabels = Array.from(
    new Set(
      (detail?.items || [])
        .map(
          (item: any) =>
            item.destinationWarehouse?.displayName ||
            item.destinationWarehouse?.name ||
            null
        )
        .filter(Boolean)
    )
  );

  if (itemWarehouseLabels.length === 1) return itemWarehouseLabels[0] as string;
  if (itemWarehouseLabels.length > 1) return "Varios destinos";
  if (detail?.warehouseExit?.destinationWarehouseId) {
    return `Almacén ${detail.warehouseExit.destinationWarehouseId}`;
  }
  return "-";
}

function formatWarehouseExitItemDestinationLabel(item: any) {
  const projectLabel = item.destinationProject
    ? `${item.destinationProject.code} - ${item.destinationProject.name}`
    : item.destinationProjectId
      ? `Proyecto ${item.destinationProjectId}`
      : "";
  const warehouseLabel =
    item.destinationWarehouse?.displayName ||
    item.destinationWarehouse?.name ||
    (item.destinationWarehouseId ? `Almacén ${item.destinationWarehouseId}` : "");

  if (!projectLabel && !warehouseLabel) return "-";
  return [projectLabel || "Bodega/proyecto", warehouseLabel || "Almacén"]
    .filter(Boolean)
    .join(" / ");
}

function formatWarehouseExitRequestLabel(detail: any) {
  const requestNumber =
    detail?.materialRequest?.requestNumber ||
    (detail?.warehouseExit?.materialRequestId
      ? `REQ-${detail.warehouseExit.materialRequestId}`
      : null);
  const requesterName = detail?.requestedBy?.name || null;
  if (requestNumber && requesterName) return `${requestNumber} - ${requesterName}`;
  return requestNumber || requesterName || "-";
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

function formatPrintDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return numberValue.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function QuantityPill({
  value,
  unit,
  label = "Disp.",
  tone = "available",
}: {
  value: string | number | null | undefined;
  unit?: string | null;
  label?: string;
  tone?: "available" | "neutral" | "danger";
}) {
  const toneClasses = {
    available: "border-emerald-200 bg-emerald-50 text-emerald-700",
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    danger: "border-rose-200 bg-rose-50 text-rose-700",
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold ${toneClasses}`}
    >
      {label} {formatQuantity(value)}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

function getDeliveryScopeKey(projectId?: number | null, warehouseId?: number | null) {
  return `${Number(projectId ?? 0)}:${Number(warehouseId ?? 0)}`;
}

function getStockWarehouseLabel(option: any): string {
  return (
    option?.displayName ||
    option?.warehouseDisplayName ||
    option?.warehouseName ||
    `Almacén #${option?.warehouseId ?? ""}`.trim()
  );
}

function getStockProjectLabel(option: any): string {
  return (
    [option?.projectCode, option?.projectName].filter(Boolean).join(" - ") ||
    "Proyecto/bodega"
  );
}

function getProjectOptionLabel(project: any): string {
  return (
    [project?.code, project?.name].filter(Boolean).join(" - ") ||
    `Proyecto #${project?.id ?? ""}`.trim()
  );
}

function formatPrintNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function parseEditableQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const normalized =
    typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(normalized) ? normalized : Number.NaN;
}

function getPhysicalDispatchedQuantity(item: any) {
  return Math.max(
    parseQuantity(item.physicalDispatchedQuantity ?? item.dispatchedQuantity),
    0
  );
}

function getDeliveryPendingQuantity(item: any) {
  const requestedQuantity = Math.max(parseQuantity(item.quantity), 0);
  const alreadyDispatched = getPhysicalDispatchedQuantity(item);
  const receivedQuantity = Math.min(
    Math.max(parseQuantity(item.deliveredQuantity), 0),
    requestedQuantity
  );
  const dispatchableQuantity =
    item.assignedFlow === "despacho_bodega" ? requestedQuantity : receivedQuantity;

  return Math.max(dispatchableQuantity - alreadyDispatched, 0);
}

function getSuggestedDeliveryQuantity(item: any) {
  return Math.min(
    getDeliveryPendingQuantity(item),
    Math.max(parseQuantity(item.projectStock), 0)
  );
}

export default function SalidasBodega() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [returnPanelOpen, setReturnPanelOpen] = useState(false);
  const [returnReasonCategory, setReturnReasonCategory] = useState("error_pedido");
  const [returnJustification, setReturnJustification] = useState("");
  const [returnReceivedByName, setReturnReceivedByName] = useState("");
  const [returnQuantityByItemId, setReturnQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [returnConditionByItemId, setReturnConditionByItemId] = useState<
    Record<number, string>
  >({});
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [deliveryRequestId, setDeliveryRequestId] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryReceivedByName, setDeliveryReceivedByName] = useState("");
  const [deliveryQuantityByItemId, setDeliveryQuantityByItemId] = useState<
    Record<number, string>
  >({});
  const [deliveryWarehouseByItemId, setDeliveryWarehouseByItemId] = useState<
    Record<number, string>
  >({});
  const [deliveryProjectByItemId, setDeliveryProjectByItemId] = useState<
    Record<number, string>
  >({});
  const [
    deliveryDestinationWarehouseByItemId,
    setDeliveryDestinationWarehouseByItemId,
  ] = useState<Record<number, string>>({});
  const [
    deliveryDestinationProjectByItemId,
    setDeliveryDestinationProjectByItemId,
  ] = useState<Record<number, string>>({});
  const [
    deliveryDestinationWarehouseTouchedByItemId,
    setDeliveryDestinationWarehouseTouchedByItemId,
  ] = useState<Record<number, boolean>>({});
  const [deliveryTargetByItemId, setDeliveryTargetByItemId] = useState<
    Record<number, DeliveryTargetSelection | null>
  >({});
  const [deliveryTargetPopoverOpen, setDeliveryTargetPopoverOpen] = useState<
    number | null
  >(null);
  const [deliveryTargetSearch, setDeliveryTargetSearch] = useState("");
  const [draftReceivedByName, setDraftReceivedByName] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftItemEdits, setDraftItemEdits] = useState<
    Record<number, { quantity: string; notes: string }>
  >({});

  const { data: exits, isLoading } = trpc.warehouseExits.list.useQuery();
  const canCreateReturns =
    user?.role === "admin" || (user as any)?.buildreqRole === "jefe_bodega_central";
  const { data: materialRequests } = trpc.materialRequests.list.useQuery({
    requestType: "bienes",
  });
  const { data: deliveryDestinationProjects } = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: deliveryDialogOpen }
  );
  const { data: deliveryRequestDetail } =
    trpc.materialRequests.getById.useQuery(
      { id: Number(deliveryRequestId || 0) },
      { enabled: deliveryDialogOpen && Boolean(deliveryRequestId) }
    );
  const { data: deliveryTargetOptions, isLoading: deliveryTargetOptionsLoading } =
    trpc.materialRequests.targetOptions.useQuery(
      {
        projectId: deliveryRequestDetail?.request.projectId ?? 0,
        search: deliveryTargetSearch.trim() || undefined,
      },
      {
        enabled:
          deliveryDialogOpen &&
          Boolean(deliveryRequestDetail?.request.projectId),
      }
    );
  const { data: detail } = trpc.warehouseExits.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );
  const emitMutation = trpc.warehouseExits.emit.useMutation({
    onSuccess: (result) => {
      toast.success(`Salida ${result.exitNumber} emitida`);
      const affectedRequestIds = result.materialRequestIds ?? [];
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.materialRequests.list.invalidate(),
        ...affectedRequestIds.map((id: number) =>
          utils.materialRequests.getById.invalidate({ id })
        ),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
        utils.inventory.list.invalidate(),
        utils.inventory.projectStockForItems.invalidate(),
        utils.inventory.visibleWarehouseStockForItems.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const createDeliveryMutation = trpc.requestItems.recordWarehouseExitBatch.useMutation({
    onSuccess: (result) => {
      const requestIdToInvalidate = Number(deliveryRequestId || 0);
      toast.success(`Salida ${result.exitNumber} creada en borrador`);
      setDeliveryDialogOpen(false);
      setDeliveryRequestId("");
      setDeliveryNotes("");
      setDeliveryReceivedByName("");
      setDeliveryQuantityByItemId({});
      setDeliveryWarehouseByItemId({});
      setDeliveryProjectByItemId({});
      setDeliveryDestinationWarehouseByItemId({});
      setDeliveryDestinationProjectByItemId({});
      setDeliveryDestinationWarehouseTouchedByItemId({});
      setDeliveryTargetByItemId({});
      setDeliveryTargetPopoverOpen(null);
      setDeliveryTargetSearch("");
      setSelectedId(result.id);
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        utils.materialRequests.list.invalidate(),
        requestIdToInvalidate
          ? utils.materialRequests.getById.invalidate({ id: requestIdToInvalidate })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelMutation = trpc.warehouseExits.cancelDraft.useMutation({
    onSuccess: () => {
      toast.success("Borrador de salida anulado");
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const updateDraftMutation = trpc.warehouseExits.updateDraft.useMutation({
    onSuccess: () => {
      toast.success("Borrador actualizado");
      void Promise.all([
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const createReturnMutation = trpc.reverseLogistics.create.useMutation({
    onSuccess: (result: any) => {
      toast.success(`Devolución ${result.returnNumber} registrada`);
      setReturnPanelOpen(false);
      setReturnJustification("");
      setReturnReceivedByName("");
      setReturnQuantityByItemId({});
      setReturnConditionByItemId({});
      void Promise.all([
        utils.reverseLogistics.list.invalidate(),
        utils.warehouseExits.list.invalidate(),
        selectedId
          ? utils.warehouseExits.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
        utils.inventory.list.invalidate(),
        utils.supplyFlows.pendingQueue.invalidate(),
        utils.supplyFlows.list.invalidate(),
        utils.materialRequests.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const getDeliveryDestinationWarehouseOptions = useCallback(
    (projectId?: number | null) => {
      if (!projectId) return [];
      const project = (deliveryDestinationProjects ?? []).find(
        (entry: any) => Number(entry.id) === Number(projectId)
      );
      const assignedWarehouses = Array.isArray(project?.warehouses)
        ? project.warehouses
        : [];
      const warehouses =
        assignedWarehouses.length > 0
          ? assignedWarehouses
          : [project?.defaultWarehouse, project?.warehouse].filter(Boolean);
      const byId = new Map<number, any>();
      for (const warehouse of warehouses) {
        if (!warehouse?.id || byId.has(Number(warehouse.id))) continue;
        byId.set(Number(warehouse.id), warehouse);
      }
      return Array.from(byId.values());
    },
    [deliveryDestinationProjects]
  );
  const deliveryDestinationWarehouseOptions = useMemo(
    () =>
      Array.from(
        (deliveryDestinationProjects ?? []).reduce((byId: Map<number, any>, project: any) => {
          for (const warehouse of getDeliveryDestinationWarehouseOptions(
            Number(project.id)
          )) {
            if (!warehouse?.id || byId.has(Number(warehouse.id))) continue;
            byId.set(Number(warehouse.id), warehouse);
          }
          return byId;
        }, new Map<number, any>())
      )
        .map(([, warehouse]) => warehouse)
        .sort((left: any, right: any) =>
          getStockWarehouseLabel(left).localeCompare(getStockWarehouseLabel(right))
        ),
    [deliveryDestinationProjects, getDeliveryDestinationWarehouseOptions]
  );
  const getDeliveryDestinationProjectOptions = useCallback(
    (warehouseId?: number | null) => {
      if (!warehouseId) return [];
      return (deliveryDestinationProjects ?? [])
        .filter((project: any) =>
          getDeliveryDestinationWarehouseOptions(Number(project.id)).some(
            (warehouse: any) => Number(warehouse.id) === Number(warehouseId)
          )
        )
        .sort((left: any, right: any) =>
          getProjectOptionLabel(left).localeCompare(getProjectOptionLabel(right))
        );
    },
    [deliveryDestinationProjects, getDeliveryDestinationWarehouseOptions]
  );

  const resetReturnPanel = () => {
    setReturnPanelOpen(false);
    setReturnReasonCategory("error_pedido");
    setReturnJustification("");
    setReturnReceivedByName("");
    setReturnQuantityByItemId({});
    setReturnConditionByItemId({});
  };

  useEffect(() => {
    if (!deliveryRequestDetail) {
      setDeliveryDestinationWarehouseByItemId({});
      setDeliveryDestinationProjectByItemId({});
      setDeliveryDestinationWarehouseTouchedByItemId({});
      return;
    }
  }, [deliveryRequestDetail?.request.id]);

  useEffect(() => {
    if (
      !deliveryDialogOpen ||
      !deliveryRequestDetail ||
      !deliveryDestinationProjects
    ) {
      return;
    }

    let changed = false;
    const nextDestinationWarehouses = {
      ...deliveryDestinationWarehouseByItemId,
    };
    const nextDestinationProjects = {
      ...deliveryDestinationProjectByItemId,
    };
    const requestProjectId = Number(deliveryRequestDetail.request.projectId ?? 0);
    const pendingDeliveryItems = (deliveryRequestDetail.items ?? []).filter(
      (item: any) => getDeliveryPendingQuantity(item) > 0
    );

    for (const item of pendingDeliveryItems) {
      const currentProjectId = Number(
        nextDestinationProjects[item.id] || requestProjectId || 0
      );
      const currentWarehouseId = Number(
        nextDestinationWarehouses[item.id] || 0
      );
      const originWarehouseId = Number(deliveryWarehouseByItemId[item.id] ?? 0);
      const projectOptionsForWarehouse =
        getDeliveryDestinationProjectOptions(currentWarehouseId);
      const currentWarehouseIsValid =
        currentWarehouseId > 0 &&
        projectOptionsForWarehouse.some(
          (project: any) => Number(project.id) === currentProjectId
        );
      const warehouseOptions =
        getDeliveryDestinationWarehouseOptions(currentProjectId);
      const originWarehouseOption =
        originWarehouseId > 0
          ? warehouseOptions.find(
              (warehouse: any) => Number(warehouse.id) === originWarehouseId
            )
          : null;
      const destinationWarehouseWasTouched = Boolean(
        deliveryDestinationWarehouseTouchedByItemId[item.id]
      );

      if (
        currentProjectId &&
        currentWarehouseIsValid &&
        (destinationWarehouseWasTouched ||
          !originWarehouseOption ||
          currentWarehouseId === originWarehouseId)
      ) {
        if ((nextDestinationProjects[item.id] ?? "") !== String(currentProjectId)) {
          nextDestinationProjects[item.id] = String(currentProjectId);
          changed = true;
        }
        continue;
      }

      const preferredWarehouse =
        originWarehouseOption ??
        warehouseOptions.find((warehouse: any) => warehouse.isPrimary) ??
        warehouseOptions[0] ??
        null;
      const nextProjectValue =
        currentProjectId > 0 ? String(currentProjectId) : "";
      const nextWarehouseValue = preferredWarehouse?.id
        ? String(preferredWarehouse.id)
        : "";

      if (
        (nextDestinationProjects[item.id] ?? "") !== nextProjectValue ||
        (nextDestinationWarehouses[item.id] ?? "") !== nextWarehouseValue
      ) {
        nextDestinationProjects[item.id] = nextProjectValue;
        nextDestinationWarehouses[item.id] = nextWarehouseValue;
        changed = true;
      }
    }

    if (changed) {
      setDeliveryDestinationProjectByItemId(nextDestinationProjects);
      setDeliveryDestinationWarehouseByItemId(nextDestinationWarehouses);
    }
  }, [
    deliveryDestinationProjectByItemId,
    deliveryDestinationProjects,
    deliveryDestinationWarehouseTouchedByItemId,
    deliveryDestinationWarehouseByItemId,
    deliveryWarehouseByItemId,
    deliveryDialogOpen,
    deliveryRequestDetail,
    getDeliveryDestinationProjectOptions,
    getDeliveryDestinationWarehouseOptions,
  ]);

  useEffect(() => {
    if (!detail || detail.warehouseExit.status !== "borrador") {
      setDraftReceivedByName("");
      setDraftNotes("");
      setDraftItemEdits({});
      return;
    }

    setDraftReceivedByName(detail.warehouseExit.receivedByName ?? "");
    setDraftNotes(detail.warehouseExit.notes ?? "");
    setDraftItemEdits(
      Object.fromEntries(
        detail.items.map((item: any) => [
          item.id,
          {
            quantity: Number(item.quantity ?? 0).toFixed(2),
            notes: item.notes ?? "",
          },
        ])
      )
    );
  }, [detail]);

  useEffect(() => {
    if (!deliveryRequestDetail) {
      setDeliveryQuantityByItemId({});
      setDeliveryWarehouseByItemId({});
      setDeliveryProjectByItemId({});
      setDeliveryDestinationWarehouseByItemId({});
      setDeliveryDestinationProjectByItemId({});
      setDeliveryDestinationWarehouseTouchedByItemId({});
      setDeliveryTargetByItemId({});
      return;
    }

    const nextQuantities: Record<number, string> = {};
    const nextWarehouses: Record<number, string> = {};
    const nextProjects: Record<number, string> = {};
    const nextDestinationWarehouses: Record<number, string> = {};
    const nextDestinationProjects: Record<number, string> = {};
    const nextTargets: Record<number, DeliveryTargetSelection | null> = {};
    for (const item of deliveryRequestDetail.items || []) {
      const suggestedQuantity = getSuggestedDeliveryQuantity(item);
      if (suggestedQuantity > 0) {
        const itemWarehouseId = Number(item.warehouseId ?? 0);
        const transferSourceWarehouseId = Number(
          item.transferSourceWarehouseId ?? 0
        );
        const transferSourceProjectId = Number(
          item.transferSourceProjectId ?? 0
        );
        const requestProjectId = Number(
          deliveryRequestDetail.request.projectId ?? 0
        );
        const transferReceiptProjectId = Number(
          item.transferReceiptProjectId ?? 0
        );
        const transferReceiptWarehouseId = Number(
          item.transferReceiptWarehouseId ?? 0
        );
        const isSameTransferOriginScope =
          itemWarehouseId > 0 &&
          itemWarehouseId === transferSourceWarehouseId &&
          (!transferSourceProjectId ||
            transferSourceProjectId === requestProjectId);
        nextQuantities[item.id] = suggestedQuantity.toFixed(2);
        nextWarehouses[item.id] =
          transferReceiptWarehouseId > 0
            ? String(transferReceiptWarehouseId)
            : itemWarehouseId > 0 && !isSameTransferOriginScope
              ? String(itemWarehouseId)
              : "";
        nextProjects[item.id] =
          transferReceiptProjectId > 0
            ? String(transferReceiptProjectId)
            : requestProjectId > 0
              ? String(requestProjectId)
              : "";
        nextDestinationProjects[item.id] =
          requestProjectId > 0 ? String(requestProjectId) : "";
        nextDestinationWarehouses[item.id] = "";
        nextTargets[item.id] = mapWarehouseExitLineTargetToSelection(
          item,
          deliveryRequestDetail.request.projectId
        );
      }
    }
    setDeliveryQuantityByItemId(nextQuantities);
    setDeliveryWarehouseByItemId(nextWarehouses);
    setDeliveryProjectByItemId(nextProjects);
    setDeliveryDestinationWarehouseByItemId(nextDestinationWarehouses);
    setDeliveryDestinationProjectByItemId(nextDestinationProjects);
    setDeliveryDestinationWarehouseTouchedByItemId({});
    setDeliveryTargetByItemId(nextTargets);
  }, [deliveryRequestDetail?.request.id]);

  const eligibleMaterialRequests = useMemo(
    () =>
      (materialRequests ?? []).filter((row: any) => {
        return (
          row.request.requestType === "bienes" &&
          ["flujo_completado", "parcialmente_atendida"].includes(row.request.status)
        );
      }),
    [materialRequests]
  );

  const deliveryItems = useMemo(
    () =>
      (deliveryRequestDetail?.items ?? []).filter(
        (item: any) => getDeliveryPendingQuantity(item) > 0
      ),
    [deliveryRequestDetail?.items]
  );
  const deliveryStockItems = useMemo(
    () =>
      deliveryItems.map((item: any) => ({
        id: item.id,
        sapItemCode: item.sapItemCode || null,
        itemName: item.itemName || "",
      })),
    [deliveryItems]
  );
  const { data: deliveryStockRows } =
    trpc.inventory.visibleWarehouseStockForItems.useQuery(
    {
      includeQuantities: true,
      items: deliveryStockItems,
    },
    {
      enabled:
        deliveryDialogOpen &&
        deliveryStockItems.length > 0,
    }
  );
  const deliveryScopeStockByItemId = useMemo<Map<number, Map<string, any>>>(
    () =>
      new Map<number, Map<string, any>>(
        (deliveryStockRows ?? []).map((row: any) => [
          Number(row.itemId),
          new Map<string, any>(
            (row.warehouses ?? []).map((warehouse: any) => [
              getDeliveryScopeKey(warehouse.projectId, warehouse.warehouseId),
              warehouse,
            ])
          ),
        ])
      ),
    [deliveryStockRows]
  );
  const getDeliveryBlockedWarehouseId = useCallback((item: any) => {
    const warehouseId = Number(item.transferSourceWarehouseId ?? 0);
    return Number.isFinite(warehouseId) && warehouseId > 0 ? warehouseId : null;
  }, []);
  const getDeliveryStockOptions = useCallback(
    (item: any) =>
      Array.from(deliveryScopeStockByItemId.get(item.id)?.values() ?? [])
        .filter(
          (option: any) =>
            Number(option.projectId) > 0 && Number(option.warehouseId) > 0
        )
        .sort(
          (left: any, right: any) =>
            getStockWarehouseLabel(left).localeCompare(
              getStockWarehouseLabel(right)
            ) ||
            getStockProjectLabel(left).localeCompare(getStockProjectLabel(right))
        ),
    [deliveryScopeStockByItemId]
  );
  const isDeliveryScopeBlocked = useCallback(
    (item: any, projectId: number, warehouseId: number) => {
      const blockedWarehouseId = getDeliveryBlockedWarehouseId(item);
      const sourceProjectId = Number(item.transferSourceProjectId ?? 0);
      return Boolean(
        blockedWarehouseId &&
          Number(warehouseId) === blockedWarehouseId &&
          (!sourceProjectId || sourceProjectId === Number(projectId))
      );
    },
    [getDeliveryBlockedWarehouseId]
  );
  const getDeliveryScopeAvailableQuantity = useCallback(
    (item: any, projectId: number, warehouseId: number) => {
      if (
        !projectId ||
        !warehouseId ||
        isDeliveryScopeBlocked(item, projectId, warehouseId)
      ) {
        return 0;
      }
      const scope = deliveryScopeStockByItemId
        .get(item.id)
        ?.get(getDeliveryScopeKey(projectId, warehouseId));
      return Number(scope?.quantity ?? 0);
    },
    [deliveryScopeStockByItemId, isDeliveryScopeBlocked]
  );
  const getDeliveryScopeStockQuantity = useCallback(
    (item: any, projectId: number, warehouseId: number) => {
      if (!projectId || !warehouseId) return 0;
      const scope = deliveryScopeStockByItemId
        .get(item.id)
        ?.get(getDeliveryScopeKey(projectId, warehouseId));
      return Number(scope?.quantity ?? 0);
    },
    [deliveryScopeStockByItemId]
  );
  const getDeliveryWarehouseOptions = useCallback(
    (item: any) => {
      const byWarehouse = new Map<number, any>();
      for (const option of getDeliveryStockOptions(item)) {
        const warehouseId = Number(option.warehouseId);
        const projectId = Number(option.projectId);
        if (!warehouseId || !projectId) continue;
        const quantity = isDeliveryScopeBlocked(item, projectId, warehouseId)
          ? 0
          : Number(option.quantity ?? 0);
        const current = byWarehouse.get(warehouseId);
        if (!current) {
          byWarehouse.set(warehouseId, {
            ...option,
            quantity,
          });
          continue;
        }
        byWarehouse.set(warehouseId, {
          ...current,
          quantity: Number(current.quantity ?? 0) + quantity,
        });
      }

      return Array.from(byWarehouse.values()).sort((left, right) =>
        getStockWarehouseLabel(left).localeCompare(getStockWarehouseLabel(right))
      );
    },
    [getDeliveryStockOptions, isDeliveryScopeBlocked]
  );
  const getDeliveryProjectOptions = useCallback(
    (item: any, warehouseId?: number | null) => {
      if (!warehouseId) return [];
      return getDeliveryStockOptions(item)
        .filter((option: any) => Number(option.warehouseId) === warehouseId)
        .sort((left: any, right: any) =>
          getStockProjectLabel(left).localeCompare(getStockProjectLabel(right))
        );
    },
    [getDeliveryStockOptions]
  );
  const setDeliverySourceForItem = useCallback(
    (item: any, projectId: number, warehouseId: number) => {
      const availableQuantity = getDeliveryScopeAvailableQuantity(
        item,
        projectId,
        warehouseId
      );
      const nextQuantity = Math.min(
        getDeliveryPendingQuantity(item),
        Math.max(availableQuantity, 0)
      );

      setDeliveryWarehouseByItemId((current) => ({
        ...current,
        [item.id]: String(warehouseId),
      }));
      setDeliveryProjectByItemId((current) => ({
        ...current,
        [item.id]: String(projectId),
      }));
      setDeliveryQuantityByItemId((current) => ({
        ...current,
        [item.id]: nextQuantity > 0 ? nextQuantity.toFixed(2) : "0.00",
      }));
    },
    [getDeliveryScopeAvailableQuantity]
  );
  const clearDeliveryProjectForItem = useCallback((item: any, warehouseId: number) => {
    setDeliveryWarehouseByItemId((current) => ({
      ...current,
      [item.id]: String(warehouseId),
    }));
    setDeliveryProjectByItemId((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeliveryQuantityByItemId((current) => ({
      ...current,
      [item.id]: "0.00",
    }));
  }, []);
  const handleDeliveryWarehouseChange = useCallback(
    (item: any, value: string) => {
      const warehouseId = Number(value);
      const projectOptions = getDeliveryProjectOptions(item, warehouseId);
      const selectedProjectId = Number(deliveryProjectByItemId[item.id] ?? 0);
      const selectedProjectStillValid =
        selectedProjectId > 0 &&
        projectOptions.some(
          (option: any) =>
            Number(option.projectId) === selectedProjectId &&
            !isDeliveryScopeBlocked(item, selectedProjectId, warehouseId)
        );

      if (selectedProjectStillValid) {
        setDeliverySourceForItem(item, selectedProjectId, warehouseId);
        return;
      }

      const bestProjectOption =
        [...projectOptions]
          .filter(
            (option: any) =>
              !isDeliveryScopeBlocked(
                item,
                Number(option.projectId),
                warehouseId
              ) && Number(option.quantity ?? 0) > 0
          )
          .sort(
            (left: any, right: any) =>
              Number(right.quantity ?? 0) - Number(left.quantity ?? 0)
          )[0] ?? projectOptions[0];

      if (bestProjectOption?.projectId) {
        setDeliverySourceForItem(
          item,
          Number(bestProjectOption.projectId),
          warehouseId
        );
        return;
      }

      clearDeliveryProjectForItem(item, warehouseId);
    },
    [
      clearDeliveryProjectForItem,
      deliveryProjectByItemId,
      getDeliveryProjectOptions,
      isDeliveryScopeBlocked,
      setDeliverySourceForItem,
    ]
  );
  const handleDeliveryProjectChange = useCallback(
    (item: any, value: string) => {
      const projectId = Number(value);
      const warehouseId = Number(deliveryWarehouseByItemId[item.id] ?? 0);
      if (!projectId || !warehouseId) return;
      setDeliverySourceForItem(item, projectId, warehouseId);
    },
    [deliveryWarehouseByItemId, setDeliverySourceForItem]
  );
  const handleDeliveryDestinationWarehouseChange = useCallback(
    (item: any, value: string) => {
      const warehouseId = Number(value);
      if (!warehouseId) return;

      const projectOptions =
        getDeliveryDestinationProjectOptions(warehouseId);
      const selectedProjectId = Number(
        deliveryDestinationProjectByItemId[item.id] ?? 0
      );
      const selectedProjectStillValid =
        selectedProjectId > 0 &&
        projectOptions.some(
          (project: any) => Number(project.id) === selectedProjectId
        );
      const requestProjectId = Number(
        deliveryRequestDetail?.request.projectId ?? 0
      );
      const preferredProject =
        projectOptions.find(
          (project: any) => Number(project.id) === requestProjectId
        ) ??
        projectOptions[0] ??
        null;
      const nextProjectId = selectedProjectStillValid
        ? selectedProjectId
        : Number(preferredProject?.id ?? 0);

      setDeliveryDestinationWarehouseByItemId((current) => ({
        ...current,
        [item.id]: String(warehouseId),
      }));
      setDeliveryDestinationWarehouseTouchedByItemId((current) => ({
        ...current,
        [item.id]: true,
      }));
      setDeliveryDestinationProjectByItemId((current) => {
        if (!nextProjectId) {
          const next = { ...current };
          delete next[item.id];
          return next;
        }
        return {
          ...current,
          [item.id]: String(nextProjectId),
        };
      });
    },
    [
      deliveryDestinationProjectByItemId,
      deliveryRequestDetail?.request.projectId,
      getDeliveryDestinationProjectOptions,
    ]
  );
  const handleDeliveryDestinationProjectChange = useCallback(
    (item: any, value: string) => {
      const projectId = Number(value);
      if (!projectId) return;

      const warehouseOptions = getDeliveryDestinationWarehouseOptions(projectId);
      const currentWarehouseId = Number(
        deliveryDestinationWarehouseByItemId[item.id] ?? 0
      );
      const originWarehouseId = Number(deliveryWarehouseByItemId[item.id] ?? 0);
      const currentWarehouseIsValid = warehouseOptions.some(
        (warehouse: any) => Number(warehouse.id) === currentWarehouseId
      );
      const originWarehouseOption =
        originWarehouseId > 0
          ? warehouseOptions.find(
              (warehouse: any) => Number(warehouse.id) === originWarehouseId
            )
          : null;
      const currentWarehouseOption = warehouseOptions.find(
        (warehouse: any) => Number(warehouse.id) === currentWarehouseId
      );
      const destinationWarehouseWasTouched = Boolean(
        deliveryDestinationWarehouseTouchedByItemId[item.id]
      );
      const preferredWarehouse =
        destinationWarehouseWasTouched && currentWarehouseIsValid
          ? currentWarehouseOption
          : originWarehouseOption ??
            (currentWarehouseIsValid ? currentWarehouseOption : null) ??
            warehouseOptions.find((warehouse: any) => warehouse.isPrimary) ??
            warehouseOptions[0] ??
            null;

      setDeliveryDestinationProjectByItemId((current) => ({
        ...current,
        [item.id]: String(projectId),
      }));
      setDeliveryDestinationWarehouseByItemId((current) => {
        if (!preferredWarehouse?.id) {
          const next = { ...current };
          delete next[item.id];
          return next;
        }
        return {
          ...current,
          [item.id]: String(preferredWarehouse.id),
        };
      });
    },
    [
      deliveryDestinationWarehouseByItemId,
      deliveryDestinationWarehouseTouchedByItemId,
      deliveryWarehouseByItemId,
      getDeliveryDestinationWarehouseOptions,
    ]
  );
  const getSuggestedDeliveryScope = useCallback(
    (item: any) => {
      const pendingQuantity = getDeliveryPendingQuantity(item);
      const candidates = getDeliveryStockOptions(item)
        .map((option: any) => {
          const projectId = Number(option.projectId);
          const warehouseId = Number(option.warehouseId);
          return {
            option,
            projectId,
            warehouseId,
            quantity: getDeliveryScopeAvailableQuantity(
              item,
              projectId,
              warehouseId
            ),
          };
        })
        .filter(
          candidate =>
            candidate.projectId > 0 &&
            candidate.warehouseId > 0 &&
            candidate.quantity > 0 &&
            !isDeliveryScopeBlocked(
              item,
              candidate.projectId,
              candidate.warehouseId
            )
        );

      const findCandidate = (projectId: number, warehouseId: number) =>
        candidates.find(
          candidate =>
            candidate.projectId === projectId &&
            candidate.warehouseId === warehouseId
        );
      const transferReceiptProjectId = Number(
        item.transferReceiptProjectId ?? 0
      );
      const transferReceiptWarehouseId = Number(
        item.transferReceiptWarehouseId ?? 0
      );
      const requestProjectId = Number(
        deliveryRequestDetail?.request.projectId ?? 0
      );
      const itemWarehouseId = Number(item.warehouseId ?? 0);
      const preferredCandidate =
        findCandidate(transferReceiptProjectId, transferReceiptWarehouseId) ??
        findCandidate(requestProjectId, itemWarehouseId);
      if (preferredCandidate) {
        return {
          projectId: preferredCandidate.projectId,
          warehouseId: preferredCandidate.warehouseId,
        };
      }

      const enoughStockCandidate = [...candidates]
        .filter(candidate => candidate.quantity + 0.000001 >= pendingQuantity)
        .sort((left, right) => left.quantity - right.quantity)[0];
      const bestCandidate =
        enoughStockCandidate ??
        [...candidates].sort(
          (left, right) => right.quantity - left.quantity
        )[0];

      return bestCandidate
        ? {
            projectId: bestCandidate.projectId,
            warehouseId: bestCandidate.warehouseId,
          }
        : null;
    },
    [
      deliveryRequestDetail?.request.projectId,
      getDeliveryScopeAvailableQuantity,
      getDeliveryStockOptions,
      isDeliveryScopeBlocked,
    ]
  );

  useEffect(() => {
    if (
      !deliveryDialogOpen ||
      !deliveryRequestDetail ||
      deliveryStockRows === undefined
    ) {
      return;
    }

    let changed = false;
    const nextWarehouses = { ...deliveryWarehouseByItemId };
    const nextProjects = { ...deliveryProjectByItemId };

    for (const item of deliveryItems) {
      const selectedWarehouseId = Number(nextWarehouses[item.id] ?? 0);
      const selectedProjectId = Number(nextProjects[item.id] ?? 0);
      const selectedWarehouseIsValid =
        selectedWarehouseId > 0 &&
        selectedProjectId > 0 &&
        getDeliveryScopeAvailableQuantity(
          item,
          selectedProjectId,
          selectedWarehouseId
        ) > 0 &&
        !isDeliveryScopeBlocked(item, selectedProjectId, selectedWarehouseId);

      if (selectedWarehouseIsValid) continue;

      const suggestedScope = getSuggestedDeliveryScope(item);
      const nextWarehouseValue = suggestedScope
        ? String(suggestedScope.warehouseId)
        : "";
      const nextProjectValue = suggestedScope
        ? String(suggestedScope.projectId)
        : "";
      if (
        (nextWarehouses[item.id] ?? "") !== nextWarehouseValue ||
        (nextProjects[item.id] ?? "") !== nextProjectValue
      ) {
        nextWarehouses[item.id] = nextWarehouseValue;
        nextProjects[item.id] = nextProjectValue;
        changed = true;
      }
    }

    if (changed) {
      setDeliveryWarehouseByItemId(nextWarehouses);
      setDeliveryProjectByItemId(nextProjects);
    }
  }, [
    deliveryDialogOpen,
    deliveryItems,
    deliveryProjectByItemId,
    deliveryWarehouseByItemId,
    deliveryRequestDetail,
    deliveryStockRows,
    getDeliveryScopeAvailableQuantity,
    getSuggestedDeliveryScope,
    isDeliveryScopeBlocked,
  ]);

  const filteredExits = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (exits ?? []).filter((row: any) => {
      const warehouseExit = row.warehouseExit;
      const projectLabel = row.project
        ? `${row.project.code} ${row.project.name}`
        : "";
      const matchesSearch =
        !normalizedSearch ||
        [
          warehouseExit.exitNumber,
          row.warehouse?.displayName,
          projectLabel,
          STATUS_LABELS[warehouseExit.status],
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );
      const matchesStatus =
        statusFilter === "all" || warehouseExit.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [exits, searchTerm, statusFilter]);

  const detailIsDraft = detail?.warehouseExit.status === "borrador";

  const renderDeliveryTargetSelector = (item: any) => {
    const selectedTarget = deliveryTargetByItemId[item.id] ?? null;
    const open = deliveryTargetPopoverOpen === item.id;

    return (
      <div className="w-full min-w-0">
        <div className="flex min-w-0 gap-2">
          <Popover
            open={open}
            onOpenChange={(nextOpen) => {
              setDeliveryTargetPopoverOpen(nextOpen ? item.id : null);
              if (!nextOpen) setDeliveryTargetSearch("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={
                  !deliveryRequestDetail?.request.projectId ||
                  createDeliveryMutation.isPending
                }
                className="min-w-0 flex-1 justify-between font-normal"
              >
                <span
                  className={
                    selectedTarget ? "truncate" : "truncate text-muted-foreground"
                  }
                >
                  {selectedTarget?.label ?? "Subproyecto o activo fijo"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[min(540px,calc(100vw-2rem))] p-0"
              align="start"
            >
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Buscar subproyecto o activo fijo..."
                  value={deliveryTargetSearch}
                  onValueChange={setDeliveryTargetSearch}
                />
                <CommandList>
                  {deliveryTargetOptionsLoading ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      Buscando opciones...
                    </div>
                  ) : (
                    <>
                      <CommandEmpty>No se encontraron opciones.</CommandEmpty>
                      {(deliveryTargetOptions?.subprojects ?? []).length > 0 ? (
                        <CommandGroup heading="Subproyectos">
                          {(deliveryTargetOptions?.subprojects ?? []).map(
                            (subproject: any) => {
                              const selected =
                                selectedTarget?.targetType === "subproyecto" &&
                                selectedTarget.subProjectId === subproject.id;

                              return (
                                <CommandItem
                                  key={`subproject-${subproject.id}`}
                                  value={`subproject-${subproject.id}-${subproject.code}-${subproject.name}`}
                                  onSelect={() => {
                                    setDeliveryTargetByItemId((current) => ({
                                      ...current,
                                      [item.id]:
                                        buildSubprojectDeliveryTargetSelection(
                                          subproject
                                        ),
                                    }));
                                    setDeliveryTargetPopoverOpen(null);
                                    setDeliveryTargetSearch("");
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      selected ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {subproject.code} - {subproject.name}
                                    </p>
                                    {subproject.description ? (
                                      <p className="truncate text-xs text-muted-foreground">
                                        {subproject.description}
                                      </p>
                                    ) : null}
                                  </div>
                                </CommandItem>
                              );
                            }
                          )}
                        </CommandGroup>
                      ) : null}

                      {(deliveryTargetOptions?.fixedAssets ?? []).length > 0 ? (
                        <CommandGroup heading="Activos fijos">
                          {(deliveryTargetOptions?.fixedAssets ?? []).map(
                            (asset: any) => {
                              const selected =
                                selectedTarget?.targetType === "activo_fijo" &&
                                selectedTarget.fixedAssetSapItemCode ===
                                  asset.itemCode;

                              return (
                                <CommandItem
                                  key={`asset-${asset.itemCode}`}
                                  value={`asset-${asset.itemCode}-${asset.description}`}
                                  onSelect={() => {
                                    setDeliveryTargetByItemId((current) => ({
                                      ...current,
                                      [item.id]:
                                        buildFixedAssetDeliveryTargetSelection(
                                          asset
                                        ),
                                    }));
                                    setDeliveryTargetPopoverOpen(null);
                                    setDeliveryTargetSearch("");
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      selected ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                      {asset.itemCode} - {asset.description}
                                    </p>
                                  </div>
                                </CommandItem>
                              );
                            }
                          )}
                        </CommandGroup>
                      ) : null}
                    </>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {selectedTarget ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setDeliveryTargetByItemId((current) => ({
                  ...current,
                  [item.id]: null,
                }))
              }
              disabled={createDeliveryMutation.isPending}
              aria-label="Limpiar destino"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  const submitDelivery = () => {
    if (!deliveryRequestDetail) {
      toast.error("Seleccione una requisición");
      return;
    }

    const receivedByName = deliveryReceivedByName.trim();
    if (!receivedByName) {
      toast.error("Ingrese quién recibe la salida");
      return;
    }
    const selectedItems = deliveryItems
      .map((item: any) => {
        const quantity = Number(deliveryQuantityByItemId[item.id] ?? 0);
        const warehouseId = Number(deliveryWarehouseByItemId[item.id] ?? 0);
        const sourceProjectId = Number(deliveryProjectByItemId[item.id] ?? 0);
        const destinationWarehouseId = Number(
          deliveryDestinationWarehouseByItemId[item.id] ?? 0
        );
        const destinationProjectId = Number(
          deliveryDestinationProjectByItemId[item.id] ?? 0
        );
        const targetSelection = deliveryTargetByItemId[item.id] ?? null;
        const isBlockedWarehouse = isDeliveryScopeBlocked(
          item,
          sourceProjectId,
          warehouseId
        );
        const availableQuantity = getDeliveryScopeAvailableQuantity(
          item,
          sourceProjectId,
          warehouseId
        );
        const pendingQuantity = getDeliveryPendingQuantity(item);

        return {
          item,
          quantity,
          pendingQuantity,
          availableQuantity,
          sourceProjectId,
          warehouseId,
          destinationProjectId,
          destinationWarehouseId,
          isBlockedWarehouse,
          targetSelection,
        };
      })
      .filter(({ quantity }) => quantity > 0);

    if (selectedItems.length === 0) {
      toast.error("Ingrese al menos una cantidad a despachar");
      return;
    }

    const invalidItem = selectedItems.find(
      ({
        quantity,
        pendingQuantity,
        availableQuantity,
        sourceProjectId,
        warehouseId,
        destinationProjectId,
        destinationWarehouseId,
        isBlockedWarehouse,
      }) =>
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !sourceProjectId ||
        !warehouseId ||
        !destinationProjectId ||
        !destinationWarehouseId ||
        isBlockedWarehouse ||
        quantity - pendingQuantity > 0.000001 ||
        quantity - availableQuantity > 0.000001
    );
    if (invalidItem) {
      if (invalidItem.isBlockedWarehouse) {
        toast.error(
          `${invalidItem.item.itemName}: no se puede despachar desde la misma bodega/proyecto de origen del traslado`
        );
        return;
      }
      toast.error(
        `${invalidItem.item.itemName}: revise origen, destino, cantidad, pendiente y existencia disponible`
      );
      return;
    }

    createDeliveryMutation.mutate({
      requestId: deliveryRequestDetail.request.id,
      note: deliveryNotes.trim() || undefined,
      receivedByName,
      items: selectedItems.map(
        ({
          item,
          quantity,
          sourceProjectId,
          warehouseId,
          destinationProjectId,
          destinationWarehouseId,
          targetSelection,
        }) => ({
          requestItemId: item.id,
          dispatchedQuantity: quantity.toFixed(2),
          sourceProjectId,
          warehouseId,
          destinationProjectId,
          destinationWarehouseId,
          ...getDeliveryTargetPayload(targetSelection),
        })
      ),
    });
  };

  const updateDraftItemEdit = (
    itemId: number,
    field: "quantity" | "notes",
    value: string
  ) => {
    setDraftItemEdits((current) => ({
      ...current,
      [itemId]: {
        quantity: current[itemId]?.quantity ?? "",
        notes: current[itemId]?.notes ?? "",
        [field]: value,
      },
    }));
  };

  const submitDraftUpdate = () => {
    if (!detail || detail.warehouseExit.status !== "borrador") return;

    const receivedByName = draftReceivedByName.trim();
    if (!receivedByName) {
      toast.error("Ingrese a quién se le entrega la salida");
      return;
    }

    const items = [];
    for (const item of detail.items as any[]) {
      const edit = draftItemEdits[item.id] ?? {
        quantity: String(item.quantity ?? ""),
        notes: item.notes ?? "",
      };
      const quantity = parseEditableQuantity(edit.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        toast.error(`${item.itemName}: ingrese una cantidad mayor que cero`);
        return;
      }

      const returnedQuantity = parseQuantity(item.returnedQuantity);
      if (returnedQuantity - quantity > 0.000001) {
        toast.error(
          `${item.itemName}: la cantidad no puede ser menor a lo ya devuelto`
        );
        return;
      }

      const availableQuantity = parseQuantity(item.availableQuantity);
      if (quantity - availableQuantity > 0.000001) {
        toast.error(
          `${item.itemName}: la cantidad excede el disponible en bodega`
        );
        return;
      }

      items.push({
        id: item.id,
        quantity: quantity.toFixed(2),
        notes: edit.notes.trim() || null,
      });
    }

    updateDraftMutation.mutate({
      id: detail.warehouseExit.id,
      receivedByName,
      notes: draftNotes.trim() || null,
      items,
    });
  };

  const openReturnPanel = () => {
    if (!detail) return;
    const defaultConditions = Object.fromEntries(
      detail.items.map((item: any) => [item.id, "usado_buen_estado"])
    );
    setReturnReasonCategory("error_pedido");
    setReturnJustification("");
    setReturnReceivedByName("");
    setReturnQuantityByItemId({});
    setReturnConditionByItemId(defaultConditions);
    setReturnPanelOpen(true);
  };

  const submitReturn = () => {
    if (!detail) return;
    const normalizedReceivedByName = returnReceivedByName.trim();
    if (!normalizedReceivedByName) {
      toast.error("Recibido por es obligatorio");
      return;
    }
    if (returnJustification.trim().length < 10) {
      toast.error("La justificación debe tener al menos 10 caracteres");
      return;
    }

    const selectedItems = detail.items
      .map((item: any) => {
        const quantity = Number(returnQuantityByItemId[item.id] ?? 0);
        const maxQuantity = Number(item.returnableQuantity ?? 0);
        return { item, quantity, maxQuantity };
      })
      .filter(({ quantity }) => quantity > 0);

    if (selectedItems.length === 0) {
      toast.error("Ingrese al menos una cantidad a devolver");
      return;
    }

    const invalidItem = selectedItems.find(
      ({ quantity, maxQuantity }) =>
        !Number.isFinite(quantity) || quantity <= 0 || quantity - maxQuantity > 0.000001
    );
    if (invalidItem) {
      toast.error(
        `${invalidItem.item.itemName}: la cantidad excede lo disponible para devolver`
      );
      return;
    }

    createReturnMutation.mutate({
      returnType: "devolucion_bodega_proyecto",
      reasonCategory: returnReasonCategory as any,
      justification: returnJustification.trim(),
      receivedByName: normalizedReceivedByName,
      sourceProjectId: detail.warehouseExit.projectId,
      sourceWarehouseExitId: detail.warehouseExit.id,
      originalRequestId: detail.warehouseExit.materialRequestId ?? undefined,
      items: selectedItems.map(({ item, quantity }) => ({
        sourceWarehouseExitItemId: item.id,
        warehouseId: item.warehouseId,
        itemName: item.itemName,
        sapItemCode: item.sapItemCode,
        quantity: quantity.toFixed(2),
        unit: item.unit || undefined,
        condition: (returnConditionByItemId[item.id] || "usado_buen_estado") as any,
      })),
    });
  };

  const handlePrintWarehouseExit = () => {
    if (!detail) return;

    const warehouseExit = detail.warehouseExit;
    const projectLabel = detail.project
      ? `${detail.project.code} ${detail.project.name}`
      : `Proyecto ${warehouseExit.projectId}`;
    const warehouseLabel = formatWarehouseExitWarehouseLabel(detail);
    const destinationProjectLabel =
      formatWarehouseExitDestinationProjectLabel(detail);
    const destinationWarehouseLabel =
      formatWarehouseExitDestinationWarehouseLabel(detail);
    const requestedByLabel = formatWarehouseExitRequestLabel(detail);
    const createdByLabel = detail.createdBy?.name || "-";
    const receivedByLabel = warehouseExit.receivedByName?.trim() || "-";
    const referenceLabel =
      warehouseExit.notes?.trim() ||
      detail.materialRequest?.requestNumber ||
      (warehouseExit.materialRequestId
        ? `Requisición ${warehouseExit.materialRequestId}`
        : warehouseExit.exitNumber);
    const itemRows = (detail.items || [])
      .map(
        (item: any) => {
          const targetLabel =
            formatWarehouseExitTargetLabel(item, warehouseExit.projectId) || "-";
          const logisticDestinationLabel =
            formatWarehouseExitItemDestinationLabel(item);
          const destinationLabel =
            logisticDestinationLabel === "-"
              ? targetLabel
              : targetLabel === "-"
                ? logisticDestinationLabel
                : `${logisticDestinationLabel} | ${targetLabel}`;
          return `
          <tr>
            <td>${escapeHtml(item.sapItemCode || "-")}</td>
            <td>${escapeHtml(item.itemName || "-")}</td>
            <td class="numeric">${escapeHtml(formatPrintNumber(item.quantity))}</td>
            <td class="center">${escapeHtml(item.unit || "-")}</td>
            <td>${escapeHtml(destinationLabel)}</td>
            <td>
              <div>${escapeHtml(item.notes || referenceLabel)}</div>
            </td>
            <td class="numeric">1</td>
          </tr>
        `;
        }
      )
      .join("");
    const totalLines = (detail.items || []).length;

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
          <title>${escapeHtml(warehouseExit.exitNumber)}</title>
          <style>
            @page { size: A4 portrait; margin: 7mm; }
            * { box-sizing: border-box; }
            body {
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9.5px;
              margin: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 196mm;
              padding: 0 1mm 3mm;
            }
            .header {
              align-items: start;
              display: grid;
              gap: 8px;
              grid-template-columns: 82px 1fr 108px;
            }
            .logo {
              display: block;
              height: 44px;
              object-fit: contain;
              width: 64px;
            }
            .title {
              color: #000;
              font-size: 11.5px;
              font-weight: 800;
              line-height: 1.25;
              text-align: center;
              text-transform: uppercase;
            }
            .company {
              color: #000;
              font-size: 13px;
              margin-bottom: 2px;
            }
            .document-number {
              border: 4px double #222;
              color: #000;
              font-size: 12px;
              font-weight: 900;
              margin-top: 0;
              padding: 3px 6px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 10px;
              grid-template-columns: 1fr 1fr;
              margin-top: 6mm;
            }
            .meta-column {
              display: grid;
              gap: 3px;
            }
            .field {
              display: grid;
              gap: 4px;
              grid-template-columns: 98px 1fr;
              min-height: 12px;
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
              margin-top: 4mm;
              table-layout: fixed;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #111;
              border-top: 2px solid #111;
              font-size: 8.5px;
              font-weight: 800;
              padding: 3px 4px;
              text-align: left;
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
            .total-row td {
              border-bottom: 2px solid #111;
              font-weight: 800;
            }
            .signatures {
              display: grid;
              gap: 22px;
              grid-template-columns: repeat(3, 150px);
              justify-content: center;
              margin-top: 10mm;
            }
            .signature-line {
              border-top: 2px solid #111;
              font-size: 10.5px;
              font-weight: 700;
              padding-top: 4px;
              text-align: center;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS S.A. DE C.V.</div>
                <div>${escapeHtml(warehouseLabel)}</div>
                <div>EGRESO DE BODEGA</div>
              </div>
              <div class="document-number">${escapeHtml(warehouseExit.exitNumber)}</div>
            </section>

            <section class="meta">
              <div class="meta-column">
                <div class="field">
                  <div class="label">Fecha:</div>
                  <div class="value">${escapeHtml(formatPrintDate(warehouseExit.exitDate || warehouseExit.emittedAt || warehouseExit.createdAt))}</div>
                </div>
                <div class="field">
                  <div class="label">Solicitado por:</div>
                  <div class="value">${escapeHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Recibido por:</div>
                  <div class="value">${escapeHtml(receivedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Tipo Egreso:</div>
                  <div class="value">EGRESO DE BODEGA</div>
                </div>
                <div class="field">
                  <div class="label">De Bodega:</div>
                  <div class="value">${escapeHtml(warehouseLabel)}</div>
                </div>
              </div>
              <div class="meta-column">
                <div class="field">
                  <div class="label">Job origen:</div>
                  <div class="value">${escapeHtml(projectLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Job destino:</div>
                  <div class="value">${escapeHtml(destinationProjectLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Referencia:</div>
                  <div class="value">${escapeHtml(referenceLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">A Bodega:</div>
                  <div class="value">${escapeHtml(destinationWarehouseLabel)}</div>
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 16%;">Código/No. Serie</th>
                  <th style="width: 26%;">Identificador</th>
                  <th style="width: 9%;" class="numeric">Cantidad</th>
                  <th style="width: 9%;" class="center">U Medida</th>
                  <th style="width: 19%;">Destino</th>
                  <th style="width: 17%;">Referencia</th>
                  <th style="width: 7%;" class="numeric">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="7">Sin ítems</td></tr>`}
                <tr class="total-row">
                  <td colspan="6">Total general</td>
                  <td class="numeric">${escapeHtml(formatPrintNumber(totalLines))}</td>
                </tr>
              </tbody>
            </table>

            <section class="signatures">
              <div class="signature-line">Elaborado por:<br>${escapeHtml(createdByLabel)}</div>
              <div class="signature-line">Entregado a:<br>${escapeHtml(receivedByLabel)}</div>
              <div class="signature-line">Autorizado por:</div>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1>Salidas de Inventario</h1>
          <p className="text-sm text-muted-foreground">
            Consulta, emite o anula las transacciones generadas desde Flujos de
            Abastecimiento.
          </p>
        </div>
        <Button onClick={() => setDeliveryDialogOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Nueva salida
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por salida, proyecto o bodega..."
            className="h-10 pl-9"
          />
        </div>
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
              Cargando salidas de inventario...
            </div>
          ) : !(exits ?? []).length ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <PackageMinus className="h-9 w-9" />
              <p>No hay salidas de inventario generadas desde Flujos.</p>
            </div>
          ) : !filteredExits.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay salidas de inventario que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. salida
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bodega
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Líneas
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Cantidad
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExits.map((row: any) => (
                    <tr
                      key={row.warehouseExit.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-mono text-xs font-medium">
                        {row.warehouseExit.exitNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {row.project
                          ? `${row.project.code} - ${row.project.name}`
                          : "-"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.warehouse?.displayName || "-"}
                      </td>
                      <td className="p-3 text-xs">
                        {formatDate(row.warehouseExit.exitDate)}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.warehouseExit.status] || ""
                          }`}
                        >
                          {STATUS_LABELS[row.warehouseExit.status] ||
                            row.warehouseExit.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">{row.itemCount}</td>
                      <td className="p-3 text-right font-medium">
                        {formatQuantity(row.totalQuantity)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.warehouseExit.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
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
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            resetReturnPanel();
          }
        }}
      >
        <DialogContent className="max-h-[92vh] !w-[calc(100vw-0.5rem)] !max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:!w-[calc(100vw-1rem)] sm:!max-w-[calc(100vw-1rem)] sm:p-5 xl:!max-w-[calc(100vw-1rem)]">
          <DialogHeader className="border-b border-border/70 pb-5">
            <DialogTitle className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight sm:text-3xl">
              {detail?.warehouseExit.exitNumber || "Salida de Inventario"}
              {detail?.warehouseExit.status ? (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    STATUS_COLORS[detail.warehouseExit.status] || ""
                  }`}
                >
                  {STATUS_LABELS[detail.warehouseExit.status] ||
                    detail.warehouseExit.status}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {detail ? (
            <div className="space-y-5 pt-2">
              <div className="grid gap-3 md:grid-cols-5">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Proyecto/bodega origen
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.project
                      ? `${detail.project.code} - ${detail.project.name}`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Almacén origen
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.warehouse?.displayName || "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Fecha salida
                  </Label>
                  <p className="mt-2 font-semibold">
                    {formatDate(detail.warehouseExit.exitDate)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Registrada por
                  </Label>
                  <p className="mt-2 font-semibold">
                    {detail.createdBy?.name || "-"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Recibido por
                  </Label>
                  {detailIsDraft ? (
                    <Input
                      className="mt-2 bg-background font-semibold"
                      value={draftReceivedByName}
                      onChange={(event) =>
                        setDraftReceivedByName(event.target.value)
                      }
                      placeholder="Nombre de quien recibe"
                    />
                  ) : (
                    <p className="mt-2 font-semibold">
                      {detail.warehouseExit.receivedByName || "-"}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Proyecto/bodega destino
                  </Label>
                  <p className="mt-2 font-semibold">
                    {formatWarehouseExitDestinationProjectLabel(detail)}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Almacén destino
                  </Label>
                  <p className="mt-2 font-semibold">
                    {formatWarehouseExitDestinationWarehouseLabel(detail)}
                  </p>
                </div>
              </div>

              {detailIsDraft ? (
                <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Notas generales
                  </Label>
                  <Textarea
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    placeholder="Notas de la salida"
                  />
                </div>
              ) : detail.warehouseExit.notes ? (
                <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                  {detail.warehouseExit.notes}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[1640px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código SAP
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Destino interno
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Destino bodega
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Devuelto
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Por devolver
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Disponible bodega
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nueva existencia
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item: any) => {
                      const editableQuantity = parseEditableQuantity(
                        draftItemEdits[item.id]?.quantity ?? item.quantity
                      );
                      const draftStockAfterExit =
                        detailIsDraft && Number.isFinite(editableQuantity)
                          ? parseQuantity(item.availableQuantity) - editableQuantity
                          : parseQuantity(item.stockAfterExit);

                      return (
                        <tr key={item.id} className="border-b last:border-0">
                          <td className="p-3 font-mono text-xs">{item.sapItemCode}</td>
                          <td className="p-3 font-medium">{item.itemName}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {formatWarehouseExitTargetLabel(
                              item,
                              detail.warehouseExit.projectId
                            ) || "-"}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {formatWarehouseExitItemDestinationLabel(item)}
                          </td>
                          <td className="p-3 text-right">
                            {detailIsDraft ? (
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  className="h-9 w-28 text-right"
                                  inputMode="decimal"
                                  min="0.01"
                                  step="0.01"
                                  value={draftItemEdits[item.id]?.quantity ?? ""}
                                  onChange={(event) =>
                                    updateDraftItemEdit(
                                      item.id,
                                      "quantity",
                                      event.target.value
                                    )
                                  }
                                />
                                <span className="min-w-8 text-left text-xs text-muted-foreground">
                                  {item.unit || ""}
                                </span>
                              </div>
                            ) : (
                              <>
                                {formatQuantity(item.quantity)}{" "}
                                <span className="text-xs text-muted-foreground">
                                  {item.unit || ""}
                                </span>
                              </>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {formatQuantity(item.returnedQuantity)}{" "}
                            <span className="text-xs text-muted-foreground">
                              {item.unit || ""}
                            </span>
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatQuantity(item.returnableQuantity)}{" "}
                            <span className="text-xs text-muted-foreground">
                              {item.unit || ""}
                            </span>
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatQuantity(item.availableQuantity)}{" "}
                            <span className="text-xs text-muted-foreground">
                              {item.unit || ""}
                            </span>
                          </td>
                          <td
                            className={`p-3 text-right font-semibold ${
                              draftStockAfterExit < 0 ? "text-destructive" : ""
                            }`}
                          >
                            {formatQuantity(draftStockAfterExit)}{" "}
                            <span className="text-xs text-muted-foreground">
                              {item.unit || ""}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {detailIsDraft ? (
                              <Textarea
                                className="min-h-20 min-w-[220px] bg-background text-xs"
                                value={draftItemEdits[item.id]?.notes ?? ""}
                                onChange={(event) =>
                                  updateDraftItemEdit(
                                    item.id,
                                    "notes",
                                    event.target.value
                                  )
                                }
                                placeholder="Notas de línea"
                              />
                            ) : (
                              item.notes || "-"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canCreateReturns && returnPanelOpen ? (
                <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">Registrar devolución a bodega de proyecto</p>
                      <p className="text-xs text-muted-foreground">
                        Excedente solo devuelve stock. Los demás motivos reabren el
                        pendiente en Flujos por la cantidad devuelta.
                      </p>
                    </div>
                    <Badge variant="outline" className="w-fit text-xs">
                      {detail.warehouse?.displayName || "Bodega del proyecto"}
                    </Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Motivo *</Label>
                      <Select
                        value={returnReasonCategory}
                        onValueChange={setReturnReasonCategory}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Seleccione motivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(RETURN_REASON_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Recibido por *</Label>
                      <Input
                        value={returnReceivedByName}
                        onChange={(event) =>
                          setReturnReceivedByName(event.target.value)
                        }
                        placeholder="Nombre de quien recibe"
                        maxLength={255}
                        disabled={createReturnMutation.isPending}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Justificación *</Label>
                      <Textarea
                        value={returnJustification}
                        onChange={(event) => setReturnJustification(event.target.value)}
                        placeholder="Explique por qué se devuelve el material"
                        rows={2}
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border bg-background">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ítem
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Máx.
                          </th>
                          <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Devolver
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Condición
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item: any) => {
                          const maxQuantity = Number(item.returnableQuantity ?? 0);
                          return (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="p-3">
                                <p className="font-medium">{item.itemName}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  {item.sapItemCode}
                                </p>
                              </td>
                              <td className="p-3 text-right font-mono text-xs">
                                {formatQuantity(item.returnableQuantity)} {item.unit || ""}
                              </td>
                              <td className="p-3 align-top">
                                <Input
                                  className="ml-auto w-28 text-right"
                                  type="number"
                                  min="0"
                                  max={maxQuantity}
                                  step="any"
                                  placeholder="0.00"
                                  value={returnQuantityByItemId[item.id] ?? ""}
                                  onChange={(event) =>
                                    setReturnQuantityByItemId((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  disabled={maxQuantity <= 0 || createReturnMutation.isPending}
                                />
                              </td>
                              <td className="p-3">
                                <Select
                                  value={
                                    returnConditionByItemId[item.id] ||
                                    "usado_buen_estado"
                                  }
                                  onValueChange={(value) =>
                                    setReturnConditionByItemId((current) => ({
                                      ...current,
                                      [item.id]: value,
                                    }))
                                  }
                                  disabled={maxQuantity <= 0 || createReturnMutation.isPending}
                                >
                                  <SelectTrigger className="w-full min-w-40">
                                    <SelectValue placeholder="Condición" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(RETURN_CONDITION_LABELS).map(
                                      ([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                          {label}
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button
                      variant="outline"
                      onClick={resetReturnPanel}
                      disabled={createReturnMutation.isPending}
                    >
                      Cancelar devolución
                    </Button>
                    <Button
                      onClick={submitReturn}
                      disabled={createReturnMutation.isPending}
                    >
                      {createReturnMutation.isPending
                        ? "Registrando..."
                        : "Crear devolución"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedId(null);
                    resetReturnPanel();
                  }}
                >
                  Cerrar
                </Button>

                {canCreateReturns && detail.warehouseExit.status === "emitida" ? (
                  <Button
                    variant="outline"
                    onClick={openReturnPanel}
                    disabled={
                      returnPanelOpen ||
                      !detail.items.some(
                        (item: any) => Number(item.returnableQuantity ?? 0) > 0
                      )
                    }
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Registrar devolución
                  </Button>
                ) : null}

                {detail.warehouseExit.status === "borrador" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={submitDraftUpdate}
                      disabled={updateDraftMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {updateDraftMutation.isPending
                        ? "Guardando..."
                        : "Guardar cambios"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        cancelMutation.mutate({ id: detail.warehouseExit.id })
                      }
                      disabled={
                        cancelMutation.isPending ||
                        emitMutation.isPending ||
                        updateDraftMutation.isPending
                      }
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      {cancelMutation.isPending ? "Anulando..." : "Anular borrador"}
                    </Button>
                    <Button
                      onClick={() => emitMutation.mutate({ id: detail.warehouseExit.id })}
                      disabled={
                        emitMutation.isPending ||
                        cancelMutation.isPending ||
                        updateDraftMutation.isPending
                      }
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {emitMutation.isPending ? "Emitiendo..." : "Emitir salida"}
                    </Button>
                  </>
                ) : null}
                <Button
                  variant="outline"
                  onClick={handlePrintWarehouseExit}
                  disabled={
                    detail.warehouseExit.status !== "emitida" ||
                    detail.items.length === 0
                  }
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir egreso
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando salida de bodega...
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={deliveryDialogOpen}
        onOpenChange={(open) => {
          setDeliveryDialogOpen(open);
          if (!open) {
            setDeliveryRequestId("");
            setDeliveryNotes("");
            setDeliveryReceivedByName("");
            setDeliveryQuantityByItemId({});
            setDeliveryWarehouseByItemId({});
            setDeliveryProjectByItemId({});
            setDeliveryDestinationWarehouseByItemId({});
            setDeliveryDestinationProjectByItemId({});
            setDeliveryDestinationWarehouseTouchedByItemId({});
            setDeliveryTargetByItemId({});
            setDeliveryTargetPopoverOpen(null);
            setDeliveryTargetSearch("");
          }
        }}
      >
        <DialogContent className="max-h-[92vh] !w-[calc(100vw-0.5rem)] !max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:!w-[calc(100vw-1rem)] sm:!max-w-[calc(100vw-1rem)] sm:p-5 xl:!max-w-[calc(100vw-1rem)]">
          <DialogHeader className="border-b border-border/70 pb-5">
            <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">
              Nueva salida de requisición
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
              <div className="space-y-2">
                <Label>Requisición *</Label>
                <Select value={deliveryRequestId} onValueChange={setDeliveryRequestId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Seleccione requisición" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleMaterialRequests.map((row: any) => (
                      <SelectItem key={row.request.id} value={String(row.request.id)}>
                        {row.request.requestNumber} - {row.project?.code} {row.project?.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                <p className="font-semibold">
                  {deliveryRequestDetail?.project
                    ? `${deliveryRequestDetail.project.code} - ${deliveryRequestDetail.project.name}`
                    : "Proyecto pendiente"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Se muestran requisiciones con flujo completado o parcialmente atendidas. La salida solo incluye renglones ya recibidos o disponibles en bodega.
                </p>
              </div>
            </div>

            {deliveryRequestDetail ? (
              <>
                {deliveryItems.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full min-w-[1760px] table-fixed text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="w-20 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Código SAP
                          </th>
                          <th className="w-60 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ítem
                          </th>
                          <th className="w-60 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Destino interno
                          </th>
                          <th className="w-[92px] px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Solicitado
                          </th>
                          <th className="w-[108px] px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Ya despachado
                          </th>
                          <th className="w-[104px] px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Disponible
                          </th>
                          <th className="w-[350px] px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Origen
                          </th>
                          <th className="w-[350px] px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Destino
                          </th>
                          <th className="w-28 px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Despachar
                          </th>
                          <th className="w-[86px] px-2 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Saldo
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {deliveryItems.map((item: any) => {
                          const requestedQuantity = parseQuantity(item.quantity);
                          const alreadyDispatched = getPhysicalDispatchedQuantity(item);
                          const selectedWarehouseId = Number(
                            deliveryWarehouseByItemId[item.id] ?? 0
                          );
                          const selectedProjectId = Number(
                            deliveryProjectByItemId[item.id] ?? 0
                          );
                          const selectedWarehouseBlocked =
                            isDeliveryScopeBlocked(
                              item,
                              selectedProjectId,
                              selectedWarehouseId
                            );
                          const availableQuantity =
                            getDeliveryScopeAvailableQuantity(
                              item,
                              selectedProjectId,
                              selectedWarehouseId
                            );
                          const pendingQuantity = getDeliveryPendingQuantity(item);
                          const quantity = Number(deliveryQuantityByItemId[item.id] ?? 0);
                          const balanceQuantity = Math.max(pendingQuantity - quantity, 0);
                          const warehouseOptions =
                            getDeliveryWarehouseOptions(item);
                          const projectOptions = getDeliveryProjectOptions(
                            item,
                            selectedWarehouseId
                          );
                          const selectedWarehouseOption = warehouseOptions.find(
                            (warehouse: any) =>
                              Number(warehouse.warehouseId) ===
                              selectedWarehouseId
                          );
                          const selectedProjectOption = projectOptions.find(
                            (project: any) =>
                              Number(project.projectId) === selectedProjectId
                          );
                          const selectedDestinationWarehouseId = Number(
                            deliveryDestinationWarehouseByItemId[item.id] ?? 0
                          );
                          const selectedDestinationProjectId = Number(
                            deliveryDestinationProjectByItemId[item.id] ?? 0
                          );
                          const destinationProjectOptions =
                            getDeliveryDestinationProjectOptions(
                              selectedDestinationWarehouseId
                            );
                          const selectedDestinationWarehouseOption =
                            deliveryDestinationWarehouseOptions.find(
                              (warehouse: any) =>
                                Number(warehouse.id) ===
                                selectedDestinationWarehouseId
                            );
                          const selectedDestinationProjectOption =
                            destinationProjectOptions.find(
                              (project: any) =>
                                Number(project.id) ===
                                selectedDestinationProjectId
                            ) ??
                            (deliveryDestinationProjects ?? []).find(
                              (project: any) =>
                                Number(project.id) ===
                                selectedDestinationProjectId
                            );
                          const destinationStockQuantity =
                            getDeliveryScopeStockQuantity(
                              item,
                              selectedDestinationProjectId,
                              selectedDestinationWarehouseId
                            );
                          const canDeliver =
                            pendingQuantity > 0 &&
                            availableQuantity > 0 &&
                            !selectedWarehouseBlocked &&
                            Boolean(item.sapItemCode);

                          return (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="px-2 py-3 align-top font-mono text-xs">
                                {item.sapItemCode || "-"}
                              </td>
                              <td className="px-2 py-3 align-top">
                                <p className="font-medium">
                                  {item.sapItemDescription || item.itemName}
                                </p>
                                {!item.sapItemCode ? (
                                  <p className="text-[11px] text-destructive">
                                    Pendiente de código SAP
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-2 py-3 align-top">
                                {renderDeliveryTargetSelector(item)}
                              </td>
                              <td className="px-2 py-3 text-right align-top">
                                {formatQuantity(requestedQuantity)} {item.unit || ""}
                              </td>
                              <td className="px-2 py-3 text-right align-top">
                                {formatQuantity(alreadyDispatched)} {item.unit || ""}
                              </td>
                              <td className="px-2 py-3 text-right align-top font-medium">
                                {formatQuantity(availableQuantity)} {item.unit || ""}
                              </td>
                              <td className="px-2 py-3 align-top">
                                <div className="w-full max-w-[334px] space-y-2">
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Almacén origen
                                    </p>
                                    <Select
                                      value={
                                        selectedWarehouseId
                                          ? String(selectedWarehouseId)
                                          : undefined
                                      }
                                      onValueChange={(value) =>
                                        handleDeliveryWarehouseChange(
                                          item,
                                          value
                                        )
                                      }
                                      disabled={!warehouseOptions.length}
                                    >
                                      <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-left text-xs [&>span]:truncate">
                                        <SelectValue placeholder="Seleccione almacén" />
                                      </SelectTrigger>
                                      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                        {warehouseOptions.length === 0 ? (
                                          <SelectItem value="sin-almacenes" disabled>
                                            Sin almacenes disponibles
                                          </SelectItem>
                                        ) : (
                                          warehouseOptions.map(
                                            (warehouse: any) => (
                                              <SelectItem
                                                key={warehouse.warehouseId}
                                                value={String(
                                                  warehouse.warehouseId
                                                )}
                                                textValue={getStockWarehouseLabel(
                                                  warehouse
                                                )}
                                                className="text-xs"
                                              >
                                                <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                                  <span className="truncate">
                                                    {getStockWarehouseLabel(
                                                      warehouse
                                                    )}
                                                  </span>
                                                  <QuantityPill
                                                    value={warehouse.quantity}
                                                    unit={item.unit}
                                                    tone={
                                                      Number(
                                                        warehouse.quantity ?? 0
                                                      ) > 0
                                                        ? "available"
                                                        : "neutral"
                                                    }
                                                  />
                                                </span>
                                              </SelectItem>
                                            )
                                          )
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Bodega/proyecto origen
                                    </p>
                                    <Select
                                      value={
                                        selectedProjectId
                                          ? String(selectedProjectId)
                                          : undefined
                                      }
                                      onValueChange={(value) =>
                                        handleDeliveryProjectChange(item, value)
                                      }
                                      disabled={
                                        !selectedWarehouseId ||
                                        !projectOptions.length
                                      }
                                    >
                                      <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-left text-xs [&>span]:truncate">
                                        <SelectValue
                                          placeholder={
                                            selectedWarehouseId
                                              ? "Seleccione bodega"
                                              : "Seleccione almacén"
                                          }
                                        />
                                      </SelectTrigger>
                                      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                        {projectOptions.length === 0 ? (
                                          <SelectItem value="sin-bodegas" disabled>
                                            Sin bodegas para este almacén
                                          </SelectItem>
                                        ) : (
                                          projectOptions.map((project: any) => {
                                            const projectId = Number(
                                              project.projectId
                                            );
                                            const blockedScope =
                                              isDeliveryScopeBlocked(
                                                item,
                                                projectId,
                                                selectedWarehouseId
                                              );
                                            const quantityValue = Number(
                                              project.quantity ?? 0
                                            );

                                            return (
                                              <SelectItem
                                                key={getDeliveryScopeKey(
                                                  project.projectId,
                                                  project.warehouseId
                                                )}
                                                value={String(project.projectId)}
                                                textValue={getStockProjectLabel(
                                                  project
                                                )}
                                                disabled={blockedScope}
                                                className="text-xs"
                                              >
                                                <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                                  <span className="truncate">
                                                    {getStockProjectLabel(
                                                      project
                                                    )}
                                                  </span>
                                                  <QuantityPill
                                                    value={
                                                      blockedScope
                                                        ? 0
                                                        : project.quantity
                                                    }
                                                    unit={item.unit}
                                                    label={
                                                      blockedScope
                                                        ? "Origen"
                                                        : "Disp."
                                                    }
                                                    tone={
                                                      blockedScope
                                                        ? "danger"
                                                        : quantityValue > 0
                                                          ? "available"
                                                          : "neutral"
                                                    }
                                                  />
                                                </span>
                                              </SelectItem>
                                            );
                                          })
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <p className="mt-1 max-w-[334px] truncate text-[10px] text-muted-foreground">
                                  Origen:{" "}
                                  {selectedProjectOption
                                    ? getStockProjectLabel(
                                        selectedProjectOption
                                      )
                                    : "bodega/proyecto"}{" "}
                                  /{" "}
                                  {selectedWarehouseOption
                                    ? getStockWarehouseLabel(
                                        selectedWarehouseOption
                                      )
                                    : "almacén físico"}{" "}
                                  · Disponible:{" "}
                                  <span className="font-semibold text-emerald-700">
                                    {formatQuantity(availableQuantity)}{" "}
                                    {item.unit || ""}
                                  </span>
                                </p>
                              </td>
                              <td className="px-2 py-3 align-top">
                                <div className="w-full max-w-[334px] space-y-2">
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Almacén destino
                                    </p>
                                    <Select
                                      value={
                                        selectedDestinationWarehouseId
                                          ? String(selectedDestinationWarehouseId)
                                          : undefined
                                      }
                                      onValueChange={(value) =>
                                        handleDeliveryDestinationWarehouseChange(
                                          item,
                                          value
                                        )
                                      }
                                      disabled={
                                        deliveryDestinationWarehouseOptions.length === 0
                                      }
                                    >
                                      <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-left text-xs [&>span]:truncate">
                                        <SelectValue placeholder="Seleccione almacén destino" />
                                      </SelectTrigger>
                                      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                        {deliveryDestinationWarehouseOptions.length ===
                                        0 ? (
                                          <SelectItem value="sin-almacenes" disabled>
                                            Sin almacenes disponibles
                                          </SelectItem>
                                        ) : (
                                          deliveryDestinationWarehouseOptions.map(
                                            (warehouse: any) => {
                                              const warehouseId = Number(
                                                warehouse.id
                                              );
                                              const warehouseStock =
                                                getDeliveryDestinationProjectOptions(
                                                  warehouseId
                                                ).reduce(
                                                  (sum: number, project: any) =>
                                                    sum +
                                                    getDeliveryScopeStockQuantity(
                                                      item,
                                                      Number(project.id),
                                                      warehouseId
                                                    ),
                                                  0
                                                );

                                              return (
                                                <SelectItem
                                                  key={warehouse.id}
                                                  value={String(warehouse.id)}
                                                  textValue={getStockWarehouseLabel(
                                                    warehouse
                                                  )}
                                                  className="text-xs"
                                                >
                                                  <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                                    <span className="truncate">
                                                      {getStockWarehouseLabel(
                                                        warehouse
                                                      )}
                                                    </span>
                                                    <QuantityPill
                                                      value={warehouseStock}
                                                      unit={item.unit}
                                                      label="Actual"
                                                      tone={
                                                        warehouseStock > 0
                                                          ? "available"
                                                          : "neutral"
                                                      }
                                                    />
                                                  </span>
                                                </SelectItem>
                                              );
                                            }
                                          )
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Bodega/proyecto destino
                                    </p>
                                    <Select
                                      value={
                                        selectedDestinationProjectId
                                          ? String(selectedDestinationProjectId)
                                          : undefined
                                      }
                                      onValueChange={(value) =>
                                        handleDeliveryDestinationProjectChange(
                                          item,
                                          value
                                        )
                                      }
                                      disabled={
                                        !selectedDestinationWarehouseId ||
                                        !destinationProjectOptions.length
                                      }
                                    >
                                      <SelectTrigger className="h-9 w-full min-w-0 overflow-hidden text-left text-xs [&>span]:truncate">
                                        <SelectValue
                                          placeholder={
                                            selectedDestinationWarehouseId
                                              ? "Seleccione bodega/proyecto"
                                              : "Seleccione almacén destino"
                                          }
                                        />
                                      </SelectTrigger>
                                      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                                        {destinationProjectOptions.length === 0 ? (
                                          <SelectItem value="sin-bodegas" disabled>
                                            Sin bodegas para este almacén
                                          </SelectItem>
                                        ) : (
                                          destinationProjectOptions.map(
                                            (project: any) => {
                                              const projectId = Number(project.id);
                                              const stockQuantity =
                                                getDeliveryScopeStockQuantity(
                                                  item,
                                                  projectId,
                                                  selectedDestinationWarehouseId
                                                );

                                              return (
                                                <SelectItem
                                                  key={project.id}
                                                  value={String(project.id)}
                                                  textValue={getProjectOptionLabel(
                                                    project
                                                  )}
                                                  className="text-xs"
                                                >
                                                  <span className="flex w-full min-w-0 items-center justify-between gap-3 pr-4">
                                                    <span className="truncate">
                                                      {getProjectOptionLabel(project)}
                                                    </span>
                                                    <QuantityPill
                                                      value={stockQuantity}
                                                      unit={item.unit}
                                                      label="Actual"
                                                      tone={
                                                        stockQuantity > 0
                                                          ? "available"
                                                          : "neutral"
                                                      }
                                                    />
                                                  </span>
                                                </SelectItem>
                                              );
                                            }
                                          )
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                                <p className="mt-1 max-w-[334px] truncate text-[10px] text-muted-foreground">
                                  Destino:{" "}
                                  {selectedDestinationProjectOption
                                    ? getProjectOptionLabel(
                                        selectedDestinationProjectOption
                                      )
                                    : "bodega/proyecto"}{" "}
                                  /{" "}
                                  {selectedDestinationWarehouseOption
                                    ? getStockWarehouseLabel(
                                        selectedDestinationWarehouseOption
                                      )
                                    : "almacén físico"}{" "}
                                  · Existencia actual:{" "}
                                  <span className="font-semibold text-emerald-700">
                                    {formatQuantity(destinationStockQuantity)}{" "}
                                    {item.unit || ""}
                                  </span>
                                </p>
                              </td>
                              <td className="px-2 py-3">
                                <Input
                                  className="ml-auto w-24 text-right"
                                  type="number"
                                  min="0"
                                  max={Math.min(pendingQuantity, availableQuantity)}
                                  step="any"
                                  value={deliveryQuantityByItemId[item.id] ?? ""}
                                  onChange={(event) =>
                                    setDeliveryQuantityByItemId((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  disabled={!canDeliver || createDeliveryMutation.isPending}
                                  placeholder="0.00"
                                />
                              </td>
                              <td className="px-2 py-3 text-right align-top">
                                <p className="font-mono">
                                  {formatQuantity(balanceQuantity)} {item.unit || ""}
                                </p>
                                {balanceQuantity > 0 ? (
                                  <p className="text-[10px] text-muted-foreground">
                                    Pendiente
                                  </p>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                    Esta requisición no tiene renglones recibidos disponibles para salida.
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Recibido por *</Label>
                  <Input
                    value={deliveryReceivedByName}
                    onChange={(event) =>
                      setDeliveryReceivedByName(event.target.value)
                    }
                    placeholder="Nombre de quien recibe"
                    maxLength={255}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Textarea
                    value={deliveryNotes}
                    onChange={(event) => setDeliveryNotes(event.target.value)}
                    placeholder="Observaciones para la salida"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <div className="rounded-xl border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                Seleccione una requisición para cargar los ítems disponibles.
              </div>
            )}

            <div className="flex justify-end gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setDeliveryDialogOpen(false)}
                disabled={createDeliveryMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                onClick={submitDelivery}
                disabled={
                  !deliveryRequestDetail ||
                  deliveryItems.length === 0 ||
                  !deliveryReceivedByName.trim() ||
                  createDeliveryMutation.isPending
                }
              >
                {createDeliveryMutation.isPending
                  ? "Creando..."
                  : "Crear salida en borrador"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
