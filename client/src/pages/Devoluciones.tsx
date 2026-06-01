import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreditCard, Eye, Plus, Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { getPrintLogoMarkup, printWindowWhenReady } from "@/lib/print-logo";

const RETURN_TYPE_LABELS: Record<string, string> = {
  devolucion_bodega_proyecto: "Devolución a Bodega de Proyecto",
  devolucion_bodega_central: "Devolución a Bodega Central",
  devolucion_entre_proyectos: "Devolución entre Proyectos",
  devolucion_proveedor: "Devolución a Proveedor",
};

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  en_transito: "En tránsito",
  recibida: "Recibida",
  rechazada: "Rechazada",
};

const STATUS_COLORS: Record<string, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-700",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  en_transito: "border-blue-300 bg-blue-50 text-blue-700",
  recibida: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rechazada: "border-rose-300 bg-rose-50 text-rose-700",
};

const REASON_LABELS: Record<string, string> = {
  material_defectuoso: "Material defectuoso",
  excedente: "Excedente",
  error_pedido: "Error de pedido",
  cambio_especificacion: "Cambio de especificación",
  otro: "Otro",
};

const CONDITION_LABELS: Record<string, string> = {
  nuevo: "Nuevo",
  usado_buen_estado: "Usado - Buen estado",
  defectuoso: "Defectuoso",
  danado: "Dañado",
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

function formatQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return numberValue.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function Devoluciones() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedReturnId, setSelectedReturnId] = useState<number | null>(null);
  const [creditNoteReturnId, setCreditNoteReturnId] = useState<number | null>(
    null
  );

  const userRole = (user as any)?.buildreqRole || "";
  const isAdmin = user?.role === "admin";
  const canCreateReturn = userRole === "jefe_bodega_central" || isAdmin;

  const { data: returns, isLoading } = trpc.reverseLogistics.list.useQuery(
    {
      ...(typeFilter !== "all" ? { returnType: typeFilter } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    }
  );
  const { data: detail, isLoading: isDetailLoading } =
    trpc.reverseLogistics.getById.useQuery(
      { id: selectedReturnId ?? 0 },
      { enabled: Boolean(selectedReturnId) }
    );

  const selectedReturn = detail?.return;
  const sourceProject = detail?.sourceProject;
  const sourceWarehouse = detail?.sourceWarehouse;
  const sourceReceipt = detail?.sourceReceipt;
  const returnItems = detail?.items ?? [];
  const sourceWarehouseLabel =
    sourceWarehouse?.displayName ??
    (sourceProject
      ? `Bodega del Proyecto - ${sourceProject.code} - ${sourceProject.name}`
      : "-");
  const canGenerateCreditNote =
    canCreateReturn &&
    selectedReturn?.returnType === "devolucion_proveedor" &&
    selectedReturn.status === "pendiente" &&
    !selectedReturn.sapDocumentNumber;

  const filteredReturns = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (returns ?? []).filter((row: any) => {
      if (!normalizedSearch) return true;
      const returnRow = row.return;
      const sourceProjectLabel = row.sourceProject
        ? `${row.sourceProject.code} ${row.sourceProject.name}`
        : "";

      return [
        returnRow.returnNumber,
        RETURN_TYPE_LABELS[returnRow.returnType],
        REASON_LABELS[returnRow.reasonCategory],
        STATUS_LABELS[returnRow.status],
        returnRow.supplierName,
        sourceProjectLabel,
      ]
        .filter(Boolean)
        .some(value =>
          String(value).toLowerCase().includes(normalizedSearch)
        );
    });
  }, [returns, searchTerm]);

  const generateCreditNoteMutation =
    trpc.reverseLogistics.generateCreditNote.useMutation({
      onSuccess: result => {
        toast.success(`Nota de crédito ${result.sapDocumentNumber} generada`);
        setCreditNoteReturnId(null);
        void utils.reverseLogistics.list.invalidate();
        if (selectedReturnId) {
          void utils.reverseLogistics.getById.invalidate({ id: selectedReturnId });
        }
      },
      onError: error => toast.error(error.message),
    });

  const handlePrintReturn = () => {
    if (!selectedReturn) return;

    const sourceProjectLabel = sourceProject
      ? `${sourceProject.code} - ${sourceProject.name}`
      : "-";
    const printedAt = new Date().toLocaleString("es-HN");
    const documentLabel =
      selectedReturn.returnType === "devolucion_proveedor"
        ? selectedReturn.sapDocumentNumber || "Pendiente de generar"
        : selectedReturn.sapDocumentNumber || "-";
    const sourceDocumentNumber =
      sourceReceipt?.invoiceNumber || selectedReturn.sapDocumentNumber || "-";
    const subtitle =
      selectedReturn.returnType === "devolucion_proveedor" &&
      selectedReturn.sapDocumentNumber
        ? "Nota de crédito interna / devolución a proveedor"
        : "Comprobante de devolución / logística inversa";
    const itemRows = returnItems
      .map(
        (item: any) => `
          <tr>
            <td>${escapeHtml(item.sapItemCode || "-")}</td>
            <td>${escapeHtml(item.itemName)}</td>
            <td class="numeric">${escapeHtml(formatQuantity(item.quantity))}</td>
            <td>${escapeHtml(item.unit || "-")}</td>
            <td>${escapeHtml(CONDITION_LABELS[item.condition] || item.condition)}</td>
            <td>${escapeHtml(item.notes || "-")}</td>
          </tr>
        `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(selectedReturn.returnNumber)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              color: #111;
              font-family: Arial, sans-serif;
              font-size: 12px;
              margin: 32px;
            }
            header {
              align-items: flex-start;
              border-bottom: 1px solid #d9d9d9;
              display: grid;
              gap: 18px;
              grid-template-columns: 112px 1fr auto;
              margin-bottom: 20px;
              padding-bottom: 16px;
            }
            .logo {
              display: block;
              height: 76px;
              object-fit: contain;
              width: 110px;
            }
            h1 { font-size: 26px; margin: 0 0 6px; }
            h2 {
              font-size: 13px;
              letter-spacing: 0.06em;
              margin: 22px 0 10px;
              text-transform: uppercase;
            }
            .muted { color: #666; }
            .status {
              border: 1px solid #bdbdbd;
              display: inline-block;
              font-size: 11px;
              margin-left: 8px;
              padding: 3px 8px;
            }
            .grid {
              display: grid;
              gap: 10px;
              grid-template-columns: repeat(4, 1fr);
            }
            .box {
              border: 1px solid #d8d8d8;
              min-height: 70px;
              padding: 12px;
            }
            .label {
              color: #666;
              font-size: 10px;
              font-weight: 700;
              letter-spacing: 0.06em;
              margin-bottom: 8px;
              text-transform: uppercase;
            }
            .value { font-size: 13px; font-weight: 600; line-height: 1.35; }
            .justification {
              border: 1px solid #d8d8d8;
              line-height: 1.5;
              min-height: 72px;
              padding: 12px;
              white-space: pre-wrap;
            }
            table {
              border-collapse: collapse;
              margin-top: 8px;
              width: 100%;
            }
            th, td {
              border: 1px solid #d8d8d8;
              padding: 9px;
              text-align: left;
              vertical-align: top;
            }
            th {
              background: #f4f4f4;
              color: #555;
              font-size: 10px;
              letter-spacing: 0.06em;
              text-transform: uppercase;
            }
            .numeric {
              font-family: Consolas, monospace;
              text-align: right;
            }
            @media print {
              body { margin: 18mm; }
            }
          </style>
        </head>
        <body>
          <header>
            ${getPrintLogoMarkup()}
            <div>
              <h1>
                ${escapeHtml(selectedReturn.returnNumber)}
                <span class="status">${escapeHtml(STATUS_LABELS[selectedReturn.status])}</span>
              </h1>
              <div class="muted">${escapeHtml(subtitle)}</div>
            </div>
            <div class="muted">Impreso: ${escapeHtml(printedAt)}</div>
          </header>

          <section class="grid">
            <div class="box">
              <div class="label">Tipo</div>
              <div class="value">${escapeHtml(RETURN_TYPE_LABELS[selectedReturn.returnType])}</div>
            </div>
            <div class="box">
              <div class="label">Motivo</div>
              <div class="value">${escapeHtml(REASON_LABELS[selectedReturn.reasonCategory])}</div>
            </div>
            <div class="box">
              <div class="label">Proyecto</div>
              <div class="value">${escapeHtml(sourceProjectLabel)}</div>
            </div>
            <div class="box">
              <div class="label">Fecha</div>
              <div class="value">${escapeHtml(formatDate(selectedReturn.createdAt))}</div>
            </div>
            <div class="box">
              <div class="label">Bodega origen</div>
              <div class="value">${escapeHtml(sourceWarehouseLabel)}</div>
            </div>
            <div class="box">
              <div class="label">Proveedor</div>
              <div class="value">${escapeHtml(selectedReturn.supplierName || "-")}</div>
            </div>
            <div class="box">
              <div class="label">Nota de crédito</div>
              <div class="value">${escapeHtml(documentLabel)}</div>
            </div>
            <div class="box">
              <div class="label">Procesada</div>
              <div class="value">${escapeHtml(formatDate(selectedReturn.processedAt))}</div>
            </div>
            <div class="box">
              <div class="label">Número documento</div>
              <div class="value">${escapeHtml(sourceDocumentNumber)}</div>
            </div>
            <div class="box">
              <div class="label">CAI</div>
              <div class="value">${escapeHtml(sourceReceipt?.cai || "-")}</div>
            </div>
            <div class="box">
              <div class="label">Fecha documento</div>
              <div class="value">${escapeHtml(formatDate(sourceReceipt?.documentDate))}</div>
            </div>
            <div class="box">
              <div class="label">Fecha vencimiento</div>
              <div class="value">${escapeHtml(formatDate(sourceReceipt?.documentDueDate))}</div>
            </div>
            <div class="box">
              <div class="label">Fecha recepción</div>
              <div class="value">${escapeHtml(formatDate(sourceReceipt?.receiptDate))}</div>
            </div>
          </section>

          <h2>Justificación</h2>
          <div class="justification">${escapeHtml(selectedReturn.justification)}</div>

          <h2>Ítems devueltos</h2>
          <table>
            <thead>
              <tr>
                <th>Código SAP</th>
                <th>Ítem</th>
                <th>Cant.</th>
                <th>Unidad</th>
                <th>Condición</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindowWhenReady(printWindow);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Logística Inversa</h1>
        {canCreateReturn && (
          <Button onClick={() => setLocation("/devoluciones/nueva")} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Nueva Devolución
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por devolución, tipo, motivo, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Tipo de devolución" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="devolucion_bodega_proyecto">
              A Bodega de Proyecto
            </SelectItem>
            <SelectItem value="devolucion_bodega_central">
              A Bodega Central
            </SelectItem>
            <SelectItem value="devolucion_entre_proyectos">
              Entre Proyectos
            </SelectItem>
            <SelectItem value="devolucion_proveedor">
              A Proveedor
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue placeholder="Estatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estatus</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="aprobada">Aprobada</SelectItem>
            <SelectItem value="en_transito">En tránsito</SelectItem>
            <SelectItem value="recibida">Recibida</SelectItem>
            <SelectItem value="rechazada">Rechazada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando devoluciones...
            </div>
          ) : (returns || []).length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No se encontraron devoluciones
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay devoluciones que coincidan con los filtros
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      No. Devolución
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Tipo
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Motivo
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="text-left p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="text-right p-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReturns.map((r: any) => (
                    <tr
                      key={r.return.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-3 font-medium">
                        {r.return.returnNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {RETURN_TYPE_LABELS[r.return.returnType]}
                      </td>
                      <td className="p-3 text-xs">
                        {REASON_LABELS[r.return.reasonCategory]}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${
                            STATUS_COLORS[r.return.status] || ""
                          }`}
                        >
                          {STATUS_LABELS[r.return.status]}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatDate(r.return.createdAt)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedReturnId(r.return.id)}
                          aria-label={`Ver devolución ${r.return.returnNumber}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedReturnId)}
        onOpenChange={(open) => {
          if (!open) setSelectedReturnId(null);
        }}
      >
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-5xl sm:p-6">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <DialogTitle className="flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight">
                  {selectedReturn?.returnNumber || "Devolución"}
                  {selectedReturn && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        STATUS_COLORS[selectedReturn.status] || ""
                      }`}
                    >
                      {STATUS_LABELS[selectedReturn.status]}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  Detalle de logística inversa y sus ítems asociados.
                </DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canGenerateCreditNote ? (
                  <Button
                    size="sm"
                    onClick={() => setCreditNoteReturnId(selectedReturn.id)}
                    disabled={generateCreditNoteMutation.isPending}
                    className="w-fit"
                  >
                    <CreditCard className="mr-2 h-4 w-4" />
                    Generar nota de crédito
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrintReturn}
                  disabled={!selectedReturn || isDetailLoading}
                  className="w-fit"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir
                </Button>
              </div>
            </div>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando detalle...
            </div>
          ) : !selectedReturn ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No se pudo cargar la devolución.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tipo
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {RETURN_TYPE_LABELS[selectedReturn.returnType]}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Motivo
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {REASON_LABELS[selectedReturn.reasonCategory]}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Proyecto
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {sourceProject
                      ? `${sourceProject.code} - ${sourceProject.name}`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fecha
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatDate(selectedReturn.createdAt)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Bodega origen
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {sourceWarehouseLabel}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Proveedor
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedReturn.supplierName || "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Nota de crédito
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedReturn.returnType === "devolucion_proveedor"
                      ? selectedReturn.sapDocumentNumber ||
                        "Pendiente de generar"
                      : selectedReturn.sapDocumentNumber || "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Procesada
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatDate(selectedReturn.processedAt)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Número documento
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {sourceReceipt?.invoiceNumber ||
                      selectedReturn.sapDocumentNumber ||
                      "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    CAI
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {sourceReceipt?.cai || "-"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fecha documento
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatDate(sourceReceipt?.documentDate)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fecha vencimiento
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatDate(sourceReceipt?.documentDueDate)}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fecha recepción
                  </p>
                  <p className="mt-2 text-sm font-medium">
                    {formatDate(sourceReceipt?.receiptDate)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Justificación
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {selectedReturn.justification}
                </p>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código SAP
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cant.
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Unidad
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Condición
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Notas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnItems.map((item: any) => (
                      <tr
                        key={item.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="p-3 font-mono text-xs">
                          {item.sapItemCode || "-"}
                        </td>
                        <td className="p-3 font-medium">{item.itemName}</td>
                        <td className="p-3 text-right font-mono">
                          {formatQuantity(item.quantity)}
                        </td>
                        <td className="p-3 text-xs">{item.unit || "-"}</td>
                        <td className="p-3 text-xs">
                          {CONDITION_LABELS[item.condition] || item.condition}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {item.notes || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(creditNoteReturnId)}
        onOpenChange={open => {
          if (!open) setCreditNoteReturnId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generar nota de crédito</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción descontará del inventario del proyecto los ítems de
              la devolución y marcará el documento como aprobado con número de
              nota de crédito. No se puede repetir para la misma devolución.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generateCreditNoteMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                generateCreditNoteMutation.isPending || !creditNoteReturnId
              }
              onClick={event => {
                event.preventDefault();
                if (!creditNoteReturnId) return;
                generateCreditNoteMutation.mutate({ id: creditNoteReturnId });
              }}
            >
              {generateCreditNoteMutation.isPending
                ? "Generando..."
                : "Generar nota"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
