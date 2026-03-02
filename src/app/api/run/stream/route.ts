import { NextRequest, NextResponse } from 'next/server';
import { runDebateSequence } from '@/app/api/_core/debate_orchestrator';
import type { ChatMessage } from '@/app/api/problem_agent';
import { nowEventTimestamp, type RunEvent } from '@/lib/run-events';
import {
  appendMessages,
  createJob,
  setJobStatus,
  type JobStatus,
} from '@/app/api/_core/job_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 700;

interface RunStartRequestBody {
  messages?: ChatMessage[];
  firstIdeology?: string;
  secondIdeology?: string;
}

function validateMessages(messages: ChatMessage[] | undefined): messages is ChatMessage[] {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    if (
      message == null ||
      typeof message.sender !== 'string' ||
      typeof message.message !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.info('[api/run/stream] POST handler started');
  let body: RunStartRequestBody;
  try {
    body = (await req.json()) as RunStartRequestBody;
  } catch {
    return NextResponse.json(
      {
        error:
          'Invalid JSON body. Expected { messages, firstIdeology, secondIdeology }.',
      },
      { status: 400 },
    );
  }

  const { messages, firstIdeology, secondIdeology } = body;

  if (!validateMessages(messages) || !firstIdeology?.trim() || !secondIdeology?.trim()) {
    return NextResponse.json(
      {
        error:
          'Invalid request body. Expected messages (Array<{ sender: string; message: string }>), firstIdeology, and secondIdeology.',
      },
      { status: 400 },
    );
  }

  const job = await createJob<RunEvent>('debate');
  console.info(
    JSON.stringify({
      event: 'job_created',
      route: 'run/stream',
      jobId: job.id,
      jobType: 'debate',
    }),
  );

  const abortController = new AbortController();

  const initialEvent: RunEvent = {
    type: 'run_stage',
    stage: 'chatting',
    message: 'Starting debate run',
    timestamp: nowEventTimestamp(),
  };
  await appendMessages<RunEvent>(job.id, [initialEvent]);

  void (async () => {
    console.info(`[api/run/stream] background runner started for job ${job.id}`);
    await setJobStatus(job.id, 'running' satisfies JobStatus);
    try {
      await runDebateSequence(
        {
          messages,
          firstIdeology: firstIdeology.trim(),
          secondIdeology: secondIdeology.trim(),
          abortSignal: abortController.signal,
        },
        {
          onStage: ({ stage, message }) => {
            void appendMessages<RunEvent>(job.id, [
              {
                type: 'run_stage',
                stage,
                message,
                timestamp: nowEventTimestamp(),
              },
            ]);
          },
          onModelOutput: ({ kind, title, content, messageId }) => {
            void appendMessages<RunEvent>(job.id, [
              {
                type: 'model_output',
                kind,
                title,
                content,
                messageId,
                timestamp: nowEventTimestamp(),
              },
            ]);
          },
          onActivity: ({ kind, message }) => {
            void appendMessages<RunEvent>(job.id, [
              {
                type: 'agent_activity',
                kind,
                message,
                timestamp: nowEventTimestamp(),
              },
            ]);
          },
        },
      );

      await appendMessages<RunEvent>(job.id, [
        {
          type: 'run_done',
          message: 'Debate run finished successfully',
          timestamp: nowEventTimestamp(),
        },
      ]);
      await setJobStatus(job.id, 'completed' satisfies JobStatus);
      console.info(`[api/run/stream] background runner completed for job ${job.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error during debate run';
      await appendMessages<RunEvent>(job.id, [
        {
          type: 'run_error',
          message,
          timestamp: nowEventTimestamp(),
        },
      ]);
      await setJobStatus(job.id, 'error' satisfies JobStatus, message);
      console.error(`[api/run/stream] background runner failed for job ${job.id}`);
    }
  })();

  console.info(`[api/run/stream] returning jobId ${job.id}`);
  return NextResponse.json({ jobId: job.id });
}
