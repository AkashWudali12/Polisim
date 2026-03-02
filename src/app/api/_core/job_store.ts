export type JobType = 'debate' | 'chat_turn';

export type JobStatus = 'pending' | 'running' | 'completed' | 'error';

interface BaseJob<T> {
  id: string;
  type: JobType;
  status: JobStatus;
  messages: T[];
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
}

type AnyJob = BaseJob<unknown>;

const jobs = new Map<string, AnyJob>();

const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes

function now(): number {
  return Date.now();
}

function pruneExpiredJobs(): void {
  const cutoff = now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) {
      jobs.delete(id);
    }
  }
}

export function createJob<T>(type: JobType): BaseJob<T> {
  pruneExpiredJobs();
  const id = crypto.randomUUID();
  const timestamp = now();
  const job: BaseJob<T> = {
    id,
    type,
    status: 'pending',
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  jobs.set(id, job as AnyJob);
  return job;
}

export function getJob<T>(id: string): BaseJob<T> | null {
  const job = jobs.get(id);
  if (!job) return null;
  return job as BaseJob<T>;
}

export function appendMessages<T>(jobId: string, newMessages: T[]): void {
  const job = jobs.get(jobId);
  if (!job) return;

  const typedJob = job as BaseJob<T>;
  if (!Array.isArray(newMessages) || newMessages.length === 0) {
    return;
  }

  typedJob.messages.push(...newMessages);
  typedJob.updatedAt = now();
}

export function setJobStatus(jobId: string, status: JobStatus, errorMessage?: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAt = now();
  if (errorMessage) {
    job.errorMessage = errorMessage;
  }
}

export interface MessagesSliceResult<T> {
  slice: T[];
  nextIndex: number;
  status: JobStatus;
  errorMessage?: string;
}

export function getMessagesSlice<T>(jobId: string, fromIndex: number): MessagesSliceResult<T> | null {
  const job = jobs.get(jobId) as BaseJob<T> | undefined;
  if (!job) return null;

  const start = Number.isFinite(fromIndex) && fromIndex > 0 ? Math.floor(fromIndex) : 0;
  const messages = job.messages;
  const nextIndex = messages.length;

  if (start >= nextIndex) {
    return {
      slice: [],
      nextIndex,
      status: job.status,
      errorMessage: job.errorMessage,
    };
  }

  const slice = messages.slice(start);
  return {
    slice,
    nextIndex,
    status: job.status,
    errorMessage: job.errorMessage,
  };
}

