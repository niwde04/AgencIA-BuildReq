import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { userManagementRouter } from "./routers/userManagement";
import * as db from "./db";
import * as supabaseAdmin from "./_core/supabaseAdmin";
import {
  authenticateSupabasePayload,
  type SupabaseJwtPayload,
} from "./_core/supabaseAuth";
import { INACTIVE_USER_ERR_MSG } from "@shared/const";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const now = new Date("2026-08-28T12:00:00.000Z");

function createUser(
  overrides: Partial<AuthenticatedUser> = {}
): AuthenticatedUser {
  return {
    id: 1,
    openId: "admin-user",
    email: "admin@buildreq.com",
    name: "Administrador",
    loginMethod: "email",
    role: "admin",
    buildreqRole: "administracion_central",
    assignedProjectId: null,
    isActive: true,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    ...overrides,
  };
}

function createContext(user = createUser()): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const payload: SupabaseJwtPayload = {
  sub: "managed-user",
  email: "usuario@buildreq.com",
  aud: "authenticated",
  role: "authenticated",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("estado activo de usuarios", () => {
  it.each([
    { current: true, next: false, banDuration: "876000h" },
    { current: false, next: true, banDuration: "none" },
  ])(
    "sincroniza el estado $next con Supabase Auth y la base de datos",
    async ({ current, next, banDuration }) => {
      const target = createUser({
        id: 2,
        openId: "managed-user",
        role: "user",
        buildreqRole: "contable",
        isActive: current,
      });
      vi.spyOn(db, "getUserById").mockResolvedValue(target);
      const updateDb = vi
        .spyOn(db, "updateUserAdmin")
        .mockResolvedValue({ success: true });
      const updateUserById = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabaseAdmin, "getSupabaseAdminClient").mockReturnValue({
        auth: { admin: { updateUserById } },
      } as any);

      const caller = userManagementRouter.createCaller(createContext());
      await expect(
        caller.updateUserAdmin({
          userId: target.id,
          name: target.name ?? "Usuario",
          email: target.email ?? "usuario@buildreq.com",
          buildreqRole: "contable",
          assignedProjectIds: [],
          isActive: next,
        })
      ).resolves.toEqual({ success: true });

      expect(updateUserById).toHaveBeenCalledWith(
        target.openId,
        expect.objectContaining({ ban_duration: banDuration })
      );
      expect(updateDb).toHaveBeenCalledWith(
        target.id,
        expect.objectContaining({ isActive: next })
      );
    }
  );

  it("impide que un administrador desactive su propia cuenta", async () => {
    const admin = createUser();
    vi.spyOn(db, "getUserById").mockResolvedValue(admin);
    const updateDb = vi.spyOn(db, "updateUserAdmin");
    const updateUserById = vi.fn();
    vi.spyOn(supabaseAdmin, "getSupabaseAdminClient").mockReturnValue({
      auth: { admin: { updateUserById } },
    } as any);

    const caller = userManagementRouter.createCaller(createContext(admin));
    await expect(
      caller.updateUserAdmin({
        userId: admin.id,
        name: admin.name ?? "Administrador",
        email: admin.email ?? "admin@buildreq.com",
        buildreqRole: "administracion_central",
        assignedProjectIds: [],
        isActive: false,
      })
    ).rejects.toThrow("No puede desactivar su propio usuario.");

    expect(updateUserById).not.toHaveBeenCalled();
    expect(updateDb).not.toHaveBeenCalled();
  });

  it("rechaza en el backend cualquier sesión de un usuario inactivo", async () => {
    const inactiveUser = createUser({
      id: 2,
      openId: payload.sub,
      role: "user",
      buildreqRole: "contable",
      isActive: false,
    });
    vi.spyOn(db, "getUserByOpenId").mockResolvedValue(inactiveUser);
    const touchLastSignedIn = vi.spyOn(db, "touchUserLastSignedIn");

    await expect(authenticateSupabasePayload(payload)).rejects.toThrow(
      INACTIVE_USER_ERR_MSG
    );
    expect(touchLastSignedIn).not.toHaveBeenCalled();
  });
});
