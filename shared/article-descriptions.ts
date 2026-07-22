export const ARTICLE_DESCRIPTION_MAX_LENGTH = 500;

export function uppercaseArticleDescription(value: string) {
  return value.toUpperCase();
}

export function normalizeArticleDescription(value: string) {
  return uppercaseArticleDescription(value.trim());
}

export function normalizeOptionalArticleDescription<
  T extends string | null | undefined,
>(value: T): T {
  if (typeof value !== "string") return value;
  return normalizeArticleDescription(value) as T;
}
