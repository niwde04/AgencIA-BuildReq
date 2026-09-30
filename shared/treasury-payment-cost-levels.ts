export type TreasuryPaymentCostMatrixEntry = {
  n1: string;
  nivel1: string;
  n2: string;
  nivel2: string;
  n3: string;
  nivel3: string;
  n4: string;
  nivel4: string;
};
export type TreasuryPaymentCostLevels = {
  level1: string;
  level2: string;
  level3: string;
  level4: string;
};
export function emptyTreasuryPaymentCostLevels(): TreasuryPaymentCostLevels {
  return { level1: "", level2: "", level3: "", level4: "" };
}
// Resolve using stored relationships, never prefixes of a financial code.
// Job remains the invoice's real job; matrix jobs are independent catalog data.
export function createTreasuryPaymentCostLevelResolver(
  entries: TreasuryPaymentCostMatrixEntry[]
) {
  const byFinancialCode = new Map<string, TreasuryPaymentCostMatrixEntry[]>();
  for (const entry of entries) {
    const current = byFinancialCode.get(entry.n4) ?? [];
    current.push(entry);
    byFinancialCode.set(entry.n4, current);
  }
  return (
    financialCode: string,
    financialGroupLevel2Code?: string
  ): TreasuryPaymentCostLevels => {
    const code = financialCode.trim();
    if (!code) return emptyTreasuryPaymentCostLevels();
    const n2 = financialGroupLevel2Code?.trim();
    const matchingCode = byFinancialCode.get(code) ?? [];
    if (!matchingCode.length)
      return { ...emptyTreasuryPaymentCostLevels(), level1: "SIN MATRIZ" };
    // The financial code identifies a unique classification in most cases.
    // Consult codN2 only to disambiguate repeated codes; legacy group metadata can be stale.
    const candidates =
      matchingCode.length === 1
        ? matchingCode
        : matchingCode.filter(entry => !n2 || entry.n2 === n2);
    if (!candidates.length)
      return { ...emptyTreasuryPaymentCostLevels(), level1: "REVISAR MATRIZ" };
    const labels = candidates.map(entry => ({
      level1: entry.n1 + " · " + entry.nivel1,
      level2: entry.n2 + " · " + entry.nivel2,
      level3: entry.n3 + " · " + entry.nivel3,
      level4: entry.n4 + " · " + entry.nivel4,
    }));
    // Equivalent classifications may appear under more than one catalog job.
    if (
      labels.some(value => JSON.stringify(value) !== JSON.stringify(labels[0]))
    )
      return { ...emptyTreasuryPaymentCostLevels(), level1: "REVISAR MATRIZ" };
    return labels[0];
  };
}
