import { nanoid } from "nanoid";
import type { DemoImportProgressSnapshot, DemoImportResult } from "../db";

export type DemoImportJobStage =
  | "queued"
  | "projects"
  | "articles"
  | "inventory"
  | "suppliers"
  | "completed"
  | "failed";

export type DemoImportJobStatus = "queued" | "running" | "completed" | "failed";

export type DemoImportJob = {
  id: string;
  userId: number;
  status: DemoImportJobStatus;
  stage: DemoImportJobStage;
  stageLabel: string;
  totalRows: number;
  processedRows: number;
  percent: number;
  currentStageProcessed: number;
  currentStageTotal: number;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  result?: DemoImportResult;
};

const JOB_TTL_MS = 1000 * 60 * 60;

const jobs = new Map<string, DemoImportJob>();
const activeJobByUserId = new Map<number, string>();
const latestJobByUserId = new Map<number, string>();

function cleanupOldJobs() {
  const now = Date.now();

  for (const [jobId, job] of Array.from(jobs.entries())) {
    const referenceTime = job.finishedAt?.getTime() ?? job.createdAt.getTime();
    if (now - referenceTime <= JOB_TTL_MS) continue;

    jobs.delete(jobId);
    if (activeJobByUserId.get(job.userId) === jobId) {
      activeJobByUserId.delete(job.userId);
    }
    if (latestJobByUserId.get(job.userId) === jobId) {
      latestJobByUserId.delete(job.userId);
    }
  }
}

export function createDemoImportJob(userId: number, totalRows: number) {
  cleanupOldJobs();

  const activeJobId = activeJobByUserId.get(userId);
  const activeJob = activeJobId ? jobs.get(activeJobId) : undefined;

  if (activeJob && (activeJob.status === "queued" || activeJob.status === "running")) {
    throw new Error("Ya hay una carga demo en proceso para este usuario");
  }

  const job: DemoImportJob = {
    id: nanoid(),
    userId,
    status: "queued",
    stage: "queued",
    stageLabel: "Preparando importacion",
    totalRows,
    processedRows: 0,
    percent: 0,
    currentStageProcessed: 0,
    currentStageTotal: totalRows,
    createdAt: new Date(),
  };

  jobs.set(job.id, job);
  activeJobByUserId.set(userId, job.id);
  latestJobByUserId.set(userId, job.id);

  return job;
}

export function updateDemoImportJob(
  jobId: string,
  patch: Partial<DemoImportJob>
) {
  const job = jobs.get(jobId);
  if (!job) return null;

  const nextJob = {
    ...job,
    ...patch,
  };

  jobs.set(jobId, nextJob);
  latestJobByUserId.set(nextJob.userId, nextJob.id);

  return nextJob;
}

export function applyDemoImportProgress(
  jobId: string,
  progress: DemoImportProgressSnapshot
) {
  const job = jobs.get(jobId);
  if (!job) return null;

  const nextStatus: DemoImportJobStatus =
    job.status === "queued" ? "running" : job.status;

  return updateDemoImportJob(jobId, {
    status: nextStatus,
    stage: progress.stage,
    stageLabel: progress.stageLabel,
    processedRows: progress.processedRows,
    totalRows: progress.totalRows,
    percent: progress.percent,
    currentStageProcessed: progress.currentStageProcessed,
    currentStageTotal: progress.currentStageTotal,
    startedAt: job.startedAt ?? new Date(),
  });
}

export function completeDemoImportJob(jobId: string, result: DemoImportResult) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (activeJobByUserId.get(job.userId) === jobId) {
    activeJobByUserId.delete(job.userId);
  }

  return updateDemoImportJob(jobId, {
    status: "completed",
    stage: "completed",
    stageLabel: "Importacion completada",
    processedRows: job.totalRows,
    currentStageProcessed: job.currentStageTotal,
    percent: 100,
    finishedAt: new Date(),
    result,
    error: undefined,
  });
}

export function failDemoImportJob(jobId: string, error: string) {
  const job = jobs.get(jobId);
  if (!job) return null;

  if (activeJobByUserId.get(job.userId) === jobId) {
    activeJobByUserId.delete(job.userId);
  }

  return updateDemoImportJob(jobId, {
    status: "failed",
    stage: "failed",
    stageLabel: "Importacion fallida",
    finishedAt: new Date(),
    error,
  });
}

export function getLatestDemoImportJobForUser(userId: number) {
  cleanupOldJobs();
  const jobId = latestJobByUserId.get(userId);
  return jobId ? jobs.get(jobId) ?? null : null;
}
