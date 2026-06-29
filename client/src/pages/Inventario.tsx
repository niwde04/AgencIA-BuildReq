import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/spinner";
import {
  ArrowUpDown,
  ArrowRightLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ClipboardList,
  Search,
  Warehouse,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type InventorySortField =
  | "sapItemCode"
  | "name"
  | "brand"
  | "partNumber"
  | "category"
  | "unit"
  | "currentStock"
  | "minimumStock"
  | "warehouseLocation"
  | "projectName";

type SortDirection = "asc" | "desc";
type BulkAssignmentMode = "selected" | "filtered";

const PAGE_SIZE = 25;

const columns: Array<{
  key: InventorySortField;
  label: string;
  align?: "left" | "right";
}> = [
  { key: "sapItemCode", label: "Código SAP" },
  { key: "name", label: "Nombre" },
  { key: "brand", label: "Marca" },
  { key: "partNumber", label: "No. parte" },
  { key: "category", label: "Categoría" },
  { key: "unit", label: "Unidad" },
  { key: "currentStock", label: "Stock", align: "right" },
  { key: "minimumStock", label: "Mínimo", align: "right" },
  { key: "projectName", label: "Proyecto / bodega" },
  { key: "warehouseLocation", label: "Almacén físico" },
];

function buildPageItems(currentPage: number, totalPages: number) {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as const;
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages] as const;
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("es-HN");
}

function formatQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatProject(project: any | null | undefined) {
  if (!project) return "Por clasificar";
  return `${project.code} - ${project.name}`;
}

function compareProjectByCode(left: any, right: any) {
  const leftCode = String(left?.code ?? "").trim();
  const rightCode = String(right?.code ?? "").trim();
  const leftNumber = Number(leftCode);
  const rightNumber = Number(rightCode);
  const bothNumeric =
    leftCode !== "" &&
    rightCode !== "" &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber);

  if (bothNumeric && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  const codeComparison = leftCode.localeCompare(rightCode, "es-HN", {
    numeric: true,
    sensitivity: "base",
  });
  if (codeComparison !== 0) return codeComparison;

  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "es-HN", {
    numeric: true,
    sensitivity: "base",
  });
}

function formatWarehouseOptionLabel(warehouse: any | null | undefined) {
  if (!warehouse) return "—";
  const localCode = warehouse.localCode || warehouse.code;
  if (localCode && warehouse.name) return `${localCode} - ${warehouse.name}`;
  return warehouse.displayName || warehouse.name || warehouse.code || "—";
}

function formatWarehouseProjectLabel(warehouse: any | null | undefined) {
  return warehouse?.displayName ?? "";
}

function getWarehouseSortCode(warehouse: any | null | undefined) {
  return String(
    warehouse?.localCode ?? warehouse?.code ?? warehouse?.displayName ?? ""
  ).trim();
}

