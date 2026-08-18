export const SAP_ITEM_GROUP_CODE_LENGTH = 4;
export const SAP_ITEM_SEQUENCE_LENGTH = 5;
export const SAP_ITEM_SEQUENCE_MAX = 99_999;

export function extractSapItemGroupCode(itemGroup: string | null | undefined) {
  return String(itemGroup ?? "").match(/^\s*(\d{4})(?=\D|$)/)?.[1] ?? null;
}

export function formatSapItemCode(groupCode: string, sequence: number) {
  if (!/^\d{4}$/.test(groupCode)) {
    throw new Error(
      "El código del grupo SAP debe contener exactamente 4 dígitos"
    );
  }
  if (
    !Number.isInteger(sequence) ||
    sequence < 1 ||
    sequence > SAP_ITEM_SEQUENCE_MAX
  ) {
    throw new Error(
      `La secuencia SAP debe estar entre 1 y ${SAP_ITEM_SEQUENCE_MAX}`
    );
  }

  return `${groupCode}${String(sequence).padStart(SAP_ITEM_SEQUENCE_LENGTH, "0")}`;
}

export function getNextSapItemCode(
  groupCode: string,
  latestItemCode?: string | null
) {
  const expectedPattern = new RegExp(
    `^${groupCode}\\d{${SAP_ITEM_SEQUENCE_LENGTH}}$`
  );
  if (latestItemCode && !expectedPattern.test(latestItemCode)) {
    throw new Error(
      `El último código SAP ${latestItemCode} no pertenece al grupo ${groupCode}`
    );
  }

  const latestSequence = latestItemCode
    ? Number.parseInt(latestItemCode.slice(SAP_ITEM_GROUP_CODE_LENGTH), 10)
    : 0;
  if (latestSequence >= SAP_ITEM_SEQUENCE_MAX) {
    throw new Error(
      `El grupo SAP ${groupCode} agotó su secuencia de ${SAP_ITEM_SEQUENCE_LENGTH} dígitos`
    );
  }

  return formatSapItemCode(groupCode, latestSequence + 1);
}
