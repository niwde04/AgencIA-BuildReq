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
import {
  ClipboardList,
  CreditCard,
  Eye,
  FileText,
  Package,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Truck,
  Warehouse,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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

const TRANSFER_REQUEST_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  convertida: "Convertida",
  anulada: "Anulada",
};

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmado: "Confirmado",
  en_transito: "En tránsito",
  parcialmente_recibido: "Parcialmente recibido",
  recibido: "Recibido",
  cerrado_incompleto: "Cerrado incompleto",
  anulado: "Anulado",
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

function formatPrintNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return parsed.toLocaleString("es-HN", {
    minimumFractionDigits: Number.isInteger(parsed) ? 0 : 2,
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

function DetailField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0 border-l border-border/70 pl-4 first:border-l-0 first:pl-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 min-h-5 text-sm font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border/70 bg-muted/20 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
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
  const destinationProject = (detail as any)?.destinationProject;
  const destinationWarehouse = (detail as any)?.destinationWarehouse;
  const sourceWarehouse = detail?.sourceWarehouse;
  const sourceReceipt = detail?.sourceReceipt;
  const createdBy = (detail as any)?.createdBy;
  const returnItems = detail?.items ?? [];
  const linkedTransfers = (detail as any)?.linkedTransfers ?? [];
  const hasActiveLinkedTransfer = linkedTransfers.some((row: any) =>
    ["pendiente", "aprobada", "convertida"].includes(
      row.transferRequest?.status
    )
  );
  const itemSourceWarehouse = returnItems.find((item: any) => item.warehouse)
    ?.warehouse;
  const sourceWarehouseLabel =
    itemSourceWarehouse?.displayName ??
    sourceWarehouse?.displayName ??
    (sourceProject
      ? `Bodega del Proyecto - ${sourceProject.code} - ${sourceProject.name}`
      : "-");
  const destinationProjectLabel = destinationProject
    ? `${destinationProject.code} - ${destinationProject.name}`
    : selectedReturn?.destinationProjectId
      ? `Proyecto ${selectedReturn.destinationProjectId}`
      : "-";
  const destinationWarehouseLabel =
    destinationWarehouse?.displayName ??
    destinationWarehouse?.name ??
    (selectedReturn?.destinationWarehouseId
      ? `Bodega #${selectedReturn.destinationWarehouseId}`
      : "-");
  const createdByLabel =
    createdBy?.name || createdBy?.email || `Usuario #${selectedReturn?.createdById ?? "-"}`;
  const receivedByLabel = selectedReturn?.receivedByName?.trim() || "-";
  const canGenerateCreditNote =
    canCreateReturn &&
    selectedReturn?.returnType === "devolucion_proveedor" &&
    selectedReturn.status === "pendiente" &&
    !selectedReturn.sapDocumentNumber;
  const canCreateReturnTransfer =
    canCreateReturn &&
    selectedReturn &&
    ["devolucion_bodega_central", "devolucion_entre_proyectos"].includes(
      selectedReturn.returnType
    ) &&
    selectedReturn.status === "pendiente" &&
    !hasActiveLinkedTransfer;

  const filteredReturns = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (returns ?? []).filter((row: any) => {
      if (!normalizedSearch) return true;
      const returnRow = row.return;
      const sourceProjectLabel = row.sourceProject
        ? `${row.sourceProject.code} ${row.sourceProject.name}`
        : "";
      const destinationProjectLabel = row.destinationProject
        ? `${row.destinationProject.code} ${row.destinationProject.name}`
        : "";
      const destinationWarehouseLabel =
        row.destinationWarehouse?.displayName ||
        row.destinationWarehouse?.name ||
        "";

      return [
        returnRow.returnNumber,
        RETURN_TYPE_LABELS[returnRow.returnType],
        REASON_LABELS[returnRow.reasonCategory],
        STATUS_LABELS[returnRow.status],
        returnRow.supplierName,
        sourceProjectLabel,
        destinationProjectLabel,
        destinationWarehouseLabel,
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

  const createReturnTransferMutation =
    trpc.reverseLogistics.createCentralWarehouseTransfer.useMutation({
      onSuccess: result => {
        toast.success(`Solicitud de traslado ${result.requestNumber} creada`);
        void utils.reverseLogistics.list.invalidate();
        void utils.transferRequests.list.invalidate();
        void utils.transfers.list.invalidate();
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
    const documentTypeLabel =
      selectedReturn.returnType === "devolucion_proveedor"
        ? "DEVOLUCION A PROVEEDOR"
        : "DEVOLUCION BODEGA";
    const printWarehouseTitle =
      sourceWarehouseLabel !== "-" ? sourceWarehouseLabel : sourceProjectLabel;
    const requestedByLabel = `${selectedReturn.returnNumber} - ${createdByLabel}`;
    const isProviderReturn = selectedReturn.returnType === "devolucion_proveedor";
    const isCentralReturn =
      selectedReturn.returnType === "devolucion_bodega_central";
    const isProjectWarehouseReturn =
      selectedReturn.returnType === "devolucion_bodega_proyecto";
    const isProjectTransferReturn =
      selectedReturn.returnType === "devolucion_entre_proyectos";
    const destinationLabel = isProjectTransferReturn
      ? destinationProjectLabel
      : isCentralReturn
        ? "Bodega Central"
        : isProviderReturn
          ? selectedReturn.supplierName || "Proveedor"
          : isProjectWarehouseReturn
            ? sourceProjectLabel
            : "-";
    const destinationWarehousePrintLabel = isProjectTransferReturn
      ? destinationWarehouseLabel
      : isCentralReturn
        ? "Bodega Central"
        : isProjectWarehouseReturn
          ? sourceWarehouseLabel
          : "N/A";
    const referenceLabel =
      sourceReceipt?.receiptNumber ||
      sourceReceipt?.invoiceNumber ||
      selectedReturn.sapDocumentNumber ||
      selectedReturn.returnNumber;
    const reasonLabel =
      REASON_LABELS[selectedReturn.reasonCategory] ||
      selectedReturn.reasonCategory;
    const itemRows = returnItems
      .map(
        (item: any) => `
          <tr>
            <td>${escapeHtml(item.sapItemCode || "-")}</td>
            <td>${escapeHtml(item.itemName || "-")}</td>
            <td class="center"></td>
            <td class="numeric">${escapeHtml(formatPrintNumber(item.quantity))}</td>
            <td class="center">${escapeHtml(item.unit || "-")}</td>
            <td>${escapeHtml(destinationLabel)}</td>
            <td>
              <div>${escapeHtml(item.notes || reasonLabel)}</div>
            </td>
            <td class="numeric">1</td>
          </tr>
        `
      )
      .join("");
    const totalLines = returnItems.length;

    const printWindow = window.open("", "_blank", "width=840,height=1000");
    if (!printWindow) {
      toast.error("No se pudo abrir la ventana de impresión");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(selectedReturn.returnNumber)}</title>
          <style>
            @page { size: A4 portrait; margin: 7mm; }
            * { box-sizing: border-box; }
            body {
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 9.5px;
              margin: 0;
            }
            .sheet {
              margin: 0 auto;
              max-width: 196mm;
              padding: 0 1mm 3mm;
            }
            .header {
              align-items: start;
              display: grid;
              gap: 8px;
              grid-template-columns: 82px 1fr 108px;
            }
            .logo {
              display: block;
              height: 44px;
              margin-left: 2px;
              object-fit: contain;
              width: 64px;
            }
            .title {
              color: #000;
              font-size: 11.5px;
              font-weight: 800;
              line-height: 1.25;
              text-align: center;
              text-transform: uppercase;
            }
            .company {
              color: #000;
              font-size: 13px;
              margin-bottom: 2px;
            }
            .document-number {
              border: 4px double #222;
              color: #000;
              font-size: 12px;
              font-weight: 900;
              margin-top: 1mm;
              padding: 3px 6px;
              text-align: center;
            }
            .meta {
              display: grid;
              gap: 10px;
              grid-template-columns: 1fr 1fr;
              margin-top: 6mm;
            }
            .meta-column {
              display: grid;
              gap: 3px;
            }
            .field {
              display: grid;
              gap: 4px;
              grid-template-columns: 104px 1fr;
              min-height: 12px;
            }
            .meta-column.right .field {
              grid-template-columns: 98px 1fr;
            }
            .label {
              font-weight: 800;
            }
            .value {
              font-weight: 700;
              overflow-wrap: anywhere;
            }
            .section-title {
              color: #000;
              font-size: 10px;
              font-weight: 800;
              letter-spacing: .04em;
              margin: 6mm 0 2mm;
              text-transform: uppercase;
            }
            .justification {
              border: 1px solid #111;
              line-height: 1.5;
              min-height: 14mm;
              padding: 3mm;
              white-space: pre-wrap;
            }
            table {
              border-collapse: collapse;
              margin-top: 3mm;
              table-layout: fixed;
              width: 100%;
            }
            th {
              border-bottom: 2px solid #111;
              border-top: 2px solid #111;
              color: #000;
              font-size: 8.5px;
              font-weight: 800;
              padding: 3px 4px;
              text-align: left;
              text-transform: uppercase;
            }
            td {
              border-bottom: 1px solid #111;
              color: #000;
              overflow-wrap: anywhere;
              padding: 3px 4px;
              vertical-align: top;
            }
            .code {
              font-variant-numeric: tabular-nums;
            }
            .center { text-align: center; }
            .numeric {
              font-variant-numeric: tabular-nums;
              text-align: right;
            }
            .total-row td {
              border-bottom: 2px solid #111;
              font-weight: 800;
            }
            .signatures {
              display: grid;
              gap: 22px;
              grid-template-columns: repeat(3, 150px);
              justify-content: center;
              margin-top: 10mm;
            }
            .signature-line {
              border-top: 2px solid #111;
              font-size: 10.5px;
              font-weight: 700;
              padding-top: 4px;
              text-align: center;
            }
            @media print {
              .sheet { max-width: none; padding: 0; }
            }
          </style>
        </head>
        <body>
          <main class="sheet">
            <section class="header">
              ${getPrintLogoMarkup()}
              <div class="title">
                <div class="company">HIDALGO E HIDALGO HONDURAS S.A. DE C.V.</div>
                <div>${escapeHtml(printWarehouseTitle)}</div>
                <div>${escapeHtml(documentTypeLabel)}</div>
              </div>
              <div class="document-number">${escapeHtml(selectedReturn.returnNumber)}</div>
            </section>

            <section class="meta">
              <div class="meta-column">
                <div class="field">
                  <div class="label">Fecha:</div>
                  <div class="value">${escapeHtml(formatDate(selectedReturn.createdAt))}</div>
                </div>
                <div class="field">
                  <div class="label">Solicitado por:</div>
                  <div class="value">${escapeHtml(requestedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Recibido por:</div>
                  <div class="value">${escapeHtml(receivedByLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Tipo Egreso:</div>
                  <div class="value">${escapeHtml(documentTypeLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">De Bodega:</div>
                  <div class="value">${escapeHtml(sourceWarehouseLabel)}</div>
                </div>
              </div>
              <div class="meta-column">
                <div class="field">
                  <div class="label">Job:</div>
                  <div class="value">${escapeHtml(sourceProjectLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Destino:</div>
                  <div class="value">${escapeHtml(destinationLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">Referencia:</div>
                  <div class="value">${escapeHtml(referenceLabel)}</div>
                </div>
                <div class="field">
                  <div class="label">A Bodega:</div>
                  <div class="value">${escapeHtml(destinationWarehousePrintLabel)}</div>
                </div>
              </div>
            </section>
            <table>
              <thead>
                <tr>
                  <th style="width: 16%;">Código/No. Serie</th>
                  <th>Identificador</th>
                  <th style="width: 8%;" class="center">Costo</th>
                  <th style="width: 9%;" class="numeric">Cantidad</th>
                  <th style="width: 9%;" class="center">U Medida</th>
                  <th style="width: 19%;">Destino</th>
                  <th style="width: 17%;">Referencia</th>
                  <th style="width: 7%;" class="numeric">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="8">Sin ítems</td></tr>`}
                <tr class="total-row">
                  <td colspan="7">Total general</td>
                  <td class="numeric">${escapeHtml(formatPrintNumber(totalLines))}</td>
                </tr>
              </tbody>
            </table>

            <section class="signatures">
              <div class="signature-line">Elaborado por:<br>${escapeHtml(createdByLabel)}</div>
              <div class="signature-line">Entregado a:<br>${escapeHtml(receivedByLabel)}</div>
              <div class="signature-line">Autorizado por:</div>
            </section>
          </main>
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
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl p-5 sm:w-[calc(100vw-3rem)] sm:max-w-6xl sm:p-6">
          <DialogHeader className="border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600">
                  <RotateCcw className="h-6 w-6" />
                </span>
                <div className="min-w-0 space-y-2">
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
                {canCreateReturnTransfer && selectedReturn ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      createReturnTransferMutation.mutate({
                        id: selectedReturn.id,
                      })
                    }
                    disabled={createReturnTransferMutation.isPending}
                    className="w-fit"
                  >
                    <Truck className="mr-2 h-4 w-4" />
                    {createReturnTransferMutation.isPending
                      ? "Creando..."
                      : "Crear traslado"}
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
            <div className="space-y-4 pt-1">
              <DetailSection icon={ClipboardList} title="Resumen">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <DetailField
                    label="Tipo"
                    value={RETURN_TYPE_LABELS[selectedReturn.returnType]}
                  />
                  <DetailField
                    label="Motivo"
                    value={REASON_LABELS[selectedReturn.reasonCategory]}
                  />
                  <DetailField
                    label="Proyecto"
                    value={
                      sourceProject
                        ? `${sourceProject.code} - ${sourceProject.name}`
                        : "-"
                    }
                  />
                  <DetailField
                    label="Fecha"
                    value={formatDate(selectedReturn.createdAt)}
                  />
                </div>
              </DetailSection>

              <DetailSection icon={Warehouse} title="Información general">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
                  <DetailField label="Bodega origen" value={sourceWarehouseLabel} />
                  {selectedReturn.returnType === "devolucion_entre_proyectos" ? (
                    <>
                      <DetailField
                        label="Proyecto destino"
                        value={destinationProjectLabel}
                      />
                      <DetailField
                        label="Bodega destino"
                        value={destinationWarehouseLabel}
                      />
                    </>
                  ) : null}
                  <DetailField label="Elaborado por" value={createdByLabel} />
                  <DetailField label="Recibido por" value={receivedByLabel} />
                  <DetailField
                    label="Proveedor"
                    value={selectedReturn.supplierName || "-"}
                  />
                  <DetailField
                    label="Nota de crédito"
                    value={
                      selectedReturn.returnType === "devolucion_proveedor"
                        ? selectedReturn.sapDocumentNumber ||
                          "Pendiente de generar"
                        : selectedReturn.sapDocumentNumber || "-"
                    }
                  />
                  <DetailField
                    label="Procesada"
                    value={formatDate(selectedReturn.processedAt)}
                  />
                  <DetailField
                    label="Número documento"
                    value={
                      sourceReceipt?.invoiceNumber ||
                      selectedReturn.sapDocumentNumber ||
                      "-"
                    }
                  />
                  <DetailField label="CAI" value={sourceReceipt?.cai || "-"} />
                  <DetailField
                    label="Fecha documento"
                    value={formatDate(sourceReceipt?.documentDate)}
                  />
                  <DetailField
                    label="Fecha vencimiento"
                    value={formatDate(sourceReceipt?.documentDueDate)}
                  />
                  <DetailField
                    label="Fecha recepción"
                    value={formatDate(sourceReceipt?.receiptDate)}
                  />
                </div>
              </DetailSection>

              <DetailSection icon={FileText} title="Justificación">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {selectedReturn.justification || "-"}
                </p>
              </DetailSection>

              {[
                "devolucion_bodega_central",
                "devolucion_entre_proyectos",
              ].includes(selectedReturn.returnType) && linkedTransfers.length > 0 ? (
                <DetailSection icon={Truck} title="Traslado vinculado">
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Solicitud
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Estatus ST
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Traslado
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Estatus TR
                          </th>
                          <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Recepción
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {linkedTransfers.map((row: any, index: number) => (
                          <tr
                            key={`${row.transferRequest?.id ?? "st"}-${
                              row.transfer?.id ?? "tr"
                            }-${row.receipt?.id ?? index}`}
                            className="border-b border-border last:border-0"
                          >
                            <td className="p-3 font-medium">
                              {row.transferRequest?.requestNumber || "-"}
                            </td>
                            <td className="p-3 text-xs">
                              {TRANSFER_REQUEST_STATUS_LABELS[
                                row.transferRequest?.status
                              ] ||
                                row.transferRequest?.status ||
                                "-"}
                            </td>
                            <td className="p-3 font-medium">
                              {row.transfer?.transferNumber || "-"}
                            </td>
                            <td className="p-3 text-xs">
                              {TRANSFER_STATUS_LABELS[row.transfer?.status] ||
                                row.transfer?.status ||
                                "-"}
                            </td>
                            <td className="p-3 text-xs">
                              {row.receipt?.receiptNumber || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </DetailSection>
              ) : null}

              <DetailSection icon={Package} title="Ítems asociados">
                <div className="overflow-x-auto rounded-md border border-border">
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
                            <Badge
                              variant="outline"
                              className={
                                item.condition === "defectuoso" ||
                                item.condition === "danado"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              }
                            >
                              {CONDITION_LABELS[item.condition] || item.condition}
                            </Badge>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {item.notes || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DetailSection>
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
