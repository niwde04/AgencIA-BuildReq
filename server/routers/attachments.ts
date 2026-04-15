import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { storagePut, storageGet } from "../storage";
import { nanoid } from "nanoid";

export const attachmentsRouter = router({
  getByEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum([
          "material_request",
          "supply_flow",
          "reverse_logistic",
          "purchase_request",
          "purchase_order",
          "transfer_request",
          "transfer",
          "receipt",
        ]),
        entityId: z.number(),
      })
    )
    .query(async ({ input }) => {
      return db.getAttachmentsByEntity(input.entityType, input.entityId);
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ fileKey: z.string() }))
    .query(async ({ input }) => {
      const result = await storageGet(input.fileKey);
      return { url: result.url };
    }),

  upload: protectedProcedure
    .input(
      z.object({
        entityType: z.enum([
          "material_request",
          "supply_flow",
          "reverse_logistic",
          "purchase_request",
          "purchase_order",
          "transfer_request",
          "transfer",
          "receipt",
        ]),
        entityId: z.number(),
        fileName: z.string(),
        fileData: z.string(), // base64 encoded
        mimeType: z.string(),
        fileSize: z.number(),
        category: z
          .enum([
            "factura",
            "orden_compra",
            "comprobante_entrega",
            "foto_material",
            "documento_proveedor",
            "otro",
          ])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileData, "base64");
      const fileKey = `buildreq/${input.entityType}/${input.entityId}/${nanoid()}-${input.fileName}`;

      const { url } = await storagePut(fileKey, buffer, input.mimeType);

      const result = await db.createAttachment({
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: input.fileName,
        fileKey,
        fileUrl: url,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        category: input.category,
        uploadedById: ctx.user.id,
      });

      return { id: result.id, url, fileKey };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteAttachment(input.id);
    }),
});
