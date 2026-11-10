import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  INVENTORY_UNIT_REGULARIZATION,
  applyInventoryUnitRegularization,
  classifyInventoryUnitSnapshot,
  createInventoryUnitPlan,
  inventoryUnitScope,
  requireInventoryUnitCloudTarget,
  type InventoryUnitSnapshot,
} from "./inventoryUnitRegularization";
import {
  durableInventoryUnitWrite,
  inventoryUnitSafeDiagnostic,
  parseInventoryUnitArgs,
} from "../scripts/regularize-inventory-unit";

function snapshot(): InventoryUnitSnapshot {
  const specs = [
    [
      21331,
      "GALON",
      0,
      14,
      19,
      "001 - HEH LA BARCA",
      "PISO BODEGA 1",
      "2026-10-21T11:52:29.896",
    ],
    [
      21332,
      "GALON",
      0,
      22,
      23,
      "018 - EL ZAMORANO",
      "2C1",
      "2026-10-02T21:36:45.096",
    ],
    [
      21333,
      "GALON",
      0,
      24,
      24,
      "20 - HEH SAN FRANCISCO DE BECERRA",
      null,
      "2026-08-31T17:12:46.963",
    ],
    [28801, "gal", 2],
    [
      30645,
      "und",
      1,
      20,
      31,
      "023 - HEH OJO DE AGUA",
      null,
      "2026-08-31T17:12:31.694174",
    ],
    [31168, "gal", 2],
    [31355, "gal", 3],
    [31956, "gal", 5],
  ];
  const wrap = (row: unknown) => JSON.stringify(row);
  return {
    timeZone: "America/Tegucigalpa",
    catalog: wrap({
      id: 14805,
      itemCode: "010200003",
      description: "ACEITE 2 TIEMPOS",
      unit: "gal",
    }),
    inventory: specs.map(
      ([
        id,
        unit,
        currentStock,
        projectId,
        warehouseId,
        warehouseLocation,
        storageLocation,
        updatedAt,
      ]) =>
        wrap({
          id,
          sapItemCode: "010200003",
          name: "ACEITE 2 TIEMPOS",
          unit,
          currentStock,
          minimumStock: null,
          isActive: true,
          projectId,
          warehouseId,
          warehouseLocation,
          storageLocation,
          updatedAt,
        })
    ),
    documents: {
      requestItems: [
        wrap({
          id: 4166,
          requestId: 1910,
          sapItemCode: "010200003",
          unit: "und",
          quantity: 1,
          status: "completo",
        }),
      ],
      transferRequestItems: [
        wrap({
          id: 234,
          transferRequestId: 63,
          materialRequestItemId: 4166,
          sapItemCode: "010200003",
          unit: "und",
          quantity: 1,
          receivedQuantity: 1,
          sourceProjectId: 24,
          sourceWarehouseId: 24,
          sourceStorageLocation: null,
        }),
      ],
      receiptItems: [
        wrap({
          id: 4687,
          receiptId: 1503,
          sourceItemId: 234,
          warehouseId: 31,
          sapItemCode: "010200003",
          unit: "und",
          quantityExpected: 1,
          quantityReceived: 1,
        }),
      ],
      materialRequests: [
        wrap({ id: 1910, requestNumber: "REQ-020-00000082", projectId: 24 }),
      ],
      transferRequests: [
        wrap({
          id: 63,
          requestNumber: "ST-020-00000004",
          destinationProjectId: 20,
          destinationWarehouseId: 31,
        }),
      ],
      transfers: [
        wrap({
          id: 47,
          transferNumber: "TR-020-00000003",
          transferRequestId: 63,
        }),
      ],
      receipts: [
        wrap({
          id: 1503,
          receiptNumber: "RE-023-00000074",
          sourceType: "transfer",
          sourceId: 47,
          projectId: 20,
        }),
      ],
    },
  };
}
describe("bounded inventory unit regularization", () => {
  it("defaults to the three zero-stock aliases and does not include the unconfirmed und", () => {
    const before = snapshot();
    const image = JSON.stringify(before);
    expect(createInventoryUnitPlan(before)).toMatchObject({
      scope: "aliases",
      targetIds: [21331, 21332, 21333],
      classification: "pending",
    });
    expect(JSON.stringify(before)).toBe(image);
  });
  it("keeps a separate explicit all scope for the confirmed gallon", () => {
    expect(createInventoryUnitPlan(snapshot(), "all").targetIds).toEqual([
      21331, 21332, 21333, 30645,
    ]);
    expect(inventoryUnitScope("all").applyToken).not.toBe(
      inventoryUnitScope("aliases").applyToken
    );
  });
  it.each([
    ["currentStock", 2],
    ["minimumStock", 3],
    ["projectId", 99],
    ["warehouseId", 99],
    ["storageLocation", "OTRO"],
    ["sapItemCode", "OTRO"],
    ["unit", "kg"],
    ["isActive", false],
    ["updatedAt", "2026-11-10T00:00:00Z"],
  ])("rejects changed %s", (field, value) => {
    const before = snapshot();
    const row = JSON.parse(before.inventory[0]);
    row[field] = value;
    before.inventory[0] = JSON.stringify(row);
    expect(() => createInventoryUnitPlan(before)).toThrow();
  });
  it("recognizes staged alias normalization while keeping the und untouched", () => {
    const before = snapshot();
    before.inventory = before.inventory.map(image => {
      const row = JSON.parse(image);
      if ([21331, 21332, 21333].includes(row.id)) {
        row.unit = "gal";
        row.updatedAt = "2026-11-10T00:00:00Z";
      }
      return JSON.stringify(row);
    });
    expect(classifyInventoryUnitSnapshot(before, "aliases")).toBe(
      "already-aligned"
    );
    expect(classifyInventoryUnitSnapshot(before, "all")).toBe("pending");
  });
  it("rejects changed historical chain", () => {
    const before = snapshot();
    const row = JSON.parse(before.documents.receiptItems[0]);
    row.unit = "gal";
    before.documents.receiptItems[0] = JSON.stringify(row);
    expect(() => createInventoryUnitPlan(before)).toThrow(
      /antecedente de recepción/
    );
  });
  it("compares PostgreSQL native timestamps exactly, including the last microsecond", () => {
    const before = snapshot();
    const row = JSON.parse(before.inventory[4]);
    row.updatedAt = "2026-08-31T17:12:31.694175";
    before.inventory[4] = JSON.stringify(row);
    expect(() => createInventoryUnitPlan(before, "all")).toThrow(/fecha/);
  });
  it("requires physical confirmation for all before querying", async () => {
    const query = vi.fn();
    await expect(
      applyInventoryUnitRegularization(
        { query } as any,
        createInventoryUnitPlan(snapshot(), "all"),
        {
          actor: "Operador",
          reason: "Prueba de confirmación física",
          confirmation: inventoryUnitScope("all").applyToken,
          confirmOneUndIsOneGal: false,
          confirmCompatibleReaders: true,
          readerEvidence: "main-verificado",
          beforeApply: async () => {},
          beforeCommit: async () => {},
        }
      )
    ).rejects.toThrow(/físicamente/);
    expect(query).not.toHaveBeenCalled();
  });
  it("requires compatible readers before querying or changing an alias", async () => {
    const query = vi.fn();
    await expect(
      applyInventoryUnitRegularization(
        { query } as any,
        createInventoryUnitPlan(snapshot()),
        {
          actor: "Operador",
          reason: "Prueba de publicación de lector",
          confirmation: inventoryUnitScope("aliases").applyToken,
          confirmOneUndIsOneGal: false,
          confirmCompatibleReaders: false,
          readerEvidence: "",
          beforeApply: async () => {},
          beforeCommit: async () => {},
        }
      )
    ).rejects.toThrow(/lectores/);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("regularization CLI and Cloud destination guards", () => {
  const dir = resolve(".tmp/regularization-backups");
  const cloud =
    "postgresql://postgres.ovaergjxbzrirmdwnwot:test@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
  const api = "https://ovaergjxbzrirmdwnwot.supabase.co";
  it("uses dry-run and aliases by default", () =>
    expect(parseInventoryUnitArgs(["--backup-dir", dir])).toMatchObject({
      mode: "dry-run",
      scope: "aliases",
    }));
  it.each([
    ["--apply"],
    ["--scope", "other"],
    ["--apply", "--restore"],
    ["--backup-dir", dir],
  ])("rejects incomplete, conflicting, or repeated args %j", extra =>
    expect(() =>
      parseInventoryUnitArgs(["--backup-dir", dir, ...extra])
    ).toThrow()
  );
  it("rejects all apply without the factual confirmation", () =>
    expect(() =>
      parseInventoryUnitArgs([
        "--backup-dir",
        dir,
        "--scope",
        "all",
        "--apply",
        "--manifest",
        "plan.json",
        "--manifest-sha256",
        "a".repeat(64),
        "--confirm",
        INVENTORY_UNIT_REGULARIZATION.applyToken,
        "--actor",
        "Operador",
        "--reason",
        "Unidad confirmada por bodega",
        "--confirm-compatible-readers",
        "--reader-evidence",
        "main-verificado",
      ])
    ).toThrow(/física/));
  it("matches the approved Cloud target without exposing credentials", () =>
    expect(
      new URL(requireInventoryUnitCloudTarget(cloud, api)).searchParams.get(
        "sslmode"
      )
    ).toBe("verify-full"));
  it.each(["prefer", "require", "verify-ca", "verify-full"])(
    "keeps strict certificate and hostname validation for %s",
    mode => {
      expect(
        new URL(
          requireInventoryUnitCloudTarget(`${cloud}?sslmode=${mode}`, api)
        ).searchParams.get("sslmode")
      ).toBe("verify-full");
    }
  );
  it.each([
    "?host=other",
    "?user=other",
    "?options=-csearch_path=evil",
    "?sslmode=disable",
    "?sslmode=no-verify",
    "?sslmode=require&sslmode=require",
  ])("rejects connection overrides %s", query =>
    expect(() => requireInventoryUnitCloudTarget(cloud + query, api)).toThrow()
  );
  it("rejects a mismatched API or database project", () => {
    expect(() =>
      requireInventoryUnitCloudTarget(cloud, "https://other.supabase.co")
    ).toThrow();
    expect(() =>
      requireInventoryUnitCloudTarget(
        cloud.replace("ovaergjxbzrirmdwnwot", "other"),
        api
      )
    ).toThrow();
  });
  it("reports a sanitized error code without exposing driver messages or credentials", () => {
    const error = Object.assign(
      new Error(
        "postgresql://user:PRIVATE_PASSWORD@private-host failed with SQL and financial values"
      ),
      { code: "SELF_SIGNED_CERT_IN_CHAIN" }
    );
    const diagnostic = inventoryUnitSafeDiagnostic(error);
    expect(diagnostic.code).toBe("SELF_SIGNED_CERT_IN_CHAIN");
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_PASSWORD");
    expect(JSON.stringify(diagnostic)).not.toContain(
      "SQL and financial values"
    );
    expect(
      inventoryUnitSafeDiagnostic({ code: "unsafe error code with data" }).code
    ).toBeUndefined();
  });
  let temp: string | undefined;
  afterEach(async () => {
    if (temp) {
      await unlink(join(temp, "before.json"));
      await rmdir(temp);
      temp = undefined;
    }
  });
  it("writes and verifies an exclusive durable backup without overwriting it", async () => {
    temp = await mkdtemp(join(tmpdir(), "buildreq-unit-backup-"));
    const artifact = await durableInventoryUnitWrite(temp, "before.json", {
      unit: "und",
      quantity: "1.00",
    });
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.bytes).toBe(
      (await readFile(join(temp, "before.json"))).length
    );
    await expect(
      durableInventoryUnitWrite(temp, "before.json", { unit: "gal" })
    ).rejects.toThrow();
    await expect(
      durableInventoryUnitWrite(temp, "../outside.json", {})
    ).rejects.toThrow();
  });
});
