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
import { Pencil, Percent, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type SalesTaxRecord = {
  id: number;
  taxCode: string;
  description: string;
  shortLabel: string;
  ratePercent: string | number;
  taxType: "base" | "additional";
  fiscalCategory: "exento" | "exonerado" | "gravado";
  isActive: boolean;
  displayOrder: number;
  appliesToTaxCodes?: string[] | null;
  note?: string | null;
  erpCode?: string | null;
};

type SalesTaxForm = {
  taxCode: string;
  description: string;
  shortLabel: string;
  ratePercent: string;
  taxType: "base" | "additional";
  fiscalCategory: "exento" | "exonerado" | "gravado";
  isActive: boolean;
  displayOrder: string;
  appliesToTaxCodes: string;
  note: string;
  erpCode: string;
};

const PAGE_SIZE = 25;

const emptyForm: SalesTaxForm = {
  taxCode: "",
  description: "",
  shortLabel: "",
  ratePercent: "",
  taxType: "base",
  fiscalCategory: "gravado",
  isActive: true,
  displayOrder: "100",
  appliesToTaxCodes: "",
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
    return "Ya existe un impuesto con ese código";
  }
  return message;
}

function parseAppliesTo(value: string) {
  return value
    .split(",")
    .map(code => code.trim())
    .filter(Boolean);
}

