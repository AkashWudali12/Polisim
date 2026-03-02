import { NextRequest, NextResponse } from 'next/server';
import { getMessagesSlice } from '@/app/api/_core/job_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatTurnResponse {
  message: string;
  can_generate_problem: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  console.info('[api/chat/turn/status] GET handler started');
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const fromIndexRaw = searchParams.get('fromIndex');

  if (!jobId) {
    console.info('[api/chat/turn/status] missing jobId');
    return NextResponse.json({ error: 'Missing jobId query parameter.' }, { status: 400 });
  }

  const fromIndex = fromIndexRaw != null ? Number(fromIndexRaw) : 0;

  const sliceResult = await getMessagesSlice<ChatTurnResponse>(
    jobId,
    Number.isNaN(fromIndex) ? 0 : fromIndex,
  );

  if (!sliceResult) {
    console.info(
      JSON.stringify({
        event: 'job_missing',
        route: 'chat/turn/status',
        jobId,
        fromIndex: Number.isNaN(fromIndex) ? 0 : fromIndex,
      }),
    );
    console.info(`[api/chat/turn/status] job not found for ${jobId}`);
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  }

  const { slice, nextIndex, status, errorMessage } = sliceResult;
  console.info(
    JSON.stringify({
      event: 'job_slice_read',
      route: 'chat/turn/status',
      jobId,
      fromIndex: Number.isNaN(fromIndex) ? 0 : fromIndex,
      returned: slice.length,
      nextIndex,
      status,
    }),
  );
  console.info(
    `[api/chat/turn/status] returning ${slice.length} messages for job ${jobId} (nextIndex ${nextIndex})`,
  );

  return NextResponse.json({
    messages: slice,
    nextIndex,
    status,
    errorMessage,
  });
}

