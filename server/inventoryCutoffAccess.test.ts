import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryRouter } from "./routers/inventory";
import * as db from "./db";
import * as report from "./inventoryCutoffReport";
import type { TrpcContext } from "./_core/context";

function caller(role: string, extra: Record<string, unknown> = {}) {
  return inventoryRouter.createCaller({
    user: {
      id: 1,
      role: "user",
      buildreqRole: role,
      assignedProjectIds: [1],
      assignedProjectId: 1,
      ...extra,
    },
    req: { headers: {} },
    res: {},
  } as unknown as TrpcContext);
}
afterEach(() => vi.restoreAllMocks());

describe("permisos del reporte de inventario a fecha de corte", () => {
  it("rechaza al residente antes de consultar datos históricos", async () => {
    const read = vi
      .spyOn(report, "getInventoryCutoffReport")
      .mockResolvedValue({} as any);
    await expect(
      caller("ingeniero_residente").cutoffReport({ cutoffDate: "2026-10-31" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
  });
  it("limita bodeguero a sus almacenes asignados incluso sin filtro", async () => {
    vi.spyOn(db, "listWarehouses").mockResolvedValue([{ id: 2 }] as any);
    const read = vi
      .spyOn(report, "getInventoryCutoffReport")
      .mockResolvedValue({} as any);
    await caller("bodeguero_proyecto").cutoffReport({
      cutoffDate: "2026-10-31",
    });
    expect(read).toHaveBeenCalledWith(
      { cutoffDate: "2026-10-31" },
      { warehouseIds: [2], projectIds: null }
    );
  });
  it("no permite seleccionar un almacén ajeno", async () => {
    vi.spyOn(db, "listWarehouses").mockResolvedValue([{ id: 2 }] as any);
    const read = vi
      .spyOn(report, "getInventoryCutoffReport")
      .mockResolvedValue({} as any);
    await expect(
      caller("bodeguero_proyecto").cutoffReport({
        cutoffDate: "2026-10-31",
        warehouseId: 9,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
  });
  it("una cuenta sin almacenes no convierte el conjunto vacío en acceso global", async () => {
    vi.spyOn(db, "listWarehouses").mockResolvedValue([] as any);
    const read = vi
      .spyOn(report, "getInventoryCutoffReport")
      .mockResolvedValue({} as any);
    await caller("bodeguero_proyecto").cutoffReport({
      cutoffDate: "2026-10-31",
    });
    expect(read.mock.calls[0][1]).toEqual({
      warehouseIds: [],
      projectIds: null,
    });
  });
  it("permite a Administración Central seleccionar proyecto y almacén", async () => {
    const read = vi
      .spyOn(report, "getInventoryCutoffReport")
      .mockResolvedValue({} as any);
    await caller("administracion_central").cutoffReport({
      cutoffDate: "2026-10-31",
      projectId: 3,
      warehouseId: 2,
    });
    expect(read.mock.calls[0][1]).toEqual({
      warehouseIds: [2],
      projectIds: [3],
    });
  });
});
