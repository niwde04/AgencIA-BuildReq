import { useEffect, useState, type ChangeEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  CheckCircle2,
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

type SupplierExcelIssue = {
  rowNumber?: number;
  field?: string;
  message: string;
};

type SupplierExcelPreviewRow = {
  rowNumber: number;
  supplierCode: string;
  generatedCode: boolean;
  name: string;
  rtn: string;
  email?: string | null;
  action: "insert" | "update";
};

type SupplierExcelAnalysis = {
  sheetName?: string | null;
  totalRows: number;
  validRows: number;
  insertCount: number;
  updateCount: number;
  generatedCodeCount: number;
  errors: SupplierExcelIssue[];
  warnings: SupplierExcelIssue[];
  preview: SupplierExcelPreviewRow[];
};

type SelectedSupplierExcelFile = {
  fileName: string;
  fileBase64: string;
  fileSize: number;
};

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1] ?? "" : value);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatIssue(issue: SupplierExcelIssue) {
  return issue.rowNumber ? `Fila ${issue.rowNumber}: ${issue.message}` : issue.message;
}

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
  const [supplierExcelFile, setSupplierExcelFile] =
    useState<SelectedSupplierExcelFile | null>(null);
  const [supplierExcelAnalysis, setSupplierExcelAnalysis] =
    useState<SupplierExcelAnalysis | null>(null);
  const [supplierFileReading, setSupplierFileReading] = useState(false);
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

  const analyzeSupplierExcelMutation =
    trpc.suppliers.analyzeExcelImport.useMutation({
      onSuccess: (result) => {
        setSupplierExcelAnalysis(result);
        if (result.errors.length > 0) {
          toast.error("El archivo tiene errores por corregir");
          return;
        }
        toast.success(
          `Archivo analizado: ${result.totalRows.toLocaleString("es-HN")} proveedores`
        );
      },
      onError: (error) => toast.error(error.message),
    });

  const importSupplierExcelMutation = trpc.suppliers.importExcel.useMutation({
    onSuccess: async (result) => {
      setSupplierExcelAnalysis(result);
      toast.success(
        `Proveedores cargados: ${result.inserted.toLocaleString("es-HN")} nuevos, ${result.updated.toLocaleString("es-HN")} actualizados`
      );
      await utils.suppliers.list.invalidate();
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
    projectsTsv.trim().length > 0 || articlesTsv.trim().length > 0;

  const hasDemoData = Boolean(status?.hasDemoData);
  const importInProgress =
    latestImport?.status === "queued" || latestImport?.status === "running";
  const supplierExcelBusy =
    supplierFileReading ||
    analyzeSupplierExcelMutation.isPending ||
    importSupplierExcelMutation.isPending;

  const analyzeSupplierExcel = () => {
    if (!supplierExcelFile) return;
    analyzeSupplierExcelMutation.mutate({
      fileName: supplierExcelFile.fileName,
      fileBase64: supplierExcelFile.fileBase64,
    });
  };

  const importSupplierExcel = () => {
    if (!supplierExcelFile || !supplierExcelAnalysis) return;
    if (supplierExcelAnalysis.errors.length > 0) return;
    importSupplierExcelMutation.mutate({
      fileName: supplierExcelFile.fileName,
      fileBase64: supplierExcelFile.fileBase64,
    });
  };

  const handleSupplierFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    setSupplierExcelAnalysis(null);
    setSupplierExcelFile(null);

    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Seleccione un archivo .xlsx");
      event.target.value = "";
      return;
    }

    try {
      setSupplierFileReading(true);
      setSupplierExcelFile({
        fileName: file.name,
        fileBase64: await readFileAsBase64(file),
        fileSize: file.size,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo leer el archivo");
      event.target.value = "";
    } finally {
      setSupplierFileReading(false);
    }
  };

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
            Pegue tablas copiadas desde Excel para cargar proyectos y articulos
            de prueba. Los proveedores se cargan como catalogo real desde un
            archivo Excel. El rol tecnico actual que actua como Super Admin es{" "}
            <span className="font-mono">admin</span>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              importMutation.mutate({
                projectsTsv: projectsTsv || undefined,
                articlesTsv: articlesTsv || undefined,
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
            Copie las celdas desde Excel y pegue proyectos o articulos en su
            seccion. Los articulos tambien alimentan el catalogo SAP usado en
            autocompletado. Los proveedores se analizan desde archivo antes de
            importarse al catalogo real.
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
              Se usa un archivo .xlsx con nombre, RTN, direccion, correo,
              retencion y pagos a cuenta.
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
            <CardTitle>Archivo de Proveedores</CardTitle>
            <CardDescription>
              Suba la plantilla .xlsx de proveedores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleSupplierFileChange}
                disabled={supplierExcelBusy}
              />
              {supplierExcelFile && (
                <p className="text-xs text-muted-foreground">
                  {supplierExcelFile.fileName} · {formatFileSize(supplierExcelFile.fileSize)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={analyzeSupplierExcel}
                disabled={!supplierExcelFile || supplierExcelBusy}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {analyzeSupplierExcelMutation.isPending
                  ? "Analizando..."
                  : "Analizar archivo"}
              </Button>
              <Button
                className="gap-2"
                onClick={importSupplierExcel}
                disabled={
                  !supplierExcelFile ||
                  !supplierExcelAnalysis ||
                  supplierExcelAnalysis.errors.length > 0 ||
                  supplierExcelBusy
                }
              >
                <Upload className="h-4 w-4" />
                {importSupplierExcelMutation.isPending
                  ? "Importando..."
                  : "Importar proveedores"}
              </Button>
            </div>

            {supplierExcelAnalysis && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4 xl:grid-cols-2">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="font-semibold">
                      {supplierExcelAnalysis.totalRows.toLocaleString("es-HN")}
                    </p>
                    <p className="text-xs text-muted-foreground">filas</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="font-semibold">
                      {supplierExcelAnalysis.insertCount.toLocaleString("es-HN")}
                    </p>
                    <p className="text-xs text-muted-foreground">nuevos</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="font-semibold">
                      {supplierExcelAnalysis.updateCount.toLocaleString("es-HN")}
                    </p>
                    <p className="text-xs text-muted-foreground">actualizados</p>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="font-semibold">
                      {supplierExcelAnalysis.generatedCodeCount.toLocaleString("es-HN")}
                    </p>
                    <p className="text-xs text-muted-foreground">codigos</p>
                  </div>
                </div>

                {supplierExcelAnalysis.errors.length > 0 ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                    <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
                      <AlertCircle className="h-4 w-4" />
                      Errores
                    </div>
                    <ul className="space-y-1 text-destructive">
                      {supplierExcelAnalysis.errors.slice(0, 8).map((issue, index) => (
                        <li key={`${issue.message}-${index}`}>
                          {formatIssue(issue)}
                        </li>
                      ))}
                    </ul>
                    {supplierExcelAnalysis.errors.length > 8 && (
                      <p className="mt-2 text-xs text-destructive">
                        {supplierExcelAnalysis.errors.length - 8} errores adicionales.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4" />
                      Archivo listo para importar
                    </div>
                  </div>
                )}

                {supplierExcelAnalysis.warnings.length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="mb-2 flex items-center gap-2 font-medium">
                      <AlertCircle className="h-4 w-4 text-primary" />
                      Advertencias
                    </div>
                    <ul className="space-y-1 text-muted-foreground">
                      {supplierExcelAnalysis.warnings.slice(0, 8).map((issue, index) => (
                        <li key={`${issue.message}-${index}`}>
                          {formatIssue(issue)}
                        </li>
                      ))}
                    </ul>
                    {supplierExcelAnalysis.warnings.length > 8 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {supplierExcelAnalysis.warnings.length - 8} advertencias adicionales.
                      </p>
                    )}
                  </div>
                )}

                {supplierExcelAnalysis.preview.length > 0 && (
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th className="p-2 font-medium">Codigo</th>
                          <th className="p-2 font-medium">Proveedor</th>
                          <th className="p-2 font-medium">RTN</th>
                          <th className="p-2 font-medium">Accion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierExcelAnalysis.preview.map(row => (
                          <tr key={`${row.rowNumber}-${row.supplierCode}`} className="border-t">
                            <td className="p-2 font-mono">
                              {row.supplierCode}
                              {row.generatedCode && (
                                <span className="ml-1 text-muted-foreground">*</span>
                              )}
                            </td>
                            <td className="max-w-[160px] truncate p-2">{row.name}</td>
                            <td className="p-2">{row.rtn}</td>
                            <td className="p-2">
                              {row.action === "insert" ? "Nuevo" : "Actualizar"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
