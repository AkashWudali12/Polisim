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

  const job = createJob<RunEvent>('debate');

  const abortController = new AbortController();

  const initialEvent: RunEvent = {
    type: 'run_stage',
    stage: 'chatting',
    message: 'Starting debate run',
    timestamp: nowEventTimestamp(),
  };
  appendMessages<RunEvent>(job.id, [initialEvent]);

  void (async () => {
    setJobStatus(job.id, 'running' satisfies JobStatus);
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
            appendMessages<RunEvent>(job.id, [
              {
                type: 'run_stage',
                stage,
                message,
                timestamp: nowEventTimestamp(),
              },
            ]);
          },
          onModelOutput: ({ kind, title, content, messageId }) => {
            appendMessages<RunEvent>(job.id, [
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
            appendMessages<RunEvent>(job.id, [
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

      appendMessages<RunEvent>(job.id, [
        {
          type: 'run_done',
          message: 'Debate run finished successfully',
          timestamp: nowEventTimestamp(),
        },
      ]);
      setJobStatus(job.id, 'completed' satisfies JobStatus);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error during debate run';
      appendMessages<RunEvent>(job.id, [
        {
          type: 'run_error',
          message,
          timestamp: nowEventTimestamp(),
        },
      ]);
      setJobStatus(job.id, 'error' satisfies JobStatus, message);
    }
  })();

  return NextResponse.json({ jobId: job.id });
}
