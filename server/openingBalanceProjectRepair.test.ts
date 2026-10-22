import { describe, expect, it, vi } from "vitest";
import {
  OPENING_PROJECT_REPAIR,
  repairOpeningBalanceProject,
  requireOpeningRepairCloudTarget,
  type OpeningProjectRepairSnapshot,
} from "./openingBalanceProjectRepair";

function fixture(): OpeningProjectRepairSnapshot {
  return {
    header: {
      id: 4,
      balanceNumber: "SI-024-00000001",
      projectId: 26,
      warehouseId: 23,
      createdById: 156,
      openingDate: "2026-10-22T00:00:00",
      notes: "Conteo físico original",
      createdAt: "2026-10-23T01:55:53.257123",
      updatedAt: "2026-10-23T02:35:04.255456",
    },
    warehouse: {
      id: 23,
      code: "018",
      isActive: true,
      displayName: "018 - EL ZAMORANO",
    },
    projects: [
      { id: 22, code: "018", status: "activo", belongsToWarehouse: true },
      { id: 26, code: "024", status: "activo", belongsToWarehouse: true },
    ],
    items: [
      {
        id: 7,
        openingBalanceId: 4,
        projectId: 22,
        sapItemCode: "090200032",
        quantity: "1.00",
        storageLocation: "2C1",
        notes: null,
      },
      {
        id: 32,
        openingBalanceId: 4,
        projectId: 22,
        sapItemCode: "090200511",
        quantity: "2.00",
        storageLocation: "2C5",
        notes: "agregado después",
      },
    ],
    inventory: [
      {
        id: 1,
        warehouseId: 23,
        projectId: 22,
        currentStock: "1.00",
        storageLocation: "2C1",
      },
      {
        id: 2,
        warehouseId: 23,
        projectId: 26,
        currentStock: "9.00",
        storageLocation: null,
      },
    ],
  };
}
function fakeClient(
  initial = fixture(),
  options: {
    rowCount?: number;
    afterWrite?: (state: OpeningProjectRepairSnapshot) => void;
  } = {}
) {
  let state = structuredClone(initial);
  let checkpoint = structuredClone(state);
  const events: string[] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    events.push(text);
    if (text.startsWith("BEGIN")) checkpoint = structuredClone(state);
    if (text === "ROLLBACK") state = structuredClone(checkpoint);
    if (text.startsWith("UPDATE")) {
      expect(values).toEqual([22, 4, 23, 26, "SI-024-00000001"]);
      if (options.rowCount === 0) return { rows: [], rowCount: 0 };
      state.header.projectId = 22;
      state.header.updatedAt = "2026-10-23T03:00:00.123456";
      options.afterWrite?.(state);
      return { rows: [{ id: 4 }], rowCount: 1 };
    }
    if (text.startsWith("SELECT to_jsonb(b)"))
      return { rows: [{ row: structuredClone(state.header) }], rowCount: 1 };
    if (text.startsWith("SELECT to_jsonb(w)"))
      return { rows: [{ row: structuredClone(state.warehouse) }], rowCount: 1 };
    if (text.startsWith("SELECT p.id,p.code"))
      return {
        rows: structuredClone(state.projects),
        rowCount: state.projects.length,
      };
    if (
      text.startsWith("SELECT to_jsonb(i)") &&
      text.includes('"openingBalanceItems"')
    )
      return {
        rows: state.items.map(row => ({ row: structuredClone(row) })),
        rowCount: state.items.length,
      };
    if (text.startsWith("SELECT to_jsonb(i)"))
      return {
        rows: state.inventory.map(row => ({ row: structuredClone(row) })),
        rowCount: state.inventory.length,
      };
    return { rows: [], rowCount: 0 };
  });
  return {
    client: { query } as unknown as Parameters<
      typeof repairOpeningBalanceProject
    >[0],
    query,
    events,
    state: () => state,
    backup: vi.fn(async () => {
      events.push("BACKUP_FSYNC");
    }),
    audit: vi.fn(async () => {
      events.push("AUDIT_FSYNC");
    }),
  };
}
function apply(fake: ReturnType<typeof fakeClient>) {
  return repairOpeningBalanceProject(fake.client, {
    apply: true,
    beforeApply: fake.backup,
    beforeCommit: fake.audit,
  });
}

