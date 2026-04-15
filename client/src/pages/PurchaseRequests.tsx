import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { downloadBase64Document } from "@/lib/document-download";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, FileUp, ShoppingCart, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  parcialmente_convertida: "Parcialmente convertida",
  convertida: "Convertida",
  anulada: "Anulada",
};

export default function PurchaseRequests() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editNeededBy, setEditNeededBy] = useState("");
  const [editPurchaseType, setEditPurchaseType] = useState<"local" | "extranjera">("local");
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [emailDialog, setEmailDialog] = useState<{
    to: string;
    subject: string;
    content: string;
  } | null>(null);

  const { data: requests, isLoading } = trpc.purchaseRequests.list.useQuery();
  const { data: detail } = trpc.purchaseRequests.getById.useQuery(
    { id: selectedId ?? 0 },
    { enabled: Boolean(selectedId) }
  );

  const canReject =
    user?.role === "admin" || (user as any)?.buildreqRole === "administrador_proyecto";
  const canConvert =
    user?.role === "admin" || (user as any)?.buildreqRole === "administracion_central";

  const updateMutation = trpc.purchaseRequests.update.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra actualizada");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const rejectMutation = trpc.purchaseRequests.reject.useMutation({
    onSuccess: () => {
      toast.success("Solicitud de compra anulada");
      setRejectReason("");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const convertMutation = trpc.purchaseOrders.createFromPurchaseRequest.useMutation({
    onSuccess: (result) => {
      toast.success(`OC ${result.purchaseOrderNumber} generada`);
      setSelectedItemIds([]);
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        utils.purchaseOrders.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const attachQuoteMutation = trpc.purchaseRequests.attachQuote.useMutation({
    onSuccess: () => {
      toast.success("Cotización aprobada adjuntada");
      void Promise.all([
        utils.purchaseRequests.list.invalidate(),
        selectedId ? utils.purchaseRequests.getById.invalidate({ id: selectedId }) : Promise.resolve(),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadMutation = trpc.attachments.upload.useMutation({
    onSuccess: (result) => {
      if (!selectedId) return;
      attachQuoteMutation.mutate({
        id: selectedId,
        attachmentId: result.id,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const selectedItems = useMemo(() => {
    return detail?.items ?? [];
  }, [detail]);

  const openRequest = (id: number) => {
    setSelectedId(id);
    const row = requests?.find((entry: any) => entry.purchaseRequest.id === id);
    setEditNotes(row?.purchaseRequest.notes || "");
    setEditNeededBy(
      row?.purchaseRequest.neededBy
        ? new Date(row.purchaseRequest.neededBy).toISOString().slice(0, 10)
        : ""
    );
    setEditPurchaseType((row?.purchaseRequest.purchaseType || "local") as "local" | "extranjera");
    setSelectedItemIds([]);
    setRejectReason("");
  };

  const handleQuoteUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        entityType: "purchase_request",
        entityId: selectedId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
        category: "documento_proveedor",
      });
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1>Solicitudes de Compra</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando solicitudes de compra...
            </div>
          ) : !(requests || []).length ? (
            <div className="p-8 text-center text-muted-foreground">
              No hay solicitudes de compra registradas
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      No. Solicitud
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proyecto
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Tipo de Compra
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Doc SAP
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Estatus
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Fecha necesaria
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Documento
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(requests || []).map((row: any) => (
                    <tr key={row.purchaseRequest.id} className="border-b border-border last:border-0">
                      <td className="p-3 font-medium">{row.purchaseRequest.requestNumber}</td>
                      <td className="p-3 text-xs">
                        {row.project ? `${row.project.code} — ${row.project.name}` : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.purchaseType === "local"
                          ? "Compra Local"
                          : "Compra Extranjera"}
                      </td>
                      <td className="p-3 text-xs">{row.purchaseRequest.sapDocumentNumber || "—"}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {STATUS_LABELS[row.purchaseRequest.status] || row.purchaseRequest.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.neededBy
                          ? new Date(row.purchaseRequest.neededBy).toLocaleDateString("es-HN")
                          : "—"}
                      </td>
                      <td className="p-3 text-xs">
                        {row.purchaseRequest.printedDocumentContent ? "Listo" : "Pendiente"}
                      </td>
                      <td className="p-3 text-right">
                        <Button variant="outline" size="sm" onClick={() => openRequest(row.purchaseRequest.id)}>
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
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {detail?.purchaseRequest.requestNumber || "Solicitud de Compra"}
            </DialogTitle>
          </DialogHeader>

          {detail && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Tipo de compra</Label>
                  <Select
                    value={editPurchaseType}
                    onValueChange={(value) =>
                      setEditPurchaseType(value as "local" | "extranjera")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Compra Local</SelectItem>
                      <SelectItem value="extranjera">Compra Extranjera</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha necesaria</Label>
                  <Input
                    type="date"
                    value={editNeededBy}
                    onChange={(event) => setEditNeededBy(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Estatus</Label>
                  <div className="h-10 rounded-md border border-border px-3 flex items-center">
                    <Badge variant="outline">
                      {STATUS_LABELS[detail.purchaseRequest.status] || detail.purchaseRequest.status}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Notas</Label>
                <Textarea
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  rows={3}
                />
              </div>

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {canConvert && (
                        <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          A OC
                        </th>
                      )}
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ítem
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        SAP
                      </th>
                      <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cantidad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItems.map((item: any) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        {canConvert && (
                          <td className="p-3">
                            <Checkbox
                              checked={selectedItemIds.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setSelectedItemIds((current) =>
                                  checked
                                    ? [...current, item.id]
                                    : current.filter((entry) => entry !== item.id)
                                );
                              }}
                            />
                          </td>
                        )}
                        <td className="p-3">{item.itemName}</td>
                        <td className="p-3 text-xs font-mono">
                          {item.currentSapItemCode || item.originalSapItemCode || "—"}
                        </td>
                        <td className="p-3 text-right">
                          {item.quantity} {item.unit || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const downloaded = downloadBase64Document({
                        base64: detail.purchaseRequest.printedDocumentContent,
                        fileName: detail.purchaseRequest.printedDocumentName,
                        mimeType: detail.purchaseRequest.printedDocumentMimeType,
                      });
                      if (!downloaded) toast.error("La SC no tiene documento generado");
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Descargar documento
                  </Button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleQuoteUpload}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending || attachQuoteMutation.isPending}
                  >
                    <FileUp className="mr-2 h-4 w-4" />
                    Adjuntar cotización
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateMutation.mutate({
                        id: detail.purchaseRequest.id,
                        purchaseType: editPurchaseType,
                        neededBy: editNeededBy || undefined,
                        notes: editNotes || undefined,
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    Guardar cambios
                  </Button>

                  {canReject && (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (rejectReason.trim().length < 5) {
                          toast.error("Indica un motivo de al menos 5 caracteres");
                          return;
                        }
                        rejectMutation.mutate({
                          id: detail.purchaseRequest.id,
                          reason: rejectReason,
                        });
                      }}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Anular SC
                    </Button>
                  )}

                  {canConvert && (
                    <Button
                      onClick={() =>
                        convertMutation.mutate({
                          purchaseRequestId: detail.purchaseRequest.id,
                          selectedItemIds:
                            selectedItemIds.length > 0
                              ? selectedItemIds
                              : selectedItems.map((item: any) => item.id),
                          classification: "oc",
                        })
                      }
                      disabled={convertMutation.isPending}
                    >
                      <ShoppingCart className="mr-2 h-4 w-4" />
                      Convertir a OC
                    </Button>
                  )}
                </div>
              </div>

              {canReject && (
                <div className="space-y-2">
                  <Label>Motivo de anulación</Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    placeholder="Explique por qué se anula la solicitud de compra"
                    rows={2}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(emailDialog)} onOpenChange={() => setEmailDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Correo preparado</DialogTitle>
          </DialogHeader>
          {emailDialog && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Para</Label>
                <p className="text-sm font-medium">{emailDialog.to}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Asunto</Label>
                <p className="text-sm font-medium">{emailDialog.subject}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Contenido</Label>
                <div className="rounded-md bg-muted p-3 whitespace-pre-wrap text-sm">
                  {emailDialog.content}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
