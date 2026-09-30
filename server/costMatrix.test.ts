import { describe, expect, it } from "vitest";
import {
  canManageCostMatrix,
  costMatrixFields,
  deriveCostMatrix,
} from "../shared/cost-matrix";
import { validateCostMatrixSeed } from "../scripts/cost-matrix-import";
import seed from "../data/cost-matrix/initial.json";
import report from "../data/cost-matrix/source-report.json";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
describe("Matriz: contrato y normalización", () => {
  it("reproduce 539 registros, sus jobs y la huella publicada", () => {
    expect(validateCostMatrixSeed(seed)).toHaveLength(539);
    expect(seed.filter(r => r.jobCode === "001")).toHaveLength(331);
    expect(seed.filter(r => r.jobCode === "999")).toHaveLength(208);
    expect(report.removedDuplicates).toBe(45);
    expect(report.corrections).toHaveLength(99);
    expect(
      createHash("sha256")
        .update(readFileSync("data/cost-matrix/initial.json"))
        .digest("hex")
    ).toBe(report.seedSha256);
  });
  it("conserva ceros y no impone prefijos entre niveles", () => {
    const row = costMatrixFields.parse({
      ...seed[0],
      jobCode: "001",
      n1: "13",
      n2: "1401",
    });
    expect(deriveCostMatrix(row).matrixCode).toMatch(/^001-13-1401-/);
    expect(deriveCostMatrix(row).flow3).toBe("1401 " + row.nivel2);
  });
  it("consolida duplicados idénticos y rechaza contradictorios", () => {
    expect(validateCostMatrixSeed([seed[0], seed[0]])).toHaveLength(1);
    expect(() =>
      validateCostMatrixSeed([
        seed[0],
        { ...seed[0], flowActivity: "Otra actividad" },
      ])
    ).toThrow("contradictorios");
    expect(() =>
      validateCostMatrixSeed([
        seed[0],
        { ...seed[1], sourceKey: seed[0].sourceKey },
      ])
    ).toThrow("origen duplicada");
  });
  it("no permite campos derivados o auditoría en el importador", () => {
    expect(() =>
      validateCostMatrixSeed([{ ...seed[0], matrixCode: "false" }])
    ).toThrow();
  });
  it.each([
    [{ role: "admin" }, true],
    [{ role: "user", buildreqRole: "administracion_central" }, true],
    [{ role: "admin", buildreqRole: "gerente" }, false],
    [{ role: "admin", buildreqRole: "superintendente_aprobador" }, false],
    [{ role: "user", buildreqRole: "contable" }, false],
    [null, false],
  ])("permiso compartido %j = %s", (user, permitted) =>
    expect(canManageCostMatrix(user)).toBe(permitted)
  );
});
