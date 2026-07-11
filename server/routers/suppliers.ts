import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { storageDelete, storageGet, storagePut } from "../storage";
import { validateDocumentAttachmentFile } from "./attachments";
import { applyProjectScope, canAccessProject } from "../projectAccess";

function canReadSuppliers(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    canManageSupplierCatalog(user) ||
    user.buildreqRole === "administrador_proyecto" ||
    user.buildreqRole === "bodeguero_proyecto" ||
    user.buildreqRole === "contable"
  );
}

function canManageSupplierCatalog(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    user.role === "admin" ||
    user.buildreqRole === "jefe_bodega_central" ||
    user.buildreqRole === "administracion_central"
  );
}

function canCreateSupplierCatalog(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return user.role === "admin" || user.buildreqRole === "administracion_central";
}

function canManageSupplierContacts(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    canManageSupplierCatalog(user) ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canManageSupplierFiscalProfile(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    canManageSupplierCatalog(user) ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function canManageSupplierDocuments(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  return (
    canManageSupplierCatalog(user) ||
    user.buildreqRole === "administrador_proyecto"
  );
}

function assertCanReadSuppliers(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canReadSuppliers(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene acceso al catálogo de proveedores",
    });
  }
}

function assertCanManageSupplierCatalog(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  assertCanReadSuppliers(user);

  if (!canManageSupplierCatalog(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para modificar el catálogo de proveedores",
    });
  }
}

function assertCanCreateSupplierCatalog(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  assertCanReadSuppliers(user);

  if (!canCreateSupplierCatalog(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo Administración Central puede crear proveedores",
    });
  }
}

function assertCanManageSupplierContacts(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  if (!canManageSupplierContacts(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar contactos de proveedores",
    });
  }
}

function assertCanManageSupplierFiscalProfile(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  assertCanReadSuppliers(user);

  if (!canManageSupplierFiscalProfile(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para modificar datos fiscales del proveedor",
    });
  }
}

function assertCanManageSupplierDocuments(user: {
  role?: string | null;
  buildreqRole?: string | null;
}) {
  assertCanReadSuppliers(user);

  if (!canManageSupplierDocuments(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tiene permisos para gestionar documentos de proveedores",
    });
  }
}

function assertProjectContactAccess(
  user: {
    role?: string | null;
    buildreqRole?: string | null;
    assignedProjectId?: number | null;
    assignedProjectIds?: number[] | null;
  },
  projectId?: number | null
) {
  if (user.role === "admin" || user.buildreqRole !== "administrador_proyecto") {
    return;
  }

  if (
    !projectId ||
    !canAccessProject({ ...user, role: user.role ?? "user" }, projectId)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo puede gestionar contactos del proyecto asignado",
    });
  }
}

const supplierContactTypeSchema = z.enum([
  "ventas",
  "compras",
  "cobros",
  "logistica",
  "administracion",
  "otro",
]);

const optionalEmailSchema = z
  .string()
  .trim()
  .email("Ingrese un correo válido")
  .or(z.literal(""))
  .optional();

const supplierContactBaseSchema = z.object({
  projectId: z.number().int().positive(),
  contactType: supplierContactTypeSchema,
  branchName: z.string().trim().max(255).optional(),
  name: z.string().trim().min(1, "Ingrese el nombre del contacto").max(255),
  phone: z.string().trim().max(80).optional(),
  email: optionalEmailSchema,
  address: z.string().trim().max(1000).optional(),
  isActive: z.boolean(),
});

const supplierContactPayloadSchema = supplierContactBaseSchema.extend({
  contactType: supplierContactTypeSchema.default("ventas"),
  isActive: z.boolean().default(true),
});

