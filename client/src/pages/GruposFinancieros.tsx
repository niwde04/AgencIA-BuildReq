import { useAuth } from "@/_core/hooks/useAuth";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Landmark, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type FinancialGroupRecord = {
  financialGroupCode: string;
  financialGroupDescription: string;
  codN2: string;
  nivel2: string;
  isActive: boolean;
};

type FinancialGroupForm = FinancialGroupRecord;

const PAGE_SIZE = 25;
const EMPTY_FORM: FinancialGroupForm = {
  financialGroupCode: "",
  financialGroupDescription: "",
  codN2: "",
  nivel2: "",
  isActive: true,
};

export default function GruposFinancieros() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] =
    useState<FinancialGroupRecord | null>(null);
  const [removingGroup, setRemovingGroup] =
    useState<FinancialGroupRecord | null>(null);
  const [form, setForm] = useState<FinancialGroupForm>(EMPTY_FORM);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const canManage =
    user?.role === "admin" || buildreqRole === "administracion_central";

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250
    );
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => setPage(1), [debouncedSearch, activeFilter]);

  const listInput = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      isActive: activeFilter === "all" ? undefined : activeFilter === "active",
      page,
      pageSize: PAGE_SIZE,
    }),
    [activeFilter, debouncedSearch, page]
  );

  const { data, isLoading, isFetching, error, refetch } =
    trpc.financialGroups.list.useQuery(listInput, {
      enabled: canManage,
      placeholderData: previousData => previousData,
    });

  useEffect(() => {
    if (data?.page && data.page !== page) setPage(data.page);
  }, [data?.page, page]);

  const invalidateCatalog = () => {
    void utils.financialGroups.list.invalidate();
    void utils.financialGroups.activeOptions.invalidate();
    void utils.articles.list.invalidate();
  };

  const createMutation = trpc.financialGroups.create.useMutation({
    onSuccess: () => {
      toast.success("Grupo financiero creado");
      invalidateCatalog();
      setDialogOpen(false);
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  const updateMutation = trpc.financialGroups.update.useMutation({
    onSuccess: () => {
      toast.success("Grupo financiero actualizado");
      invalidateCatalog();
      setDialogOpen(false);
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  const removeMutation = trpc.financialGroups.remove.useMutation({
    onSuccess: () => {
      toast.success("Grupo financiero eliminado");
      invalidateCatalog();
      setRemovingGroup(null);
    },
    onError: mutationError => toast.error(mutationError.message),
  });

  const items = (data?.items ?? []) as FinancialGroupRecord[];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? page;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, total);
  const saving = createMutation.isPending || updateMutation.isPending;

  const openCreateDialog = () => {
    setSelectedGroup(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (group: FinancialGroupRecord) => {
    setSelectedGroup(group);
    setForm(group);
    setDialogOpen(true);
  };

  const submitForm = () => {
    if (!form.financialGroupCode.trim()) {
      toast.error("Ingrese el código del grupo financiero");
      return;
    }
    if (!form.financialGroupDescription.trim()) {
      toast.error("Ingrese la descripción del grupo financiero");
      return;
    }
    if (!form.codN2.trim() || !form.nivel2.trim()) {
      toast.error("CodN2 y Nivel2 son obligatorios");
      return;
    }

    const payload = {
      financialGroupCode: form.financialGroupCode.trim(),
      financialGroupDescription: form.financialGroupDescription.trim(),
      codN2: form.codN2.trim(),
      nivel2: form.nivel2.trim(),
      isActive: form.isActive,
    };
    if (selectedGroup) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-md border border-border p-8 text-center text-muted-foreground">
        No tiene permisos para consultar grupos financieros.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Grupos financieros</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar los grupos financieros"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Crear grupo financiero
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por código, descripción, CodN2 o Nivel2"
            className="pl-9"
          />
        </div>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando grupos financieros...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <Landmark className="mx-auto mb-3 h-12 w-12 text-destructive/50" />
              <p className="mb-3 text-sm text-muted-foreground">
                {error.message}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No se encontraron grupos financieros.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {[
                        "Código Grupo Financiero",
                        "Descripción",
                        "CodN2",
                        "Nivel2",
                        "Estado",
                        "Acciones",
                      ].map(header => (
                        <th
                          key={header}
                          className={`p-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${header === "Acciones" ? "text-right" : "text-left"}`}
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(group => (
                      <tr
                        key={group.financialGroupCode}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          {group.financialGroupCode}
                        </td>
                        <td className="max-w-[460px] p-3 font-medium">
                          {group.financialGroupDescription}
                        </td>
                        <td className="p-3 font-mono text-xs">{group.codN2}</td>
                        <td className="p-3">{group.nivel2}</td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              group.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "text-muted-foreground"
                            }
                          >
                            {group.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              title="Editar"
                              onClick={() => openEditDialog(group)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              title="Quitar"
                              onClick={() => setRemovingGroup(group)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-4 border-t px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {rangeStart.toLocaleString("es-HN")} a{" "}
                  {rangeEnd.toLocaleString("es-HN")} de{" "}
                  {total.toLocaleString("es-HN")} registros
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(value => Math.max(value - 1, 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setPage(value => Math.min(value + 1, totalPages))
                    }
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedGroup
                ? "Editar grupo financiero"
                : "Crear grupo financiero"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Código Grupo Financiero *</Label>
                <Input
                  value={form.financialGroupCode}
                  disabled={Boolean(selectedGroup)}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      financialGroupCode: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CodN2 *</Label>
                <Input
                  value={form.codN2}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      codN2: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Descripción *</Label>
                <Input
                  value={form.financialGroupDescription}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      financialGroupDescription: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nivel2 *</Label>
                <Input
                  value={form.nivel2}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      nivel2: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label className="text-sm">Activo</Label>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={isActive =>
                    setForm(current => ({ ...current, isActive }))
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="button" disabled={saving} onClick={submitForm}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(removingGroup)}
        onOpenChange={open => !open && setRemovingGroup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar grupo financiero</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará {removingGroup?.financialGroupDescription}. Los
              artículos vinculados quedarán sin grupo financiero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMutation.isPending}
              onClick={() =>
                removingGroup &&
                removeMutation.mutate({
                  financialGroupCode: removingGroup.financialGroupCode,
                })
              }
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
