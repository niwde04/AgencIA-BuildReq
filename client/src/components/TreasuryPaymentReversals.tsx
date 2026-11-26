import { useRef, useState, type MouseEvent } from "react";
import { formatPurchaseOrderCurrency } from "@shared/purchase-orders";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export type TreasuryReversalCause = "no_disbursement" | "bank_return";

export type TreasuryReversalRequest = {
  id: number;
  status: "pending" | "approved" | "rejected";
  requestedById: number;
  decidedById: number | null;
  decisionComment: string | null;
  cause: TreasuryReversalCause;
  amountCents: number;
  createdAt: Date | string;
  decidedAt: Date | string | null;
  evidenceAttachmentId: number;
  items: { paymentItemId: number; reason: string; amountCents: number }[];
};

type EvidenceAttachment = {
  fileName: string;
  mimeType: string;
  base64: string;
};
type AttachmentLink = { id: number; fileUrl: string; fileName: string };
export type TreasuryReversalItem = {
  id: number;
  status: string;
  invoiceDocumentNumber: string;
  orderNumber?: string | null;
  invoiceNumber?: string | null;
  bankPaidAmount: number | string | null;
  purchaseOrderAdvanceId?: number | null;
  reversalHoldId?: number | null;
  advanceCancelledAt?: Date | string | null;
  bankPaidDate?: Date | string | null;
  sourceType?: string;
  accountedAt?: Date | string | null;
};

export const TREASURY_REVERSAL_CAUSE_LABELS: Record<
  TreasuryReversalCause,
  string
> = {
  no_disbursement: "El banco no desembolsó el pago",
  bank_return: "Reverso o devolución bancaria confirmada",
};

const statusLabels: Record<TreasuryReversalRequest["status"], string> = {
  pending: "Pendiente de decisión",
  approved: "Aprobada",
  rejected: "Rechazada",
};

function documentLabel(item: TreasuryReversalItem | undefined) {
  if (!item) return "Línea del lote";
  const order = item.orderNumber ?? item.invoiceNumber;
  return order
    ? `${item.invoiceDocumentNumber} · ${order}`
    : item.invoiceDocumentNumber;
}