const supplierCreateSchema = z.object({
  supplierCode: z
    .string()
    .trim()
    .min(1, "Ingrese el código del proveedor")
    .max(50),
  name: z.string().trim().min(1, "Ingrese el nombre del proveedor").max(500),
  email: optionalEmailSchema,
  rtn: z.string().trim().max(50).optional(),
  address: z.string().trim().max(1000).optional(),
  allowsTaxWithholding: z.boolean().default(true),
  subjectToAccountPayments: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const supplierDocumentExpirationModeSchema = z.enum([
  "required",
  "optional",
  "none",
]);

const supplierDocumentTypePayloadSchema = z.object({
  code: z.string().trim().max(80).optional(),
  name: z.string().trim().min(1, "Ingrese el nombre del tipo").max(255),
  description: z.string().trim().max(1000).optional(),
  expirationMode: supplierDocumentExpirationModeSchema.default("optional"),
  isActive: z.boolean().default(true),
});

const supplierDocumentTypeUpdateSchema =
  supplierDocumentTypePayloadSchema.partial().extend({
    id: z.number().int().positive(),
  });

const supplierDocumentCreateSchema = z.object({
  supplierId: z.number().int().positive(),
  documentTypeId: z.number().int().positive(),
  documentDate: z.string().trim().min(1, "Ingrese la fecha del documento"),
  expirationDate: z.string().trim().optional(),
  description: z.string().trim().max(1000).optional(),
  fileName: z.string().trim().min(1).max(255),
  fileData: z.string().min(1),
  mimeType: z.string().trim().min(1).max(100),
  fileSize: z.number().int().positive(),
});

const supplierDocumentUpdateSchema = z.object({
  id: z.number().int().positive(),
  documentTypeId: z.number().int().positive().optional(),
  documentDate: z.string().trim().min(1).optional(),
  expirationDate: z.string().trim().optional(),
  description: z.string().trim().max(1000).optional(),
});

const supplierExcelImportSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, "Seleccione un archivo")
    .max(255)
    .refine(value => /\.xlsx$/i.test(value), {
      message: "Seleccione un archivo .xlsx",
    }),
  fileBase64: z.string().min(1, "No se pudo leer el archivo").max(15_000_000),
});

async function assertSupplierAndProjectExist(supplierId: number, projectId: number) {
  const [supplier, project] = await Promise.all([
    db.getSupplierById(supplierId),
    db.getProjectById(projectId),
  ]);
  if (!supplier) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Proveedor no encontrado",
    });
  }
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Proyecto no encontrado",
    });
  }
}

function slugifyDocumentTypeCode(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function parseDateInput(value: string, fieldLabel: string) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${fieldLabel} debe tener formato AAAA-MM-DD`,
    });
  }

  const date = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${fieldLabel} no es valida`,
    });
  }

  return date;
}

function parseOptionalDateInput(value: string | undefined, fieldLabel: string) {
  if (!value?.trim()) return null;
  return parseDateInput(value, fieldLabel);
}

function toDateOnlyTime(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function getSupplierDocumentStatus(expirationDate?: Date | null) {
  if (!expirationDate) return "sin_vencimiento" as const;
  return toDateOnlyTime(expirationDate) < toDateOnlyTime(new Date())
    ? ("vencido" as const)
    : ("vigente" as const);
}

function normalizeSupplierDocumentDates(params: {
  documentType: { expirationMode: "required" | "optional" | "none" };
  documentDate: Date;
  expirationDate: Date | null;
}) {
  if (params.documentType.expirationMode === "required" && !params.expirationDate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Ingrese la fecha de vencimiento para este tipo de documento",
    });
  }

  if (params.documentType.expirationMode === "none") {
    return { documentDate: params.documentDate, expirationDate: null };
  }

  return {
    documentDate: params.documentDate,
    expirationDate: params.expirationDate,
  };
}

async function serializeSupplierDocument(row: db.SupplierDocumentListRow) {
  const { url } = await storageGet(row.attachment.fileKey);
  return {
    ...row.document,
    status: getSupplierDocumentStatus(row.document.expirationDate),
    documentType: row.documentType,
    attachment: { ...row.attachment, fileUrl: url },
    createdBy: row.createdBy,
  };
}

