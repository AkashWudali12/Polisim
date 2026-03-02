import { NextRequest, NextResponse } from 'next/server';
import { runChatTurn } from '@/app/api/_core/debate_orchestrator';
import type { ChatMessage } from '@/app/api/problem_agent';

const requestSchemaError =
  'Invalid request body. Expected { messages: Array<{ sender: string; message: string }> }.';

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.info('[api/chat/turn] POST handler started');
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: requestSchemaError }, { status: 400 });
    }

    for (const message of body.messages) {
      if (
        message == null ||
        typeof message.sender !== 'string' ||
        typeof message.message !== 'string'
      ) {
        return NextResponse.json({ error: requestSchemaError }, { status: 400 });
      }
    }

    const { response } = await runChatTurn(body.messages);
    console.info('[api/chat/turn] POST handler completed');
    return NextResponse.json(response);
  } catch (error) {
    console.error('[api/chat/turn] POST handler failed');
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to generate chat turn: ${message}` }, { status: 500 });
  }
}
