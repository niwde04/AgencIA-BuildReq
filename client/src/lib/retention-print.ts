export const MAX_PREPRINTED_RETENTION_CONCEPTS = 8;

export function formatRetentionCalendarDate(
  value: string | Date | null | undefined
) {
  if (!value) return "";

  const normalized = value instanceof Date ? "" : String(value).trim();
  const dateOnlyMatch = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/
  );
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return `${day}/${month}/${year}`;
  }

  const date = value instanceof Date ? value : new Date(normalized);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function getRetentionCurrencyWord(
  currency: "HNL" | "USD",
  unitCount: number
) {
  if (currency === "USD") return unitCount === 1 ? "DÓLAR" : "DÓLARES";
  return unitCount === 1 ? "LEMPIRA" : "LEMPIRAS";
}

export type RetentionPrintInput = {
  retentionCatalogId?: string | number | null;
  retentionCode?: string | null;
  retentionErpCode?: string | null;
  description?: string | null;
  baseAmount?: string | number | null;
  percentage?: string | number | null;
};

export type ConsolidatedRetentionPrintConcept = {
  retentionCatalogId: string | null;
  retentionCode: string | null;
  retentionErpCode: string | null;
  description: string;
  baseAmount: number;
  percentage: string | number;
  amount: number;
  sourceCount: number;
};

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundToFourDecimals(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function calculateRetentionPrintAmount(
  baseAmount: string | number | null | undefined,
  percentage: string | number | null | undefined
) {
  return roundToFourDecimals(
    (toNumber(baseAmount) * toNumber(percentage)) / 100
  );
}

function normalizeConceptPart(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ").toLocaleUpperCase("es-HN") ?? "";
}

function normalizePercentage(value: string | number | null | undefined) {
  return toNumber(value).toFixed(4);
}

function getRetentionConceptKey(retention: RetentionPrintInput) {
  const catalogId = String(retention.retentionCatalogId ?? "").trim();
  if (catalogId && catalogId.toLowerCase() !== "none") {
    return `catalog:${catalogId}`;
  }

  const code =
    normalizeConceptPart(retention.retentionCode) ||
    normalizeConceptPart(retention.retentionErpCode);
  return [
    "legacy",
    code,
    normalizeConceptPart(retention.description),
    normalizePercentage(retention.percentage),
  ].join(":");
}

export function consolidateRetentionsForPrint(
  retentions: RetentionPrintInput[]
): ConsolidatedRetentionPrintConcept[] {
  const concepts = new Map<string, ConsolidatedRetentionPrintConcept>();

  retentions.forEach(retention => {
    const key = getRetentionConceptKey(retention);
    const baseAmount = toNumber(retention.baseAmount);
    const amount = calculateRetentionPrintAmount(
      retention.baseAmount,
      retention.percentage
    );
    const current = concepts.get(key);

    if (current) {
      current.baseAmount = roundToFourDecimals(current.baseAmount + baseAmount);
      current.amount = roundToFourDecimals(current.amount + amount);
      current.sourceCount += 1;
      return;
    }

    const catalogId = String(retention.retentionCatalogId ?? "").trim();
    concepts.set(key, {
      retentionCatalogId:
        catalogId && catalogId.toLowerCase() !== "none" ? catalogId : null,
      retentionCode: retention.retentionCode?.trim() || null,
      retentionErpCode: retention.retentionErpCode?.trim() || null,
      description:
        retention.description?.trim() ||
        retention.retentionCode?.trim() ||
        "Retención",
      baseAmount: roundToFourDecimals(baseAmount),
      percentage: retention.percentage ?? 0,
      amount,
      sourceCount: 1,
    });
  });

  return Array.from(concepts.values());
}

export function getPrintableRetentionConcepts(
  retentions: RetentionPrintInput[],
  maxConcepts = MAX_PREPRINTED_RETENTION_CONCEPTS
) {
  const concepts = consolidateRetentionsForPrint(retentions);
  const printableConcepts = concepts.slice(0, maxConcepts);

  return {
    concepts,
    printableConcepts,
    truncated: concepts.length > printableConcepts.length,
  };
}
