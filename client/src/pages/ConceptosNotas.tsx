import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { FinancialGroupCombobox } from "@/components/FinancialGroupCombobox";
import { DataPagination } from "@/components/DataPagination";
import {
  canManageNoteConcepts,
  canReadFinancialNotes,
  type FinancialNoteType,
} from "@shared/financial-notes";

const empty = {
  code: "",
  description: "",
  applicability: "",
  financialGroupCode: null as string | null,
  financialGroupDescription: null as string | null,
  isActive: true,
  allowsTaxOnly: false,
};
export default function ConceptosNotas({ type }: { type: FinancialNoteType }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const canManage = canManageNoteConcepts(user);
  const canRead = canReadFinancialNotes(user);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [removing, setRemoving] = useState<any>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = trpc.noteConcepts.listPage.useQuery(
    {
      type,
      search: debounced,
      isActive: active === "all" ? undefined : active === "active",
      page,
      pageSize,
    },
    { enabled: canRead, placeholderData: previous => previous }
  );
  const [groupSearch, setGroupSearch] = useState("");
  const [groupTerm, setGroupTerm] = useState("");
  const [groupPage, setGroupPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setGroupTerm(groupSearch);
      setGroupPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [groupSearch]);
  const groups = trpc.financialGroups.activeOptionsPage.useQuery(
    { search: groupTerm, page: groupPage, pageSize: 25 },
    { enabled: canManage && open }
  );
  const refresh = () => {
    void utils.noteConcepts.invalidate();
    setOpen(false);
  };
  const fail = (e: { message: string }) => {
    setError(e.message);
    toast.error(e.message);
  };
  const create = trpc.noteConcepts.create.useMutation({
    onSuccess: () => {
      toast.success("Concepto creado");
      refresh();
    },
    onError: fail,
  });
  const update = trpc.noteConcepts.update.useMutation({
    onSuccess: () => {
      toast.success("Concepto actualizado");
      refresh();
    },
    onError: fail,
  });
  const remove = trpc.noteConcepts.remove.useMutation({
    onSuccess: r => {
      toast.success(
        r.deactivated
          ? "Concepto desactivado porque tiene documentos asociados"
          : "Concepto eliminado"
      );
      setRemoving(null);
      void utils.noteConcepts.invalidate();
    },
    onError: fail,
  });
  const busy = create.isPending || update.isPending;
  if (!canRead)
    return (
      <p className="p-6 text-muted-foreground">
        No tiene acceso a este catálogo.
      </p>
    );
  const title = `Conceptos de notas de ${type === "credit" ? "crédito" : "débito"}`;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6" />
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Motivos de ajuste y clasificación financiera.
          </p>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setSelected(null);
              setForm(empty);
              setError("");
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nuevo concepto
          </Button>
        ) : null}
      </header>
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap gap-3 border-b p-4">
          <Input
            aria-label="Buscar conceptos"
            placeholder="Buscar código o descripción…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="min-w-0 flex-1 sm:max-w-md"
          />
          <select
            aria-label="Estado del concepto"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={active}
            onChange={e => {
              setActive(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
          <select
            aria-label="Registros por página"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={pageSize}
            onChange={e => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {[25, 50, 100].map(n => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        </div>
        {query.isLoading ? (
          <p className="p-6" role="status">
            Cargando conceptos…
          </p>
        ) : query.error ? (
          <div className="p-6 text-destructive" role="alert">
            {query.error.message}
            <Button
              variant="outline"
              className="ml-3"
              onClick={() => void query.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : !query.data?.items.length ? (
          <p className="p-6 text-muted-foreground">
            No hay conceptos para estos filtros.
          </p>
        ) : (
          <div className="overflow-x-auto" aria-busy={query.isFetching}>
            <table className="w-full text-sm max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_tr]:py-3 max-sm:[&_td]:block max-sm:[&_td]:min-w-0 max-sm:[&_td]:whitespace-normal max-sm:[&_td]:py-1">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  {[
                    "Código",
                    "Concepto / cuándo aplica",
                    "Grupo financiero",
                    "Estado",
                    "Acciones",
                  ].map(h => (
                    <th key={h} className="px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map(row => (
                  <tr
                    key={row.id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {row.code}
                    </td>
                    <td className="min-w-64 px-4 py-3">
                      <div className="font-medium">{row.description}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.applicability}
                      </p>
                      {row.retentionCatalogId ? (
                        <Badge variant="outline" className="mt-1">
                          Retención vinculada
                        </Badge>
                      ) : null}
                    </td>
                    <td className="max-w-72 px-4 py-3">
                      {row.financialGroupDescription || "Sin grupo financiero"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={row.isActive ? "secondary" : "outline"}>
                        {row.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar ${row.code}`}
                            onClick={() => {
                              setSelected(row);
                              setForm({
                                ...row,
                                financialGroupDescription:
                                  row.financialGroupDescription ?? null,
                              });
                              setError("");
                              setOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {canManage ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Eliminar ${row.code}`}
                              onClick={() => setRemoving(row)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data ? (
          <DataPagination {...query.data} onPageChange={setPage} />
        ) : null}
      </div>
      <Dialog
        open={open}
        onOpenChange={v => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {selected ? "Editar" : "Nuevo"} concepto de{" "}
              {type === "credit" ? "crédito" : "débito"}
            </DialogTitle>
            <DialogDescription>
              El grupo financiero es opcional. Los documentos conservan su
              clasificación histórica.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              setError("");
              const payload = { ...form, type };
              if (selected) update.mutate({ ...payload, id: selected.id });
              else create.mutate(payload);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="concept-code">Código</Label>
              <Input
                id="concept-code"
                required
                maxLength={64}
                value={form.code}
                disabled={!!selected?.retentionCatalogId || busy}
                onChange={e => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="concept-description">Descripción</Label>
              <Input
                id="concept-description"
                required
                maxLength={500}
                value={form.description}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="concept-applicability">Cuándo aplica</Label>
              <Textarea
                id="concept-applicability"
                maxLength={2000}
                value={form.applicability}
                onChange={e =>
                  setForm({ ...form, applicability: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Grupo financiero</Label>
              <FinancialGroupCombobox
                options={groups.data?.items ?? []}
                value={form.financialGroupCode}
                selectedDescription={form.financialGroupDescription}
                onChange={(v, description) =>
                  setForm({
                    ...form,
                    financialGroupCode: v,
                    financialGroupDescription: description ?? null,
                  })
                }
                remote={{
                  search: groupSearch,
                  onSearchChange: setGroupSearch,
                  page: groupPage,
                  totalPages: groups.data?.totalPages ?? 1,
                  onPageChange: setGroupPage,
                  loading: groups.isFetching,
                  error: groups.error?.message,
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="concept-active"
                checked={form.isActive}
                onCheckedChange={v => setForm({ ...form, isActive: v })}
              />
              <Label htmlFor="concept-active">Activo</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="concept-tax-only"
                checked={form.allowsTaxOnly}
                disabled={!!selected?.retentionCatalogId}
                onCheckedChange={v => setForm({ ...form, allowsTaxOnly: v })}
              />
              <Label htmlFor="concept-tax-only">
                Permite corrección de impuesto sin base
              </Label>
            </div>
            {selected?.retentionCatalogId ? (
              <p className="text-xs text-muted-foreground">
                El código y estado se administran desde Retenciones.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button disabled={busy}>
                {busy ? "Guardando…" : "Guardar concepto"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!removing}
        onOpenChange={v => {
          if (!v) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {removing?.code}</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el concepto si todavía no tiene documentos. Si ya fue
              utilizado, quedará inactivo y conservará su historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={e => {
                e.preventDefault();
                if (removing) remove.mutate({ id: removing.id });
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
