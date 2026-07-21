import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  TREASURY_BATCH_STATUS_CODES,
  TREASURY_BATCH_STATUS_LABELS,
  TREASURY_ITEM_STATUS_LABELS,
  type TreasuryBatchStatus,
} from "@shared/treasury";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Upload,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const CURRENCY_FORMATTERS = {
  HNL: new Intl.NumberFormat("es-HN", {
    style: "currency",
    currency: "HNL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
  USD: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
};

function formatMoney(value: unknown, currency: "HNL" | "USD" = "HNL") {
  const amount = Number(value ?? 0);
  return CURRENCY_FORMATTERS[currency].format(
    Number.isFinite(amount) ? amount : 0
  );
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("es-HN");
}

function toDateInput(value: unknown) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

function downloadBase64File(
  fileName: string,
  mimeType: string,
  base64: string
) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1]! : result);
    };
    reader.readAsDataURL(file);
  });
}

function statusVariant(status: string) {
  if (status === "cerrado" || status === "contabilizada")
    return "default" as const;
  if (status === "anulado" || status === "rechazada_banco")
    return "destructive" as const;
  if (status === "conciliacion" || status === "con_diferencia")
    return "outline" as const;
  return "secondary" as const;
}

function BatchFormDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: any;
  onSaved: (batchId: number) => void;
}) {
  const utils = trpc.useUtils();
  const [projectId, setProjectId] = useState("");
  const [currency, setCurrency] = useState<"HNL" | "USD">("HNL");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  const projectsQuery = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: open }
  );
  const eligibleQuery = trpc.treasury.eligibleInvoices.useQuery(
    {
      projectId: projectId ? Number(projectId) : undefined,
      currency,
      batchId: existing?.batch?.id,
    },
    { enabled: open && Boolean(projectId) }
  );

  useEffect(() => {
    if (!open) return;
    if (existing?.batch) {
      setProjectId(String(existing.batch.projectId));
      setCurrency(existing.batch.currency);
      setPaymentDate(toDateInput(existing.batch.requestedPaymentDate));
      setNotes(existing.batch.notes ?? "");
      const included = (existing.items ?? []).filter(
        (item: any) => item.status !== "excluida"
      );
      setSelectedIds(new Set(included.map((item: any) => item.invoiceId)));
      setAmounts(
        Object.fromEntries(
          included.map((item: any) => [item.invoiceId, item.requestedAmount])
        )
      );
      return;
    }
    setProjectId("");
    setCurrency("HNL");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setSearch("");
    setSelectedIds(new Set());
    setAmounts({});
  }, [existing, open]);

  const saveSuccess = async (data: any) => {
    toast.success(existing ? "Borrador actualizado" : "Lote creado");
    await Promise.all([
      utils.treasury.list.invalidate(),
      utils.treasury.eligibleInvoices.invalidate(),
    ]);
    onOpenChange(false);
    onSaved(Number(data.id));
  };
  const createMutation = trpc.treasury.create.useMutation({
    onSuccess: saveSuccess,
    onError: error => toast.error(error.message),
  });
  const updateMutation = trpc.treasury.updateDraft.useMutation({
    onSuccess: saveSuccess,
    onError: error => toast.error(error.message),
  });

  const visibleInvoices = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-HN");
    if (!term) return eligibleQuery.data ?? [];
    return (eligibleQuery.data ?? []).filter((row: any) =>
      [
        row.supplier?.name,
        row.supplier?.supplierCode,
        row.invoice?.invoiceDocumentNumber,
        row.invoice?.invoiceNumber,
        row.project?.code,
      ]
        .join(" ")
        .toLocaleLowerCase("es-HN")
        .includes(term)
    );
  }, [eligibleQuery.data, search]);

  function toggleInvoice(row: any, checked: boolean) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (checked) next.add(row.invoice.id);
      else next.delete(row.invoice.id);
      return next;
    });
    if (checked && !amounts[row.invoice.id]) {
      setAmounts(current => ({
        ...current,
        [row.invoice.id]: String(row.money.availableAmount),
      }));
    }
  }

  function save() {
    const items = Array.from(selectedIds).map(invoiceId => ({
      invoiceId,
      requestedAmount: Number(amounts[invoiceId]),
    }));
    if (!projectId || !paymentDate || items.length === 0) {
      toast.error("Seleccione proyecto, fecha y al menos una factura.");
      return;
    }
    if (
      items.some(
        item =>
          !Number.isFinite(item.requestedAmount) || item.requestedAmount <= 0
      )
    ) {
      toast.error("Todos los abonos deben ser mayores que cero.");
      return;
    }
    const payload = { requestedPaymentDate: paymentDate, notes, items };
    if (existing?.batch?.id) {
      updateMutation.mutate({ id: existing.batch.id, ...payload });
    } else {
      createMutation.mutate({
        projectId: Number(projectId),
        currency,
        ...payload,
      });
    }
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[94vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-5xl xl:max-w-6xl">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <WalletCards className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <DialogTitle>
                {existing ? "Editar lote" : "Nuevo lote de abonos"}
              </DialogTitle>
              <DialogDescription className="max-w-3xl leading-relaxed">
                Seleccione facturas de línea de crédito y defina el abono
                solicitado. El valor inicial corresponde al saldo completo
                disponible y puede reducirse para registrar un pago parcial.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(8rem,0.65fr)_minmax(11rem,0.9fr)]">
            <div className="min-w-0 space-y-2">
              <Label>Proyecto</Label>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={Boolean(existing)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccione proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {(projectsQuery.data ?? []).map((project: any) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select
                value={currency}
                onValueChange={value => setCurrency(value as "HNL" | "USD")}
                disabled={Boolean(existing)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HNL">HNL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fecha prevista</Label>
              <Input
                type="date"
                value={paymentDate}
                onChange={event => setPaymentDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas</Label>
            <Textarea
              className="min-h-20 resize-y"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={2000}
              placeholder="Agregue una observación para el lote (opcional)"
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar por proveedor, código o número de factura"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
            <Badge variant="secondary" className="w-fit shrink-0 px-3 py-1.5">
              {visibleInvoices.length}{" "}
              {visibleInvoices.length === 1
                ? "factura disponible"
                : "facturas disponibles"}
            </Badge>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="max-h-[38vh] overflow-y-auto">
              <Table className="min-w-[860px]">
                <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="min-w-72">
                      Proveedor / Factura
                    </TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="w-48 text-right">
                      Abono solicitado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibleQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          Cargando facturas...
                        </span>
                      </TableCell>
                    </TableRow>
                  ) : visibleInvoices.length ? (
                    visibleInvoices.map((row: any) => {
                      const checked = selectedIds.has(row.invoice.id);
                      return (
                        <TableRow
                          key={row.invoice.id}
                          data-state={checked ? "selected" : undefined}
                        >
                          <TableCell>
                            <Checkbox
                              checked={checked}
                              onCheckedChange={value =>
                                toggleInvoice(row, value === true)
                              }
                            />
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="font-medium">
                              {row.supplier.name}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {row.invoice.invoiceDocumentNumber} ·{" "}
                              {row.invoice.invoiceNumber || "Sin número fiscal"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.money.invoiceNetPayable, currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(row.money.paidAmount, currency)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatMoney(row.money.availableAmount, currency)}
                          </TableCell>
                          <TableCell>
                            <Input
                              className="ml-auto w-40 text-right tabular-nums"
                              type="number"
                              min="0.0001"
                              step="0.0001"
                              max={row.money.availableAmount}
                              disabled={!checked}
                              value={amounts[row.invoice.id] ?? ""}
                              onChange={event =>
                                setAmounts(current => ({
                                  ...current,
                                  [row.invoice.id]: event.target.value,
                                }))
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-12 text-center text-muted-foreground"
                      >
                        {projectId
                          ? "No hay facturas elegibles con saldo disponible."
                          : "Seleccione un proyecto para consultar sus facturas."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {selectedIds.size}
            </span>{" "}
            {selectedIds.size === 1
              ? "factura seleccionada"
              : "facturas seleccionadas"}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending || selectedIds.size === 0}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {existing ? "Guardar cambios" : "Crear borrador"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchDetailDialog({
  batchId,
  onClose,
  onEdit,
}: {
  batchId: number | null;
  onClose: () => void;
  onEdit: (detail: any) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.treasury.settings.useQuery();
  const detailQuery = trpc.treasury.getById.useQuery(
    { id: batchId ?? 0 },
    { enabled: Boolean(batchId) }
  );
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [exclusionReasons, setExclusionReasons] = useState<
    Record<number, string>
  >({});
  const [comment, setComment] = useState("");
  const [accountItemIds, setAccountItemIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const items = detailQuery.data?.items ?? [];
    setAmounts(
      Object.fromEntries(
        items.map((item: any) => [
          item.id,
          item.approvedAmount ?? item.requestedAmount,
        ])
      )
    );
    setExcludedIds(new Set());
    setExclusionReasons({});
    setComment("");
    setAccountItemIds(
      new Set(
        items
          .filter((item: any) => item.status === "pagada")
          .map((item: any) => item.id)
      )
    );
  }, [detailQuery.data]);

  const refresh = async () => {
    await Promise.all([
      utils.treasury.getById.invalidate(),
      utils.treasury.list.invalidate(),
      utils.treasury.eligibleInvoices.invalidate(),
      utils.notifications.unreadCount.invalidate(),
    ]);
  };
  const mutationOptions = (message: string) => ({
    onSuccess: async () => {
      toast.success(message);
      await refresh();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  });
  const submitMutation = trpc.treasury.submit.useMutation(
    mutationOptions("Lote enviado a depuración")
  );
  const purifyMutation = trpc.treasury.purify.useMutation(
    mutationOptions("Lote enviado a aprobación")
  );
  const approveMutation = trpc.treasury.approve.useMutation(
    mutationOptions("Lote aprobado")
  );
  const returnMutation = trpc.treasury.returnBatch.useMutation(
    mutationOptions("Lote devuelto")
  );
  const cancelMutation = trpc.treasury.cancel.useMutation(
    mutationOptions("Lote anulado")
  );
  const exportMutation = trpc.treasury.exportBankWorkbook.useMutation({
    onSuccess: async data => {
      downloadBase64File(data.fileName, data.mimeType, data.base64);
      toast.success("Excel bancario generado");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const importMutation = trpc.treasury.importBankWorkbook.useMutation(
    mutationOptions("Respuesta bancaria importada")
  );
  const resolveMutation = trpc.treasury.resolveDifference.useMutation(
    mutationOptions("Diferencia resuelta")
  );
  const accountMutation = trpc.treasury.accountItems.useMutation(
    mutationOptions("Abonos contabilizados")
  );

  const detail = detailQuery.data;
  const batch = detail?.batch;
  const status = batch?.status as TreasuryBatchStatus | undefined;
  const isCentral =
    user?.role === "admin" || user?.buildreqRole === "administracion_central";
  const isProjectManager =
    user?.role === "admin" || user?.buildreqRole === "administrador_proyecto";
  const isAccountant =
    user?.role === "admin" || user?.buildreqRole === "contable";
  const isApprover = settingsQuery.data?.isApprover === true;
  const editableAdjustments =
    (status === "enviado_depuracion" && isCentral) ||
    (status === "pendiente_aprobacion" && isApprover);

  function adjustments() {
    return (detail?.items ?? [])
      .filter(
        (item: any) => item.activeReservation && item.status !== "excluida"
      )
      .map((item: any) => ({
        itemId: item.id,
        amount: excludedIds.has(item.id) ? undefined : Number(amounts[item.id]),
        excluded: excludedIds.has(item.id),
        reason: exclusionReasons[item.id],
      }));
  }

  async function importFile(file: File) {
    if (!batch) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Seleccione el archivo XLSX devuelto por el banco.");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      importMutation.mutate({ id: batch.id, fileName: file.name, base64 });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo leer el archivo."
      );
    }
  }

  const pending = [
    submitMutation,
    purifyMutation,
    approveMutation,
    returnMutation,
    cancelMutation,
    exportMutation,
    importMutation,
    resolveMutation,
    accountMutation,
  ].some(mutation => mutation.isPending);

  return (
    <Dialog open={Boolean(batchId)} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-7xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {batch?.batchNumber || "Lote de Tesorería"}
            {status && (
              <Badge variant={statusVariant(status)}>
                {TREASURY_BATCH_STATUS_LABELS[status]}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${detail.project.code} - ${detail.project.name} · ${detail.batch.currency} · Pago previsto ${formatDate(detail.batch.requestedPaymentDate)}`
              : "Cargando..."}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading || !detail ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {detail.batch.returnReason && (
              <Alert variant="destructive">
                <RotateCcw />
                <AlertTitle>Lote devuelto</AlertTitle>
                <AlertDescription>{detail.batch.returnReason}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 md:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">
                    Solicitado
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMoney(
                      detail.items
                        .filter((item: any) => item.status !== "excluida")
                        .reduce(
                          (sum: number, item: any) =>
                            sum + Number(item.requestedAmount),
                          0
                        ),
                      detail.batch.currency
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">Aprobado</div>
                  <div className="text-lg font-semibold">
                    {formatMoney(
                      detail.items.reduce(
                        (sum: number, item: any) =>
                          sum + Number(item.approvedAmount ?? 0),
                        0
                      ),
                      detail.batch.currency
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">
                    Pagado por banco
                  </div>
                  <div className="text-lg font-semibold">
                    {formatMoney(
                      detail.items.reduce(
                        (sum: number, item: any) =>
                          sum + Number(item.bankPaidAmount ?? 0),
                        0
                      ),
                      detail.batch.currency
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <div className="text-xs text-muted-foreground">Versión</div>
                  <div className="text-lg font-semibold">
                    {detail.batch.version}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {status === "pendiente_contabilizacion" && isAccountant && (
                      <TableHead className="w-10" />
                    )}
                    <TableHead>Proveedor / Factura</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Total factura</TableHead>
                    <TableHead>Pagado anterior</TableHead>
                    <TableHead>Abono</TableHead>
                    {editableAdjustments && <TableHead>Excluir</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item: any) => (
                    <TableRow key={item.id}>
                      {status === "pendiente_contabilizacion" &&
                        isAccountant && (
                          <TableCell>
                            <Checkbox
                              disabled={item.status !== "pagada"}
                              checked={accountItemIds.has(item.id)}
                              onCheckedChange={checked =>
                                setAccountItemIds(current => {
                                  const next = new Set(current);
                                  if (checked === true) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                })
                              }
                            />
                          </TableCell>
                        )}
                      <TableCell>
                        <div className="font-medium">{item.supplierName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.invoiceDocumentNumber} ·{" "}
                          {item.invoiceNumber || "Sin número fiscal"}
                        </div>
                        {item.exclusionReason && (
                          <div className="mt-1 text-xs text-destructive">
                            {item.exclusionReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)}>
                          {TREASURY_ITEM_STATUS_LABELS[
                            item.status as keyof typeof TREASURY_ITEM_STATUS_LABELS
                          ] ?? item.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatMoney(
                          item.invoiceNetPayable,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell>
                        {formatMoney(
                          item.previousPaidAmount,
                          detail.batch.currency
                        )}
                      </TableCell>
                      <TableCell>
                        {editableAdjustments && item.status !== "excluida" ? (
                          <Input
                            className="w-36"
                            type="number"
                            min="0.0001"
                            step="0.0001"
                            max={item.requestedAmount}
                            disabled={excludedIds.has(item.id)}
                            value={amounts[item.id] ?? ""}
                            onChange={event =>
                              setAmounts(current => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                        ) : (
                          <div>
                            {formatMoney(
                              item.bankPaidAmount ??
                                item.approvedAmount ??
                                item.requestedAmount,
                              detail.batch.currency
                            )}
                            {item.bankReference && (
                              <div className="text-xs text-muted-foreground">
                                Ref. {item.bankReference}
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      {editableAdjustments && (
                        <TableCell>
                          {item.status !== "excluida" && (
                            <div className="space-y-2">
                              <Checkbox
                                checked={excludedIds.has(item.id)}
                                onCheckedChange={checked =>
                                  setExcludedIds(current => {
                                    const next = new Set(current);
                                    if (checked === true) next.add(item.id);
                                    else next.delete(item.id);
                                    return next;
                                  })
                                }
                              />
                              {excludedIds.has(item.id) && (
                                <Input
                                  className="w-52"
                                  placeholder="Motivo de exclusión"
                                  value={exclusionReasons[item.id] ?? ""}
                                  onChange={event =>
                                    setExclusionReasons(current => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                />
                              )}
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {(editableAdjustments ||
              status === "pendiente_contabilizacion" ||
              status === "conciliacion") && (
              <div className="space-y-2">
                <Label>Comentario</Label>
                <Textarea
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                  placeholder="Comentario, motivo de devolución o resolución"
                  maxLength={2000}
                />
              </div>
            )}

            {status === "conciliacion" && isCentral && (
              <div className="space-y-3">
                <h3 className="font-semibold">Diferencias bancarias</h3>
                {detail.items
                  .filter((item: any) => item.status === "con_diferencia")
                  .map((item: any) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <div className="font-medium">
                          {item.supplierName} · {item.invoiceDocumentNumber}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Aprobado{" "}
                          {formatMoney(
                            item.approvedAmount,
                            detail.batch.currency
                          )}{" "}
                          · Banco{" "}
                          {formatMoney(
                            item.bankPaidAmount,
                            detail.batch.currency
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending || comment.trim().length < 5}
                          onClick={() =>
                            resolveMutation.mutate({
                              id: detail.batch.id,
                              itemId: item.id,
                              resolution: "reject",
                              comment,
                            })
                          }
                        >
                          <XCircle className="mr-2 h-4 w-4" /> Rechazar línea
                        </Button>
                        <Button
                          size="sm"
                          disabled={pending || comment.trim().length < 5}
                          onClick={() =>
                            resolveMutation.mutate({
                              id: detail.batch.id,
                              itemId: item.id,
                              resolution: "accept",
                              comment,
                            })
                          }
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Aceptar
                          abono real
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {detail.attachments.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold">Archivos bancarios</h3>
                <div className="flex flex-wrap gap-2">
                  {detail.attachments.map((attachment: any) => (
                    <Button
                      key={attachment.id}
                      variant="outline"
                      size="sm"
                      asChild
                    >
                      <a
                        href={attachment.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileSpreadsheet className="mr-2 h-4 w-4" />{" "}
                        {attachment.fileName}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="font-semibold">Auditoría</h3>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
                {detail.events.map((event: any) => (
                  <div key={event.id} className="text-sm">
                    <span className="font-medium">{event.actorName}</span>{" "}
                    <span className="text-muted-foreground">
                      · {event.action.replaceAll("_", " ")} ·{" "}
                      {formatDate(event.createdAt)}
                    </span>
                    {event.comment && (
                      <div className="text-xs text-muted-foreground">
                        {event.comment}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {detail && (
          <DialogFooter className="flex-wrap sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {(status === "borrador" || status === "devuelto") &&
                isProjectManager && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onEdit(detail)}
                      disabled={pending}
                    >
                      Editar
                    </Button>
                    <Button
                      onClick={() =>
                        submitMutation.mutate({ id: detail.batch.id })
                      }
                      disabled={pending}
                    >
                      <Send className="mr-2 h-4 w-4" /> Enviar a depuración
                    </Button>
                  </>
                )}
              {status === "enviado_depuracion" && isCentral && (
                <Button
                  onClick={() =>
                    purifyMutation.mutate({
                      id: detail.batch.id,
                      adjustments: adjustments(),
                      comment,
                    })
                  }
                  disabled={pending}
                >
                  <Send className="mr-2 h-4 w-4" /> Enviar a aprobación
                </Button>
              )}
              {status === "pendiente_aprobacion" && isApprover && (
                <Button
                  onClick={() =>
                    approveMutation.mutate({
                      id: detail.batch.id,
                      adjustments: adjustments(),
                      comment,
                    })
                  }
                  disabled={pending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Aprobar
                </Button>
              )}
              {(status === "enviado_depuracion" && isCentral) ||
              (status === "pendiente_aprobacion" && isApprover) ? (
                <Button
                  variant="outline"
                  disabled={pending || comment.trim().length < 5}
                  onClick={() =>
                    returnMutation.mutate({
                      id: detail.batch.id,
                      reason: comment,
                    })
                  }
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Devolver
                </Button>
              ) : null}
              {(status === "aprobado" || status === "enviado_banco") &&
                isCentral && (
                  <Button
                    onClick={() =>
                      exportMutation.mutate({ id: detail.batch.id })
                    }
                    disabled={pending}
                  >
                    <Download className="mr-2 h-4 w-4" /> Descargar Excel banco
                  </Button>
                )}
              {status === "enviado_banco" && isCentral && (
                <Button variant="outline" asChild disabled={pending}>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" /> Importar respuesta
                    <input
                      className="hidden"
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) void importFile(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </Button>
              )}
              {status === "pendiente_contabilizacion" && isAccountant && (
                <Button
                  onClick={() =>
                    accountMutation.mutate({
                      id: detail.batch.id,
                      itemIds: Array.from(accountItemIds),
                      comment,
                    })
                  }
                  disabled={pending || accountItemIds.size === 0}
                >
                  <Banknote className="mr-2 h-4 w-4" /> Contabilizar abonos
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {status &&
                ![
                  "enviado_banco",
                  "conciliacion",
                  "pendiente_contabilizacion",
                  "cerrado",
                  "anulado",
                ].includes(status) &&
                (isCentral ||
                  ((status === "borrador" || status === "devuelto") &&
                    isProjectManager)) && (
                  <Button
                    variant="destructive"
                    disabled={pending || comment.trim().length < 5}
                    onClick={() =>
                      cancelMutation.mutate({
                        id: detail.batch.id,
                        reason: comment,
                      })
                    }
                  >
                    Anular
                  </Button>
                )}
              <Button variant="outline" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Tesoreria() {
  const [statusFilter, setStatusFilter] = useState<string>("todos");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [editingDetail, setEditingDetail] = useState<any>();
  const settingsQuery = trpc.treasury.settings.useQuery();
  const batchesQuery = trpc.treasury.list.useQuery(
    statusFilter === "todos"
      ? undefined
      : { status: statusFilter as TreasuryBatchStatus },
    {
      enabled:
        settingsQuery.data?.treasuryEnabled === true &&
        settingsQuery.data?.canAccess === true,
    }
  );

  const visibleBatches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-HN");
    if (!term) return batchesQuery.data ?? [];
    return (batchesQuery.data ?? []).filter((row: any) =>
      [
        row.batch.batchNumber,
        row.project.code,
        row.project.name,
        row.batch.status,
      ]
        .join(" ")
        .toLocaleLowerCase("es-HN")
        .includes(term)
    );
  }, [batchesQuery.data, search]);

  if (settingsQuery.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" />
      </div>
    );
  }
  if (!settingsQuery.data?.canAccess) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Acceso restringido</AlertTitle>
        <AlertDescription>
          No está autorizado para operar Tesorería.
        </AlertDescription>
      </Alert>
    );
  }
  if (!settingsQuery.data.treasuryEnabled) {
    return (
      <Alert>
        <WalletCards />
        <AlertTitle>Tesorería todavía no está habilitada</AlertTitle>
        <AlertDescription>
          Un administrador debe configurar los aprobadores y activar el módulo
          en Configuración.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2">
            <WalletCards className="h-6 w-6" /> Tesorería
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lotes, abonos parciales, aprobación, banco y contabilización.
          </p>
        </div>
        {settingsQuery.data.permissions.canCreate && (
          <Button
            onClick={() => {
              setEditingDetail(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Nuevo lote
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Lotes de pago</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Buscar lote o proyecto"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los estados</SelectItem>
                {TREASURY_BATCH_STATUS_CODES.map(status => (
                  <SelectItem key={status} value={status}>
                    {TREASURY_BATCH_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void batchesQuery.refetch()}
              title="Actualizar"
            >
              <RefreshCcw className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lote</TableHead>
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha prevista</TableHead>
                  <TableHead>Proveedores</TableHead>
                  <TableHead>Solicitado</TableHead>
                  <TableHead>Pagado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batchesQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : visibleBatches.length ? (
                  visibleBatches.map((row: any) => (
                    <TableRow key={row.batch.id}>
                      <TableCell className="font-medium">
                        {row.batch.batchNumber}
                      </TableCell>
                      <TableCell>
                        <div>{row.project.code}</div>
                        <div className="max-w-64 truncate text-xs text-muted-foreground">
                          {row.project.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.batch.status)}>
                          {
                            TREASURY_BATCH_STATUS_LABELS[
                              row.batch.status as TreasuryBatchStatus
                            ]
                          }
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatDate(row.batch.requestedPaymentDate)}
                      </TableCell>
                      <TableCell>{row.supplierCount}</TableCell>
                      <TableCell>
                        {formatMoney(row.requestedTotal, row.batch.currency)}
                      </TableCell>
                      <TableCell>
                        {formatMoney(row.paidTotal, row.batch.currency)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedBatchId(row.batch.id)}
                        >
                          <Eye className="mr-2 h-4 w-4" /> Abrir
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-12 text-center text-muted-foreground"
                    >
                      No hay lotes con estos filtros.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <BatchFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        existing={editingDetail}
        onSaved={id => setSelectedBatchId(id)}
      />
      <BatchDetailDialog
        batchId={selectedBatchId}
        onClose={() => setSelectedBatchId(null)}
        onEdit={detail => {
          setEditingDetail(detail);
          setSelectedBatchId(null);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
