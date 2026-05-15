import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { Search, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import {
  CAI_FORMAT_EXAMPLE,
  INVOICE_NUMBER_FORMAT_EXAMPLE,
  formatCaiInput,
  formatInvoiceNumberInput,
  isValidCai,
  isValidInvoiceNumber,
} from "@shared/invoices";

const STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador",
  registrada: "Registrada",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  borrador: "border-slate-300 bg-slate-50 text-slate-700",
  registrada: "border-emerald-300 bg-emerald-50 text-emerald-700",
  anulada: "border-rose-300 bg-rose-50 text-rose-700",
};

type RetentionDraft = {
  retentionType: "percentage" | "amount";
  description: string;
  baseAmount: string;
  percentage: string;
  amount: string;
};

function dateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("es-HN");
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRetentionAmount(draft: RetentionDraft) {
  if (draft.retentionType === "percentage") {
    return (toNumber(draft.baseAmount) * toNumber(draft.percentage)) / 100;
  }
  return toNumber(draft.amount);
}

function emptyRetention(total: string | number): RetentionDraft {
  return {
    retentionType: "percentage",
    description: "",
    baseAmount: String(total ?? "0.00"),
    percentage: "",
    amount: "",
  };
}

function getFriendlyMutationError(message: string) {
  try {
    const parsed = JSON.parse(message);
    if (!Array.isArray(parsed)) return message;
    const issue = parsed[0];
    const path = Array.isArray(issue?.path) ? issue.path.join(".") : "";

    if (path.includes("description")) {
      return "Ingresa la descripción de cada retención";
    }
    if (path.includes("percentage")) {
      return "Ingresa un porcentaje mayor que cero";
    }
    if (path.includes("baseAmount")) {
      return "Ingresa una base de retención válida";
    }
    if (path.includes("amount")) {
      return "Ingresa un monto mayor que cero";
    }
    if (path.includes("cai")) {
      return `El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`;
    }
    if (path.includes("invoiceNumber")) {
      return `El número de factura debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`;
    }

    return typeof issue?.message === "string" ? issue.message : message;
  } catch {
    return message;
  }
}

