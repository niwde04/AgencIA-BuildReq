import { useAuth } from "@/_core/hooks/useAuth";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Pencil, Percent, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type TaxRetentionRecord = {
  id: number;
  taxCode: string;
  description: string;
  ratePercent: string | number;
  isActive: boolean;
  note?: string | null;
  erpCode?: string | null;
};

type RetentionForm = {
  taxCode: string;
  description: string;
  ratePercent: string;
  isActive: boolean;
  note: string;
  erpCode: string;
};

const PAGE_SIZE = 25;

const emptyForm: RetentionForm = {
  taxCode: "",
  description: "",
  ratePercent: "",
  isActive: true,
  note: "",
  erpCode: "",
};

function formatRate(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString("es-HN", {
    maximumFractionDigits: 4,
  });
}

function getFriendlyError(message: string) {
  if (message.includes("duplicate") || message.includes("unique")) {
    return "Ya existe una retención con ese código";
  }
  return message;
}

export default function Retenciones() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRetention, setSelectedRetention] =
    useState<TaxRetentionRecord | null>(null);
  const [form, setForm] = useState<RetentionForm>(emptyForm);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const canManageRetentions =
    user?.role === "admin" || buildreqRole === "contable";
  const canReadRetentions =
    canManageRetentions ||
    buildreqRole === "administracion_central" ||
    buildreqRole === "administrador_proyecto";

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter]);

  const listInput = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      isActive:
        activeFilter === "all" ? undefined : activeFilter === "active",
      page,
      pageSize: PAGE_SIZE,
    }),
    [activeFilter, debouncedSearch, page]
  );

  const { data, isLoading, isFetching, error, refetch } =
    trpc.retentions.list.useQuery(listInput, {
      enabled: canReadRetentions,
      placeholderData: (previousData) => previousData,
    });

  useEffect(() => {
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, page]);

  const createMutation = trpc.retentions.create.useMutation({
    onSuccess: () => {
      toast.success("Retención creada");
      void utils.retentions.list.invalidate();
      void utils.retentions.activeOptions.invalidate();
      setDialogOpen(false);
    },
    onError: (e) => toast.error(getFriendlyError(e.message)),
  });

  const updateMutation = trpc.retentions.update.useMutation({
    onSuccess: () => {
      toast.success("Retención actualizada");
      void utils.retentions.list.invalidate();
      void utils.retentions.activeOptions.invalidate();
      setDialogOpen(false);
    },
    onError: (e) => toast.error(getFriendlyError(e.message)),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);
  const saving = createMutation.isPending || updateMutation.isPending;

  const openCreateDialog = () => {
    setSelectedRetention(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (retention: TaxRetentionRecord) => {
    setSelectedRetention(retention);
    setForm({
      taxCode: retention.taxCode,
      description: retention.description,
      ratePercent: String(retention.ratePercent ?? ""),
      isActive: retention.isActive,
      note: retention.note ?? "",
      erpCode: retention.erpCode ?? "",
    });
    setDialogOpen(true);
  };

  const submitForm = () => {
    if (!canManageRetentions) {
      toast.error("No tiene permisos para modificar retenciones");
      return;
    }

    const payload = {
      taxCode: form.taxCode.trim().toUpperCase(),
      description: form.description.trim(),
      ratePercent: form.ratePercent.trim(),
      isActive: form.isActive,
      note: form.note.trim() || null,
      erpCode: form.erpCode.trim().toUpperCase() || null,
    };

    if (!payload.taxCode) {
      toast.error("Ingrese el código de retención");
      return;
    }
    if (!payload.description) {
      toast.error("Ingrese la descripción");
      return;
    }
    if (!Number.isFinite(Number(payload.ratePercent)) || Number(payload.ratePercent) <= 0) {
      toast.error("Ingrese una tasa mayor que cero");
      return;
    }

    if (selectedRetention) {
      updateMutation.mutate({ id: selectedRetention.id, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  if (!canReadRetentions) {
    return (
      <div className="rounded-xl border border-border p-8 text-center text-muted-foreground">
        No tiene permisos para consultar retenciones.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Retenciones</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar las retenciones"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        {canManageRetentions ? (
          <Button type="button" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Crear retención
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, descripción, nota o ERP"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Activas</SelectItem>
            <SelectItem value="inactive">Inactivas</SelectItem>
            <SelectItem value="all">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando retenciones...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <Percent className="mx-auto mb-3 h-12 w-12 text-destructive/50" />
              <p className="mb-1 font-medium text-foreground">
                No se pudo cargar el catálogo
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                {error.message || "Ocurrió un error consultando la base de datos."}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Percent className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No se encontraron retenciones
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Descripción
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Tasa %
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Nota
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código ERP
                      </th>
                      {canManageRetentions ? (
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((retention: TaxRetentionRecord) => (
                      <tr
                        key={retention.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          {retention.taxCode}
                        </td>
                        <td className="max-w-[360px] p-3 font-medium">
                          {retention.description}
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {formatRate(retention.ratePercent)}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              retention.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {retention.isActive ? "Activa" : "Inactiva"}
                          </Badge>
                        </td>
                        <td className="max-w-[360px] p-3 text-xs text-muted-foreground">
                          {retention.note || "-"}
                        </td>
                        <td className="p-3 font-mono text-xs">
                          {retention.erpCode || "-"}
                        </td>
                        {canManageRetentions ? (
                          <td className="p-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(retention)}
                            >
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Editar
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {rangeStart.toLocaleString("es-HN")} a{" "}
                  {rangeEnd.toLocaleString("es-HN")} de{" "}
                  {total.toLocaleString("es-HN")} registros
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={(data?.page ?? page) <= 1}
                    onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    disabled={(data?.page ?? page) >= totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(current + 1, totalPages))
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

      {canManageRetentions ? (
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedRetention ? "Editar retención" : "Crear retención"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Código</Label>
                <Input
                  value={form.taxCode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      taxCode: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="RT125"
                  autoCapitalize="characters"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tasa %</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={form.ratePercent}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      ratePercent: event.target.value,
                    }))
                  }
                  placeholder="12.5"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Código ERP</Label>
                <Input
                  value={form.erpCode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      erpCode: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="R12"
                  autoCapitalize="characters"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Descripción</Label>
              <Input
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Retención 12.5%"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Nota</Label>
              <Textarea
                value={form.note}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                rows={3}
                placeholder="Base a ley x y o z"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <Label className="text-sm">Activa</Label>
              <Switch
                checked={form.isActive}
                onCheckedChange={(isActive) =>
                  setForm((current) => ({ ...current, isActive }))
                }
              />
            </div>

            <Button
              type="button"
              onClick={submitForm}
              disabled={saving}
              className="w-full sm:w-auto"
            >
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      ) : null}
    </div>
  );
}
