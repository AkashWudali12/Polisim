'use client';

import type { RunEvent } from '@/lib/run-events';
import { ActivityBadge } from './ActivityBadge';
import { ModelMessageCard } from './ModelMessageCard';

interface RunTimelineProps {
  events: RunEvent[];
}

export function RunTimeline({ events }: RunTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No streamed outputs yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event, index) => {
        if (event.type === 'model_output') {
          return <ModelMessageCard key={`${event.timestamp}-${index}`} event={event} />;
        }

        if (event.type === 'agent_activity') {
          return <ActivityBadge key={`${event.timestamp}-${index}`} event={event} />;
        }

        if (event.type === 'run_error') {
          return (
            <div
              key={`${event.timestamp}-${index}`}
              className="rounded-md border border-red-200 bg-[#f8f2e8] px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-[#f8f2e8] dark:text-red-700"
            >
              {event.message}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
