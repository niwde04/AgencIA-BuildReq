import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CalendarDays,
  FolderKanban,
  Pencil,
  Plus,
  Save,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

type ProjectRecord = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  location?: string | null;
  status: string;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  sapProjectCode?: string | null;
  subprojectsCount?: number;
  warehouseCount?: number;
  totalStock?: string | null;
  warehouse?: {
    displayName: string;
  } | null;
  warehouses?: WarehouseRecord[];
  defaultWarehouse?: WarehouseRecord | null;
};

type WarehouseRecord = {
  id: number;
  code: string;
  localCode?: string | null;
  name: string;
  displayName: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  inventoryRows?: number;
  uniqueItems?: number;
};

type SubprojectRecord = {
  id: number;
  projectId: number;
  code: string;
  name: string;
  description?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  isActive: boolean;
};

type ProjectFormState = {
  code: string;
  name: string;
  description: string;
  location: string;
  sapProjectCode: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

type SubprojectFormState = {
  code: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

type WarehouseFormState = {
  localCode: string;
  name: string;
  description: string;
  isDefault: boolean;
};

const EMPTY_PROJECT_FORM: ProjectFormState = {
  code: "",
  name: "",
  description: "",
  location: "",
  sapProjectCode: "",
  startDate: "",
  endDate: "",
  isActive: true,
};

const EMPTY_SUBPROJECT_FORM: SubprojectFormState = {
  code: "",
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  isActive: true,
};

const EMPTY_WAREHOUSE_FORM: WarehouseFormState = {
  localCode: "",
  name: "",
  description: "",
  isDefault: false,
};

function formatDateInput(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-HN");
}

function formatDateRange(startDate?: Date | string | null, endDate?: Date | string | null) {
  const start = formatDateLabel(startDate);
  const end = formatDateLabel(endDate);
  if (start && end) return `${start} - ${end}`;
  if (start) return `Inicio ${start}`;
  if (end) return `Fin ${end}`;
  return "";
}

function hasInvalidDateRange(startDate: string, endDate: string) {
  return Boolean(startDate && endDate && endDate < startDate);
}

function projectToForm(project: ProjectRecord): ProjectFormState {
  return {
    code: project.code ?? "",
    name: project.name ?? "",
    description: project.description ?? "",
    location: project.location ?? "",
    sapProjectCode: project.sapProjectCode ?? "",
    startDate: formatDateInput(project.startDate),
    endDate: formatDateInput(project.endDate),
    isActive: project.status === "activo",
  };
}

function subprojectToForm(subproject: SubprojectRecord): SubprojectFormState {
  return {
    code: subproject.code ?? "",
    name: subproject.name ?? "",
    description: subproject.description ?? "",
    startDate: formatDateInput(subproject.startDate),
    endDate: formatDateInput(subproject.endDate),
    isActive: subproject.isActive,
  };
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

export default function Proyectos() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(null);
  const [projectForm, setProjectForm] =
    useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [createForm, setCreateForm] =
    useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [subprojectForm, setSubprojectForm] =
    useState<SubprojectFormState>(EMPTY_SUBPROJECT_FORM);
  const [warehouseForm, setWarehouseForm] =
    useState<WarehouseFormState>(EMPTY_WAREHOUSE_FORM);
  const [editingSubproject, setEditingSubproject] =
    useState<SubprojectRecord | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");

  const isAdmin = user?.role === "admin";
  const userRole = (user as any)?.buildreqRole || "";
  const canManageWarehouses =
    user?.role === "admin" ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central";
  const selectedProjectId = selectedProject?.id ?? 0;

  const {
    data: projects,
    isLoading,
    error: projectsError,
  } = trpc.projects.list.useQuery();
  const { data: subprojects, isLoading: isLoadingSubprojects } =
    trpc.projects.listSubprojects.useQuery(
      { projectId: selectedProjectId },
      { enabled: detailDialogOpen && selectedProjectId > 0 }
    );
  const selectedProjectWarehouses = useMemo(
    () => selectedProject?.warehouses ?? [],
    [selectedProject]
  );

  const activeProjectsCount = useMemo(
    () => (projects ?? []).filter((project: any) => project.status === "activo").length,
    [projects]
  );
  const filteredProjects = useMemo(() => {
    const normalizedSearch = projectSearch.trim().toLowerCase();

    return (projects ?? []).filter((project: ProjectRecord) => {
      const matchesStatus =
        projectStatusFilter === "all" || project.status === projectStatusFilter;
      if (!matchesStatus) return false;
      if (!normalizedSearch) return true;

      const searchableText = [
        project.code,
        project.name,
        project.sapProjectCode,
        project.warehouse?.displayName,
        project.defaultWarehouse?.displayName,
        ...(project.warehouses ?? []).flatMap((warehouse) => [
          warehouse.code,
          warehouse.localCode,
          warehouse.name,
          warehouse.displayName,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedSearch);
    });
  }, [projectSearch, projectStatusFilter, projects]);
  const hasSubprojectDraft = useMemo(
    () =>
      Boolean(
        editingSubproject ||
          subprojectForm.code.trim() ||
          subprojectForm.name.trim() ||
          subprojectForm.description.trim() ||
          subprojectForm.startDate ||
          subprojectForm.endDate ||
          !subprojectForm.isActive
      ),
    [editingSubproject, subprojectForm]
  );

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      toast.success("Proyecto creado con su bodega operativa");
      utils.projects.list.invalidate();
      utils.warehouses.list.invalidate();
      setCreateDialogOpen(false);
      setCreateForm(EMPTY_PROJECT_FORM);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateProjectMutation = trpc.projects.update.useMutation({
    onSuccess: () => {
      toast.success(
        hasSubprojectDraft
          ? "Proyecto actualizado. El subproyecto sigue pendiente de guardar."
          : "Proyecto actualizado"
      );
      utils.projects.list.invalidate();
      utils.warehouses.list.invalidate();
      setSelectedProject((current) =>
        current
          ? {
              ...current,
              code: projectForm.code,
              name: projectForm.name,
              description: projectForm.description || null,
              location: projectForm.location || null,
              sapProjectCode: projectForm.sapProjectCode || null,
              startDate: projectForm.startDate || null,
              endDate: projectForm.endDate || null,
              status: projectForm.isActive ? "activo" : "inactivo",
            }
          : current
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const refreshProjectWarehouses = async () => {
    await Promise.all([
      utils.projects.list.invalidate(),
      utils.warehouses.list.invalidate(),
    ]);
    if (!selectedProjectId) return;
    const refreshed = await utils.projects.getById.fetch({
      id: selectedProjectId,
    });
    if (refreshed) setSelectedProject(refreshed as ProjectRecord);
  };

  const createWarehouseMutation = trpc.warehouses.create.useMutation({
    onSuccess: async () => {
      toast.success("Almacén creado");
      setWarehouseForm(EMPTY_WAREHOUSE_FORM);
      await refreshProjectWarehouses();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateWarehouseMutation = trpc.warehouses.update.useMutation({
    onSuccess: async () => {
      toast.success("Almacén actualizado");
      await refreshProjectWarehouses();
    },
    onError: (e) => toast.error(e.message),
  });

  const setDefaultWarehouseMutation = trpc.warehouses.setDefault.useMutation({
    onSuccess: async () => {
      toast.success("Almacén principal actualizado");
      await refreshProjectWarehouses();
    },
    onError: (e) => toast.error(e.message),
  });

  const createSubprojectMutation = trpc.projects.createSubproject.useMutation({
    onSuccess: (createdSubproject) => {
      toast.success("Subproyecto creado");
      utils.projects.listSubprojects.setData(
        { projectId: selectedProjectId },
        (current) => [...(current ?? []), createdSubproject]
      );
      setSelectedProject((current) =>
        current
          ? {
              ...current,
              subprojectsCount: (current.subprojectsCount ?? 0) + 1,
            }
          : current
      );
      utils.projects.list.invalidate();
      utils.projects.listSubprojects.invalidate({ projectId: selectedProjectId });
      resetSubprojectForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateSubprojectMutation = trpc.projects.updateSubproject.useMutation({
    onSuccess: (updatedSubproject) => {
      toast.success("Subproyecto actualizado");
      utils.projects.listSubprojects.setData(
        { projectId: selectedProjectId },
        (current) =>
          (current ?? []).map((subproject) =>
            subproject.id === updatedSubproject.id ? updatedSubproject : subproject
          )
      );
      utils.projects.list.invalidate();
      utils.projects.listSubprojects.invalidate({ projectId: selectedProjectId });
      resetSubprojectForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const isSavingSubproject =
    createSubprojectMutation.isPending || updateSubprojectMutation.isPending;

  const openProjectDetail = (project: ProjectRecord) => {
    setSelectedProject(project);
    setProjectForm(projectToForm(project));
    setSubprojectForm(EMPTY_SUBPROJECT_FORM);
    setEditingSubproject(null);
    setDetailDialogOpen(true);
  };

  const resetSubprojectForm = () => {
    setSubprojectForm(EMPTY_SUBPROJECT_FORM);
    setEditingSubproject(null);
  };

  const validateProjectForm = (form: ProjectFormState) => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Código y nombre son obligatorios");
      return false;
    }
    if (hasInvalidDateRange(form.startDate, form.endDate)) {
      toast.error("La fecha de fin no puede ser anterior a la fecha de inicio");
      return false;
    }
    return true;
  };

  const validateSubprojectForm = () => {
    if (!subprojectForm.code.trim() || !subprojectForm.name.trim()) {
      toast.error("Código y nombre del subproyecto son obligatorios");
      return false;
    }
    if (hasInvalidDateRange(subprojectForm.startDate, subprojectForm.endDate)) {
      toast.error("La fecha de fin no puede ser anterior a la fecha de inicio");
      return false;
    }
    return true;
  };

  const submitCreateProject = () => {
    if (!validateProjectForm(createForm)) return;
    createMutation.mutate({
      code: createForm.code.trim(),
      name: createForm.name.trim(),
      description: createForm.description.trim() || null,
      location: createForm.location.trim() || null,
      sapProjectCode: createForm.sapProjectCode.trim() || null,
      startDate: createForm.startDate || null,
      endDate: createForm.endDate || null,
      status: createForm.isActive ? "activo" : "inactivo",
    });
  };

  const submitProjectUpdate = () => {
    if (!selectedProject || !validateProjectForm(projectForm)) return;
    updateProjectMutation.mutate({
      id: selectedProject.id,
      code: projectForm.code.trim(),
      name: projectForm.name.trim(),
      description: projectForm.description.trim() || null,
      location: projectForm.location.trim() || null,
      sapProjectCode: projectForm.sapProjectCode.trim() || null,
      startDate: projectForm.startDate || null,
      endDate: projectForm.endDate || null,
      status: projectForm.isActive ? "activo" : "inactivo",
    });
  };

  const submitSubproject = () => {
    if (!selectedProject || !validateSubprojectForm()) return;

    const payload = {
      projectId: selectedProject.id,
      code: subprojectForm.code.trim(),
      name: subprojectForm.name.trim(),
      description: subprojectForm.description.trim() || null,
      startDate: subprojectForm.startDate || null,
      endDate: subprojectForm.endDate || null,
      isActive: subprojectForm.isActive,
    };

    if (editingSubproject) {
      updateSubprojectMutation.mutate({
        id: editingSubproject.id,
        ...payload,
      });
      return;
    }

    createSubprojectMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Proyectos</h1>
        {isAdmin && (
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Proyecto
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuevo Proyecto</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Código *</Label>
                    <Input
                      value={createForm.code}
                      onChange={(e) =>
                        setCreateForm((form) => ({ ...form, code: e.target.value }))
                      }
                      placeholder="PROY-001"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input
                      value={createForm.name}
                      onChange={(e) =>
                        setCreateForm((form) => ({ ...form, name: e.target.value }))
                      }
                      placeholder="Torre Residencial Norte"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Descripción</Label>
                  <Textarea
                    value={createForm.description}
                    onChange={(e) =>
                      setCreateForm((form) => ({
                        ...form,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Descripción del proyecto..."
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Ubicación</Label>
                    <Input
                      value={createForm.location}
                      onChange={(e) =>
                        setCreateForm((form) => ({
                          ...form,
                          location: e.target.value,
                        }))
                      }
                      placeholder="Ciudad, País"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Código SAP</Label>
                    <Input
                      value={createForm.sapProjectCode}
                      onChange={(e) =>
                        setCreateForm((form) => ({
                          ...form,
                          sapProjectCode: e.target.value,
                        }))
                      }
                      placeholder="SAP-PROY-001"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Fecha inicio</Label>
                    <Input
                      type="date"
                      value={createForm.startDate}
                      onChange={(e) =>
                        setCreateForm((form) => ({
                          ...form,
                          startDate: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fecha fin</Label>
                    <Input
                      type="date"
                      value={createForm.endDate}
                      onChange={(e) =>
                        setCreateForm((form) => ({
                          ...form,
                          endDate: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label className="text-sm">Proyecto activo</Label>
                  <Switch
                    checked={createForm.isActive}
                    onCheckedChange={(checked) =>
                      setCreateForm((form) => ({ ...form, isActive: checked }))
                    }
                  />
                </div>
                <Button
                  onClick={submitCreateProject}
                  disabled={createMutation.isPending}
                  className="w-full"
                >
                  {createMutation.isPending ? "Creando..." : "Crear Proyecto"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {!projectsError && (
        <div className="grid gap-3 md:grid-cols-[minmax(280px,1fr)_220px] md:items-end">
          <div className="relative min-w-0">
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">
              Buscar proyecto
            </Label>
            <Search className="absolute left-3 top-[calc(50%+10px)] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="Buscar por código o nombre..."
              className="h-9 pl-9"
            />
          </div>
          <div className="min-w-0">
            <Label className="mb-1 block text-xs font-medium text-muted-foreground">
              Estado
            </Label>
            <Select
              value={projectStatusFilter}
              onValueChange={setProjectStatusFilter}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="activo">Activos</SelectItem>
                <SelectItem value="inactivo">Inactivos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {projectsError ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FolderKanban className="h-12 w-12 text-destructive/40 mx-auto mb-3" />
            <p className="font-medium text-destructive">
              No se pudieron cargar los proyectos
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {projectsError.message}
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-24 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (projects || []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FolderKanban className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No hay proyectos registrados</p>
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Search className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-medium text-foreground">
              No se encontraron proyectos
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajusta el texto de búsqueda o cambia el estado seleccionado.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project: ProjectRecord) => {
            const isProjectActive = project.status === "activo";
            const dateRange = formatDateRange(project.startDate, project.endDate);

            return (
              <Card
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => openProjectDetail(project)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openProjectDetail(project);
                  }
                }}
                className="hover:border-primary/20 transition-colors cursor-pointer"
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2 gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2 h-8 bg-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-muted-foreground">
                          {project.code}
                        </p>
                        <p className="font-medium text-sm line-clamp-2">
                          {project.name}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 ${
                        isProjectActive
                          ? "border-emerald-300 text-emerald-700"
                          : "border-muted-foreground/30 text-muted-foreground"
                      }`}
                    >
                      {isProjectActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  {project.description && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  {project.location && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {project.location}
                    </p>
                  )}
                  {dateRange && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {dateRange}
                    </p>
                  )}
                  {project.sapProjectCode && (
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      SAP: {project.sapProjectCode}
                    </p>
                  )}
                  {project.warehouse && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      Bodega: {project.warehouse.displayName}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {project.subprojectsCount ?? 0} subproyectos
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {projects && (
        <p className="text-xs text-muted-foreground text-center">
          {filteredProjects.length} de {projects.length} proyectos mostrados ·{" "}
          {activeProjectsCount} activos
        </p>
      )}

      <Dialog
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open);
          if (!open) {
            setSelectedProject(null);
            resetSubprojectForm();
            setWarehouseForm(EMPTY_WAREHOUSE_FORM);
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-6xl xl:max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedProject
                ? `${selectedProject.code} - ${selectedProject.name}`
                : "Proyecto"}
            </DialogTitle>
          </DialogHeader>

          {selectedProject && (
            <div className="space-y-6 pt-2">
              {isAdmin ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Código *</Label>
                      <Input
                        value={projectForm.code}
                        onChange={(e) =>
                          setProjectForm((form) => ({
                            ...form,
                            code: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nombre *</Label>
                      <Input
                        value={projectForm.name}
                        onChange={(e) =>
                          setProjectForm((form) => ({
                            ...form,
                            name: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Descripción</Label>
                    <Textarea
                      value={projectForm.description}
                      onChange={(e) =>
                        setProjectForm((form) => ({
                          ...form,
                          description: e.target.value,
                        }))
                      }
                      rows={2}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Ubicación</Label>
                      <Input
                        value={projectForm.location}
                        onChange={(e) =>
                          setProjectForm((form) => ({
                            ...form,
                            location: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Código SAP</Label>
                      <Input
                        value={projectForm.sapProjectCode}
                        onChange={(e) =>
                          setProjectForm((form) => ({
                            ...form,
                            sapProjectCode: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Fecha inicio</Label>
                      <Input
                        type="date"
                        value={projectForm.startDate}
                        onChange={(e) =>
                          setProjectForm((form) => ({
                            ...form,
                            startDate: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Fecha fin</Label>
                      <Input
                        type="date"
                        value={projectForm.endDate}
                        onChange={(e) =>
                          setProjectForm((form) => ({
                            ...form,
                            endDate: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label className="text-sm">Proyecto activo</Label>
                    <Switch
                      checked={projectForm.isActive}
                      onCheckedChange={(checked) =>
                        setProjectForm((form) => ({
                          ...form,
                          isActive: checked,
                        }))
                      }
                    />
                  </div>
                  <Button
                    onClick={submitProjectUpdate}
                    disabled={updateProjectMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {updateProjectMutation.isPending ? "Guardando..." : "Guardar proyecto"}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <DetailRow label="Código" value={selectedProject.code} />
                  <DetailRow label="Nombre" value={selectedProject.name} />
                  <DetailRow
                    label="Estado"
                    value={selectedProject.status === "activo" ? "Activo" : "Inactivo"}
                  />
                  <DetailRow label="Ubicación" value={selectedProject.location} />
                  <DetailRow
                    label="Fechas"
                    value={formatDateRange(
                      selectedProject.startDate,
                      selectedProject.endDate
                    )}
                  />
                  <DetailRow label="Código SAP" value={selectedProject.sapProjectCode} />
                </div>
              )}

              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Almacenes</h2>
                    <p className="text-xs text-muted-foreground">
                      Inventario operativo separado dentro del proyecto.
                    </p>
                  </div>
                  <Badge variant="outline">
                    {selectedProject.warehouseCount ?? selectedProjectWarehouses.length}
                  </Badge>
                </div>

                <div className="rounded-md border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Código
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Almacén
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Estado
                          </th>
                          {canManageWarehouses && (
                            <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Acciones
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedProjectWarehouses.length === 0 ? (
                          <tr>
                            <td
                              className="p-4 text-sm text-muted-foreground"
                              colSpan={canManageWarehouses ? 4 : 3}
                            >
                              Este proyecto todavía no tiene almacenes.
                            </td>
                          </tr>
                        ) : (
                          selectedProjectWarehouses.map((warehouse) => (
                            <tr key={warehouse.id} className="border-b last:border-0">
                              <td className="p-3 font-mono text-xs">
                                {warehouse.localCode || warehouse.code}
                              </td>
                              <td className="p-3">
                                <div className="font-medium">{warehouse.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {warehouse.displayName}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1">
                                  {warehouse.isDefault && (
                                    <Badge variant="outline">Principal</Badge>
                                  )}
                                  <Badge variant="secondary">
                                    {warehouse.isActive ? "Activo" : "Inactivo"}
                                  </Badge>
                                </div>
                              </td>
                              {canManageWarehouses && (
                                <td className="p-3">
                                  <div className="flex justify-end gap-2">
                                    {!warehouse.isDefault && warehouse.isActive && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          setDefaultWarehouseMutation.mutate({
                                            id: warehouse.id,
                                          })
                                        }
                                      >
                                        Principal
                                      </Button>
                                    )}
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={warehouse.isDefault}
                                      onClick={() =>
                                        updateWarehouseMutation.mutate({
                                          id: warehouse.id,
                                          isActive: !warehouse.isActive,
                                        })
                                      }
                                    >
                                      {warehouse.isActive ? "Desactivar" : "Activar"}
                                    </Button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {canManageWarehouses && (
                  <div className="rounded-md border p-3 space-y-3">
                    <h3 className="text-sm font-semibold">Nuevo almacén</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Código local *</Label>
                        <Input
                          value={warehouseForm.localCode}
                          onChange={(e) =>
                            setWarehouseForm((form) => ({
                              ...form,
                              localCode: e.target.value,
                            }))
                          }
                          placeholder="EJ. MAT, HERR, GENERAL"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Nombre *</Label>
                        <Input
                          value={warehouseForm.name}
                          onChange={(e) =>
                            setWarehouseForm((form) => ({
                              ...form,
                              name: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <Textarea
                      value={warehouseForm.description}
                      onChange={(e) =>
                        setWarehouseForm((form) => ({
                          ...form,
                          description: e.target.value,
                        }))
                      }
                      rows={2}
                      placeholder="Descripción u observaciones del almacén"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={warehouseForm.isDefault}
                          onCheckedChange={(checked) =>
                            setWarehouseForm((form) => ({
                              ...form,
                              isDefault: checked,
                            }))
                          }
                        />
                        Marcar como principal
                      </label>
                      <Button
                        onClick={() => {
                          if (!selectedProject) return;
                          if (!warehouseForm.localCode.trim() || !warehouseForm.name.trim()) {
                            toast.error("Ingrese código y nombre del almacén");
                            return;
                          }
                          createWarehouseMutation.mutate({
                            projectId: selectedProject.id,
                            localCode: warehouseForm.localCode,
                            name: warehouseForm.name,
                            description:
                              warehouseForm.description.trim() || undefined,
                            isDefault: warehouseForm.isDefault,
                          });
                        }}
                        disabled={createWarehouseMutation.isPending}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Crear almacén
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">Subproyectos</h2>
                    <p className="text-xs text-muted-foreground">
                      Estructura informativa del proyecto para uso futuro en requisiciones.
                    </p>
                  </div>
                  <Badge variant="outline">{subprojects?.length ?? 0}</Badge>
                </div>

                {isLoadingSubprojects ? (
                  <div className="h-20 animate-pulse bg-muted rounded-md" />
                ) : (subprojects ?? []).length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      Este proyecto todavía no tiene subproyectos.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(subprojects ?? []).map((subproject: SubprojectRecord) => {
                      const dateRange = formatDateRange(
                        subproject.startDate,
                        subproject.endDate
                      );
                      return (
                        <div
                          key={subproject.id}
                          className="rounded-md border p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-mono text-xs text-muted-foreground">
                                {subproject.code}
                              </p>
                              <p className="font-medium text-sm">{subproject.name}</p>
                              <Badge
                                variant="outline"
                                className={`text-xs ${
                                  subproject.isActive
                                    ? "border-emerald-300 text-emerald-700"
                                    : "border-muted-foreground/30 text-muted-foreground"
                                }`}
                              >
                                {subproject.isActive ? "Activo" : "Inactivo"}
                              </Badge>
                            </div>
                            {subproject.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {subproject.description}
                              </p>
                            )}
                            {dateRange && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {dateRange}
                              </p>
                            )}
                          </div>
                          {isAdmin && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingSubproject(subproject);
                                setSubprojectForm(subprojectToForm(subproject));
                              }}
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Editar
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isAdmin && (
                  <div className="rounded-md border p-3 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="text-sm font-semibold">
                        {editingSubproject ? "Editar subproyecto" : "Nuevo subproyecto"}
                      </h3>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        {editingSubproject && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={resetSubprojectForm}
                            className="w-full sm:w-auto"
                          >
                            <X className="h-4 w-4 mr-2" />
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Código *</Label>
                        <Input
                          value={subprojectForm.code}
                          onChange={(e) =>
                            setSubprojectForm((form) => ({
                              ...form,
                              code: e.target.value,
                            }))
                          }
                          placeholder="SP-001"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Nombre *</Label>
                        <Input
                          value={subprojectForm.name}
                          onChange={(e) =>
                            setSubprojectForm((form) => ({
                              ...form,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Etapa 1"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Descripción</Label>
                      <Textarea
                        value={subprojectForm.description}
                        onChange={(e) =>
                          setSubprojectForm((form) => ({
                            ...form,
                            description: e.target.value,
                          }))
                        }
                        rows={2}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Fecha inicio</Label>
                        <Input
                          type="date"
                          value={subprojectForm.startDate}
                          onChange={(e) =>
                            setSubprojectForm((form) => ({
                              ...form,
                              startDate: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Fecha fin</Label>
                        <Input
                          type="date"
                          value={subprojectForm.endDate}
                          onChange={(e) =>
                            setSubprojectForm((form) => ({
                              ...form,
                              endDate: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <Label className="text-sm">Activo</Label>
                        <Switch
                          checked={subprojectForm.isActive}
                          onCheckedChange={(checked) =>
                            setSubprojectForm((form) => ({
                              ...form,
                              isActive: checked,
                            }))
                          }
                        />
                      </div>
                    </div>
                    <Button
                      onClick={submitSubproject}
                      disabled={isSavingSubproject}
                      className="w-full sm:w-auto"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {editingSubproject ? "Guardar subproyecto" : "Crear subproyecto"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
