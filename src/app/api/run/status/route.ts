import { NextRequest, NextResponse } from 'next/server';
import { getMessagesSlice } from '@/app/api/_core/job_store';
import type { RunEvent } from '@/lib/run-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const fromIndexRaw = searchParams.get('fromIndex');

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId query parameter.' }, { status: 400 });
  }

  const fromIndex = fromIndexRaw != null ? Number(fromIndexRaw) : 0;

  const sliceResult = getMessagesSlice<RunEvent>(jobId, Number.isNaN(fromIndex) ? 0 : fromIndex);

  if (!sliceResult) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  }

  const { slice, nextIndex, status, errorMessage } = sliceResult;

  return NextResponse.json({
    events: slice,
    nextIndex,
    status,
    errorMessage,
  });
}

