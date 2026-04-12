import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList,
  FolderKanban,
  RotateCcw,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { useLocation } from "wouter";
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
  en_espera: "#f59e0b",
  en_proceso: "#3b82f6",
  cerrada: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  en_espera: "En espera",
  en_proceso: "En proceso",
  cerrada: "Cerrada",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  en_espera: "border-amber-300 text-amber-700 bg-amber-50",
  en_proceso: "border-blue-300 text-blue-700 bg-blue-50",
  cerrada: "border-gray-300 text-gray-600 bg-gray-50",
};

const FLOW_LABELS: Record<string, string> = {
  compra_directa: "Compra Directa",
  despacho_bodega: "Despacho Bodega",
  traslado_proyecto: "Traslado",
  solicitud_compra: "Solicitud Compra",
};

const FLOW_COLORS = ["#dc2626", "#991b1b", "#ef4444", "#b91c1c"];

export default function Dashboard() {
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1>Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
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
        <p className="text-muted-foreground">No se pudieron cargar las estadísticas</p>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Dashboard</h1>
        <div className="w-8 h-8 bg-primary" />
      </div>

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
                  Total Solicitudes
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
                <p className="text-3xl font-bold mt-1">{stats.totalActiveProjects}</p>
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
                <p className="text-3xl font-bold mt-1">{stats.pendingReturns}</p>
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
              Solicitudes por Estatus
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
              Solicitudes por Proyecto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={projectData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#737373" />
                <YAxis tick={{ fontSize: 12 }} stroke="#737373" />
                <Tooltip />
                <Bar dataKey="solicitudes" fill="#dc2626" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Requests */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Solicitudes Recientes
          </CardTitle>
          <button
            onClick={() => setLocation("/solicitudes")}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            Ver todas <ArrowRight className="h-3 w-3" />
          </button>
        </CardHeader>
        <CardContent>
          {(stats.recentRequests || []).length > 0 ? (
            <div className="space-y-2">
              {stats.recentRequests.map((r: any) => (
                <div
                  key={r.request.id}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0 cursor-pointer hover:bg-muted/30 px-2 -mx-2 transition-colors"
                  onClick={() => setLocation(`/solicitudes/${r.request.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-8 bg-primary rounded-full" />
                    <div>
                      <p className="text-sm font-medium">{r.request.requestNumber}</p>
                      <p className="text-xs text-muted-foreground">{r.project?.name || "\u2014"}</p>
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
              No hay solicitudes recientes
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