export function TreasuryPaymentReversals({
  batchId,
  batchNumber,
  canRequest,
  canDecide,
  approvalsEnabled,
  currentUserId,
  currency,
  items,
  requests,
  attachments,
  prepareAttachment,
  formatDate,
  onChange,
}: {
  batchId: number;
  batchNumber: string;
  canRequest: boolean;
  canDecide: boolean;
  approvalsEnabled: boolean;
  currentUserId?: number;
  currency: "HNL" | "USD";
  items: TreasuryReversalItem[];
  requests: TreasuryReversalRequest[];
  attachments: AttachmentLink[];
  prepareAttachment: (file: File) => Promise<EvidenceAttachment>;
  formatDate: (value: Date | string) => string;
  onChange: () => Promise<void>;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string>();
  const [cause, setCause] = useState<TreasuryReversalCause>();
  const [selectedItems, setSelectedItems] = useState<Map<number, string>>(
    new Map()
  );
  const [evidence, setEvidence] = useState<EvidenceAttachment>();
  const [readingEvidence, setReadingEvidence] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [decision, setDecision] = useState<{
    request: TreasuryReversalRequest;
    action: "approve" | "reject";
  }>();
  const [heldItem, setHeldItem] = useState<TreasuryReversalItem>();
  const [comment, setComment] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const pendingRequest = requests.find(request => request.status === "pending");
  const paidItems = items.filter(
    item => item.status === "pagada" && Number(item.bankPaidAmount) > 0
  );
  const eligibleItems = paidItems.filter(
    item =>
      item.sourceType === "purchase_order_advance" &&
      item.purchaseOrderAdvanceId &&
      item.bankPaidDate &&
      !item.advanceCancelledAt &&
      !item.reversalHoldId
  );
  const requestAvailable =
    canRequest && !pendingRequest && eligibleItems.length > 0;
  const selectedRows = eligibleItems.filter(item => selectedItems.has(item.id));
  const totalCents = paidItems.reduce(
    (total, item) => total + Math.round(Number(item.bankPaidAmount) * 100),
    0
  );
  const selectedCents = selectedRows.reduce(
    (total, item) => total + Math.round(Number(item.bankPaidAmount) * 100),
    0
  );
  const heldItems = items.filter(
    item =>
      item.status === "revertida" &&
      item.reversalHoldId &&
      item.purchaseOrderAdvanceId &&
      !item.advanceCancelledAt &&
      requests.some(
        request =>
          request.status === "approved" &&
          request.id === item.reversalHoldId &&
          request.items.some(line => line.paymentItemId === item.id)
      )
  );
  const formatCents = (cents: number) =>
    formatPurchaseOrderCurrency(cents / 100, currency);

  const submit = trpc.treasury.submitPaymentReversal.useMutation({
    onSuccess: async () => {
      setClientRequestId(undefined);
      toast.success("Solicitud enviada a Contabilidad");
      await onChange();
    },
    onError: error => toast.error(error.message),
  });
  const decide = trpc.treasury.decidePaymentReversal.useMutation({
    onSuccess: async (_, input) => {
      setDecision(undefined);
      toast.success(
        input.decision === "approve"
          ? "Reversión aprobada"
          : "Solicitud rechazada"
      );
      await onChange();
    },
    onError: error => toast.error(error.message),
  });
  const release = trpc.purchaseOrderAdvances.releaseReversalHold.useMutation({
    onSuccess: async () => {
      setHeldItem(undefined);
      toast.success("Bloqueo de reprogramación liberado");
      await onChange();
    },
    onError: error => toast.error(error.message),
  });

  function restoreFocus(event: Event) {
    event.preventDefault();
    if (triggerRef.current?.isConnected) triggerRef.current.focus();
    else headingRef.current?.focus();
  }

  function openRequest(event: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = event.currentTarget;
    setCause(undefined);
    setSelectedItems(new Map());
    setEvidence(undefined);
    setAttachmentError("");
    setClientRequestId(crypto.randomUUID());
  }

  function setLineSelection(itemId: number, selected: boolean) {
    setSelectedItems(current => {
      const next = new Map(current);
      if (selected) next.set(itemId, current.get(itemId) ?? "");
      else next.delete(itemId);
      return next;
    });
  }

  const validSelection =
    selectedRows.length > 0 &&
    selectedRows.length <= 500 &&
    selectedRows.every(
      item => (selectedItems.get(item.id)?.trim().length ?? 0) >= 5
    );

  if (!requestAvailable && !requests.length && !heldItems.length) return null;

  return (
    <section className="space-y-3" aria-label="Reversiones de pago">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="font-semibold">
          Reversiones de pago
        </h3>
        {requestAvailable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={submit.isPending}
            onClick={openRequest}
          >
            Solicitar reversión
          </Button>
        )}
      </div>
      {pendingRequest && (
        <Alert>
          <AlertTitle>Solicitud pendiente de Contabilidad</AlertTitle>
          <AlertDescription>
            La corrección del pago y la contabilización están pausadas hasta que
            se tome una decisión.
          </AlertDescription>
        </Alert>
      )}
      {requests.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {requests.map(request => {
            const support = attachments.find(
              attachment => attachment.id === request.evidenceAttachmentId
            );
            const canDecideRequest =
              canDecide &&
              request.status === "pending" &&
              request.requestedById !== currentUserId;
            return (
              <article
                key={request.id}
                className="space-y-2 rounded-md border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge
                    variant={
                      request.status === "approved" ? "default" : "outline"
                    }
                  >
                    {statusLabels[request.status]}
                  </Badge>
                  <span className="font-medium">
                    {formatCents(request.amountCents)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(request.createdAt)} ·{" "}
                    {TREASURY_REVERSAL_CAUSE_LABELS[request.cause]}
                  </span>
                </div>
                <ul className="space-y-1">
                  {request.items.map(line => (
                    <li key={line.paymentItemId} className="break-words">
                      <span className="font-medium">
                        {documentLabel(
                          items.find(item => item.id === line.paymentItemId)
                        )}
                      </span>
                      {" · "}
                      {formatCents(line.amountCents)}
                      {" · "}
                      {line.reason}
                    </li>
                  ))}
                </ul>
                {request.decidedAt && (
                  <p className="break-words text-muted-foreground">
                    Decisión del {formatDate(request.decidedAt)}
                    {request.decisionComment
                      ? ` · ${request.decisionComment}`
                      : ""}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {support && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={support.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver evidencia
                      </a>
                    </Button>
                  )}
                  {canDecideRequest && (
                    <>
                      {approvalsEnabled && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={decide.isPending}
                          onClick={event => {
                            triggerRef.current = event.currentTarget;
                            setComment("");
                            setDecision({ request, action: "approve" });
                          }}
                        >
                          Aprobar reversión
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        onClick={event => {
                          triggerRef.current = event.currentTarget;
                          setComment("");
                          setDecision({ request, action: "reject" });
                        }}
                      >
                        Rechazar solicitud
                      </Button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {heldItems.map(item => (
        <div
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
        >
          <span>{documentLabel(item)} · Reprogramación bloqueada</span>
          {canDecide && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={release.isPending}
              onClick={event => {
                triggerRef.current = event.currentTarget;
                setComment("");
                setEvidenceNote("");
                setHeldItem(item);
              }}
            >
              Liberar bloqueo
            </Button>
          )}
        </div>
      ))}

      <Dialog
        open={Boolean(clientRequestId)}
        onOpenChange={open => {
          if (!open && !submit.isPending && !readingEvidence)
            setClientRequestId(undefined);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>Solicitar reversión de pago</DialogTitle>
            <DialogDescription>
              {batchNumber} · Seleccione los anticipos, documente cada motivo y
              adjunte el soporte bancario. Contabilidad decide si aplica la
              reversión.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={event => {
              event.preventDefault();
              if (
                !requestAvailable ||
                !clientRequestId ||
                !cause ||
                !evidence ||
                !validSelection ||
                submit.isPending ||
                readingEvidence
              )
                return;
              submit.mutate({
                batchId,
                clientRequestId,
                cause,
                attachment: evidence,
                items: selectedRows.map(item => ({
                  itemId: item.id,
                  reason: (selectedItems.get(item.id) ?? "").trim(),
                })),
              });
            }}
          >
            <div className="space-y-2">
              <Label id="treasury-reversal-cause-label">Motivo bancario</Label>
              <Select
                value={cause ?? ""}
                onValueChange={value =>
                  setCause(value as TreasuryReversalCause)
                }
                disabled={submit.isPending}
              >
                <SelectTrigger aria-labelledby="treasury-reversal-cause-label">
                  <SelectValue placeholder="Seleccione la situación confirmada" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_disbursement">
                    {TREASURY_REVERSAL_CAUSE_LABELS.no_disbursement}
                  </SelectItem>
                  <SelectItem value="bank_return">
                    {TREASURY_REVERSAL_CAUSE_LABELS.bank_return}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-2" disabled={submit.isPending}>
              <legend className="text-sm font-medium">Anticipos pagados</legend>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="treasury-reversal-select-all"
                  checked={
                    selectedRows.length === eligibleItems.length &&
                    eligibleItems.length > 0
                      ? true
                      : selectedRows.length > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={checked =>
                    setSelectedItems(current =>
                      checked === true
                        ? new Map(
                            eligibleItems.map(item => [
                              item.id,
                              current.get(item.id) ?? "",
                            ])
                          )
                        : new Map()
                    )
                  }
                />
                <Label htmlFor="treasury-reversal-select-all">
                  Seleccionar todos
                </Label>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {eligibleItems.map(item => (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`treasury-reversal-item-${item.id}`}
                        checked={selectedItems.has(item.id)}
                        onCheckedChange={checked =>
                          setLineSelection(item.id, checked === true)
                        }
                      />
                      <Label htmlFor={`treasury-reversal-item-${item.id}`}>
                        {documentLabel(item)} ·{" "}
                        {formatPurchaseOrderCurrency(
                          Number(item.bankPaidAmount),
                          currency
                        )}
                      </Label>
                    </div>
                    {selectedItems.has(item.id) && (
                      <div className="space-y-1">
                        <Label htmlFor={`treasury-reversal-reason-${item.id}`}>
                          Motivo de {item.invoiceDocumentNumber}
                        </Label>
                        <Textarea
                          id={`treasury-reversal-reason-${item.id}`}
                          rows={2}
                          value={selectedItems.get(item.id)}
                          minLength={5}
                          maxLength={2000}
                          required
                          onChange={event => {
                            const reason = event.target.value;
                            setSelectedItems(current =>
                              new Map(current).set(item.id, reason)
                            );
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
            {selectedRows.length > 500 && (
              <p role="alert" className="text-sm text-destructive">
                Puede enviar hasta 500 anticipos por solicitud.
              </p>
            )}
            <p className="rounded-md bg-muted p-3 text-sm" aria-live="polite">
              {selectedRows.length} seleccionados · {formatCents(selectedCents)}{" "}
              a revertir · {formatCents(totalCents - selectedCents)} de pago
              vigente tras aprobar
            </p>
            <div className="space-y-2">
              <Label htmlFor="treasury-reversal-evidence">
                Evidencia bancaria
              </Label>
              <Input
                id="treasury-reversal-evidence"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx"
                disabled={submit.isPending || readingEvidence}
                aria-describedby={
                  attachmentError
                    ? "treasury-reversal-evidence-error"
                    : undefined
                }
                onChange={async event => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  setEvidence(undefined);
                  setAttachmentError("");
                  if (!file) return;
                  setReadingEvidence(true);
                  try {
                    setEvidence(await prepareAttachment(file));
                  } catch (error) {
                    input.value = "";
                    setAttachmentError(
                      error instanceof Error
                        ? error.message
                        : "No se pudo preparar el soporte."
                    );
                  } finally {
                    setReadingEvidence(false);
                  }
                }}
              />
              {readingEvidence && (
                <p className="text-sm text-muted-foreground" role="status">
                  Preparando evidencia…
                </p>
              )}
              {attachmentError && (
                <p
                  id="treasury-reversal-evidence-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {attachmentError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={submit.isPending || readingEvidence}
                onClick={() => setClientRequestId(undefined)}
              >
                Cerrar
              </Button>
              <Button
                type="submit"
                disabled={
                  !requestAvailable ||
                  !cause ||
                  !evidence ||
                  !validSelection ||
                  submit.isPending ||
                  readingEvidence
                }
              >
                {submit.isPending ? "Enviando…" : "Enviar a Contabilidad"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(decision)}
        onOpenChange={open => {
          if (!open && !decide.isPending) setDecision(undefined);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>
              {decision?.action === "approve"
                ? "Aprobar reversión"
                : "Rechazar solicitud de reversión"}
            </DialogTitle>
            <DialogDescription>
              {batchNumber} ·{" "}
              {decision ? formatCents(decision.request.amountCents) : ""}
              {decision?.action === "approve"
                ? " · Se revertirán los pagos seleccionados y se bloqueará la reprogramación de esos anticipos."
                : " · Los pagos seguirán vigentes."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              if (
                !decision ||
                decide.isPending ||
                (decision.action === "reject" && comment.trim().length < 5)
              )
                return;
              decide.mutate({
                batchId,
                reversalId: decision.request.id,
                decision: decision.action,
                comment: comment.trim(),
              });
            }}
          >
            <Label htmlFor="treasury-reversal-decision-comment">
              {decision?.action === "approve"
                ? "Comentario (opcional)"
                : "Motivo del rechazo"}
            </Label>
            <Textarea
              id="treasury-reversal-decision-comment"
              value={comment}
              maxLength={2000}
              disabled={decide.isPending}
              onChange={event => setComment(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => setDecision(undefined)}
              >
                Volver
              </Button>
              <Button
                type="submit"
                disabled={
                  decide.isPending ||
                  (decision?.action === "reject" && comment.trim().length < 5)
                }
              >
                {decide.isPending
                  ? "Guardando…"
                  : decision?.action === "approve"
                    ? "Aprobar reversión"
                    : "Rechazar solicitud"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(heldItem)}
        onOpenChange={open => {
          if (!open && !release.isPending) setHeldItem(undefined);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader>
            <DialogTitle>Liberar bloqueo de reprogramación</DialogTitle>
            <DialogDescription>
              {documentLabel(heldItem)} volverá a estar disponible para pago si
              tiene saldo y cumple las demás reglas de Tesorería.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={event => {
              event.preventDefault();
              if (
                !heldItem?.purchaseOrderAdvanceId ||
                !heldItem.reversalHoldId ||
                release.isPending ||
                comment.trim().length < 5 ||
                evidenceNote.trim().length < 5
              )
                return;
              release.mutate({
                id: heldItem.purchaseOrderAdvanceId,
                reversalId: heldItem.reversalHoldId,
                reason: comment.trim(),
                evidenceNote: evidenceNote.trim(),
              });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="treasury-reversal-hold-reason">
                Motivo de la liberación
              </Label>
              <Textarea
                id="treasury-reversal-hold-reason"
                value={comment}
                maxLength={2000}
                disabled={release.isPending}
                onChange={event => setComment(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="treasury-reversal-hold-support">
                Justificación del nuevo pago
              </Label>
              <Textarea
                id="treasury-reversal-hold-support"
                value={evidenceNote}
                maxLength={2000}
                disabled={release.isPending}
                onChange={event => setEvidenceNote(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={release.isPending}
                onClick={() => setHeldItem(undefined)}
              >
                Volver
              </Button>
              <Button
                type="submit"
                disabled={
                  release.isPending ||
                  comment.trim().length < 5 ||
                  evidenceNote.trim().length < 5
                }
              >
                {release.isPending ? "Guardando…" : "Liberar bloqueo"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
