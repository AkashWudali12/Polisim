import { NextRequest, NextResponse } from 'next/server';
import { getMessagesSlice } from '@/app/api/_core/job_store';
import type { RunEvent } from '@/lib/run-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  console.info('[api/run/status] GET handler started');
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const fromIndexRaw = searchParams.get('fromIndex');

  if (!jobId) {
    console.info('[api/run/status] missing jobId');
    return NextResponse.json({ error: 'Missing jobId query parameter.' }, { status: 400 });
  }

  const fromIndex = fromIndexRaw != null ? Number(fromIndexRaw) : 0;

  const sliceResult = await getMessagesSlice<RunEvent>(
    jobId,
    Number.isNaN(fromIndex) ? 0 : fromIndex,
  );

  if (!sliceResult) {
    console.info(
      JSON.stringify({
        event: 'job_missing',
        route: 'run/status',
        jobId,
        fromIndex: Number.isNaN(fromIndex) ? 0 : fromIndex,
      }),
    );
    console.info(`[api/run/status] job not found for ${jobId}`);
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  }

  const { slice, nextIndex, status, errorMessage } = sliceResult;
  console.info(
    JSON.stringify({
      event: 'job_slice_read',
      route: 'run/status',
      jobId,
      fromIndex: Number.isNaN(fromIndex) ? 0 : fromIndex,
      returned: slice.length,
      nextIndex,
      status,
    }),
  );
  console.info(`[api/run/status] returning ${slice.length} events for job ${jobId} (nextIndex ${nextIndex})`);

  return NextResponse.json({
    events: slice,
    nextIndex,
    status,
    errorMessage,
  });
}

