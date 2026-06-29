import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { storageDelete, storageGet, storagePut } from "../storage";
import { canAccessProject } from "../projectAccess";

const PDF_MAX_BYTES = 10 * 1000 * 1000;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const attachmentEntityTypeSchema = z.enum([
  "material_request",
  "supply_flow",
  "reverse_logistic",
  "purchase_request",
  "purchase_order",
  "transfer_request",
  "transfer",
  "receipt",
  "invoice",
  "supplier",
]);

const documentAttachmentEntityTypeSchema = z.enum([
  "material_request",
  "purchase_request",
  "purchase_order",
  "transfer_request",
  "receipt",
  "invoice",
  "supplier",
]);

const attachmentCategorySchema = z.enum([
  "factura",
  "orden_compra",
  "comprobante_entrega",
  "foto_material",
  "documento_proveedor",
  "otro",
]);

type AttachmentEntityType = z.infer<typeof attachmentEntityTypeSchema>;
type DocumentAttachmentEntityType = z.infer<
  typeof documentAttachmentEntityTypeSchema
>;

type BuildReqUser = {
  id: number;
  role: string;
  buildreqRole?: string | null;
  assignedProjectId?: number | null;
  assignedProjectIds?: number[] | null;
};

const DOCUMENT_ATTACHMENT_ENTITY_TYPES = new Set<AttachmentEntityType>(
  documentAttachmentEntityTypeSchema.options
);

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isDocumentAttachmentEntityType(
  entityType: AttachmentEntityType
): entityType is DocumentAttachmentEntityType {
  return DOCUMENT_ATTACHMENT_ENTITY_TYPES.has(entityType);
}

function normalizeMimeType(value: string) {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getFileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim() || "adjunto";
  const cleaned = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 140) || "adjunto";
}

function hasPdfSignature(buffer: Buffer) {
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

function hasJpegSignature(buffer: Buffer) {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

function hasPngSignature(buffer: Buffer) {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function hasWebpSignature(buffer: Buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  );
}

export function validateDocumentAttachmentFile(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const mimeType = normalizeMimeType(input.mimeType);
  const extension = getFileExtension(input.fileName);
  const size = input.buffer.byteLength;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Solo se permiten archivos PDF o imagenes JPG, PNG y WebP",
    });
  }

  if (mimeType === "application/pdf") {
    if (extension !== "pdf" || !hasPdfSignature(input.buffer)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El archivo no parece ser un PDF valido",
      });
    }
    if (size > PDF_MAX_BYTES) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El PDF no puede superar 10 MB",
      });
    }
  }

  if (mimeType === "image/jpeg") {
    if (!["jpg", "jpeg"].includes(extension) || !hasJpegSignature(input.buffer)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El archivo no parece ser una imagen JPG valida",
      });
    }
  }

  if (mimeType === "image/png") {
    if (extension !== "png" || !hasPngSignature(input.buffer)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El archivo no parece ser una imagen PNG valida",
      });
    }
  }

  if (mimeType === "image/webp") {
    if (extension !== "webp" || !hasWebpSignature(input.buffer)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El archivo no parece ser una imagen WebP valida",
      });
    }
  }

  if (mimeType.startsWith("image/") && size > IMAGE_MAX_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "La imagen comprimida no puede superar 5 MB",
    });
  }

  return {
    fileName: sanitizeFileName(input.fileName),
    mimeType,
    fileSize: size,
  };
}

function assertProjectScopedAccess(
  user: BuildReqUser,
  projectId: number,
  message: string
) {
  if (user.role === "admin") return;
  if (
    user.buildreqRole !== "administrador_proyecto" &&
    user.buildreqRole !== "bodeguero_proyecto"
  ) {
    return;
  }
  if (!canAccessProject(user, projectId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message,
    });
  }
}

function canManageInvoiceAttachments(user: BuildReqUser) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canReadSuppliers(user: BuildReqUser) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

async function assertInvoiceAttachmentAccess(
  id: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const detail = await db.getInvoiceById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Factura no encontrada",
    });
  }

  assertProjectScopedAccess(
    user,
    detail.invoice.projectId,
    "No tiene acceso a adjuntos de facturas de otro proyecto"
  );
  if (action === "manage") {
    if (!canManageInvoiceAttachments(user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene permisos para administrar adjuntos de facturas",
      });
    }
    if (
      detail.invoice.status !== "borrador" &&
      detail.invoice.status !== "rechazada"
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Solo se pueden modificar adjuntos de facturas en borrador o rechazadas",
      });
    }
  }
}

