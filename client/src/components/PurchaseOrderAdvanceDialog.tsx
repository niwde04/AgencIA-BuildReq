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
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";

type FixedPurchaseOrder = {
  id: number;
  orderNumber: string;
  currency: "HNL" | "USD";
  total: number;
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
  const [requestedPaymentDate, setRequestedPaymentDate] = useState("");
  const [notes, setNotes] = useState("");
  const [support, setSupport] = useState<File>();
  const eligibleQuery =
    trpc.purchaseOrderAdvances.eligiblePurchaseOrders.useQuery(
      { search: search || undefined },
      { enabled: open && !purchaseOrder }
    );
  const uploadMutation = trpc.attachments.upload.useMutation();
  const createMutation = trpc.purchaseOrderAdvances.create.useMutation();

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPurchaseOrderId(purchaseOrder ? String(purchaseOrder.id) : "");
    setRequestedAmount("");
    setRequestedPaymentDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setSupport(undefined);
  }, [open, purchaseOrder]);

  const selected = useMemo(() => {
    if (purchaseOrder) {
      return {
        purchaseOrder: {
          id: purchaseOrder.id,
          orderNumber: purchaseOrder.orderNumber,
          currency: purchaseOrder.currency,
        },
        supplier: { name: purchaseOrder.supplierName ?? "" },
        availableAdvanceRequestAmount: purchaseOrder.total,
      };
    }
    return (eligibleQuery.data ?? []).find(
      (row: any) => row.purchaseOrder.id === Number(purchaseOrderId)
    );
  }, [eligibleQuery.data, purchaseOrder, purchaseOrderId]);

  async function save() {
    const amount = Number(requestedAmount);
    if (!selected || !requestedPaymentDate || !Number.isFinite(amount)) {
      toast.error("Seleccione la OC, fecha e importe del anticipo.");
      return;
    }
    if (
      amount <= 0 ||
      amount > Number(selected.availableAdvanceRequestAmount) + 0.0001
    ) {
      toast.error("El importe supera el saldo disponible de la OC.");
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        purchaseOrderId: selected.purchaseOrder.id,
        requestedAmount: amount,
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

  const pending =
    createMutation.isPending || uploadMutation.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Solicitar anticipo de OC</DialogTitle>
          <DialogDescription>
            La solicitud quedará disponible para un lote exclusivo de
            anticipos en Tesorería.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {purchaseOrder ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{purchaseOrder.orderNumber}</div>
              <div className="text-muted-foreground">
                {purchaseOrder.supplierName || "Proveedor"} ·{" "}
                {formatPurchaseOrderCurrency(
                  purchaseOrder.total,
                  purchaseOrder.currency
                )}{" "}
                disponible
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
                      (entry: any) =>
                        entry.purchaseOrder.id === Number(value)
                    ) as any;
                    if (row) {
                      setRequestedAmount(
                        Number(row.availableAdvanceRequestAmount).toFixed(2)
                      );
                    }
                  }}
                >
                  <SelectTrigger>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Importe solicitado</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={selected?.availableAdvanceRequestAmount}
                value={requestedAmount}
                onChange={event => setRequestedAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Fecha prevista de pago</Label>
              <Input
                type="date"
                value={requestedPaymentDate}
                onChange={event =>
                  setRequestedPaymentDate(event.target.value)
                }
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
          <Button onClick={() => void save()} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
