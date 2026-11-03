import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  inventoryItems,
  projects,
  receiptItems,
  receipts,
  transferRequestItems,
  transferRequests,
  transfers,
} from "../drizzle/schema";

export type TransferReceiptSourceScope = {
  transferId: number;
  lineId: number;
  projectIds?: number[];
};

type Database = Pick<NodePgDatabase<any>, "select" | "update" | "transaction">;

// A receiving user's access is checked against the transfer destination. The
// exception grants access only to this article in its existing source warehouse.
async function editableLine(
  database: Database,
  input: TransferReceiptSourceScope,
  lock = false
) {
  if (lock) {
    await database
      .select({ id: transfers.id })
      .from(transfers)
      .where(eq(transfers.id, input.transferId))
      .for("update");
  }
  const [row] = await database
    .select({
      line: transferRequestItems,
      request: transferRequests,
      transfer: transfers,
    })
    .from(transfers)
    .innerJoin(
      transferRequests,
      eq(transferRequests.id, transfers.transferRequestId)
    )
    .innerJoin(
      transferRequestItems,
      eq(transferRequestItems.transferRequestId, transferRequests.id)
    )
    .where(
      and(
        eq(transfers.id, input.transferId),
        eq(transferRequestItems.id, input.lineId)
      )
    );
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Ítem de traslado no encontrado",
    });
  const destinationProjectId =
    row.request.destinationType === "proyecto"
      ? row.request.destinationProjectId
      : row.request.projectId;
  if (
    input.projectIds &&
    !input.projectIds.includes(destinationProjectId ?? 0)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a recepciones de otro proyecto",
    });
  }
  if (
    !["confirmado", "en_transito", "parcialmente_recibido"].includes(
      row.transfer.status
    ) ||
    row.request.reverseLogisticId ||
    row.line.receiptClosed ||
    Number(row.line.receivedQuantity || 0) > 0 ||
    Number(row.line.returnedToOriginQuantity || 0) > 0
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Solo puede cambiar el origen de una línea pendiente sin recepciones ni devoluciones",
    });
  }
  if (!row.line.sourceWarehouseId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "El ítem no tiene almacén origen",
    });
  const [history] = await database
    .select({ id: receipts.id })
    .from(receiptItems)
    .innerJoin(receipts, eq(receipts.id, receiptItems.receiptId))
    .where(
      and(
        eq(receipts.sourceType, "transfer"),
        eq(receipts.sourceId, input.transferId),
        eq(receiptItems.sourceItemId, input.lineId),
        sql`${receipts.status} <> 'borrador'`
      )
    )
    .limit(1);
  if (history)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La línea tiene recepciones registradas; su origen histórico no se puede cambiar",
    });
  return row;
}

function stockConditions(line: typeof transferRequestItems.$inferSelect) {
  return [
    eq(inventoryItems.warehouseId, line.sourceWarehouseId ?? 0),
    eq(inventoryItems.isActive, true),
    gt(inventoryItems.currentStock, "0"),
    eq(projects.status, "activo"),
    line.sapItemCode?.trim()
      ? eq(inventoryItems.sapItemCode, line.sapItemCode.trim())
      : sql`lower(${inventoryItems.name}) = lower(${line.itemName})`,
  ];
}

export async function listTransferReceiptSources(
  database: Database,
  input: TransferReceiptSourceScope & { cursor?: number }
) {
  const { line, request } = await editableLine(database, input);
  const conditions = stockConditions(line);
  if (input.cursor) conditions.push(gt(inventoryItems.id, input.cursor));
  if (
    request.destinationType === "proyecto" &&
    request.destinationWarehouseId === line.sourceWarehouseId
  ) {
    conditions.push(
      sql`${inventoryItems.projectId} <> ${request.destinationProjectId}`
    );
  }
  const rows = await database
    .select({
      id: inventoryItems.id,
      projectId: inventoryItems.projectId,
      projectCode: projects.code,
      projectName: projects.name,
      storageLocation: inventoryItems.storageLocation,
      quantity: inventoryItems.currentStock,
      unit: inventoryItems.unit,
    })
    .from(inventoryItems)
    .innerJoin(projects, eq(projects.id, inventoryItems.projectId))
    .where(and(...conditions))
    .orderBy(asc(inventoryItems.id))
    .limit(51);
  const items = rows.slice(0, 50);
  return {
    items,
    nextCursor: rows.length > 50 ? (items[49].id as number) : null,
  };
}

export async function changeTransferReceiptSource(
  database: Database,
  input: TransferReceiptSourceScope & {
    inventoryItemId: number;
    actorId: number;
  }
) {
  return database.transaction(async tx => {
    const { line, request } = await editableLine(tx, input, true);
    const [stock] = await tx
      .select({ inventory: inventoryItems, projectCode: projects.code })
      .from(inventoryItems)
      .innerJoin(projects, eq(projects.id, inventoryItems.projectId))
      .where(
        and(
          eq(inventoryItems.id, input.inventoryItemId),
          ...stockConditions(line)
        )
      )
      .for("update", { of: inventoryItems });
    if (!stock)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "La existencia seleccionada ya no está disponible para este artículo y almacén",
      });
    const origin = stock.inventory;
    if (
      request.destinationType === "proyecto" &&
      request.destinationProjectId === origin.projectId &&
      request.destinationWarehouseId === origin.warehouseId
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "El proyecto y almacén destino no pueden ser los mismos del origen",
      });
    }
    const location = String(origin.storageLocation || "").trim() || null;
    const now = new Date();
    const auditNote = `[${now.toISOString()}] Origen cambiado en recepción por usuario ${input.actorId}: proyecto ${line.sourceProjectId ?? "sin clasificar"}, ubicación ${line.sourceStorageLocation || "Sin ubicación"} → proyecto ${stock.projectCode}, ubicación ${location || "Sin ubicación"}. Existencia #${origin.id}; almacén ${origin.warehouseId}.`;
    await tx
      .update(transferRequestItems)
      .set({
        sourceProjectId: origin.projectId,
        sourceStorageLocation: location,
        notes: [line.notes, auditNote].filter(Boolean).join("\n"),
        updatedAt: now,
      })
      .where(eq(transferRequestItems.id, line.id));
    await tx
      .update(transfers)
      .set({ updatedAt: now })
      .where(eq(transfers.id, input.transferId));
    return {
      success: true as const,
      projectCode: stock.projectCode,
      storageLocation: location,
    };
  });
}
