import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function TransferReceiptSourceSelector({
  transferId,
  lineId,
  disabled,
  onBusyChange,
}: {
  transferId: number;
  lineId: number;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<number>();
  const [origin, setOrigin] = useState<string>();
  const [selectedId, setSelectedId] = useState<number>();
  const options = trpc.receipts.transferSourceOptions.useQuery(
    { transferId, lineId, cursor },
    { enabled: open }
  );
  const change = trpc.receipts.changeTransferSource.useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: result => {
      setOrigin(
        `Proyecto ${result.projectCode} · ${result.storageLocation || "Sin ubicación"}`
      );
      setOpen(false);
      setSelectedId(undefined);
      // Refresh when the document is reopened, preserving this receipt's input.
      void utils.transfers.getById.invalidate(
        { id: transferId },
        { refetchType: "none" }
      );
      void utils.transfers.listPage.invalidate();
      void utils.receipts.transferSourceOptions.invalidate({
        transferId,
        lineId,
      });
      toast.success("Origen actualizado. Puede continuar con la recepción.");
    },
    onError: error => toast.error(error.message),
  });
  return (
    <div className="mt-2 space-y-1">
      {origin && (
        <p className="text-xs text-muted-foreground" role="status">
          Origen: {origin}
        </p>
      )}
      <Popover
        open={open}
        onOpenChange={value => {
          if (!change.isPending) {
            setOpen(value);
            setCursor(undefined);
            setSelectedId(undefined);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            disabled={disabled || change.isPending}
          >
            <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" /> Cambiar proyecto
            de origen
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[calc(100vw-2rem)] max-w-sm space-y-3 p-3"
          onInteractOutside={event => {
            if (change.isPending) event.preventDefault();
          }}
        >
          <div>
            <h3 className="text-sm font-semibold">
              Existencias del mismo almacén
            </h3>
            <p className="text-xs text-muted-foreground">
              Seleccione el proyecto y ubicación de donde saldrá este artículo.
              El cambio queda guardado en el traslado.
            </p>
          </div>
          {options.isFetching ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando
              existencias…
            </p>
          ) : options.error ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{options.error.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void options.refetch()}
              >
                Reintentar
              </Button>
            </div>
          ) : !options.data?.items.length ? (
            <p className="text-sm text-muted-foreground">
              No hay existencias disponibles en otros proyectos de este almacén.
            </p>
          ) : (
            <fieldset
              className="max-h-64 space-y-1 overflow-y-auto"
              disabled={change.isPending}
            >
              <legend className="sr-only">
                Proyecto y ubicación de origen
              </legend>
              {options.data.items.map(stock => (
                <label
                  key={stock.id}
                  className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-accent"
                >
                  <input
                    type="radio"
                    name={`transfer-source-${lineId}`}
                    className="mt-1 accent-primary"
                    checked={selectedId === stock.id}
                    onChange={() => setSelectedId(stock.id)}
                  />
                  <span className="min-w-0 break-words">
                    <span className="font-medium">
                      {stock.projectCode} - {stock.projectName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {stock.storageLocation || "Sin ubicación"} · Disponible:{" "}
                      {stock.quantity} {stock.unit || ""}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {(cursor || options.data?.nextCursor) && (
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!cursor || change.isPending}
                onClick={() => {
                  setCursor(undefined);
                  setSelectedId(undefined);
                }}
              >
                Primera página
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={
                  !options.data?.nextCursor ||
                  change.isPending ||
                  options.isFetching
                }
                onClick={() => {
                  setCursor(options.data?.nextCursor ?? undefined);
                  setSelectedId(undefined);
                }}
              >
                Siguiente
              </Button>
            </div>
          )}
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!selectedId || change.isPending || options.isFetching}
            onClick={() =>
              selectedId &&
              change.mutate({ transferId, lineId, inventoryItemId: selectedId })
            }
          >
            {change.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}{" "}
            {change.isPending ? "Guardando…" : "Usar este origen"}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
