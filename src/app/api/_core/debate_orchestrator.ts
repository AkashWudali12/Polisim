import {
  generate_chatbot_response,
  generate_problem,
  type ChatMessage,
  type Problem,
} from '../problem_agent';
import { generateThesis, resetResearchState } from '../research_agent';
import { generate_questions } from '../question_generation';
import { runDebateLoop, type DebateLoopResult } from '../debate_loop';
import type { ModelOutputKind, RunCallbacks, RunStage } from '@/lib/run-events';

interface OrchestratorResult {
  problem: Problem;
  firstThesis: unknown;
  secondThesis: unknown;
  firstAgentQuestionsForSecond: string[];
  secondAgentQuestionsForFirst: string[];
  debateResult: DebateLoopResult;
}

export interface ChatTurnResult {
  response: Awaited<ReturnType<typeof generate_chatbot_response>>;
}

export interface DebateRunInput {
  messages: ChatMessage[];
  firstIdeology: string;
  secondIdeology: string;
  maxRounds?: number;
  abortSignal?: AbortSignal;
}

function emitStage(callbacks: RunCallbacks | undefined, stage: RunStage, message: string): void {
  callbacks?.onStage?.({ stage, message });
}

function emitActivity(callbacks: RunCallbacks | undefined, message: string): void {
  callbacks?.onActivity?.({ kind: 'thinking', message });
}

function emitModel(
  callbacks: RunCallbacks | undefined,
  kind: ModelOutputKind,
  title: string,
  content: unknown,
  messageId?: string,
): void {
  callbacks?.onModelOutput?.({ kind, title, content, messageId });
}

function logOrchestrator(event: string, meta: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: 'debate_orchestrator',
      event,
      timestamp: new Date().toISOString(),
      ...meta,
    }),
  );
}

export async function runChatTurn(messages: ChatMessage[]): Promise<ChatTurnResult> {
  logOrchestrator('chat_turn_start', { messageCount: messages.length });
  const response = await generate_chatbot_response(messages);
  logOrchestrator('chat_turn_complete', {
    messageCount: messages.length,
    canGenerateProblem: response.can_generate_problem,
    responseLength: response.message.length,
  });
  return { response };
}

export async function runDebateSequence(
  input: DebateRunInput,
  callbacks?: RunCallbacks,
): Promise<OrchestratorResult> {
  const { messages, firstIdeology, secondIdeology, maxRounds, abortSignal } = input;
  const startedAt = Date.now();
  logOrchestrator('debate_sequence_start', {
    messageCount: messages.length,
    firstIdeologyLength: firstIdeology.length,
    secondIdeologyLength: secondIdeology.length,
    maxRounds: maxRounds ?? null,
    hasAbortSignal: Boolean(abortSignal),
  });
  try {
    logOrchestrator('problem_generation_start', {});
    emitStage(callbacks, 'problem_generation', 'Generating structured problem');
    emitActivity(callbacks, 'Analyzing conversation for problem shape');
    const problemMessageId = crypto.randomUUID();
    const problem = await generate_problem(messages, {
      callbacks,
      messageId: problemMessageId,
      abortSignal,
    });
    emitModel(callbacks, 'problem', 'Generated Problem', problem, problemMessageId);
    logOrchestrator('problem_generation_complete', { problemMessageId });

    logOrchestrator('thesis_1_start', {});
    emitStage(callbacks, 'thesis_1', 'Generating first thesis');
    emitActivity(callbacks, 'Analyzing first thesis strategy');
    const firstThesis = await generateThesis(firstIdeology, problem, { callbacks, abortSignal });
    emitModel(callbacks, 'thesis', 'First Agent Thesis', firstThesis);
    logOrchestrator('thesis_1_complete', {});

    logOrchestrator('thesis_2_start', {});
    emitStage(callbacks, 'thesis_2', 'Generating second thesis');
    emitActivity(callbacks, 'Analyzing second thesis strategy');
    const secondThesis = await generateThesis(secondIdeology, problem, { callbacks, abortSignal });
    emitModel(callbacks, 'thesis', 'Second Agent Thesis', secondThesis);
    logOrchestrator('thesis_2_complete', {});

    logOrchestrator('question_generation_start', { requestedPerSide: 5 });
    emitStage(callbacks, 'questions', 'Generating cross-examination questions');
    emitActivity(callbacks, 'Preparing cross-examination prompts');
    const firstAgentQuestionsForSecond = await generate_questions(
      problem,
      firstIdeology,
      secondThesis,
      5,
      { callbacks, abortSignal },
    );

    const secondAgentQuestionsForFirst = await generate_questions(
      problem,
      secondIdeology,
      firstThesis,
      5,
      { callbacks, abortSignal },
    );
    logOrchestrator('question_generation_complete', {
      firstAgentQuestionCount: firstAgentQuestionsForSecond.length,
      secondAgentQuestionCount: secondAgentQuestionsForFirst.length,
    });

    logOrchestrator('debate_loop_start', {});
    emitStage(callbacks, 'debate', 'Running structured debate');
    emitActivity(callbacks, 'Comparing arguments and seeking resolution');
    const debateResult = await runDebateLoop(
      {
        problem,
        firstIdeology,
        secondIdeology,
        firstThesis,
        secondThesis,
        firstAgentQuestionsForSecond,
        secondAgentQuestionsForFirst,
        maxRounds,
      },
      { callbacks, abortSignal },
    );
    emitModel(callbacks, 'debate_result', 'Debate Result', debateResult);
    logOrchestrator('debate_loop_complete', {
      transcriptCount: debateResult.debateTranscript.length,
      resolved: debateResult.resolution.resolved,
      stopReason: debateResult.resolution.stopReason,
    });

    emitStage(callbacks, 'complete', 'Run complete');
    logOrchestrator('debate_sequence_complete', { elapsedMs: Date.now() - startedAt });

    return {
      problem,
      firstThesis,
      secondThesis,
      firstAgentQuestionsForSecond,
      secondAgentQuestionsForFirst,
      debateResult,
    };
  } finally {
    logOrchestrator('debate_sequence_cleanup', { elapsedMs: Date.now() - startedAt });
    // Ensure any shared thesis/cache state is reset after each run.
    resetResearchState();
  }
}
