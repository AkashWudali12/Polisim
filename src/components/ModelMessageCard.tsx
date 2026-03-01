'use client';

import type { ModelOutputEvent } from '@/lib/run-events';
import { normalizeModelOutputForDisplay } from '@/lib/model-output-display';
import { AssistantMessageBody } from './AssistantMessageBody';

interface ModelMessageCardProps {
  event: ModelOutputEvent;
}

export function ModelMessageCard({ event }: ModelMessageCardProps) {
  const content = normalizeModelOutputForDisplay(event);

  return (
    <article className="rounded-lg border border-zinc-200 bg-[#f8f2e8] p-4 dark:border-zinc-800 dark:bg-[#f8f2e8]">
      <header className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-base font-semibold">{event.title}</h3>
        <span className="rounded bg-[#f8f2e8] px-2 py-1 text-xs uppercase tracking-wide text-zinc-600 dark:bg-[#f8f2e8] dark:text-zinc-600">
          {event.kind.replace('_', ' ')}
        </span>
      </header>
      <AssistantMessageBody content={content} />
    </article>
  );
}
