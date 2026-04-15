import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Database,
  FileSpreadsheet,
  FolderKanban,
  ShieldCheck,
  Trash2,
  Truck,
  Upload,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

const PROJECTS_PLACEHOLDER = `Codigo de proyecto\tNombre de proyecto
001\tOFICINA CENTRAL
004\tCA5 - MANTENIMIENTO RUTINARIO`;

const ARTICLES_PLACEHOLDER = `Numero de articulo\tCodigo de almacen\tNombre de almacen\tDescripcion del articulo\tDescripcion del articulo (sin recortar)\tFecha capitalizacion (AF)\tEn stock
10188\t010\tSAN JOSE\tCEMENTO EN SACO 42.5KG ARGOS\tCEMENTO EN SACO 42.5KG ARGOS\t\t0`;

const SUPPLIERS_PLACEHOLDER = `Codigo SN\tNombre SN\tCodigo de grupo\tNombre de grupo
PL-0666\tABCO HONDURAS SA DE CV\t186\tMANTENIMIENTO, REPARACIONES E INSTALACION`;

function buildImportSummaryMessage(result: any) {
  const parts = [
    `${result.projects.inserted + result.projects.updated} proyectos`,
    `${result.articles.inserted + result.articles.updated} articulos SAP`,
    `${result.inventoryRows.inserted + result.inventoryRows.updated} filas de inventario`,
    `${result.suppliers.inserted + result.suppliers.updated} proveedores`,
  ];

  const skipped =
    result.projects.skipped +
    result.articles.skipped +
    result.inventoryRows.skipped +
    result.suppliers.skipped;

  return skipped > 0
    ? `Carga demo completada: ${parts.join(", ")}. ${skipped} filas se omitieron por conflicto con datos manuales.`
    : `Carga demo completada: ${parts.join(", ")}.`;
}

function buildClearSummaryMessage(result: any) {
  return `Se eliminaron ${result.projects} proyectos, ${result.articles} articulos SAP, ${result.inventoryRows} filas de inventario y ${result.suppliers} proveedores demo.`;
}

