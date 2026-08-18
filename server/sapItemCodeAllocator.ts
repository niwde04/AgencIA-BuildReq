import {
  extractSapItemGroupCode,
  getNextSapItemCode,
} from "../shared/sap-item-codes";

export async function allocateNextSapItemCode<T>(params: {
  itemGroup: string | null | undefined;
  withGroupLock: <Result>(
    groupCode: string,
    allocate: () => Promise<Result>
  ) => Promise<Result>;
  findLatestItemCode: (groupCode: string) => Promise<string | null>;
  tryInsert: (itemCode: string) => Promise<T | null>;
  retryLimit?: number;
}) {
  const groupCode = extractSapItemGroupCode(params.itemGroup);
  if (!groupCode) {
    throw new Error(
      "El grupo SAP debe iniciar con 4 dígitos para generar el código automáticamente"
    );
  }

  return params.withGroupLock(groupCode, async () => {
    const retryLimit = params.retryLimit ?? 10;
    for (let attempt = 0; attempt < retryLimit; attempt += 1) {
      const latestItemCode = await params.findLatestItemCode(groupCode);
      const itemCode = getNextSapItemCode(groupCode, latestItemCode);
      const inserted = await params.tryInsert(itemCode);
      if (inserted !== null) return inserted;
    }

    throw new Error(
      `No se pudo reservar un código SAP consecutivo para el grupo ${groupCode}; intente registrar nuevamente`
    );
  });
}
