import { getRedisClient } from '@/lib/redis';

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

const JOB_TTL_MS = 30 * 60 * 1000;
const JOB_TTL_SECONDS = Math.floor(JOB_TTL_MS / 1000);

function now(): number {
  return Date.now();
}

interface StoredJobMeta {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
}

function metaKey(jobId: string): string {
  return `job:${jobId}:meta`;
}

function messagesKey(jobId: string): string {
  return `job:${jobId}:messages`;
}

function logJobEvent(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event,
      scope: 'job_store',
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}

async function readMeta(jobId: string): Promise<StoredJobMeta | null> {
  const redis = getRedisClient();
  const raw = await redis.get<unknown>(metaKey(jobId));
  if (!raw) return null;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as StoredJobMeta;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    return raw as StoredJobMeta;
  }

  return null;
}

async function writeMeta(meta: StoredJobMeta): Promise<void> {
  const redis = getRedisClient();
  await redis.set(metaKey(meta.id), JSON.stringify(meta), { ex: JOB_TTL_SECONDS });
}

async function touchJobKeys(jobId: string): Promise<void> {
  const redis = getRedisClient();
  await Promise.all([
    redis.expire(metaKey(jobId), JOB_TTL_SECONDS),
    redis.expire(messagesKey(jobId), JOB_TTL_SECONDS),
  ]);
}

export async function createJob<T>(type: JobType): Promise<BaseJob<T>> {
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
  const redis = getRedisClient();
  await writeMeta({
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
  await redis.del(messagesKey(job.id));
  await touchJobKeys(job.id);
  logJobEvent('job_created', {
    jobId: job.id,
    jobType: type,
    status: job.status,
  });
  return job;
}

export async function getJob<T>(id: string): Promise<BaseJob<T> | null> {
  const meta = await readMeta(id);
  if (!meta) return null;
  const redis = getRedisClient();
  const messagesRaw = await redis.lrange<string>(messagesKey(id), 0, -1);
  const messages = messagesRaw.map((entry) => {
    try {
      return JSON.parse(entry) as T;
    } catch {
      return entry as T;
    }
  });
  return {
    id: meta.id,
    type: meta.type,
    status: meta.status,
    messages,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    errorMessage: meta.errorMessage,
  };
}

export async function appendMessages<T>(jobId: string, newMessages: T[]): Promise<void> {
  if (!Array.isArray(newMessages) || newMessages.length === 0) {
    return;
  }

  const meta = await readMeta(jobId);
  if (!meta) {
    logJobEvent('job_missing', { jobId, operation: 'append_messages' });
    return;
  }

  const redis = getRedisClient();
  const entries = newMessages.map((message) => JSON.stringify(message));
  await redis.rpush(messagesKey(jobId), ...entries);

  meta.updatedAt = now();
  await writeMeta(meta);
  await touchJobKeys(jobId);
  logJobEvent('job_append', {
    jobId,
    count: newMessages.length,
  });
}

export async function setJobStatus(
  jobId: string,
  status: JobStatus,
  errorMessage?: string,
): Promise<void> {
  const meta = await readMeta(jobId);
  if (!meta) {
    logJobEvent('job_missing', { jobId, operation: 'set_status' });
    return;
  }
  meta.status = status;
  meta.updatedAt = now();
  if (errorMessage) {
    meta.errorMessage = errorMessage;
  }
  await writeMeta(meta);
  await touchJobKeys(jobId);
  logJobEvent('job_status_change', {
    jobId,
    status,
    hasErrorMessage: Boolean(errorMessage),
  });
}

export interface MessagesSliceResult<T> {
  slice: T[];
  nextIndex: number;
  status: JobStatus;
  errorMessage?: string;
}

export async function getMessagesSlice<T>(
  jobId: string,
  fromIndex: number,
): Promise<MessagesSliceResult<T> | null> {
  const meta = await readMeta(jobId);
  if (!meta) {
    logJobEvent('job_missing', { jobId, operation: 'get_messages_slice', fromIndex });
    return null;
  }

  const start = Number.isFinite(fromIndex) && fromIndex > 0 ? Math.floor(fromIndex) : 0;
  const redis = getRedisClient();
  const nextIndex = await redis.llen(messagesKey(jobId));

  if (start >= nextIndex) {
    await touchJobKeys(jobId);
    logJobEvent('job_slice_read', {
      jobId,
      fromIndex: start,
      returned: 0,
      nextIndex,
      status: meta.status,
    });
    return {
      slice: [],
      nextIndex,
      status: meta.status,
      errorMessage: meta.errorMessage,
    };
  }

  const sliceRaw = await redis.lrange<string>(messagesKey(jobId), start, -1);
  const slice = sliceRaw.map((entry) => {
    try {
      return JSON.parse(entry) as T;
    } catch {
      return entry as T;
    }
  });
  await touchJobKeys(jobId);
  logJobEvent('job_slice_read', {
    jobId,
    fromIndex: start,
    returned: slice.length,
    nextIndex,
    status: meta.status,
  });
  return {
    slice,
    nextIndex,
    status: meta.status,
    errorMessage: meta.errorMessage,
  };
}

