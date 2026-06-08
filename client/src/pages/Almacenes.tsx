import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUpDown,
  Building2,
  FolderKanban,
  Package,
  Plus,
  Search,
  Star,
  Trash2,
  Unlink,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type WarehouseFormState = {
  code: string;
  name: string;
  description: string;
  projectId: string;
};

type WarehouseSortField =
  | "code"
  | "name"
  | "responsible"
  | "projectCount"
  | "inventoryRows"
  | "uniqueItems"
  | "status";

type WarehouseInventorySortField =
  | "sap"
  | "item"
  | "unit"
  | "stock"
  | "project";

type WarehouseProjectSortField = "code" | "name" | "status";

type WarehouseUserSortField = "user" | "role" | "status";

const EMPTY_WAREHOUSE_FORM: WarehouseFormState = {
  code: "",
  name: "",
  description: "",
  projectId: "",
};

const WAREHOUSE_USER_ROLE_LABELS: Record<string, string> = {
  jefe_bodega_central: "Bodega Central",
  bodeguero_proyecto: "Bodega Proyecto",
};

function formatNumber(value?: number | string | null) {
  return Number(value ?? 0).toLocaleString("es-HN");
}

function formatWarehouseUser(user: any) {
  return user?.name || user?.email || `Usuario ${user?.id ?? ""}`;
}

function formatWarehouseUserRole(role?: string | null) {
  return role ? WAREHOUSE_USER_ROLE_LABELS[role] || "Bodega" : "Bodega";
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getWarehouseSortValue(warehouse: any, field: WarehouseSortField) {
  switch (field) {
    case "code":
      return warehouse.code ?? "";
    case "name":
      return warehouse.name ?? "";
    case "responsible":
      return warehouse.responsibleUser
        ? formatWarehouseUser(warehouse.responsibleUser)
        : "Sin responsable";
    case "projectCount":
      return Number(warehouse.projectCount ?? 0);
    case "inventoryRows":
      return Number(warehouse.inventoryRows ?? 0);
    case "uniqueItems":
      return Number(warehouse.uniqueItems ?? 0);
    case "status":
      return warehouse.isActive ? "Activo" : "Inactivo";
    default:
      return "";
  }
}

function compareSortValues(leftValue: unknown, rightValue: unknown) {
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue;
  }

  return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "es-HN", {
    numeric: true,
    sensitivity: "base",
  });
}

function compareWarehouseByField(
  left: any,
  right: any,
  field: WarehouseSortField
) {
  const leftValue = getWarehouseSortValue(left, field);
  const rightValue = getWarehouseSortValue(right, field);

  return compareSortValues(leftValue, rightValue);
}

function getInventoryProjectLabel(item: any) {
  return item.project ? `${item.project.code} - ${item.project.name}` : "Sin proyecto";
}

function getInventorySortValue(item: any, field: WarehouseInventorySortField) {
  switch (field) {
    case "sap":
      return item.sapItemCode ?? "";
    case "item":
      return item.name ?? "";
    case "unit":
      return item.unit ?? "";
    case "stock":
      return Number(item.currentStock ?? 0);
    case "project":
      return getInventoryProjectLabel(item);
    default:
      return "";
  }
}

function getWarehouseProjectSortValue(project: any, field: WarehouseProjectSortField) {
  switch (field) {
    case "code":
      return project.code ?? "";
    case "name":
      return project.name ?? "";
    case "status":
      return project.status === "activo" ? "Activo" : "Inactivo";
    default:
      return "";
  }
}

function getWarehouseUserSortValue(user: any, field: WarehouseUserSortField) {
  switch (field) {
    case "user":
      return formatWarehouseUser(user);
    case "role":
      return formatWarehouseUserRole(user.buildreqRole);
    case "status":
      return user.isResponsible ? "Responsable" : "Acceso";
    default:
      return "";
  }
}

