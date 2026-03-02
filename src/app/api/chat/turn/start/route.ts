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
  let body: ChatTurnStartRequestBody;
  try {
    body = (await req.json()) as ChatTurnStartRequestBody;
  } catch {
    return NextResponse.json({ error: requestSchemaError }, { status: 400 });
  }

  if (!validateMessages(body.messages)) {
    return NextResponse.json({ error: requestSchemaError }, { status: 400 });
  }

  const job = createJob<{ message: string; can_generate_problem: string }>('chat_turn');

  void (async () => {
    setJobStatus(job.id, 'running' satisfies JobStatus);
    try {
      const { response } = await runChatTurn(body.messages!);
      appendMessages(job.id, [response]);
      setJobStatus(job.id, 'completed' satisfies JobStatus);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to generate chat turn response';
      setJobStatus(job.id, 'error' satisfies JobStatus, message);
    }
  })();

  return NextResponse.json({ jobId: job.id });
}

