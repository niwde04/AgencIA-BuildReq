import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpeningBalanceDocument,
  type OpeningBalanceDocumentDetail,
} from "./openingBalanceDocument";
import { openingBalancesRouter } from "./routers/openingBalances";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";

function fixture(): OpeningBalanceDocumentDetail {
  return {
    openingBalance: {
      balanceNumber: "SI-018-00000001",
      openingDate: new Date("2026-10-22T00:00:00Z"),
      notes: "CONTEO FÍSICO POR INVENTARIO",
    },
    project: { code: "018", name: "El Zamorano" },
    warehouse: { displayName: "018 - EL ZAMORANO" },
    createdBy: { name: "Responsable del registro" },
    items: [
      {
        sapItemCode: "09020032",
        itemName: "FILTRO COMBUSTIBLE",
        quantity: "1.25",
        unit: "und",
        storageLocation: "2C1",
        project: { code: "018", name: "El Zamorano" },
      },
      {
        sapItemCode: "09020032",
        itemName: "FILTRO EN OTRO DESTINO",
        quantity: "2.00",
        unit: "und",
        storageLocation: "2D1",
        project: { code: "024", name: "Proyecto compartido" },
        notes: "Observación de línea",
      },
    ],
  };
}
function text(base64: string) {
  const pdf = Buffer.from(base64, "base64").toString("latin1");
  return [...pdf.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map(match => Buffer.from(match[1], "hex").toString("latin1"))
    .join(" ");
}
const context = (role: string, buildreqRole: string) =>
  ({
    user: { id: 1, role, buildreqRole },
    req: { headers: {} },
    res: {},
  }) as unknown as TrpcContext;
afterEach(() => vi.restoreAllMocks());

describe("opening balance PDF", () => {
  it("uses the existing branded document with the current folio, historical date, per-line destinations and observations", () => {
    const document = buildOpeningBalanceDocument(
      fixture(),
      new Date("2026-10-23T16:00:00Z")
    );
    const pdf = Buffer.from(document.content, "base64").toString("latin1");
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("/HehLogo Do");
    expect(document.name).toBe("saldo-inicial-SI-018-00000001.pdf");
    expect(document.mimeType).toBe("application/pdf");
    for (const value of [
      "SI-018-00000001",
      "21/10/2026",
      "Responsable del registro",
      "09020032",
      "1.25 und",
      "2.00 und",
      "2C1",
      "2D1",
      "024 - Proyecto compartido",
      "Observación de línea",
      "CONTEO FÍSICO POR INVENTARIO",
      "Total renglones",
      "Total códigos SAP",
    ])
      expect(text(document.content)).toContain(value);
    expect(text(document.content)).not.toContain("Reingreso a Bodega");
    expect(text(document.content)).not.toContain("Marca");
  });

  it("includes the last of 169 items and all long descriptions and observations across pages", () => {
    const detail = fixture();
    detail.items = Array.from({ length: 169 }, (_, index) => ({
      ...detail.items[0],
      sapItemCode: `000${index}`,
      itemName: `ARTÍCULO ${index + 1}`,
    }));
    detail.items[0].itemName = "DESCRIPCIÓN ".repeat(45) + "FIN_DESCRIPCION";
    detail.items[0].notes =
      "OBSERVACION DE LINEA ".repeat(180) + "FIN_NOTA_LINEA";
    detail.openingBalance.notes =
      "OBSERVACIONES GENERALES ".repeat(180) + "FIN_OBSERVACIONES";
    const document = buildOpeningBalanceDocument(detail);
    const content = text(document.content);
    for (const value of [
      "ARTÍCULO 169",
      "FIN_DESCRIPCION",
      "FIN_NOTA_LINEA",
      "FIN_OBSERVACIONES",
    ])
      expect(content).toContain(value);
    expect(
      (
        Buffer.from(document.content, "base64")
          .toString("latin1")
          .match(/\/Type \/Page\b/g) ?? []
      ).length
    ).toBeGreaterThan(2);
  });

  it.each([
    ["admin", "ingeniero_residente"],
    ["user", "administracion_central"],
    ["user", "jefe_bodega_central"],
  ])(
    "allows the same opening balance readers: %s / %s",
    async (role, buildreqRole) => {
      const read = vi
        .spyOn(db, "getOpeningBalanceById")
        .mockResolvedValue(fixture() as any);
      const caller = openingBalancesRouter.createCaller(
        context(role, buildreqRole)
      );
      const document = await caller.getDocument({ id: 4 });
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(4);
      expect(document.name).toBe("saldo-inicial-SI-018-00000001.pdf");
    }
  );
  it("denies unauthorized users before reading the document", async () => {
    const read = vi.spyOn(db, "getOpeningBalanceById");
    const caller = openingBalancesRouter.createCaller(
      context("user", "ingeniero_residente")
    );
    await expect(caller.getDocument({ id: 4 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("reports missing balances without generating a misleading PDF", async () => {
    vi.spyOn(db, "getOpeningBalanceById").mockResolvedValue(undefined);
    const caller = openingBalancesRouter.createCaller(
      context("admin", "administracion_central")
    );
    await expect(caller.getDocument({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
