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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Link2, Package, Plus, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export default function Almacenes() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const hasAttemptedSeed = useRef(false);

  const userRole = (user as any)?.buildreqRole || "";
  const canManage =
    user?.role === "admin" ||
    userRole === "jefe_bodega_central" ||
    userRole === "administracion_central";

  const { data: warehouses, isLoading } = trpc.warehouses.list.useQuery(undefined, {
    enabled: canManage,
  });
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: canManage,
  });
  const missingProjectWarehouses = useMemo(
    () => (projects ?? []).filter((project: any) => !project.warehouse),
    [projects]
  );
  const selectedProject = useMemo(
    () =>
      (projects ?? []).find(
        (project: any) => String(project.id) === selectedProjectId
      ) ?? null,
    [projects, selectedProjectId]
  );

  const createMutation = trpc.warehouses.create.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.linkedRows > 0
          ? `Bodega de proyecto creada y ${result.linkedRows.toLocaleString("es-HN")} filas de inventario sincronizadas`
          : "Bodega de proyecto creada"
      );
      setDialogOpen(false);
      resetForm();
      void Promise.all([
        utils.warehouses.list.invalidate(),
        utils.inventory.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const seedDefaultsMutation = trpc.warehouses.seedDefaults.useMutation({
    onSuccess: (result) => {
      toast.success(
        `Almacenes de proyecto sincronizados: ${result.warehouses.length} bodegas y ${result.linkedRows.toLocaleString("es-HN")} filas enlazadas`
      );
      void Promise.all([
        utils.warehouses.list.invalidate(),
        utils.inventory.list.invalidate(),
        utils.projects.list.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!canManage || isLoading || hasAttemptedSeed.current) return;
    if (missingProjectWarehouses.length === 0) return;

    hasAttemptedSeed.current = true;
    seedDefaultsMutation.mutate();
  }, [canManage, isLoading, missingProjectWarehouses, seedDefaultsMutation]);

  const totalInventoryRows = useMemo(
    () =>
      (warehouses ?? []).reduce(
        (total, warehouse) => total + warehouse.inventoryRows,
        0
      ),
    [warehouses]
  );

  const totalUniqueItems = useMemo(
    () =>
      (warehouses ?? []).reduce(
        (total, warehouse) => total + warehouse.uniqueItems,
        0
      ),
    [warehouses]
  );

  const resetForm = () => {
    setSelectedProjectId("");
  };

  if (!canManage) {
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
            Cada proyecto debe tener su propia bodega operativa. Desde aquí
            sincronizas y monitoreas esos almacenes.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => seedDefaultsMutation.mutate()}
            disabled={seedDefaultsMutation.isPending}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            {seedDefaultsMutation.isPending
              ? "Sincronizando..."
              : "Sincronizar almacenes por proyecto"}
          </Button>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Generar almacén
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Generar almacén de proyecto</DialogTitle>
              </DialogHeader>

              <div className="space-y-5 pt-2">
                <div className="space-y-2">
                  <Label className="text-sm">Proyecto *</Label>
                  <Select
                    value={selectedProjectId || undefined}
                    onValueChange={setSelectedProjectId}
                  >
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Seleccione un proyecto" />
                    </SelectTrigger>
                    <SelectContent>
                      {missingProjectWarehouses.map((project: any) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {project.code} - {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedProject ? (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <p className="text-sm font-semibold text-foreground">
                      Bodega que se generará
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {selectedProject.code.toUpperCase()} -{" "}
                      {selectedProject.name.toUpperCase()} - BODEGA
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Esta bodega quedará enlazada automáticamente al proyecto y
                      absorberá cualquier inventario que se asigne a él.
                    </p>
                  </div>
                ) : null}

                {missingProjectWarehouses.length === 0 ? (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                    Todos los proyectos ya tienen una bodega asignada.
                  </div>
                ) : null}

                <Button
                  className="w-full"
                  disabled={
                    createMutation.isPending ||
                    missingProjectWarehouses.length === 0 ||
                    !selectedProjectId
                  }
                  onClick={() => {
                    if (!selectedProjectId) {
                      toast.error("Seleccione un proyecto");
                      return;
                    }

                    createMutation.mutate({
                      projectId: Number(selectedProjectId),
                    });
                  }}
                >
                  {createMutation.isPending ? "Generando..." : "Generar almacén"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Almacenes activos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : (warehouses?.length ?? 0).toLocaleString("es-HN")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" />
              Filas vinculadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : totalInventoryRows.toLocaleString("es-HN")}
            </p>
            <p className="text-xs text-muted-foreground">
              filas de inventario relacionadas
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
              {isLoading ? "..." : totalUniqueItems.toLocaleString("es-HN")}
            </p>
            <p className="text-xs text-muted-foreground">
              códigos SAP distribuidos entre almacenes
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Relación con inventario</CardTitle>
            <CardDescription>
            Los almacenes de proyecto se crean y mantienen a partir del proyecto.
            Cuando inventario se asigna a un proyecto, se mueve a su bodega.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Cargando almacenes...
            </div>
          ) : !warehouses?.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Aún no hay almacenes registrados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Código
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Nombre
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Etiqueta inventario
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Filas
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Artículos
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((warehouse) => (
                    <tr
                      key={warehouse.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3 font-mono text-xs">{warehouse.code}</td>
                      <td className="p-3 font-medium">
                        <div>{warehouse.name}</div>
                        {warehouse.description ? (
                          <div className="text-xs text-muted-foreground">
                            {warehouse.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3 text-xs">
                        {warehouse.project
                          ? `${warehouse.project.code} - ${warehouse.project.name}`
                          : "Sin proyecto"}
                      </td>
                      <td className="p-3 text-xs">{warehouse.displayName}</td>
                      <td className="p-3 text-right">
                        {warehouse.inventoryRows.toLocaleString("es-HN")}
                      </td>
                      <td className="p-3 text-right">
                        {warehouse.uniqueItems.toLocaleString("es-HN")}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline">
                          {warehouse.project ? "Proyecto" : "Central"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary">
                          {warehouse.isActive ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
