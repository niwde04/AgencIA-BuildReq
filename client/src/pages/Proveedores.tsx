import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Switch } from "@/components/ui/switch";
import {
  formatAttachmentSize,
  prepareDocumentAttachment,
} from "@/lib/document-attachments";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type SupplierRecord = {
  id: number;
  supplierCode: string;
  name: string;
  email?: string | null;
  rtn?: string | null;
  address?: string | null;
  allowsTaxWithholding: boolean;
  subjectToAccountPayments: boolean;
  isActive: boolean;
};

type ContactType =
  | "ventas"
  | "compras"
  | "cobros"
  | "logistica"
  | "administracion"
  | "otro";

type SupplierContactRecord = {
  id: number;
  supplierId: number;
  projectId: number;
  contactType: ContactType;
  branchName?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  isActive: boolean;
};

type SupplierDocumentExpirationMode = "required" | "optional" | "none";

type SupplierDocumentTypeRecord = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  expirationMode: SupplierDocumentExpirationMode;
  isActive: boolean;
};

type SupplierDocumentRecord = {
  id: number;
  supplierId: number;
  documentTypeId: number;
  documentDate: string | Date;
  expirationDate?: string | Date | null;
  description?: string | null;
  status: "vigente" | "vencido" | "sin_vencimiento";
  documentType: SupplierDocumentTypeRecord;
  attachment: {
    id: number;
    fileName: string;
    fileUrl?: string | null;
    mimeType?: string | null;
    fileSize?: number | null;
  };
};

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  ventas: "Ventas",
  compras: "Compras",
  cobros: "Cobros",
  logistica: "Logística",
  administracion: "Administración",
  otro: "Otro",
};

const PAGE_SIZE = 25;
const EMPTY_CONTACT_DRAFT = {
  contactType: "ventas" as ContactType,
  branchName: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  isActive: true,
};
const EMPTY_DOCUMENT_DRAFT = {
  documentTypeId: "",
  documentDate: "",
  expirationDate: "",
  description: "",
};
const EMPTY_DOCUMENT_TYPE_DRAFT = {
  code: "",
  name: "",
  description: "",
  expirationMode: "optional" as SupplierDocumentExpirationMode,
  isActive: true,
};
const EMPTY_SUPPLIER_DRAFT = {
  supplierCode: "",
  name: "",
  email: "",
  rtn: "",
  address: "",
  allowsTaxWithholding: true,
  subjectToAccountPayments: true,
  isActive: true,
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

const DOCUMENT_STATUS_LABELS: Record<SupplierDocumentRecord["status"], string> = {
  vigente: "Vigente",
  vencido: "Vencido",
  sin_vencimiento: "Sin vencimiento",
};

const EXPIRATION_MODE_LABELS: Record<SupplierDocumentExpirationMode, string> = {
  required: "Vence requerido",
  optional: "Vence opcional",
  none: "No vence",
};

function toInputDate(value?: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value?: string | Date | null) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("es-HN");
}

function getFriendlyMutationError(message?: string | null) {
  const raw = String(message ?? "").trim();
  if (!raw) return "No fue posible completar la acción";

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const validationMessage = parsed.find(
        issue => typeof issue?.message === "string" && issue.message.trim()
      )?.message;
      if (validationMessage) return validationMessage;
    }
    if (typeof parsed?.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // tRPC can expose Zod issues as a JSON string; non-JSON errors are fine.
  }

  if (raw.includes("Ingrese un correo válido")) {
    return "Ingrese un correo válido";
  }

  return raw;
}

