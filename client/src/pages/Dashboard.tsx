import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  ClipboardList,
  ChevronDown,
  Download,
  FolderKanban,
  RotateCcw,
  AlertCircle,
  ArrowRight,
  FileCheck2,
  ShoppingCart,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState } from "react";
import { toast } from "sonner";
import { isProcurementApproverRole } from "@shared/buildreq-roles";
import { useProcurementApprovalSettings } from "@/hooks/useProcurementApprovalSettings";
import { buildDatedExcelFileName, downloadExcel } from "@/lib/excel-export";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  borrador: "#64748b",
  pendiente_aprobar: "#f97316",
  en_espera: "#f59e0b",
  en_proceso: "#3b82f6",
  parcialmente_atendida: "#0891b2",
  flujo_completado: "#10b981",
  cerrada: "#6b7280",
  cerrada_incompleta: "#ca8a04",
};

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  pendiente_aprobar: "Pendiente de aprobar",
  en_espera: "En espera",
  en_proceso: "En proceso",
  parcialmente_atendida: "Parcialmente atendida",
  flujo_completado: "Flujo completado",
  cerrada: "Cerrada",
  cerrada_incompleta: "Cerrada incompleta",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  borrador: "border-slate-300 text-slate-700 bg-slate-50",
  pendiente_aprobar: "border-orange-300 text-orange-700 bg-orange-50",
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  parcialmente_atendida: "border-cyan-300 text-cyan-700 bg-cyan-50",
  flujo_completado: "border-emerald-300 text-emerald-700 bg-emerald-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
  cerrada_incompleta: "border-yellow-300 text-yellow-700 bg-yellow-50",
};

const FLOW_LABELS: Record<string, string> = {
  compra_directa: "Compra Directa",
  despacho_bodega: "Despacho Bodega",
  traslado_proyecto: "Traslado",
  solicitud_compra: "Solicitud Compra",
};

const FLOW_COLORS = ["#dc2626", "#991b1b", "#ef4444", "#b91c1c"];

type FinancialPeriod =
  | "historical"
  | "current_month"
  | "current_year"
  | "custom";