function compareWarehouseByCode(left: any, right: any) {
  const leftCode = getWarehouseSortCode(left);
  const rightCode = getWarehouseSortCode(right);
  const leftNumber = Number(leftCode);
  const rightNumber = Number(rightCode);
  const bothNumeric =
    leftCode !== "" &&
    rightCode !== "" &&
    Number.isFinite(leftNumber) &&
    Number.isFinite(rightNumber);

  if (bothNumeric && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  const codeComparison = leftCode.localeCompare(rightCode, "es-HN", {
    numeric: true,
    sensitivity: "base",
  });
  if (codeComparison !== 0) return codeComparison;

  return formatWarehouseOptionLabel(left).localeCompare(
    formatWarehouseOptionLabel(right),
    "es-HN",
    { numeric: true, sensitivity: "base" }
  );
}

function formatStatus(status: string | null | undefined) {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

function formatMovementType(type: string) {
  const labels: Record<string, string> = {
    saldo_inicial: "Saldo inicial",
    recepcion_oc: "Recepción OC",
    recepcion_traslado: "Recepción traslado",
    despacho_bodega: "Despacho",
    salida_traslado: "Salida traslado",
  };
  return labels[type] ?? type.replace(/_/g, " ");
}

export default function Inventario() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<InventorySortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [projectFilterOpen, setProjectFilterOpen] = useState(false);
  const [warehouseFilterOpen, setWarehouseFilterOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [bulkAssignmentDialogOpen, setBulkAssignmentDialogOpen] = useState(false);
  const [bulkAssignmentMode, setBulkAssignmentMode] =
    useState<BulkAssignmentMode>("selected");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [trackingItem, setTrackingItem] = useState<any | null>(null);
  const [kardexItem, setKardexItem] = useState<any | null>(null);
  const [expandedInventoryKeys, setExpandedInventoryKeys] = useState<string[]>([]);
  const [assignmentProjectId, setAssignmentProjectId] = useState("none");
  const [assignmentWarehouseId, setAssignmentWarehouseId] = useState("");
  const [bulkAssignmentProjectId, setBulkAssignmentProjectId] = useState("none");
  const [bulkAssignmentWarehouseId, setBulkAssignmentWarehouseId] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);

  const [sapItemCode, setSapItemCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [currentStock, setCurrentStock] = useState("");
  const [minimumStock, setMinimumStock] = useState("");
  const [projectId, setProjectId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, warehouseFilter, projectFilter]);

  const userRole = (user as any)?.buildreqRole || "";
  const canManage =
    userRole === "jefe_bodega_central" || user?.role === "admin";
  const canViewUnclassified =
    user?.role === "admin" || userRole === "administracion_central";
  const canIncludeUnclassified =
    canViewUnclassified ||
    userRole === "jefe_bodega_central" ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";
  const canAccessWarehouses =
    canManage ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto" ||
    userRole === "bodeguero_proyecto";
  const allowInventoryReassignment =
    canViewUnclassified && projectFilter === "unclassified";

  const { data: projects } = trpc.projects.list.useQuery();
  const projectOptions = useMemo(
    () => [...(projects ?? [])].sort(compareProjectByCode),
    [projects]
  );

  const { data: warehouses, isLoading: warehousesLoading } =
    trpc.warehouses.list.useQuery(undefined, {
      enabled: canAccessWarehouses,
    });
  const warehouseOptions = useMemo(() => {
    return [...(warehouses ?? [])].sort(compareWarehouseByCode);
  }, [warehouses]);
  const selectedFilterProject = useMemo(
    () =>
      projectFilter === "all" || projectFilter === "unclassified"
        ? null
        : projectOptions.find(
            (project: any) => String(project.id) === projectFilter
          ) ?? null,
    [projectFilter, projectOptions]
  );
  const selectedFilterWarehouse = useMemo(
    () =>
      warehouseFilter === "all"
        ? null
        : warehouseOptions.find(
            (warehouse: any) => String(warehouse.id) === warehouseFilter
          ) ?? null,
    [warehouseFilter, warehouseOptions]
  );
  const allProjectFilterLabel = canIncludeUnclassified
    ? `Todos los registros visibles (${projectOptions.length.toLocaleString("es-HN")} proyectos/bodegas)`
    : `Todos los proyectos/bodegas (${projectOptions.length.toLocaleString("es-HN")})`;
  const selectedProjectFilterLabel = selectedFilterProject
    ? `${selectedFilterProject.code} - ${selectedFilterProject.name}`
    : projectFilter === "unclassified"
      ? "Inventario por clasificar"
      : allProjectFilterLabel;
  const allWarehouseFilterLabel = `Todos los almacenes físicos (${warehouseOptions.length.toLocaleString("es-HN")})`;
  const selectedWarehouseFilterLabel = selectedFilterWarehouse
    ? formatWarehouseOptionLabel(selectedFilterWarehouse)
    : allWarehouseFilterLabel;
  const projectFilterDisabled = warehouseFilter !== "all";
  const selectedCreateProject = useMemo(
    () =>
      (projects ?? []).find((project: any) => String(project.id) === projectId) ?? null,
    [projectId, projects]
  );
  const createProjectWarehouses = useMemo(
    () => {
      const assigned = selectedCreateProject?.warehouses;
      if (Array.isArray(assigned) && assigned.length > 0) {
        return [...assigned].sort(compareWarehouseByCode);
      }
      return selectedCreateProject?.warehouse ? [selectedCreateProject.warehouse] : [];
    },
    [selectedCreateProject]
  );
  const defaultCreateWarehouse = useMemo(
    () => createProjectWarehouses[0] ?? null,
    [createProjectWarehouses]
  );
  const selectedAssignmentProject = useMemo(
    () =>
      assignmentProjectId === "none"
        ? null
        : (projects ?? []).find(
            (project: any) => String(project.id) === assignmentProjectId
          ) ?? null,
    [assignmentProjectId, projects]
  );
  const assignmentProjectWarehouses = useMemo(() => {
    const assigned = selectedAssignmentProject?.warehouses;
    if (Array.isArray(assigned) && assigned.length > 0) {
      return [...assigned].sort(compareWarehouseByCode);
    }
    return selectedAssignmentProject?.warehouse
      ? [selectedAssignmentProject.warehouse]
      : [];
  }, [selectedAssignmentProject]);
  const selectedBulkProject = useMemo(
    () =>
      bulkAssignmentProjectId === "none"
        ? null
        : (projects ?? []).find(
            (project: any) => String(project.id) === bulkAssignmentProjectId
          ) ?? null,
    [bulkAssignmentProjectId, projects]
  );
  const bulkProjectWarehouses = useMemo(() => {
    const assigned = selectedBulkProject?.warehouses;
    if (Array.isArray(assigned) && assigned.length > 0) {
      return [...assigned].sort(compareWarehouseByCode);
    }
    return selectedBulkProject?.warehouse ? [selectedBulkProject.warehouse] : [];
  }, [selectedBulkProject]);

  useEffect(() => {
    if (!projectId) return;
    setWarehouseId(defaultCreateWarehouse ? String(defaultCreateWarehouse.id) : "");
  }, [defaultCreateWarehouse, projectId]);

  useEffect(() => {
    if (assignmentProjectId === "none") {
      setAssignmentWarehouseId("");
      return;
    }
    const stillValid = assignmentProjectWarehouses.some(
      (warehouse: any) => String(warehouse.id) === assignmentWarehouseId
    );
    if (!stillValid) {
      setAssignmentWarehouseId(
        assignmentProjectWarehouses[0]
          ? String(assignmentProjectWarehouses[0].id)
          : ""
      );
    }
  }, [assignmentProjectId, assignmentProjectWarehouses, assignmentWarehouseId]);

  useEffect(() => {
    if (bulkAssignmentProjectId === "none") {
      setBulkAssignmentWarehouseId("");
      return;
    }
    const stillValid = bulkProjectWarehouses.some(
      (warehouse: any) => String(warehouse.id) === bulkAssignmentWarehouseId
    );
    if (!stillValid) {
      setBulkAssignmentWarehouseId(
        bulkProjectWarehouses[0] ? String(bulkProjectWarehouses[0].id) : ""
      );
    }
  }, [bulkAssignmentProjectId, bulkProjectWarehouses, bulkAssignmentWarehouseId]);

  useEffect(() => {
    if (warehouseFilter === "all") return;
    const selectedWarehouseBelongsToProject = warehouseOptions.some(
      (warehouse: any) => String(warehouse.id) === warehouseFilter
    );
    if (!selectedWarehouseBelongsToProject) {
      setWarehouseFilter("all");
    }
  }, [warehouseFilter, warehouseOptions]);

  const selectedWarehouseId =
    warehouseFilter === "all" ? undefined : Number(warehouseFilter);
  const selectedProjectId =
    projectFilter === "all" || projectFilter === "unclassified" || selectedWarehouseId
      ? undefined
      : Number(projectFilter);

  const queryInput = {
    search: debouncedSearch || undefined,
    projectId: selectedProjectId,
    warehouseId: selectedWarehouseId,
    includeUnclassified:
      canIncludeUnclassified && projectFilter === "all" ? true : undefined,
    unclassifiedOnly: projectFilter === "unclassified" || undefined,
  };

  const listQueryInput = {
    ...queryInput,
    page,
    pageSize: PAGE_SIZE,
    includePendingQuantities: false,
    sortBy,
    sortDir,
  };

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = trpc.inventory.list.useQuery(listQueryInput, {
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
  const trackingQuery = trpc.inventory.tracking.useQuery(
    {
      sapItemCode: trackingItem?.sapItemCode ?? "",
      projectId: trackingItem?.project?.id ?? undefined,
      warehouseId:
        trackingItem?.warehouse?.id ?? trackingItem?.warehouseId ?? undefined,
      warehouseLocation: trackingItem?.warehouseLocation ?? undefined,
    },
    {
      enabled: Boolean(trackingItem?.sapItemCode),
    }
  );

  const kardexQuery = trpc.inventory.kardex.useQuery(
    {
      sapItemCode: kardexItem?.sapItemCode ?? "",
      projectId: kardexItem?.project?.id ?? undefined,
      warehouseId: kardexItem?.warehouse?.id ?? kardexItem?.warehouseId ?? undefined,
      warehouseLocation: kardexItem?.warehouseLocation ?? undefined,
    },
    {
      enabled: Boolean(kardexItem?.sapItemCode),
    }
  );

  useEffect(() => {
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, page]);

  const createMutation = trpc.inventory.create.useMutation({
    onSuccess: () => {
      toast.success("Ítem de inventario creado");
      void Promise.all([
        utils.inventory.list.invalidate(),
        utils.inventory.pendingQuantities.invalidate(),
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      setDialogOpen(false);
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.inventory.update.useMutation({
    onSuccess: () => {
      toast.success("Inventario actualizado");
      void Promise.all([
        utils.inventory.list.invalidate(),
        utils.inventory.pendingQuantities.invalidate(),
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      setAssignmentDialogOpen(false);
      setSelectedItem(null);
      setAssignmentProjectId("none");
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkAssignMutation = trpc.inventory.bulkAssignProject.useMutation({
    onSuccess: (result: any) => {
      toast.success(
        `${result.updatedCount.toLocaleString("es-HN")} ítems clasificados`
      );
      void Promise.all([
        utils.inventory.list.invalidate(),
        utils.inventory.pendingQuantities.invalidate(),
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
      setBulkAssignmentDialogOpen(false);
      setAssignmentDialogOpen(false);
      setSelectedItem(null);
      setAssignmentProjectId("none");
      setAssignmentWarehouseId("");
      setBulkAssignmentProjectId("none");
      setBulkAssignmentWarehouseId("");
      setSelectedItemIds([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkAssignFilteredMutation =
    trpc.inventory.bulkAssignProjectByFilters.useMutation({
      onSuccess: (result: any) => {
        toast.success(
          `${result.updatedCount.toLocaleString("es-HN")} ítems del resultado actual clasificados`
        );
        void Promise.all([
          utils.inventory.list.invalidate(),
          utils.inventory.pendingQuantities.invalidate(),
          utils.warehouses.list.invalidate(),
          utils.projects.list.invalidate(),
        ]);
        setBulkAssignmentDialogOpen(false);
        setBulkAssignmentProjectId("none");
        setBulkAssignmentWarehouseId("");
        setSelectedItemIds([]);
      },
      onError: (e) => toast.error(e.message),
    });

  const resetForm = () => {
    setSapItemCode("");
    setName("");
    setDescription("");
    setUnit("");
    setCategory("");
    setCurrentStock("");
    setMinimumStock("");
    setProjectId("");
    setWarehouseId("");
  };

  const items = data?.items || [];
  const visibleInventoryIds = useMemo(
    () =>
      Array.from(
        new Set(
          (items as any[])
            .map((item) => Number(item.id))
            .filter((id) => Number.isInteger(id) && id > 0)
        )
      ),
    [items]
  );
  const pendingQuantitiesQuery = trpc.inventory.pendingQuantities.useQuery(
    { ids: visibleInventoryIds },
    {
      enabled: visibleInventoryIds.length > 0,
      staleTime: 30_000,
    }
  );
  const pendingQuantitiesById = useMemo(() => {
    return new Map(
      (pendingQuantitiesQuery.data ?? []).map((entry: any) => [
        Number(entry.id),
        entry,
      ])
    );
  }, [pendingQuantitiesQuery.data]);
  const groupedItems = useMemo(() => {
    const groups = new Map<string, any>();

    for (const item of items as any[]) {
      const itemKey = item.sapItemCode?.trim() || item.name?.trim().toLowerCase();
      const warehouseId = item.warehouse?.id ?? item.warehouseId ?? null;
      const warehouseLocation =
        item.warehouseLocation || item.warehouse?.displayName || "Sin almacén";
      const warehouseKey =
        typeof warehouseId === "number"
          ? `warehouse:${warehouseId}`
          : `location:${String(warehouseLocation).trim().toLowerCase()}`;
      const groupKey = `${itemKey}:${warehouseKey}`;
      const existing =
        groups.get(groupKey) ??
        {
          ...item,
          id: groupKey,
          sourceIds: [],
          projectBreakdownByKey: new Map<string, any>(),
          projectBreakdown: [],
          currentStockTotal: 0,
          minimumStockTotal: 0,
          warehouse: item.warehouse ?? null,
          warehouseId: warehouseId ?? undefined,
          warehouseLocation,
        };

      const projectKey = item.project?.id
        ? `project:${item.project.id}`
        : "unclassified";
      const projectLabel = item.project
        ? `${item.project.code} - ${item.project.name}`
        : "Por clasificar";
      const projectBreakdownEntry =
        existing.projectBreakdownByKey.get(projectKey) ??
        {
          id: projectKey,
          project: item.project ?? null,
          projectLabel,
          sourceIds: [],
          currentStockTotal: 0,
          minimumStockTotal: 0,
        };

      existing.sourceIds.push(item.id);
      existing.currentStockTotal += parseQuantity(item.currentStock);
      existing.minimumStockTotal += parseQuantity(item.minimumStock);
      projectBreakdownEntry.sourceIds.push(item.id);
      projectBreakdownEntry.currentStockTotal += parseQuantity(item.currentStock);
      projectBreakdownEntry.minimumStockTotal += parseQuantity(item.minimumStock);
      existing.projectBreakdownByKey.set(projectKey, projectBreakdownEntry);
      groups.set(groupKey, existing);
    }

    return Array.from(groups.values()).map((item) => {
      const projectBreakdown = Array.from(
        item.projectBreakdownByKey.values()
      ) as any[];
      projectBreakdown.sort((left: any, right: any) => {
        if (!left.project && right.project) return 1;
        if (left.project && !right.project) return -1;
        return compareProjectByCode(left.project, right.project);
      });
      const pendingQuantitiesReady = item.sourceIds.every((id: number) =>
        pendingQuantitiesById.has(id)
      );
      const totalRequiredQuantity = pendingQuantitiesReady
        ? item.sourceIds.reduce(
            (sum: number, id: number) =>
              sum +
              parseQuantity(
                pendingQuantitiesById.get(id)?.totalRequiredQuantity
              ),
            0
          )
        : 0;
      const pendingReceiptQuantity = pendingQuantitiesReady
        ? item.sourceIds.reduce(
            (sum: number, id: number) =>
              sum +
              parseQuantity(
                pendingQuantitiesById.get(id)?.pendingReceiptQuantity
              ),
            0
          )
        : 0;
      const hasSingleProject = projectBreakdown.length === 1;
      const singleProject = hasSingleProject
        ? projectBreakdown[0]?.project ?? null
        : null;

      return {
        ...item,
        project: singleProject,
        projectBreakdown: projectBreakdown.map((entry: any) => ({
          ...entry,
          currentStock: entry.currentStockTotal.toFixed(2),
          minimumStock:
            entry.minimumStockTotal > 0
              ? entry.minimumStockTotal.toFixed(2)
              : null,
        })),
        projectSummaryLabel: hasSingleProject
          ? projectBreakdown[0]?.projectLabel
          : `${projectBreakdown.length} proyectos/bodegas`,
        currentStock: item.currentStockTotal.toFixed(2),
        minimumStock:
          item.minimumStockTotal > 0
            ? item.minimumStockTotal.toFixed(2)
            : item.minimumStock,
        pendingQuantitiesLoading:
          visibleInventoryIds.length > 0 &&
          !pendingQuantitiesReady &&
          !pendingQuantitiesQuery.isError,
        totalRequiredQuantity: totalRequiredQuantity.toFixed(2),
        pendingReceiptQuantity: pendingReceiptQuantity.toFixed(2),
        warehouseSummaryLabel: item.warehouseLocation || "Sin almacén",
      };
    });
  }, [
    items,
    pendingQuantitiesById,
    pendingQuantitiesQuery.isError,
    visibleInventoryIds.length,
  ]);
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const pageItems = useMemo(
    () => buildPageItems(data?.page ?? page, totalPages),
    [data?.page, page, totalPages]
  );

  const handleSort = (column: InventorySortField) => {
    setPage(1);
    if (sortBy === column) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(column);
    setSortDir("asc");
  };

  const renderSortIcon = (column: InventorySortField) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/70" />;
    }

    return sortDir === "asc" ? (
      <ChevronUp className="h-3.5 w-3.5 text-primary" />
    ) : (
      <ChevronDown className="h-3.5 w-3.5 text-primary" />
    );
  };

  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);
  const allPageItemIds = items.map((item: any) => item.id);
  const filteredItemCount = total;
  const allCurrentPageSelected =
    allPageItemIds.length > 0 &&
    allPageItemIds.every((id: number) => selectedItemIds.includes(id));
  const someCurrentPageSelected =
    allPageItemIds.some((id: number) => selectedItemIds.includes(id)) &&
    !allCurrentPageSelected;

  const openAssignmentDialog = (item: any) => {
    setSelectedItem(item);
    setAssignmentProjectId(item.project?.id ? String(item.project.id) : "none");
    setAssignmentDialogOpen(true);
  };

  const openBulkAssignmentDialog = (mode: BulkAssignmentMode) => {
    setBulkAssignmentMode(mode);
    setBulkAssignmentProjectId("none");
    setBulkAssignmentDialogOpen(true);
  };

  useEffect(() => {
    setSelectedItemIds((current) =>
      current.filter((id) => allPageItemIds.includes(id))
    );
  }, [data?.page, projectFilter, warehouseFilter, debouncedSearch, sortBy, sortDir]);

  useEffect(() => {
    const visibleKeys = new Set(groupedItems.map((item: any) => item.id));
    setExpandedInventoryKeys((current) =>
      current.every((key) => visibleKeys.has(key))
        ? current
        : current.filter((key) => visibleKeys.has(key))
    );
  }, [groupedItems]);

  const toggleInventoryBreakdown = (key: string) => {
    setExpandedInventoryKeys((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key]
    );
  };

  const toggleAllCurrentPage = (checked: boolean) => {
    if (checked) {
      setSelectedItemIds((current) => {
        const next = new Set(current);
        allPageItemIds.forEach((id: number) => next.add(id));
        return Array.from(next);
      });
      return;
    }

    setSelectedItemIds((current) =>
      current.filter((id) => !allPageItemIds.includes(id))
    );
  };

  const getProjectWarehouseLabel = (project: any | null) => {
    if (!project) return "Seleccione proyecto/bodega";
    return (
      project.warehouse?.displayName ??
      `${String(project.code).toUpperCase()} - ${String(project.name).toUpperCase()} - BODEGA`
    );
  };

  const trackingData = trackingQuery.data;
  const kardexData = kardexQuery.data;
  const trackingTotal =
    (trackingData?.materialRequests.length ?? 0) +
    (trackingData?.purchaseRequests.length ?? 0) +
    (trackingData?.purchaseOrders.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1>Inventario</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar el inventario"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : groupedItems.length !== items.length
                  ? `${groupedItems.length.toLocaleString("es-HN")} grupos en esta página · ${total.toLocaleString("es-HN")} registros encontrados`
                  : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>Nuevo Ítem de Inventario</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Código SAP *</Label>
                    <Input
                      value={sapItemCode}
                      onChange={(e) => setSapItemCode(e.target.value)}
                      placeholder="MAT-001"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Cemento Portland"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Unidad</Label>
                    <Input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="sacos"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Stock actual</Label>
                    <Input
                      value={currentStock}
                      onChange={(e) => setCurrentStock(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Stock mínimo</Label>
                    <Input
                      value={minimumStock}
                      onChange={(e) => setMinimumStock(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Categoría</Label>
                    <Input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="Materiales"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Proyecto / bodega *</Label>
                    <Select
                      value={projectId || undefined}
                      onValueChange={(value) =>
                        setProjectId(value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione proyecto/bodega" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((project) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.code} - {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {projectId ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Almacén físico *</Label>
                      <Select
                        value={warehouseId || undefined}
                        onValueChange={setWarehouseId}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              warehousesLoading
                                ? "Cargando almacenes..."
                                : "Seleccione almacén físico"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {createProjectWarehouses.map((warehouse: any) => (
                            <SelectItem
                              key={warehouse.id}
                              value={String(warehouse.id)}
                            >
                              {warehouse.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Bodega seleccionada</Label>
                      <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
                        {getProjectWarehouseLabel(selectedCreateProject)}
                      </div>
                    </div>
                  </div>
                ) : null}
                <Button
                  onClick={() => {
                    if (!sapItemCode || !name) {
                      toast.error("Código SAP y nombre son obligatorios");
                      return;
                    }
                    if (!projectId || !warehouseId) {
                      toast.error("Seleccione proyecto/bodega y almacén físico");
                      return;
                    }
                    createMutation.mutate({
                      sapItemCode,
                      name,
                      description: description || undefined,
                      unit: unit || undefined,
                      category: category || undefined,
                      currentStock: currentStock || undefined,
                      minimumStock: minimumStock || undefined,
                      projectId: Number(projectId),
                      warehouseId: Number(warehouseId),
                    });
                  }}
                  disabled={createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? "Creando..." : "Crear Ítem"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {allowInventoryReassignment ? (
        <>
          <Dialog
            open={assignmentDialogOpen}
            onOpenChange={(open) => {
              setAssignmentDialogOpen(open);
              if (!open) {
                setSelectedItem(null);
                setAssignmentProjectId("none");
                setAssignmentWarehouseId("");
              }
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Clasificar Inventario</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {selectedItem?.sapItemCode} · {selectedItem?.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Almacén: {selectedItem?.warehouseLocation || "Sin almacén"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Proyecto actual:{" "}
                    {selectedItem?.project
                      ? `${selectedItem.project.code} - ${selectedItem.project.name}`
                      : "Por clasificar"}
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Proyecto / bodega destino</Label>
                  <Select
                    value={
                      assignmentProjectId === "none"
                        ? undefined
                        : assignmentProjectId
                    }
                    onValueChange={setAssignmentProjectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un proyecto" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects ?? []).map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Almacén físico destino</Label>
                  <Select
                    value={assignmentWarehouseId || undefined}
                    onValueChange={setAssignmentWarehouseId}
                    disabled={assignmentProjectId === "none"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione almacén físico" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignmentProjectWarehouses.map((warehouse: any) => (
                        <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                          {formatWarehouseOptionLabel(warehouse)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Destino
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {getProjectWarehouseLabel(selectedAssignmentProject)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Al guardar, el inventario legado quedará operativo en el proyecto/bodega y almacén físico seleccionados.
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={!selectedItem || bulkAssignMutation.isPending}
                  onClick={() => {
                    if (!selectedItem) return;
                    if (
                      assignmentProjectId === "none" ||
                      !assignmentWarehouseId
                    ) {
                      toast.error("Seleccione proyecto/bodega y almacén físico");
                      return;
                    }
                    bulkAssignMutation.mutate({
                      ids: selectedItem.sourceIds ?? [selectedItem.id],
                      projectId: Number(assignmentProjectId),
                      warehouseId: Number(assignmentWarehouseId),
                    });
                  }}
                >
                  {bulkAssignMutation.isPending ? "Guardando..." : "Clasificar inventario"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={bulkAssignmentDialogOpen}
            onOpenChange={(open) => {
              setBulkAssignmentDialogOpen(open);
              if (!open) {
                setBulkAssignmentProjectId("none");
                setBulkAssignmentWarehouseId("");
              }
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {bulkAssignmentMode === "filtered"
                    ? "Clasificar Todo el Resultado Filtrado"
                    : "Clasificar Ítems Seleccionados"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium text-foreground">
                    {(bulkAssignmentMode === "filtered"
                      ? filteredItemCount
                      : selectedItemIds.length
                    ).toLocaleString("es-HN")}{" "}
                    ítems {bulkAssignmentMode === "filtered" ? "en el resultado actual" : "seleccionados"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {bulkAssignmentMode === "filtered"
                      ? "Esta acción clasificará todos los registros sin proyecto que coincidan con los filtros actuales."
                      : "Esta acción clasificará los registros seleccionados sin proyecto."}
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Proyecto / bodega destino</Label>
                  <Select
                    value={
                      bulkAssignmentProjectId === "none"
                        ? undefined
                        : bulkAssignmentProjectId
                    }
                    onValueChange={setBulkAssignmentProjectId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un proyecto" />
                    </SelectTrigger>
                    <SelectContent>
                      {(projects ?? []).map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Almacén físico destino</Label>
                  <Select
                    value={bulkAssignmentWarehouseId || undefined}
                    onValueChange={setBulkAssignmentWarehouseId}
                    disabled={bulkAssignmentProjectId === "none"}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione almacén físico" />
                    </SelectTrigger>
                    <SelectContent>
                      {bulkProjectWarehouses.map((warehouse: any) => (
                        <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                          {formatWarehouseOptionLabel(warehouse)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Destino
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {getProjectWarehouseLabel(selectedBulkProject)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Los registros elegidos pasarán a la bodega operativa del proyecto seleccionado.
                  </p>
                </div>

                <Button
                  className="w-full"
                  disabled={
                    (bulkAssignmentMode === "filtered"
                      ? filteredItemCount === 0
                      : selectedItemIds.length === 0) ||
                    bulkAssignMutation.isPending ||
                    bulkAssignFilteredMutation.isPending
                  }
                  onClick={() => {
                    if (
                      bulkAssignmentProjectId === "none" ||
                      !bulkAssignmentWarehouseId
                    ) {
                      toast.error("Seleccione proyecto/bodega y almacén físico");
                      return;
                    }
                    if (bulkAssignmentMode === "filtered") {
                      bulkAssignFilteredMutation.mutate({
                        ...queryInput,
                        targetProjectId: Number(bulkAssignmentProjectId),
                        targetWarehouseId: Number(bulkAssignmentWarehouseId),
                      });
                      return;
                    }

                    bulkAssignMutation.mutate({
                      ids: selectedItemIds,
                      projectId: Number(bulkAssignmentProjectId),
                      warehouseId: Number(bulkAssignmentWarehouseId),
                    });
                  }}
                >
                  {bulkAssignMutation.isPending || bulkAssignFilteredMutation.isPending
                    ? "Guardando..."
                    : bulkAssignmentMode === "filtered"
                      ? "Clasificar todo lo filtrado"
                      : "Clasificar seleccionados"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      <Dialog
        open={Boolean(trackingItem)}
        onOpenChange={(open) => {
          if (!open) setTrackingItem(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              Seguimiento · {trackingItem?.sapItemCode}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium text-foreground">
                {trackingItem?.name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {trackingItem?.projectSummaryLabel ??
                  formatProject(trackingItem?.project)}{" "}
                ·{" "}
                {trackingItem?.warehouseLocation || "Sin almacén"}
              </p>
            </div>

            {trackingQuery.isLoading ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                Cargando seguimiento...
              </div>
            ) : trackingQuery.error ? (
              <div className="rounded-lg border border-destructive/30 p-6 text-center text-sm text-destructive">
                {trackingQuery.error.message}
              </div>
            ) : trackingTotal === 0 ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                No hay solicitudes ni órdenes de compra en proceso para este ítem.
              </div>
            ) : (
              <div className="space-y-5">
                {[
                  {
                    title: "Requisiciones",
                    rows: trackingData?.materialRequests ?? [],
                  },
                  {
                    title: "Solicitudes de compra",
                    rows: trackingData?.purchaseRequests ?? [],
                  },
                  {
                    title: "Órdenes de compra",
                    rows: trackingData?.purchaseOrders ?? [],
                  },
                ].map((section) => (
                  <div key={section.title} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        {section.title}
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {section.rows.length.toLocaleString("es-HN")}
                      </span>
                    </div>
                    {section.rows.length === 0 ? (
                      <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                        Sin registros en proceso.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/40">
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Documento
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Estado
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Proyecto
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Cantidad
                              </th>
                              <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Pendiente
                              </th>
                              <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Fecha necesaria
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {section.rows.map((row: any) => (
                              <tr
                                key={`${section.title}-${row.id}`}
                                className="border-b last:border-0"
                              >
                                <td className="p-3 font-mono text-xs">
                                  {row.documentNumber}
                                </td>
                                <td className="p-3">
                                  <span className="inline-flex rounded-md border px-2 py-1 text-xs capitalize">
                                    {formatStatus(row.status)}
                                  </span>
                                </td>
                                <td className="p-3 text-xs">
                                  {formatProject(row.project)}
                                </td>
                                <td className="p-3 text-right">
                                  {formatQuantity(row.quantity)}{" "}
                                  <span className="text-xs text-muted-foreground">
                                    {row.unit || ""}
                                  </span>
                                </td>
                                <td className="p-3 text-right font-medium">
                                  {formatQuantity(row.pendingQuantity)}
                                </td>
                                <td className="p-3 text-xs">
                                  {formatDate(row.neededBy)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(kardexItem)}
        onOpenChange={(open) => {
          if (!open) setKardexItem(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Kardex · {kardexItem?.sapItemCode}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium text-foreground">{kardexItem?.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {kardexItem?.projectSummaryLabel ??
                  formatProject(kardexItem?.project)}{" "}
                ·{" "}
                {kardexItem?.warehouseLocation || "Sin almacén"}
              </p>
            </div>

            {kardexQuery.isLoading ? (
              <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                Cargando Kardex...
              </div>
            ) : kardexQuery.error ? (
              <div className="rounded-lg border border-destructive/30 p-6 text-center text-sm text-destructive">
                {kardexQuery.error.message}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Existencias actuales</h3>
                  {(kardexData?.balances.length ?? 0) === 0 ? (
                    <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                      Sin existencias actuales.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Proyecto
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Almacén
                            </th>
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Stock
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Actualizado
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kardexData?.balances ?? []).map((balance: any) => (
                            <tr key={balance.id} className="border-b last:border-0">
                              <td className="p-3 text-xs">
                                {formatProject(balance.project)}
                              </td>
                              <td className="p-3 text-xs">
                                {balance.warehouseLocation || "—"}
                              </td>
                              <td className="p-3 text-right font-medium">
                                {formatQuantity(balance.currentStock)}{" "}
                                <span className="text-xs text-muted-foreground">
                                  {balance.unit || ""}
                                </span>
                              </td>
                              <td className="p-3 text-xs">
                                {formatDate(balance.updatedAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Movimientos</h3>
                  {(kardexData?.movements.length ?? 0) === 0 ? (
                    <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground">
                      Sin movimientos registrados.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Fecha
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Tipo
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Documento
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Proyecto
                            </th>
                            <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Bodega
                            </th>
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Entrada
                            </th>
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Salida
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {(kardexData?.movements ?? []).map((movement: any) => (
                            <tr
                              key={movement.id}
                              className="border-b last:border-0"
                            >
                              <td className="p-3 text-xs">
                                {formatDate(movement.date)}
                              </td>
                              <td className="p-3 text-xs">
                                {formatMovementType(movement.type)}
                              </td>
                              <td className="p-3">
                                <div className="font-mono text-xs">
                                  {movement.documentNumber}
                                </div>
                                {movement.sourceNumber ? (
                                  <div className="text-xs text-muted-foreground">
                                    Origen: {movement.sourceNumber}
                                  </div>
                                ) : null}
                              </td>
                              <td className="p-3 text-xs">
                                {formatProject(movement.project)}
                              </td>
                              <td className="p-3 text-xs">
                                {formatWarehouseOptionLabel(movement.warehouse)}
                              </td>
                              <td className="p-3 text-right font-medium text-emerald-700">
                                {movement.direction === "entrada"
                                  ? formatQuantity(movement.quantity)
                                  : "—"}
                              </td>
                              <td className="p-3 text-right font-medium text-destructive">
                                {movement.direction === "salida"
                                  ? formatQuantity(movement.quantity)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-3 lg:grid-cols-[minmax(280px,1fr)_minmax(240px,320px)_minmax(240px,384px)] lg:items-end">
        <div className="relative min-w-0">
          <Label className="mb-1 block text-xs font-medium text-muted-foreground">
            Búsqueda
          </Label>
          <Search className="absolute left-3 top-[calc(50%+10px)] -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, código, marca, parte, proyecto/bodega o almacén físico..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {canAccessWarehouses ? (
          <div className="min-w-0">
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">
              Almacén físico ({warehouseOptions.length.toLocaleString("es-HN")})
            </Label>
            <Popover
              open={warehouseFilterOpen}
              onOpenChange={setWarehouseFilterOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={warehouseFilterOpen}
                  className="h-9 w-full justify-between px-3 font-normal"
                >
                  <span className="truncate">{selectedWarehouseFilterLabel}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-0"
              >
                <Command>
                  <CommandInput placeholder="Buscar almacén físico..." />
                  <CommandList>
                    <CommandEmpty>No se encontraron almacenes.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="todos los almacenes all"
                        onSelect={() => {
                          setWarehouseFilter("all");
                          setWarehouseFilterOpen(false);
                        }}
                      >
                        <Check
                          className={`h-4 w-4 ${
                            warehouseFilter === "all"
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <span className="truncate">
                          {allWarehouseFilterLabel}
                        </span>
                      </CommandItem>
                      {warehouseOptions.map((warehouse: any) => (
                        <CommandItem
                          key={warehouse.id}
                          value={[
                            warehouse.code,
                            warehouse.localCode,
                            warehouse.name,
                            warehouse.displayName,
                            warehouse.project?.code,
                            warehouse.project?.name,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onSelect={() => {
                            setWarehouseFilter(String(warehouse.id));
                            setProjectFilter("all");
                            setWarehouseFilterOpen(false);
                          }}
                        >
                          <Check
                            className={`h-4 w-4 ${
                              warehouseFilter === String(warehouse.id)
                                ? "opacity-100"
                              : "opacity-0"
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block truncate">
                              {formatWarehouseOptionLabel(warehouse)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatWarehouseProjectLabel(warehouse)}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}

        <div className="min-w-0">
          <Label className="mb-1 block text-xs font-medium text-muted-foreground">
            Proyecto / bodega ({projectOptions.length.toLocaleString("es-HN")})
          </Label>
          <Popover
            open={projectFilterOpen}
            onOpenChange={(open) =>
              setProjectFilterOpen(projectFilterDisabled ? false : open)
            }
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={projectFilterOpen}
                disabled={projectFilterDisabled}
                className="h-9 w-full justify-between px-3 font-normal disabled:opacity-70"
                title={
                  projectFilterDisabled
                    ? "La bodega seleccionada manda el filtro de inventario"
                    : undefined
                }
              >
                <span className="truncate">
                  {projectFilterDisabled
                    ? canIncludeUnclassified
                      ? "Todos los registros de la bodega"
                      : "Todos los proyectos de la bodega"
                    : selectedProjectFilterLabel}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] p-0"
            >
              <Command>
                  <CommandInput placeholder="Buscar proyecto/bodega..." />
                <CommandList>
                  <CommandEmpty>No se encontraron proyectos.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="todos los registros visibles proyectos bodegas all"
                      onSelect={() => {
                        setProjectFilter("all");
                        setProjectFilterOpen(false);
                      }}
                    >
                      <Check
                        className={`h-4 w-4 ${
                          projectFilter === "all" ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="truncate">{allProjectFilterLabel}</span>
                    </CommandItem>
                    {canViewUnclassified ? (
                      <CommandItem
                        value="inventario por clasificar sin proyecto"
                        onSelect={() => {
                          setProjectFilter("unclassified");
                          setProjectFilterOpen(false);
                        }}
                      >
                        <Check
                          className={`h-4 w-4 ${
                            projectFilter === "unclassified"
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <span className="truncate">
                          Inventario por clasificar
                        </span>
                      </CommandItem>
                    ) : null}
                    {projectOptions.map((project: any) => (
                      <CommandItem
                        key={project.id}
                        value={`${project.code} ${project.name} ${project.sapProjectCode ?? ""}`}
                        onSelect={() => {
                          setProjectFilter(String(project.id));
                          setProjectFilterOpen(false);
                        }}
                      >
                        <Check
                          className={`h-4 w-4 ${
                            projectFilter === String(project.id)
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <span className="truncate">
                          {project.code} - {project.name}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Los movimientos entre bodegas de proyecto se registran desde requisiciones, traslados y recepciones. Desde inventario consultas existencias, haces altas controladas y clasificas inventario histórico sin proyecto.
      </div>

      {canManage && allowInventoryReassignment && selectedItemIds.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedItemIds.length.toLocaleString("es-HN")} ítems por clasificar seleccionados
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setSelectedItemIds([])}
            >
              Limpiar selección
            </Button>
            <Button onClick={() => openBulkAssignmentDialog("selected")}>
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Clasificar seleccionados
            </Button>
          </div>
        </div>
      ) : null}

      {canManage && allowInventoryReassignment && filteredItemCount > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed px-4 py-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            {filteredItemCount.toLocaleString("es-HN")} ítems por clasificar coinciden con los filtros actuales
          </p>
          <Button variant="outline" onClick={() => openBulkAssignmentDialog("filtered")}>
            <ArrowRightLeft className="h-4 w-4 mr-2" />
            Clasificar todo lo filtrado
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando inventario...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <Warehouse className="h-12 w-12 text-destructive/50 mx-auto mb-3" />
              <p className="font-medium text-foreground mb-1">
                No se pudo cargar el inventario
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                {error.message || "Ocurrio un error consultando la base de datos."}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          ) : groupedItems.length === 0 ? (
            <div className="p-8 text-center">
              <Warehouse className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {debouncedSearch
                  ? "No se encontraron ítems"
                  : projectFilter !== "all"
                    ? projectFilter === "unclassified"
                      ? "No hay inventario por clasificar"
                      : "No hay inventario asignado a este proyecto/bodega"
                    : "No hay inventario visible"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1560px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {canManage && allowInventoryReassignment ? (
                        <th className="p-3 text-left">
                          <Checkbox
                            checked={
                              allCurrentPageSelected
                                ? true
                                : someCurrentPageSelected
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(checked) =>
                              toggleAllCurrentPage(checked === true)
                            }
                            aria-label="Seleccionar todos los ítems visibles"
                          />
                        </th>
                      ) : null}
                      {columns.map((column) => (
                        <Fragment key={column.key}>
                          <th
                            className={`p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground ${column.align === "right" ? "text-right" : "text-left"}`}
                          >
                            <button
                              type="button"
                              onClick={() => handleSort(column.key)}
                              className={`inline-flex items-center gap-1.5 transition-colors hover:text-foreground ${column.align === "right" ? "ml-auto" : ""}`}
                            >
                              <span>{column.label}</span>
                              {renderSortIcon(column.key)}
                            </button>
                          </th>
                          {column.key === "currentStock" ? (
                            <>
                              <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right text-muted-foreground">
                                Total requeridas
                              </th>
                              <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right text-muted-foreground">
                                Por recibirse
                              </th>
                            </>
                          ) : null}
                        </Fragment>
                      ))}
                      <th className="p-3 font-semibold text-xs uppercase tracking-wider text-right text-muted-foreground">
                        Consultas
                      </th>
                      {canManage && allowInventoryReassignment ? (
                        <th className="p-3 font-semibold text-xs uppercase tracking-wider text-left text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.map((item: any) => {
                      const lowStock =
                        item.currentStock &&
                        item.minimumStock &&
                        parseFloat(item.currentStock) <=
                          parseFloat(item.minimumStock);
                      const isExpanded = expandedInventoryKeys.includes(item.id);
                      const hasBreakdown = item.projectBreakdown.length > 1;

                      return (
                        <Fragment key={item.id}>
                          <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            {canManage && allowInventoryReassignment ? (
                              <td className="p-3">
                                <Checkbox
                                  checked={item.sourceIds.every((id: number) =>
                                    selectedItemIds.includes(id)
                                  )}
                                  onCheckedChange={(checked) => {
                                    setSelectedItemIds((current) => {
                                      const next = new Set(current);
                                      item.sourceIds.forEach((id: number) =>
                                        checked ? next.add(id) : next.delete(id)
                                      );
                                      return Array.from(next);
                                    });
                                  }}
                                  aria-label={`Seleccionar ${item.sapItemCode}`}
                                />
                              </td>
                            ) : null}
                            <td className="p-3 font-mono text-xs">
                              {item.sapItemCode}
                            </td>
                            <td className="max-w-[360px] p-3">
                              <div className="font-medium">{item.name}</div>
                            </td>
                            <td className="p-3 text-xs">
                              {item.brand || "—"}
                            </td>
                            <td className="p-3 text-xs">
                              {item.partNumber || "—"}
                            </td>
                            <td className="p-3 text-xs">
                              {item.category || "—"}
                            </td>
                            <td className="p-3 text-xs">{item.unit || "—"}</td>
                            <td className="p-3 text-right">
                              <span
                                className={
                                  lowStock ? "text-destructive font-semibold" : ""
                                }
                              >
                                {formatQuantity(item.currentStock)}
                              </span>
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {item.pendingQuantitiesLoading ? (
                                <span className="inline-flex justify-end">
                                  <Spinner className="size-4 text-muted-foreground" />
                                </span>
                              ) : (
                                formatQuantity(item.totalRequiredQuantity)
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {item.pendingQuantitiesLoading ? (
                                <span className="inline-flex justify-end">
                                  <Spinner className="size-4 text-muted-foreground" />
                                </span>
                              ) : (
                                formatQuantity(item.pendingReceiptQuantity)
                              )}
                            </td>
                            <td className="p-3 text-right text-muted-foreground">
                              {item.minimumStock || "—"}
                            </td>
                            <td className="p-3 text-xs">
                              {hasBreakdown ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 max-w-[260px] px-2"
                                  onClick={() => toggleInventoryBreakdown(item.id)}
                                >
                                  {isExpanded ? (
                                    <ChevronUp className="mr-1 h-3.5 w-3.5 shrink-0" />
                                  ) : (
                                    <ChevronDown className="mr-1 h-3.5 w-3.5 shrink-0" />
                                  )}
                                  <span className="truncate">
                                    {item.projectSummaryLabel}
                                  </span>
                                </Button>
                              ) : (
                                item.projectSummaryLabel || "Por clasificar"
                              )}
                            </td>
                            <td className="p-3 text-xs">
                              {item.warehouseSummaryLabel || "—"}
                            </td>
                            <td className="p-3">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2"
                                  title="Seguimiento"
                                  onClick={() => setTrackingItem(item)}
                                >
                                  <ClipboardList className="h-3.5 w-3.5" />
                                  <span className="ml-2 hidden xl:inline">
                                    Seguimiento
                                  </span>
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2"
                                  title="Kardex"
                                  onClick={() => setKardexItem(item)}
                                >
                                  <BookOpen className="h-3.5 w-3.5" />
                                  <span className="ml-2 hidden xl:inline">
                                    Kardex
                                  </span>
                                </Button>
                              </div>
                            </td>
                            {canManage && allowInventoryReassignment ? (
                              <td className="p-3">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => openAssignmentDialog(item)}
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5 mr-2" />
                                  Clasificar
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                          {hasBreakdown && isExpanded ? (
                            <tr className="border-b bg-muted/20">
                              <td
                                className="px-3 py-2"
                                colSpan={
                                  columns.length +
                                  3 +
                                  (canManage && allowInventoryReassignment ? 2 : 0)
                                }
                              >
                                <div className="ml-auto max-w-2xl overflow-x-auto rounded-md border bg-background">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b bg-muted/30">
                                        <th className="p-2 text-left font-semibold uppercase tracking-wider text-muted-foreground">
                                          Proyecto / bodega
                                        </th>
                                        <th className="p-2 text-right font-semibold uppercase tracking-wider text-muted-foreground">
                                          Stock
                                        </th>
                                        <th className="p-2 text-right font-semibold uppercase tracking-wider text-muted-foreground">
                                          Mínimo
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {item.projectBreakdown.map(
                                        (projectRow: any) => (
                                          <tr
                                            key={projectRow.id}
                                            className="border-b last:border-0"
                                          >
                                            <td className="p-2">
                                              {projectRow.projectLabel}
                                            </td>
                                            <td className="p-2 text-right font-mono">
                                              {formatQuantity(
                                                projectRow.currentStock
                                              )}
                                            </td>
                                            <td className="p-2 text-right font-mono text-muted-foreground">
                                              {projectRow.minimumStock
                                                ? formatQuantity(
                                                    projectRow.minimumStock
                                                  )
                                                : "—"}
                                            </td>
                                          </tr>
                                        )
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-border px-4 py-4 md:flex-row md:items-center md:justify-between">
                <p className="text-sm text-muted-foreground">
                  {groupedItems.length !== items.length ? (
                    <>
                      Mostrando{" "}
                      {groupedItems.length.toLocaleString("es-HN")} grupos en
                      esta página ({rangeStart.toLocaleString("es-HN")} a{" "}
                      {rangeEnd.toLocaleString("es-HN")} de{" "}
                      {total.toLocaleString("es-HN")} registros)
                    </>
                  ) : (
                    <>
                      Mostrando {rangeStart.toLocaleString("es-HN")} a{" "}
                      {rangeEnd.toLocaleString("es-HN")} de{" "}
                      {total.toLocaleString("es-HN")} registros
                    </>
                  )}
                </p>

                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if ((data?.page ?? page) <= 1) return;
                          setPage((current) => current - 1);
                        }}
                        className={(data?.page ?? page) <= 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>

                    {pageItems.map((pageItem, index) => (
                      <PaginationItem key={`${pageItem}-${index}`}>
                        {pageItem === "ellipsis" ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            href="#"
                            isActive={pageItem === (data?.page ?? page)}
                            onClick={(e) => {
                              e.preventDefault();
                              setPage(pageItem);
                            }}
                          >
                            {pageItem}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          if ((data?.page ?? page) >= totalPages) return;
                          setPage((current) => current + 1);
                        }}
                        className={(data?.page ?? page) >= totalPages ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
