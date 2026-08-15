export type ReceiptArticleIdentity = {
  brand?: string | null;
  partNumber?: string | null;
};

export function normalizeReceiptArticleIdentity(
  value: string | null | undefined
) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-HN");
}

export function isReceiptArticleSubstitution(params: {
  requested: ReceiptArticleIdentity;
  received: ReceiptArticleIdentity;
}) {
  return (
    normalizeReceiptArticleIdentity(params.requested.brand) !==
      normalizeReceiptArticleIdentity(params.received.brand) ||
    normalizeReceiptArticleIdentity(params.requested.partNumber) !==
      normalizeReceiptArticleIdentity(params.received.partNumber)
  );
}

export function normalizeReceiptArticleValue(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}
