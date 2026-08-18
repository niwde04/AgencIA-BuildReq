import { describe, expect, it, vi } from "vitest";
import {
  invalidateDatabaseRequestCache,
  memoizeDatabaseRequest,
  recordDatabaseQuery,
  runWithDatabaseRequestContext,
} from "./_core/databaseRequestContext";

describe("database request context", () => {
  it("counts queries and rows without retaining SQL", async () => {
    const checked = await runWithDatabaseRequestContext(
      "test.metrics",
      async () => {
        recordDatabaseQuery({
          queryText: "select * from users where id = $1",
          durationMs: 4,
          rows: 1,
        });
        recordDatabaseQuery({
          queryText: "select * from users where id = $1",
          durationMs: 6,
          rows: 2,
        });
        return "ok";
      }
    );

    expect(checked.result).toBe("ok");
    expect(checked.metrics).toMatchObject({
      queryCount: 2,
      rowCount: 3,
      sqlDurationMs: 10,
    });
    expect(JSON.stringify(checked.metrics)).not.toContain("select *");
  });

  it("uses single-flight and supports invalidation after writes", async () => {
    await runWithDatabaseRequestContext("test.cache", async () => {
      const loader = vi.fn(async () => ({ id: 7 }));
      const [first, second] = await Promise.all([
        memoizeDatabaseRequest("project:7", loader),
        memoizeDatabaseRequest("project:7", loader),
      ]);

      expect(first).toBe(second);
      expect(loader).toHaveBeenCalledTimes(1);

      invalidateDatabaseRequestCache("project:7");
      await memoizeDatabaseRequest("project:7", loader);
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });
});
