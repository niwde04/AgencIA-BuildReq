export const ASSET_CONDITION_VALUES = [
  "nuevo",
  "usado_buen_estado",
  "defectuoso",
  "danado",
] as const;

export type AssetCondition = (typeof ASSET_CONDITION_VALUES)[number];

export type FixedAssetDetail = {
  serialNumber: string;
  condition: AssetCondition;
  color?: string | null;
  model?: string | null;
  brand?: string | null;
  chassisSeries?: string | null;
  motorSeries?: string | null;
  plateOrCode?: string | null;
};

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  nuevo: "Nuevo",
  usado_buen_estado: "Usado buen estado",
  defectuoso: "Defectuoso",
  danado: "Dañado",
};

export function parseFixedAssetDetails(
  value: FixedAssetDetail[] | string | null | undefined
): FixedAssetDetail[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createEmptyFixedAssetDetail(): FixedAssetDetail {
  return {
    serialNumber: "",
    condition: "nuevo",
    color: "",
    model: "",
    brand: "",
    chassisSeries: "",
    motorSeries: "",
    plateOrCode: "",
  };
}

export function normalizeFixedAssetDetails(
  details: FixedAssetDetail[] | string | null | undefined,
  expectedCount: number
) {
  const parsed = parseFixedAssetDetails(details);
  return Array.from({ length: Math.max(expectedCount, 0) }, (_, index) => ({
    ...createEmptyFixedAssetDetail(),
    ...(parsed[index] ?? {}),
    serialNumber: String(parsed[index]?.serialNumber ?? "").trim(),
    condition: ASSET_CONDITION_VALUES.includes(parsed[index]?.condition as AssetCondition)
      ? (parsed[index]?.condition as AssetCondition)
      : "nuevo",
    color: String(parsed[index]?.color ?? "").trim(),
    model: String(parsed[index]?.model ?? "").trim(),
    brand: String(parsed[index]?.brand ?? "").trim(),
    chassisSeries: String(parsed[index]?.chassisSeries ?? "").trim(),
    motorSeries: String(parsed[index]?.motorSeries ?? "").trim(),
    plateOrCode: String(parsed[index]?.plateOrCode ?? "").trim(),
  }));
}