const HNL_FORMATTER = new Intl.NumberFormat("es-HN", {
  style: "currency",
  currency: "HNL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COMPACT_HNL_FORMATTER = new Intl.NumberFormat("es-HN", {
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthRange() {
  const today = new Date();
  return {
    dateFrom: formatDateInput(
      new Date(today.getFullYear(), today.getMonth(), 1)
    ),
    dateTo: formatDateInput(today),
  };
}

function getFinancialDateRange(
  period: FinancialPeriod,
  customDateFrom: string,
  customDateTo: string
) {
  const today = new Date();
  if (period === "current_month") return getCurrentMonthRange();
  if (period === "current_year") {
    return {
      dateFrom: formatDateInput(new Date(today.getFullYear(), 0, 1)),
      dateTo: formatDateInput(today),
    };
  }
  if (period === "custom") {
    return {
      dateFrom: customDateFrom || undefined,
      dateTo: customDateTo || undefined,
    };
  }
  return { dateFrom: undefined, dateTo: undefined };
}

function formatHnl(value: number) {
  return HNL_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const initialCustomRange = getCurrentMonthRange();
  const [financialPeriod, setFinancialPeriod] =
    useState<FinancialPeriod>("historical");
  const [isExportingFinancialExcel, setIsExportingFinancialExcel] =
    useState(false);
  const [recentRequestsOpen, setRecentRequestsOpen] = useState(true);
  const [customDateFrom, setCustomDateFrom] = useState(
    initialCustomRange.dateFrom
  );
  const [customDateTo, setCustomDateTo] = useState(initialCustomRange.dateTo);
  const financialDateRange = getFinancialDateRange(
    financialPeriod,
    customDateFrom,
    customDateTo
  );
  const hasInvalidFinancialDateRange = Boolean(
    financialDateRange.dateFrom &&
      financialDateRange.dateTo &&
      financialDateRange.dateFrom > financialDateRange.dateTo
  );
  const {
    data: financialReport,
    isLoading: isLoadingFinancialReport,
    error: financialReportError,
  } = trpc.dashboard.financialReport.useQuery(financialDateRange, {
    enabled: !hasInvalidFinancialDateRange,
  });
  const isProcurementApprover = isProcurementApproverRole(
    (user as any)?.buildreqRole
  );
  const { purchaseRequestApprovalsEnabled, purchaseOrderApprovalsEnabled } =
    useProcurementApprovalSettings();
  const { data: approvalCounts } = trpc.dashboard.sidebarCounts.useQuery(
    undefined,
    {
      enabled:
        (purchaseRequestApprovalsEnabled || purchaseOrderApprovalsEnabled) &&
        isProcurementApprover,
    }
  );
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1>Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-20 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          No se pudieron cargar las estadísticas
        </p>
      </div>
    );
  }

  const statusData = (stats.requestsByStatus || []).map((s: any) => ({
    name: STATUS_LABELS[s.status] || s.status,
    value: s.count,
    fill: STATUS_COLORS[s.status] || "#6b7280",
  }));

  const projectData = (stats.requestsByProject || []).map((p: any) => ({
    name: p.projectCode || `P-${p.projectId}`,
    solicitudes: p.count,
  }));

  const flowData = (stats.requestsByFlow || []).map((f: any, i: number) => ({
    name: FLOW_LABELS[f.flowType] || f.flowType,
    value: f.count,
    fill: FLOW_COLORS[i % FLOW_COLORS.length],
  }));
  const financialProjectData = (financialReport?.projects || []).map(
    (project: any) => ({
      ...project,
      name: project.projectCode || `P-${project.projectId}`,
    })
  );
  const exportFinancialTableExcel = async () => {
    if (
      isExportingFinancialExcel ||
      hasInvalidFinancialDateRange ||
      financialProjectData.length === 0
    ) {
      return;
    }

    setIsExportingFinancialExcel(true);
    try {
      const periodSuffix =
        financialDateRange.dateFrom || financialDateRange.dateTo
          ? `${financialDateRange.dateFrom || "inicio"}-${financialDateRange.dateTo || "fin"}`
          : "historico";
      await downloadExcel(
        buildDatedExcelFileName(
          `montos-oc-facturas-por-proyecto-${periodSuffix}`
        ),
        "Montos por proyecto",
        [
          {
            header: "Proyecto",
            value: (project: any) =>
              `${project.projectCode} — ${project.projectName}`,
            width: 42,
          },
          {
            header: "OC aprobadas",
            value: (project: any) => project.purchaseOrderCount,
            width: 16,
            numFmt: "0",
          },
          {
            header: "Monto OC",
            value: (project: any) => project.purchaseOrdersHnl,
            width: 20,
            numFmt: '"L" #,##0.00',
          },
          {
            header: "Facturas",
            value: (project: any) => project.invoiceCount,
            width: 14,
            numFmt: "0",
          },
          {
            header: "Monto facturado",
            value: (project: any) => project.invoicesHnl,
            width: 22,
            numFmt: '"L" #,##0.00',
          },
        ],
        financialProjectData
      );
      toast.success(
        `Se exportaron ${financialProjectData.length.toLocaleString("es-HN")} proyecto(s)`
      );
    } catch {
      toast.error("No se pudo exportar la tabla a Excel");
    } finally {
      setIsExportingFinancialExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Dashboard</h1>
        <div className="w-8 h-8 bg-primary" />
      </div>

      {(purchaseRequestApprovalsEnabled || purchaseOrderApprovalsEnabled) &&
      isProcurementApprover ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {purchaseRequestApprovalsEnabled ? (
            <Card
              className="cursor-pointer border-amber-200 transition-colors hover:border-amber-400"
              onClick={() => setLocation("/solicitudes-compra")}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      SC pendientes de aprobación
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {approvalCounts?.purchaseRequestsPending ?? 0}
                    </p>
                  </div>
                  <FileCheck2 className="h-8 w-8 text-amber-500/70" />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {purchaseOrderApprovalsEnabled ? (
            <Card
              className="cursor-pointer border-amber-200 transition-colors hover:border-amber-400"
              onClick={() => setLocation("/ordenes-compra")}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      OC pendientes de aprobación
                    </p>
                    <p className="mt-1 text-3xl font-bold">
                      {approvalCounts?.purchaseOrdersEmitted ?? 0}
                    </p>
                  </div>
                  <ShoppingCart className="h-8 w-8 text-amber-500/70" />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="cursor-pointer hover:border-primary/30 transition-colors"
          onClick={() => setLocation("/solicitudes")}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Total Requisiciones
                </p>
                <p className="text-3xl font-bold mt-1">{stats.totalRequests}</p>
              </div>
              <ClipboardList className="h-8 w-8 text-primary/60" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Proyectos Activos
                </p>
                <p className="text-3xl font-bold mt-1">
                  {stats.totalActiveProjects}
                </p>
              </div>
              <FolderKanban className="h-8 w-8 text-primary/60" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Total Devoluciones
                </p>
                <p className="text-3xl font-bold mt-1">{stats.totalReturns}</p>
              </div>
              <RotateCcw className="h-8 w-8 text-primary/60" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Devoluciones Pendientes
                </p>
                <p className="text-3xl font-bold mt-1">
                  {stats.pendingReturns}
                </p>
              </div>
              <AlertCircle className="h-8 w-8 text-amber-500/60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests by Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Requisiciones por Estatus
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {statusData.map((entry: any, index: number) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">
                Sin datos disponibles
              </div>
            )}
          </CardContent>
        </Card>

        {/* Requests by Flow Type */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Flujos de Abastecimiento
            </CardTitle>
          </CardHeader>
          <CardContent>
            {flowData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={flowData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {flowData.map((entry: any, index: number) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-60 text-muted-foreground text-sm">
                Sin datos disponibles
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Requests by Project */}
      {projectData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Requisiciones por Proyecto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={projectData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  stroke="#737373"
                />
                <YAxis tick={{ fontSize: 12 }} stroke="#737373" />
                <Tooltip />
                <Bar
                  dataKey="solicitudes"
                  fill="#dc2626"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Approved purchase orders and registered invoices by project */}
      <Card>
        <CardHeader className="gap-4 pb-2 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Montos de OC aprobadas y facturas registradas por proyecto
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Valores históricos expresados en lempiras según la fecha de
              aprobación o registro.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 space-y-1.5">
              <Label htmlFor="financial-period" className="text-xs">
                Período
              </Label>
              <Select
                value={financialPeriod}
                onValueChange={value =>
                  setFinancialPeriod(value as FinancialPeriod)
                }
              >
                <SelectTrigger id="financial-period" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="historical">Histórico completo</SelectItem>
                  <SelectItem value="current_month">Mes actual</SelectItem>
                  <SelectItem value="current_year">Año actual</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {financialPeriod === "custom" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="financial-date-from" className="text-xs">
                    Desde
                  </Label>
                  <Input
                    id="financial-date-from"
                    type="date"
                    value={customDateFrom}
                    onChange={event => setCustomDateFrom(event.target.value)}
                    className="h-9 w-40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="financial-date-to" className="text-xs">
                    Hasta
                  </Label>
                  <Input
                    id="financial-date-to"
                    type="date"
                    value={customDateTo}
                    onChange={event => setCustomDateTo(event.target.value)}
                    className="h-9 w-40"
                  />
                </div>
              </>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => void exportFinancialTableExcel()}
              disabled={
                isExportingFinancialExcel ||
                isLoadingFinancialReport ||
                Boolean(financialReportError) ||
                hasInvalidFinancialDateRange ||
                financialProjectData.length === 0
              }
            >
              <Download className="mr-2 h-4 w-4" />
              {isExportingFinancialExcel ? "Exportando..." : "Exportar Excel"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-4">
          {hasInvalidFinancialDateRange ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              La fecha inicial no puede ser mayor que la fecha final.
            </div>
          ) : isLoadingFinancialReport ? (
            <div className="h-80 animate-pulse rounded-lg bg-muted" />
          ) : financialReportError ? (
            <div className="flex h-40 items-center justify-center text-center text-sm text-destructive">
              No se pudo cargar el informe: {financialReportError.message}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    OC aprobadas
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatHnl(financialReport?.totals.purchaseOrdersHnl ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {financialReport?.totals.purchaseOrderCount ?? 0} orden(es)
                    de compra
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Facturas registradas
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatHnl(financialReport?.totals.invoicesHnl ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {financialReport?.totals.invoiceCount ?? 0} factura(s)
                  </p>
                </div>
              </div>

              {financialProjectData.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <div
                      style={{
                        minWidth: Math.max(
                          720,
                          financialProjectData.length * 110
                        ),
                      }}
                    >
                      <ResponsiveContainer width="100%" height={340}>
                        <BarChart
                          data={financialProjectData}
                          margin={{ top: 12, right: 16, left: 16, bottom: 8 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="#e5e5e5"
                          />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 12 }}
                            stroke="#737373"
                          />
                          <YAxis
                            width={82}
                            tick={{ fontSize: 12 }}
                            stroke="#737373"
                            tickFormatter={value =>
                              `L ${COMPACT_HNL_FORMATTER.format(Number(value))}`
                            }
                          />
                          <Tooltip
                            formatter={(value: any, name: any) => [
                              formatHnl(Number(value)),
                              name,
                            ]}
                          />
                          <Legend />
                          <Bar
                            dataKey="purchaseOrdersHnl"
                            name="OC aprobadas"
                            fill="#dc2626"
                            radius={[2, 2, 0, 0]}
                          />
                          <Bar
                            dataKey="invoicesHnl"
                            name="Facturas registradas"
                            fill="#2563eb"
                            radius={[2, 2, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="border-b border-border">
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Proyecto
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            OC aprobadas
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Monto OC
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Facturas
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Monto facturado
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {financialProjectData.map((project: any) => (
                          <tr
                            key={project.projectId}
                            className="border-b border-border last:border-0"
                          >
                            <td className="px-4 py-3">
                              <p className="font-medium">
                                {project.projectCode}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {project.projectName}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {project.purchaseOrderCount}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                              {formatHnl(project.purchaseOrdersHnl)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {project.invoiceCount}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                              {formatHnl(project.invoicesHnl)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
                  No hay OC aprobadas ni facturas registradas en el período
                  seleccionado.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent Requests */}
      <Collapsible
        open={recentRequestsOpen}
        onOpenChange={setRecentRequestsOpen}
      >
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Requisiciones recientes
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    recentRequestsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <button
              type="button"
              onClick={() => setLocation("/solicitudes")}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Ver todas <ArrowRight className="h-3 w-3" />
            </button>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              {(stats.recentRequests || []).length > 0 ? (
                <div className="space-y-2">
                  {stats.recentRequests.map((r: any) => (
                    <div
                      key={r.request.id}
                      className="flex items-center justify-between py-2 border-b border-border last:border-0 cursor-pointer hover:bg-muted/30 px-2 -mx-2 transition-colors"
                      onClick={() =>
                        setLocation(`/solicitudes/${r.request.id}`)
                      }
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-1 h-8 bg-primary rounded-full" />
                        <div>
                          <p className="text-sm font-medium">
                            {r.request.requestNumber}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {r.project?.name || "\u2014"}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-xs ${STATUS_BADGE_COLORS[r.request.status] || ""}`}
                      >
                        {STATUS_LABELS[r.request.status] || r.request.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No hay requisiciones recientes
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