export default function Proveedores() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierRecord | null>(null);
  const [supplierDialogMode, setSupplierDialogMode] = useState<
    "create" | "edit" | null
  >(null);
  const [supplierDraft, setSupplierDraft] = useState(EMPTY_SUPPLIER_DRAFT);
  const [editAllowsTaxWithholding, setEditAllowsTaxWithholding] =
    useState(true);
  const [editSubjectToAccountPayments, setEditSubjectToAccountPayments] =
    useState(true);
  const [editRtn, setEditRtn] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [contactProjectId, setContactProjectId] = useState("");
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactDraft, setContactDraft] = useState(EMPTY_CONTACT_DRAFT);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [documentDraft, setDocumentDraft] = useState(EMPTY_DOCUMENT_DRAFT);
  const [selectedDocumentFile, setSelectedDocumentFile] = useState<File | null>(
    null
  );
  const [documentProcessing, setDocumentProcessing] = useState(false);
  const [documentTypesDialogOpen, setDocumentTypesDialogOpen] = useState(false);
  const [editingDocumentTypeId, setEditingDocumentTypeId] =
    useState<number | null>(null);
  const [documentTypeDraft, setDocumentTypeDraft] = useState(
    EMPTY_DOCUMENT_TYPE_DRAFT
  );
  const documentFileInputRef = useRef<HTMLInputElement>(null);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const canCreateSupplier =
    user?.role === "admin" || buildreqRole === "administracion_central";
  const canManageSupplierCatalog =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "administracion_central";
  const canManageSupplierContacts =
    canManageSupplierCatalog || buildreqRole === "administrador_proyecto";
  const canManageSupplierFiscalProfile =
    canManageSupplierCatalog || buildreqRole === "administrador_proyecto";
  const canManageSupplierDocuments =
    canManageSupplierCatalog || buildreqRole === "administrador_proyecto";

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter]);

  const listInput = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      isActive:
        activeFilter === "all" ? undefined : activeFilter === "active",
      page,
      pageSize: PAGE_SIZE,
    }),
    [activeFilter, debouncedSearch, page]
  );

  const { data, isLoading, isFetching, error, refetch } =
    trpc.suppliers.list.useQuery(listInput, {
      placeholderData: (previousData) => previousData,
    });
  const isCreatingSupplier = supplierDialogMode === "create";
  const isExistingSupplier = Boolean(selectedSupplier?.id);
  const supplierDialogOpen = isCreatingSupplier || isExistingSupplier;
  const { data: projects } = trpc.projects.list.useQuery(
    { status: "activo" },
    { enabled: isExistingSupplier }
  );
  const selectedContactProjectId = Number(contactProjectId) || undefined;
  const contactListInput = useMemo(
    () => ({
      supplierId: selectedSupplier?.id ?? 0,
      projectId: selectedContactProjectId,
      includeInactive: true,
    }),
    [selectedContactProjectId, selectedSupplier?.id]
  );
  const { data: contactRows, isLoading: contactsLoading } =
    trpc.suppliers.listContacts.useQuery(contactListInput, {
      enabled: Boolean(isExistingSupplier && selectedContactProjectId),
    });
  const { data: documentTypesRaw, isLoading: documentTypesLoading } =
    trpc.suppliers.listDocumentTypes.useQuery(
      { includeInactive: true },
      {
        enabled:
          canManageSupplierDocuments &&
          (isExistingSupplier || documentTypesDialogOpen),
      }
    );
  const { data: supplierDocumentsRaw, isLoading: documentsLoading } =
    trpc.suppliers.listDocuments.useQuery(
      { supplierId: selectedSupplier?.id ?? 0 },
      { enabled: canManageSupplierDocuments && isExistingSupplier }
    );

  useEffect(() => {
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, page]);

  useEffect(() => {
    if (!isExistingSupplier) {
      setContactProjectId("");
      setEditingContactId(null);
      setContactDraft(EMPTY_CONTACT_DRAFT);
      setDocumentDialogOpen(false);
      setEditingDocumentId(null);
      setDocumentDraft(EMPTY_DOCUMENT_DRAFT);
      setSelectedDocumentFile(null);
      return;
    }

    if (!contactProjectId && projects?.length) {
      setContactProjectId(String(projects[0].id));
    }
  }, [contactProjectId, isExistingSupplier, projects]);

  function closeSupplierDialog() {
    setSupplierDialogMode(null);
    setSelectedSupplier(null);
    setSupplierDraft(EMPTY_SUPPLIER_DRAFT);
    setEditingContactId(null);
    setContactDraft(EMPTY_CONTACT_DRAFT);
    setDocumentDialogOpen(false);
    setEditingDocumentId(null);
    setDocumentDraft(EMPTY_DOCUMENT_DRAFT);
    setSelectedDocumentFile(null);
  }

  const createMutation = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      toast.success("Proveedor creado");
      void utils.suppliers.list.invalidate();
      setActiveFilter("active");
      setPage(1);
      closeSupplierDialog();
    },
    onError: (e) => toast.error(getFriendlyMutationError(e.message)),
  });
  const updateMutation = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      toast.success("Proveedor actualizado");
      utils.suppliers.list.invalidate();
      closeSupplierDialog();
    },
    onError: (e) => toast.error(e.message),
  });
  const createContactMutation = trpc.suppliers.createContact.useMutation({
    onSuccess: () => {
      toast.success("Contacto agregado");
      setEditingContactId(null);
      setContactDraft(EMPTY_CONTACT_DRAFT);
      utils.suppliers.listContacts.invalidate();
    },
    onError: (e) => toast.error(getFriendlyMutationError(e.message)),
  });
  const updateContactMutation = trpc.suppliers.updateContact.useMutation({
    onSuccess: () => {
      toast.success("Contacto actualizado");
      setEditingContactId(null);
      setContactDraft(EMPTY_CONTACT_DRAFT);
      utils.suppliers.listContacts.invalidate();
    },
    onError: (e) => toast.error(getFriendlyMutationError(e.message)),
  });
  const createDocumentTypeMutation =
    trpc.suppliers.createDocumentType.useMutation({
      onSuccess: () => {
        toast.success("Tipo de documento creado");
        setDocumentTypeDraft(EMPTY_DOCUMENT_TYPE_DRAFT);
        void utils.suppliers.listDocumentTypes.invalidate();
      },
      onError: (e) => toast.error(e.message),
    });
  const updateDocumentTypeMutation =
    trpc.suppliers.updateDocumentType.useMutation({
      onSuccess: () => {
        toast.success("Tipo de documento actualizado");
        setEditingDocumentTypeId(null);
        setDocumentTypeDraft(EMPTY_DOCUMENT_TYPE_DRAFT);
        void utils.suppliers.listDocumentTypes.invalidate();
      },
      onError: (e) => toast.error(e.message),
    });
  const deactivateDocumentTypeMutation =
    trpc.suppliers.deactivateDocumentType.useMutation({
      onSuccess: () => {
        toast.success("Tipo de documento desactivado");
        void utils.suppliers.listDocumentTypes.invalidate();
      },
      onError: (e) => toast.error(e.message),
    });
  const createDocumentMutation = trpc.suppliers.createDocument.useMutation({
    onSuccess: () => {
      toast.success("Documento agregado");
      setDocumentDialogOpen(false);
      setEditingDocumentId(null);
      setDocumentDraft(EMPTY_DOCUMENT_DRAFT);
      setSelectedDocumentFile(null);
      if (documentFileInputRef.current) documentFileInputRef.current.value = "";
      void utils.suppliers.listDocuments.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateDocumentMutation = trpc.suppliers.updateDocument.useMutation({
    onSuccess: () => {
      toast.success("Documento actualizado");
      setDocumentDialogOpen(false);
      setEditingDocumentId(null);
      setDocumentDraft(EMPTY_DOCUMENT_DRAFT);
      setSelectedDocumentFile(null);
      void utils.suppliers.listDocuments.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteDocumentMutation = trpc.suppliers.deleteDocument.useMutation({
    onSuccess: () => {
      toast.success("Documento eliminado");
      void utils.suppliers.listDocuments.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  const contacts = (contactRows ?? []).map((row: any) => row.contact);
  const documentTypes = (documentTypesRaw ?? []) as SupplierDocumentTypeRecord[];
  const activeDocumentTypes = documentTypes.filter((type) => type.isActive);
  const supplierDocuments =
    (supplierDocumentsRaw ?? []) as SupplierDocumentRecord[];
  const selectedDocumentType = documentTypes.find(
    (type) => String(type.id) === documentDraft.documentTypeId
  );
  const documentTypeOptions = documentTypes.filter(
    (type) => type.isActive || String(type.id) === documentDraft.documentTypeId
  );
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : ((data?.page ?? page) - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min((data?.page ?? page) * PAGE_SIZE, total);

  const openCreateDialog = () => {
    if (!canCreateSupplier) return;
    setSupplierDialogMode("create");
    setSelectedSupplier(null);
    setSupplierDraft(EMPTY_SUPPLIER_DRAFT);
    setEditAllowsTaxWithholding(true);
    setEditSubjectToAccountPayments(true);
    setEditRtn("");
    setEditAddress("");
    setEditingContactId(null);
    setContactDraft(EMPTY_CONTACT_DRAFT);
  };

  const openEditDialog = (supplier: SupplierRecord) => {
    setSupplierDialogMode("edit");
    setSelectedSupplier(supplier);
    setSupplierDraft({
      supplierCode: supplier.supplierCode,
      name: supplier.name,
      email: supplier.email ?? "",
      rtn: supplier.rtn ?? "",
      address: supplier.address ?? "",
      allowsTaxWithholding: supplier.allowsTaxWithholding,
      subjectToAccountPayments: supplier.subjectToAccountPayments !== false,
      isActive: supplier.isActive,
    });
    setEditAllowsTaxWithholding(supplier.allowsTaxWithholding);
    setEditSubjectToAccountPayments(
      supplier.subjectToAccountPayments !== false
    );
    setEditRtn(supplier.rtn ?? "");
    setEditAddress(supplier.address ?? "");
    setEditingContactId(null);
    setContactDraft(EMPTY_CONTACT_DRAFT);
  };

  const submitSupplier = () => {
    const supplierCode = supplierDraft.supplierCode.trim().toUpperCase();
    const name = supplierDraft.name.trim();
    const email = supplierDraft.email.trim().toLowerCase();

    if (isCreatingSupplier) {
      if (!supplierCode) {
        toast.error("Ingrese el código del proveedor");
        return;
      }
      if (!name) {
        toast.error("Ingrese el nombre del proveedor");
        return;
      }
      if (email && !EMAIL_PATTERN.test(email)) {
        toast.error("Ingrese un correo válido");
        return;
      }
      createMutation.mutate({
        supplierCode,
        name,
        email,
        rtn: editRtn.trim(),
        address: editAddress.trim(),
        allowsTaxWithholding: editAllowsTaxWithholding,
        subjectToAccountPayments: editSubjectToAccountPayments,
        isActive: supplierDraft.isActive,
      });
      return;
    }

    if (!selectedSupplier) return;
    updateMutation.mutate({
      id: selectedSupplier.id,
      rtn: editRtn.trim(),
      address: editAddress.trim(),
      allowsTaxWithholding: editAllowsTaxWithholding,
      subjectToAccountPayments: editSubjectToAccountPayments,
    });
  };

  const startNewContact = () => {
    setEditingContactId(null);
    setContactDraft(EMPTY_CONTACT_DRAFT);
  };

  const startEditContact = (contact: SupplierContactRecord) => {
    setContactProjectId(String(contact.projectId));
    setEditingContactId(contact.id);
    setContactDraft({
      contactType: contact.contactType,
      branchName: contact.branchName ?? "",
      name: contact.name,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      address: contact.address ?? "",
      isActive: contact.isActive,
    });
  };

  const submitContact = () => {
    if (!selectedSupplier || !selectedContactProjectId) {
      toast.error("Seleccione un proyecto para el contacto");
      return;
    }
    const email = contactDraft.email.trim().toLowerCase();
    if (!contactDraft.name.trim()) {
      toast.error("Ingrese el nombre del contacto");
      return;
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      toast.error("Ingrese un correo válido");
      return;
    }

    const payload = {
      projectId: selectedContactProjectId,
      contactType: contactDraft.contactType,
      branchName: contactDraft.branchName.trim(),
      name: contactDraft.name.trim(),
      phone: contactDraft.phone.trim(),
      email,
      address: contactDraft.address.trim(),
      isActive: contactDraft.isActive,
    };

    if (editingContactId) {
      updateContactMutation.mutate({ id: editingContactId, ...payload });
    } else {
      createContactMutation.mutate({
        supplierId: selectedSupplier.id,
        ...payload,
      });
    }
  };

  const toggleContactActive = (contact: SupplierContactRecord) => {
    updateContactMutation.mutate({
      id: contact.id,
      isActive: !contact.isActive,
    });
  };

  const openNewDocumentDialog = () => {
    setEditingDocumentId(null);
    setDocumentDraft({
      ...EMPTY_DOCUMENT_DRAFT,
      documentTypeId: activeDocumentTypes[0]
        ? String(activeDocumentTypes[0].id)
        : "",
    });
    setSelectedDocumentFile(null);
    if (documentFileInputRef.current) documentFileInputRef.current.value = "";
    setDocumentDialogOpen(true);
  };

  const openEditDocumentDialog = (document: SupplierDocumentRecord) => {
    setEditingDocumentId(document.id);
    setDocumentDraft({
      documentTypeId: String(document.documentTypeId),
      documentDate: toInputDate(document.documentDate),
      expirationDate: toInputDate(document.expirationDate),
      description: document.description ?? "",
    });
    setSelectedDocumentFile(null);
    setDocumentDialogOpen(true);
  };

  const submitDocument = async () => {
    if (!selectedSupplier) return;
    if (!documentDraft.documentTypeId) {
      toast.error("Seleccione el tipo de documento");
      return;
    }
    if (!documentDraft.documentDate) {
      toast.error("Ingrese la fecha del documento");
      return;
    }
    if (
      selectedDocumentType?.expirationMode === "required" &&
      !documentDraft.expirationDate
    ) {
      toast.error("Ingrese la fecha de vencimiento");
      return;
    }
    if (!editingDocumentId && !selectedDocumentFile) {
      toast.error("Seleccione un archivo");
      return;
    }

    if (editingDocumentId) {
      updateDocumentMutation.mutate({
        id: editingDocumentId,
        documentTypeId: Number(documentDraft.documentTypeId),
        documentDate: documentDraft.documentDate,
        expirationDate: documentDraft.expirationDate,
        description: documentDraft.description,
      });
      return;
    }

    setDocumentProcessing(true);
    try {
      const prepared = await prepareDocumentAttachment(selectedDocumentFile!);
      createDocumentMutation.mutate({
        supplierId: selectedSupplier.id,
        documentTypeId: Number(documentDraft.documentTypeId),
        documentDate: documentDraft.documentDate,
        expirationDate: documentDraft.expirationDate,
        description: documentDraft.description,
        fileName: prepared.fileName,
        fileData: prepared.fileData,
        mimeType: prepared.mimeType,
        fileSize: prepared.fileSize,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No fue posible preparar el archivo"
      );
    } finally {
      setDocumentProcessing(false);
    }
  };

  const startNewDocumentType = () => {
    setEditingDocumentTypeId(null);
    setDocumentTypeDraft(EMPTY_DOCUMENT_TYPE_DRAFT);
  };

  const startEditDocumentType = (documentType: SupplierDocumentTypeRecord) => {
    setEditingDocumentTypeId(documentType.id);
    setDocumentTypeDraft({
      code: documentType.code,
      name: documentType.name,
      description: documentType.description ?? "",
      expirationMode: documentType.expirationMode,
      isActive: documentType.isActive,
    });
  };

  const submitDocumentType = () => {
    if (!documentTypeDraft.name.trim()) {
      toast.error("Ingrese el nombre del tipo");
      return;
    }

    const payload = {
      code: documentTypeDraft.code,
      name: documentTypeDraft.name,
      description: documentTypeDraft.description,
      expirationMode: documentTypeDraft.expirationMode,
      isActive: documentTypeDraft.isActive,
    };

    if (editingDocumentTypeId) {
      updateDocumentTypeMutation.mutate({ id: editingDocumentTypeId, ...payload });
    } else {
      createDocumentTypeMutation.mutate(payload);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Proveedores</h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar los proveedores"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        {canCreateSupplier ? (
          <Button type="button" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo proveedor
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nombre o correo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando proveedores...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <Building2 className="mx-auto mb-3 h-12 w-12 text-destructive/50" />
              <p className="mb-1 font-medium text-foreground">
                No se pudo cargar el catálogo
              </p>
              <p className="mb-4 text-sm text-muted-foreground">
                {error.message || "Ocurrió un error consultando la base de datos."}
              </p>
              <Button variant="outline" onClick={() => void refetch()}>
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Building2 className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                No se encontraron proveedores
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Código
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Proveedor
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Correo
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Retención
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Pagos a cuenta
                      </th>
                      {canManageSupplierContacts ? (
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((supplier: SupplierRecord) => (
                      <tr
                        key={supplier.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          {supplier.supplierCode}
                        </td>
                        <td className="max-w-[520px] p-3 font-medium">
                          {supplier.name}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {supplier.email || "-"}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              supplier.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {supplier.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              supplier.allowsTaxWithholding
                                ? "border-emerald-300 text-emerald-700"
                                : "border-amber-300 text-amber-700"
                            }
                          >
                            {supplier.allowsTaxWithholding
                              ? "Permite"
                              : "No permite"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              supplier.subjectToAccountPayments !== false
                                ? "border-blue-300 text-blue-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {supplier.subjectToAccountPayments !== false
                              ? "Sujeto"
                              : "No sujeto"}
                          </Badge>
                        </td>
                        {canManageSupplierContacts ? (
                          <td className="p-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(supplier)}
                            >
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              {canManageSupplierFiscalProfile
                                ? "Editar"
                                : "Contactos"}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {rangeStart.toLocaleString("es-HN")} a{" "}
                  {rangeEnd.toLocaleString("es-HN")} de{" "}
                  {total.toLocaleString("es-HN")} registros
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={(data?.page ?? page) <= 1}
                    onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    disabled={(data?.page ?? page) >= totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(current + 1, totalPages))
                    }
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={supplierDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeSupplierDialog();
        }}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-1rem)] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {isCreatingSupplier
                ? "Nuevo proveedor"
                : canManageSupplierFiscalProfile
                ? "Editar proveedor"
                : "Contactos del proveedor"}
            </DialogTitle>
          </DialogHeader>

          {selectedSupplier || isCreatingSupplier ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Código</Label>
                  <Input
                    value={supplierDraft.supplierCode}
                    readOnly={!isCreatingSupplier}
                    onChange={(event) =>
                      setSupplierDraft((current) => ({
                        ...current,
                        supplierCode: event.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="PROV-000000"
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estado</Label>
                  {isCreatingSupplier ? (
                    <div className="flex h-10 items-center justify-between rounded-md border px-3">
                      <span className="text-sm">
                        {supplierDraft.isActive ? "Activo" : "Inactivo"}
                      </span>
                      <Switch
                        checked={supplierDraft.isActive}
                        onCheckedChange={(checked) =>
                          setSupplierDraft((current) => ({
                            ...current,
                            isActive: checked,
                          }))
                        }
                      />
                    </div>
                  ) : (
                    <Input
                      value={selectedSupplier?.isActive ? "Activo" : "Inactivo"}
                      readOnly
                    />
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Proveedor</Label>
                <Input
                  value={supplierDraft.name}
                  readOnly={!isCreatingSupplier}
                  onChange={(event) =>
                    setSupplierDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Nombre del proveedor"
                  maxLength={500}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Correo</Label>
                <Input
                  type="email"
                  value={supplierDraft.email}
                  readOnly={!isCreatingSupplier}
                  onChange={(event) =>
                    setSupplierDraft((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="correo@proveedor.com"
                  maxLength={320}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">RTN</Label>
                  <Input
                    value={
                      canManageSupplierFiscalProfile
                        ? editRtn
                        : selectedSupplier?.rtn || ""
                    }
                    readOnly={!canManageSupplierFiscalProfile}
                    onChange={event => setEditRtn(event.target.value)}
                    placeholder="RTN del proveedor"
                    maxLength={50}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Dirección</Label>
                  <Input
                    value={
                      canManageSupplierFiscalProfile
                        ? editAddress
                        : selectedSupplier?.address || ""
                    }
                    readOnly={!canManageSupplierFiscalProfile}
                    onChange={event => setEditAddress(event.target.value)}
                    placeholder="Dirección fiscal del proveedor"
                    maxLength={1000}
                  />
                </div>
              </div>

              {canManageSupplierFiscalProfile ? (
                <>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label className="text-sm">Permite retención</Label>
                    <Switch
                      checked={editAllowsTaxWithholding}
                      onCheckedChange={setEditAllowsTaxWithholding}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label className="text-sm">
                      Proveedor sujeto a pagos a cuenta
                    </Label>
                    <Switch
                      checked={editSubjectToAccountPayments}
                      onCheckedChange={setEditSubjectToAccountPayments}
                    />
                  </div>
                </>
              ) : null}

              {canManageSupplierContacts && isExistingSupplier ? (
              <div className="space-y-4 rounded-md border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">
                      Contactos por proyecto
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Agenda de sucursales y contactos del proveedor.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={startNewContact}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Nuevo contacto
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(14rem,1fr)_minmax(14rem,1fr)]">
                  <div className="space-y-1">
                    <Label className="text-xs">Proyecto</Label>
                    <Select
                      value={contactProjectId}
                      onValueChange={(value) => {
                        setContactProjectId(value);
                        setEditingContactId(null);
                        setContactDraft(EMPTY_CONTACT_DRAFT);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccione proyecto" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((project: any) => (
                          <SelectItem key={project.id} value={String(project.id)}>
                            {project.code} — {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de contacto</Label>
                    <Select
                      value={contactDraft.contactType}
                      onValueChange={(value) =>
                        setContactDraft((current) => ({
                          ...current,
                          contactType: value as ContactType,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CONTACT_TYPE_LABELS).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Sucursal / sede</Label>
                    <Input
                      value={contactDraft.branchName}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          branchName: event.target.value,
                        }))
                      }
                      placeholder="Ej. Oficina SPS"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre</Label>
                    <Input
                      value={contactDraft.name}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Nombre del contacto"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Teléfono</Label>
                    <Input
                      value={contactDraft.phone}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                      placeholder="Teléfono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Correo</Label>
                    <Input
                      type="email"
                      autoComplete="email"
                      value={contactDraft.email}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                      placeholder="correo@proveedor.com"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Dirección</Label>
                    <Textarea
                      value={contactDraft.address}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          address: event.target.value,
                        }))
                      }
                      placeholder="Dirección de la sucursal o contacto"
                      rows={2}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 rounded-md border px-3 py-2">
                    <Label className="text-sm">Contacto activo</Label>
                    <Switch
                      checked={contactDraft.isActive}
                      onCheckedChange={(checked) =>
                        setContactDraft((current) => ({
                          ...current,
                          isActive: checked,
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={submitContact}
                    disabled={
                      createContactMutation.isPending ||
                      updateContactMutation.isPending ||
                      !selectedContactProjectId
                    }
                  >
                    {editingContactId ? "Actualizar contacto" : "Agregar contacto"}
                  </Button>
                </div>

                <div className="space-y-2">
                  {contactsLoading ? (
                    <div className="rounded-md border p-4 text-sm text-muted-foreground">
                      Cargando contactos...
                    </div>
                  ) : !selectedContactProjectId ? (
                    <div className="rounded-md border p-4 text-sm text-muted-foreground">
                      Seleccione un proyecto para ver la agenda.
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="rounded-md border p-4 text-sm text-muted-foreground">
                      No hay contactos registrados para este proyecto.
                    </div>
                  ) : (
                    contacts.map((contact: SupplierContactRecord) => (
                      <div
                        key={contact.id}
                        className="rounded-md border p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold">{contact.name}</p>
                              <Badge variant="outline">
                                {CONTACT_TYPE_LABELS[contact.contactType]}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={
                                  contact.isActive
                                    ? "border-emerald-300 text-emerald-700"
                                    : "border-muted-foreground/30 text-muted-foreground"
                                }
                              >
                                {contact.isActive ? "Activo" : "Inactivo"}
                              </Badge>
                            </div>
                            {contact.branchName ? (
                              <p className="text-sm text-muted-foreground">
                                {contact.branchName}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              {contact.phone ? (
                                <span className="inline-flex items-center gap-1">
                                  <Phone className="h-3.5 w-3.5" />
                                  {contact.phone}
                                </span>
                              ) : null}
                              {contact.email ? (
                                <span className="inline-flex items-center gap-1">
                                  <Mail className="h-3.5 w-3.5" />
                                  {contact.email}
                                </span>
                              ) : null}
                            </div>
                            {contact.address ? (
                              <p className="inline-flex items-start gap-1 text-sm text-muted-foreground">
                                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>{contact.address}</span>
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => startEditContact(contact)}
                            >
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Editar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => toggleContactActive(contact)}
                              disabled={updateContactMutation.isPending}
                            >
                              {contact.isActive ? "Desactivar" : "Activar"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              ) : null}

              {canManageSupplierDocuments && isExistingSupplier ? (
              <div className="space-y-4 rounded-md border p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Documentos</h2>
                    <p className="text-sm text-muted-foreground">
                      Expediente documental, vigencias y soportes del proveedor.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManageSupplierCatalog ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          startNewDocumentType();
                          setDocumentTypesDialogOpen(true);
                        }}
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        Tipos
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      onClick={openNewDocumentDialog}
                      disabled={activeDocumentTypes.length === 0}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Subir documento
                    </Button>
                  </div>
                </div>

                {documentsLoading ? (
                  <div className="rounded-md border p-4 text-sm text-muted-foreground">
                    Cargando documentos...
                  </div>
                ) : supplierDocuments.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    No hay documentos registrados para este proveedor.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Tipo
                          </th>
                          <th className="p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Fecha
                          </th>
                          <th className="p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Vence
                          </th>
                          <th className="p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Estado
                          </th>
                          <th className="p-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Archivo
                          </th>
                          <th className="p-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Acciones
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierDocuments.map((document) => (
                          <tr key={document.id} className="border-b last:border-0">
                            <td className="max-w-[220px] p-2">
                              <p className="truncate font-medium">
                                {document.documentType.name}
                              </p>
                              {document.description ? (
                                <p className="line-clamp-2 text-xs text-muted-foreground">
                                  {document.description}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-2">
                              {formatDateLabel(document.documentDate)}
                            </td>
                            <td className="p-2">
                              {formatDateLabel(document.expirationDate)}
                            </td>
                            <td className="p-2">
                              <Badge
                                variant="outline"
                                className={
                                  document.status === "vencido"
                                    ? "border-destructive/40 text-destructive"
                                    : document.status === "vigente"
                                      ? "border-emerald-300 text-emerald-700"
                                      : "border-muted-foreground/30 text-muted-foreground"
                                }
                              >
                                {DOCUMENT_STATUS_LABELS[document.status]}
                              </Badge>
                            </td>
                            <td className="max-w-[220px] p-2">
                              <a
                                href={document.attachment.fileUrl || "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex max-w-full items-center gap-2 text-sm font-medium hover:text-primary"
                              >
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="truncate">
                                  {document.attachment.fileName}
                                </span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                              <p className="text-xs text-muted-foreground">
                                {formatAttachmentSize(document.attachment.fileSize)}
                              </p>
                            </td>
                            <td className="p-2 text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={() => openEditDocumentDialog(document)}
                                  aria-label="Editar documento"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "¿Eliminar este documento del proveedor?"
                                      )
                                    ) {
                                      deleteDocumentMutation.mutate({
                                        id: document.id,
                                      });
                                    }
                                  }}
                                  disabled={deleteDocumentMutation.isPending}
                                  aria-label="Eliminar documento"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              ) : null}

              {canManageSupplierFiscalProfile || isCreatingSupplier ? (
                <Button
                  type="button"
                  onClick={submitSupplier}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="w-full"
                >
                  {isCreatingSupplier ? "Crear proveedor" : "Guardar cambios"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={documentDialogOpen} onOpenChange={setDocumentDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingDocumentId ? "Editar documento" : "Subir documento"}
            </DialogTitle>
            <DialogDescription>
              Registre la fecha, vigencia y archivo asociado al proveedor.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Tipo de documento</Label>
              <Select
                value={documentDraft.documentTypeId}
                onValueChange={(value) =>
                  setDocumentDraft((current) => ({
                    ...current,
                    documentTypeId: value,
                    expirationDate:
                      documentTypes.find((type) => String(type.id) === value)
                        ?.expirationMode === "none"
                        ? ""
                        : current.expirationDate,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione tipo" />
                </SelectTrigger>
                <SelectContent>
                  {documentTypeOptions.map((documentType) => (
                    <SelectItem
                      key={documentType.id}
                      value={String(documentType.id)}
                    >
                      {documentType.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Fecha documento</Label>
              <Input
                type="date"
                value={documentDraft.documentDate}
                onChange={(event) =>
                  setDocumentDraft((current) => ({
                    ...current,
                    documentDate: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                {selectedDocumentType?.expirationMode === "required"
                  ? "Fecha de vencimiento"
                  : "Fecha de vencimiento opcional"}
              </Label>
              <Input
                type="date"
                value={documentDraft.expirationDate}
                onChange={(event) =>
                  setDocumentDraft((current) => ({
                    ...current,
                    expirationDate: event.target.value,
                  }))
                }
                disabled={selectedDocumentType?.expirationMode === "none"}
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Descripción</Label>
              <Textarea
                value={documentDraft.description}
                onChange={(event) =>
                  setDocumentDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                placeholder="Referencia, observaciones o detalle del documento"
              />
            </div>

            {!editingDocumentId ? (
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Archivo</Label>
                <Input
                  ref={documentFileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    setSelectedDocumentFile(event.target.files?.[0] ?? null)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  PDF máximo 10 MB. Las imágenes se comprimen antes de subir.
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDocumentDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void submitDocument()}
              disabled={
                documentProcessing ||
                createDocumentMutation.isPending ||
                updateDocumentMutation.isPending ||
                !selectedSupplier
              }
            >
              {documentProcessing ? "Guardando..." : "Guardar documento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={documentTypesDialogOpen}
        onOpenChange={setDocumentTypesDialogOpen}
      >
        <DialogContent className="scrollbar-none max-h-[calc(100vh-1rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tipos de documento</DialogTitle>
            <DialogDescription>
              Catálogo usado para clasificar documentos del proveedor.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <div className="space-y-1">
              <Label className="text-xs">Nombre</Label>
              <Input
                value={documentTypeDraft.name}
                onChange={(event) =>
                  setDocumentTypeDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Ej. Constancia de pagos a cuenta"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Código</Label>
              <Input
                value={documentTypeDraft.code}
                onChange={(event) =>
                  setDocumentTypeDraft((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                placeholder="opcional"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Descripción</Label>
              <Textarea
                value={documentTypeDraft.description}
                onChange={(event) =>
                  setDocumentTypeDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vencimiento</Label>
              <Select
                value={documentTypeDraft.expirationMode}
                onValueChange={(value) =>
                  setDocumentTypeDraft((current) => ({
                    ...current,
                    expirationMode: value as SupplierDocumentExpirationMode,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="required">Requerido</SelectItem>
                  <SelectItem value="optional">Opcional</SelectItem>
                  <SelectItem value="none">No vence</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <Label className="text-sm">Activo</Label>
              <Switch
                checked={documentTypeDraft.isActive}
                onCheckedChange={(checked) =>
                  setDocumentTypeDraft((current) => ({
                    ...current,
                    isActive: checked,
                  }))
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={startNewDocumentType}>
              Nuevo
            </Button>
            <Button
              type="button"
              onClick={submitDocumentType}
              disabled={
                createDocumentTypeMutation.isPending ||
                updateDocumentTypeMutation.isPending
              }
            >
              {editingDocumentTypeId ? "Actualizar tipo" : "Crear tipo"}
            </Button>
          </div>

          <div className="space-y-2">
            {documentTypesLoading ? (
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                Cargando tipos...
              </div>
            ) : documentTypes.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No hay tipos de documento.
              </div>
            ) : (
              documentTypes.map((documentType) => (
                <div
                  key={documentType.id}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{documentType.name}</p>
                      <Badge variant="outline">
                        {EXPIRATION_MODE_LABELS[documentType.expirationMode]}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          documentType.isActive
                            ? "border-emerald-300 text-emerald-700"
                            : "border-muted-foreground/30 text-muted-foreground"
                        }
                      >
                        {documentType.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {documentType.code}
                    </p>
                    {documentType.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {documentType.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => startEditDocumentType(documentType)}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        deactivateDocumentTypeMutation.mutate({
                          id: documentType.id,
                        })
                      }
                      disabled={
                        !documentType.isActive ||
                        deactivateDocumentTypeMutation.isPending
                      }
                    >
                      Desactivar
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
