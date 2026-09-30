import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { prepareDocumentAttachment } from "@/lib/document-attachments";
import { trpc } from "@/lib/trpc";
import { roundDecimalAmount } from "@shared/money";
import { hasAtMostDecimalPlaces } from "@shared/money";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";

type FixedPurchaseOrder = {
  id: number;
  orderNumber: string;
  currency: "HNL" | "USD";
  supplierName?: string | null;
};

export function PurchaseOrderAdvanceDialog({
  open,
  onOpenChange,
  purchaseOrder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrder?: FixedPurchaseOrder;
  onSaved?: (advance: {
    id: number;
    advanceNumber: string;
    projectId: number;
    currency: "HNL" | "USD";
    requestedAmount: string;
  }) => void;
}) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [requestedAmount, setRequestedAmount] = useState("");
  const [applicationMode, setApplicationMode] = useState<
    "direct" | "contractual"
  >("direct");
  const [requestMode, setRequestMode] = useState<"amount" | "percentage">(
    "amount"
  );
  const [requestPercent, setRequestPercent] = useState("");
  const [amortizationMode, setAmortizationMode] = useState<
    "percentage" | "amount"
  >("percentage");
  const [amortizationValue, setAmortizationValue] = useState("");
  const [amortizationBase, setAmortizationBase] = useState<
    "subtotal" | "total"
  >("subtotal");
  const [requestedPaymentDate, setRequestedPaymentDate] = useState("");
  const [notes, setNotes] = useState("");
  const [support, setSupport] = useState<File>();
  const eligibleQuery =
    trpc.purchaseOrderAdvances.eligiblePurchaseOrders.useQuery(
      {
        purchaseOrderId: purchaseOrder?.id,
        search: purchaseOrder ? undefined : search || undefined,
      },
      { enabled: open }
    );
  const uploadMutation = trpc.attachments.upload.useMutation();
  const createMutation = trpc.purchaseOrderAdvances.create.useMutation();

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPurchaseOrderId(purchaseOrder ? String(purchaseOrder.id) : "");
    setRequestedAmount("");
    setRequestMode("amount");
    setRequestPercent("");
    setApplicationMode("direct");
    setAmortizationMode("percentage");
    setAmortizationValue("");
    setAmortizationBase("subtotal");
    setRequestedPaymentDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setSupport(undefined);
  }, [open, purchaseOrder]);

  const selected = useMemo(() => {
    const selectedId = purchaseOrder?.id ?? Number(purchaseOrderId);
    return (eligibleQuery.data ?? []).find(
      (row: any) => row.purchaseOrder.id === selectedId
    );
  }, [eligibleQuery.data, purchaseOrder, purchaseOrderId]);

  const existingRule = (selected as any)?.existingRule;
  useEffect(() => {
    if (!selected) return;
    const rule = (selected as any).existingRule;
    setApplicationMode(rule?.applicationMode ?? "direct");
    setAmortizationMode(rule?.amortizationMode ?? "percentage");
    setAmortizationValue(rule?.amortizationValue ?? "");
    setAmortizationBase(rule?.amortizationBase ?? "subtotal");
  }, [selected?.purchaseOrder.id]);
  useEffect(() => {
    if (requestMode === "percentage" && selected)
      setRequestedAmount(
        Number.isFinite(Number(requestPercent)) && requestPercent
          ? roundDecimalAmount(
              (Number(selected.total) * Number(requestPercent)) / 100,
              2
            ).toFixed(2)
          : ""
      );
  }, [requestMode, requestPercent, selected?.total]);

  async function save() {
    const parsedAmount = Number(requestedAmount);
    if (!selected || !requestedPaymentDate || !Number.isFinite(parsedAmount)) {
      toast.error("Seleccione la OC, fecha e importe del anticipo.");
      return;
    }
    if (!hasAtMostDecimalPlaces(requestedAmount, 2)) {
      toast.error("El importe debe tener como máximo dos decimales.");
      return;
    }
    const amount = parsedAmount;
    const availableAmount = Number(selected.availableAdvanceRequestAmount);
    if (amount <= 0 || amount > availableAmount) {
      toast.error("El importe supera el saldo disponible de la OC.");
      return;
    }
    if (
      applicationMode === "contractual" &&
      (!amortizationValue ||
        Number(amortizationValue) <= 0 ||
        (amortizationMode === "percentage" && Number(amortizationValue) > 100))
    ) {
      toast.error("Defina el porcentaje o monto de amortización contractual.");
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        purchaseOrderId: selected.purchaseOrder.id,
        requestedAmount: amount,
        applicationMode,
        requestedPercentage:
          requestMode === "percentage" ? Number(requestPercent) : undefined,
        amortizationMode:
          applicationMode === "contractual" ? amortizationMode : undefined,
        amortizationValue:
          applicationMode === "contractual"
            ? Number(amortizationValue)
            : undefined,
        amortizationBase:
          applicationMode === "contractual" ? amortizationBase : undefined,
        requestedPaymentDate,
        notes: notes || undefined,
      });
      if (support) {
        try {
          const prepared = await prepareDocumentAttachment(support);
          await uploadMutation.mutateAsync({
            entityType: "purchase_order_advance",
            entityId: created.id,
            category: "otro",
            ...prepared,
          });
        } catch (error) {
          toast.warning(
            `El anticipo fue creado, pero no se pudo cargar el soporte: ${
              error instanceof Error ? error.message : "error desconocido"
            }`
          );
        }
      }
      await Promise.all([
        utils.purchaseOrderAdvances.list.invalidate(),
        utils.purchaseOrderAdvances.eligiblePurchaseOrders.invalidate(),
        utils.treasury.eligibleAdvances.invalidate(),
      ]);
      toast.success(`Anticipo ${created.advanceNumber} creado`);
      onOpenChange(false);
      onSaved?.(created);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo crear el anticipo"
      );
    }
  }

  const pending = createMutation.isPending || uploadMutation.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-1 [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate max-h-[calc(100vh-2rem)] !w-[calc(100vw-1rem)] !max-w-[calc(100vw-1rem)] overflow-y-auto sm:!w-[calc(100vw-3rem)] sm:!max-w-[calc(100vw-3rem)] lg:!max-w-5xl">
        <DialogHeader>
          <DialogTitle>Solicitar anticipo a proveedor</DialogTitle>
          <DialogDescription>
            La solicitud quedará disponible para un lote exclusivo de anticipos
            a proveedores en Tesorería.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          {purchaseOrder ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{purchaseOrder.orderNumber}</div>
              <div className="text-muted-foreground">
                {purchaseOrder.supplierName || "Proveedor"} ·{" "}
                {selected
                  ? `${formatPurchaseOrderCurrency(
                      selected.availableAdvanceRequestAmount,
                      purchaseOrder.currency
                    )} disponible`
                  : eligibleQuery.isLoading
                    ? "Consultando saldo oficial..."
                    : "Sin saldo disponible"}
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Buscar OC, proveedor o proyecto"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Orden de compra</Label>
                <Select
                  value={purchaseOrderId}
                  onValueChange={value => {
                    setPurchaseOrderId(value);
                    const row = (eligibleQuery.data ?? []).find(
                      (entry: any) => entry.purchaseOrder.id === Number(value)
                    ) as any;
                    setRequestedAmount("");
                    setRequestPercent("");
                  }}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Seleccione una OC emitida" />
                  </SelectTrigger>
                  <SelectContent>
                    {(eligibleQuery.data ?? []).map((row: any) => (
                      <SelectItem
                        key={row.purchaseOrder.id}
                        value={String(row.purchaseOrder.id)}
                      >
                        {row.purchaseOrder.orderNumber} · {row.supplier.name} ·{" "}
                        {formatPurchaseOrderCurrency(
                          row.availableAdvanceRequestAmount,
                          row.purchaseOrder.currency
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="advance-treatment">
                Tratamiento del anticipo
              </Label>
              <Select
                value={applicationMode}
                disabled={Boolean(existingRule)}
                onValueChange={value =>
                  setApplicationMode(value as "direct" | "contractual")
                }
              >
                <SelectTrigger id="advance-treatment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct">Aplicación directa</SelectItem>
                  <SelectItem
                    value="contractual"
                    disabled={(selected as any)?.contractualEnabled === false}
                  >
                    Contractual · por avances
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="advance-request-mode">
                Calcular importe solicitado
              </Label>
              <Select
                value={requestMode}
                onValueChange={value =>
                  setRequestMode(value as "amount" | "percentage")
                }
              >
                <SelectTrigger id="advance-request-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">Monto fijo</SelectItem>
                  <SelectItem value="percentage">
                    Porcentaje del total de la orden
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {requestMode === "percentage" ? (
              <div className="min-w-0 space-y-1">
                <Label htmlFor="advance-request-percent">
                  Porcentaje para entregar el anticipo
                </Label>
                <Input
                  id="advance-request-percent"
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={requestPercent}
                  onChange={e => setRequestPercent(e.target.value)}
                />
              </div>
            ) : null}
            {applicationMode === "contractual" ? (
              <>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="advance-amortization-mode">
                    Amortización por factura
                  </Label>
                  <Select
                    value={amortizationMode}
                    disabled={Boolean(existingRule)}
                    onValueChange={value =>
                      setAmortizationMode(value as "percentage" | "amount")
                    }
                  >
                    <SelectTrigger id="advance-amortization-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Porcentaje</SelectItem>
                      <SelectItem value="amount">Monto fijo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="advance-amortization-value">
                    {amortizationMode === "percentage"
                      ? "Porcentaje a amortizar por factura"
                      : "Monto a amortizar por factura"}
                  </Label>
                  <Input
                    id="advance-amortization-value"
                    type="number"
                    min="0.01"
                    step="0.01"
                    disabled={Boolean(existingRule)}
                    value={amortizationValue}
                    onChange={e => setAmortizationValue(e.target.value)}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="advance-amortization-base">
                    Base de amortización
                  </Label>
                  <Select
                    value={amortizationBase}
                    disabled={Boolean(existingRule)}
                    onValueChange={value =>
                      setAmortizationBase(value as "subtotal" | "total")
                    }
                  >
                    <SelectTrigger id="advance-amortization-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subtotal">
                        Subtotal sin impuestos
                      </SelectItem>
                      <SelectItem value="total">Total con impuestos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  La amortización recupera el anticipo por cada factura. La
                  garantía de calidad se retiene y se libera por separado.
                </p>
              </>
            ) : null}
            {existingRule ? (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Se heredan las condiciones de los anticipos activos de esta
                orden.
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Importe solicitado</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={
                  selected
                    ? Number(selected.availableAdvanceRequestAmount)
                    : undefined
                }
                readOnly={requestMode === "percentage"}
                value={requestedAmount}
                onChange={event => setRequestedAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha prevista de pago</Label>
              <Input
                type="date"
                value={requestedPaymentDate}
                onChange={event => setRequestedPaymentDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Motivo u observación</Label>
            <Textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={2000}
            />
          </div>
          <div className="space-y-2">
            <Label>Soporte opcional</Label>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={event => setSupport(event.target.files?.[0])}
            />
            {support && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                {support.name}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => void save()}
            disabled={pending || eligibleQuery.isLoading || !selected}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
