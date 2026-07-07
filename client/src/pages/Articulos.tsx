import { trpc } from "@/lib/trpc";
import { buildDatedExcelFileName, downloadExcel } from "@/lib/excel-export";
import { useAuth } from "@/_core/hooks/useAuth";
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_VALUES,
  type AssetCondition,
} from "@shared/fixed-assets";
import {
  Download,
  Eye,
  PackageSearch,
  Pencil,
  Plus,
  Save,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type ArticleType = 1 | 2 | 3;

type ArticleRecord = {
  id: number;
  itemCode: string;
  description: string;
  itemGroup?: string | null;
  brand?: string | null;
  partNumber?: string | null;
  tipoArticulo: number;
  projectId?: number | null;
  temporaryItemCode?: string | null;
  fixedAssetStatus?: string | null;
  fixedAssetSerialNumber?: string | null;
  fixedAssetCondition?: string | null;
  fixedAssetColor?: string | null;
  fixedAssetModel?: string | null;
  fixedAssetBrand?: string | null;
  fixedAssetChassisSeries?: string | null;
  fixedAssetMotorSeries?: string | null;
  fixedAssetPlateOrCode?: string | null;
  fixedAssetIsLeasing?: boolean | null;
  fixedAssetObservation?: string | null;
  allowsTaxWithholding: boolean;
  isActive: boolean;
};

type ProjectOption = {
  id: number;
  code?: string | null;
  name?: string | null;
  status?: string | null;
};

type FixedAssetDetailDraft = {
  serialNumber: string;
  condition: AssetCondition;
  color: string;
  model: string;
  brand: string;
  chassisSeries: string;
  motorSeries: string;
  plateOrCode: string;
};

type ArticleCreateFormState = {
  itemCode: string;
  description: string;
  itemGroup: string;
  brand: string;
  partNumber: string;
  tipoArticulo: ArticleType;
  projectId: string;
  allowsTaxWithholding: boolean;
  isActive: boolean;
};

const PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 200;

const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  1: "Artículo",
  2: "Servicio",
  3: "Activo fijo",
};

const EMPTY_CREATE_ARTICLE_FORM: ArticleCreateFormState = {
  itemCode: "",
  description: "",
  itemGroup: "",
  brand: "",
  partNumber: "",
  tipoArticulo: 1,
  projectId: "none",
  allowsTaxWithholding: true,
  isActive: true,
};

function buildPageItems(currentPage: number, totalPages: number) {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 2) {
    return [
      1,
      "ellipsis",
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ] as const;
}

function parseArticleType(value: string): ArticleType | undefined {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 || numeric === 3 ? numeric : undefined;
}

function getArticleTypeLabel(value: number | null | undefined) {
  if (value === 1 || value === 2 || value === 3) {
    return ARTICLE_TYPE_LABELS[value];
  }
  return "Sin tipo";
}

function getProjectLabel(project: ProjectOption) {
  const code = project.code?.trim();
  const name = project.name?.trim();
  const label = [code, name].filter(Boolean).join(" - ");
  return label || `Proyecto ${project.id}`;
}

function getArticleProjectLabel(
  article: ArticleRecord,
  projectById: Map<number, ProjectOption>
) {
  if (article.tipoArticulo !== 3) return "-";
  if (!article.projectId) return "Sin proyecto";

  const project = projectById.get(article.projectId);
  return project ? getProjectLabel(project) : `Proyecto ${article.projectId}`;
}

function getFixedAssetStatusLabel(status: string | null | undefined) {
  if (status === "pendiente") return "Pendiente código real";
  if (status === "resuelto") return "Código resuelto";
  return null;
}

function buildFixedAssetDraft(article?: ArticleRecord | null): FixedAssetDetailDraft {
  return {
    serialNumber: article?.fixedAssetSerialNumber ?? "",
    condition: ASSET_CONDITION_VALUES.includes(
      article?.fixedAssetCondition as AssetCondition
    )
      ? (article?.fixedAssetCondition as AssetCondition)
      : "nuevo",
    color: article?.fixedAssetColor ?? "",
    model: article?.fixedAssetModel ?? "",
    brand: article?.fixedAssetBrand ?? "",
    chassisSeries: article?.fixedAssetChassisSeries ?? "",
    motorSeries: article?.fixedAssetMotorSeries ?? "",
    plateOrCode: article?.fixedAssetPlateOrCode ?? "",
  };
}

