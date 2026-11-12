import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { userManagementRouter } from "./routers/userManagement";
import * as db from "./db";
import * as supabaseAdmin from "./_core/supabaseAdmin";

const now = new Date("2026-11-12T12:00:00.000Z");
const target = {
  id: 2,
  openId: "managed-user",
  name: "Usuario",
  email: "usuario@example.com",
  phone: "0012345678",
  jobTitle: "Contador",
  identityNumber: "0801-1990-00001",
  role: "user" as const,
  buildreqRole: "contable" as const,
  assignedProjectId: null,
  isActive: true,
  mustChangePassword: false,
  loginMethod: "email",
  createdAt: now,
  updatedAt: now,
  lastSignedIn: now,
};

function caller(overrides: Record<string, unknown> = {}) {
  return userManagementRouter.createCaller({
    user: {
      ...target,
      id: 1,
      role: "admin",
      buildreqRole: "administracion_central",
      ...overrides,
    },
    req: { headers: {} },
    res: {},
  } as TrpcContext);
}

const createInput = {
  name: "Usuario",
  email: "usuario@example.com",
  password: "temporary-password",
  buildreqRole: "contable" as const,
};
const updateInput = {
  userId: target.id,
  name: target.name,
  email: target.email,
  buildreqRole: target.buildreqRole,
  assignedProjectIds: [],
  isActive: true,
};

function mockStorage() {
  vi.spyOn(db, "getUserByEmail").mockResolvedValue(undefined);
  vi.spyOn(db, "getUserById").mockResolvedValue(target);
  const upsert = vi.spyOn(db, "upsertUser").mockResolvedValue(undefined);
  const update = vi
    .spyOn(db, "updateUserAdmin")
    .mockResolvedValue({ success: true });
  const createAuth = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: target.openId } }, error: null });
  const updateAuth = vi.fn().mockResolvedValue({ error: null });
  vi.spyOn(supabaseAdmin, "getSupabaseAdminClient").mockReturnValue({
    auth: { admin: { createUser: createAuth, updateUserById: updateAuth } },
  } as any);
  return { upsert, update, createAuth, updateAuth };
}

afterEach(() => vi.restoreAllMocks());

describe("campos de perfil de usuarios", () => {
  it("crea datos descriptivos sin perder ceros ni usar metadatos de autenticación", async () => {
    const { upsert, createAuth } = mockStorage();
    await caller().createDirect({
      ...createInput,
      phone: "  +504 0012-3456  ",
      jobTitle: "  Auxiliar contable  ",
      identityNumber: "  0801-1990-00001  ",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+504 0012-3456",
        jobTitle: "Auxiliar contable",
        identityNumber: "0801-1990-00001",
      })
    );
    expect(createAuth.mock.calls[0][0].user_metadata).toEqual({
      name: createInput.name,
      full_name: createInput.name,
    });
  });

  it("acepta crear usuarios sin los nuevos datos", async () => {
    const { upsert } = mockStorage();
    await expect(caller().createDirect(createInput)).resolves.toEqual({
      success: true,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ openId: target.openId })
    );
  });

  it("actualiza los tres campos preservando su formato de texto", async () => {
    const { update, updateAuth } = mockStorage();
    await caller().updateUserAdmin({
      ...updateInput,
      phone: " 0012345678 ",
      jobTitle: " Supervisor ",
      identityNumber: " 0000123456789 ",
    });
    expect(update).toHaveBeenCalledWith(
      target.id,
      expect.objectContaining({
        phone: "0012345678",
        jobTitle: "Supervisor",
        identityNumber: "0000123456789",
      })
    );
    expect(updateAuth.mock.calls[0][1].user_metadata).toEqual({
      name: target.name,
      full_name: target.name,
    });
  });

  it("omite los campos ausentes al editar para conservar los valores guardados", async () => {
    const { update } = mockStorage();
    await caller().updateUserAdmin(updateInput);
    const values = update.mock.calls[0][1];
    expect(values).not.toHaveProperty("phone");
    expect(values).not.toHaveProperty("jobTitle");
    expect(values).not.toHaveProperty("identityNumber");
  });

  it("permite quitar los datos opcionales explícitamente", async () => {
    const { update } = mockStorage();
    await caller().updateUserAdmin({
      ...updateInput,
      phone: "   ",
      jobTitle: null,
      identityNumber: "",
    });
    expect(update).toHaveBeenCalledWith(
      target.id,
      expect.objectContaining({
        phone: null,
        jobTitle: null,
        identityNumber: null,
      })
    );
  });

  it.each([
    ["phone", 51],
    ["jobTitle", 151],
    ["identityNumber", 51],
  ] as const)(
    "rechaza %s demasiado largo antes de escribir",
    async (field, length) => {
      const { update, updateAuth, createAuth } = mockStorage();
      await expect(
        caller().updateUserAdmin({
          ...updateInput,
          [field]: "a".repeat(length),
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller().createDirect({ ...createInput, [field]: "a".repeat(length) })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(update).not.toHaveBeenCalled();
      expect(updateAuth).not.toHaveBeenCalled();
      expect(createAuth).not.toHaveBeenCalled();
    }
  );

  it("no permite que un rol operativo edite datos personales ajenos", async () => {
    const { update, updateAuth } = mockStorage();
    await expect(
      caller({
        role: "user",
        buildreqRole: "bodeguero_proyecto",
      }).updateUserAdmin({
        ...updateInput,
        identityNumber: "0000123456789",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it("solo devuelve datos personales a quienes pueden gestionar usuarios", async () => {
    const list = vi.spyOn(db, "listUsers").mockResolvedValue([target] as any);
    await expect(caller().list()).resolves.toEqual([target]);
    list.mockClear();
    await expect(
      caller({ role: "user", buildreqRole: "contable" }).list()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(list).not.toHaveBeenCalled();
  });
});
