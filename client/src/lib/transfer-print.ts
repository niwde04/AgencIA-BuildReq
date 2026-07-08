type TransferPrintDetail = {
  transfer?: {
    preparedByName?: string | null;
  } | null;
  confirmedBy?: {
    name?: string | null;
  } | null;
};

export function getDefaultTransferPreparedByName(
  detail: TransferPrintDetail | null | undefined
) {
  return detail?.transfer?.preparedByName || detail?.confirmedBy?.name || "";
}