function buildFixedAssetSearchBadges(article: ArticleRecord) {
  if (article.tipoArticulo !== 3) return [];
  return [
    article.fixedAssetSerialNumber
      ? `Serie ${article.fixedAssetSerialNumber}`
      : null,
    article.fixedAssetPlateOrCode
      ? `Placa ${article.fixedAssetPlateOrCode}`
      : null,
    article.fixedAssetChassisSeries
      ? `Chasis ${article.fixedAssetChassisSeries}`
      : null,
    article.fixedAssetMotorSeries
      ? `Motor ${article.fixedAssetMotorSeries}`
      : null,
    article.fixedAssetBrand ? `Marca activo ${article.fixedAssetBrand}` : null,
    article.fixedAssetModel ? `Modelo ${article.fixedAssetModel}` : null,
  ].filter(Boolean) as string[];
}

export default function Articulos() {
  const { user } = useAuth();
  const [location] = useLocation();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("active");
  const [withholdingFilter, setWithholdingFilter] = useState("all");
  const [fixedAssetStatusFilter, setFixedAssetStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<ArticleCreateFormState>(EMPTY_CREATE_ARTICLE_FORM);
  const [selectedArticle, setSelectedArticle] = useState<ArticleRecord | null>(
    null
  );
  const [editType, setEditType] = useState<ArticleType>(1);
  const [editBrand, setEditBrand] = useState("");
  const [editPartNumber, setEditPartNumber] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editProjectId, setEditProjectId] = useState("none");
  const [editAllowsTaxWithholding, setEditAllowsTaxWithholding] =
    useState(true);
  const [realItemCode, setRealItemCode] = useState("");
  const [fixedAssetDetailDraft, setFixedAssetDetailDraft] =
    useState<FixedAssetDetailDraft>(() => buildFixedAssetDraft());
  const [fixedAssetObservationDraft, setFixedAssetObservationDraft] =
    useState("");
  const [fixedAssetIsLeasingDraft, setFixedAssetIsLeasingDraft] =
    useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  const buildreqRole = (user as any)?.buildreqRole || "";
  const isPendingFixedAssetsView = location.startsWith(
    "/activos-fijos-pendientes"
  );
  const canManage =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "administracion_central" ||
    buildreqRole === "administrador_proyecto" ||
    buildreqRole === "contable";
  const canCreate =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "administracion_central" ||
    buildreqRole === "administrador_proyecto" ||
    buildreqRole === "contable";
  const canResolveFixedAssets =
    user?.role === "admin" ||
    buildreqRole === "jefe_bodega_central" ||
    buildreqRole === "contable";
  const canViewArticleAttributes = Boolean(user?.role === "admin" || buildreqRole);
  const selectedArticleIsPendingFixedAsset = Boolean(
    selectedArticle?.fixedAssetStatus === "pendiente" &&
      selectedArticle?.temporaryItemCode
  );
  const isResolvingSelectedArticle = Boolean(
    selectedArticleIsPendingFixedAsset && canResolveFixedAssets
  );
  const canEditSelectedArticleCatalog = Boolean(
    canManage && !isResolvingSelectedArticle
  );
  const canEditSelectedFixedAssetDetails = Boolean(
    selectedArticle?.tipoArticulo === 3 && canResolveFixedAssets
  );
  const isSelectedArticleReadOnly = Boolean(
    selectedArticle &&
      !isResolvingSelectedArticle &&
      !canEditSelectedArticleCatalog
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    if (isPendingFixedAssetsView) {
      setTypeFilter("3");
      setActiveFilter("active");
      setWithholdingFilter("all");
      setFixedAssetStatusFilter("pendiente");
      return;
    }

    setTypeFilter("all");
    setActiveFilter("active");
    setWithholdingFilter("all");
    setFixedAssetStatusFilter("all");
  }, [isPendingFixedAssetsView]);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    typeFilter,
    activeFilter,
    withholdingFilter,
    fixedAssetStatusFilter,
  ]);

  const listInput = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      tipoArticulo:
        isPendingFixedAssetsView || fixedAssetStatusFilter !== "all"
          ? 3
          : parseArticleType(typeFilter),
      isActive:
        isPendingFixedAssetsView
          ? true
          : activeFilter === "all"
            ? undefined
            : activeFilter === "active",
      allowsTaxWithholding:
        withholdingFilter === "all"
          ? undefined
          : withholdingFilter === "withholding",
      fixedAssetStatus:
        isPendingFixedAssetsView
          ? "pendiente"
          : fixedAssetStatusFilter === "all"
            ? undefined
            : (fixedAssetStatusFilter as "pendiente" | "resuelto"),
      temporaryOnly:
        isPendingFixedAssetsView || fixedAssetStatusFilter !== "all"
          ? true
          : undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [
      activeFilter,
      debouncedSearch,
      fixedAssetStatusFilter,
      isPendingFixedAssetsView,
      page,
      typeFilter,
      withholdingFilter,
    ]
  );

  const {
    data,
    isLoading,
    isFetching,
    isPlaceholderData,
    error,
    refetch,
  } =
    trpc.articles.list.useQuery(listInput, {
      placeholderData: (previousData) => previousData,
      staleTime: 30_000,
    });

  const { data: projectsData } = trpc.projects.list.useQuery({});

  useEffect(() => {
    if (isPlaceholderData) return;
    if (data?.page && data.page !== page) {
      setPage(data.page);
    }
  }, [data?.page, isPlaceholderData, page]);

  const createMutation = trpc.articles.create.useMutation({
    onSuccess: () => {
      toast.success("Artículo creado");
      utils.articles.list.invalidate();
      setCreateDialogOpen(false);
      setCreateForm(EMPTY_CREATE_ARTICLE_FORM);
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.articles.update.useMutation({
    onSuccess: () => {
      toast.success("Artículo actualizado");
      utils.articles.list.invalidate();
      setSelectedArticle(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const resolveFixedAssetMutation = trpc.articles.resolveFixedAssetCode.useMutation({
    onSuccess: () => {
      toast.success("Código real actualizado");
      utils.articles.list.invalidate();
      utils.purchaseOrders.list.invalidate();
      setSelectedArticle(null);
      setRealItemCode("");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateFixedAssetDetailsMutation =
    trpc.articles.updateFixedAssetDetails.useMutation({
      onSuccess: article => {
        toast.success("Datos del activo fijo actualizados");
        setSelectedArticle(article as ArticleRecord);
        setFixedAssetDetailDraft(buildFixedAssetDraft(article as ArticleRecord));
        setFixedAssetObservationDraft(
          String((article as ArticleRecord).fixedAssetObservation ?? "")
        );
        setFixedAssetIsLeasingDraft(
          (article as ArticleRecord).fixedAssetIsLeasing === true
        );
        utils.articles.list.invalidate();
        utils.purchaseOrders.list.invalidate();
      },
      onError: e => toast.error(e.message),
    });

  const items = data?.items ?? [];
  const projectOptions = useMemo(
    () => ((projectsData ?? []) as ProjectOption[]),
    [projectsData]
  );
  const projectById = useMemo(
    () =>
      new Map(projectOptions.map((project) => [project.id, project] as const)),
    [projectOptions]
  );
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = page;
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(currentPage * PAGE_SIZE, total);
  const pageItems = useMemo(
    () => buildPageItems(currentPage, totalPages),
    [currentPage, totalPages]
  );

  const openEditDialog = (article: ArticleRecord) => {
    setSelectedArticle(article);
    setEditType(parseArticleType(String(article.tipoArticulo)) ?? 1);
    setEditBrand(article.brand ?? "");
    setEditPartNumber(article.partNumber ?? "");
    setEditProjectId(article.projectId ? String(article.projectId) : "none");
    setEditActive(article.isActive);
    setEditAllowsTaxWithholding(article.allowsTaxWithholding);
    setRealItemCode(article.fixedAssetStatus === "pendiente" ? "" : article.itemCode);
    setFixedAssetDetailDraft(buildFixedAssetDraft(article));
    setFixedAssetObservationDraft(article.fixedAssetObservation ?? "");
    setFixedAssetIsLeasingDraft(article.fixedAssetIsLeasing === true);
  };

  const submitCreate = () => {
    if (!canCreate) {
      toast.error("No tiene permisos para crear artículos");
      return;
    }
    if (!createForm.itemCode.trim() || !createForm.description.trim()) {
      toast.error("Código y descripción son obligatorios");
      return;
    }

    const selectedProjectId =
      createForm.projectId !== "none" ? Number(createForm.projectId) : null;

    createMutation.mutate({
      itemCode: createForm.itemCode.trim(),
      description: createForm.description.trim(),
      itemGroup: createForm.itemGroup.trim() || null,
      brand: createForm.brand.trim() || null,
      partNumber: createForm.partNumber.trim() || null,
      tipoArticulo: createForm.tipoArticulo,
      projectId:
        createForm.tipoArticulo === 3 && selectedProjectId
          ? selectedProjectId
          : null,
      allowsTaxWithholding: createForm.allowsTaxWithholding,
      isActive: createForm.isActive,
    });
  };

  const updateFixedAssetDraftField = (
    field: keyof FixedAssetDetailDraft,
    value: string
  ) => {
    setFixedAssetDetailDraft(current => ({
      ...current,
      [field]: value,
    }));
  };

  const submitFixedAssetDetails = () => {
    if (!selectedArticle) return;
    if (selectedArticle.tipoArticulo !== 3) {
      toast.error("El artículo no es un activo fijo");
      return;
    }
    if (!canEditSelectedFixedAssetDetails) {
      toast.error("No tiene permisos para editar datos del activo fijo");
      return;
    }
    if (!fixedAssetDetailDraft.serialNumber.trim()) {
      toast.error("Ingrese el número de serie del activo");
      return;
    }

    updateFixedAssetDetailsMutation.mutate({
      id: selectedArticle.id,
      isLeasing: fixedAssetIsLeasingDraft,
      observation: fixedAssetObservationDraft.trim() || null,
      assetDetail: {
        serialNumber: fixedAssetDetailDraft.serialNumber.trim(),
        condition: fixedAssetDetailDraft.condition,
        color: fixedAssetDetailDraft.color.trim() || undefined,
        model: fixedAssetDetailDraft.model.trim() || undefined,
        brand: fixedAssetDetailDraft.brand.trim() || undefined,
        chassisSeries: fixedAssetDetailDraft.chassisSeries.trim() || undefined,
        motorSeries: fixedAssetDetailDraft.motorSeries.trim() || undefined,
        plateOrCode: fixedAssetDetailDraft.plateOrCode.trim() || undefined,
      },
    });
  };

  const submitUpdate = () => {
    if (!selectedArticle) return;
    if (
      selectedArticle.fixedAssetStatus === "pendiente" &&
      selectedArticle.temporaryItemCode &&
      canResolveFixedAssets
    ) {
      if (!realItemCode.trim()) {
        toast.error("Ingrese el código real del activo fijo");
        return;
      }
      resolveFixedAssetMutation.mutate({
        id: selectedArticle.id,
        itemCode: realItemCode.trim(),
      });
      return;
    }
    if (!canManage) {
      toast.error("No tiene permisos para modificar artículos");
      return;
    }

    const selectedProjectId =
      editProjectId !== "none" ? Number(editProjectId) : null;

    updateMutation.mutate({
      id: selectedArticle.id,
      brand: editBrand.trim() || null,
      partNumber: editPartNumber.trim() || null,
      tipoArticulo: editType,
      projectId: editType === 3 && selectedProjectId ? selectedProjectId : null,
      isActive: editActive,
      allowsTaxWithholding: editAllowsTaxWithholding,
    });
  };

  const exportArticlesExcel = async () => {
    if (total === 0 || isExportingExcel) return;

    setIsExportingExcel(true);
    try {
      const rows: ArticleRecord[] = [];
      let nextPage = 1;
      let totalPagesToFetch = Math.max(1, Math.ceil(total / EXPORT_PAGE_SIZE));

      while (nextPage <= totalPagesToFetch) {
        const pageData = await utils.articles.list.fetch({
          ...listInput,
          page: nextPage,
          pageSize: EXPORT_PAGE_SIZE,
        });

        rows.push(...((pageData.items ?? []) as ArticleRecord[]));
        totalPagesToFetch = pageData.totalPages ?? totalPagesToFetch;
        nextPage += 1;
      }

      await downloadExcel(
        buildDatedExcelFileName(
          isPendingFixedAssetsView ? "activos-fijos-pendientes" : "articulos"
        ),
        isPendingFixedAssetsView ? "Activos fijos pendientes" : "Articulos",
        [
          { header: "Código", value: row => row.itemCode, width: 16 },
          { header: "Descripción", value: row => row.description, width: 42 },
          { header: "Grupo", value: row => row.itemGroup || "" },
          { header: "Marca", value: row => row.brand || "" },
          { header: "No. parte", value: row => row.partNumber || "" },
          {
            header: "Tipo",
            value: row => getArticleTypeLabel(row.tipoArticulo),
          },
          {
            header: "Proyecto",
            value: row => getArticleProjectLabel(row, projectById),
            width: 36,
          },
          {
            header: "Estado",
            value: row => (row.isActive ? "Activo" : "Inactivo"),
          },
          {
            header: "Retención",
            value: row => (row.allowsTaxWithholding ? "Permite" : "No permite"),
          },
          {
            header: "Estado activo fijo",
            value: row => getFixedAssetStatusLabel(row.fixedAssetStatus) || "",
          },
          {
            header: "Código temporal",
            value: row => row.temporaryItemCode || "",
          },
          {
            header: "Serie activo fijo",
            value: row => row.fixedAssetSerialNumber || "",
          },
          {
            header: "Condición activo fijo",
            value: row =>
              ASSET_CONDITION_VALUES.includes(
                row.fixedAssetCondition as AssetCondition
              )
                ? ASSET_CONDITION_LABELS[row.fixedAssetCondition as AssetCondition]
                : "",
          },
          { header: "Color", value: row => row.fixedAssetColor || "" },
          { header: "Modelo", value: row => row.fixedAssetModel || "" },
          {
            header: "Marca activo fijo",
            value: row => row.fixedAssetBrand || "",
          },
          {
            header: "Serie chasis",
            value: row => row.fixedAssetChassisSeries || "",
          },
          {
            header: "Serie motor",
            value: row => row.fixedAssetMotorSeries || "",
          },
          {
            header: "Placa/código",
            value: row => row.fixedAssetPlateOrCode || "",
          },
          {
            header: "Leasing",
            value: row => (row.fixedAssetIsLeasing ? "Sí" : "No"),
          },
          {
            header: "Observación",
            value: row => row.fixedAssetObservation || "",
            width: 42,
          },
        ],
        rows
      );

      toast.success(
        `Se exportaron ${rows.length.toLocaleString("es-HN")} registro(s)`
      );
    } catch {
      toast.error("No se pudo exportar el archivo Excel");
    } finally {
      setIsExportingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>
            {isPendingFixedAssetsView ? "Activos fijos pendientes" : "Artículos"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {error
              ? "No fue posible cargar los artículos"
              : isFetching && !isLoading
                ? "Actualizando resultados..."
              : isPendingFixedAssetsView
                ? `${total.toLocaleString("es-HN")} activo(s) fijo(s) pendiente(s) de código real`
                : `${total.toLocaleString("es-HN")} registros encontrados`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportArticlesExcel()}
            disabled={
              isLoading || Boolean(error) || total === 0 || isExportingExcel
            }
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {isExportingExcel ? "Exportando..." : "Exportar Excel"}
          </Button>
          {canCreate ? (
            <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Crear artículo
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={
          isPendingFixedAssetsView
            ? "grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_160px]"
            : "grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,1fr)_180px_160px_190px_210px]"
        }
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={
              isPendingFixedAssetsView
                ? "Buscar código, descripción, serie, placa, chasis, motor, marca o modelo"
                : "Buscar código, descripción, marca, parte, serie, placa, chasis o motor"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {!isPendingFixedAssetsView ? (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Tipo de artículo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="1">Artículo</SelectItem>
              <SelectItem value="2">Servicio</SelectItem>
              <SelectItem value="3">Activo fijo</SelectItem>
            </SelectContent>
          </Select>
        ) : null}

        <Select
          value={isPendingFixedAssetsView ? "active" : activeFilter}
          onValueChange={setActiveFilter}
          disabled={isPendingFixedAssetsView}
        >
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>

        {!isPendingFixedAssetsView ? (
          <>
            <Select value={withholdingFilter} onValueChange={setWithholdingFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Retención" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="withholding">Permiten retención</SelectItem>
                <SelectItem value="no-withholding">No permiten retención</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={fixedAssetStatusFilter}
              onValueChange={setFixedAssetStatusFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Activos fijos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="pendiente">Pendiente código real</SelectItem>
                <SelectItem value="resuelto">Código resuelto</SelectItem>
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Cargando artículos...
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <PackageSearch className="mx-auto mb-3 h-12 w-12 text-destructive/50" />
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
              <PackageSearch className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">
                {isPendingFixedAssetsView
                  ? "No hay activos fijos pendientes"
                  : "No se encontraron artículos"}
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
                        Descripción
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Grupo
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Tipo
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Proyecto
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Estado
                      </th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Retención
                      </th>
                      {canViewArticleAttributes ? (
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Acciones
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((article: ArticleRecord) => {
                      const fixedAssetStatusLabel = getFixedAssetStatusLabel(
                        article.fixedAssetStatus
                      );
                      const canResolveArticle = Boolean(
                        canResolveFixedAssets &&
                          article.fixedAssetStatus === "pendiente" &&
                          article.temporaryItemCode
                      );
                      const actionLabel = canResolveArticle
                        ? "Resolver"
                        : canManage
                          ? "Editar"
                          : "Ver";
                      const ActionIcon = canResolveArticle || canManage
                        ? Pencil
                        : Eye;
                      return (
                      <tr
                        key={article.id}
                        className="border-b border-border transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3 font-mono text-xs">
                          <div>{article.itemCode}</div>
                          {article.temporaryItemCode &&
                          article.temporaryItemCode !== article.itemCode ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Temp: {article.temporaryItemCode}
                            </div>
                          ) : null}
                        </td>
                        <td className="max-w-[520px] p-3">
                          <div className="font-medium">{article.description}</div>
                          {article.brand || article.partNumber ? (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {article.brand ? (
                                <span>Marca: {article.brand}</span>
                              ) : null}
                              {article.partNumber ? (
                                <span>No. parte: {article.partNumber}</span>
                              ) : null}
                            </div>
                          ) : null}
                          {article.temporaryItemCode ||
                          buildFixedAssetSearchBadges(article).length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {fixedAssetStatusLabel ? (
                                <Badge
                                  variant="outline"
                                  className={
                                    article.fixedAssetStatus === "pendiente"
                                      ? "border-amber-300 text-amber-700"
                                      : "border-emerald-300 text-emerald-700"
                                  }
                                >
                                  {fixedAssetStatusLabel}
                                </Badge>
                              ) : null}
                              {article.fixedAssetIsLeasing ? (
                                <Badge variant="outline">Leasing</Badge>
                              ) : null}
                              {buildFixedAssetSearchBadges(article).map(label => (
                                <Badge key={label} variant="outline">
                                  {label}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {article.itemGroup || "-"}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline">
                            {getArticleTypeLabel(article.tipoArticulo)}
                          </Badge>
                        </td>
                        <td className="max-w-[240px] p-3 text-xs text-muted-foreground">
                          {getArticleProjectLabel(article, projectById)}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              article.isActive
                                ? "border-emerald-300 text-emerald-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {article.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={
                              article.allowsTaxWithholding
                                ? "border-emerald-300 text-emerald-700"
                                : "border-amber-300 text-amber-700"
                            }
                          >
                            {article.allowsTaxWithholding
                              ? "Permite"
                              : "No permite"}
                          </Badge>
                        </td>
                        {canViewArticleAttributes ? (
                          <td className="p-3 text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(article)}
                            >
                              <ActionIcon className="mr-2 h-3.5 w-3.5" />
                              {actionLabel}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {rangeStart.toLocaleString("es-HN")} a{" "}
                  {rangeEnd.toLocaleString("es-HN")} de{" "}
                  {total.toLocaleString("es-HN")} registros
                </p>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (currentPage <= 1) return;
                          setPage((value) => Math.max(value - 1, 1));
                        }}
                        className={
                          currentPage <= 1 ? "pointer-events-none opacity-50" : ""
                        }
                      />
                    </PaginationItem>

                    {pageItems.map((pageItem, index) => (
                      <PaginationItem key={`${pageItem}-${index}`}>
                        {pageItem === "ellipsis" ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            href="#"
                            isActive={pageItem === currentPage}
                            onClick={(event) => {
                              event.preventDefault();
                              setPage(pageItem);
                            }}
                          >
                            {pageItem}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          if (currentPage >= totalPages) return;
                          setPage((value) => Math.min(value + 1, totalPages));
                        }}
                        className={
                          currentPage >= totalPages
                            ? "pointer-events-none opacity-50"
                            : ""
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setCreateForm(EMPTY_CREATE_ARTICLE_FORM);
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Crear artículo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Código *</Label>
                <Input
                  value={createForm.itemCode}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      itemCode: event.target.value,
                    }))
                  }
                  placeholder="SAP o código interno"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grupo</Label>
                <Input
                  value={createForm.itemGroup}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      itemGroup: event.target.value,
                    }))
                  }
                  placeholder="Familia o grupo"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Descripción *</Label>
                <Textarea
                  rows={2}
                  value={createForm.description}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      description: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Marca</Label>
                <Input
                  value={createForm.brand}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      brand: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Número de parte / código de bodega
                </Label>
                <Input
                  value={createForm.partNumber}
                  onChange={(event) =>
                    setCreateForm((form) => ({
                      ...form,
                      partNumber: event.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_220px]">
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <Select
                  value={String(createForm.tipoArticulo)}
                  onValueChange={(value) => {
                    const tipoArticulo = parseArticleType(value) ?? 1;
                    setCreateForm((form) => ({
                      ...form,
                      tipoArticulo,
                      projectId:
                        tipoArticulo === 3 ? form.projectId : "none",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Artículo</SelectItem>
                    <SelectItem value="2">Servicio</SelectItem>
                    <SelectItem value="3">Activo fijo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label className="text-sm">Activo</Label>
                <Switch
                  checked={createForm.isActive}
                  onCheckedChange={(isActive) =>
                    setCreateForm((form) => ({ ...form, isActive }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label className="text-sm">Permite retención</Label>
                <Switch
                  checked={createForm.allowsTaxWithholding}
                  onCheckedChange={(allowsTaxWithholding) =>
                    setCreateForm((form) => ({
                      ...form,
                      allowsTaxWithholding,
                    }))
                  }
                />
              </div>
            </div>

            {createForm.tipoArticulo === 3 ? (
              <div className="space-y-1">
                <Label className="text-xs">Proyecto del activo fijo</Label>
                <Select
                  value={createForm.projectId}
                  onValueChange={(projectId) =>
                    setCreateForm((form) => ({ ...form, projectId }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione proyecto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin proyecto asignado</SelectItem>
                    {projectOptions.map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {getProjectLabel(project)}
                        {project.status && project.status !== "activo"
                          ? " (inactivo)"
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={submitCreate}
                disabled={createMutation.isPending}
              >
                <Plus className="mr-2 h-4 w-4" />
                {createMutation.isPending ? "Creando..." : "Crear artículo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedArticle)}
        onOpenChange={(open) => {
          if (!open) setSelectedArticle(null);
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {isResolvingSelectedArticle
                ? "Resolver código de activo fijo"
                : canEditSelectedArticleCatalog
                  ? "Editar artículo"
                  : "Ver atributos del artículo"}
            </DialogTitle>
          </DialogHeader>

          {selectedArticle ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {isResolvingSelectedArticle ? "Código real" : "Código"}
                  </Label>
                  <Input
                    value={
                      isResolvingSelectedArticle
                        ? realItemCode
                        : selectedArticle.itemCode
                    }
                    onChange={(event) => setRealItemCode(event.target.value)}
                    readOnly={!isResolvingSelectedArticle}
                    placeholder="Ingrese el código real"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Grupo</Label>
                  <Input value={selectedArticle.itemGroup || ""} readOnly />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">Descripción</Label>
                  <Textarea
                    rows={2}
                    value={selectedArticle.description}
                    readOnly
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Marca</Label>
                  <Input
                    value={
                      canEditSelectedArticleCatalog
                        ? editBrand
                        : selectedArticle.brand || ""
                    }
                    disabled={!canEditSelectedArticleCatalog}
                    onChange={(event) => setEditBrand(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    Número de parte / código de bodega
                  </Label>
                  <Input
                    value={
                      canEditSelectedArticleCatalog
                        ? editPartNumber
                        : selectedArticle.partNumber || ""
                    }
                    disabled={!canEditSelectedArticleCatalog}
                    onChange={(event) => setEditPartNumber(event.target.value)}
                  />
                </div>
              </div>

              {selectedArticle.temporaryItemCode ? (
                <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Código temporal
                    </p>
                    <p className="font-mono text-amber-900">
                      {selectedArticle.temporaryItemCode}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Estado
                    </p>
                    <p className="font-medium text-amber-900">
                      {getFixedAssetStatusLabel(
                        selectedArticle.fixedAssetStatus
                      ) || "Activo fijo temporal"}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px_220px]">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={String(editType)}
                    disabled={!canEditSelectedArticleCatalog}
                    onValueChange={(value) => {
                      const nextType = parseArticleType(value) ?? 1;
                      setEditType(nextType);
                      if (nextType !== 3) {
                        setEditProjectId("none");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Artículo</SelectItem>
                      <SelectItem value="2">Servicio</SelectItem>
                      <SelectItem value="3">Activo fijo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label className="text-sm">Activo</Label>
                  <Switch
                    checked={editActive}
                    disabled={!canEditSelectedArticleCatalog}
                    onCheckedChange={setEditActive}
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label className="text-sm">Permite retención</Label>
                  <Switch
                    checked={editAllowsTaxWithholding}
                    disabled={!canEditSelectedArticleCatalog}
                    onCheckedChange={setEditAllowsTaxWithholding}
                  />
                </div>
              </div>

              {editType === 3 ? (
                <div className="space-y-1">
                  <Label className="text-xs">Proyecto del activo fijo</Label>
                  <Select
                    value={editProjectId}
                    disabled={!canEditSelectedArticleCatalog}
                    onValueChange={setEditProjectId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccione proyecto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin proyecto asignado</SelectItem>
                      {projectOptions.map((project) => (
                        <SelectItem key={project.id} value={String(project.id)}>
                          {getProjectLabel(project)}
                          {project.status && project.status !== "activo"
                            ? " (inactivo)"
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {editType === 3 ? (
                <div className="space-y-4 rounded-md border p-4 text-sm">
                  <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold">
                        Datos del activo fijo
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Estos datos se copiarán a la recepción y a la factura.
                      </p>
                    </div>
                    <div className="flex min-w-40 items-center justify-between rounded-md border px-3 py-2">
                      <Label className="text-sm">Leasing</Label>
                      <Switch
                        checked={fixedAssetIsLeasingDraft}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onCheckedChange={setFixedAssetIsLeasingDraft}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Serie</Label>
                      <Input
                        value={fixedAssetDetailDraft.serialNumber}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField(
                            "serialNumber",
                            event.target.value
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Condición</Label>
                      {canEditSelectedFixedAssetDetails ? (
                        <Select
                          value={fixedAssetDetailDraft.condition}
                          onValueChange={value =>
                            updateFixedAssetDraftField("condition", value)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSET_CONDITION_VALUES.map(condition => (
                              <SelectItem key={condition} value={condition}>
                                {ASSET_CONDITION_LABELS[condition]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={
                            selectedArticle.fixedAssetCondition
                              ? ASSET_CONDITION_LABELS[
                                  selectedArticle.fixedAssetCondition as AssetCondition
                                ]
                              : ""
                          }
                          readOnly
                        />
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Color</Label>
                      <Input
                        value={fixedAssetDetailDraft.color}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField("color", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Modelo</Label>
                      <Input
                        value={fixedAssetDetailDraft.model}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField("model", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Marca</Label>
                      <Input
                        value={fixedAssetDetailDraft.brand}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField("brand", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Placa/código</Label>
                      <Input
                        value={fixedAssetDetailDraft.plateOrCode}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField(
                            "plateOrCode",
                            event.target.value
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Serie chasis</Label>
                      <Input
                        value={fixedAssetDetailDraft.chassisSeries}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField(
                            "chassisSeries",
                            event.target.value
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Serie motor</Label>
                      <Input
                        value={fixedAssetDetailDraft.motorSeries}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          updateFixedAssetDraftField(
                            "motorSeries",
                            event.target.value
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2 xl:col-span-4">
                      <Label className="text-xs">Observación</Label>
                      <Textarea
                        rows={2}
                        value={fixedAssetObservationDraft}
                        disabled={!canEditSelectedFixedAssetDetails}
                        onChange={event =>
                          setFixedAssetObservationDraft(event.target.value)
                        }
                      />
                    </div>
                  </div>

                  {canEditSelectedFixedAssetDetails ? (
                    <div className="flex justify-end border-t pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={submitFixedAssetDetails}
                        disabled={updateFixedAssetDetailsMutation.isPending}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {updateFixedAssetDetailsMutation.isPending
                          ? "Guardando datos..."
                          : "Guardar datos del activo"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedArticle(null)}
                  disabled={
                    updateMutation.isPending ||
                    resolveFixedAssetMutation.isPending ||
                    updateFixedAssetDetailsMutation.isPending
                  }
                >
                  {isSelectedArticleReadOnly ? "Cerrar" : "Cancelar"}
                </Button>
                {!isSelectedArticleReadOnly ? (
                  <Button
                    type="button"
                    onClick={submitUpdate}
                    disabled={
                      updateMutation.isPending ||
                      resolveFixedAssetMutation.isPending ||
                      updateFixedAssetDetailsMutation.isPending
                    }
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {updateMutation.isPending || resolveFixedAssetMutation.isPending
                      ? "Guardando..."
                      : isResolvingSelectedArticle
                        ? "Guardar código real"
                        : "Guardar cambios"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