function canAccessPurchaseOrders(user: BuildReqUser) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "jefe_bodega_central"
  );
}

function canManagePurchaseOrderAttachments(user: BuildReqUser) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

async function assertPurchaseOrderAttachmentAccess(
  id: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const detail = await db.getPurchaseOrderById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Orden de compra no encontrada",
    });
  }

  if (!canAccessPurchaseOrders(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a órdenes de compra",
    });
  }
  assertProjectScopedAccess(
    user,
    detail.purchaseOrder.projectId,
    "No tiene acceso a adjuntos de órdenes de compra de otro proyecto"
  );

  if (action === "manage") {
    if (!canManagePurchaseOrderAttachments(user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No tiene permisos para administrar adjuntos de órdenes de compra",
      });
    }
    if (["recibida", "anulada"].includes(detail.purchaseOrder.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No se pueden modificar adjuntos de órdenes recibidas o anuladas",
      });
    }
  }
}

function canAccessReceipts(user: BuildReqUser) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto"
  );
}

async function assertReceiptAttachmentAccess(
  id: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const detail = await db.getReceiptById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Recepcion no encontrada",
    });
  }

  if (!canAccessReceipts(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a recepciones",
    });
  }
  if (detail.receipt.projectId) {
    assertProjectScopedAccess(
      user,
      detail.receipt.projectId,
      "No tiene acceso a adjuntos de recepciones de otro proyecto"
    );
  }

  if (action === "manage" && !canAccessReceipts(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para administrar adjuntos de recepciones",
    });
  }
}

async function mirrorReceiptAttachmentToInvoice(params: {
  receiptId: number;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  fileSize: number;
  uploadedById: number;
}) {
  const detail = await db.getReceiptById(params.receiptId);
  const invoice = detail?.invoice;
  if (!invoice || !["borrador", "rechazada"].includes(invoice.status)) return;

  const fileKey = `buildreq/invoice/${invoice.id}/${nanoid()}-${params.fileName}`;
  const { url } = await storagePut(fileKey, params.buffer, params.mimeType);

  await db.createAttachment({
    entityType: "invoice",
    entityId: invoice.id,
    fileName: params.fileName,
    fileKey,
    fileUrl: url,
    mimeType: params.mimeType,
    fileSize: params.fileSize,
    category: "factura",
    uploadedById: params.uploadedById,
  });
}

function canAccessPurchaseRequests(user: BuildReqUser) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central" ||
    user.buildreqRole === "administrador_proyecto"
  );
}

async function assertPurchaseRequestAttachmentAccess(
  id: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const detail = await db.getPurchaseRequestById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Solicitud de compra no encontrada",
    });
  }

  if (!canAccessPurchaseRequests(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a solicitudes de compra",
    });
  }
  if (
    user.role !== "admin" &&
    user.buildreqRole === "administrador_proyecto" &&
    !canAccessProject(user, detail.purchaseRequest.projectId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a adjuntos de solicitudes de compra de otro proyecto",
    });
  }

  if (action === "manage") {
    if (["convertida", "anulada", "rechazada"].includes(detail.purchaseRequest.status)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La solicitud de compra ya no permite modificar adjuntos",
      });
    }
  }
}

function canAccessMaterialRequest(user: BuildReqUser, request: any) {
  if (user.role === "admin") return true;
  if (user.buildreqRole === "ingeniero_residente") {
    return request.requestedById === user.id;
  }
  if (
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "superintendente"
  ) {
    return canAccessProject(user, request.projectId);
  }
  return (
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canManageMaterialRequestAttachment(user: BuildReqUser, request: any) {
  if (!canAccessMaterialRequest(user, request)) return false;
  return ![
    "anulada",
    "cerrada",
    "cerrada_incompleta",
    "flujo_completado",
    "rechazada",
  ].includes(String(request.status ?? ""));
}

async function assertMaterialRequestAttachmentAccess(
  id: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const detail = await db.getMaterialRequestById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Requisicion no encontrada",
    });
  }

  if (!canAccessMaterialRequest(user, detail.request)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a adjuntos de esta requisicion",
    });
  }

  if (action === "manage" && !canManageMaterialRequestAttachment(user, detail.request)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para administrar adjuntos de esta requisicion",
    });
  }
}

async function assertTransferRequestAttachmentAccess(id: number) {
  const detail = await db.getTransferRequestById(id);
  if (!detail) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Solicitud de traslado no encontrada",
    });
  }
}

