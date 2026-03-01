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

export async function runChatTurn(messages: ChatMessage[]): Promise<ChatTurnResult> {
  const response = await generate_chatbot_response(messages);
  return { response };
}

export async function runDebateSequence(
  input: DebateRunInput,
  callbacks?: RunCallbacks,
): Promise<OrchestratorResult> {
  const { messages, firstIdeology, secondIdeology, maxRounds, abortSignal } = input;
  try {
    emitStage(callbacks, 'problem_generation', 'Generating structured problem');
    emitActivity(callbacks, 'Analyzing conversation for problem shape');
    const problemMessageId = crypto.randomUUID();
    const problem = await generate_problem(messages, {
      callbacks,
      messageId: problemMessageId,
      abortSignal,
    });
    emitModel(callbacks, 'problem', 'Generated Problem', problem, problemMessageId);

    emitStage(callbacks, 'thesis_1', 'Generating first thesis');
    emitActivity(callbacks, 'Analyzing first thesis strategy');
    const firstThesis = await generateThesis(firstIdeology, problem, { callbacks, abortSignal });
    emitModel(callbacks, 'thesis', 'First Agent Thesis', firstThesis);

    emitStage(callbacks, 'thesis_2', 'Generating second thesis');
    emitActivity(callbacks, 'Analyzing second thesis strategy');
    const secondThesis = await generateThesis(secondIdeology, problem, { callbacks, abortSignal });
    emitModel(callbacks, 'thesis', 'Second Agent Thesis', secondThesis);

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

    emitStage(callbacks, 'complete', 'Run complete');

    return {
      problem,
      firstThesis,
      secondThesis,
      firstAgentQuestionsForSecond,
      secondAgentQuestionsForFirst,
      debateResult,
    };
  } finally {
    // Ensure any shared thesis/cache state is reset after each run.
    resetResearchState();
  }
}
