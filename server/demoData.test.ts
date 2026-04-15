import { describe, expect, it } from "vitest";
import {
  normalizeNumberString,
  parseArticlesPaste,
  parseDemoImportInput,
} from "./_core/demoData";

describe("demoData parser", () => {
  it("parses pasted Excel tables and preserves identifiers", () => {
    const payload = parseDemoImportInput({
      projectsTsv: `Codigo de proyecto\tNombre de proyecto
001\tOFICINA CENTRAL
004B\tCA5 - MANTENIMIENTO RUTINARIO - B`,
      articlesTsv: `Numero de articulo\tCodigo de almacen\tNombre de almacen\tDescripcion del articulo\tDescripcion del articulo (sin recortar)\tFecha capitalizacion (AF)\tEn stock
01010100001\t010\tSAN JOSE\tDIESEL\tDIESEL\t\t6500`,
      suppliersTsv: `Codigo SN\tNombre SN\tCodigo de grupo\tNombre de grupo
PL-0666\tABCO HONDURAS SA DE CV\t186\tMANTENIMIENTO`,
    });

    expect(payload.projects).toEqual([
      { code: "001", name: "OFICINA CENTRAL" },
      {
        code: "004B",
        name: "CA5 - MANTENIMIENTO RUTINARIO - B",
      },
    ]);

    expect(payload.articles).toEqual([
      {
        itemCode: "01010100001",
        description: "DIESEL",
        fullDescription: "DIESEL",
        warehouseCode: "010",
        warehouseName: "SAN JOSE",
        warehouseLocation: "010 - SAN JOSE",
        stock: "6500",
      },
    ]);

    expect(payload.suppliers).toEqual([
      {
        supplierCode: "PL-0666",
        name: "ABCO HONDURAS SA DE CV",
        groupCode: "186",
        groupName: "MANTENIMIENTO",
      },
    ]);
  });

  it("deduplicates article rows by item and warehouse using the last value", () => {
    const rows = parseArticlesPaste(`Numero de articulo\tCodigo de almacen\tNombre de almacen\tDescripcion del articulo\tDescripcion del articulo (sin recortar)\tFecha capitalizacion (AF)\tEn stock
01010100001\t010\tSAN JOSE\tDIESEL\tDIESEL\t\t100
01010100001\t010\tSAN JOSE\tDIESEL PREMIUM\tDIESEL PREMIUM\t\t250`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemCode: "01010100001",
      description: "DIESEL PREMIUM",
      stock: "250",
    });
  });

  it("normalizes numeric formats coming from spreadsheets", () => {
    expect(normalizeNumberString("1,000")).toBe("1000");
    expect(normalizeNumberString("1.234,50")).toBe("1234.50");
    expect(normalizeNumberString("99.75")).toBe("99.75");
    expect(normalizeNumberString("texto")).toBeUndefined();
  });
});
