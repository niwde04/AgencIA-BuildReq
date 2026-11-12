import { afterEach, describe, expect, it, vi } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { users } from "../drizzle/schema";
import {
  omitUserProfileFields,
  selectPublicUserColumns,
} from "./userPublicProjection";

const { queries } = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("pg", () => ({
  Pool: class {
    on() {}
    async query(config: { text: string } | string) {
      queries.push(typeof config === "string" ? config : config.text);
      return { rows: [] };
    }
  },
}));

import * as db from "./db";
import { listPurchaseOrderAdvances } from "./purchaseOrderAdvances";

afterEach(() => {
  vi.unstubAllEnvs();
  queries.length = 0;
});

describe("datos personales fuera de documentos operativos", () => {
  it.each([users, alias(users, "request_creator")])(
    "excluye únicamente los campos de perfil tanto en usuarios como en alias",
    table => {
      expect(Object.keys(selectPublicUserColumns(table)).sort()).toEqual(
        Object.keys(getTableColumns(table))
          .filter(key => !["phone", "jobTitle", "identityNumber"].includes(key))
          .sort()
      );
    }
  );

  it("quita el perfil de un solicitante obtenido desde gestión de usuarios", () => {
    const account = {
      id: 2,
      name: "Solicitante",
      email: "solicitante@example.com",
      assignedProjectIds: [3],
      phone: "+504 0000-0000",
      jobTitle: "Supervisor",
      identityNumber: "0801-1990-00001",
    };
    expect(omitUserProfileFields(account)).toEqual({
      id: account.id,
      name: account.name,
      email: account.email,
      assignedProjectIds: [3],
    });
    expect(account.identityNumber).toBe("0801-1990-00001");
  });

  it.each([
    ["listado de requisiciones", () => db.listMaterialRequests()],
    ["detalle de requisición", () => db.getMaterialRequestById(1)],
    ["listado de solicitudes de compra", () => db.listPurchaseRequests()],
    ["listado de anticipos", () => listPurchaseOrderAdvances()],
  ] as const)("no consulta campos personales en %s", async (_, execute) => {
    vi.stubEnv("DATABASE_URL", "postgresql://mock:mock@127.0.0.1/mock");
    await execute();
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query).not.toMatch(/"(?:phone|jobTitle|identityNumber)"/);
      expect(query).toContain('"name"');
    }
  });
});
