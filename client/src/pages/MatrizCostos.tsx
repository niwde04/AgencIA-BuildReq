import "./matriz-costos.css";
import { useEffect, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  canManageCostMatrix,
  costMatrixFields,
  deriveCostMatrix,
  type CostMatrixFields,
} from "@shared/cost-matrix";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileSpreadsheet,
  Plus,
  Pencil,
  Eye,
  Power,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";

type Entry =
  inferRouterOutputs<AppRouter>["costMatrix"]["list"]["items"][number];
type Field = keyof CostMatrixFields;
const empty = Object.fromEntries(
  Object.keys(costMatrixFields.shape).map(k => [k, ""])
) as CostMatrixFields;
const fields: [Field, string][] = [
  ["jobCode", "Código del job"],
  ["jobName", "Nombre del job"],
  ["n1", "Código nivel 1"],
  ["nivel1", "Descripción nivel 1"],
  ["n2", "Código nivel 2"],
  ["nivel2", "Descripción nivel 2"],
  ["n3", "Código nivel 3"],
  ["nivel3", "Descripción nivel 3"],
  ["n4", "Código nivel 4"],
  ["nivel4", "Descripción nivel 4"],
  ["majorGroup", "Grupo mayor"],
  ["flowId", "Identificador de flujo"],
  ["flowActivity", "Actividad de flujo"],
];
function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="w-full min-w-0 [&>span]:truncate"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="cost-matrix-surface max-w-[calc(100vw-2rem)]">
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
const status = (active: boolean) => (
  <Badge variant={active ? "secondary" : "outline"}>
    {active ? "Activo" : "Inactivo"}
  </Badge>
);

