import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { downloadDmcReport, downloadDmcSarReport } from "@/lib/dmc-export";
import { trpc } from "@/lib/trpc";
import type { DmcReportSummary, DmcStatusMode } from "@shared/dmc-report";
import type { DmcSarReportSummary } from "@shared/dmc-sar-report";
import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const STATUS_MODE_LABELS: Record<DmcStatusMode, string> = {
  non_void: "No anuladas",
  registered_only: "Solo contabilizadas",
  all: "Todos los estados",
};

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const now = new Date();
  return {
    dateFrom: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function formatMoney(value: number) {
  return value.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateLabel(value: Date | string | null | undefined) {
  if (!value) return "Sin fecha";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-HN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function canAccessReports(user: ReturnType<typeof useAuth>["user"]) {
  const buildreqRole = (user as any)?.buildreqRole;
  return (
    buildreqRole === "administracion_central" ||
    buildreqRole === "administrador_proyecto" ||
    buildreqRole === "contable"
  );
}

export default function Reportes() {
  const { user } = useAuth();
  const defaultRange = useMemo(() => getCurrentMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom);
  const [dateTo, setDateTo] = useState(defaultRange.dateTo);
  const [statusMode, setStatusMode] = useState<DmcStatusMode>("non_void");
  const [lastSummary, setLastSummary] = useState<DmcReportSummary | null>(null);
  const [lastSarSummary, setLastSarSummary] =
    useState<DmcSarReportSummary | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingSar, setIsDownloadingSar] = useState(false);

  const reportInput = useMemo(
    () => ({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      statusMode,
    }),
    [dateFrom, dateTo, statusMode]
  );

  const dmcQuery = trpc.reports.dmcPurchases.useQuery(reportInput, {
    enabled: false,
    retry: false,
  });
  const dmcSarQuery = trpc.reports.dmcSarPurchases.useQuery(reportInput, {
    enabled: false,
    retry: false,
  });

  const hasAccess = canAccessReports(user);
  const isGenerating = dmcQuery.isFetching || isDownloading;
  const isGeneratingSar = dmcSarQuery.isFetching || isDownloadingSar;

  const handleGenerateDmc = async () => {
    if (!hasAccess) {
      toast.error("No tiene acceso a reportes");
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("La fecha inicial no puede ser mayor que la fecha final");
      return;
    }

    setIsDownloading(true);
    try {
      const result = await dmcQuery.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("No se pudo generar el reporte");

      await downloadDmcReport(result.data);
      setLastSummary(result.data.summary);
      toast.success(
        result.data.summary.invoiceCount === 1
          ? "DMC generado con 1 factura"
          : `DMC generado con ${result.data.summary.invoiceCount} facturas`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el reporte DMC"
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleGenerateDmcSar = async () => {
    if (!hasAccess) {
      toast.error("No tiene acceso a reportes");
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("La fecha inicial no puede ser mayor que la fecha final");
      return;
    }

    setIsDownloadingSar(true);
    try {
      const result = await dmcSarQuery.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("No se pudo generar el DMC SAR");

      await downloadDmcSarReport(result.data);
      setLastSarSummary(result.data.summary);
      toast.success(
        result.data.summary.invoiceCount === 1
          ? "DMC SAR generado con 1 factura"
          : `DMC SAR generado con ${result.data.summary.invoiceCount} facturas`
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo generar el reporte DMC SAR"
      );
    } finally {
      setIsDownloadingSar(false);
    }
  };

  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <h1>Reportes</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No tiene acceso a reportes.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Reportes</h1>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold tracking-tight">
                  Declaración Mensual de Compras
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">DMC</p>
            </div>
            <Badge variant="outline" className="rounded-sm">
              XLSX
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="dmc-date-from">Fecha desde</Label>
              <Input
                id="dmc-date-from"
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dmc-date-to">Fecha hasta</Label>
              <Input
                id="dmc-date-to"
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Select
                value={statusMode}
                onValueChange={value => setStatusMode(value as DmcStatusMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="non_void">No anuladas</SelectItem>
                  <SelectItem value="registered_only">
                    Solo contabilizadas
                  </SelectItem>
                  <SelectItem value="all">Todos los estados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => void handleGenerateDmc()}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isGenerating ? "Generando..." : "Registro de facturas"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleGenerateDmcSar()}
              disabled={isGeneratingSar}
            >
              {isGeneratingSar ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isGeneratingSar ? "Generando..." : "Generar DMC SAR"}
            </Button>
            <span className="text-sm text-muted-foreground">
              {STATUS_MODE_LABELS[statusMode]}
            </span>
          </div>

          {lastSummary ? (
            <div className="grid gap-3 border-t border-border pt-5 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Facturas
                </div>
                <div className="text-lg font-semibold">
                  {lastSummary.invoiceCount}
                </div>
              </div>
              {lastSummary.totalsByCurrency.map(summary => (
                <div key={summary.currency}>
                  <div className="text-xs uppercase text-muted-foreground">
                    Totales {summary.currency}
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMoney(summary.totalFactura)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Neto: {formatMoney(summary.netoPagar)} · {summary.invoiceCount} factura(s)
                  </div>
                </div>
              ))}
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Generado
                </div>
                <div className="text-lg font-semibold">
                  {formatDateLabel(lastSummary.generatedAt)}
                </div>
              </div>
            </div>
          ) : null}

          {lastSarSummary ? (
            <div className="space-y-4 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold">DMC SAR</h3>
                <Badge variant="outline" className="rounded-sm">
                  {lastSarSummary.invoiceCount} facturas
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    Detalle compras
                  </div>
                  <div className="text-lg font-semibold">
                    {lastSarSummary.detalleComprasCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    Otros comprobantes
                  </div>
                  <div className="text-lg font-semibold">
                    {lastSarSummary.otrosComprobantesCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    Importaciones
                  </div>
                  <div className="text-lg font-semibold">
                    {lastSarSummary.importacionesCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    Generado
                  </div>
                  <div className="text-lg font-semibold">
                    {formatDateLabel(lastSarSummary.generatedAt)}
                  </div>
                </div>
              </div>
              {lastSarSummary.isv4InvoiceCount > 0 ? (
                <div className="flex items-start gap-2 rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {lastSarSummary.isv4InvoiceCount} factura(s) tienen ISV 4%.
                    La plantilla SAR usada no incluye columnas para ese impuesto.
                    Base: {formatMoney(lastSarSummary.isv4BaseTotal)}; impuesto:{" "}
                    {formatMoney(lastSarSummary.isv4TaxTotal)}.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