export default function Almacenes() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(
    null
  );
  const [warehouseForm, setWarehouseForm] =
    useState<WarehouseFormState>(EMPTY_WAREHOUSE_FORM);
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [warehouseSearch, setWarehouseSearch] = useState("");
  const [warehouseSortField, setWarehouseSortField] =
    useState<WarehouseSortField | null>(null);
  const [detailInventorySearch, setDetailInventorySearch] = useState("");
  const [detailInventorySortField, setDetailInventorySortField] =
    useState<WarehouseInventorySortField | null>(null);
  const [detailProjectSearch, setDetailProjectSearch] = useState("");
  const [detailProjectSortField, setDetailProjectSortField] =
    useState<WarehouseProjectSortField | null>(null);
  const [detailUserSearch, setDetailUserSearch] = useState("");
  const [detailUserSortField, setDetailUserSortField] =
    useState<WarehouseUserSortField | null>(null);

  const userRole = (user as any)?.buildreqRole || "";
  const isProjectWarehouseManager = userRole === "administrador_proyecto";
  const canManage =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    isProjectWarehouseManager;
  const canView =
    canManage ||
    userRole === "jefe_bodega_central" ||
    userRole === "bodeguero_proyecto" ||
    userRole === "administrador_proyecto";

  const { data: warehouses, isLoading } = trpc.warehouses.list.useQuery(
    undefined,
    { enabled: canView }
  );
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: canManage,
  });
  const { data: assignableUsers } = trpc.warehouses.assignableUsers.useQuery(
    undefined,
    { enabled: canManage && detailDialogOpen }
  );
  const { data: selectedWarehouse, isLoading: isLoadingDetail } =
    trpc.warehouses.getById.useQuery(
      { id: selectedWarehouseId ?? 0 },
      { enabled: canView && detailDialogOpen && Boolean(selectedWarehouseId) }
    );
  const { data: inventory } = trpc.inventory.list.useQuery(
    {
      warehouseId: selectedWarehouseId ?? undefined,
      pageSize: 100,
      sortBy: "name",
      sortDir: "asc",
    },
    { enabled: canView && detailDialogOpen && Boolean(selectedWarehouseId) }
  );

  const availableProjects = useMemo(
    () => {
      const assignedProjectIds = new Set(
        (selectedWarehouse?.projects ?? []).map((project: any) =>
          Number(project.id)
        )
      );
      return (projects ?? []).filter(
        (project: any) =>
          project.status === "activo" &&
          !assignedProjectIds.has(Number(project.id))
      );
    },
    [projects, selectedWarehouse]
  );

  const availableWarehouseUsers = useMemo(() => {
    const assignedUserIds = new Set(
      (selectedWarehouse?.assignedUsers ?? []).map((assignedUser: any) =>
        Number(assignedUser.id)
      )
    );
    return (assignableUsers ?? []).filter(
      (warehouseUser: any) => !assignedUserIds.has(Number(warehouseUser.id))
    );
  }, [assignableUsers, selectedWarehouse]);

  const totalProjects = useMemo(
    () =>
      (warehouses ?? []).reduce(
        (total: number, warehouse: any) =>
          total + Number(warehouse.projectCount ?? 0),
        0
      ),
    [warehouses]
  );

  const totalInventoryRows = useMemo(
    () =>
      (warehouses ?? []).reduce(
        (total: number, warehouse: any) =>
          total + Number(warehouse.inventoryRows ?? 0),
        0
      ),
    [warehouses]
  );

  const totalUniqueItems = useMemo(
    () =>
      (warehouses ?? []).reduce(
        (total: number, warehouse: any) =>
          total + Number(warehouse.uniqueItems ?? 0),
        0
      ),
    [warehouses]
  );

  const visibleWarehouses = useMemo(() => {
    const search = normalizeSearchText(warehouseSearch);
    const filtered = (warehouses ?? []).filter((warehouse: any) => {
      if (!search) return true;

      return normalizeSearchText(
        [
          warehouse.code,
          warehouse.localCode,
          warehouse.name,
          warehouse.displayName,
        ]
          .filter(Boolean)
          .join(" ")
      ).includes(search);
    });

    if (!warehouseSortField) return filtered;

    return [...filtered].sort((left, right) =>
      compareWarehouseByField(left, right, warehouseSortField)
    );
  }, [warehouseSearch, warehouseSortField, warehouses]);

  const visibleInventoryItems = useMemo(() => {
    const search = normalizeSearchText(detailInventorySearch);
    const filtered = (inventory?.items ?? []).filter((item: any) => {
      if (!search) return true;

      return normalizeSearchText(
        [
          item.sapItemCode,
          item.name,
          item.unit,
          getInventoryProjectLabel(item),
        ]
          .filter(Boolean)
          .join(" ")
      ).includes(search);
    });

    if (!detailInventorySortField) return filtered;

    return [...filtered].sort((left, right) =>
      compareSortValues(
        getInventorySortValue(left, detailInventorySortField),
        getInventorySortValue(right, detailInventorySortField)
      )
    );
  }, [detailInventorySearch, detailInventorySortField, inventory?.items]);

  const visibleWarehouseProjects = useMemo(() => {
    const search = normalizeSearchText(detailProjectSearch);
    const filtered = (selectedWarehouse?.projects ?? []).filter((project: any) => {
      if (!search) return true;

      return normalizeSearchText([project.code, project.name, project.status].join(" "))
        .includes(search);
    });

    if (!detailProjectSortField) return filtered;

    return [...filtered].sort((left, right) =>
      compareSortValues(
        getWarehouseProjectSortValue(left, detailProjectSortField),
        getWarehouseProjectSortValue(right, detailProjectSortField)
      )
    );
  }, [detailProjectSearch, detailProjectSortField, selectedWarehouse?.projects]);

  const visibleWarehouseUsers = useMemo(() => {
    const search = normalizeSearchText(detailUserSearch);
    const filtered = (selectedWarehouse?.assignedUsers ?? []).filter((assignedUser: any) => {
      if (!search) return true;

      return normalizeSearchText(
        [
          formatWarehouseUser(assignedUser),
          assignedUser.email,
          formatWarehouseUserRole(assignedUser.buildreqRole),
          assignedUser.isResponsible ? "Responsable" : "Acceso",
        ]
          .filter(Boolean)
          .join(" ")
      ).includes(search);
    });

    if (!detailUserSortField) return filtered;

    return [...filtered].sort((left, right) =>
      compareSortValues(
        getWarehouseUserSortValue(left, detailUserSortField),
        getWarehouseUserSortValue(right, detailUserSortField)
      )
    );
  }, [detailUserSearch, detailUserSortField, selectedWarehouse?.assignedUsers]);

  const createMutation = trpc.warehouses.create.useMutation({
    onSuccess: () => {
      toast.success("Bodega creada");
      setCreateDialogOpen(false);
      setWarehouseForm(EMPTY_WAREHOUSE_FORM);
      void Promise.all([
        utils.warehouses.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const assignMutation = trpc.warehouses.assignProject.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.linkedRows > 0
          ? `Proyecto asignado y ${formatNumber(result.linkedRows)} filas de inventario actualizadas`
          : "Proyecto asignado"
      );
      setAssignProjectId("");
      void Promise.all([
        utils.warehouses.list.invalidate(),
        selectedWarehouseId
          ? utils.warehouses.getById.invalidate({ id: selectedWarehouseId })
          : Promise.resolve(),
        utils.inventory.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const unassignMutation = trpc.warehouses.unassignProject.useMutation({
    onSuccess: () => {
      toast.success("Proyecto desasignado");
      void Promise.all([
        utils.warehouses.list.invalidate(),
        selectedWarehouseId
          ? utils.warehouses.getById.invalidate({ id: selectedWarehouseId })
          : Promise.resolve(),
        utils.inventory.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const assignUserMutation = trpc.warehouses.assignUser.useMutation({
    onSuccess: () => {
      toast.success("Usuario asignado a la bodega");
      setAssignUserId("");
      void Promise.all([
        utils.warehouses.list.invalidate(),
        selectedWarehouseId
          ? utils.warehouses.getById.invalidate({ id: selectedWarehouseId })
          : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const unassignUserMutation = trpc.warehouses.unassignUser.useMutation({
    onSuccess: () => {
      toast.success("Usuario quitado de la bodega");
      void Promise.all([
        utils.warehouses.list.invalidate(),
        selectedWarehouseId
          ? utils.warehouses.getById.invalidate({ id: selectedWarehouseId })
          : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const setResponsibleMutation = trpc.warehouses.setResponsible.useMutation({
    onSuccess: () => {
      toast.success("Responsable actualizado");
      void Promise.all([
        utils.warehouses.list.invalidate(),
        selectedWarehouseId
          ? utils.warehouses.getById.invalidate({ id: selectedWarehouseId })
          : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const openWarehouseDetail = (warehouseId: number) => {
    setSelectedWarehouseId(warehouseId);
    setAssignProjectId("");
    setAssignUserId("");
    setDetailInventorySearch("");
    setDetailInventorySortField(null);
    setDetailProjectSearch("");
    setDetailProjectSortField(null);
    setDetailUserSearch("");
    setDetailUserSortField(null);
    setDetailDialogOpen(true);
  };

  const submitWarehouse = () => {
    if (!warehouseForm.code.trim() || !warehouseForm.name.trim()) {
      toast.error("Código y nombre son obligatorios");
      return;
    }
    if (isProjectWarehouseManager && !warehouseForm.projectId) {
      toast.error("Seleccione el proyecto que usará esta bodega");
      return;
    }
    createMutation.mutate({
      code: warehouseForm.code.trim(),
      name: warehouseForm.name.trim(),
      description: warehouseForm.description.trim() || null,
      projectId: warehouseForm.projectId
        ? Number(warehouseForm.projectId)
        : undefined,
    });
  };

  const renderSortableHeader = (
    field: WarehouseSortField,
    label: string,
    align: "left" | "right" = "left"
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={[
        "h-auto gap-1 px-0 py-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground",
        align === "right" ? "ml-auto justify-end" : "justify-start",
        warehouseSortField === field ? "text-foreground" : "",
      ].join(" ")}
      onClick={() => setWarehouseSortField(field)}
    >
      {label}
      <ArrowUpDown className="h-3.5 w-3.5" />
    </Button>
  );

  const renderDetailSortableHeader = (
    label: string,
    active: boolean,
    onClick: () => void,
    align: "left" | "right" = "left"
  ) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={[
        "h-auto gap-1 px-0 py-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground",
        align === "right" ? "ml-auto justify-end" : "justify-start",
        active ? "text-foreground" : "",
      ].join(" ")}
      onClick={onClick}
    >
      {label}
      <ArrowUpDown className="h-3.5 w-3.5" />
    </Button>
  );

  if (!canView) {
    return (
      <Card>
        <CardContent className="flex min-h-[240px] items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No tienes acceso a este módulo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h1>Almacenes</h1>
          <p className="text-sm text-muted-foreground">
            Las bodegas agrupan proyectos asignados y concentran su inventario
            operativo.
          </p>
        </div>

        {canManage ? (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Crear bodega
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Nueva bodega</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Código *</Label>
                    <Input
                      value={warehouseForm.code}
                      onChange={(event) =>
                        setWarehouseForm((form) => ({
                          ...form,
                          code: event.target.value,
                        }))
                      }
                      placeholder="BOD-001"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input
                      value={warehouseForm.name}
                      onChange={(event) =>
                        setWarehouseForm((form) => ({
                          ...form,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Bodega Principal"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Descripción</Label>
                  <Textarea
                    value={warehouseForm.description}
                    onChange={(event) =>
                      setWarehouseForm((form) => ({
                        ...form,
                        description: event.target.value,
                      }))
                    }
                    rows={2}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Proyecto inicial{isProjectWarehouseManager ? " *" : ""}
                  </Label>
                  <Select
                    value={warehouseForm.projectId || undefined}
                    onValueChange={(projectId) =>
                      setWarehouseForm((form) => ({ ...form, projectId }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un proyecto disponible" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProjects.map((project: any) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    El proyecto quedará asignado a esta bodega como almacén padre.
                  </p>
                </div>
                <Button
                  className="w-full"
                  disabled={createMutation.isPending}
                  onClick={submitWarehouse}
                >
                  {createMutation.isPending ? "Creando..." : "Crear bodega"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Bodegas activas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : formatNumber(warehouses?.length)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderKanban className="h-4 w-4 text-primary" />
              Proyectos asignados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : formatNumber(totalProjects)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-primary" />
              Artículos únicos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : formatNumber(totalUniqueItems)}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(totalInventoryRows)} filas de inventario
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bodegas</CardTitle>
          <CardDescription>
            Selecciona una bodega para revisar su inventario y administrar los
            proyectos y usuarios asignados.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Cargando bodegas...
            </div>
          ) : !warehouses?.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Aún no hay bodegas registradas.
            </div>
          ) : (
            <div>
              <div className="border-t border-border px-4 py-3">
                <div className="grid gap-2 md:grid-cols-[minmax(240px,420px)_auto] md:items-end md:justify-between">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Buscar bodega
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={warehouseSearch}
                        onChange={(event) => setWarehouseSearch(event.target.value)}
                        placeholder="Código o nombre de almacén"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mostrando {formatNumber(visibleWarehouses.length)} de{" "}
                    {formatNumber(warehouses.length)}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-3 text-left">
                        {renderSortableHeader("code", "Código")}
                      </th>
                      <th className="p-3 text-left">
                        {renderSortableHeader("name", "Nombre")}
                      </th>
                      <th className="p-3 text-left">
                        {renderSortableHeader("responsible", "Responsable")}
                      </th>
                      <th className="p-3 text-right">
                        {renderSortableHeader(
                          "projectCount",
                          "Proyectos asignados",
                          "right"
                        )}
                      </th>
                      <th className="p-3 text-right">
                        {renderSortableHeader("inventoryRows", "Filas", "right")}
                      </th>
                      <th className="p-3 text-right">
                        {renderSortableHeader("uniqueItems", "Artículos", "right")}
                      </th>
                      <th className="p-3 text-left">
                        {renderSortableHeader("status", "Estado")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWarehouses.length === 0 ? (
                      <tr>
                        <td
                          className="p-8 text-center text-sm text-muted-foreground"
                          colSpan={7}
                        >
                          No hay bodegas que coincidan con la búsqueda.
                        </td>
                      </tr>
                    ) : (
                      visibleWarehouses.map((warehouse: any) => (
                        <tr
                          key={warehouse.id}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40"
                          onClick={() => openWarehouseDetail(warehouse.id)}
                        >
                          <td className="p-3 font-mono text-xs">
                            {warehouse.code}
                          </td>
                          <td className="p-3 font-medium">
                            <div>{warehouse.name}</div>
                            {warehouse.description ? (
                              <div className="text-xs text-muted-foreground">
                                {warehouse.description}
                              </div>
                            ) : null}
                          </td>
                          <td className="p-3">
                            {warehouse.responsibleUser ? (
                              <div>
                                <div className="font-medium">
                                  {formatWarehouseUser(warehouse.responsibleUser)}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {formatWarehouseUserRole(
                                    warehouse.responsibleUser.buildreqRole
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Sin responsable
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {formatNumber(warehouse.projectCount)}
                          </td>
                          <td className="p-3 text-right">
                            {formatNumber(warehouse.inventoryRows)}
                          </td>
                          <td className="p-3 text-right">
                            {formatNumber(warehouse.uniqueItems)}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={warehouse.isActive ? "secondary" : "outline"}
                            >
                              {warehouse.isActive ? "Activo" : "Inactivo"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="top-4 h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] translate-y-0 content-start overflow-y-auto sm:w-[calc(100vw-3rem)] sm:max-w-[calc(100vw-3rem)] xl:max-w-[1400px]">
          <DialogHeader>
            <DialogTitle>
              {selectedWarehouse
                ? `${selectedWarehouse.code} - ${selectedWarehouse.name}`
                : "Detalle de bodega"}
            </DialogTitle>
          </DialogHeader>

          {isLoadingDetail ? (
            <div className="h-32 animate-pulse rounded-md bg-muted" />
          ) : selectedWarehouse ? (
            <Tabs defaultValue="inventario" className="pt-2">
              <TabsList>
                <TabsTrigger value="inventario">Inventario</TabsTrigger>
                <TabsTrigger value="proyectos">Proyectos</TabsTrigger>
                <TabsTrigger value="usuarios">Usuarios</TabsTrigger>
              </TabsList>

              <TabsContent value="inventario" className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Filas</p>
                    <p className="text-xl font-semibold">
                      {formatNumber(selectedWarehouse.inventoryRows)}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Artículos</p>
                    <p className="text-xl font-semibold">
                      {formatNumber(selectedWarehouse.uniqueItems)}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Stock</p>
                    <p className="text-xl font-semibold">
                      {formatNumber(selectedWarehouse.totalStock)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-[minmax(240px,420px)_auto] md:items-end md:justify-between">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Buscar inventario
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={detailInventorySearch}
                        onChange={(event) =>
                          setDetailInventorySearch(event.target.value)
                        }
                        placeholder="SAP, artículo, unidad o proyecto"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mostrando {formatNumber(visibleInventoryItems.length)} de{" "}
                    {formatNumber(inventory?.items?.length ?? 0)}
                  </p>
                </div>

                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "SAP",
                              detailInventorySortField === "sap",
                              () => setDetailInventorySortField("sap")
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Artículo",
                              detailInventorySortField === "item",
                              () => setDetailInventorySortField("item")
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Unidad",
                              detailInventorySortField === "unit",
                              () => setDetailInventorySortField("unit")
                            )}
                          </th>
                          <th className="p-3 text-right">
                            {renderDetailSortableHeader(
                              "Stock",
                              detailInventorySortField === "stock",
                              () => setDetailInventorySortField("stock"),
                              "right"
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Proyecto",
                              detailInventorySortField === "project",
                              () => setDetailInventorySortField("project")
                            )}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleInventoryItems.length === 0 ? (
                          <tr>
                            <td
                              className="p-4 text-center text-sm text-muted-foreground"
                              colSpan={5}
                            >
                              {(inventory?.items ?? []).length === 0
                                ? "Esta bodega no tiene inventario registrado."
                                : "No hay inventario que coincida con la búsqueda."}
                            </td>
                          </tr>
                        ) : (
                          visibleInventoryItems.map((item: any) => (
                            <tr key={item.id} className="border-b last:border-0">
                              <td className="p-3 font-mono text-xs">
                                {item.sapItemCode}
                              </td>
                              <td className="p-3">{item.name}</td>
                              <td className="p-3 text-xs">{item.unit || "-"}</td>
                              <td className="p-3 text-right">
                                {formatNumber(item.currentStock)}
                              </td>
                              <td className="p-3 text-xs">
                                {getInventoryProjectLabel(item)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="proyectos" className="space-y-4">
                <div className="grid gap-2 md:grid-cols-[minmax(240px,420px)_auto] md:items-end md:justify-between">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Buscar proyecto
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={detailProjectSearch}
                        onChange={(event) =>
                          setDetailProjectSearch(event.target.value)
                        }
                        placeholder="Código, nombre o estado"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mostrando {formatNumber(visibleWarehouseProjects.length)} de{" "}
                    {formatNumber(selectedWarehouse.projects?.length ?? 0)}
                  </p>
                </div>

                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Código",
                              detailProjectSortField === "code",
                              () => setDetailProjectSortField("code")
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Proyecto",
                              detailProjectSortField === "name",
                              () => setDetailProjectSortField("name")
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Estado",
                              detailProjectSortField === "status",
                              () => setDetailProjectSortField("status")
                            )}
                          </th>
                          {canManage ? (
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Acciones
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleWarehouseProjects.length === 0 ? (
                          <tr>
                            <td
                              className="p-4 text-center text-sm text-muted-foreground"
                              colSpan={canManage ? 4 : 3}
                            >
                              {(selectedWarehouse.projects ?? []).length === 0
                                ? "No hay proyectos asignados a esta bodega."
                                : "No hay proyectos que coincidan con la búsqueda."}
                            </td>
                          </tr>
                        ) : (
                          visibleWarehouseProjects.map((project: any) => (
                            <tr key={project.id} className="border-b last:border-0">
                              <td className="p-3 font-mono text-xs">
                                {project.code}
                              </td>
                              <td className="p-3">{project.name}</td>
                              <td className="p-3">
                                <Badge variant="outline">
                                  {project.status === "activo"
                                    ? "Activo"
                                    : "Inactivo"}
                                </Badge>
                              </td>
                              {canManage ? (
                                <td className="p-3 text-right">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={unassignMutation.isPending}
                                    onClick={() =>
                                      unassignMutation.mutate({
                                        warehouseId: selectedWarehouse.id,
                                        projectId: project.id,
                                      })
                                    }
                                  >
                                    <Unlink className="mr-2 h-4 w-4" />
                                    Quitar
                                  </Button>
                                </td>
                              ) : null}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {canManage ? (
                  <div className="rounded-md border p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Proyecto disponible</Label>
                        <Select
                          value={assignProjectId || undefined}
                          onValueChange={setAssignProjectId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccione un proyecto" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableProjects.map((project: any) => (
                              <SelectItem
                                key={project.id}
                                value={String(project.id)}
                              >
                                {project.code} - {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        disabled={!assignProjectId || assignMutation.isPending}
                        onClick={() =>
                          assignMutation.mutate({
                            warehouseId: selectedWarehouse.id,
                            projectId: Number(assignProjectId),
                          })
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Asignar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="usuarios" className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Responsable</p>
                    {selectedWarehouse.responsibleUser ? (
                      <div className="mt-1">
                        <p className="font-semibold">
                          {formatWarehouseUser(selectedWarehouse.responsibleUser)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatWarehouseUserRole(
                            selectedWarehouse.responsibleUser.buildreqRole
                          )}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Sin responsable asignado
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      Usuarios con acceso
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatNumber(selectedWarehouse.assignedUsersCount)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-[minmax(240px,420px)_auto] md:items-end md:justify-between">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Buscar usuario
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={detailUserSearch}
                        onChange={(event) => setDetailUserSearch(event.target.value)}
                        placeholder="Nombre, correo, rol o estado"
                        className="pl-9"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mostrando {formatNumber(visibleWarehouseUsers.length)} de{" "}
                    {formatNumber(selectedWarehouse.assignedUsers?.length ?? 0)}
                  </p>
                </div>

                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Usuario",
                              detailUserSortField === "user",
                              () => setDetailUserSortField("user")
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Rol",
                              detailUserSortField === "role",
                              () => setDetailUserSortField("role")
                            )}
                          </th>
                          <th className="p-3 text-left">
                            {renderDetailSortableHeader(
                              "Estado",
                              detailUserSortField === "status",
                              () => setDetailUserSortField("status")
                            )}
                          </th>
                          {canManage ? (
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Acciones
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleWarehouseUsers.length === 0 ? (
                          <tr>
                            <td
                              className="p-4 text-center text-sm text-muted-foreground"
                              colSpan={canManage ? 4 : 3}
                            >
                              {(selectedWarehouse.assignedUsers ?? []).length === 0
                                ? "No hay usuarios asignados a esta bodega."
                                : "No hay usuarios que coincidan con la búsqueda."}
                            </td>
                          </tr>
                        ) : (
                          visibleWarehouseUsers.map((assignedUser: any) => (
                            <tr
                              key={assignedUser.id}
                              className="border-b last:border-0"
                            >
                              <td className="p-3">
                                <div className="font-medium">
                                  {formatWarehouseUser(assignedUser)}
                                </div>
                                {assignedUser.email ? (
                                  <div className="text-xs text-muted-foreground">
                                    {assignedUser.email}
                                  </div>
                                ) : null}
                              </td>
                              <td className="p-3 text-xs">
                                {formatWarehouseUserRole(assignedUser.buildreqRole)}
                              </td>
                              <td className="p-3">
                                {assignedUser.isResponsible ? (
                                  <Badge variant="secondary">
                                    Responsable
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">Acceso</Badge>
                                )}
                              </td>
                              {canManage ? (
                                <td className="p-3">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={
                                        assignedUser.isResponsible ||
                                        setResponsibleMutation.isPending
                                      }
                                      onClick={() =>
                                        setResponsibleMutation.mutate({
                                          warehouseId: selectedWarehouse.id,
                                          userId: assignedUser.id,
                                        })
                                      }
                                    >
                                      <Star className="mr-2 h-4 w-4" />
                                      Responsable
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={unassignUserMutation.isPending}
                                      onClick={() =>
                                        unassignUserMutation.mutate({
                                          warehouseId: selectedWarehouse.id,
                                          userId: assignedUser.id,
                                        })
                                      }
                                    >
                                      <Trash2 className="mr-2 h-4 w-4" />
                                      Quitar
                                    </Button>
                                  </div>
                                </td>
                              ) : null}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {canManage ? (
                  <div className="rounded-md border p-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Usuario de bodega</Label>
                        <Select
                          value={assignUserId || undefined}
                          onValueChange={setAssignUserId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccione un usuario" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableWarehouseUsers.map((warehouseUser: any) => (
                              <SelectItem
                                key={warehouseUser.id}
                                value={String(warehouseUser.id)}
                              >
                                {formatWarehouseUser(warehouseUser)} ·{" "}
                                {formatWarehouseUserRole(warehouseUser.buildreqRole)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        disabled={!assignUserId || assignUserMutation.isPending}
                        onClick={() =>
                          assignUserMutation.mutate({
                            warehouseId: selectedWarehouse.id,
                            userId: Number(assignUserId),
                          })
                        }
                      >
                        <UserPlus className="mr-2 h-4 w-4" />
                        Asignar
                      </Button>
                    </div>
                  </div>
                ) : null}
              </TabsContent>
            </Tabs>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No se pudo cargar la bodega.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
