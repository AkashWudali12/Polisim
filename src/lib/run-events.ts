export type RunStage =
  | 'chatting'
  | 'problem_generation'
  | 'thesis_1'
  | 'thesis_2'
  | 'questions'
  | 'debate'
  | 'complete';

export type ModelOutputKind =
  | 'chat_response'
  | 'problem'
  | 'thesis'
  | 'questions'
  | 'debate_turn'
  | 'debate_result';

export type ActivityKind = 'thinking' | 'tool_activity';

export interface RunStageEvent {
  type: 'run_stage';
  stage: RunStage;
  message: string;
  timestamp: number;
}

export interface ModelOutputEvent {
  type: 'model_output';
  kind: ModelOutputKind;
  title: string;
  content: unknown;
  messageId?: string;
  timestamp: number;
}

export interface AgentActivityEvent {
  type: 'agent_activity';
  kind: ActivityKind;
  message: string;
  timestamp: number;
}

export interface RunErrorEvent {
  type: 'run_error';
  message: string;
  timestamp: number;
}

export interface RunDoneEvent {
  type: 'run_done';
  message: string;
  timestamp: number;
}

export type RunEvent =
  | RunStageEvent
  | ModelOutputEvent
  | AgentActivityEvent
  | RunErrorEvent
  | RunDoneEvent;

export interface RunCallbacks {
  onStage?: (event: Omit<RunStageEvent, 'type' | 'timestamp'>) => void;
  onModelOutput?: (event: Omit<ModelOutputEvent, 'type' | 'timestamp'>) => void;
  onActivity?: (event: Omit<AgentActivityEvent, 'type' | 'timestamp'>) => void;
}

export function nowEventTimestamp(): number {
  return Date.now();
}
