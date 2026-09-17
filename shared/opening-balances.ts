import { z } from "zod";

export const openingBalanceItemSchema = z.object({
  sapItemCode: z.string().trim().min(1).max(50),
  itemName: z.string().trim().min(1).max(500),
  quantity: z
    .string()
    .trim()
    .refine(
      value =>
        /^\d+(?:\.\d{1,2})?$/.test(value) &&
        Number(value) > 0 &&
        Number(value) < 10_000_000_000,
      "La cantidad debe ser mayor que cero y tener como máximo dos decimales"
    ),
  projectId: z.number().int().positive().optional(),
  storageLocation: z.string().trim().max(255).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export function normalizeOpeningBalanceItems(
  items: z.input<typeof openingBalanceItemSchema>[],
  defaultProjectId: number
) {
  return z
    .array(openingBalanceItemSchema)
    .min(1)
    .parse(items)
    .map(item => ({
      ...item,
      projectId: item.projectId ?? defaultProjectId,
      quantity: Number(item.quantity).toFixed(2),
      storageLocation: item.storageLocation || null,
      unit: item.unit || null,
      notes: item.notes || null,
    }));
}

export type OpeningBalanceItemInput = z.input<typeof openingBalanceItemSchema>;
