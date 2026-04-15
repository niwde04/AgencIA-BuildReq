export type ParsedDemoProject = {
  code: string;
  name: string;
  description?: string;
  location?: string;
  sapProjectCode?: string;
};

export type ParsedDemoArticle = {
  itemCode: string;
  description: string;
  fullDescription?: string;
  warehouseCode?: string;
  warehouseName?: string;
  warehouseLocation?: string;
  stock?: string;
};

export type ParsedDemoSupplier = {
  supplierCode: string;
  name: string;
  groupCode?: string;
  groupName?: string;
};

export type ParsedDemoImportPayload = {
  projects: ParsedDemoProject[];
  articles: ParsedDemoArticle[];
  suppliers: ParsedDemoSupplier[];
};

export function getDemoImportWorkload(payload: ParsedDemoImportPayload) {
  const catalogArticles = new Set(
    payload.articles.map((article) => article.itemCode)
  ).size;

  return {
    projects: payload.projects.length,
    catalogArticles,
    inventoryRows: payload.articles.length,
    suppliers: payload.suppliers.length,
    totalRows:
      payload.projects.length +
      catalogArticles +
      payload.articles.length +
      payload.suppliers.length,
  };
}

function normalizeHeader(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitDelimitedLine(line: string) {
  const delimiter = line.includes("\t")
    ? "\t"
    : line.includes(";")
      ? ";"
      : ",";

  return line
    .split(delimiter)
    .map((cell) => cell.replace(/\u00a0/g, " ").trim());
}

function parseTable(raw?: string | null) {
  if (!raw?.trim()) return [] as string[][];

  return raw
    .split(/\r?\n/)
    .map((line) => splitDelimitedLine(line))
    .filter((cells) => cells.some((cell) => cell.length > 0));
}

function dropHeaderRow(
  rows: string[][],
  matcher: (row: string[]) => boolean
) {
  if (rows.length === 0) return rows;
  return matcher(rows[0]) ? rows.slice(1) : rows;
}

function dedupeByKey<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) {
    map.set(getKey(row), row);
  }
  return Array.from(map.values());
}

function buildWarehouseLocation(
  warehouseCode?: string,
  warehouseName?: string
) {
  if (warehouseCode && warehouseName) {
    return `${warehouseCode} - ${warehouseName}`;
  }
  return warehouseCode || warehouseName || undefined;
}

export function normalizeNumberString(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const compact = trimmed.replace(/\s+/g, "");
  if (!/[0-9]/.test(compact)) return undefined;

  if (compact.includes(",") && compact.includes(".")) {
    if (compact.lastIndexOf(",") > compact.lastIndexOf(".")) {
      const normalized = compact.replace(/\./g, "").replace(",", ".");
      return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : undefined;
    }

    const normalized = compact.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : undefined;
  }

  if (compact.includes(",")) {
    const parts = compact.split(",");
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      const normalized = `${parts[0].replace(/\./g, "")}.${parts[1]}`;
      return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : undefined;
    }

    const normalized = compact.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : undefined;
  }

  return /^-?\d+(\.\d+)?$/.test(compact) ? compact : undefined;
}

function isProjectsHeader(row: string[]) {
  const first = normalizeHeader(row[0]);
  const second = normalizeHeader(row[1]);
  return (
    first.includes("codigo") &&
    first.includes("proyecto") &&
    second.includes("nombre")
  );
}

function isArticlesHeader(row: string[]) {
  const first = normalizeHeader(row[0]);
  const second = normalizeHeader(row[1]);
  const fourth = normalizeHeader(row[3]);
  return (
    (first.includes("numero") || first.includes("codigo")) &&
    second.includes("almacen") &&
    fourth.includes("descripcion")
  );
}

function isSuppliersHeader(row: string[]) {
  const first = normalizeHeader(row[0]);
  const second = normalizeHeader(row[1]);
  return first.includes("codigo") && second.includes("nombre");
}

export function parseProjectsPaste(raw?: string | null) {
  const rows = dropHeaderRow(parseTable(raw), isProjectsHeader);

  return dedupeByKey(
    rows
      .map((row) => {
        const code = row[0]?.trim();
        const name = row[1]?.trim();

        if (!code || !name) return null;

        return {
          code,
          name,
        } satisfies ParsedDemoProject;
      })
      .filter((row): row is ParsedDemoProject => Boolean(row)),
    (row) => row.code
  );
}

export function parseArticlesPaste(raw?: string | null) {
  const rows = dropHeaderRow(parseTable(raw), isArticlesHeader);
  const parsed: ParsedDemoArticle[] = [];

  for (const row of rows) {
    const itemCode = row[0]?.trim();
    const warehouseCode = row[1]?.trim() || undefined;
    const warehouseName = row[2]?.trim() || undefined;
    const shortDescription = row[3]?.trim();
    const fullDescription = row[4]?.trim() || undefined;
    const description = shortDescription || fullDescription;

    if (!itemCode || !description) continue;

    const article: ParsedDemoArticle = {
      itemCode,
      description,
      warehouseCode,
      warehouseName,
      warehouseLocation: buildWarehouseLocation(warehouseCode, warehouseName),
      stock: normalizeNumberString(row[6] ?? row[row.length - 1]),
    };

    if (fullDescription !== undefined) {
      article.fullDescription = fullDescription;
    }

    parsed.push(article);
  }

  return dedupeByKey(
    parsed,
    (row) => `${row.itemCode}::${row.warehouseLocation ?? ""}`
  );
}

export function parseSuppliersPaste(raw?: string | null) {
  const rows = dropHeaderRow(parseTable(raw), isSuppliersHeader);
  const parsed: ParsedDemoSupplier[] = [];

  for (const row of rows) {
    const supplierCode = row[0]?.trim();
    const name = row[1]?.trim();

    if (!supplierCode || !name) continue;

    const supplier: ParsedDemoSupplier = {
      supplierCode,
      name,
    };

    if (row[2]?.trim()) {
      supplier.groupCode = row[2].trim();
    }
    if (row[3]?.trim()) {
      supplier.groupName = row[3].trim();
    }

    parsed.push(supplier);
  }

  return dedupeByKey(parsed, (row) => row.supplierCode);
}

export function parseDemoImportInput(input: {
  projectsTsv?: string;
  articlesTsv?: string;
  suppliersTsv?: string;
}): ParsedDemoImportPayload {
  const payload = {
    projects: parseProjectsPaste(input.projectsTsv),
    articles: parseArticlesPaste(input.articlesTsv),
    suppliers: parseSuppliersPaste(input.suppliersTsv),
  } satisfies ParsedDemoImportPayload;

  const totalRows =
    payload.projects.length + payload.articles.length + payload.suppliers.length;

  if (totalRows === 0) {
    throw new Error(
      "Pegue al menos una tabla con datos demo antes de iniciar la carga"
    );
  }

  return payload;
}
