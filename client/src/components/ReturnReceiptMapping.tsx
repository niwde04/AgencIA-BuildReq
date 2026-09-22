import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function ReturnReceiptMapping({
  returnId,
  receiptId,
  items,
}: {
  returnId: number;
  receiptId: number;
  items: Array<{
    id: number;
    itemName: string;
    quantity: string;
    sourceReceiptItemId?: number | null;
  }>;
}) {
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Record<number, number>>({});
  const receipt = trpc.receipts.getById.useQuery({ id: receiptId });
  const save = trpc.reverseLogistics.mapReceiptItems.useMutation({
    onSuccess: () => {
      toast.success("Renglones de recepción vinculados");
      void utils.reverseLogistics.getById.invalidate({ id: returnId });
    },
    onError: e => toast.error(e.message),
  });
  return (
    <section className="rounded-lg border border-border bg-muted/20 p-4">
      <h3 className="font-semibold">Vincular materiales con la recepción</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Esta devolución fue creada sin el renglón de origen. Selecciónelo para
        proponer los importes de la nota de crédito.
      </p>
      {receipt.error ? (
        <p className="text-sm text-destructive">{receipt.error.message}</p>
      ) : (
        items.map(item => (
          <div key={item.id} className="mt-3 space-y-2">
            <Label htmlFor={`return-source-${item.id}`}>
              {item.itemName} · {item.quantity}
            </Label>
            <select
              id={`return-source-${item.id}`}
              className="h-11 w-full rounded-md border bg-background px-3 text-sm"
              value={selected[item.id] ?? item.sourceReceiptItemId ?? ""}
              onChange={e =>
                setSelected({ ...selected, [item.id]: Number(e.target.value) })
              }
            >
              <option value="">Seleccione renglón recibido</option>
              {receipt.data?.items.map(row => (
                <option key={row.id} value={row.id}>
                  {row.id} · {row.itemName} · recibido {row.quantityReceived}
                </option>
              ))}
            </select>
          </div>
        ))
      )}
      <Button
        className="mt-4"
        disabled={
          save.isPending ||
          receipt.isLoading ||
          items.some(i => !(selected[i.id] ?? i.sourceReceiptItemId))
        }
        onClick={() =>
          save.mutate({
            id: returnId,
            mappings: items.map(i => ({
              itemId: i.id,
              sourceReceiptItemId: selected[i.id] ?? i.sourceReceiptItemId!,
            })),
          })
        }
      >
        {save.isPending ? "Guardando…" : "Guardar vínculos"}
      </Button>
    </section>
  );
}
