import { loadTreasuryPaymentCostMatrixEntries } from "./treasuryPaymentCostLevels";
import { createTreasuryPaymentCostLevelResolver } from "../shared/treasury-payment-cost-levels";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { costMatrixRouter } from "./routers/costMatrix";
import { getDb } from "./db";
import { importCostMatrix } from "../scripts/cost-matrix-import";
import { deriveCostMatrix, costMatrixFields } from "../shared/cost-matrix";
import seed from "../data/cost-matrix/initial.json";

const url = process.env.COST_MATRIX_TEST_DATABASE_URL;
const enabled =
  !!url &&
  /^\/buildreq_matrix_test_[a-f0-9]{16}$/.test(new URL(url).pathname) &&
  ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const suite = enabled ? describe : describe.skip;
suite("Matriz: PostgreSQL aislado y router real", () => {
  const client = new Client({ connectionString: url });
  const caller = (
    user: any = { id: 1, role: "admin", buildreqRole: "administracion_central" }
  ) => costMatrixRouter.createCaller({ user } as any);
  const api = caller();
  const base = costMatrixFields.parse(seed[0]);
  beforeAll(async () => {
    await client.connect();
  });
  beforeEach(async () => {
    await client.query('TRUNCATE TABLE "costMatrixEntries" RESTART IDENTITY');
  });
  afterAll(async () => {
    await client.end();
    const db = await getDb();
    await db?.$client.end();
  });
  it("simula sin escribir y aplica exactamente 539 una sola vez, incluso en paralelo", async () => {
    expect(await importCostMatrix(client, seed)).toMatchObject({
      inserted: 539,
      skipped: 0,
    });
    expect((await api.list({})).total).toBe(0);
    const second = new Client({ connectionString: url });
    await second.connect();
    try {
      const runs = await Promise.all([
        importCostMatrix(client, seed, true),
        importCostMatrix(second, seed, true),
      ]);
      expect(runs.map(v => v.inserted).sort((a, b) => a - b)).toEqual([0, 539]);
    } finally {
      await second.end();
    }
    expect(await importCostMatrix(client, seed, true)).toMatchObject({
      inserted: 0,
      skipped: 539,
    });
    expect((await api.list({ jobCode: "001" })).total).toBe(331);
    expect((await api.list({ jobCode: "999" })).total).toBe(208);
  });
  it("crea, consulta, edita códigos con ID estable y recalcula etiquetas con auditoría", async () => {
    const entry = await api.create(base);
    expect(entry.matrixCode).toBe(deriveCostMatrix(base).matrixCode);
    expect(entry.createdById).toBe(1);
    const saved = await caller({
      id: 2,
      role: "user",
      buildreqRole: "administracion_central",
    }).update({
      id: entry.id,
      data: { ...base, n2: "0999", nivel2: "Descripción nueva" },
    });
    expect(saved.id).toBe(entry.id);
    expect(saved.flow3).toBe("0999 Descripción nueva");
    expect(saved.updatedById).toBe(2);
    expect(saved.createdById).toBe(1);
    expect((await api.getById({ id: entry.id })).matrixCode).toBe(
      saved.matrixCode
    );
  });
  it("rechaza colisiones en creación y edición sin modificar el registro", async () => {
    const a = await api.create(base);
    await expect(api.create(base)).rejects.toMatchObject({ code: "CONFLICT" });
    const b = await api.create({ ...base, n4: "EXTRA" });
    await expect(api.update({ id: b.id, data: base })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await api.getById({ id: b.id })).n4).toBe("EXTRA");
    expect((await api.list({})).total).toBe(2);
    expect(a.isActive).toBe(true);
  });
  it("desactiva, reactiva y preserva ediciones y desactivaciones al repetir la carga", async () => {
    await importCostMatrix(client, seed, true);
    const row = (await api.list({})).items[0];
    await api.update({
      id: row.id,
      data: { ...base, n4: "EDITADO", nivel4: "Usuario cambió" },
    });
    await api.setActive({ id: row.id, isActive: false });
    expect(await importCostMatrix(client, seed, true)).toMatchObject({
      inserted: 0,
      skipped: 539,
    });
    const saved = await api.getById({ id: row.id });
    expect(saved.isActive).toBe(false);
    expect(saved.nivel4).toBe("Usuario cambió");
    expect((await api.list({})).total).toBe(539);
    expect((await api.list({ isActive: false })).total).toBe(1);
    expect((await api.setActive({ id: row.id, isActive: true })).isActive).toBe(
      true
    );
  });
  it("busca códigos/descripciones, escapa comodines y pagina con orden estable", async () => {
    await importCostMatrix(client, seed, true);
    const page1 = await api.list({ page: 1, pageSize: 25 });
    const page2 = await api.list({ page: 2, pageSize: 25 });
    expect(page1.items).toHaveLength(25);
    expect(page2.items).toHaveLength(25);
    expect(new Set([...page1.items, ...page2.items].map(r => r.id)).size).toBe(
      50
    );
    expect(page1.items.map(r => r.matrixCode)).toEqual(
      page1.items.map(r => r.matrixCode).sort()
    );
    const found = await api.list({ search: page1.items[0].matrixCode });
    expect(found.total).toBe(1);
    expect(
      (await api.list({ search: page1.items[0].nivel4 })).total
    ).toBeGreaterThan(0);
    expect((await api.list({ search: "%" })).total).toBe(
      seed.filter(row => Object.values(row).some(value => value.includes("%")))
        .length
    );
    expect((await api.list({ page: 999, pageSize: 100 })).page).toBe(6);
    expect((await api.list({ pageSize: 50 })).items).toHaveLength(50);
    expect((await api.list({ pageSize: 100 })).items).toHaveLength(100);
  });
  it("filtra job/nivel/actividad/estado en servidor y entrega opciones", async () => {
    await importCostMatrix(client, seed, true);
    const sample = seed[0];
    const filtered = await api.list({
      jobCode: sample.jobCode,
      n1: sample.n1,
      flowActivity: sample.flowActivity,
      isActive: true,
      pageSize: 100,
    });
    expect(filtered.total).toBe(
      seed.filter(
        v =>
          v.jobCode === sample.jobCode &&
          v.n1 === sample.n1 &&
          v.flowActivity === sample.flowActivity
      ).length
    );
    expect(
      filtered.items.every(
        r =>
          r.jobCode === sample.jobCode &&
          r.n1 === sample.n1 &&
          r.flowActivity === sample.flowActivity
      )
    ).toBe(true);
    expect((await api.filterOptions()).jobs.map(v => v.code)).toEqual([
      "001",
      "999",
    ]);
    expect((await api.list({ search: "NO_MATCH_XYZ", page: 5 })).page).toBe(1);
  });
  it("aborta la carga completa ante error después de la primera inserción", async () => {
    await client.query(`CREATE FUNCTION reject_matrix_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."flowId" = 'FAIL' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_fixture BEFORE INSERT ON "costMatrixEntries" FOR EACH ROW EXECUTE FUNCTION reject_matrix_fixture();`);
    try {
      await expect(
        importCostMatrix(
          client,
          [seed[0], { ...seed[1], flowId: "FAIL" }],
          true
        )
      ).rejects.toThrow("injected failure");
      expect((await api.list({})).total).toBe(0);
    } finally {
      await client.query(
        'DROP TRIGGER reject_fixture ON "costMatrixEntries"; DROP FUNCTION reject_matrix_fixture()'
      );
    }
  });
  it("rechaza duplicados contradictorios antes de escribir y conserva ceros", async () => {
    await expect(
      importCostMatrix(
        client,
        [seed[0], { ...seed[0], nivel4: "Contradicción" }],
        true
      )
    ).rejects.toThrow("contradictorios");
    expect((await api.list({})).total).toBe(0);
    await importCostMatrix(client, [seed[0]], true);
    expect((await api.list({})).items[0].jobCode).toBe("001");
  });
  it.each([
    "contable",
    "financiero",
    "ingeniero_residente",
    "gerente",
    "superintendente_aprobador",
  ])("rechaza todas las operaciones a %s", async role => {
    const denied = caller({
      id: 2,
      role: ["gerente", "superintendente_aprobador"].includes(role)
        ? "admin"
        : "user",
      buildreqRole: role,
    });
    for (const call of [
      () => denied.list({}),
      () => denied.getById({ id: 1 }),
      () => denied.filterOptions(),
      () => denied.create(base),
      () => denied.update({ id: 1, data: base }),
      () => denied.setActive({ id: 1, isActive: false }),
    ])
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rechaza anónimos y cambios a registros inexistentes", async () => {
    await expect(caller(null).list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(api.getById({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(api.update({ id: 999, data: base })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      api.setActive({ id: 999, isActive: false })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("devuelve un error seguro sin exponer SQL cuando la base falla", async () => {
    await client.query(
      'ALTER TABLE "costMatrixEntries" RENAME TO "costMatrixEntries_fault_fixture"'
    );
    try {
      await expect(
        api.list({ search: "PRIVATE_TEST_VALUE" })
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "No se pudo completar la operación de matriz de costos. Intente nuevamente.",
      });
      await expect(
        loadTreasuryPaymentCostMatrixEntries(["02020201"])
      ).rejects.toThrow(
        "No se pudieron consultar los niveles de la matriz de costos. Intente nuevamente."
      );
    } finally {
      await client.query(
        'ALTER TABLE "costMatrixEntries_fault_fixture" RENAME TO "costMatrixEntries"'
      );
    }
  });
  it("consulta en lote solo los niveles requeridos por Payments y resuelve códigos repetidos", async () => {
    await importCostMatrix(client, seed, true);
    const candidates = await loadTreasuryPaymentCostMatrixEntries([
      "02020201",
      "11060101",
      "02020201",
      " ",
    ]);
    expect(candidates).toHaveLength(3);
    expect(
      candidates.every(row => ["02020201", "11060101"].includes(row.n4))
    ).toBe(true);
    expect(Object.keys(candidates[0]).sort()).toEqual(
      ["n1", "n2", "n3", "n4", "nivel1", "nivel2", "nivel3", "nivel4"].sort()
    );
    const resolve = createTreasuryPaymentCostLevelResolver(candidates);
    expect(resolve("11060101", "0106").level4).toBe(
      "11060101 · Gastos de asesoría legal"
    );
    expect(resolve("11060101", "1106").level4).toBe(
      "11060101 · Inventario de materiales asfálticos"
    );
  });
  it("Payments consulta la matriz vigente y refleja edición, desactivación y reactivación", async () => {
    const source = seed.find(row => row.n4 === "02020201")!;
    const entry = await api.create(costMatrixFields.parse(source));
    await api.update({
      id: entry.id,
      data: {
        ...costMatrixFields.parse(source),
        nivel4: "Descripción actualizada",
      },
    });
    expect(
      (await loadTreasuryPaymentCostMatrixEntries(["02020201"]))[0].nivel4
    ).toBe("Descripción actualizada");
    await api.setActive({ id: entry.id, isActive: false });
    expect(await loadTreasuryPaymentCostMatrixEntries(["02020201"])).toEqual(
      []
    );
    await api.setActive({ id: entry.id, isActive: true });
    expect(
      await loadTreasuryPaymentCostMatrixEntries(["02020201"])
    ).toHaveLength(1);
    expect(await loadTreasuryPaymentCostMatrixEntries([])).toEqual([]);
  });
  it("mantiene RLS y niega acceso directo a roles del navegador sin modificar tablas operativas", async () => {
    expect(
      (
        await client.query(
          `SELECT relrowsecurity FROM pg_class WHERE oid = 'public."costMatrixEntries"'::regclass`
        )
      ).rows[0].relrowsecurity
    ).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      expect(
        (
          await client.query(
            `SELECT has_table_privilege($1, 'public."costMatrixEntries"', 'SELECT,INSERT,UPDATE,DELETE') allowed`,
            [role]
          )
        ).rows[0].allowed
      ).toBe(false);
      expect(
        (
          await client.query(
            `SELECT has_sequence_privilege($1, 'public."costMatrixEntries_id_seq"', 'USAGE') allowed`,
            [role]
          )
        ).rows[0].allowed
      ).toBe(false);
    }
    expect(
      (await client.query("SELECT * FROM operational_sentinel")).rows
    ).toEqual([{ id: 1, amount: "123.45" }]);
    expect(
      (await client.query("SELECT id FROM users ORDER BY id")).rows
    ).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
