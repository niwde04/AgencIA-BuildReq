import { describe, expect, it } from "vitest";
import {
  buildProjectSubprojectImportPlan,
  parseSubprojectSheetRows,
  type DbProject,
  type DbSubproject,
} from "../scripts/import-project-subprojects";

const headerRows = [
  [".", "Plantilla de Subproyecto Sistema BuildReq", null, null, null, null, null],
  [
    null,
    "Job o Proyecto",
    "Código *",
    "Nombre Subproyecto",
    "Breve Descripción del Subproyecto o actividad especifica",
    "Fecha de Inicio",
    "Fecha Finalización",
  ],
];

function buildTemplateRows(count: number) {
  const dataRows = Array.from({ length: count }, (_value, index) => {
    const code =
      index === 0
        ? "001"
        : index === 1
          ? "1.01"
          : String(index + 1).padStart(3, "0");

    return [
      null,
      "017 CA 4 -Ocotepeque - El Portillo",
      code,
      `Subproyecto ${code}`,
      `Descripcion ${code}`,
      "01 -07 -2026",
      "07 -02 -2027",
    ];
  });

  return [
    ...headerRows,
    ...dataRows,
    [null, "Total", "40", null, null, null, null],
    [".", null, null, null, null, null, null],
  ];
}

describe("import-project-subprojects", () => {
  it("parses the 41 useful rows and skips total/visual rows", () => {
    const result = parseSubprojectSheetRows(buildTemplateRows(41));

    expect(result.headerRowNumber).toBe(2);
    expect(result.parsedRows).toHaveLength(41);
    expect(result.validationErrors).toHaveLength(0);
    expect(result.skippedRows.map(row => row.reason)).toEqual([
      "Fila de total",
      "Fila visual sin datos",
    ]);
  });

  it("keeps leading-zero and decimal codes as text", () => {
    const result = parseSubprojectSheetRows(buildTemplateRows(3));

    expect(result.parsedRows.map(row => row.code)).toEqual([
      "001",
      "1.01",
      "003",
    ]);
    expect(result.parsedRows[0].startDateIso).toBe("2026-07-01");
    expect(result.parsedRows[0].endDateIso).toBe("2027-02-07");
  });

  it("plans inserts, updates, unchanged rows, and existing rows not listed by project/code", () => {
    const rows = [
      ...headerRows,
      [
        null,
        "017 CA 4 -Ocotepeque - El Portillo",
        "001",
        "Nuevo",
        "Nuevo desc",
        "01 -07 -2026",
        "07 -02 -2027",
      ],
      [
        null,
        "017 CA 4 -Ocotepeque - El Portillo",
        "1.01",
        "Actualizado",
        "Nueva desc",
        "01 -07 -2026",
        "07 -02 -2027",
      ],
      [
        null,
        "017 CA 4 -Ocotepeque - El Portillo",
        "003",
        "Sin cambios",
        "Misma desc",
        "01 -07 -2026",
        "07 -02 -2027",
      ],
    ];
    const parseResult = parseSubprojectSheetRows(rows);
    const projects: DbProject[] = [
      { id: 21, code: "017", name: "CA-4 Ocotepeque - El Portillo" },
    ];
    const subprojects: DbSubproject[] = [
      {
        id: 6,
        projectId: 21,
        code: "17_01",
        name: "BORDILLOS CONCRETO",
        description: null,
        startDate: null,
        endDate: null,
        isActive: true,
      },
      {
        id: 7,
        projectId: 21,
        code: "1.01",
        name: "Anterior",
        description: null,
        startDate: null,
        endDate: null,
        isActive: false,
      },
      {
        id: 8,
        projectId: 21,
        code: "003",
        name: "Sin cambios",
        description: "Misma desc",
        startDate: new Date(2026, 6, 1),
        endDate: new Date(2027, 1, 7),
        isActive: true,
      },
    ];

    const plan = buildProjectSubprojectImportPlan(parseResult, {
      projects,
      subprojects,
    });

    expect(plan.validationErrors).toHaveLength(0);
    expect(plan.inserts.map(row => row.code)).toEqual(["001"]);
    expect(plan.updates.map(row => row.code)).toEqual(["1.01"]);
    expect(plan.updates[0].changedFields).toEqual([
      "name",
      "description",
      "startDate",
      "endDate",
      "isActive",
    ]);
    expect(plan.unchanged.map(row => row.code)).toEqual(["003"]);
    expect(plan.existingNotListed.map(row => row.code)).toEqual(["17_01"]);
  });
});
