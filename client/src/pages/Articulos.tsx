import { trpc } from "@/lib/trpc";
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
import { PackageSearch, Pencil, Save, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ArticleType = 1 | 2 | 3;

type ArticleRecord = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup?: string | null;
  tipoArticulo: number;
  allowsTaxWithholding: boolean;
  isActive: boolean;
};

const PAGE_SIZE = 25;

const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  1: "Artículo",
  2: "Servicio",
  3: "Activo fijo",
};

function parseArticleType(value: string): ArticleType | undefined {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 || numeric === 3 ? numeric : undefined;
}

function getArticleTypeLabel(value: number | null | undefined) {
  if (value === 1 || value === 2 || value === 3) {
    return ARTICLE_TYPE_LABELS[value];
  }
  return "Sin tipo";
}

export default function Articulos() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("active");
  const [withholdingFilter, setWithholdingFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | null>(
    null
  );
  const [editType, setEditType] = useState<ArticleType>(1);
  const [editActive, setEditActive] = useState(true);
  const [editAllowsTaxWithholding, setEditAllowsTaxWithholding] =
    useState(true);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const canManage =
    user?.role === "admin" || buildreqRole === "jefe_bodega_central";

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, typeFilter, activeFilter, withholdingFilter]);

  const listInput = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      tipoArticulo: parseArticleType(typeFilter),
      isActive:
        activeFilter === "all" ? undefined : activeFilter === "active",
      allowsTaxWithholding:
        withholdingFilter === "all"
          ? undefined
          : withholdingFilter === "withholding",
      page,
      pageSize: PAGE_SIZE,
    }),
    [activeFilter, debouncedSearch, page, typeFilter, withholdingFilter]
  );

  const { data, isLoading, isFetching, error, refetch } =
    trpc.articles.list.useQuery(listInput, {
      placeholderData: (previousData) => previousData,
    });

  useEffect(() => {
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, page]);

  const updateMutation = trpc.articles.update.useMutation({
    onSuccess: () => {
      toast.success("Artículo actualizado");
      utils.articles.list.invalidate();
      setSelectedArticle(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);

  const openEditDialog = (article: ArticleRecord) => {
    setSelectedArticle(article);
    setEditType(parseArticleType(String(article.tipoArticulo)) ?? 1);
    setEditActive(article.isActive);
    setEditAllowsTaxWithholding(article.allowsTaxWithholding);
  };

  const submitUpdate = () => {
    if (!selectedArticle) return;
    updateMutation.mutate({
      id: selectedArticle.id,
      tipoArticulo: editType,
      isActive: editActive,
      allowsTaxWithholding: editAllowsTaxWithholding,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Artículos</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar los artículos"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_220px_180px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, descripción o grupo"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Tipo de artículo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="1">Artículo</SelectItem>
            <SelectItem value="2">Servicio</SelectItem>
            <SelectItem value="3">Activo fijo</SelectItem>
          </SelectContent>
        </Select>

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

        <Select value={withholdingFilter} onValueChange={setWithholdingFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Retención" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="withholding">Permiten retención</SelectItem>
            <SelectItem value="no-withholding">No permiten retención</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando artículos...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <PackageSearch className="mx-auto mb-3 h-12 w-12 text-destructive/50" />
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
              <PackageSearch className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No se encontraron artículos
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
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Grupo
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Tipo
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
                    {items.map((article: ArticleRecord) => (
                      <tr
                        key={article.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          {article.itemCode}
                        </td>
                        <td className="max-w-[520px] p-3 font-medium">
                          {article.description}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {article.itemGroup || "-"}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">
                            {getArticleTypeLabel(article.tipoArticulo)}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              article.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {article.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              article.allowsTaxWithholding
                                ? "border-emerald-300 text-emerald-700"
                                : "border-amber-300 text-amber-700"
                            }
                          >
                            {article.allowsTaxWithholding
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
                              onClick={() => openEditDialog(article)}
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
        open={Boolean(selectedArticle)}
        onOpenChange={(open) => {
          if (!open) setSelectedArticle(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar artículo</DialogTitle>
          </DialogHeader>

          {selectedArticle ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Código</Label>
                  <Input value={selectedArticle.itemCode} readOnly />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Grupo</Label>
                  <Input value={selectedArticle.itemGroup || ""} readOnly />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Descripción</Label>
                <Input value={selectedArticle.description} readOnly />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={String(editType)}
                    onValueChange={(value) =>
                      setEditType(parseArticleType(value) ?? 1)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Artículo</SelectItem>
                      <SelectItem value="2">Servicio</SelectItem>
                      <SelectItem value="3">Activo fijo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label className="text-sm">Activo</Label>
                  <Switch checked={editActive} onCheckedChange={setEditActive} />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <Label className="text-sm">Permite retención</Label>
                <Switch
                  checked={editAllowsTaxWithholding}
                  onCheckedChange={setEditAllowsTaxWithholding}
                />
              </div>

              <Button
                onClick={submitUpdate}
                disabled={updateMutation.isPending}
                className="w-full sm:w-auto"
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