export default function DatosDemo() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [projectsTsv, setProjectsTsv] = useState("");
  const [articlesTsv, setArticlesTsv] = useState("");
  const [suppliersTsv, setSuppliersTsv] = useState("");
  const [handledJobId, setHandledJobId] = useState<string | null>(null);
  const [hydratedLatestJob, setHydratedLatestJob] = useState(false);

  const { data: status, isLoading } = trpc.demoData.status.useQuery(undefined, {
    retry: false,
    enabled: user?.role === "admin",
  });

  const latestImportQuery = trpc.demoData.latestImport.useQuery(undefined, {
    retry: false,
    enabled: user?.role === "admin",
    refetchInterval: 1500,
  });
  const latestImport = latestImportQuery.data;

  const importMutation = trpc.demoData.import.useMutation({
    onSuccess: async (result) => {
      setHandledJobId(null);
      toast.success(
        `Carga iniciada. Se procesaran ${result.totalRows.toLocaleString("es-HN")} filas por lotes.`
      );
      await utils.demoData.latestImport.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const clearMutation = trpc.demoData.clear.useMutation({
    onSuccess: async (result) => {
      toast.success(buildClearSummaryMessage(result));
      await Promise.all([
        utils.demoData.status.invalidate(),
        utils.demoData.latestImport.invalidate(),
        utils.projects.invalidate(),
        utils.inventory.invalidate(),
        utils.requestItems.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!latestImportQuery.isFetched || hydratedLatestJob) return;

    if (
      latestImport &&
      (latestImport.status === "completed" || latestImport.status === "failed")
    ) {
      setHandledJobId(latestImport.id);
    }

    setHydratedLatestJob(true);
  }, [hydratedLatestJob, latestImport, latestImportQuery.isFetched]);

  useEffect(() => {
    if (!latestImport) return;
    if (latestImport.id === handledJobId) return;

    if (latestImport.status === "completed" && latestImport.result) {
      setHandledJobId(latestImport.id);
      setProjectsTsv("");
      setArticlesTsv("");
      setSuppliersTsv("");
      toast.success(buildImportSummaryMessage(latestImport.result));
      void Promise.all([
        utils.demoData.status.invalidate(),
        utils.projects.invalidate(),
        utils.inventory.invalidate(),
        utils.requestItems.invalidate(),
      ]);
      return;
    }

    if (latestImport.status === "failed") {
      setHandledJobId(latestImport.id);
      toast.error(latestImport.error || "La importacion demo fallo");
    }
  }, [handledJobId, latestImport, utils]);

  if (user?.role !== "admin") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>
            Este modulo solo esta disponible para el Super Admin.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasInput =
    projectsTsv.trim().length > 0 ||
    articlesTsv.trim().length > 0 ||
    suppliersTsv.trim().length > 0;

  const hasDemoData = Boolean(status?.hasDemoData);
  const importInProgress =
    latestImport?.status === "queued" || latestImport?.status === "running";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1>Datos Demo</h1>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              Solo Super Admin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Pegue tablas copiadas desde Excel para cargar proyectos, articulos y
            proveedores de prueba. El rol tecnico actual que actua como Super
            Admin es <span className="font-mono">admin</span>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              importMutation.mutate({
                projectsTsv: projectsTsv || undefined,
                articlesTsv: articlesTsv || undefined,
                suppliersTsv: suppliersTsv || undefined,
              })
            }
            disabled={!hasInput || importMutation.isPending || importInProgress}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending || importInProgress
              ? "Procesando..."
              : "Cargar datos demo"}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive"
                disabled={!hasDemoData || clearMutation.isPending || importInProgress}
              >
                <Trash2 className="h-4 w-4" />
                {clearMutation.isPending ? "Borrando..." : "Borrar datos demo"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Borrar informacion demo</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta accion eliminara solo los registros cargados desde este
                  modulo. Los datos creados manualmente se conservaran.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => clearMutation.mutate()}
                >
                  Si, borrar demo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {latestImport && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Progreso de Importacion</span>
              <Badge
                variant={
                  latestImport.status === "completed"
                    ? "default"
                    : latestImport.status === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {latestImport.status === "queued" && "En cola"}
                {latestImport.status === "running" && "En progreso"}
                {latestImport.status === "completed" && "Completada"}
                {latestImport.status === "failed" && "Fallida"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {latestImport.stageLabel}. {latestImport.processedRows.toLocaleString("es-HN")} de{" "}
              {latestImport.totalRows.toLocaleString("es-HN")} filas procesadas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={latestImport.percent} className="h-3" />
            <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <p>{latestImport.percent}% completado</p>
              <p>
                Etapa actual: {latestImport.currentStageProcessed.toLocaleString("es-HN")} /{" "}
                {latestImport.currentStageTotal.toLocaleString("es-HN")}
              </p>
            </div>
            {latestImport.status === "failed" && latestImport.error && (
              <p className="text-sm text-destructive">{latestImport.error}</p>
            )}
            {latestImport.status === "completed" && latestImport.result && (
              <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-medium text-foreground">
                    {latestImport.result.projects.inserted +
                      latestImport.result.projects.updated}
                  </p>
                  <p>proyectos</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-medium text-foreground">
                    {latestImport.result.articles.inserted +
                      latestImport.result.articles.updated}
                  </p>
                  <p>articulos SAP</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-medium text-foreground">
                    {latestImport.result.inventoryRows.inserted +
                      latestImport.result.inventoryRows.updated}
                  </p>
                  <p>filas inventario</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="font-medium text-foreground">
                    {latestImport.result.suppliers.inserted +
                      latestImport.result.suppliers.updated}
                  </p>
                  <p>proveedores</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderKanban className="h-4 w-4 text-primary" />
              Proyectos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : status?.projects ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">registros demo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-primary" />
              Catalogo SAP
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : status?.articles ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">articulos demo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Warehouse className="h-4 w-4 text-primary" />
              Inventario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : status?.inventoryRows ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">
              filas demo por almacen
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4 text-primary" />
              Proveedores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">
              {isLoading ? "..." : status?.suppliers ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">registros demo</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Como cargar desde Excel
          </CardTitle>
          <CardDescription>
            Copie las celdas desde Excel y pegue cada bloque en su seccion.
            Puede cargar solo una tabla o varias a la vez. Los articulos tambien
            alimentan el catalogo SAP usado en autocompletado.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium text-foreground">Proyectos</p>
            <p>Se usan las columnas de codigo y nombre.</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium text-foreground">Articulos</p>
            <p>
              Se usa el numero de articulo, almacen, descripcion y stock. Cada
              fila crea o actualiza una ubicacion de inventario.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="font-medium text-foreground">Proveedores</p>
            <p>
              Se usan el codigo SN y el nombre. Las columnas de grupo se
              ignoran por ahora.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-h-[360px]">
          <CardHeader>
            <CardTitle>Excel de Proyectos</CardTitle>
            <CardDescription>
              Pegue aqui la tabla de proyectos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={projectsTsv}
              onChange={(event) => setProjectsTsv(event.target.value)}
              placeholder={PROJECTS_PLACEHOLDER}
              className="min-h-[240px] font-mono text-xs"
              disabled={importInProgress}
            />
          </CardContent>
        </Card>

        <Card className="min-h-[360px]">
          <CardHeader>
            <CardTitle>Excel de Articulos</CardTitle>
            <CardDescription>
              Pegue aqui la tabla de articulos o existencias por almacen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={articlesTsv}
              onChange={(event) => setArticlesTsv(event.target.value)}
              placeholder={ARTICLES_PLACEHOLDER}
              className="min-h-[240px] font-mono text-xs"
              disabled={importInProgress}
            />
          </CardContent>
        </Card>

        <Card className="min-h-[360px]">
          <CardHeader>
            <CardTitle>Excel de Proveedores</CardTitle>
            <CardDescription>
              Pegue aqui la tabla de proveedores.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={suppliersTsv}
              onChange={(event) => setSuppliersTsv(event.target.value)}
              placeholder={SUPPLIERS_PLACEHOLDER}
              className="min-h-[240px] font-mono text-xs"
              disabled={importInProgress}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
