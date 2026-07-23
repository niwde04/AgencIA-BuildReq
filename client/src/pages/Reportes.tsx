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
import {
  downloadDmcSarReport,
  downloadRetentionSarReport,
  downloadSystemWorkbook,
} from "@/lib/dmc-export";
import { trpc } from "@/lib/trpc";
import type { FiscalReportIssue } from "@shared/dmc-sar-report";
import type { DmcStatusMode } from "@shared/dmc-report";
import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const STATUS_MODE_LABELS: Record<DmcStatusMode, string> = {
  non_void: "No anuladas",
  registered_only: "Solo contabilizadas",
  all: "Todos los estados",
};

function toDateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function currentMonth() {
  const now = new Date();
  return {
    from: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function canAccessReports(user: ReturnType<typeof useAuth>["user"]) {
  const role = (user as any)?.buildreqRole;
  return (
    role === "administracion_central" ||
    role === "administrador_proyecto" ||
    role === "contable"
  );
}

type LastResult = {
  title: string;
  records: number;
  issues: FiscalReportIssue[];
  generatedAt: Date | string;
};

export default function Reportes() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const initial = useMemo(currentMonth, []);
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);
  const [statusMode, setStatusMode] = useState<DmcStatusMode>("non_void");
  const [activeDownload, setActiveDownload] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  const baseInput = useMemo(
    () => ({ dateFrom: dateFrom || null, dateTo: dateTo || null, statusMode }),
    [dateFrom, dateTo, statusMode]
  );
  const systemQuery = trpc.reports.systemWorkbook.useQuery(baseInput, {
    enabled: false,
    retry: false,
  });
  const dmcQuery = trpc.reports.dmcSarPurchases.useQuery(baseInput, {
    enabled: false,
    retry: false,
  });
  const rt01Query = trpc.reports.retentionSar.useQuery(
    { ...baseInput, type: "RT01" },
    { enabled: false, retry: false }
  );
  const rt125Query = trpc.reports.retentionSar.useQuery(
    { ...baseInput, type: "RT125" },
    { enabled: false, retry: false }
  );
  const rt15Query = trpc.reports.retentionSar.useQuery(
    { ...baseInput, type: "RT15" },
    { enabled: false, retry: false }
  );

  const hasAccess = canAccessReports(user);

  const validateRange = () => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("La fecha inicial no puede ser mayor que la fecha final");
      return false;
    }
    return true;
  };

  const run = async (
    key: string,
    request: () => Promise<any>,
    download: (payload: any) => Promise<void>,
    title: string
  ) => {
    if (!validateRange()) return;
    setActiveDownload(key);
    try {
      const result = await request();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("No se pudo preparar el reporte");
      const issues: FiscalReportIssue[] = result.data.issues ?? [];
      const records =
        result.data.summary.rowCount ??
        result.data.summary.invoiceCount ??
        result.data.summary.invoiceLineCount ??
        0;
      setLastResult({
        title,
        records,
        issues,
        generatedAt: result.data.summary.generatedAt,
      });
      if (result.data.canExport === false) {
        toast.error(
          `No se generó ${title}: hay ${issues.length} dato(s) por corregir`
        );
        return;
      }
      await download(result.data);
      toast.success(`${title} generado con ${records} registro(s)`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `No se pudo generar ${title}`
      );
    } finally {
      setActiveDownload(null);
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

  const buttons = [
    {
      key: "system",
      label: "Libro interno BuildReq",
      action: () =>
        run(
          "system",
          () => systemQuery.refetch(),
          downloadSystemWorkbook,
          "Libro interno BuildReq"
        ),
    },
    {
      key: "dmc",
      label: "DMC SAR 527",
      action: () =>
        run("dmc", () => dmcQuery.refetch(), downloadDmcSarReport, "DMC SAR 527"),
    },
    {
      key: "rt01",
      label: "Retención 1% (135)",
      action: () =>
        run(
          "rt01",
          () => rt01Query.refetch(),
          downloadRetentionSarReport,
          "Retención 1% (135)"
        ),
    },
    {
      key: "rt125",
      label: "Retención 12.5% (112)",
      action: () =>
        run(
          "rt125",
          () => rt125Query.refetch(),
          downloadRetentionSarReport,
          "Retención 12.5% (112)"
        ),
    },
    {
      key: "rt15",
      label: "Retención 15% (217)",
      action: () =>
        run(
          "rt15",
          () => rt15Query.refetch(),
          downloadRetentionSarReport,
          "Retención 15% (217)"
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1>Reportes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plantillas fiscales SAR y libro operativo del cliente.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Descargas XLSX</h2>
            </div>
            <Badge variant="outline">{STATUS_MODE_LABELS[statusMode]}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="reports-date-from">Fecha inicial</Label>
              <Input
                id="reports-date-from"
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reports-date-to">Fecha final</Label>
              <Input
                id="reports-date-to"
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Estado de facturas</Label>
              <Select
                value={statusMode}
                onValueChange={value => setStatusMode(value as DmcStatusMode)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="non_void">No anuladas</SelectItem>
                  <SelectItem value="registered_only">Solo contabilizadas</SelectItem>
                  <SelectItem value="all">Todos los estados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {buttons.map(button => (
              <Button
                key={button.key}
                type="button"
                variant={button.key === "system" ? "default" : "outline"}
                disabled={activeDownload !== null}
                onClick={() => void button.action()}
                className="justify-start"
              >
                {activeDownload === button.key ? (
                  <Spinner className="mr-2 size-4" />
                ) : (
                  <Download className="mr-2 size-4" />
                )}
                {button.label}
              </Button>
            ))}
          </div>

          {lastResult ? (
            <div className="space-y-4 border-t border-border pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{lastResult.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {lastResult.records} registro(s) ·{" "}
                    {new Date(lastResult.generatedAt).toLocaleString("es-HN")}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={
                    lastResult.issues.length
                      ? "border-amber-300 text-amber-800"
                      : "border-emerald-300 text-emerald-700"
                  }
                >
                  {lastResult.issues.length
                    ? `${lastResult.issues.length} pendiente(s)`
                    : "Listo para descargar"}
                </Badge>
              </div>

              {lastResult.issues.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    Corrija estos datos en Facturas y vuelva a generar:
                  </div>
                  <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
                    {lastResult.issues.map((issue, index) => (
                      <button
                        key={`${issue.invoiceId}-${issue.field}-${index}`}
                        type="button"
                        className="flex w-full items-start justify-between gap-3 p-3 text-left text-sm hover:bg-muted/50"
                        onClick={() =>
                          setLocation(`/facturas?editar=${issue.invoiceId}`)
                        }
                      >
                        <span>
                          <strong>{issue.invoiceNumber}</strong>
                          <span className="ml-2 text-muted-foreground">
                            {issue.message}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-primary">
                          Abrir factura
                        </span>
                      </button>
                    ))}
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