async function assertSupplierAttachmentAccess(
  id: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const supplier = await db.getSupplierById(id);
  if (!supplier) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Proveedor no encontrado",
    });
  }

  if (!canReadSuppliers(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso a documentos del proveedor",
    });
  }

  if (action === "manage" && !canReadSuppliers(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para administrar documentos del proveedor",
    });
  }
}

async function assertDocumentAttachmentAccess(
  entityType: DocumentAttachmentEntityType,
  entityId: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  switch (entityType) {
    case "invoice":
      return assertInvoiceAttachmentAccess(entityId, user, action);
    case "purchase_order":
      return assertPurchaseOrderAttachmentAccess(entityId, user, action);
    case "receipt":
      return assertReceiptAttachmentAccess(entityId, user, action);
    case "purchase_request":
      return assertPurchaseRequestAttachmentAccess(entityId, user, action);
    case "material_request":
      return assertMaterialRequestAttachmentAccess(entityId, user, action);
    case "transfer_request":
      return assertTransferRequestAttachmentAccess(entityId);
    case "supplier":
      return assertSupplierAttachmentAccess(entityId, user, action);
    default:
      return undefined;
  }
}

async function assertAttachmentRecordAccess(
  attachmentId: number,
  user: BuildReqUser,
  action: "view" | "manage"
) {
  const attachment = await db.getAttachmentById(attachmentId);
  if (!attachment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Adjunto no encontrado",
    });
  }

  if (isDocumentAttachmentEntityType(attachment.entityType as AttachmentEntityType)) {
    await assertDocumentAttachmentAccess(
      attachment.entityType as DocumentAttachmentEntityType,
      attachment.entityId,
      user,
      action
    );
  }
  if (
    action === "manage" &&
    attachment.entityType === "transfer_request" &&
    user.role !== "admin" &&
    attachment.uploadedById !== user.id
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo puede eliminar adjuntos de traslado subidos por su usuario",
    });
  }

  return attachment;
}

export const attachmentsRouter = router({
  getByEntity: protectedProcedure
    .input(
      z.object({
        entityType: attachmentEntityTypeSchema,
        entityId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (isDocumentAttachmentEntityType(input.entityType)) {
        await assertDocumentAttachmentAccess(
          input.entityType,
          input.entityId,
          ctx.user,
          "view"
        );
      }
      const attachments = await db.getAttachmentsByEntity(
        input.entityType,
        input.entityId
      );
      return Promise.all(
        attachments.map(async attachment => {
          const { url } = await storageGet(attachment.fileKey);
          return { ...attachment, fileUrl: url };
        })
      );
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const attachment = await assertAttachmentRecordAccess(
        input.id,
        ctx.user,
        "view"
      );
      const result = await storageGet(attachment.fileKey);
      return { url: result.url };
    }),

  upload: protectedProcedure
    .input(
      z.object({
        entityType: attachmentEntityTypeSchema,
        entityId: z.number(),
        fileName: z.string().trim().min(1).max(255),
        fileData: z.string().min(1),
        mimeType: z.string().trim().min(1).max(100),
        fileSize: z.number().int().positive(),
        category: attachmentCategorySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.entityType === "supplier") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use la seccion de documentos del proveedor para subir este adjunto",
        });
      }

      if (!isDocumentAttachmentEntityType(input.entityType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este tipo de adjunto no esta habilitado para documentos",
        });
      }

      await assertDocumentAttachmentAccess(
        input.entityType,
        input.entityId,
        ctx.user,
        "manage"
      );

      const buffer = Buffer.from(input.fileData, "base64");
      const validated = validateDocumentAttachmentFile({
        fileName: input.fileName,
        mimeType: input.mimeType,
        buffer,
      });
      const fileKey = `buildreq/${input.entityType}/${input.entityId}/${nanoid()}-${validated.fileName}`;

      const { url } = await storagePut(fileKey, buffer, validated.mimeType);

      const result = await db.createAttachment({
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: validated.fileName,
        fileKey,
        fileUrl: url,
        mimeType: validated.mimeType,
        fileSize: validated.fileSize,
        category: input.category,
        uploadedById: ctx.user.id,
      });

      if (input.entityType === "receipt") {
        await mirrorReceiptAttachmentToInvoice({
          receiptId: input.entityId,
          fileName: validated.fileName,
          buffer,
          mimeType: validated.mimeType,
          fileSize: validated.fileSize,
          uploadedById: ctx.user.id,
        });
      }

      return { id: result.id, url, fileKey };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const attachment = await assertAttachmentRecordAccess(
        input.id,
        ctx.user,
        "manage"
      );
      await storageDelete(attachment.fileKey);
      return db.deleteAttachment(input.id);
    }),
});
