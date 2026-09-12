import { describe, expect, it } from "vitest";
import {
  formatProjectLabel,
  getArticleProjectLabel,
  type ProjectLabelReference,
} from "../shared/article-project-label";

describe("article project labels", () => {
  it.each([
    [18, "010", "Sistema de Agua Potable San José"],
    [20, "015", "Proyecto con ID 20"],
    [21, "017", "CA-4 Ocotepeque - El Portillo"],
    [24, "019", "Proyecto con ID 24"],
  ])(
    "uses the project data returned with fixed asset %i",
    (projectId, projectCode, projectName) => {
      expect(
        getArticleProjectLabel(
          {
            tipoArticulo: 3,
            projectId,
            projectCode,
            projectName,
          },
          new Map()
        )
      ).toBe(`${projectCode} - ${projectName}`);
    }
  );

  it("falls back to the project options for older responses", () => {
    const projects = new Map<number, ProjectLabelReference>([
      [
        21,
        {
          id: 21,
          code: "017",
          name: "CA-4 Ocotepeque - El Portillo",
        },
      ],
    ]);

    expect(
      getArticleProjectLabel({ tipoArticulo: 3, projectId: 21 }, projects)
    ).toBe("017 - CA-4 Ocotepeque - El Portillo");
  });

  it("never presents an unresolved database ID as the project name", () => {
    expect(
      getArticleProjectLabel({ tipoArticulo: 3, projectId: 24 }, new Map())
    ).toBe("Proyecto sin nombre");
  });

  it("keeps the existing labels for non-assets and unassigned assets", () => {
    expect(
      getArticleProjectLabel({ tipoArticulo: 1, projectId: 18 }, new Map())
    ).toBe("-");
    expect(
      getArticleProjectLabel({ tipoArticulo: 3, projectId: null }, new Map())
    ).toBe("Sin proyecto");
    expect(formatProjectLabel({ id: 20, name: "Proyecto sin código" })).toBe(
      "Proyecto sin código"
    );
  });
});