export default function MatrizCostos() {
  const { user, loading } = useAuth();
  const allowed = canManageCostMatrix(user);
  const utils = trpc.useUtils();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [job, setJob] = useState("all"),
    [level, setLevel] = useState("all"),
    [activity, setActivity] = useState("all"),
    [active, setActive] = useState("active");
  const [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [editing, setEditing] = useState<Entry | null>(null),
    [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CostMatrixFields>(empty),
    [formError, setFormError] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null),
    [changing, setChanging] = useState<Entry | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const list = trpc.costMatrix.list.useQuery(
    {
      search: query || undefined,
      jobCode: job === "all" ? undefined : job,
      n1: level === "all" ? undefined : level,
      flowActivity: activity === "all" ? undefined : activity,
      isActive: active === "all" ? undefined : active === "active",
      page,
      pageSize,
    },
    { enabled: allowed, placeholderData: old => old }
  );
  const options = trpc.costMatrix.filterOptions.useQuery(undefined, {
    enabled: allowed,
    staleTime: 60_000,
  });
  const detail = trpc.costMatrix.getById.useQuery(
    { id: detailId ?? 0 },
    { enabled: allowed && detailId !== null }
  );
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && page !== list.data.page)
      setPage(list.data.page);
  }, [list.data, list.isPlaceholderData, page]);
  const refresh = async () => {
    await Promise.all([
      utils.costMatrix.list.invalidate(),
      utils.costMatrix.filterOptions.invalidate(),
      utils.costMatrix.getById.invalidate(),
    ]);
  };
  const onSaved = async () => {
    setFormOpen(false);
    toast.success("Registro guardado");
    await refresh();
  };
  const onError = (error: { message: string }) => setFormError(error.message);
  const create = trpc.costMatrix.create.useMutation({
    onSuccess: onSaved,
    onError,
  });
  const update = trpc.costMatrix.update.useMutation({
    onSuccess: onSaved,
    onError,
  });
  const change = trpc.costMatrix.setActive.useMutation({
    onSuccess: async record => {
      setChanging(null);
      toast.success(
        record.isActive ? "Registro reactivado" : "Registro desactivado"
      );
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const saving = create.isPending || update.isPending;
  const startEdit = (entry: Entry | null) => {
    setEditing(entry);
    setForm(entry ? costMatrixFields.parse(entry) : { ...empty });
    setFormError("");
    setFormOpen(true);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    const valid = costMatrixFields.safeParse(form);
    if (!valid.success) {
      setFormError(valid.error.issues[0]?.message ?? "Revise los campos");
      return;
    }
    if (editing) update.mutate({ id: editing.id, data: valid.data });
    else create.mutate(valid.data);
  };
  const choose = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  const actions = (entry: Entry) => (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Ver detalle ${entry.matrixCode}`}
        title="Ver detalle"
        onClick={() => setDetailId(entry.id)}
      >
        <Eye className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Editar ${entry.matrixCode}`}
        title="Editar"
        onClick={() => startEdit(entry)}
      >
        <Pencil className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`${entry.isActive ? "Desactivar" : "Reactivar"} ${entry.matrixCode}`}
        title={entry.isActive ? "Desactivar" : "Reactivar"}
        onClick={() => setChanging(entry)}
      >
        {entry.isActive ? (
          <Power className="size-4" />
        ) : (
          <RotateCcw className="size-4" />
        )}
      </Button>
    </div>
  );
  if (loading)
    return (
      <p role="status" className="p-6">
        Cargando…
      </p>
    );
  if (!allowed)
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Acceso restringido</h1>
        <p className="mt-2 text-muted-foreground">
          No tiene permisos para consultar la matriz de costos.
        </p>
      </div>
    );
  const data = list.data;
  const derived = deriveCostMatrix(form);
  return (
    <div className="cost-matrix-surface space-y-5 bg-background p-4 text-foreground md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <FileSpreadsheet className="size-6" />
            Matriz de costos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catálogo de jobs, niveles y actividades de flujo.
          </p>
        </div>
        <Button onClick={() => startEdit(null)}>
          <Plus className="mr-2 size-4" />
          Nuevo registro
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Buscar matriz"
              className="pl-9"
              placeholder="Buscar código o descripción…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-preserve-case="true"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Filter
              label="Job"
              value={job}
              onChange={choose(setJob)}
              options={[
                { value: "all", label: "Todos los jobs" },
                ...(options.data?.jobs ?? []).map(v => ({
                  value: v.code,
                  label: `${v.code} · ${v.name}`,
                })),
              ]}
            />
            <Filter
              label="Nivel 1"
              value={level}
              onChange={choose(setLevel)}
              options={[
                { value: "all", label: "Todos los niveles" },
                ...(options.data?.levels ?? []).map(v => ({
                  value: v.code,
                  label: `${v.code} · ${v.name}`,
                })),
              ]}
            />
            <Filter
              label="Actividad"
              value={activity}
              onChange={choose(setActivity)}
              options={[
                { value: "all", label: "Todas las actividades" },
                ...(options.data?.activities ?? []).map(v => ({
                  value: v.name,
                  label: v.name,
                })),
              ]}
            />
            <Filter
              label="Estado"
              value={active}
              onChange={choose(setActive)}
              options={[
                { value: "active", label: "Activos" },
                { value: "inactive", label: "Inactivos" },
                { value: "all", label: "Todos los estados" },
              ]}
            />
            <Filter
              label="Filas por página"
              value={String(pageSize)}
              onChange={v => {
                setPageSize(Number(v) as 25 | 50 | 100);
                setPage(1);
              }}
              options={[25, 50, 100].map(n => ({
                value: String(n),
                label: String(n),
              }))}
            />
          </div>
          {options.error && (
            <p role="alert" className="text-sm text-destructive">
              No se pudieron cargar los filtros.{" "}
              <button className="underline" onClick={() => options.refetch()}>
                Reintentar
              </button>
            </p>
          )}
        </div>
        {list.error ? (
          <div role="alert" className="p-8 text-center">
            <p>No se pudo cargar la matriz.</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => list.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : list.isLoading ? (
          <p role="status" className="p-10 text-center text-muted-foreground">
            Cargando matriz…
          </p>
        ) : !data?.items.length ? (
          <div className="p-10 text-center">
            <FileSpreadsheet className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No hay registros para estos filtros</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Cambie la búsqueda o agregue un nuevo registro.
            </p>
          </div>
        ) : (
          <div aria-busy={list.isFetching}>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    {[
                      "Código / Job",
                      "Último nivel",
                      "Clasificación",
                      "Actividad",
                      "Estado",
                      "Acciones",
                    ].map(t => (
                      <th key={t} className="px-4 py-3 font-medium">
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(entry => (
                    <tr
                      key={entry.id}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <button
                          className="whitespace-nowrap text-left font-mono text-xs font-medium hover:underline"
                          onClick={() => setDetailId(entry.id)}
                        >
                          {entry.matrixCode}
                        </button>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.jobCode} · {entry.jobName}
                        </p>
                      </td>
                      <td className="min-w-40 px-4 py-3">{entry.nivel4}</td>
                      <td className="min-w-40 px-4 py-3">
                        <p>{entry.nivel1}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {entry.majorGroup}
                        </p>
                      </td>
                      <td className="min-w-36 px-4 py-3 text-xs">
                        {entry.flowActivity}
                      </td>
                      <td className="px-4 py-3">{status(entry.isActive)}</td>
                      <td className="px-3 py-3">{actions(entry)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y md:hidden">
              {data.items.map(entry => (
                <article key={entry.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      className="break-all text-left font-mono text-xs font-medium hover:underline"
                      onClick={() => setDetailId(entry.id)}
                    >
                      {entry.matrixCode}
                    </button>
                    {status(entry.isActive)}
                  </div>
                  <p className="font-medium">{entry.nivel4}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.jobCode} · {entry.jobName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.nivel1} · {entry.majorGroup}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {entry.flowActivity}
                    </p>
                    {actions(entry)}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          <p className="text-muted-foreground" role="status">
            {list.isFetching
              ? "Actualizando…"
              : `${data?.total ?? 0} registros · Página ${data?.page ?? 1} de ${data?.totalPages ?? 1}`}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data || data.page <= 1 || list.isFetching}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !data || data.page >= data.totalPages || list.isFetching
              }
              onClick={() => setPage(p => p + 1)}
            >
              Siguiente
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={open => {
          if (!saving) setFormOpen(open);
        }}
      >
        <DialogContent className="cost-matrix-surface max-h-[90dvh] overflow-y-auto text-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar registro" : "Nuevo registro"}
            </DialogTitle>
            <DialogDescription>
              Complete los datos base. El código de matriz y las etiquetas de
              flujo se calculan automáticamente.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="min-w-0 space-y-5">
            {(
              [
                ["Job", fields.slice(0, 2)],
                ["Niveles", fields.slice(2, 10)],
                ["Flujo", fields.slice(10)],
              ] as [string, [Field, string][]][]
            ).map(([title, group]) => (
              <fieldset
                key={title}
                className="min-w-0 space-y-3 rounded-md border p-3"
              >
                <legend className="px-1 text-sm font-semibold">{title}</legend>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.map(([key, label]) => (
                    <div
                      key={key}
                      className={
                        key === "flowActivity"
                          ? "space-y-1.5 sm:col-span-2"
                          : "min-w-0 space-y-1.5"
                      }
                    >
                      <Label htmlFor={key}>{label}</Label>
                      <Input
                        id={key}
                        required
                        maxLength={
                          [
                            "jobCode",
                            "n1",
                            "n2",
                            "n3",
                            "n4",
                            "flowId",
                          ].includes(key)
                            ? 20
                            : 500
                        }
                        value={form[key]}
                        data-preserve-case="true"
                        onChange={e =>
                          setForm(v => ({ ...v, [key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="space-y-3 rounded-md bg-muted/50 p-3">
              <p className="text-sm font-semibold">Campos calculados</p>
              <div className="space-y-1.5">
                <Label htmlFor="matrixCode">Código de matriz</Label>
                <Input
                  id="matrixCode"
                  readOnly
                  value={derived.matrixCode}
                  className="font-mono text-xs"
                />
              </div>
              {[1, 2, 3, 4, 5].map(n => (
                <div key={n} className="space-y-1.5">
                  <Label htmlFor={`flow${n}`}>Flujo nivel {n}</Label>
                  <Input
                    id={`flow${n}`}
                    readOnly
                    value={derived[`flow${n}` as "flow1"]}
                  />
                </div>
              ))}
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setFormOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={detailId !== null}
        onOpenChange={open => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent className="cost-matrix-surface max-h-[90dvh] overflow-y-auto text-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de matriz</DialogTitle>
            <DialogDescription className="break-all">
              {detail.data?.matrixCode ?? "Datos del registro"}
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <p role="status">Cargando detalle…</p>
          ) : detail.error ? (
            <p role="alert">
              No se pudo cargar el detalle.{" "}
              <button className="underline" onClick={() => detail.refetch()}>
                Reintentar
              </button>
            </p>
          ) : (
            detail.data && (
              <>
                <div>{status(detail.data.isActive)}</div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  {fields.map(([key, label]) => (
                    <div key={key} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="break-words">{detail.data[key]}</dd>
                    </div>
                  ))}
                  {[1, 2, 3, 4, 5].map(n => (
                    <div key={n} className="min-w-0 sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">
                        Flujo nivel {n}
                      </dt>
                      <dd className="break-words">
                        {detail.data[`flow${n}` as "flow1"]}
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Identificador interno
                    </dt>
                    <dd>{detail.data.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Origen</dt>
                    <dd>
                      {detail.data.sourceKey
                        ? "Carga inicial"
                        : "Registro manual"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Creación</dt>
                    <dd>
                      {new Date(detail.data.createdAt).toLocaleString("es-HN")}{" "}
                      ·{" "}
                      {detail.data.createdById
                        ? `Usuario #${detail.data.createdById}`
                        : "Carga inicial"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Última modificación
                    </dt>
                    <dd>
                      {new Date(detail.data.updatedAt).toLocaleString("es-HN")}{" "}
                      ·{" "}
                      {detail.data.updatedById
                        ? `Usuario #${detail.data.updatedById}`
                        : "Carga inicial"}
                    </dd>
                  </div>
                </dl>
              </>
            )
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!changing}
        onOpenChange={open => {
          if (!open && !change.isPending) setChanging(null);
        }}
      >
        <AlertDialogContent className="cost-matrix-surface text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {changing?.isActive
                ? "Desactivar registro"
                : "Reactivar registro"}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {changing?.matrixCode}.{" "}
              {changing?.isActive
                ? "Se conservarán todos sus datos y podrá reactivarlo más adelante."
                : "El registro volverá a mostrarse entre los activos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={change.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={change.isPending}
              onClick={e => {
                e.preventDefault();
                if (changing)
                  change.mutate({
                    id: changing.id,
                    isActive: !changing.isActive,
                  });
              }}
            >
              {change.isPending
                ? "Guardando…"
                : changing?.isActive
                  ? "Desactivar"
                  : "Reactivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
