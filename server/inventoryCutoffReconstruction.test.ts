import { describe, expect, it } from "vitest";
import {
  cutoffDayExclusive,
  cutoffInstant,
  hondurasDate,
  reconstructDocumentaryStock,
  reconstructRecordedStock,
  twoMonthsBefore,
  type CutoffStock,
  type CutoffMovement,
} from "./inventoryCutoffReconstruction";

const start = "2026-09-30T04:30:00Z";
const activation = "2026-11-12T17:00:00Z";
const stock = (
  location: string,
  quantity: string,
  extra: Partial<CutoffStock> = {}
): CutoffStock => ({
  id: location === "A" ? 1 : 2,
  sapItemCode: "00123",
  name: "Material",
  projectId: 1,
  warehouseId: 2,
  storageLocation: location,
  unit: "und",
  currentStock: quantity,
  ...extra,
});
const movement = (
  id: string,
  location: string | null,
  quantity: string,
  direction: 1 | -1,
  extra: Partial<CutoffMovement> = {}
): CutoffMovement => ({
  id,
  at: "2026-10-05T12:00:00Z",
  sapItemCode: "00123",
  itemName: "Material",
  unit: "und",
  projectId: 1,
  warehouseId: 2,
  storageLocation: location,
  locationKnown: location !== null,
  quantity,
  direction,
  ...extra,
});

describe("reporte de inventario por ubicación a fecha de corte", () => {
  it("conserva separado cada estante y aplica reubicaciones a la fecha efectiva registrada", () => {
    const input = {
      baseline: [stock("A", "10"), stock("B", "5")],
      baselineAt: start,
      activation: [stock("A", "7"), stock("B", "8")],
      activationAt: activation,
      movements: [movement("out", "A", "3", -1), movement("in", "B", "3", 1)],
    };
    const before = reconstructDocumentaryStock({
      ...input,
      cutoffExclusive: cutoffDayExclusive("2026-10-01"),
    });
    expect(before.map(x => x.quantity)).toEqual([10, 5]);
    const after = reconstructDocumentaryStock({
      ...input,
      cutoffExclusive: cutoffDayExclusive("2026-10-10"),
    });
    expect(
      after.map(x => [x.row.storageLocation, x.quantity, x.coverage])
    ).toEqual([
      ["A", 7, "documentary"],
      ["B", 8, "documentary"],
    ]);
  });

  it("no asigna por suposición un consumo sin ubicación a ningún estante", () => {
    const rows = reconstructDocumentaryStock({
      baseline: [stock("A", "10"), stock("B", "5")],
      baselineAt: start,
      activation: [stock("A", "6"), stock("B", "5")],
      activationAt: activation,
      cutoffExclusive: cutoffDayExclusive("2026-10-10"),
      movements: [movement("out", null, "4", -1)],
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every(x => x.quantity === null && x.coverage === "unavailable")
    ).toBe(true);
    expect(rows.some(x => x.row.storageLocation === "Sin ubicación")).toBe(
      false
    );
  });

  it("deja N/D cuando la proyección no concilia con la apertura real", () => {
    const rows = reconstructDocumentaryStock({
      baseline: [stock("A", "10")],
      baselineAt: start,
      activation: [stock("A", "7")],
      activationAt: activation,
      cutoffExclusive: cutoffDayExclusive("2026-10-01"),
      movements: [],
    });
    expect(rows[0]).toMatchObject({ quantity: null, coverage: "unavailable" });
  });

  it("recupera stock histórico aunque el saldo posterior sea cero", () => {
    const rows = reconstructDocumentaryStock({
      baseline: [stock("A", "10")],
      baselineAt: start,
      activation: [stock("A", "0")],
      activationAt: activation,
      cutoffExclusive: cutoffDayExclusive("2026-10-01"),
      movements: [movement("out", "A", "10", -1)],
    });
    expect(rows[0].quantity).toBe(10);
  });

  it("calcula decimales de existencias sin residuos de coma flotante", () => {
    const rows = reconstructDocumentaryStock({
      baseline: [stock("A", "0.10")],
      baselineAt: start,
      activation: [stock("A", "0")],
      activationAt: activation,
      cutoffExclusive: cutoffDayExclusive("2026-10-10"),
      movements: [
        movement("in", "A", "0.20", 1),
        movement("out", "A", "0.30", -1),
      ],
    });
    expect(rows).toEqual([]);
  });

  it("no duplica movimientos al combinar fuentes", () => {
    expect(() =>
      reconstructDocumentaryStock({
        baseline: [stock("A", "10")],
        baselineAt: start,
        activation: [stock("A", "8")],
        activationAt: activation,
        cutoffExclusive: cutoffDayExclusive("2026-10-10"),
        movements: [
          movement("duplicate", "A", "1", -1),
          movement("duplicate", "A", "1", -1),
        ],
      })
    ).toThrow("duplicado");
  });

  it("captura cambio de ubicación y borrado sin perder la distribución anterior", () => {
    const changes = [
      {
        changedAt: "2026-11-13T12:00:00Z",
        beforeRow: stock("A", "10"),
        afterRow: stock("B", "10"),
      },
      {
        changedAt: "2026-11-14T12:00:00Z",
        beforeRow: stock("B", "10"),
        afterRow: null,
      },
    ];
    const prior = reconstructRecordedStock({
      baseline: [stock("A", "10")],
      baselineAt: activation,
      cutoffExclusive: cutoffDayExclusive("2026-11-12"),
      changes,
    });
    expect(prior[0]).toMatchObject({
      quantity: 10,
      coverage: "recorded",
      row: { storageLocation: "A" },
    });
    const afterMove = reconstructRecordedStock({
      baseline: [stock("A", "10")],
      baselineAt: activation,
      cutoffExclusive: cutoffDayExclusive("2026-11-13"),
      changes,
    });
    expect(afterMove[0].row.storageLocation).toBe("B");
    expect(
      reconstructRecordedStock({
        baseline: [stock("A", "10")],
        baselineAt: activation,
        cutoffExclusive: cutoffDayExclusive("2026-11-14"),
        changes,
      })
    ).toEqual([]);
  });

  it("aplica límite exclusivo del día siguiente en Honduras", () => {
    expect(cutoffDayExclusive("2026-11-12")).toBe("2026-11-13T06:00:00.000Z");
    expect(hondurasDate("2026-11-13 05:59:59.999")).toBe("2026-11-12");
    expect(hondurasDate("2026-11-13T06:00:00Z")).toBe("2026-11-13");
    expect(cutoffInstant("2026-11-12 12:00:00+00")).toBe(
      Date.parse("2026-11-12T12:00:00Z")
    );
    expect(() => cutoffDayExclusive("2026-02-30")).toThrow();
  });

  it("limita dos meses por calendario y respeta el último día disponible", () => {
    expect(twoMonthsBefore("2026-11-12")).toBe("2026-09-12");
    expect(twoMonthsBefore("2026-04-30")).toBe("2026-02-28");
  });
});
