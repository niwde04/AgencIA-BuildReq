import {
  getArticleProjectLabel,
  type ArticleProjectReference,
  type ProjectLabelReference,
} from "@shared/article-project-label";
import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITION_VALUES,
  type AssetCondition,
} from "@shared/fixed-assets";
import type { ExcelColumn } from "./excel-export";
import { fetchAllFilteredPages, type ExportPage } from "./paginated-export";

export type FixedAssetExportArticle = ArticleProjectReference & {
  itemGroup?: string | null;
  itemCode: string;
  description: string;
  fixedAssetExportDescription?: string | null;
  fixedAssetBrand?: string | null;
  fixedAssetModel?: string | null;
  fixedAssetChassisSeries?: string | null;
  fixedAssetMotorSeries?: string | null;
  fixedAssetPlateOrCode?: string | null;
  fixedAssetCondition?: string | null;
};

export type FixedAssetsExportFilters = {
  search?: string;
  isActive?: boolean;
  allowsTaxWithholding?: boolean;
  fixedAssetStatus?: "pendiente" | "resuelto";
  projectId?: number;
  temporaryOnly?: boolean;
};

export type FixedAssetsExportPageInput = FixedAssetsExportFilters & {
  tipoArticulo: 3;
  page: number;
  pageSize: number;
};

export async function collectFixedAssetsExport<T>(
  fetchPage: (input: FixedAssetsExportPageInput) => Promise<ExportPage<T>>,
  filters: FixedAssetsExportFilters
) {
  const snapshot: FixedAssetsExportFilters = {
    search: filters.search,
    isActive: filters.isActive,
    allowsTaxWithholding: filters.allowsTaxWithholding,
    fixedAssetStatus: filters.fixedAssetStatus,
    projectId: filters.projectId,
    temporaryOnly: filters.temporaryOnly,
  };
  return fetchAllFilteredPages(
    (page, pageSize) =>
      fetchPage({ ...snapshot, tipoArticulo: 3, page, pageSize }),
    200
  );
}

export function buildFixedAssetsExportColumns(
  projectById: ReadonlyMap<number, ProjectLabelReference>
): ExcelColumn<FixedAssetExportArticle>[] {
  return [
    { header: "Grupo SAP", value: row => row.itemGroup ?? "", width: 23.57 },
    { header: "Codigo SAP", value: row => row.itemCode, width: 23.57 },
    {
      header: "Descripcion del articulo",
      value: row => row.fixedAssetExportDescription ?? row.description,
      width: 45.57,
    },
    {
      header: "Marca activo fijo",
      value: row => row.fixedAssetBrand ?? "",
      width: 17,
    },
    {
      header: "Modelo activo fijo",
      value: row => row.fixedAssetModel ?? "",
      width: 18.43,
    },
    {
      header: "Serie chasis",
      value: row => row.fixedAssetChassisSeries ?? "",
      width: 13.29,
    },
    {
      header: "Serie motor",
      value: row => row.fixedAssetMotorSeries ?? "",
      width: 13,
    },
    {
      header: "Placa o codigo",
      value: row => row.fixedAssetPlateOrCode ?? "",
      width: 15.14,
    },
    // These fields are absent from the catalog; preserve the requested columns.
    { header: "Año", value: () => "", width: 10.71 },
    {
      header: "Condición activo fijo",
      value: row =>
        ASSET_CONDITION_VALUES.includes(
          row.fixedAssetCondition as AssetCondition
        )
          ? ASSET_CONDITION_LABELS[row.fixedAssetCondition as AssetCondition]
          : "",
      width: 18.14,
    },
    {
      header: "Proyecto",
      value: row => getArticleProjectLabel(row, projectById),
      width: 32.29,
    },
    { header: "Ubicación", value: () => "", width: 10.71 },
  ];
}
