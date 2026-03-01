'use client';

import type { AgentActivityEvent } from '@/lib/run-events';

interface ActivityBadgeProps {
  event: AgentActivityEvent;
}

export function ActivityBadge({ event }: ActivityBadgeProps) {
  const label = event.kind === 'tool_activity' ? 'Tool activity' : 'Thinking';

  return (
    <div className="rounded-md border border-zinc-200 bg-[#f8f2e8] px-3 py-2 text-sm dark:border-zinc-700 dark:bg-[#f8f2e8]">
      <span className="font-medium">{label}:</span> {event.message}
    </div>
  );
}
