import { NextRequest, NextResponse } from 'next/server';
import { runDebateSequence } from '@/app/api/_core/debate_orchestrator';
import type { ChatMessage } from '@/app/api/problem_agent';
import { nowEventTimestamp, type RunEvent } from '@/lib/run-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseMessages(raw: string | null): ChatMessage[] | null {
  if (raw == null) return null;

  try {
    const messages = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(messages)) return null;
    for (const message of messages) {
      if (
        message == null ||
        typeof message.sender !== 'string' ||
        typeof message.message !== 'string'
      ) {
        return null;
      }
    }
    return messages;
  } catch {
    return null;
  }
}

export function GET(req: NextRequest): NextResponse {
  const { searchParams } = new URL(req.url);
  const messages = parseMessages(searchParams.get('messages'));
  const firstIdeology = (searchParams.get('firstIdeology') ?? '').trim();
  const secondIdeology = (searchParams.get('secondIdeology') ?? '').trim();

  if (!messages || !firstIdeology || !secondIdeology) {
    return NextResponse.json(
      {
        error:
          'Missing/invalid query params. Expected messages(JSON), firstIdeology, and secondIdeology.',
      },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeEnqueue = (payload: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(payload);
          return true;
        } catch {
          closed = true;
          clearInterval(keepaliveId);
          return false;
        }
      };
      const keepaliveId = setInterval(() => {
        safeEnqueue(encoder.encode(': ping\n\n'));
      }, 15000);

      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepaliveId);
        try {
          controller.close();
        } catch {
          // Stream already closed by runtime/client.
        }
      };

      const emit = (event: RunEvent) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      emit({
        type: 'run_stage',
        stage: 'chatting',
        message: 'Starting streamed run',
        timestamp: nowEventTimestamp(),
      });

      void runDebateSequence(
        {
          messages,
          firstIdeology,
          secondIdeology,
          abortSignal: abortController.signal,
        },
        {
          onStage: ({ stage, message }) =>
            emit({ type: 'run_stage', stage, message, timestamp: nowEventTimestamp() }),
          onModelOutput: ({ kind, title, content, messageId }) =>
            emit({
              type: 'model_output',
              kind,
              title,
              content,
              messageId,
              timestamp: nowEventTimestamp(),
            }),
          onActivity: ({ kind, message }) =>
            emit({ type: 'agent_activity', kind, message, timestamp: nowEventTimestamp() }),
        },
      )
        .then(() => {
          emit({
            type: 'run_done',
            message: 'Debate run finished successfully',
            timestamp: nowEventTimestamp(),
          });
          closeStream();
        })
        .catch((error: unknown) => {
          emit({
            type: 'run_error',
            message: error instanceof Error ? error.message : 'Unknown error during run',
            timestamp: nowEventTimestamp(),
          });
          closeStream();
        });
    },
    cancel() {
      abortController.abort('client_disconnected');
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
