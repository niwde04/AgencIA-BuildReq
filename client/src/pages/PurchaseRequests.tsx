import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clock3,
  Download,
  Eye,
  FileText,
  FolderOpen,
  MapPin,
  Printer,
  RotateCcw,
  Save,
  Search,
  Send,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { buildDatedCsvFileName, downloadCsv } from "@/lib/csv-export";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";
import { getReadablePrintStyles } from "@/lib/readable-print-styles";
import {
  getBuildReqRoleLabel,
  isProcurementApproverRole,
} from "@shared/buildreq-roles";
import {
  isPurchaseRequestConversionReady,
  isPurchaseRequestDraftLike,
  PROCUREMENT_APPROVALS_ENABLED,
} from "@shared/procurement-approvals";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Borrador",
  en_revision: "Pendiente de aprobación",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  parcialmente_convertida: "Parcialmente convertida",
  convertida: "Convertida",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  en_revision: "border-blue-300 bg-blue-50 text-blue-700",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-red-300 bg-red-50 text-red-700",
  parcialmente_convertida: "border-cyan-300 bg-cyan-50 text-cyan-700",
  convertida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-red-300 bg-red-50 text-red-700",
};
const STATUS_FILTER_OPTIONS = Object.entries(STATUS_LABELS).filter(
  ([status]) =>
    PROCUREMENT_APPROVALS_ENABLED ||
    !["en_revision", "rechazada"].includes(status)
);
const getEffectivePurchaseRequestStatus = (
  status?: string | null,
  approvalStatus?: string | null
) =>
  !PROCUREMENT_APPROVALS_ENABLED &&
  isPurchaseRequestDraftLike(status, approvalStatus)
    ? "pendiente"
    : (status ?? "");

const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  no_requiere: "No requiere",
};

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-red-300 bg-red-50 text-red-700",
  no_requiere: "border-slate-300 bg-slate-50 text-slate-700",
};

const APPROVAL_ACTION_LABELS: Record<string, string> = {
  submitted: "Enviada a aprobación",
  submit: "Enviada a aprobación",
  enviada: "Enviada a aprobación",
  approved: "Aprobada",
  approve: "Aprobada",
  aprobada: "Aprobada",
  rejected: "Rechazada",
  reject: "Rechazada",
  rechazada: "Rechazada",
  reopened: "Reabierta para corrección",
  reopen: "Reabierta para corrección",
  reabierta: "Reabierta para corrección",
};

function getApprovalHistory(value: any): any[] {
  const history = value?.approvalHistory;
  return Array.isArray(history) ? history : [];
}

function isApprovalEventApproved(event: any) {
  const action = String(event?.action ?? "").toLowerCase();
  return (
    event?.newStatus === "aprobada" ||
    action === "approved" ||
    action === "approve" ||
    action === "aprobada"
  );
}

function getApprovalEventActorName(event: any) {
  return String(event?.actorName ?? "").trim();
}

function formatApprovalStatus(value?: string | null) {
  if (!value) return "No enviada";
  return APPROVAL_STATUS_LABELS[value] ?? value;
}

function formatApprovalAction(value?: string | null) {
  if (!value) return "Actualización";
  return APPROVAL_ACTION_LABELS[value] ?? value.replaceAll("_", " ");
}

function formatApprovalEventDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-HN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
type PurchaseType = "local" | "extranjera" | "compra_directa";
const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  local: "Compra Local",
  extranjera: "Compra Extranjera",
  compra_directa: "Compra Directa",
};
const getPurchaseTypeLabel = (value?: string | null) =>
  PURCHASE_TYPE_LABELS[value as PurchaseType] ?? "—";

function getUserLabel(user: any, fallback = "—") {
  return user?.name?.trim?.() || user?.email?.trim?.() || fallback;
}

