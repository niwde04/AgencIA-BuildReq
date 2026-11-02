import { useState } from "react";
import { FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocumentAttachmentsPanel } from "@/components/DocumentAttachmentsPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatPurchaseOrderCurrency,
  type PurchaseCurrency,
} from "@shared/purchase-orders";
import { billingToday } from "@shared/purchase-order-billing";

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date =
    value instanceof Date
      ? value
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value
        );
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("es-HN");
}

export function PurchaseOrderBillingAuthorization({
  purchaseOrderId,
  currency,
  registeredInvoiceCount,
}: {
  purchaseOrderId: number;
  currency: PurchaseCurrency;
  registeredInvoiceCount: number;
}) {
  const utils = trpc.useUtils();
  const query = trpc.purchaseOrders.billingAuthorization.useQuery({
    id: purchaseOrderId,
  });
  const attachmentsQuery = trpc.attachments.getByEntity.useQuery(
    { entityType: "purchase_order", entityId: purchaseOrderId },
    { enabled: query.data?.canAuthorize === true }
  );
  const [formOpen, setFormOpen] = useState(false);
  const [authorizedUntil, setAuthorizedUntil] = useState("");
  const [additionalInvoiceCount, setAdditionalInvoiceCount] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");
  const [reason, setReason] = useState("");
  const [supportAttachmentId, setSupportAttachmentId] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const refresh = async () => {
    await Promise.all([
      utils.purchaseOrders.billingAuthorization.invalidate({
        id: purchaseOrderId,
      }),
      utils.purchaseOrders.getById.invalidate({ id: purchaseOrderId }),
      utils.purchaseOrders.list.invalidate(),
      utils.purchaseOrders.listPage.invalidate(),
    ]);
  };
  const authorize = trpc.purchaseOrders.authorizeBilling.useMutation({
    onSuccess: async () => {
      toast.success("Autorización de facturación registrada");
      setFormOpen(false);
      setAuthorizedUntil("");
      setAdditionalInvoiceCount("0");
      setMaxAmount("");
      setReason("");
      setSupportAttachmentId("");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const revoke = trpc.purchaseOrders.revokeBillingAuthorization.useMutation({
    onSuccess: async () => {
      toast.success("Autorización revocada");
      setRevokeOpen(false);
      setRevokeReason("");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const active = query.data?.active;
  const attachments = attachmentsQuery.data ?? [];
  const count = Number(additionalInvoiceCount);
  const validCount =
    additionalInvoiceCount.trim() !== "" &&
    Number.isInteger(count) &&
    count >= 0;
  const validAmount =
    maxAmount.trim() === "" ||
    (/^\d+(?:\.\d{1,4})?$/.test(maxAmount.trim()) &&
      Number.isFinite(Number(maxAmount)) &&
      Number(maxAmount) > 0);
  const canSubmit = Boolean(
    authorizedUntil &&
      authorizedUntil >= billingToday() &&
      validCount &&
      validAmount &&
      reason.trim().length >= 10 &&
      supportAttachmentId &&
      !authorize.isPending
  );
  const busy = authorize.isPending || revoke.isPending;
  const prefix = `billing-authorization-${purchaseOrderId}`;

  return (
    <section
      className="min-w-0 space-y-4 rounded-2xl border border-border/70 bg-background p-4"
      aria-labelledby={`${prefix}-title`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3
            id={`${prefix}-title`}
            className="flex items-center gap-2 text-base font-semibold"
          >
            <ShieldCheck aria-hidden="true" className="h-5 w-5 shrink-0" />
            Facturación posterior al contrato
          </h3>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Administración Central puede autorizar nuevas facturas con respaldo
            y límites. La vigencia original del contrato se conserva.
          </p>
        </div>
        {query.data?.canAuthorize && query.data.ready && !active ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 whitespace-normal text-left"
            onClick={() => setFormOpen(value => !value)}
            aria-expanded={formOpen}
            aria-controls={`${prefix}-form`}
          >
            <FileCheck2 aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
            {formOpen ? "Cerrar formulario" : "Autorizar facturación posterior"}
          </Button>
        ) : null}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Cargando autorización…
        </p>
      ) : query.error ? (
        <div className="space-y-2 text-sm" role="alert">
          <p>No se pudo consultar la autorización: {query.error.message}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : !query.data?.ready ? (
        <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
          La autorización de facturación aún no está disponible en este entorno.
        </p>
      ) : active ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline" className="max-w-full whitespace-normal">
              {active.isUsable
                ? "Autorización vigente"
                : "Autorización vencida o agotada"}
            </Badge>
            <span className="text-sm font-semibold">
              Vigente hasta {formatDate(active.authorizedUntil)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <p>
              <span className="block text-xs text-muted-foreground">
                Facturas autorizadas
              </span>
              {active.originalExpectedInvoiceCount}{" "}
              {active.originalExpectedInvoiceCount === 1
                ? "original"
                : "originales"}{" "}
              + {active.additionalInvoiceCount}{" "}
              {active.additionalInvoiceCount === 1
                ? "adicional"
                : "adicionales"}{" "}
              = {active.maxInvoiceCount}
            </p>
            <p>
              <span className="block text-xs text-muted-foreground">
                Disponibles
              </span>
              {Math.max(active.maxInvoiceCount - registeredInvoiceCount, 0)}{" "}
              {active.maxInvoiceCount - registeredInvoiceCount === 1
                ? "factura"
                : "facturas"}
            </p>
            <p>
              <span className="block text-xs text-muted-foreground">
                Importe excepcional disponible ({currency})
              </span>
              {active.remainingAmount == null
                ? "Sin límite de importe autorizado"
                : formatPurchaseOrderCurrency(active.remainingAmount, currency)}
            </p>
          </div>
          <p className="break-words text-sm">{active.reason}</p>
          <p className="break-words text-xs text-muted-foreground">
            Autorizó{" "}
            {active.authorizedByName || `Usuario #${active.authorizedById}`} el{" "}
            {formatDate(active.authorizedAt)} · Respaldo:{" "}
            {active.supportFileName || `Adjunto #${active.supportAttachmentId}`}
          </p>
          {active.maxAmount != null ? (
            <p className="text-xs text-muted-foreground">
              Límite acumulado:{" "}
              {formatPurchaseOrderCurrency(active.maxAmount, currency)} ·
              Utilizado:{" "}
              {formatPurchaseOrderCurrency(active.usedAmount, currency)}
            </p>
          ) : null}
          {query.data?.canAuthorize ? (
            <div className="space-y-3 border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setRevokeOpen(value => !value)}
                aria-expanded={revokeOpen}
                aria-controls={`${prefix}-revoke`}
                disabled={busy}
              >
                Revocar autorización
              </Button>
              {revokeOpen ? (
                <div id={`${prefix}-revoke`} className="space-y-2">
                  <Label htmlFor={`${prefix}-revoke-reason`}>
                    Motivo de revocación
                  </Label>
                  <Textarea
                    id={`${prefix}-revoke-reason`}
                    value={revokeReason}
                    onChange={event => setRevokeReason(event.target.value)}
                    minLength={10}
                    maxLength={2000}
                    rows={3}
                    disabled={busy}
                  />
                  <p className="text-xs text-muted-foreground">
                    Mínimo 10 caracteres. Impide nuevas recepciones
                    excepcionales; conserva las ya registradas.
                  </p>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    disabled={busy || revokeReason.trim().length < 10}
                    onClick={() =>
                      revoke.mutate({
                        id: purchaseOrderId,
                        authorizationId: active.id,
                        reason: revokeReason.trim(),
                      })
                    }
                  >
                    {revoke.isPending ? "Revocando…" : "Confirmar revocación"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No hay una autorización de facturación posterior vigente.
        </p>
      )}

      {formOpen && query.data?.canAuthorize && query.data.ready && !active ? (
        <div
          id={`${prefix}-form`}
          className="space-y-4 rounded-xl border border-border bg-muted/10 p-3"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-until`}>
                Autorización válida hasta
              </Label>
              <Input
                id={`${prefix}-until`}
                type="date"
                min={billingToday()}
                value={authorizedUntil}
                onChange={event => setAuthorizedUntil(event.target.value)}
                disabled={busy}
                aria-describedby={`${prefix}-until-help`}
              />
              <p
                id={`${prefix}-until-help`}
                className="text-xs text-muted-foreground"
              >
                La fecha del documento y el registro de recepción deben estar
                dentro de esta autorización.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-count`}>
                Facturas adicionales autorizadas
              </Label>
              <Input
                id={`${prefix}-count`}
                type="number"
                min="0"
                step="1"
                value={additionalInvoiceCount}
                onChange={event =>
                  setAdditionalInvoiceCount(event.target.value)
                }
                disabled={busy}
                aria-describedby={`${prefix}-count-help`}
              />
              <p
                id={`${prefix}-count-help`}
                className="text-xs text-muted-foreground"
              >
                Se suman a las programadas originalmente. Usa 0 si solo
                autorizas fechas posteriores.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-amount`}>
                Importe máximo acumulado ({currency}, opcional)
              </Label>
              <Input
                id={`${prefix}-amount`}
                type="number"
                min="0.0001"
                step="0.0001"
                inputMode="decimal"
                value={maxAmount}
                onChange={event => setMaxAmount(event.target.value)}
                placeholder="Sin límite adicional de importe"
                disabled={busy}
                aria-describedby={`${prefix}-amount-help`}
              />
              <p
                id={`${prefix}-amount-help`}
                className="text-xs text-muted-foreground"
              >
                Total acumulado de recepciones excepcionales, incluidos
                impuestos y otros cargos, en la moneda de la OC.
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor={`${prefix}-support`}>
                Respaldo adjunto a la OC
              </Label>
              <Select
                value={supportAttachmentId}
                onValueChange={setSupportAttachmentId}
                disabled={busy || attachmentsQuery.isLoading}
              >
                <SelectTrigger
                  id={`${prefix}-support`}
                  className="min-h-11 w-full min-w-0"
                >
                  <SelectValue placeholder="Selecciona un respaldo" />
                </SelectTrigger>
                <SelectContent>
                  {attachments.map(attachment => (
                    <SelectItem
                      key={attachment.id}
                      value={String(attachment.id)}
                    >
                      {attachment.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {attachmentsQuery.error ? (
                <p className="text-xs text-destructive">
                  No se pudieron cargar los adjuntos.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void attachmentsQuery.refetch()}
                  >
                    Reintentar
                  </button>
                </p>
              ) : attachments.length === 0 && !attachmentsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">
                  Adjunta el respaldo de la autorización a continuación.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Selecciona el documento que respalda esta autorización.
                </p>
              )}
            </div>
          </div>
          <DocumentAttachmentsPanel
            entityType="purchase_order"
            entityId={purchaseOrderId}
            category="otro"
            title="Respaldo de la autorización"
            canManage
            canDelete={false}
            billingSupport
            disabled={busy}
            onUploadSuccess={result =>
              setSupportAttachmentId(String(result.id))
            }
          />
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-reason`}>
              Motivo de la autorización
            </Label>
            <Textarea
              id={`${prefix}-reason`}
              value={reason}
              onChange={event => setReason(event.target.value)}
              minLength={10}
              maxLength={2000}
              rows={3}
              placeholder="Explica por qué se autoriza la facturación posterior"
              disabled={busy}
              aria-describedby={`${prefix}-reason-help`}
            />
            <p
              id={`${prefix}-reason-help`}
              className="text-xs text-muted-foreground"
            >
              Obligatorio, mínimo 10 caracteres. La autorización no aprueba ni
              contabiliza las facturas.
            </p>
          </div>
          <Button
            type="button"
            className="min-h-11 max-w-full whitespace-normal"
            disabled={!canSubmit || busy}
            onClick={() =>
              authorize.mutate({
                id: purchaseOrderId,
                authorizedUntil,
                additionalInvoiceCount: count,
                maxAmount: maxAmount.trim() || null,
                reason: reason.trim(),
                supportAttachmentId: Number(supportAttachmentId),
              })
            }
          >
            {authorize.isPending ? (
              <Loader2
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin"
              />
            ) : (
              <ShieldCheck aria-hidden="true" className="mr-2 h-4 w-4" />
            )}{" "}
            {authorize.isPending ? "Autorizando…" : "Guardar autorización"}
          </Button>
        </div>
      ) : null}

      {query.data?.history.length ? (
        <details className="rounded-xl border border-border/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Historial de autorizaciones ({query.data.history.length})
          </summary>
          <div className="mt-3 space-y-3">
            {query.data.history.map(entry => (
              <article
                key={entry.id}
                className="space-y-1 border-t border-border/60 pt-3 text-sm first:border-0 first:pt-0"
              >
                <p className="font-medium">
                  Hasta {formatDate(entry.authorizedUntil)} ·{" "}
                  {entry.additionalInvoiceCount} facturas adicionales
                  {entry.revokedAt
                    ? " · Revocada"
                    : entry.isUsable
                      ? " · Vigente"
                      : " · Vencida o agotada"}
                </p>
                <p className="break-words">{entry.reason}</p>
                <p className="break-words text-xs text-muted-foreground">
                  {entry.authorizedByName || `Usuario #${entry.authorizedById}`}{" "}
                  · {formatDate(entry.authorizedAt)} ·{" "}
                  {entry.supportFileName ||
                    `Adjunto #${entry.supportAttachmentId}`}
                </p>
                {entry.maxAmount != null ? (
                  <p className="text-xs text-muted-foreground">
                    Importe autorizado:{" "}
                    {formatPurchaseOrderCurrency(entry.maxAmount, currency)} ·
                    Utilizado:{" "}
                    {formatPurchaseOrderCurrency(entry.usedAmount, currency)}
                  </p>
                ) : null}
                {entry.revokedAt ? (
                  <p className="break-words text-xs text-muted-foreground">
                    Revocada el {formatDate(entry.revokedAt)}:{" "}
                    {entry.revokeReason}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