export default function Impuestos() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTax, setSelectedTax] = useState<SalesTaxRecord | null>(null);
  const [form, setForm] = useState<SalesTaxForm>(emptyForm);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const canManageTaxes =
    user?.role === "admin" ||
    buildreqRole === "administracion_central" ||
    buildreqRole === "contable";
  const canReadTaxes =
    canManageTaxes ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "administrador_proyecto" ||
    buildreqRole === "bodeguero_proyecto";

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
    trpc.taxes.list.useQuery(listInput, {
      enabled: canReadTaxes,
      placeholderData: previousData => previousData,
    });

  useEffect(() => {
    if (data?.page && data.page !== page) setPage(data.page);
  }, [data?.page, page]);

  const createMutation = trpc.taxes.create.useMutation({
    onSuccess: () => {
      toast.success("Impuesto creado");
      void utils.taxes.list.invalidate();
      void utils.taxes.activeOptions.invalidate();
      setDialogOpen(false);
    },
    onError: error => toast.error(getFriendlyError(error.message)),
  });

  const updateMutation = trpc.taxes.update.useMutation({
    onSuccess: () => {
      toast.success("Impuesto actualizado");
      void utils.taxes.list.invalidate();
      void utils.taxes.activeOptions.invalidate();
      setDialogOpen(false);
    },
    onError: error => toast.error(getFriendlyError(error.message)),
  });

  const removeMutation = trpc.taxes.remove.useMutation({
    onSuccess: result => {
      toast.success(
        result.action === "deleted"
          ? "Impuesto eliminado"
          : "Impuesto desactivado"
      );
      void utils.taxes.list.invalidate();
      void utils.taxes.activeOptions.invalidate();
    },
    onError: error => toast.error(getFriendlyError(error.message)),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd =
    total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);
  const saving = createMutation.isPending || updateMutation.isPending;

  const openCreateDialog = () => {
    setSelectedTax(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (tax: SalesTaxRecord) => {
    setSelectedTax(tax);
    setForm({
      taxCode: tax.taxCode,
      description: tax.description,
      shortLabel: tax.shortLabel,
      ratePercent: String(tax.ratePercent ?? ""),
      taxType: tax.taxType,
      fiscalCategory: tax.fiscalCategory,
      isActive: tax.isActive,
      displayOrder: String(tax.displayOrder ?? 100),
      appliesToTaxCodes: (tax.appliesToTaxCodes ?? []).join(", "),
      note: tax.note ?? "",
      erpCode: tax.erpCode ?? "",
    });
    setDialogOpen(true);
  };

  const submitForm = () => {
    if (!canManageTaxes) {
      toast.error("No tiene permisos para modificar impuestos");
      return;
    }

    const rate = Number(form.ratePercent);
    const displayOrder = Number(form.displayOrder);
    if (!form.taxCode.trim()) {
      toast.error("Ingrese el código del impuesto");
      return;
    }
    if (!form.description.trim()) {
      toast.error("Ingrese la descripción");
      return;
    }
    if (!form.shortLabel.trim()) {
      toast.error("Ingrese la etiqueta corta");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error("Ingrese una tasa entre 0 y 100");
      return;
    }
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      toast.error("Ingrese un orden válido");
      return;
    }

    const payload = {
      taxCode: form.taxCode.trim(),
      description: form.description.trim(),
      shortLabel: form.shortLabel.trim(),
      ratePercent: form.ratePercent.trim(),
      taxType: form.taxType,
      fiscalCategory: form.fiscalCategory,
      isActive: form.isActive,
      displayOrder,
      appliesToTaxCodes:
        form.taxType === "additional"
          ? parseAppliesTo(form.appliesToTaxCodes)
          : [],
      note: form.note.trim() || null,
      erpCode: form.erpCode.trim().toUpperCase() || null,
    };

    if (selectedTax) {
      updateMutation.mutate({ id: selectedTax.id, ...payload });
      return;
    }

    createMutation.mutate(payload);
  };

  if (!canReadTaxes) {
    return (
      <div className="rounded-xl border border-border p-8 text-center text-muted-foreground">
        No tiene permisos para consultar impuestos.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Impuestos</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar los impuestos"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        {canManageTaxes ? (
          <Button type="button" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Crear impuesto
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, descripción, etiqueta o ERP"
            value={search}
            onChange={event => setSearch(event.target.value)}
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
              Cargando impuestos...
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
                No se encontraron impuestos
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
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
                        Tipo
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Categoría
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </th>
                      {canManageTaxes ? (
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((tax: SalesTaxRecord) => (
                      <tr
                        key={tax.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          {tax.taxCode}
                        </td>
                        <td className="max-w-[360px] p-3">
                          <div className="font-medium">{tax.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {tax.shortLabel}
                            {tax.taxType === "additional" &&
                            tax.appliesToTaxCodes?.length
                              ? ` sobre ${tax.appliesToTaxCodes.join(", ")}`
                              : ""}
                          </div>
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {formatRate(tax.ratePercent)}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">
                            {tax.taxType === "base" ? "Base" : "Adicional"}
                          </Badge>
                        </td>
                        <td className="p-3 capitalize">
                          {tax.fiscalCategory}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              tax.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {tax.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        {canManageTaxes ? (
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openEditDialog(tax)}
                              >
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Editar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={removeMutation.isPending}
                                onClick={() =>
                                  removeMutation.mutate({ id: tax.id })
                                }
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Quitar
                              </Button>
                            </div>
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
                    onClick={() => setPage(current => Math.max(current - 1, 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    disabled={(data?.page ?? page) >= totalPages}
                    onClick={() =>
                      setPage(current => Math.min(current + 1, totalPages))
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

      {canManageTaxes ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedTax ? "Editar impuesto" : "Crear impuesto"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Código</Label>
                  <Input
                    value={form.taxCode}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        taxCode: event.target.value,
                      }))
                    }
                    placeholder="isv_4"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Etiqueta corta</Label>
                  <Input
                    value={form.shortLabel}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        shortLabel: event.target.value,
                      }))
                    }
                    placeholder="ISV 4%"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tasa %</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.0001"
                    value={form.ratePercent}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        ratePercent: event.target.value,
                      }))
                    }
                    placeholder="4"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descripción</Label>
                <Input
                  value={form.description}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="ISV 4%"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={form.taxType}
                    onValueChange={(taxType: "base" | "additional") =>
                      setForm(current => ({
                        ...current,
                        taxType,
                        appliesToTaxCodes:
                          taxType === "base" ? "" : current.appliesToTaxCodes,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="base">Base</SelectItem>
                      <SelectItem value="additional">Adicional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Categoría fiscal</Label>
                  <Select
                    value={form.fiscalCategory}
                    onValueChange={(
                      fiscalCategory: "exento" | "exonerado" | "gravado"
                    ) =>
                      setForm(current => ({
                        ...current,
                        fiscalCategory,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exento">Exento</SelectItem>
                      <SelectItem value="exonerado">Exonerado</SelectItem>
                      <SelectItem value="gravado">Gravado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Orden</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={form.displayOrder}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        displayOrder: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {form.taxType === "additional" ? (
                <div className="space-y-1">
                  <Label className="text-xs">Aplica sobre códigos base</Label>
                  <Input
                    value={form.appliesToTaxCodes}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        appliesToTaxCodes: event.target.value,
                      }))
                    }
                    placeholder="isv_15"
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Código ERP</Label>
                  <Input
                    value={form.erpCode}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        erpCode: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="ISV4"
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

              <div className="space-y-1">
                <Label className="text-xs">Nota</Label>
                <Textarea
                  value={form.note}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Base legal o condición de aplicación"
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
