import { useRef, useState } from "react";
import type { InventoryCutoffReport } from "@shared/inventory-cutoff-report";
import { trpc } from "@/lib/trpc";
import {
  downloadInventoryCutoffReport,
  formatInventoryCutoffDate,
} from "@/lib/inventory-cutoff-export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

type InventoryCutoffReportDialogProps = {
  defaultProjectId?: number;
  defaultWarehouseId?: number;
};

function todayInHonduras() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find(value => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const optionCollator = new Intl.Collator("es-HN", {
  numeric: true,
  sensitivity: "base",
});

export function InventoryCutoffReportDialog({
  defaultProjectId,
  defaultWarehouseId,
}: InventoryCutoffReportDialogProps) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [cutoffDate, setCutoffDate] = useState(todayInHonduras);
  const [projectId, setProjectId] = useState("all");
  const [warehouseId, setWarehouseId] = useState("all");
  const [report, setReport] = useState<InventoryCutoffReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const metadata = trpc.inventory.cutoffMetadata.useQuery(undefined, {
    enabled: open,
    retry: false,
  });
  const projectsQuery = trpc.projects.list.useQuery(undefined, {
    enabled: open,
    retry: false,
  });
  const warehousesQuery = trpc.warehouses.list.useQuery(undefined, {
    enabled: open,
    retry: false,
  });
  const projects = [...(projectsQuery.data ?? [])].sort((left, right) =>
    optionCollator.compare(left.code, right.code)
  );
  const warehouses = [...(warehousesQuery.data ?? [])].sort((left, right) =>
    optionCollator.compare(left.displayName, right.displayName)
  );
  const optionsLoading = projectsQuery.isLoading || warehousesQuery.isLoading;
  const optionsError = Boolean(projectsQuery.error || warehousesQuery.error);
  const busy = isGenerating || isDownloading;
  const unavailableRows =
    report?.inventory.filter(row => row.stock === null).length ?? 0;
  const hasObservations = Boolean(
    report &&
      (report.coverage.kind === "documentary_partial" ||
        unavailableRows > 0 ||
        report.coverage.warnings.length > 0)
  );

  function invalidateReport() {
    requestSequence.current += 1;
    setReport(null);
    setError(null);
  }

  function changeOpen(nextOpen: boolean) {
    if (isDownloading) return;
    invalidateReport();
    setIsGenerating(false);
    if (nextOpen) {
      setCutoffDate(metadata.data?.today ?? todayInHonduras());
      setProjectId(defaultProjectId ? String(defaultProjectId) : "all");
      setWarehouseId(defaultWarehouseId ? String(defaultWarehouseId) : "all");
    }
    setOpen(nextOpen);
  }

  async function prepareReport() {
    if (busy || !metadata.data?.ready) return;
    if (!cutoffDate) {
      setError("Seleccione la fecha de corte.");
      return;
    }
    if (metadata.data.earliestDate && cutoffDate < metadata.data.earliestDate) {
      setError(
        `El reporte está disponible desde el ${formatInventoryCutoffDate(metadata.data.earliestDate)}.`
      );
      return;
    }
    if (cutoffDate > metadata.data.today) {
      setError("La fecha de corte no puede ser posterior a hoy.");
      return;
    }

    const sequence = ++requestSequence.current;
    setReport(null);
    setError(null);
    setIsGenerating(true);
    try {
      const result = await utils.inventory.cutoffReport.fetch({
        cutoffDate,
        projectId: projectId === "all" ? undefined : Number(projectId),
        warehouseId: warehouseId === "all" ? undefined : Number(warehouseId),
      });
      if (sequence === requestSequence.current) setReport(result);
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "No se pudo preparar el reporte. Intente nuevamente."
        );
      }
    } finally {
      if (sequence === requestSequence.current) setIsGenerating(false);
    }
  }

  async function downloadReport() {
    if (!report || busy) return;
    setIsDownloading(true);
    try {
      await downloadInventoryCutoffReport(report);
      toast.success("Reporte de inventario, entradas y salidas descargado");
    } catch {
      toast.error("No se pudo descargar el Excel. Intente nuevamente.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={() => changeOpen(true)}
      >
        <FileSpreadsheet className="h-4 w-4" />
        Reporte a fecha de corte
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="min-w-0 pr-5 text-left">
            <DialogTitle className="leading-snug">
              Reporte a fecha de corte
            </DialogTitle>
            <DialogDescription>
              Prepara un Excel con inventario por ubicación, entradas y salidas.
              Incluye traslados y devoluciones.
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            {metadata.isLoading || metadata.isFetching ? (
              <p
                className="flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Consultando el período disponible...
              </p>
            ) : metadata.error || optionsError ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>No se pudo cargar el reporte</AlertTitle>
                <AlertDescription>
                  <p>
                    No se pudieron consultar el período y los filtros. Intente
                    nuevamente.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void metadata.refetch();
                      void projectsQuery.refetch();
                      void warehousesQuery.refetch();
                    }}
                  >
                    Reintentar
                  </Button>
                </AlertDescription>
              </Alert>
            ) : !metadata.data?.ready ? (
              <Alert>
                <AlertTriangle />
                <AlertTitle>Reporte no disponible</AlertTitle>
                <AlertDescription>
                  {metadata.data?.message ||
                    "Todavía no hay información disponible para este reporte."}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p>
                  Disponible desde el{" "}
                  <strong>
                    {formatInventoryCutoffDate(
                      metadata.data.earliestDate ?? ""
                    )}
                  </strong>
                  . El corte incluye el día completo, en hora de Honduras.
                </p>
                {metadata.data.message ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {metadata.data.message}
                  </p>
                ) : null}
              </div>
            )}

            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2 sm:col-span-2">
                <Label htmlFor="inventory-cutoff-date">Fecha de corte</Label>
                <Input
                  id="inventory-cutoff-date"
                  type="date"
                  value={cutoffDate}
                  min={metadata.data?.earliestDate ?? undefined}
                  max={metadata.data?.today}
                  disabled={busy}
                  onChange={event => {
                    invalidateReport();
                    setCutoffDate(event.target.value);
                  }}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="inventory-cutoff-project">
                  Proyecto / bodega
                </Label>
                <Select
                  value={projectId}
                  disabled={busy || optionsLoading}
                  onValueChange={value => {
                    invalidateReport();
                    setProjectId(value);
                    setWarehouseId("all");
                  }}
                >
                  <SelectTrigger
                    id="inventory-cutoff-project"
                    className="w-full min-w-0"
                  >
                    <SelectValue
                      className="min-w-0 flex-1 truncate text-left"
                      placeholder="Todos los proyectos autorizados"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      Todos los proyectos autorizados
                    </SelectItem>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.code} - {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="inventory-cutoff-warehouse">
                  Almacén físico
                </Label>
                <Select
                  value={warehouseId}
                  disabled={busy || optionsLoading}
                  onValueChange={value => {
                    invalidateReport();
                    setWarehouseId(value);
                  }}
                >
                  <SelectTrigger
                    id="inventory-cutoff-warehouse"
                    className="w-full min-w-0"
                  >
                    <SelectValue
                      className="min-w-0 flex-1 truncate text-left"
                      placeholder="Todos los almacenes autorizados"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      Todos los almacenes autorizados
                    </SelectItem>
                    {warehouses.map(warehouse => (
                      <SelectItem
                        key={warehouse.id}
                        value={String(warehouse.id)}
                      >
                        {warehouse.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>No se pudo preparar el reporte</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {report ? (
              <div className="space-y-3" aria-live="polite">
                <div className="grid grid-cols-3 gap-2 rounded-md border border-border p-3 text-center">
                  {[
                    ["Inventario", report.inventory.length],
                    ["Entradas", report.entries.length],
                    ["Salidas", report.exits.length],
                  ].map(([label, count]) => (
                    <div key={label} className="min-w-0">
                      <p className="text-lg font-semibold">
                        {Number(count).toLocaleString("es-HN")}
                      </p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
                <Alert>
                  {hasObservations ? <AlertTriangle /> : <FileSpreadsheet />}
                  <AlertTitle>
                    {hasObservations
                      ? "Reporte con observaciones"
                      : "Reporte preparado"}
                  </AlertTitle>
                  <AlertDescription>
                    <p>{report.coverage.message}</p>
                    {unavailableRows > 0 ? (
                      <p>
                        {unavailableRows.toLocaleString("es-HN")} ubicación(es)
                        sin saldo comprobable. Se muestran como N/D en el Excel.
                      </p>
                    ) : null}
                    {report.coverage.warnings.length > 0 ? (
                      <ul className="list-disc space-y-1 pl-4">
                        {Array.from(new Set(report.coverage.warnings)).map(
                          warning => (
                            <li key={warning}>{warning}</li>
                          )
                        )}
                      </ul>
                    ) : null}
                  </AlertDescription>
                </Alert>
                <p className="text-xs text-muted-foreground">
                  Movimientos desde el{" "}
                  {formatInventoryCutoffDate(report.periodStartDate)} hasta el{" "}
                  {formatInventoryCutoffDate(report.cutoffDate)}. Los pendientes
                  históricos sin información suficiente figuran como N/D; las
                  observaciones se incluyen en las tres hojas.
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => changeOpen(false)}
              disabled={isDownloading}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              variant={report ? "outline" : "default"}
              disabled={
                busy ||
                metadata.isFetching ||
                !metadata.data?.ready ||
                optionsLoading ||
                optionsError ||
                Boolean(metadata.error)
              }
              onClick={() => void prepareReport()}
              className="gap-2"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {isGenerating
                ? "Preparando..."
                : report
                  ? "Preparar de nuevo"
                  : "Preparar reporte"}
            </Button>
            {report ? (
              <Button
                type="button"
                onClick={() => void downloadReport()}
                disabled={busy}
                className="gap-2"
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isDownloading ? "Descargando..." : "Descargar Excel"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
