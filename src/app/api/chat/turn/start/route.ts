import { NextRequest, NextResponse } from 'next/server';
import { runChatTurn } from '@/app/api/_core/debate_orchestrator';
import type { ChatMessage } from '@/app/api/problem_agent';
import { appendMessages, createJob, setJobStatus, type JobStatus } from '@/app/api/_core/job_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatTurnStartRequestBody {
  messages?: ChatMessage[];
}

const requestSchemaError =
  'Invalid request body. Expected { messages: Array<{ sender: string; message: string }> }.';

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
  console.info('[api/chat/turn/start] POST handler started');
  let body: ChatTurnStartRequestBody;
  try {
    body = (await req.json()) as ChatTurnStartRequestBody;
  } catch {
    return NextResponse.json({ error: requestSchemaError }, { status: 400 });
  }

  if (!validateMessages(body.messages)) {
    return NextResponse.json({ error: requestSchemaError }, { status: 400 });
  }

  const job = await createJob<{ message: string; can_generate_problem: string }>('chat_turn');
  console.info(
    JSON.stringify({
      event: 'job_created',
      route: 'chat/turn/start',
      jobId: job.id,
      jobType: 'chat_turn',
    }),
  );

  void (async () => {
    console.info(`[api/chat/turn/start] background runner started for job ${job.id}`);
    await setJobStatus(job.id, 'running' satisfies JobStatus);
    try {
      const { response } = await runChatTurn(body.messages!);
      await appendMessages(job.id, [response]);
      await setJobStatus(job.id, 'completed' satisfies JobStatus);
      console.info(`[api/chat/turn/start] background runner completed for job ${job.id}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to generate chat turn response';
      await setJobStatus(job.id, 'error' satisfies JobStatus, message);
      console.error(`[api/chat/turn/start] background runner failed for job ${job.id}`);
    }
  })();

  console.info(`[api/chat/turn/start] returning jobId ${job.id}`);
  return NextResponse.json({ jobId: job.id });
}

