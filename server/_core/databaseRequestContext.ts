import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

type QueryAggregate = {
  calls: number;
  rows: number;
  durationMs: number;
};

type DatabaseRequestStore = {
  endpoint: string;
  startedAtMs: number;
  userId: number | null;
  queryCount: number;
  rowCount: number;
  sqlDurationMs: number;
  queryAggregates: Map<string, QueryAggregate>;
  cache: Map<string, Promise<unknown>>;
};

const requestStorage = new AsyncLocalStorage<DatabaseRequestStore>();

function isObservabilityEnabled() {
  return process.env.DATABASE_QUERY_OBSERVABILITY_ENABLED === "true";
}

function getWarningThreshold() {
  const configured = Number.parseInt(
    process.env.DATABASE_QUERY_WARN_THRESHOLD ?? "",
    10
  );
  return Number.isInteger(configured) && configured > 0 ? configured : 25;
}

function getEndpoint(req: Request) {
  const path = req.originalUrl.split("?", 1)[0] ?? req.path;
  return path.replace(/^\/api\/trpc\/?/, "") || "unknown";
}

function fingerprintQuery(queryText: string | undefined) {
  if (!queryText) return "unknown";
  const normalized = queryText.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function flushRequestMetrics(store: DatabaseRequestStore, statusCode: number) {
  if (!isObservabilityEnabled()) return;

  const repeatedFingerprints = Array.from(store.queryAggregates.entries())
    .filter(([, aggregate]) => aggregate.calls > 1)
    .sort((left, right) => right[1].durationMs - left[1].durationMs)
    .slice(0, 10)
    .map(([fingerprint, aggregate]) => ({
      fingerprint,
      calls: aggregate.calls,
      rows: aggregate.rows,
      durationMs: Number(aggregate.durationMs.toFixed(2)),
    }));
  const payload = {
    event: "database_request_summary",
    endpoint: store.endpoint,
    userId: store.userId,
    statusCode,
    queries: store.queryCount,
    rows: store.rowCount,
    sqlDurationMs: Number(store.sqlDurationMs.toFixed(2)),
    requestDurationMs: Number(
      (performance.now() - store.startedAtMs).toFixed(2)
    ),
    repeatedFingerprints,
  };

  const serialized = JSON.stringify(payload);
  if (store.queryCount > getWarningThreshold()) {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

function createDatabaseRequestStore(endpoint: string): DatabaseRequestStore {
  return {
    endpoint,
    startedAtMs: performance.now(),
    userId: null,
    queryCount: 0,
    rowCount: 0,
    sqlDurationMs: 0,
    queryAggregates: new Map(),
    cache: new Map(),
  };
}

export function databaseRequestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const store = createDatabaseRequestStore(getEndpoint(req));

  requestStorage.run(store, () => {
    let flushed = false;
    const flush = () => {
      if (flushed) return;
      flushed = true;
      flushRequestMetrics(store, res.statusCode);
    };
    res.once("finish", flush);
    res.once("close", flush);
    next();
  });
}

export async function runWithDatabaseRequestContext<T>(
  endpoint: string,
  callback: () => Promise<T>
) {
  const store = createDatabaseRequestStore(endpoint);
  return requestStorage.run(store, async () => {
    const result = await callback();
    return {
      result,
      metrics: {
        queryCount: store.queryCount,
        rowCount: store.rowCount,
        sqlDurationMs: store.sqlDurationMs,
      },
    };
  });
}

export function setDatabaseRequestUserId(userId: number) {
  const store = requestStorage.getStore();
  if (store) store.userId = userId;
}

export function recordDatabaseQuery(params: {
  queryText?: string;
  durationMs: number;
  rows: number;
}) {
  const store = requestStorage.getStore();
  if (!store) return;

  const fingerprint = fingerprintQuery(params.queryText);
  const aggregate = store.queryAggregates.get(fingerprint) ?? {
    calls: 0,
    rows: 0,
    durationMs: 0,
  };
  aggregate.calls += 1;
  aggregate.rows += params.rows;
  aggregate.durationMs += params.durationMs;
  store.queryAggregates.set(fingerprint, aggregate);
  store.queryCount += 1;
  store.rowCount += params.rows;
  store.sqlDurationMs += params.durationMs;
}

export function getDatabaseRequestMetrics() {
  const store = requestStorage.getStore();
  if (!store) return null;
  return {
    endpoint: store.endpoint,
    userId: store.userId,
    queryCount: store.queryCount,
    rowCount: store.rowCount,
    sqlDurationMs: store.sqlDurationMs,
  };
}

export function memoizeDatabaseRequest<T>(
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  const store = requestStorage.getStore();
  if (!store) return loader();

  const existing = store.cache.get(key);
  if (existing) return existing as Promise<T>;

  const pending = loader().catch(error => {
    store.cache.delete(key);
    throw error;
  });
  store.cache.set(key, pending);
  return pending;
}

export function invalidateDatabaseRequestCache(prefix?: string) {
  const store = requestStorage.getStore();
  if (!store) return;
  if (!prefix) {
    store.cache.clear();
    return;
  }
  for (const key of Array.from(store.cache.keys())) {
    if (key.startsWith(prefix)) store.cache.delete(key);
  }
}