function getPurchaseRequestRequestNumbers(row: any) {
  const requestNumbers = Array.isArray(row.requestNumbers)
    ? row.requestNumbers
    : [];
  return Array.from(
    new Set(
      [row.materialRequest?.requestNumber, ...requestNumbers]
        .map(value => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

function formatPurchaseRequestRequestNumbers(row: any) {
  const requestNumbers = getPurchaseRequestRequestNumbers(row);
  return requestNumbers.length > 0 ? requestNumbers.join(", ") : "—";
}

function formatPurchaseRequestRequestedBy(row: any) {
  const users = Array.isArray(row.requestedByUsers)
    ? row.requestedByUsers
    : row.requestedBy
      ? [row.requestedBy]
      : [];
  const labels = Array.from(
    new Set(users.map((user: any) => getUserLabel(user, "")).filter(Boolean))
  );
  return labels.length > 0 ? labels.join(", ") : "—";
}

function formatPurchaseRequestApprovedBy(row: any) {
  const approval = [...getApprovalHistory(row)]
    .filter(isApprovalEventApproved)
    .sort(
      (left, right) =>
        new Date(right.createdAt ?? 0).getTime() -
        new Date(left.createdAt ?? 0).getTime()
    )[0];
  return getApprovalEventActorName(approval) || "—";
}

type RequestTargetSelection =
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

type PurchaseRequestItemDraft = {
  brand: string;
  costResponsible: string;
  targetSelection: RequestTargetSelection | null;
};

type PurchaseRequestItemDraftTextField = "brand" | "costResponsible";

function mapPurchaseRequestItemTargetToSelection(
  item: any
): RequestTargetSelection | null {
  const target = item.target ?? item.sourceTarget;
  if (target?.type === "subproyecto" && target.subProjectId) {
    return {
      targetType: "subproyecto",
      subProjectId: target.subProjectId,
      projectId:
        target.projectId ?? item.sourceProject?.id ?? item.projectId ?? 0,
      label: target.label ?? `Subproyecto #${target.subProjectId}`,
    };
  }

  if (target?.type === "activo_fijo" && target.fixedAssetSapItemCode) {
    return {
      targetType: "activo_fijo",
      projectId: item.sourceProject?.id ?? item.projectId ?? 0,
      fixedAssetSapItemCode: target.fixedAssetSapItemCode,
      fixedAssetName: target.fixedAssetName ?? "",
      label: target.label ?? `Activo fijo: ${target.fixedAssetSapItemCode}`,
    };
  }

  return null;
}

function buildSubprojectTargetSelection(
  subproject: any
): RequestTargetSelection {
  return {
    targetType: "subproyecto",
    subProjectId: subproject.id,
    projectId: subproject.projectId,
    label: `Subproyecto: ${subproject.code} - ${subproject.name}`,
  };
}

function buildFixedAssetTargetSelection(asset: any): RequestTargetSelection {
  return {
    targetType: "activo_fijo",
    projectId: asset.projectId,
    fixedAssetSapItemCode: asset.itemCode,
    fixedAssetName: asset.description,
    label: `Activo fijo: ${asset.itemCode} - ${asset.description}`,
  };
}

const getItemDraftFromDetail = (item: any): PurchaseRequestItemDraft => ({
  brand: item.brand ?? "",
  costResponsible: item.costResponsible ?? "",
  targetSelection: mapPurchaseRequestItemTargetToSelection(item),
});

const formatQuantity = (value: string | number | null | undefined) =>
  Number(value ?? 0).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const TEMPORARY_FIXED_ASSET_ITEM_NAME = "ACTIVO FIJO TEMPORAL";

function normalizeItemText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase("es-HN");
}

function isTemporaryFixedAssetItem(item: any) {
  return (
    normalizeItemText(item.itemName) === TEMPORARY_FIXED_ASSET_ITEM_NAME ||
    normalizeItemText(item.catalogItem?.description) ===
      TEMPORARY_FIXED_ASSET_ITEM_NAME
  );
}

function getRequesterItemNameForTemporaryFixedAsset(item: any) {
  if (!isTemporaryFixedAssetItem(item)) return null;

  const requestedItemName = String(item.requestedItemName ?? "").trim();
  if (!requestedItemName) return null;
  if (
    normalizeItemText(requestedItemName) === normalizeItemText(item.itemName)
  ) {
    return null;
  }

  return requestedItemName;
}

function getPurchaseRequestItemPartNumber(item: any) {
  return (
    item.partNumber ||
    item.catalogItem?.partNumber ||
    item.currentSapItemCode ||
    item.originalSapItemCode ||
    "-"
  );
}

const getConvertedQuantity = (item: any) => Number(item.convertedQuantity ?? 0);

const getPendingConversionQuantity = (item: any) =>
  Math.max(Number(item.quantity ?? 0) - getConvertedQuantity(item), 0);

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

const toNullablePrintText = (value: string) => value.trim() || null;

const getWarehousePrintDestinationLabel = (warehouse: any) =>
  warehouse?.displayName ||
  [warehouse?.localCode || warehouse?.code, warehouse?.name]
    .filter(Boolean)
    .join(" - ") ||
  `Almacén #${Number(warehouse?.id ?? 0)}`;

export default function PurchaseRequests() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editNeededBy, setEditNeededBy] = useState("");
  const [editPrintDestination, setEditPrintDestination] = useState("");
  const [editPurchaseType, setEditPurchaseType] =
    useState<PurchaseType>("local");
  const [editItems, setEditItems] = useState<
    Record<number, PurchaseRequestItemDraft>
  >({});
  const [convertQuantities, setConvertQuantities] = useState<
    Record<number, string>
  >({});
  const [targetPopoverOpen, setTargetPopoverOpen] = useState<number | null>(
    null
  );
  const [targetSearch, setTargetSearch] = useState("");
  const [debouncedTargetSearch, setDebouncedTargetSearch] = useState("");
  const [selectedRequestIds, setSelectedRequestIds] = useState<number[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [purchaseTypeFilter, setPurchaseTypeFilter] = useState<
    PurchaseType | "all"
  >("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rejectReason, setRejectReason] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const [emailDialog, setEmailDialog] = useState<{
    to: string;
    subject: string;
    content: string;
  } | null>(null);

  const {
    data: requests,
    isLoading,
    error: requestsError,
    refetch: refetchPurchaseRequests,
  } = trpc.purchaseRequests.list.useQuery();
  const {
    data: detail,
    isLoading: isLoadingDetail,
    error: detailError,
  } = trpc.purchaseRequests.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );
  const selectedProjectIdNumber = detail?.purchaseRequest.projectId ?? 0;
  const { data: targetOptions, isLoading: isLoadingTargetOptions } =
    trpc.materialRequests.targetOptions.useQuery(
      {
        projectId: selectedProjectIdNumber,
        search: debouncedTargetSearch || undefined,
      },
      { enabled: selectedProjectIdNumber > 0 }
    );
  const { data: selectedProjectWarehouses } = trpc.warehouses.list.useQuery(
    {
      projectId: selectedProjectIdNumber,
      isActive: true,
    },
    { enabled: selectedProjectIdNumber > 0 }
  );

  const buildreqRole = (user as any)?.buildreqRole;
  const isProcurementApprover = isProcurementApproverRole(buildreqRole);
  const isProjectAdmin = buildreqRole === "administrador_proyecto";
  const isProjectWarehouse = buildreqRole === "bodeguero_proyecto";
  const canManagePurchaseRequests =
    !isProcurementApprover &&
    (user?.role === "admin" ||
      buildreqRole === "jefe_bodega_central" ||
      buildreqRole === "administracion_central" ||
      isProjectAdmin);
  const canAnnulPurchaseRequests =
    !isProcurementApprover && (user?.role === "admin" || isProjectAdmin);
  const canConvert =
    !isProcurementApprover &&
    (user?.role === "admin" ||
      buildreqRole === "administracion_central" ||
      isProjectAdmin);

  const filteredRequests = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (requests ?? []).filter((row: any) => {
      const purchaseRequest = row.purchaseRequest;
      const matchesType =
        purchaseTypeFilter === "all" ||
        purchaseRequest.purchaseType === purchaseTypeFilter;
      const effectiveStatus = getEffectivePurchaseRequestStatus(
        purchaseRequest.status,
        purchaseRequest.approvalStatus
      );
      const matchesStatus =
        statusFilter === "all" || effectiveStatus === statusFilter;
      const projectLabel =
        row.projectSummary?.label ||
        (row.project ? `${row.project.code} ${row.project.name}` : "");
      const requestNumbers = formatPurchaseRequestRequestNumbers(row);
      const requestedByLabel = formatPurchaseRequestRequestedBy(row);
      const approvedByLabel = formatPurchaseRequestApprovedBy(row);
      const matchesSearch =
        !normalizedSearch ||
        [
          purchaseRequest.requestNumber,
          requestNumbers,
          purchaseRequest.sapDocumentNumber,
          projectLabel,
          requestedByLabel,
          approvedByLabel,
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );

      return matchesType && matchesStatus && matchesSearch;
    });
  }, [purchaseTypeFilter, requests, searchTerm, statusFilter]);

  const canConvertPurchaseRequestRow = (row: any) =>
    canConvert &&
    isPurchaseRequestConversionReady(
      row.purchaseRequest.status,
      row.purchaseRequest.approvalStatus
    );

  const updateMutation = trpc.purchaseRequests.update.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra actualizada");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId
          ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const rejectMutation = trpc.purchaseRequests.reject.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra anulada");
      setRejectReason("");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId
          ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const submitForApprovalMutation =
    trpc.purchaseRequests.submitForApproval.useMutation({
      onSuccess: () => {
        toast.success("Solicitud enviada a aprobación");
        setApprovalComment("");
        void Promise.all([
          utils.purchaseRequests.list.invalidate(),
          selectedId
            ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
            : Promise.resolve(),
        ]);
      },
      onError: (error: { message: string }) => toast.error(error.message),
    });

  const reviewApprovalMutation =
    trpc.purchaseRequests.reviewApproval.useMutation({
      onSuccess: (
        _result: unknown,
        variables: { decision: "approve" | "reject" }
      ) => {
        toast.success(
          variables.decision === "approve"
            ? "Solicitud aprobada"
            : "Solicitud rechazada"
        );
        setApprovalComment("");
        void Promise.all([
          utils.purchaseRequests.list.invalidate(),
          selectedId
            ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
            : Promise.resolve(),
        ]);
      },
      onError: (error: { message: string }) => toast.error(error.message),
    });

  const reopenRejectedMutation =
    trpc.purchaseRequests.reopenRejected.useMutation({
      onSuccess: () => {
        toast.success("Solicitud reabierta para corrección");
        setApprovalComment("");
        void Promise.all([
          utils.purchaseRequests.list.invalidate(),
          selectedId
            ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
            : Promise.resolve(),
        ]);
      },
      onError: (error: { message: string }) => toast.error(error.message),
    });

  const convertMutation =
    trpc.purchaseOrders.createFromPurchaseRequest.useMutation({
      onSuccess: result => {
        const purchaseOrderNumbers =
          "purchaseOrders" in result && Array.isArray(result.purchaseOrders)
            ? result.purchaseOrders.map(entry => entry.purchaseOrderNumber)
            : result.purchaseOrderNumber
              ? [result.purchaseOrderNumber]
              : [];

        toast.success(
          purchaseOrderNumbers.length === 1
            ? `OC ${purchaseOrderNumbers[0]} generada`
            : `Se generaron ${purchaseOrderNumbers.length} órdenes de compra`
        );
        setSelectedItemIds([]);
        void Promise.all([
          utils.purchaseRequests.list.invalidate(),
          utils.purchaseOrders.list.invalidate(),
          selectedId
            ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
            : Promise.resolve(),
        ]);
      },
      onError: error => toast.error(error.message),
    });

  const unifiedConvertMutation =
    trpc.purchaseOrders.createUnifiedFromPurchaseRequests.useMutation({
      onSuccess: async result => {
        const convertedIds = new Set(result.purchaseRequestIds ?? []);
        utils.purchaseRequests.list.setData(undefined, (current: any) =>
          current?.map((row: any) =>
            convertedIds.has(row.purchaseRequest.id)
              ? {
                  ...row,
                  purchaseRequest: {
                    ...row.purchaseRequest,
                    status: "convertida",
                  },
                }
              : row
          )
        );
        toast.success(`OC unificada ${result.purchaseOrderNumber} generada`);
        setSelectedRequestIds([]);
        await Promise.all([
          utils.purchaseRequests.list.invalidate(),
          utils.purchaseOrders.list.invalidate(),
          refetchPurchaseRequests(),
        ]);
      },
      onError: error => toast.error(error.message),
    });

  const attachQuoteMutation = trpc.purchaseRequests.attachQuote.useMutation({
    onSuccess: () => {
      toast.success("Cotización aprobada adjuntada");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId
          ? utils.purchaseRequests.getById.invalidate({ id: selectedId })
          : Promise.resolve(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  const selectedItems = useMemo(() => {
    return detail?.items ?? [];
  }, [detail]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedTargetSearch(targetSearch.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [targetSearch]);

  useEffect(() => {
    if (!detail) {
      setEditItems({});
      setConvertQuantities({});
      return;
    }

    setEditItems(
      Object.fromEntries(
        (detail.items ?? []).map((item: any) => [
          item.id,
          getItemDraftFromDetail(item),
        ])
      )
    );
    setConvertQuantities(
      Object.fromEntries(
        (detail.items ?? []).map((item: any) => [
          item.id,
          String(
            item.pendingConversionQuantity ??
              getPendingConversionQuantity(item).toFixed(2)
          ),
        ])
      )
    );
  }, [detail]);

  const getItemDraft = (item: any) =>
    editItems[item.id] ?? getItemDraftFromDetail(item);

  const updateItemDraft = (
    item: any,
    field: PurchaseRequestItemDraftTextField,
    value: string
  ) => {
    setEditItems(current => ({
      ...current,
      [item.id]: {
        ...getItemDraftFromDetail(item),
        ...current[item.id],
        [field]: value,
      },
    }));
  };

  const updateItemTargetDraft = (
    item: any,
    targetSelection: RequestTargetSelection | null
  ) => {
    setEditItems(current => ({
      ...current,
      [item.id]: {
        ...getItemDraftFromDetail(item),
        ...current[item.id],
        targetSelection,
      },
    }));
  };

  const getConvertQuantityDraft = (item: any) =>
    convertQuantities[item.id] ??
    String(
      item.pendingConversionQuantity ??
        getPendingConversionQuantity(item).toFixed(2)
    );

  const updateConvertQuantityDraft = (item: any, value: string) => {
    setConvertQuantities(current => ({
      ...current,
      [item.id]: value,
    }));
  };

  const buildItemUpdatePayload = () => {
    return selectedItems.map((item: any) => {
      const draft = getItemDraft(item);
      const payload: any = {
        id: item.id,
        brand: toNullablePrintText(draft.brand),
        costResponsible: toNullablePrintText(draft.costResponsible),
      };

      if (canEditPurchaseRequestDestination) {
        payload.targetType = draft.targetSelection?.targetType ?? null;
        payload.subProjectId =
          draft.targetSelection?.targetType === "subproyecto"
            ? draft.targetSelection.subProjectId
            : null;
        payload.fixedAssetSapItemCode =
          draft.targetSelection?.targetType === "activo_fijo"
            ? draft.targetSelection.fixedAssetSapItemCode
            : null;
        payload.fixedAssetName =
          draft.targetSelection?.targetType === "activo_fijo"
            ? draft.targetSelection.fixedAssetName
            : null;
      }

      return payload;
    });
  };

  const buildConversionPayload = () => {
    const selectedIds =
      selectedItemIds.length > 0 ? selectedItemIds : convertibleItemIds;
    const itemsToConvert = selectedItems
      .filter((item: any) => selectedIds.includes(item.id))
      .map((item: any) => {
        const pendingQuantity = getPendingConversionQuantity(item);
        const quantity = Number(getConvertQuantityDraft(item) || 0);
        return {
          item,
          pendingQuantity,
          quantity,
        };
      });

    const invalidItem = itemsToConvert.find(
      ({ quantity }) => !Number.isFinite(quantity) || quantity <= 0
    );
    if (invalidItem) {
      toast.error(
        `Ingrese una cantidad a convertir para ${invalidItem.item.itemName}`
      );
      return null;
    }

    const excessItem = itemsToConvert.find(
      ({ quantity, pendingQuantity }) => quantity > pendingQuantity
    );
    if (excessItem) {
      toast.error(
        `La cantidad a convertir de ${excessItem.item.itemName} excede el pendiente`
      );
      return null;
    }

    return itemsToConvert.map(({ item, quantity }) => ({
      purchaseRequestItemId: item.id,
      quantity: quantity.toFixed(2),
    }));
  };

  const convertibleItemIds = useMemo(() => {
    if (!canConvert) return [];
    const rawAssignedProjectIds = (user as any)?.assignedProjectIds;
    const assignedProjectIds =
      Array.isArray(rawAssignedProjectIds) && rawAssignedProjectIds.length > 0
        ? rawAssignedProjectIds.map(Number)
        : (user as any)?.assignedProjectId
          ? [(user as any).assignedProjectId]
          : [];
    const canUseAllProjects = isProjectAdmin && assignedProjectIds.length === 0;

    return selectedItems
      .filter((item: any) => {
        if (getPendingConversionQuantity(item) <= 0) return false;
        if (!isProjectAdmin) return true;
        if (canUseAllProjects) return true;
        const itemProjectId =
          item.sourceProject?.id ?? detail?.purchaseRequest.projectId;
        return assignedProjectIds.includes(itemProjectId);
      })
      .map((item: any) => item.id);
  }, [
    canConvert,
    detail?.purchaseRequest.projectId,
    isProjectAdmin,
    selectedItems,
    user,
  ]);

  const convertibleItemIdSet = useMemo(
    () => new Set(convertibleItemIds),
    [convertibleItemIds]
  );

  const itemIdsToConvert = useMemo(
    () =>
      selectedItemIds.length > 0
        ? selectedItemIds.filter(id => convertibleItemIdSet.has(id))
        : convertibleItemIds,
    [convertibleItemIdSet, convertibleItemIds, selectedItemIds]
  );

  const convertibleRequestIds = useMemo(
    () =>
      filteredRequests
        .filter((row: any) => canConvertPurchaseRequestRow(row))
        .map((row: any) => row.purchaseRequest.id),
    [filteredRequests, canConvert, isProjectAdmin]
  );
  const allConvertibleSelected =
    convertibleRequestIds.length > 0 &&
    convertibleRequestIds.every((id: number) =>
      selectedRequestIds.includes(id)
    );
  const someConvertibleSelected =
    convertibleRequestIds.some((id: number) =>
      selectedRequestIds.includes(id)
    ) && !allConvertibleSelected;

  useEffect(() => {
    setSelectedRequestIds(current =>
      current.filter(id => convertibleRequestIds.includes(id))
    );
  }, [convertibleRequestIds]);

  useEffect(() => {
    setSelectedItemIds(current =>
      current.filter(id => convertibleItemIdSet.has(id))
    );
  }, [convertibleItemIdSet]);

  const projectLabel =
    detail?.projectSummary?.label ||
    (detail?.project
      ? `${detail.project.code} — ${detail.project.name}`
      : detail?.purchaseRequest
        ? `Proyecto ${detail.purchaseRequest.projectId}`
        : "Proyecto pendiente");
  const getItemTargetLabel = (item: any) =>
    getItemDraft(item).targetSelection?.label ?? "—";
  const isMixedProjectRequest = Boolean(detail?.projectSummary?.isMixed);
  const isConvertedPurchaseRequest =
    detail?.purchaseRequest.status === "convertida";
  const isCancelledPurchaseRequest =
    detail?.purchaseRequest.status === "anulada";
  const isRejectedPurchaseRequest =
    PROCUREMENT_APPROVALS_ENABLED &&
    (detail?.purchaseRequest.approvalStatus === "rechazada" ||
      detail?.purchaseRequest.status === "rechazada");
  const isPendingApprovalPurchaseRequest =
    PROCUREMENT_APPROVALS_ENABLED &&
    (detail?.purchaseRequest.approvalStatus === "pendiente" ||
      detail?.purchaseRequest.status === "en_revision");
  const isApprovedPurchaseRequest =
    detail?.purchaseRequest.approvalStatus === "aprobada";
  const isDraftPurchaseRequest = isPurchaseRequestDraftLike(
    detail?.purchaseRequest.status,
    detail?.purchaseRequest.approvalStatus
  );
  const canEditSelectedPurchaseRequest =
    canManagePurchaseRequests && isDraftPurchaseRequest;
  const canManagePurchaseRequestAttachments =
    !isProcurementApprover &&
    (canManagePurchaseRequests || isProjectWarehouse) &&
    isDraftPurchaseRequest;
  const canEditPurchaseRequestDestination =
    canEditSelectedPurchaseRequest &&
    (user?.role === "admin" ||
      buildreqRole === "administracion_central" ||
      isProjectAdmin);
  const canConvertSelectedPurchaseRequest =
    canConvert &&
    isPurchaseRequestConversionReady(
      detail?.purchaseRequest.status,
      detail?.purchaseRequest.approvalStatus
    );
  const canSubmitSelectedPurchaseRequest =
    PROCUREMENT_APPROVALS_ENABLED &&
    canManagePurchaseRequests &&
    isDraftPurchaseRequest;
  const canReviewSelectedPurchaseRequest =
    PROCUREMENT_APPROVALS_ENABLED &&
    isProcurementApprover &&
    isPendingApprovalPurchaseRequest;
  const canReopenSelectedPurchaseRequest =
    PROCUREMENT_APPROVALS_ENABLED &&
    canManagePurchaseRequests &&
    isRejectedPurchaseRequest;
  const canAnnulSelectedPurchaseRequest =
    canAnnulPurchaseRequests && isDraftPurchaseRequest;
  const approvalHistory = getApprovalHistory(detail);

  const purchaseTypeLabel = getPurchaseTypeLabel(editPurchaseType);
  const printDestinationOptions = selectedProjectWarehouses ?? [];
  const customPrintDestination =
    editPrintDestination.trim() &&
    !printDestinationOptions.some(
      (warehouse: any) =>
        getWarehousePrintDestinationLabel(warehouse) ===
        editPrintDestination.trim()
    )
      ? editPrintDestination.trim()
      : null;
  const printDestinationSelectValue =
    editPrintDestination.trim() || "__project_default__";

  const renderItemTargetCombobox = (
    item: any,
    draft: PurchaseRequestItemDraft
  ) => {
    const open = targetPopoverOpen === item.id;
    const disabled =
      !canEditPurchaseRequestDestination || !selectedProjectIdNumber;

    return (
      <div className="flex gap-2">
        <Popover
          open={open}
          onOpenChange={nextOpen => {
            setTargetPopoverOpen(nextOpen ? item.id : null);
            setTargetSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="h-9 min-w-0 flex-1 justify-between px-3 font-normal"
            >
              <span className="truncate">
                {draft.targetSelection?.label ?? "Subproyecto o activo fijo"}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(520px,calc(100vw-2rem))] p-0"
            align="start"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Buscar subproyecto o activo fijo..."
                value={targetSearch}
                onValueChange={setTargetSearch}
              />
              <CommandList>
                {isLoadingTargetOptions ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    Buscando opciones...
                  </div>
                ) : (
                  <>
                    <CommandEmpty>No se encontraron opciones.</CommandEmpty>
                    {(targetOptions?.subprojects ?? []).length > 0 ? (
                      <CommandGroup heading="Subproyectos">
                        {(targetOptions?.subprojects ?? []).map(
                          (subproject: any) => {
                            const selected =
                              draft.targetSelection?.targetType ===
                                "subproyecto" &&
                              draft.targetSelection.subProjectId ===
                                subproject.id;

                            return (
                              <CommandItem
                                key={`subproject-${subproject.id}`}
                                value={`subproject-${subproject.id}-${subproject.code}-${subproject.name}`}
                                onSelect={() => {
                                  updateItemTargetDraft(
                                    item,
                                    buildSubprojectTargetSelection(subproject)
                                  );
                                  setTargetPopoverOpen(null);
                                  setTargetSearch("");
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

                    {(targetOptions?.fixedAssets ?? []).length > 0 ? (
                      <CommandGroup heading="Activos fijos">
                        {(targetOptions?.fixedAssets ?? []).map(
                          (asset: any) => {
                            const selected =
                              draft.targetSelection?.targetType ===
                                "activo_fijo" &&
                              draft.targetSelection.fixedAssetSapItemCode ===
                                asset.itemCode;

                            return (
                              <CommandItem
                                key={`asset-${asset.itemCode}`}
                                value={`asset-${asset.itemCode}-${asset.description}`}
                                onSelect={() => {
                                  updateItemTargetDraft(
                                    item,
                                    buildFixedAssetTargetSelection(asset)
                                  );
                                  setTargetPopoverOpen(null);
                                  setTargetSearch("");
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
                                  {asset.itemGroup ? (
                                    <p className="truncate text-xs text-muted-foreground">
                                      {asset.itemGroup}
                                    </p>
                                  ) : null}
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

        {draft.targetSelection && !disabled ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => updateItemTargetDraft(item, null)}
            aria-label="Limpiar destino del ítem"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    );
  };

  const openRequest = (id: number) => {
    setSelectedId(id);
    const row = requests?.find((entry: any) => entry.purchaseRequest.id === id);
    setEditNotes(row?.purchaseRequest.notes || "");
    setEditNeededBy(
      row?.purchaseRequest.neededBy
        ? new Date(row.purchaseRequest.neededBy).toISOString().slice(0, 10)
        : ""
    );
    setEditPurchaseType(
      (row?.purchaseRequest.purchaseType || "local") as PurchaseType
    );
    setEditPrintDestination(row?.purchaseRequest.printDestination || "");
    setEditItems({});
    setConvertQuantities({});
    setTargetPopoverOpen(null);
    setTargetSearch("");
    setDebouncedTargetSearch("");
    setSelectedItemIds([]);
    setRejectReason("");
    setApprovalComment("");
  };

  const toggleRequestSelection = (id: number, checked: boolean) => {
    setSelectedRequestIds(current =>
      checked
        ? Array.from(new Set([...current, id]))
        : current.filter(entry => entry !== id)
    );
  };

  const toggleAllConvertibleRequests = (checked: boolean) => {
    setSelectedRequestIds(checked ? convertibleRequestIds : []);
  };

  const handleSaveChanges = () => {
    if (!detail) return;
    const items = buildItemUpdatePayload();
    if (!items) return;

    updateMutation.mutate({
      id: detail.purchaseRequest.id,
      purchaseType: editPurchaseType,
      neededBy: editNeededBy || undefined,
      printDestination: toNullablePrintText(editPrintDestination),
      notes: editNotes || undefined,
      items,
    });
  };

  const handleSubmitForApproval = async () => {
    if (!detail || !canSubmitSelectedPurchaseRequest) return;
    const items = buildItemUpdatePayload();

    try {
      await updateMutation.mutateAsync({
        id: detail.purchaseRequest.id,
        purchaseType: editPurchaseType,
        neededBy: editNeededBy || undefined,
        printDestination: toNullablePrintText(editPrintDestination),
        notes: editNotes || undefined,
        items,
      });
      submitForApprovalMutation.mutate({ id: detail.purchaseRequest.id });
    } catch {
      // updateMutation displays the validation or server error toast.
    }
  };

  const handleReviewApproval = (decision: "approve" | "reject") => {
    if (!detail || !canReviewSelectedPurchaseRequest) return;
    const comment = approvalComment.trim();
    if (decision === "reject" && comment.length < 5) {
      toast.error("Indica un motivo de rechazo de al menos 5 caracteres");
      return;
    }

    reviewApprovalMutation.mutate({
      id: detail.purchaseRequest.id,
      decision,
      comment: comment || undefined,
    });
  };

  const handleReopenRejected = () => {
    if (!detail || !canReopenSelectedPurchaseRequest) return;
    reopenRejectedMutation.mutate({ id: detail.purchaseRequest.id });
  };

  const handleConvertToPurchaseOrder = () => {
    if (!detail) return;
    const itemsToConvert = buildConversionPayload();
    if (!itemsToConvert || itemsToConvert.length === 0) return;

    convertMutation.mutate({
      purchaseRequestId: detail.purchaseRequest.id,
      selectedItemIds: itemsToConvert.map(item => item.purchaseRequestItemId),
      itemsToConvert,
    });
  };

  const handlePrintDocument = () => {
    if (!detail) return;

    const purchaseRequest = detail.purchaseRequest;
    const documentNumber =
      purchaseRequest.sapDocumentNumber || purchaseRequest.requestNumber;
    const jobLabel = detail.project
      ? `${detail.project.code} ${detail.project.name}`
      : projectLabel;
    const warehouseLabel =
      editPrintDestination.trim() ||
      purchaseRequest.printDestination?.trim() ||
      detail.warehouse?.displayName ||
      detail.project?.name ||
      projectLabel;
    const requestedByLabel =
      detail.requestedBy?.name ||
      detail.requestedBy?.email ||
      detail.createdBy?.name ||
      detail.createdBy?.email ||
      "-";
    const observations = editNotes.trim() || "-";
    const totalQuantity = selectedItems.reduce((sum: number, item: any) => {
      const quantity = Number(item.quantity || 0);
      return sum + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);
    const itemRows = selectedItems
      .map((item: any) => {
        const draft = getItemDraft(item);
        const quantity = formatQuantity(item.quantity);
        const code = item.currentSapItemCode || item.originalSapItemCode || "-";
        const partNumber = getPurchaseRequestItemPartNumber(item);
        const requesterItemName =
          getRequesterItemNameForTemporaryFixedAsset(item);
        const itemDescriptionMarkup = requesterItemName
          ? `${escapeHtml(item.itemName)}<br><span class="muted">Solicitado: ${escapeHtml(requesterItemName)}</span>`
          : escapeHtml(item.itemName);
        return `
          <tr>
            <td>${escapeHtml(code)}</td>
            <td class="numeric">${escapeHtml(quantity)}</td>
            <td>${itemDescriptionMarkup}</td>
            <td>${escapeHtml(partNumber)}</td>
            <td>${escapeHtml(getItemTargetLabel(item))}</td>
            <td>${escapeHtml(draft.brand || "-")}</td>
            <td>${escapeHtml(item.unit || "-")}</td>
            <td>${escapeHtml(draft.costResponsible || "-")}</td>
          </tr>
        `;
      })
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
          <title>${escapeHtml(purchaseRequest.requestNumber)}</title>
          <style>
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body {
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 10px;
              margin: 0;
              background: #ffffff;
            }
            .sheet {
              margin: 0 auto;
              max-width: 190mm;
              padding: 8mm 4mm 10mm;
            }
            .header {
              align-items: flex-start;
              display: grid;
              grid-template-columns: 70px minmax(0, 1fr) 132px;
              gap: 12px;
            }
            .logo {
              display: block;
              height: 48px;
              object-fit: contain;
              width: 66px;
            }
            .company {
              color: #000;
              font-size: 13px;
              font-weight: 800;
              line-height: 1.4;
              text-align: center;
            }
            .title-box {
              display: inline-block;
              font-size: 13px;
              margin-top: 2px;
              padding: 2px 0;
            }
            .document-number {
              border: 5px double #222;
              color: #000;
              font-size: 11px;
              font-weight: 800;
              margin-top: 1mm;
              padding: 5px 8px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 6px 34px;
              grid-template-columns: 1fr 1fr;
              margin-top: 8mm;
            }
            .field {
              display: grid;
              grid-template-columns: 96px 1fr;
              gap: 8px;
              min-height: 16px;
            }
            .label {
              color: #000;
              font-weight: 800;
            }
            .value {
              color: #000;
              font-weight: 700;
            }
            table {
              border-collapse: collapse;
              margin-top: 6mm;
              table-layout: fixed;
              width: 100%;
            }
            th, td {
              border-bottom: 2px solid #111;
              border-top: 2px solid #111;
              overflow-wrap: anywhere;
              padding: 3px 4px;
              vertical-align: top;
            }
            th {
              color: #000;
              font-weight: 800;
              text-align: left;
            }
            .numeric {
              font-weight: 800;
              text-align: right;
            }
            .muted {
              color: #444;
              font-size: 9px;
              font-weight: 700;
            }
            .summary td {
              border-top: 2px solid #111;
              font-weight: 800;
            }
            .observations {
              display: grid;
              grid-template-columns: 96px 1fr;
              gap: 34px;
              margin-top: 9mm;
            }
            .observation-text {
              font-weight: 700;
              min-height: 34px;
              white-space: pre-wrap;
            }
            .signatures {
              align-items: end;
              display: grid;
              gap: 16px;
              grid-template-columns: repeat(3, 1fr);
              margin: 18mm auto 0;
              max-width: 170mm;
            }
            .signature-line {
              border-top: 2px solid #111;
              font-size: 12px;
              font-weight: 700;
              padding-top: 4px;
              text-align: center;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
            ${getReadablePrintStyles()}
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
              <div class="company">
                <div>HIDALGO E HIDALGO HONDURAS S.A. DE C.V.</div>
                <div>${escapeHtml(warehouseLabel)}</div>
                <div class="title-box">SOLICITUD DE COMPRA</div>
              </div>
              <div class="document-number">${escapeHtml(documentNumber)}</div>
            </section>

            <section class="meta">
              <div class="field">
                <div class="label">Fecha:</div>
                <div class="value">${escapeHtml(formatPrintDate(purchaseRequest.createdAt))}</div>
              </div>
              <div class="field">
                <div class="label">Job:</div>
                <div class="value">${escapeHtml(jobLabel)}</div>
              </div>
              <div class="field">
                <div class="label">Solicitado:</div>
                <div class="value">${escapeHtml(requestedByLabel)}</div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width: 13%;">Codigo</th>
                  <th style="width: 9%;" class="numeric">Cantidad</th>
                  <th style="width: 18%;">Descripción</th>
                  <th style="width: 12%;">No. Parte</th>
                  <th style="width: 17%;">Destino</th>
                  <th style="width: 10%;">Marca</th>
                  <th style="width: 7%;">U.M</th>
                  <th style="width: 14%;">Responsable compra</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="8">Sin ítems</td></tr>`}
                <tr class="summary">
                  <td colspan="6">Total solicitado</td>
                  <td class="numeric">${escapeHtml(formatQuantity(totalQuantity))}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>

            <section class="observations">
              <div class="label">Observaciones:</div>
              <div class="observation-text">${escapeHtml(observations)}</div>
            </section>

            <section class="signatures">
              <div class="signature-line">Elaborado por:</div>
              <div class="signature-line">Solicitado por:</div>
              <div class="signature-line">Autorizado por:</div>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
  };

  const exportPurchaseRequestsCsv = () => {
    downloadCsv(
      buildDatedCsvFileName("solicitudes-compra"),
      [
        {
          header: "No. Solicitud",
          value: (row: any) => row.purchaseRequest.requestNumber,
        },
        {
          header: "No. Req.",
          value: (row: any) => formatPurchaseRequestRequestNumbers(row),
        },
        {
          header: "Proyecto",
          value: (row: any) =>
            row.projectSummary?.label ||
            (row.project ? `${row.project.code} — ${row.project.name}` : "—"),
        },
        {
          header: "Requiriente",
          value: (row: any) => formatPurchaseRequestRequestedBy(row),
        },
        {
          header: "Aprobado por",
          value: (row: any) => formatPurchaseRequestApprovedBy(row),
        },
        {
          header: "Tipo de Compra",
          value: (row: any) =>
            getPurchaseTypeLabel(row.purchaseRequest.purchaseType),
        },
        {
          header: "Fecha creación",
          value: (row: any) =>
            row.purchaseRequest.createdAt
              ? new Date(row.purchaseRequest.createdAt).toLocaleDateString(
                  "es-HN"
                )
              : "—",
        },
        {
          header: "Doc SAP",
          value: (row: any) => row.purchaseRequest.sapDocumentNumber || "—",
        },
        {
          header: "Estatus",
          value: (row: any) =>
            STATUS_LABELS[
              getEffectivePurchaseRequestStatus(
                row.purchaseRequest.status,
                row.purchaseRequest.approvalStatus
              )
            ] || row.purchaseRequest.status,
        },
        {
          header: "Fecha necesaria",
          value: (row: any) =>
            row.purchaseRequest.neededBy
              ? new Date(row.purchaseRequest.neededBy).toLocaleDateString(
                  "es-HN"
                )
              : "—",
        },
        {
          header: "Documento",
          value: (row: any) =>
            row.purchaseRequest.printedDocumentContent ? "Listo" : "Pendiente",
        },
      ],
      filteredRequests
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Solicitudes de Compra</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={exportPurchaseRequestsCsv}
            disabled={!filteredRequests.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          {canConvert && selectedRequestIds.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() =>
                  unifiedConvertMutation.mutate({
                    purchaseRequestIds: selectedRequestIds,
                  })
                }
                disabled={unifiedConvertMutation.isPending}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                {unifiedConvertMutation.isPending
                  ? "Creando..."
                  : `Crear orden de compra unificada (${selectedRequestIds.length})`}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder={
              PROCUREMENT_APPROVALS_ENABLED
                ? "Buscar por SC, REQ, proyecto, requiriente, aprobador o documento..."
                : "Buscar por SC, REQ, proyecto, requiriente o documento..."
            }
            className="h-10 pl-9"
          />
        </div>
        <Select
          value={purchaseTypeFilter}
          onValueChange={value =>
            setPurchaseTypeFilter(value as PurchaseType | "all")
          }
        >
          <SelectTrigger className="h-10 w-full lg:w-64">
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
            {STATUS_FILTER_OPTIONS.map(([value, label]) => (
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
              Cargando solicitudes de compra...
            </div>
          ) : requestsError ? (
            <div className="p-8 text-center text-destructive">
              No se pudieron cargar las solicitudes de compra:{" "}
              {requestsError.message}
            </div>
          ) : !(requests || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de compra registradas
            </div>
          ) : !filteredRequests.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de compra que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1700px] text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {canConvert ? (
                      <th className="w-16 p-3 text-left">
                        <Checkbox
                          checked={
                            allConvertibleSelected
                              ? true
                              : someConvertibleSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={checked =>
                            toggleAllConvertibleRequests(checked === true)
                          }
                          aria-label="Seleccionar solicitudes convertibles"
                          disabled={convertibleRequestIds.length === 0}
                        />
                      </th>
                    ) : null}
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Solicitud
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Req.
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Requiriente
                    </th>
                    {PROCUREMENT_APPROVALS_ENABLED ? (
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Aprobado por
                      </th>
                    ) : null}
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo de Compra
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha creación
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Doc SAP
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado SC
                    </th>
                    {PROCUREMENT_APPROVALS_ENABLED ? (
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Aprobación
                      </th>
                    ) : null}
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha necesaria
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documento
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((row: any) => {
                    const canSelectForUnified =
                      canConvertPurchaseRequestRow(row);

                    return (
                      <tr
                        key={row.purchaseRequest.id}
                        className="border-b border-border last:border-0"
                      >
                        {canConvert ? (
                          <td className="p-3">
                            <Checkbox
                              checked={selectedRequestIds.includes(
                                row.purchaseRequest.id
                              )}
                              onCheckedChange={checked =>
                                toggleRequestSelection(
                                  row.purchaseRequest.id,
                                  checked === true
                                )
                              }
                              disabled={!canSelectForUnified}
                              aria-label={`Seleccionar ${row.purchaseRequest.requestNumber}`}
                            />
                          </td>
                        ) : null}
                        <td className="p-3 font-medium">
                          {row.purchaseRequest.requestNumber}
                        </td>
                        <td className="p-3 text-xs font-medium">
                          {formatPurchaseRequestRequestNumbers(row)}
                        </td>
                        <td className="p-3 text-xs">
                          {row.projectSummary?.label ||
                            (row.project
                              ? `${row.project.code} — ${row.project.name}`
                              : "—")}
                        </td>
                        <td className="p-3 text-xs">
                          {formatPurchaseRequestRequestedBy(row)}
                        </td>
                        {PROCUREMENT_APPROVALS_ENABLED ? (
                          <td className="p-3 text-xs">
                            {formatPurchaseRequestApprovedBy(row)}
                          </td>
                        ) : null}
                        <td className="p-3 text-xs">
                          {getPurchaseTypeLabel(
                            row.purchaseRequest.purchaseType
                          )}
                        </td>
                        <td className="p-3 text-xs">
                          {row.purchaseRequest.createdAt
                            ? new Date(
                                row.purchaseRequest.createdAt
                              ).toLocaleDateString("es-HN")
                            : "—"}
                        </td>
                        <td className="p-3 text-xs">
                          {row.purchaseRequest.sapDocumentNumber || "—"}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              STATUS_COLORS[
                                getEffectivePurchaseRequestStatus(
                                  row.purchaseRequest.status,
                                  row.purchaseRequest.approvalStatus
                                )
                              ] || ""
                            }`}
                          >
                            {STATUS_LABELS[
                              getEffectivePurchaseRequestStatus(
                                row.purchaseRequest.status,
                                row.purchaseRequest.approvalStatus
                              )
                            ] || row.purchaseRequest.status}
                          </Badge>
                        </td>
                        {PROCUREMENT_APPROVALS_ENABLED ? (
                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                APPROVAL_STATUS_COLORS[
                                  row.purchaseRequest.approvalStatus
                                ] || ""
                              }`}
                            >
                              {formatApprovalStatus(
                                row.purchaseRequest.approvalStatus
                              )}
                            </Badge>
                          </td>
                        ) : null}
                        <td className="p-3 text-xs">
                          {row.purchaseRequest.neededBy
                            ? new Date(
                                row.purchaseRequest.neededBy
                              ).toLocaleDateString("es-HN")
                            : "—"}
                        </td>
                        <td className="p-3 text-xs">
                          {row.purchaseRequest.printedDocumentContent
                            ? "Listo"
                            : "Pendiente"}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openRequest(row.purchaseRequest.id)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Ver
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={open => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="flex h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] flex-col overflow-hidden rounded-2xl border border-border/70 p-0 shadow-2xl sm:h-[calc(100dvh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1500px]">
          <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-12 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-2">
                <DialogTitle className="text-3xl font-bold tracking-tight sm:text-[2.15rem]">
                  {detail?.purchaseRequest.requestNumber ||
                    "Solicitud de Compra"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {isCancelledPurchaseRequest
                    ? "Esta solicitud fue anulada y se muestra en modo solo lectura."
                    : isConvertedPurchaseRequest
                      ? "Esta solicitud ya fue convertida a orden de compra y se muestra en modo solo lectura."
                      : !PROCUREMENT_APPROVALS_ENABLED
                        ? "Revisa la solicitud y conviértela directamente en orden de compra cuando esté lista."
                        : isRejectedPurchaseRequest
                          ? "La aprobación fue rechazada. El responsable debe reabrirla antes de corregirla y reenviarla."
                          : isPendingApprovalPurchaseRequest
                            ? "La solicitud está pendiente de decisión y permanece bloqueada para edición."
                            : isApprovedPurchaseRequest
                              ? "La solicitud fue aprobada y puede convertirse a orden de compra."
                              : "Revisa y completa la solicitud antes de enviarla a aprobación."}
                </p>
              </div>
              {detail && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`rounded-full px-3 py-1 text-xs uppercase ${
                      STATUS_COLORS[
                        getEffectivePurchaseRequestStatus(
                          detail.purchaseRequest.status,
                          detail.purchaseRequest.approvalStatus
                        )
                      ] || ""
                    }`}
                  >
                    {STATUS_LABELS[
                      getEffectivePurchaseRequestStatus(
                        detail.purchaseRequest.status,
                        detail.purchaseRequest.approvalStatus
                      )
                    ] || detail.purchaseRequest.status}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="rounded-full px-3 py-1 text-xs"
                  >
                    {selectedItems.length} ítem(s)
                  </Badge>
                  {PROCUREMENT_APPROVALS_ENABLED ? (
                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-1 text-xs uppercase ${
                        APPROVAL_STATUS_COLORS[
                          detail.purchaseRequest.approvalStatus ?? ""
                        ] || ""
                      }`}
                    >
                      Aprobación:{" "}
                      {formatApprovalStatus(
                        detail.purchaseRequest.approvalStatus
                      )}
                    </Badge>
                  ) : null}
                </div>
              )}
            </div>
          </DialogHeader>

          {!detail && (isLoadingDetail || detailError) ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-16 text-center">
              <div className="max-w-md space-y-2">
                <p className="text-sm font-medium">
                  {detailError
                    ? "No se pudo cargar la solicitud de compra"
                    : "Cargando solicitud de compra..."}
                </p>
                {detailError ? (
                  <p className="text-sm text-muted-foreground">
                    {detailError.message}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {detail && (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
              <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <FolderOpen className="h-4 w-4" />
                    Proyecto
                  </div>
                  <p className="text-lg font-semibold leading-snug">
                    {projectLabel}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Documento:{" "}
                    {detail.purchaseRequest.printedDocumentContent
                      ? "Listo para descarga"
                      : "Pendiente de generar"}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    Destino impreso
                  </div>
                  <Select
                    value={printDestinationSelectValue}
                    onValueChange={value =>
                      setEditPrintDestination(
                        value === "__project_default__" ? "" : value
                      )
                    }
                    disabled={!canEditSelectedPurchaseRequest}
                  >
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue placeholder="Usar bodega principal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__project_default__">
                        Usar bodega principal
                      </SelectItem>
                      {printDestinationOptions.map((warehouse: any) => {
                        const label =
                          getWarehousePrintDestinationLabel(warehouse);
                        return (
                          <SelectItem key={warehouse.id} value={label}>
                            {label}
                          </SelectItem>
                        );
                      })}
                      {customPrintDestination ? (
                        <SelectItem value={customPrintDestination} disabled>
                          {customPrintDestination}
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Solo aparece en el encabezado de impresión.
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    Tipo de compra
                  </div>
                  <Select
                    value={editPurchaseType}
                    onValueChange={value =>
                      setEditPurchaseType(value as PurchaseType)
                    }
                    disabled={!canEditSelectedPurchaseRequest}
                  >
                    <SelectTrigger className="h-12 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Compra Local</SelectItem>
                      <SelectItem value="extranjera">
                        Compra Extranjera
                      </SelectItem>
                      <SelectItem value="compra_directa">
                        Compra Directa
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {purchaseTypeLabel}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    <CalendarDays className="h-4 w-4" />
                    Fecha necesaria
                  </div>
                  <Input
                    className="h-12 text-base"
                    type="date"
                    value={editNeededBy}
                    onChange={event => setEditNeededBy(event.target.value)}
                    disabled={!canEditSelectedPurchaseRequest}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Programa la fecha objetivo para gestionar esta compra.
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Estatus
                  </div>
                  <div className="flex min-h-[3rem] items-center">
                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-1 text-sm ${
                        STATUS_COLORS[
                          getEffectivePurchaseRequestStatus(
                            detail.purchaseRequest.status,
                            detail.purchaseRequest.approvalStatus
                          )
                        ] || ""
                      }`}
                    >
                      {STATUS_LABELS[
                        getEffectivePurchaseRequestStatus(
                          detail.purchaseRequest.status,
                          detail.purchaseRequest.approvalStatus
                        )
                      ] || detail.purchaseRequest.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {isCancelledPurchaseRequest
                      ? "La solicitud fue anulada y ya no permite cambios."
                      : !PROCUREMENT_APPROVALS_ENABLED
                        ? detail.purchaseRequest.quoteAttachmentId
                          ? "Cotización adjunta y lista para convertir."
                          : "Puedes completar la solicitud y convertirla sin aprobación."
                        : isRejectedPurchaseRequest
                          ? "La solicitud espera corrección después del rechazo."
                          : isPendingApprovalPurchaseRequest
                            ? "La solicitud permanece bloqueada mientras se revisa."
                            : detail.purchaseRequest.quoteAttachmentId
                              ? "Cotización adjunta y lista para revisión."
                              : "Todavía no tiene cotización aprobada adjunta."}
                  </p>
                </div>

                {PROCUREMENT_APPROVALS_ENABLED ? (
                  <div className="rounded-2xl border border-border/70 bg-card p-5">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      Aprobación
                    </div>
                    <div className="flex min-h-[3rem] items-center">
                      <Badge
                        variant="outline"
                        className={`rounded-full px-3 py-1 text-sm ${
                          APPROVAL_STATUS_COLORS[
                            detail.purchaseRequest.approvalStatus ?? ""
                          ] || ""
                        }`}
                      >
                        {formatApprovalStatus(
                          detail.purchaseRequest.approvalStatus
                        )}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {isApprovedPurchaseRequest
                        ? `Aprobada por ${formatPurchaseRequestApprovedBy(detail)}.`
                        : "Consulta abajo el historial completo de decisiones."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-5">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Notas</Label>
                  <Textarea
                    value={editNotes}
                    onChange={event => setEditNotes(event.target.value)}
                    rows={4}
                    className="min-h-[140px] resize-y text-sm"
                    placeholder="Detalles, condiciones o instrucciones importantes para esta solicitud de compra"
                    disabled={!canEditSelectedPurchaseRequest}
                  />
                </div>
              </div>

              {PROCUREMENT_APPROVALS_ENABLED ? (
                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-base font-semibold">
                        Historial de aprobación
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Registro de envíos, decisiones y reaperturas de esta SC.
                      </p>
                    </div>
                  </div>

                  {approvalHistory.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                      {detail.purchaseRequest.approvalStatus === "no_requiere"
                        ? "Documento histórico finalizado antes de este flujo; no tiene eventos de aprobación."
                        : detail.purchaseRequest.approvalStatus
                          ? "No hay eventos de aprobación registrados para esta solicitud."
                          : "Esta solicitud todavía no ha sido enviada a aprobación."}
                    </div>
                  ) : (
                    <ol className="space-y-4">
                      {[...approvalHistory]
                        .sort(
                          (left, right) =>
                            new Date(right.createdAt ?? 0).getTime() -
                            new Date(left.createdAt ?? 0).getTime()
                        )
                        .map((event: any, index: number) => (
                          <li
                            key={event.id ?? `${event.createdAt}-${index}`}
                            className="relative rounded-xl border border-border/70 bg-muted/10 p-4 pl-11"
                          >
                            <span
                              className={`absolute left-4 top-5 h-3 w-3 rounded-full border ${
                                APPROVAL_STATUS_COLORS[event.newStatus] ||
                                "border-slate-300 bg-slate-100"
                              }`}
                            />
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold capitalize">
                                  {formatApprovalAction(event.action)}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {getApprovalEventActorName(event) ||
                                    "Usuario no disponible"}
                                  {event.actorRole
                                    ? ` · ${getBuildReqRoleLabel(event.actorRole)}`
                                    : ""}
                                </p>
                              </div>
                              <time className="text-xs text-muted-foreground">
                                {formatApprovalEventDate(event.createdAt)}
                              </time>
                            </div>
                            {(event.previousStatus || event.newStatus) && (
                              <p className="mt-3 text-xs text-muted-foreground">
                                {formatApprovalStatus(event.previousStatus)} →{" "}
                                {formatApprovalStatus(event.newStatus)}
                              </p>
                            )}
                            {event.comment ? (
                              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm">
                                {event.comment}
                              </p>
                            ) : null}
                          </li>
                        ))}
                    </ol>
                  )}
                </div>
              ) : null}

              {canReviewSelectedPurchaseRequest && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">
                      Comentario de revisión
                    </Label>
                    <Textarea
                      value={approvalComment}
                      onChange={event => setApprovalComment(event.target.value)}
                      placeholder="Opcional al aprobar; obligatorio y de al menos 5 caracteres al rechazar"
                      rows={3}
                      className="min-h-[110px] resize-y bg-background text-sm"
                    />
                  </div>
                </div>
              )}

              <DocumentAttachmentsPanel
                entityType="purchase_request"
                entityId={selectedId}
                category="documento_proveedor"
                title="Adjuntos y cotizaciones"
                canManage={canManagePurchaseRequestAttachments}
                disabled={attachQuoteMutation.isPending}
                onUploadSuccess={result => {
                  if (!selectedId) return;
                  attachQuoteMutation.mutate({
                    id: selectedId,
                    attachmentId: result.id,
                  });
                }}
              />

              <div className="min-w-0 rounded-2xl border border-border/70 bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
                  <div>
                    <p className="text-base font-semibold">
                      Ítems de la solicitud
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isCancelledPurchaseRequest
                        ? "La solicitud fue anulada y sus ítems quedaron cerrados para edición."
                        : isConvertedPurchaseRequest
                          ? "Los ítems ya fueron convertidos y esta solicitud quedó cerrada para edición."
                          : isRejectedPurchaseRequest
                            ? "La solicitud debe reabrirse antes de poder corregir sus ítems."
                            : isPendingApprovalPurchaseRequest
                              ? "Los ítems permanecen bloqueados mientras se revisa la solicitud."
                              : canConvertSelectedPurchaseRequest
                                ? "Marca los renglones que deseas convertir a la próxima orden de compra."
                                : "Detalle de ítems incluidos en la solicitud."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canConvertSelectedPurchaseRequest && (
                      <Badge
                        variant="secondary"
                        className="rounded-full px-3 py-1 text-xs"
                      >
                        {selectedItemIds.length > 0
                          ? `${selectedItemIds.length} seleccionados`
                          : `Se convertirán ${convertibleItemIds.length}`}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-[1980px] table-fixed text-sm">
                    <colgroup>
                      {canConvertSelectedPurchaseRequest && (
                        <col className="w-20" />
                      )}
                      <col className="w-44" />
                      <col className="w-56" />
                      <col className="w-72" />
                      <col className="w-72" />
                      <col className="w-48" />
                      <col className="w-56" />
                      <col className="w-64" />
                      <col className="w-52" />
                      <col className="w-44" />
                      <col className="w-44" />
                      <col className="w-52" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        {canConvertSelectedPurchaseRequest && (
                          <th className="w-20 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            A OC
                          </th>
                        )}
                        <th className="w-44 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Req.
                        </th>
                        <th className="w-56 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Proyecto
                        </th>
                        <th className="w-72 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Destino
                        </th>
                        <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Ítem
                        </th>
                        <th className="w-48 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          SAP
                        </th>
                        <th className="w-44 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          No. parte
                        </th>
                        <th className="w-44 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Marca
                        </th>
                        <th className="w-52 p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Responsable compra
                        </th>
                        <th className="w-52 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Cantidad solicitada
                        </th>
                        <th className="w-44 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Convertido
                        </th>
                        <th className="w-44 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Pendiente
                        </th>
                        <th className="w-52 p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Cantidad a comprar
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map((item: any) => {
                        const draft = getItemDraft(item);
                        const convertedQuantity = getConvertedQuantity(item);
                        const pendingQuantity =
                          getPendingConversionQuantity(item);
                        const convertQuantity = getConvertQuantityDraft(item);
                        const canConvertItem =
                          canConvertSelectedPurchaseRequest &&
                          convertibleItemIdSet.has(item.id) &&
                          pendingQuantity > 0;
                        const requesterItemName =
                          getRequesterItemNameForTemporaryFixedAsset(item);

                        return (
                          <tr
                            key={item.id}
                            className="border-b border-border/70 last:border-0"
                          >
                            {canConvertSelectedPurchaseRequest && (
                              <td className="p-4 align-top">
                                <Checkbox
                                  checked={selectedItemIds.includes(item.id)}
                                  disabled={!canConvertItem}
                                  onCheckedChange={checked => {
                                    setSelectedItemIds(current =>
                                      checked
                                        ? [...current, item.id]
                                        : current.filter(
                                            entry => entry !== item.id
                                          )
                                    );
                                  }}
                                />
                              </td>
                            )}
                            <td className="p-4 align-top text-xs">
                              {item.sourceRequest?.requestNumber || "—"}
                            </td>
                            <td className="p-4 align-top text-xs">
                              {item.sourceProject
                                ? `${item.sourceProject.code} — ${item.sourceProject.name}`
                                : isMixedProjectRequest
                                  ? "Proyecto pendiente"
                                  : projectLabel}
                            </td>
                            <td className="p-4 align-top">
                              {renderItemTargetCombobox(item, draft)}
                            </td>
                            <td className="p-4 align-top">
                              <p className="font-medium">{item.itemName}</p>
                              {requesterItemName ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Solicitado:{" "}
                                  <span className="font-medium text-foreground">
                                    {requesterItemName}
                                  </span>
                                </p>
                              ) : null}
                              {item.notes && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {item.notes}
                                </p>
                              )}
                            </td>
                            <td className="p-4 align-top text-xs font-mono">
                              {item.currentSapItemCode ||
                                item.originalSapItemCode ||
                                "—"}
                            </td>
                            <td className="p-4 align-top text-xs">
                              {getPurchaseRequestItemPartNumber(item)}
                            </td>
                            <td className="p-4 align-top">
                              <Input
                                className="h-9 min-w-0 text-sm"
                                value={draft.brand}
                                onChange={event =>
                                  updateItemDraft(
                                    item,
                                    "brand",
                                    event.target.value
                                  )
                                }
                                placeholder="Marca"
                                disabled={!canEditSelectedPurchaseRequest}
                              />
                            </td>
                            <td className="p-4 align-top">
                              <Input
                                className="h-9 min-w-0 text-sm"
                                value={draft.costResponsible}
                                onChange={event =>
                                  updateItemDraft(
                                    item,
                                    "costResponsible",
                                    event.target.value
                                  )
                                }
                                placeholder="Responsable compra"
                                disabled={!canEditSelectedPurchaseRequest}
                              />
                            </td>
                            <td className="p-4 align-top">
                              <div className="flex items-center justify-end gap-2">
                                <span className="h-9 w-36 rounded-md border border-transparent px-3 py-2 text-right font-mono">
                                  {formatQuantity(item.quantity)}
                                </span>
                                <span className="min-w-12 text-left text-xs text-muted-foreground">
                                  {item.unit || ""}
                                </span>
                              </div>
                            </td>
                            <td className="p-4 text-right align-top font-medium">
                              {formatQuantity(convertedQuantity)}{" "}
                              {item.unit || ""}
                            </td>
                            <td className="p-4 text-right align-top font-medium">
                              {formatQuantity(pendingQuantity)}{" "}
                              {item.unit || ""}
                            </td>
                            <td className="p-4 align-top">
                              <div className="flex items-center justify-end gap-2">
                                <Input
                                  className="h-9 w-36 text-right"
                                  type="number"
                                  min="0.01"
                                  max={pendingQuantity || undefined}
                                  step="0.01"
                                  value={convertQuantity}
                                  onChange={event =>
                                    updateConvertQuantityDraft(
                                      item,
                                      event.target.value
                                    )
                                  }
                                  disabled={!canConvertItem}
                                />
                                <span className="min-w-12 text-left text-xs text-muted-foreground">
                                  {item.unit || ""}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sticky bottom-0 z-10 flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm backdrop-blur xl:flex-row xl:items-start xl:justify-between">
                <div className="flex min-w-0 flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="h-11 px-4"
                    onClick={handlePrintDocument}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir
                  </Button>
                </div>

                <div className="flex w-full min-w-0 flex-wrap justify-end gap-3 xl:w-auto">
                  {canEditSelectedPurchaseRequest && (
                    <Button
                      variant="outline"
                      className="h-11 px-4"
                      onClick={handleSaveChanges}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Guardar cambios
                    </Button>
                  )}

                  {canSubmitSelectedPurchaseRequest && (
                    <Button
                      className="h-11 px-5"
                      onClick={handleSubmitForApproval}
                      disabled={
                        updateMutation.isPending ||
                        submitForApprovalMutation.isPending
                      }
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Enviar a aprobación
                    </Button>
                  )}

                  {canReviewSelectedPurchaseRequest && (
                    <>
                      <Button
                        variant="destructive"
                        className="h-11 px-4"
                        onClick={() => handleReviewApproval("reject")}
                        disabled={reviewApprovalMutation.isPending}
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Rechazar
                      </Button>
                      <Button
                        className="h-11 bg-emerald-600 px-5 text-white hover:bg-emerald-700"
                        onClick={() => handleReviewApproval("approve")}
                        disabled={reviewApprovalMutation.isPending}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Aprobar
                      </Button>
                    </>
                  )}

                  {canReopenSelectedPurchaseRequest && (
                    <Button
                      className="h-11 px-5"
                      onClick={handleReopenRejected}
                      disabled={reopenRejectedMutation.isPending}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Corregir
                    </Button>
                  )}

                  {canAnnulSelectedPurchaseRequest && (
                    <Button
                      variant="destructive"
                      className="h-11 px-4"
                      onClick={() => {
                        if (rejectReason.trim().length < 5) {
                          toast.error(
                            "Indica un motivo de al menos 5 caracteres"
                          );
                          return;
                        }
                        rejectMutation.mutate({
                          id: detail.purchaseRequest.id,
                          reason: rejectReason,
                        });
                      }}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Anular SC
                    </Button>
                  )}

                  {canConvertSelectedPurchaseRequest && (
                    <Button
                      className="h-11 px-5"
                      onClick={handleConvertToPurchaseOrder}
                      disabled={
                        convertMutation.isPending ||
                        itemIdsToConvert.length === 0
                      }
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Convertir a OC
                    </Button>
                  )}
                </div>
              </div>

              {canAnnulSelectedPurchaseRequest && (
                <div className="rounded-2xl border border-border/70 bg-card p-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">
                      Motivo de anulación
                    </Label>
                    <Textarea
                      value={rejectReason}
                      onChange={event => setRejectReason(event.target.value)}
                      placeholder="Explique por qué se anula la solicitud de compra"
                      rows={3}
                      className="min-h-[120px] resize-y text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(emailDialog)}
        onOpenChange={() => setEmailDialog(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Correo preparado</DialogTitle>
          </DialogHeader>
          {emailDialog && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Para</Label>
                <p className="text-sm font-medium">{emailDialog.to}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Asunto</Label>
                <p className="text-sm font-medium">{emailDialog.subject}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Contenido
                </Label>
                <div className="rounded-md bg-muted p-3 whitespace-pre-wrap text-sm">
                  {emailDialog.content}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
