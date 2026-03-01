'use client';

import type { RunStage } from '@/lib/run-events';

const stageLabels: Record<RunStage, string> = {
  chatting: 'Chatting',
  problem_generation: 'Problem Generation',
  thesis_1: 'First Thesis',
  thesis_2: 'Second Thesis',
  questions: 'Cross-Examination Questions',
  debate: 'Debate',
  complete: 'Complete',
};

interface StageHeaderProps {
  stage: RunStage | null;
  runInProgress: boolean;
}

export function StageHeader({ stage, runInProgress }: StageHeaderProps) {
  const label = stage ? stageLabels[stage] : 'Not started';
  const status = runInProgress ? 'Running' : stage === 'complete' ? 'Finished' : 'Idle';

  return (
    <div className="rounded-lg border border-zinc-200 bg-[#f8f2e8] p-4 dark:border-zinc-800 dark:bg-[#f8f2e8]">
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Stage</div>
      <div className="mt-1 text-lg font-semibold">{label}</div>
      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{status}</div>
    </div>
  );
}