describe("single opening balance project repair", () => {
  it("inspects by default caller mode without writes, row locks, or a guessed header", async () => {
    const fake = fakeClient();
    const result = await repairOpeningBalanceProject(fake.client, {
      apply: false,
    });
    expect(result).toMatchObject({
      apply: false,
      changed: false,
      alreadyApplied: false,
    });
    expect(result.before).toEqual(fixture());
    expect(result.after).toEqual(result.before);
    expect(fake.events[0]).toContain("READ ONLY");
    expect(fake.events.some(sql => /UPDATE|FOR SHARE/.test(sql))).toBe(false);
    expect(fake.events.at(-1)).toBe("COMMIT");
  });
  it("changes only the header project and update time after durable backup, preserving precision and references", async () => {
    const fake = fakeClient();
    const result = await apply(fake);
    expect(result.changed).toBe(true);
    expect(result.after.header).toEqual({
      ...result.before.header,
      projectId: 22,
      updatedAt: "2026-10-23T03:00:00.123456",
    });
    expect(result.after.items).toEqual(result.before.items);
    expect(result.after.inventory).toEqual(result.before.inventory);
    expect(result.after.header.balanceNumber).toBe(
      OPENING_PROJECT_REPAIR.balanceNumber
    );
    expect(result.fingerprints.beforeItems).toBe(
      result.fingerprints.afterItems
    );
    expect(result.fingerprints.beforeInventory).toBe(
      result.fingerprints.afterInventory
    );
    const update = fake.events.findIndex(sql => sql.startsWith("UPDATE"));
    expect(fake.events.indexOf("BACKUP_FSYNC")).toBeLessThan(update);
    expect(fake.events.indexOf("AUDIT_FSYNC")).toBeGreaterThan(update);
    expect(fake.events.indexOf("AUDIT_FSYNC")).toBeLessThan(
      fake.events.indexOf("COMMIT")
    );
    const locks = fake.events.filter(sql => sql.endsWith("FOR UPDATE"));
    expect(locks[0]).toContain("public.warehouses");
    expect(locks[1]).toContain('public."openingBalances"');
    expect(fake.backup).toHaveBeenCalledWith(result.before);
  });
  it("requires durable backup and audit callbacks before starting an apply transaction", async () => {
    const fake = fakeClient();
    await expect(
      repairOpeningBalanceProject(fake.client, { apply: true })
    ).rejects.toThrow("respaldo durable");
    await expect(
      repairOpeningBalanceProject(fake.client, {
        apply: true,
        beforeApply: fake.backup,
      })
    ).rejects.toThrow("manifiesto durable");
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("rolls back without writing when durable backup fails", async () => {
    const fake = fakeClient();
    fake.backup.mockRejectedValueOnce(new Error("disk full"));
    await expect(apply(fake)).rejects.toThrow("disk full");
    expect(fake.events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
    expect(fake.events.at(-1)).toBe("ROLLBACK");
    expect(fake.state()).toEqual(fixture());
  });
  it("rolls back the header when persisting the before/after audit fails", async () => {
    const fake = fakeClient();
    fake.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(apply(fake)).rejects.toThrow("audit unavailable");
    expect(fake.events.at(-1)).toBe("ROLLBACK");
    expect(fake.state()).toEqual(fixture());
  });
  it("does not reapply or alter the update timestamp on an already-corrected header", async () => {
    const before = fixture();
    before.header.projectId = 22;
    const fake = fakeClient(before);
    const result = await apply(fake);
    expect(result).toMatchObject({ changed: false, alreadyApplied: true });
    expect(result.before).toEqual(before);
    expect(result.after).toEqual(before);
    expect(fake.events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
    expect(fake.backup).toHaveBeenCalledOnce();
    expect(fake.audit).toHaveBeenCalledOnce();
  });
  it("rolls back when the guarded update no longer matches", async () => {
    const fake = fakeClient(fixture(), { rowCount: 0 });
    await expect(apply(fake)).rejects.toThrow("cambió durante");
    expect(fake.events.at(-1)).toBe("ROLLBACK");
  });
  it.each([
    [
      "a different folio",
      (before: OpeningProjectRepairSnapshot) => {
        before.header.balanceNumber = "SI-024-00000002";
      },
    ],
    [
      "a different warehouse",
      (before: OpeningProjectRepairSnapshot) => {
        before.header.warehouseId = 99;
      },
    ],
    [
      "a different project",
      (before: OpeningProjectRepairSnapshot) => {
        before.header.projectId = 99;
      },
    ],
    [
      "an inactive warehouse",
      (before: OpeningProjectRepairSnapshot) => {
        before.warehouse.isActive = false;
      },
    ],
    [
      "an inactive project",
      (before: OpeningProjectRepairSnapshot) => {
        before.projects[0].status = "inactivo";
      },
    ],
    [
      "a missing assignment",
      (before: OpeningProjectRepairSnapshot) => {
        before.projects[1].belongsToWarehouse = false;
      },
    ],
    [
      "a different project code",
      (before: OpeningProjectRepairSnapshot) => {
        before.projects[0].code = "999";
      },
    ],
    [
      "mixed project lines",
      (before: OpeningProjectRepairSnapshot) => {
        before.items[1].projectId = 26;
      },
    ],
    [
      "legacy null project lines",
      (before: OpeningProjectRepairSnapshot) => {
        before.items[0].projectId = null;
      },
    ],
    [
      "an empty document",
      (before: OpeningProjectRepairSnapshot) => {
        before.items = [];
      },
    ],
  ])("rejects %s before backup or modification", async (_name, mutate) => {
    const before = fixture();
    mutate(before);
    const fake = fakeClient(before);
    await expect(apply(fake)).rejects.toThrow("Saldo inicial:");
    expect(fake.backup).not.toHaveBeenCalled();
    expect(fake.events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
    expect(fake.events.at(-1)).toBe("ROLLBACK");
  });
  it.each([
    [
      "folio",
      (state: OpeningProjectRepairSnapshot) => {
        state.header.balanceNumber = "SI-018-00000001";
      },
    ],
    [
      "opening date",
      (state: OpeningProjectRepairSnapshot) => {
        state.header.openingDate = "2026-10-23";
      },
    ],
    [
      "notes",
      (state: OpeningProjectRepairSnapshot) => {
        state.header.notes = "changed";
      },
    ],
    [
      "line quantity",
      (state: OpeningProjectRepairSnapshot) => {
        state.items[0].quantity = "2.00";
      },
    ],
    [
      "inventory stock",
      (state: OpeningProjectRepairSnapshot) => {
        state.inventory[1].currentStock = "8.00";
      },
    ],
  ])(
    "rolls back unexpected %s changes from triggers or other side effects",
    async (_name, mutate) => {
      const fake = fakeClient(fixture(), { afterWrite: mutate });
      await expect(apply(fake)).rejects.toThrow("Saldo inicial:");
      expect(fake.audit).not.toHaveBeenCalled();
      expect(fake.events.at(-1)).toBe("ROLLBACK");
      expect(fake.state()).toEqual(fixture());
    }
  );
  it("does not allow callbacks to mutate the before-image being verified", async () => {
    const fake = fakeClient();
    const result = await repairOpeningBalanceProject(fake.client, {
      apply: true,
      beforeApply: async before => {
        before.header.notes = "mutated callback";
        before.inventory = [];
      },
      beforeCommit: async result => {
        result.after.items = [];
      },
    });
    expect(result.before.header.notes).toBe("Conteo físico original");
    expect(result.after.inventory).toEqual(fixture().inventory);
    expect(result.after.items).toEqual(fixture().items);
  });
});

describe("opening repair Cloud connection guard", () => {
  const ref = "ovaergjxbzrirmdwnwot";
  const api = `https://${ref}.supabase.co`;
  const direct = `postgresql://postgres:test-password@db.${ref}.supabase.co:5432/postgres`;
  const pooler = `postgresql://postgres.${ref}:test-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
  it.each([direct, pooler])(
    "accepts the exact authorized target and adds required TLS",
    connection => {
      const validated = new URL(
        requireOpeningRepairCloudTarget(connection, api)
      );
      expect(validated.searchParams.get("sslmode")).toBe("require");
    }
  );
  it("preserves explicit permitted options without exposing or changing credentials", () => {
    const validated = new URL(
      requireOpeningRepairCloudTarget(
        `${direct}?sslmode=verify-full&application_name=opening-repair`,
        api
      )
    );
    expect(validated.searchParams.get("sslmode")).toBe("verify-full");
    expect(validated.searchParams.get("application_name")).toBe(
      "opening-repair"
    );
    expect(validated.password).toBe("test-password");
  });
  it.each([
    "host=another.database.example",
    "user=another-user",
    "port=9999",
    "database=another",
    "password=another-secret",
    "options=-c%20search_path%3Devil",
    "sslmode=disable",
    "sslmode=require&sslmode=verify-full",
    "application_name=one&application_name=two",
    "sslmode=require&%68ost=another.database.example",
  ])(
    "rejects connection overrides before the driver sees them: %s",
    parameters => {
      expect(() =>
        requireOpeningRepairCloudTarget(`${direct}?${parameters}`, api)
      ).toThrow();
    }
  );
  it.each([
    [
      `postgresql://postgres:test-password@db.another-project.supabase.co:5432/postgres`,
      api,
    ],
    [
      `postgresql://postgres.another-project:test-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      api,
    ],
    [direct.replace("/postgres", "/another"), api],
    [direct.replace(":5432", ":9999"), api],
    [direct, "https://another-project.supabase.co"],
    [direct, `${api}/unexpected`],
    [direct, `${api}?host=unexpected`],
  ])(
    "rejects unauthorized host, identity, database, port, or API configuration",
    (connection, url) => {
      expect(() => requireOpeningRepairCloudTarget(connection, url)).toThrow(
        "El destino no coincide"
      );
    }
  );
});
