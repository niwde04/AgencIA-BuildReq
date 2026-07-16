export type ExportPage<T> = {
  items: T[];
  totalPages: number;
};

export async function fetchAllFilteredPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<ExportPage<T>>,
  pageSize = 200
) {
  const firstPage = await fetchPage(1, pageSize);
  const items = [...firstPage.items];

  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    const nextPage = await fetchPage(page, pageSize);
    items.push(...nextPage.items);
  }

  return items;
}
