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
import { trpc } from "@/lib/trpc";
import { Building2, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type SupplierRecord = {
  id: number;
  supplierCode: string;
  name: string;
  email?: string | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
};

const PAGE_SIZE = 25;

export default function Proveedores() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierRecord | null>(null);
  const [editAllowsTaxWithholding, setEditAllowsTaxWithholding] =
    useState(true);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const canManage =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "administracion_central";

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
    trpc.suppliers.list.useQuery(listInput, {
      placeholderData: (previousData) => previousData,
    });

  useEffect(() => {
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, page]);

  const updateMutation = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      toast.success("Proveedor actualizado");
      utils.suppliers.list.invalidate();
      setSelectedSupplier(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);

  const openEditDialog = (supplier: SupplierRecord) => {
    setSelectedSupplier(supplier);
    setEditAllowsTaxWithholding(supplier.allowsTaxWithholding);
  };

  const submitUpdate = () => {
    if (!selectedSupplier) return;
    updateMutation.mutate({
      id: selectedSupplier.id,
      allowsTaxWithholding: editAllowsTaxWithholding,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Proveedores</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar los proveedores"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nombre o correo"
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
              Cargando proveedores...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <Building2 className="mx-auto mb-3 h-12 w-12 text-destructive/50" />
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
              <Building2 className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No se encontraron proveedores
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
                        Proveedor
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Correo
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Retención
                      </th>
                      {canManage ? (
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((supplier: SupplierRecord) => (
                      <tr
                        key={supplier.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          {supplier.supplierCode}
                        </td>
                        <td className="max-w-[520px] p-3 font-medium">
                          {supplier.name}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {supplier.email || "-"}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              supplier.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {supplier.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              supplier.allowsTaxWithholding
                                ? "border-emerald-300 text-emerald-700"
                                : "border-amber-300 text-amber-700"
                            }
                          >
                            {supplier.allowsTaxWithholding
                              ? "Permite"
                              : "No permite"}
                          </Badge>
                        </td>
                        {canManage ? (
                          <td className="p-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(supplier)}
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

      <Dialog
        open={Boolean(selectedSupplier)}
        onOpenChange={(open) => {
          if (!open) setSelectedSupplier(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar proveedor</DialogTitle>
          </DialogHeader>

          {selectedSupplier ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Código</Label>
                  <Input value={selectedSupplier.supplierCode} readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estado</Label>
                  <Input
                    value={selectedSupplier.isActive ? "Activo" : "Inactivo"}
                    readOnly
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Proveedor</Label>
                <Input value={selectedSupplier.name} readOnly />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Correo</Label>
                <Input value={selectedSupplier.email || ""} readOnly />
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <Label className="text-sm">Permite retención</Label>
                <Switch
                  checked={editAllowsTaxWithholding}
                  onCheckedChange={setEditAllowsTaxWithholding}
                />
              </div>

              <Button
                type="button"
                onClick={submitUpdate}
                disabled={updateMutation.isPending}
                className="w-full"
              >
                Guardar cambios
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