export default function Facturas() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const userRole = (user as any)?.buildreqRole;
  const canEditInvoices =
    user?.role === "admin" ||
    userRole === "administracion_central" ||
    userRole === "administrador_proyecto";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [invoiceDraft, setInvoiceDraft] = useState({
    cai: "",
    invoiceNumber: "",
    documentDate: "",
    postingDate: "",
    receiptDate: "",
    emissionDeadline: "",
    notes: "",
  });
  const [retentionDrafts, setRetentionDrafts] = useState<RetentionDraft[]>([]);
  const listFilters = useMemo(
    () => ({
      status:
        statusFilter === "all"
          ? undefined
          : (statusFilter as "borrador" | "registrada" | "anulada"),
      search: searchTerm.trim() || undefined,
    }),
    [searchTerm, statusFilter]
  );

  const { data: invoices, isLoading } = trpc.invoices.list.useQuery(listFilters);
  const { data: detail, isLoading: detailLoading } =
    trpc.invoices.getById.useQuery(
      { id: selectedId ?? 0 },
      { enabled: selectedId !== null }
    );

  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: () => {
      toast.success("Factura actualizada");
      void utils.invoices.list.invalidate();
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });
  const replaceRetentionsMutation = trpc.invoices.replaceRetentions.useMutation({
    onSuccess: () => {
      toast.success("Retenciones actualizadas");
      void utils.invoices.list.invalidate();
      if (selectedId) void utils.invoices.getById.invalidate({ id: selectedId });
    },
    onError: error => toast.error(getFriendlyMutationError(error.message)),
  });

  useEffect(() => {
    if (!detail?.invoice) return;
    setInvoiceDraft({
      cai: detail.invoice.cai ?? "",
      invoiceNumber: detail.invoice.invoiceNumber ?? "",
      documentDate: dateInputValue(detail.invoice.documentDate),
      postingDate: dateInputValue(detail.invoice.postingDate),
      receiptDate: dateInputValue(detail.invoice.receiptDate),
      emissionDeadline: dateInputValue(detail.invoice.emissionDeadline),
      notes: detail.invoice.notes ?? "",
    });
    setRetentionDrafts(
      (detail.retentions ?? []).map((retention: any) => ({
        retentionType: retention.retentionType,
        description: retention.description ?? "",
        baseAmount: String(retention.baseAmount ?? "0.00"),
        percentage: String(retention.percentage ?? ""),
        amount: String(retention.amount ?? "0.00"),
      }))
    );
  }, [detail?.invoice?.id]);

  const filteredInvoices = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return (invoices ?? []).filter((row: any) => {
      const invoice = row.invoice;
      const matchesStatus =
        statusFilter === "all" || invoice.status === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        [
          invoice.invoiceDocumentNumber,
          invoice.invoiceNumber,
          invoice.cai,
          row.purchaseOrder?.orderNumber,
          row.receipt?.receiptNumber,
          row.supplier?.name,
          row.supplier?.supplierCode,
          row.project ? `${row.project.code} ${row.project.name}` : "",
        ]
          .filter(Boolean)
          .some(value =>
            String(value).toLowerCase().includes(normalizedSearch)
          );

      return matchesStatus && matchesSearch;
    });
  }, [invoices, searchTerm, statusFilter]);

  const retentionTotal = retentionDrafts.reduce(
    (sum, retention) => sum + getRetentionAmount(retention),
    0
  );
  const invoiceTotal = toNumber(detail?.invoice.total);
  const withholdingBase = (detail?.items ?? [])
    .filter((item: any) => item.allowsTaxWithholding !== false)
    .reduce((sum: number, item: any) => sum + toNumber(item.total), 0);
  const supplierAllowsTaxWithholding =
    detail?.supplier?.allowsTaxWithholding !== false;
  const canRetainSelectedInvoice =
    supplierAllowsTaxWithholding && withholdingBase > 0;
  const retentionDisabledReason = !supplierAllowsTaxWithholding
    ? "El proveedor no permite retención de impuestos."
    : withholdingBase <= 0
      ? "La factura no tiene líneas habilitadas para retención."
      : "";
  const netPayable = Math.max(invoiceTotal - retentionTotal, 0);
  const isDraft = detail?.invoice.status === "borrador";
  const canEditSelectedInvoice = canEditInvoices && isDraft;
  const canEditRetentions =
    canEditSelectedInvoice && canRetainSelectedInvoice;

  const handleSaveInvoice = () => {
    if (!selectedId) return;
    if (!invoiceDraft.cai.trim()) {
      toast.error("Ingresa el CAI de la factura");
      return;
    }
    if (!isValidCai(invoiceDraft.cai)) {
      toast.error(`El CAI debe tener el formato ${CAI_FORMAT_EXAMPLE}`);
      return;
    }
    if (!invoiceDraft.invoiceNumber.trim()) {
      toast.error("Ingresa el número de factura");
      return;
    }
    if (!isValidInvoiceNumber(invoiceDraft.invoiceNumber)) {
      toast.error(
        `El número de factura debe tener el formato ${INVOICE_NUMBER_FORMAT_EXAMPLE}`
      );
      return;
    }
    updateMutation.mutate({
      id: selectedId,
      cai: formatCaiInput(invoiceDraft.cai),
      invoiceNumber: formatInvoiceNumberInput(invoiceDraft.invoiceNumber),
      documentDate: invoiceDraft.documentDate,
      postingDate: invoiceDraft.postingDate,
      receiptDate: invoiceDraft.receiptDate,
      emissionDeadline: invoiceDraft.emissionDeadline,
      notes: invoiceDraft.notes,
    });
  };

  const handleSaveRetentions = () => {
    if (!selectedId) return;
    if (retentionDrafts.length > 0 && !canRetainSelectedInvoice) {
      toast.error(retentionDisabledReason || "La factura no permite retenciones");
      return;
    }
    for (let index = 0; index < retentionDrafts.length; index += 1) {
      const retention = retentionDrafts[index];
      const retentionLabel =
        retentionDrafts.length > 1 ? ` #${index + 1}` : "";
      if (!retention.description.trim()) {
        toast.error(`Ingresa la descripción de la retención${retentionLabel}`);
        return;
      }
      if (retention.retentionType === "percentage") {
        if (toNumber(retention.baseAmount) <= 0) {
          toast.error(
            `La base de la retención${retentionLabel} debe ser mayor que cero`
          );
          return;
        }
        if (toNumber(retention.baseAmount) - withholdingBase > 0.000001) {
          toast.error(
            `La base de la retención${retentionLabel} no puede exceder la base retenible`
          );
          return;
        }
        if (toNumber(retention.percentage) <= 0) {
          toast.error(
            `El porcentaje de la retención${retentionLabel} debe ser mayor que cero`
          );
          return;
        }
      }
      if (
        retention.retentionType === "amount" &&
        toNumber(retention.amount) <= 0
      ) {
        toast.error(
          `El monto de la retención${retentionLabel} debe ser mayor que cero`
        );
        return;
      }
    }
    if (retentionTotal - withholdingBase > 0.000001) {
      toast.error("Las retenciones no pueden exceder la base retenible");
      return;
    }
    if (retentionTotal - invoiceTotal > 0.000001) {
      toast.error("Las retenciones no pueden exceder el total de la factura");
      return;
    }
    replaceRetentionsMutation.mutate({
      id: selectedId,
      retentions: retentionDrafts.map(retention => ({
        retentionType: retention.retentionType,
        description: retention.description.trim(),
        baseAmount:
          retention.retentionType === "percentage"
            ? String(toNumber(retention.baseAmount))
            : undefined,
        percentage:
          retention.retentionType === "percentage"
            ? retention.percentage.trim()
            : undefined,
        amount:
          retention.retentionType === "amount"
            ? retention.amount.trim()
            : undefined,
      })),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1>Facturas</h1>
        <p className="text-sm text-muted-foreground">
          Documentos generados desde recepciones de órdenes de compra.
        </p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Buscar por factura, OC, recepción, proveedor o proyecto..."
            className="h-10 pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10 w-full lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando facturas...
            </div>
          ) : !filteredInvoices.length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay facturas registradas
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documento
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proveedor
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Origen
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha límite
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Retenciones
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Neto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estado
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((row: any) => (
                    <tr
                      key={row.invoice.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="p-3">
                        <div className="font-semibold">
                          {row.invoice.invoiceDocumentNumber}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.invoice.invoiceNumber || "Factura sin número"}
                        </div>
                      </td>
                      <td className="p-3">
                        {row.supplier
                          ? `${row.supplier.supplierCode} — ${row.supplier.name}`
                          : "Proveedor pendiente"}
                      </td>
                      <td className="p-3">
                        <div>{row.purchaseOrder?.orderNumber || "OC"}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.receipt?.receiptNumber || "Recepción"}
                        </div>
                      </td>
                      <td className="p-3">
                        {formatDateLabel(row.invoice.emissionDeadline)}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {formatPurchaseOrderCurrency(row.invoice.total)}
                      </td>
                      <td className="p-3 text-right font-medium">
                        {formatPurchaseOrderCurrency(
                          row.invoice.retentionTotal
                        )}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {formatPurchaseOrderCurrency(row.invoice.netPayable)}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            STATUS_COLORS[row.invoice.status] || ""
                          }`}
                        >
                          {STATUS_LABELS[row.invoice.status] ||
                            row.invoice.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedId(row.invoice.id)}
                        >
                          Ver
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
        open={selectedId !== null}
        onOpenChange={open => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-0.75rem)] w-[calc(100vw-0.5rem)] max-w-[calc(100vw-0.5rem)] overflow-x-hidden overflow-y-auto rounded-2xl p-4 sm:max-h-[calc(100vh-1.5rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[1500px] sm:p-6 lg:p-7">
          <DialogHeader className="min-w-0 border-b border-border/70 pb-4 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">
                {detail?.invoice.invoiceDocumentNumber || "Factura"}
              </DialogTitle>
              {detail?.invoice.status ? (
                <Badge
                  variant="outline"
                  className={`text-sm ${
                    STATUS_COLORS[detail.invoice.status] || ""
                  }`}
                >
                  {STATUS_LABELS[detail.invoice.status] || detail.invoice.status}
                </Badge>
              ) : null}
            </div>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Cargando factura...
            </div>
          ) : (
            <div className="min-w-0 space-y-5">
              <div className="grid min-w-0 gap-3 md:grid-cols-12">
                <div className="min-w-0 rounded-2xl border border-border/70 bg-muted/20 p-4 md:col-span-4">
                  <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Proveedor
                  </Label>
                  <p className="mt-2 break-words font-semibold">
                    {detail.supplier
                      ? `${detail.supplier.supplierCode} — ${detail.supplier.name}`
                      : "Proveedor pendiente"}
                  </p>
                  <Badge
                    variant="outline"
                    className={`mt-3 text-xs ${
                      supplierAllowsTaxWithholding
                        ? "border-emerald-300 text-emerald-700"
                        : "border-amber-300 text-amber-700"
                    }`}
                  >
                    {supplierAllowsTaxWithholding
                      ? "Permite retención"
                      : "No permite retención"}
                  </Badge>
                </div>
                <div className="min-w-0 rounded-2xl border border-border/70 bg-muted/20 p-4 md:col-span-4">
                  <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Origen
                  </Label>
                  <p className="mt-2 break-words font-semibold">
                    {detail.purchaseOrder?.orderNumber || "OC"}
                  </p>
                  <p className="break-words text-sm text-muted-foreground">
                    {detail.receipt?.receiptNumber || "Recepción"}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl border border-border/70 bg-muted/20 p-4 md:col-span-4">
                  <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Proyecto
                  </Label>
                  <p className="mt-2 break-words font-semibold">
                    {detail.project
                      ? `${detail.project.code} — ${detail.project.name}`
                      : "Proyecto pendiente"}
                  </p>
                </div>
              </div>

              <div className="grid min-w-0 gap-3 rounded-2xl border border-border/70 p-4 md:grid-cols-2 xl:grid-cols-[minmax(22rem,2fr)_minmax(12rem,1fr)_repeat(4,minmax(10.5rem,1fr))]">
                <div className="space-y-2">
                  <Label>CAI</Label>
                  <Input
                    value={invoiceDraft.cai}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        cai: formatCaiInput(event.target.value),
                      }))
                    }
                    placeholder={CAI_FORMAT_EXAMPLE}
                    maxLength={CAI_FORMAT_EXAMPLE.length}
                    autoCapitalize="characters"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Número factura</Label>
                  <Input
                    value={invoiceDraft.invoiceNumber}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        invoiceNumber: formatInvoiceNumberInput(
                          event.target.value
                        ),
                      }))
                    }
                    placeholder={INVOICE_NUMBER_FORMAT_EXAMPLE}
                    inputMode="numeric"
                    maxLength={INVOICE_NUMBER_FORMAT_EXAMPLE.length}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha documento</Label>
                  <Input
                    type="date"
                    value={invoiceDraft.documentDate}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        documentDate: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha contabilización</Label>
                  <Input
                    type="date"
                    value={invoiceDraft.postingDate}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        postingDate: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha recepción</Label>
                  <Input
                    type="date"
                    value={invoiceDraft.receiptDate}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        receiptDate: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha límite emisión</Label>
                  <Input
                    type="date"
                    value={invoiceDraft.emissionDeadline}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        emissionDeadline: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2 xl:col-span-6">
                  <Label>Notas</Label>
                  <Textarea
                    value={invoiceDraft.notes}
                    disabled={!canEditSelectedInvoice}
                    onChange={event =>
                      setInvoiceDraft(current => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    rows={3}
                  />
                </div>
                {canEditSelectedInvoice ? (
                  <div className="md:col-span-2 xl:col-span-6">
                    <Button
                      onClick={handleSaveInvoice}
                      disabled={updateMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Guardar factura
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 overflow-x-auto rounded-2xl border border-border/70">
                <table className="min-w-[1120px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        SAP
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Precio
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Subtotal
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        ISV
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Total
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Retención
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item: any) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="p-3 font-medium">{item.itemName}</td>
                        <td className="p-3 font-mono text-xs">
                          {item.currentSapItemCode ||
                            item.originalSapItemCode ||
                            "—"}
                        </td>
                        <td className="p-3 text-right">
                          {item.quantity} {item.unit || ""}
                        </td>
                        <td className="p-3 text-right">
                          {formatPurchaseOrderCurrency(item.unitPrice)}
                        </td>
                        <td className="p-3 text-right">
                          {formatPurchaseOrderCurrency(item.subtotal)}
                        </td>
                        <td className="p-3 text-right">
                          {formatPurchaseOrderCurrency(item.taxAmount)}
                        </td>
                        <td className="p-3 text-right font-semibold">
                          {formatPurchaseOrderCurrency(item.total)}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              item.allowsTaxWithholding !== false
                                ? "border-emerald-300 text-emerald-700"
                                : "border-amber-300 text-amber-700"
                            }
                          >
                            {item.allowsTaxWithholding !== false
                              ? "Permite"
                              : "No permite"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-3 rounded-2xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold">Retenciones</h3>
                    {canEditSelectedInvoice ? (
                      <Button
                        variant="outline"
                        disabled={!canRetainSelectedInvoice}
                        onClick={() =>
                          setRetentionDrafts(current => [
                            ...current,
                            emptyRetention(withholdingBase),
                          ])
                        }
                      >
                        Agregar retención
                      </Button>
                    ) : null}
                  </div>
                  {!canRetainSelectedInvoice ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      {retentionDisabledReason}
                    </div>
                  ) : null}

                  {retentionDrafts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      Sin retenciones registradas.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {retentionDrafts.map((retention, index) => (
                        <div
                          key={index}
                          className="grid min-w-0 gap-3 rounded-xl border border-border/70 p-3 md:grid-cols-12"
                        >
                          <div className="space-y-2 md:col-span-3">
                            <Label>Tipo</Label>
                            <Select
                              value={retention.retentionType}
                              disabled={!canEditRetentions}
                              onValueChange={(value: "percentage" | "amount") =>
                                setRetentionDrafts(current =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, retentionType: value }
                                      : entry
                                  )
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percentage">
                                  Porcentaje
                                </SelectItem>
                                <SelectItem value="amount">Monto fijo</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2 md:col-span-4">
                            <Label>Descripción</Label>
                            <Input
                              value={retention.description}
                              disabled={!canEditRetentions}
                              onChange={event =>
                                setRetentionDrafts(current =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? {
                                          ...entry,
                                          description: event.target.value,
                                        }
                                      : entry
                                  )
                                )
                              }
                              placeholder="ISR, ISV retenido, municipal..."
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label>Base</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={retention.baseAmount}
                              disabled={
                                !canEditRetentions ||
                                retention.retentionType === "amount"
                              }
                              onChange={event =>
                                setRetentionDrafts(current =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, baseAmount: event.target.value }
                                      : entry
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2 md:col-span-1">
                            <Label>%</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={retention.percentage}
                              disabled={
                                !canEditRetentions ||
                                retention.retentionType === "amount"
                              }
                              onChange={event =>
                                setRetentionDrafts(current =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, percentage: event.target.value }
                                      : entry
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2 md:col-span-1">
                            <Label>Monto</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                retention.retentionType === "percentage"
                                  ? getRetentionAmount(retention).toFixed(2)
                                  : retention.amount
                              }
                              disabled={
                                !canEditRetentions ||
                                retention.retentionType === "percentage"
                              }
                              onChange={event =>
                                setRetentionDrafts(current =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, amount: event.target.value }
                                      : entry
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="flex items-end justify-end md:col-span-1">
                            {canEditSelectedInvoice ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() =>
                                  setRetentionDrafts(current =>
                                    current.filter((_, entryIndex) => entryIndex !== index)
                                  )
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {canEditSelectedInvoice ? (
                    <Button
                      onClick={handleSaveRetentions}
                      disabled={
                        replaceRetentionsMutation.isPending ||
                        (retentionDrafts.length > 0 &&
                          !canRetainSelectedInvoice)
                      }
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Guardar retenciones
                    </Button>
                  ) : null}
                </div>

                <div className="h-fit space-y-2.5 rounded-2xl border border-border/70 bg-muted/10 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(detail.invoice.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">ISV</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(detail.invoice.taxAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold">
                      {formatPurchaseOrderCurrency(detail.invoice.total)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">Base retenible</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(withholdingBase)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Retenciones</span>
                    <span className="font-medium">
                      {formatPurchaseOrderCurrency(retentionTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-base font-semibold">
                    <span>Neto a pagar</span>
                    <span>{formatPurchaseOrderCurrency(netPayable)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