export const suppliersRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          isActive: z.boolean().optional(),
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(10).max(200).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      assertCanReadSuppliers(ctx.user);
      return db.listSupplierCatalog(input ?? {});
    }),

  analyzeExcelImport: protectedProcedure
    .input(supplierExcelImportSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanCreateSupplierCatalog(ctx.user);
      return db.analyzeSupplierExcelImport(input);
    }),

  importExcel: protectedProcedure
    .input(supplierExcelImportSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanCreateSupplierCatalog(ctx.user);
      return db.importSupplierExcel(input, { userId: ctx.user.id });
    }),

  create: protectedProcedure
    .input(supplierCreateSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanCreateSupplierCatalog(ctx.user);
      return db.createSupplier({
        supplierCode: input.supplierCode.trim().toUpperCase(),
        name: input.name.trim(),
        email: input.email?.trim().toLowerCase() || null,
        rtn: input.rtn?.trim() || null,
        address: input.address?.trim() || null,
        allowsTaxWithholding: input.allowsTaxWithholding,
        subjectToAccountPayments: input.subjectToAccountPayments,
        isActive: input.isActive,
        demoBatchKey: null,
        createdById: ctx.user.id,
        updatedById: ctx.user.id,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        rtn: z.string().trim().max(50).optional(),
        address: z.string().trim().max(1000).optional(),
        allowsTaxWithholding: z.boolean().optional(),
        subjectToAccountPayments: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierFiscalProfile(ctx.user);
      const data: Parameters<typeof db.updateSupplier>[1] = {};
      if (
        ctx.user.buildreqRole === "administrador_proyecto" &&
        input.rtn !== undefined
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No tiene permisos para modificar el RTN del proveedor",
        });
      }
      if (input.rtn !== undefined) {
        data.rtn = input.rtn.trim() || null;
      }
      if (input.address !== undefined) {
        data.address = input.address.trim() || null;
      }
      const hasValidAccountPaymentCertificate =
        await db.hasValidSupplierAccountPaymentCertificate(input.id);
      if (
        hasValidAccountPaymentCertificate &&
        (input.allowsTaxWithholding !== undefined ||
          input.subjectToAccountPayments !== undefined)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La constancia de pagos a cuenta vigente no permite modificar estos valores fiscales",
        });
      }
      if (input.allowsTaxWithholding !== undefined) {
        data.allowsTaxWithholding = input.allowsTaxWithholding;
      }
      if (input.subjectToAccountPayments !== undefined) {
        data.subjectToAccountPayments = input.subjectToAccountPayments;
      }
      data.updatedById = ctx.user.id;
      return db.updateSupplier(input.id, {
        ...data,
      });
    }),

  listDocumentTypes: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      assertCanManageSupplierDocuments(ctx.user);
      return db.listSupplierDocumentTypes(input ?? {});
    }),

  createDocumentType: protectedProcedure
    .input(supplierDocumentTypePayloadSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierCatalog(ctx.user);
      const code = slugifyDocumentTypeCode(input.code || input.name);
      if (!code) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ingrese un codigo valido para el tipo de documento",
        });
      }

      return db.createSupplierDocumentType({
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        expirationMode: input.expirationMode,
        isActive: input.isActive,
      });
    }),

  updateDocumentType: protectedProcedure
    .input(supplierDocumentTypeUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierCatalog(ctx.user);
      const data: Parameters<typeof db.updateSupplierDocumentType>[1] = {};
      if (input.code !== undefined) {
        const code = slugifyDocumentTypeCode(input.code);
        if (!code) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ingrese un codigo valido para el tipo de documento",
          });
        }
        data.code = code;
      }
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.description !== undefined) {
        data.description = input.description?.trim() || null;
      }
      if (input.expirationMode !== undefined) {
        data.expirationMode = input.expirationMode;
      }
      if (input.isActive !== undefined) data.isActive = input.isActive;

      return db.updateSupplierDocumentType(input.id, data);
    }),

  deactivateDocumentType: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierCatalog(ctx.user);
      return db.updateSupplierDocumentType(input.id, { isActive: false });
    }),

  listDocuments: protectedProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      assertCanManageSupplierDocuments(ctx.user);
      const supplier = await db.getSupplierById(input.supplierId);
      if (!supplier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proveedor no encontrado",
        });
      }
      const documents = await db.listSupplierDocuments(input.supplierId);
      return Promise.all(documents.map(serializeSupplierDocument));
    }),

  createDocument: protectedProcedure
    .input(supplierDocumentCreateSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierDocuments(ctx.user);
      const [supplier, documentType] = await Promise.all([
        db.getSupplierById(input.supplierId),
        db.getSupplierDocumentTypeById(input.documentTypeId),
      ]);
      if (!supplier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Proveedor no encontrado",
        });
      }
      if (!documentType || !documentType.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione un tipo de documento activo",
        });
      }

      const dates = normalizeSupplierDocumentDates({
        documentType,
        documentDate: parseDateInput(input.documentDate, "La fecha del documento"),
        expirationDate: parseOptionalDateInput(
          input.expirationDate,
          "La fecha de vencimiento"
        ),
      });

      const buffer = Buffer.from(input.fileData, "base64");
      const validated = validateDocumentAttachmentFile({
        fileName: input.fileName,
        mimeType: input.mimeType,
        buffer,
      });
      const fileKey = `buildreq/supplier/${input.supplierId}/${nanoid()}-${validated.fileName}`;

      let attachmentId: number | undefined;
      try {
        const { url } = await storagePut(fileKey, buffer, validated.mimeType);
        const attachment = await db.createAttachment({
          entityType: "supplier",
          entityId: input.supplierId,
          fileName: validated.fileName,
          fileKey,
          fileUrl: url,
          mimeType: validated.mimeType,
          fileSize: validated.fileSize,
          category: "documento_proveedor",
          uploadedById: ctx.user.id,
        });
        attachmentId = attachment.id;

        const document = await db.createSupplierDocument({
          supplierId: input.supplierId,
          documentTypeId: input.documentTypeId,
          attachmentId,
          documentDate: dates.documentDate,
          expirationDate: dates.expirationDate,
          description: input.description?.trim() || null,
          createdById: ctx.user.id,
        });
        const row = await db.getSupplierDocumentById(document.id);
        if (!row) {
          throw new Error("Documento del proveedor no encontrado");
        }
        return serializeSupplierDocument(row);
      } catch (error) {
        if (attachmentId) {
          await db.deleteAttachment(attachmentId).catch(() => undefined);
        }
        await storageDelete(fileKey).catch(() => undefined);
        throw error;
      }
    }),

  updateDocument: protectedProcedure
    .input(supplierDocumentUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierDocuments(ctx.user);
      const current = await db.getSupplierDocumentById(input.id);
      if (!current) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento del proveedor no encontrado",
        });
      }

      const documentType =
        input.documentTypeId && input.documentTypeId !== current.document.documentTypeId
          ? await db.getSupplierDocumentTypeById(input.documentTypeId)
          : current.documentType;
      if (!documentType || !documentType.isActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Seleccione un tipo de documento activo",
        });
      }

      const documentDate =
        input.documentDate !== undefined
          ? parseDateInput(input.documentDate, "La fecha del documento")
          : current.document.documentDate;
      const expirationDate =
        input.expirationDate !== undefined
          ? parseOptionalDateInput(input.expirationDate, "La fecha de vencimiento")
          : current.document.expirationDate;
      const dates = normalizeSupplierDocumentDates({
        documentType,
        documentDate,
        expirationDate,
      });

      const updated = await db.updateSupplierDocument(input.id, {
        documentTypeId: documentType.id,
        documentDate: dates.documentDate,
        expirationDate: dates.expirationDate,
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
      });
      const row = await db.getSupplierDocumentById(updated.id);
      if (!row) {
        throw new Error("Documento del proveedor no encontrado");
      }
      return serializeSupplierDocument(row);
    }),

  deleteDocument: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierDocuments(ctx.user);
      const document = await db.getSupplierDocumentById(input.id);
      if (!document) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento del proveedor no encontrado",
        });
      }

      await storageDelete(document.attachment.fileKey);
      await db.deleteAttachment(document.attachment.id);
      return { success: true };
    }),

  listContacts: protectedProcedure
    .input(
      z.object({
        supplierId: z.number().int().positive(),
        projectId: z.number().int().positive().optional(),
        includeInactive: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      assertCanManageSupplierContacts(ctx.user);
      assertProjectContactAccess(ctx.user, input.projectId);
      return db.listSupplierContacts(applyProjectScope(input, ctx.user));
    }),

  createContact: protectedProcedure
    .input(
      supplierContactPayloadSchema.extend({
        supplierId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierContacts(ctx.user);
      assertProjectContactAccess(ctx.user, input.projectId);
      await assertSupplierAndProjectExist(input.supplierId, input.projectId);
      return db.createSupplierContact({
        supplierId: input.supplierId,
        projectId: input.projectId,
        contactType: input.contactType,
        branchName: input.branchName?.trim() || null,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        isActive: input.isActive,
      });
    }),

  updateContact: protectedProcedure
    .input(
      supplierContactBaseSchema
        .partial()
        .extend({ id: z.number().int().positive() })
    )
    .mutation(async ({ ctx, input }) => {
      assertCanManageSupplierContacts(ctx.user);
      const contact = await db.getSupplierContactById(input.id);
      if (!contact) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contacto no encontrado",
        });
      }
      assertProjectContactAccess(ctx.user, contact.projectId);
      if (input.projectId) {
        assertProjectContactAccess(ctx.user, input.projectId);
        await assertSupplierAndProjectExist(contact.supplierId, input.projectId);
      }

      return db.updateSupplierContact(input.id, {
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.contactType !== undefined
          ? { contactType: input.contactType }
          : {}),
        ...(input.branchName !== undefined
          ? { branchName: input.branchName?.trim() || null }
          : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined
          ? { phone: input.phone?.trim() || null }
          : {}),
        ...(input.email !== undefined
          ? { email: input.email?.trim() || null }
          : {}),
        ...(input.address !== undefined
          ? { address: input.address?.trim() || null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      });
    }),
});
