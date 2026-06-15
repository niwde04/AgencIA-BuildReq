import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  formatAttachmentSize,
  prepareDocumentAttachment,
} from "@/lib/document-attachments";

type DocumentAttachmentEntityType =
  | "invoice"
  | "purchase_order"
  | "receipt"
  | "purchase_request"
  | "transfer_request"
  | "material_request";

type AttachmentCategory =
  | "factura"
  | "orden_compra"
  | "comprobante_entrega"
  | "foto_material"
  | "documento_proveedor"
  | "otro";

type AttachmentItem = {
  id: number;
  fileName: string;
  fileUrl?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};

type UploadResult = {
  id: number;
  url: string;
  fileKey: string;
};

type DocumentAttachmentsPanelProps = {
  entityType: DocumentAttachmentEntityType;
  entityId: number | null | undefined;
  category?: AttachmentCategory;
  title?: string;
  canManage?: boolean;
  canDelete?: boolean;
  className?: string;
  disabled?: boolean;
  onUploadSuccess?: (result: UploadResult) => void;
  onStateChange?: (state: {
    attachments: AttachmentItem[];
    isLoading: boolean;
  }) => void;
};

function getAttachmentIcon(attachment: AttachmentItem) {
  return attachment.mimeType?.startsWith("image/") ? ImageIcon : FileText;
}

export function DocumentAttachmentsPanel({
  entityType,
  entityId,
  category = "otro",
  title = "Adjuntos",
  canManage = false,
  canDelete = canManage,
  className = "",
  disabled = false,
  onUploadSuccess,
  onStateChange,
}: DocumentAttachmentsPanelProps) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const resolvedEntityId = entityId ?? 0;
  const enabled = resolvedEntityId > 0;

  const queryInput = {
    entityType,
    entityId: resolvedEntityId,
  };
  const { data, isLoading } = trpc.attachments.getByEntity.useQuery(
    queryInput,
    { enabled }
  );
  const attachments = (data ?? []) as AttachmentItem[];

  const invalidateAttachments = () => {
    if (!enabled) return;
    void utils.attachments.getByEntity.invalidate(queryInput);
  };

  const uploadMutation = trpc.attachments.upload.useMutation({
    onSuccess: result => {
      toast.success("Adjunto subido");
      invalidateAttachments();
      onUploadSuccess?.(result);
    },
    onError: error => toast.error(error.message),
  });

  const deleteMutation = trpc.attachments.delete.useMutation({
    onSuccess: () => {
      toast.success("Adjunto eliminado");
      invalidateAttachments();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    onStateChange?.({
      attachments,
      isLoading: isLoading || processing || uploadMutation.isPending,
    });
  }, [attachments, isLoading, onStateChange, processing, uploadMutation.isPending]);

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !enabled) return;

    setProcessing(true);
    try {
      const prepared = await prepareDocumentAttachment(file);
      uploadMutation.mutate({
        entityType,
        entityId: resolvedEntityId,
        fileName: prepared.fileName,
        fileData: prepared.fileData,
        mimeType: prepared.mimeType,
        fileSize: prepared.fileSize,
        category,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo preparar el archivo"
      );
    } finally {
      setProcessing(false);
    }
  };

  const isBusy = processing || uploadMutation.isPending;
  const uploadDisabled = !enabled || disabled || isBusy;

  return (
    <section
      className={`min-w-0 space-y-3 rounded-2xl border border-border/70 p-4 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {canManage ? (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={uploadDisabled}
            >
              <Upload className="mr-2 h-4 w-4" />
              {isBusy ? "Subiendo..." : "Adjuntar"}
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Cargando adjuntos...
        </div>
      ) : attachments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Sin archivos adjuntos.
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map(attachment => {
            const AttachmentIcon = getAttachmentIcon(attachment);
            return (
              <div
                key={attachment.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 p-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <AttachmentIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <a
                      href={attachment.fileUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium hover:text-primary"
                    >
                      {attachment.fileName}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {formatAttachmentSize(attachment.fileSize)}
                    </p>
                  </div>
                </div>
                {canDelete ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => deleteMutation.mutate({ id: attachment.id })}
                    disabled={deleteMutation.isPending}
                    aria-label={`Eliminar ${attachment.fileName}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
