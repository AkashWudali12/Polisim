import { generateText, NoOutputGeneratedError, Output, stepCountIs, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type Problem } from './problem_agent';
import type { RunCallbacks } from '@/lib/run-events';

type ThesisField = 'thesis' | 'evidence' | 'cost_estimate' | 'weaknesses' | 'risk_scenarios';

type AgentSide = 'first' | 'second';

const crossfirePairSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const crossfireSchema = z.object({
  firstAgentCrossfire: z.array(crossfirePairSchema),
  secondAgentCrossfire: z.array(crossfirePairSchema),
});

const debateTurnOutputSchema = z.object({
  kind: z.enum(['message', 'proposed_solution', 'confirm_solution', 'deny_solution']),
  content: z.string().min(1),
});

const debateTranscriptItemSchema = z.object({
  speaker: z.enum(['first', 'second']),
  turn: z.number().int().nonnegative(),
  output: debateTurnOutputSchema,
});

const debateLoopResultSchema = z.object({
  crossfire: crossfireSchema,
  debateTranscript: z.array(debateTranscriptItemSchema),
  resolution: z.object({
    resolved: z.boolean(),
    acceptedBy: z.enum(['first', 'second']).optional(),
    solutionText: z.string().optional(),
    stopReason: z.enum(['agreement', 'max_rounds']),
  }),
});

export type CrossfirePair = z.infer<typeof crossfirePairSchema>;
export type Crossfire = z.infer<typeof crossfireSchema>;
export type DebateTurnOutput = z.infer<typeof debateTurnOutputSchema>;
export type DebateTranscriptItem = z.infer<typeof debateTranscriptItemSchema>;
export type DebateLoopResult = z.infer<typeof debateLoopResultSchema>;

export interface RunDebateLoopParams {
  problem: Problem;
  firstIdeology: string;
  secondIdeology: string;
  firstThesis: unknown;
  secondThesis: unknown;
  firstAgentQuestionsForSecond: string[];
  secondAgentQuestionsForFirst: string[];
  maxRounds?: number;
}

const summarizeMaxTokens = 80;
const debateTurnPrimaryStepLimit = 12;
const debateTurnRetryStepLimit = 6;
const debateTurnMaxRetries = 1;

type DebateTurnToolsMode = 'full_tools' | 'retry_limited_tools';
type DebateParseFailureCategory = 'missing_output' | 'schema_mismatch' | 'provider_parse_error';

interface DebateTurnAttemptResult {
  messageId: string;
  output: DebateTurnOutput | null;
  failureCategory?: DebateParseFailureCategory;
  failureMessage?: string;
}

function thesisPartValue(thesis: unknown, field: ThesisField): unknown {
  if (thesis == null || typeof thesis !== 'object') return 'Thesis not available';
  const value = (thesis as Record<string, unknown>)[field];
  return value ?? 'Field not available';
}

async function summarizeMessage(message: string, maxTokens: number = summarizeMaxTokens): Promise<string> {
  if (!message.trim()) return message;
  const { text } = await generateText({
    model: openai('gpt-4o'),
    system: `Summarize this content concisely in <= ${maxTokens} tokens. Output only the summary.`,
    prompt: message,
    maxOutputTokens: maxTokens,
  });
  return text.trim() || message;
}

function logDebateToolCall(params: {
  speaker: AgentSide;
  turn: number;
  tool: string;
  args: unknown;
}): void {
  console.log('\n=== Debate Tool Call ===');
  console.log(`speaker: ${params.speaker}`);
  console.log(`turn: ${params.turn}`);
  console.log(`tool: ${params.tool}`);
  console.log('args:');
  console.log(JSON.stringify(params.args ?? {}, null, 2));
  console.log('========================\n');
}

function logDebateMessage(params: {
  speaker: AgentSide;
  turn: number;
  kind: DebateTurnOutput['kind'];
  content: string;
}): void {
  console.log('\n=== Debate Message ===');
  console.log(`speaker: ${params.speaker}`);
  console.log(`turn: ${params.turn}`);
  console.log(`kind: ${params.kind}`);
  console.log('content:');
  console.log(params.content);
  console.log('======================\n');
}

function logDebateRetry(params: {
  speaker: AgentSide;
  turn: number;
  attempt: number;
  toolsMode: DebateTurnToolsMode;
  failureCategory: DebateParseFailureCategory;
  failureMessage?: string;
}): void {
  console.log('\n=== Debate Retry ===');
  console.log(`speaker: ${params.speaker}`);
  console.log(`turn: ${params.turn}`);
  console.log(`attempt: ${params.attempt}`);
  console.log(`toolsMode: ${params.toolsMode}`);
  console.log(`failureCategory: ${params.failureCategory}`);
  if (params.failureMessage != null && params.failureMessage.length > 0) {
    console.log(`failureMessage: ${params.failureMessage}`);
  }
  console.log('====================\n');
}

function classifyParseFailure(error: unknown): {
  category: DebateParseFailureCategory;
  message: string;
} {
  if (NoOutputGeneratedError.isInstance(error)) {
    return {
      category: 'missing_output',
      message: error.message ?? 'No output generated.',
    };
  }
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown parse error');
  const lowered = message.toLowerCase();
  if (
    lowered.includes('schema') ||
    lowered.includes('validation') ||
    lowered.includes('zod') ||
    lowered.includes('json')
  ) {
    return { category: 'schema_mismatch', message };
  }
  return { category: 'provider_parse_error', message };
}

function mapDebateToolToActivity(toolName: string): string {
  switch (toolName) {
    case 'getThesisPart':
      return 'Comparing thesis parts';
    case 'getCrossfirePair':
      return 'Reviewing cross-examination notes';
    case 'getAvailableContext':
    case 'getContext':
      return 'Reviewing debate context';
    default:
      return 'Using debate tools';
  }
}

function formatDebateStateForSummary(params: {
  crossfire: Crossfire;
  transcript: DebateTranscriptItem[];
  pendingProposal: { proposer: AgentSide; text: string } | null;
}): string {
  const { crossfire, transcript, pendingProposal } = params;

  const firstCrossfireText = crossfire.firstAgentCrossfire
    .map((pair, i) => `Q${i + 1}: ${pair.question}\nA${i + 1}: ${pair.answer}`)
    .join('\n');
  const secondCrossfireText = crossfire.secondAgentCrossfire
    .map((pair, i) => `Q${i + 1}: ${pair.question}\nA${i + 1}: ${pair.answer}`)
    .join('\n');
  const transcriptText = transcript
    .map(
      item =>
        `Turn ${item.turn + 1} | ${item.speaker} | ${item.output.kind}: ${item.output.content}`,
    )
    .join('\n');

  const pendingText =
    pendingProposal == null
      ? 'No pending proposal.'
      : `Pending proposal from ${pendingProposal.proposer}: ${pendingProposal.text}`;

  return `Crossfire (first asked, second answered):
${firstCrossfireText || 'none'}

Crossfire (second asked, first answered):
${secondCrossfireText || 'none'}

Debate transcript:
${transcriptText || 'none'}

Proposal status:
${pendingText}`;
}

async function answerCrossfireQuestion(params: {
  problem: Problem;
  answererIdeology: string;
  answererThesis: unknown;
  question: string;
  callbacks?: RunCallbacks;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const answerSchema = z.object({ answer: z.string().min(1) });
  const messageId = crypto.randomUUID();
  const result = await generateText({
    model: openai('gpt-5.2'),
    system: `You are participating in a policy debate crossfire phase.
Answer the question directly and clearly, from your side's ideological perspective, while remaining factual and concise.
Return only valid JSON matching the schema.`,
    prompt: `Problem:
${JSON.stringify(params.problem, null, 2)}

Your ideology:
${params.answererIdeology}

Your thesis:
${JSON.stringify(params.answererThesis, null, 2)}

Question:
${params.question}`,
    output: Output.object({
      schema: answerSchema,
      name: 'CrossfireAnswer',
      description: 'Structured answer for a single crossfire question.',
    }),
    abortSignal: params.abortSignal,
  });
  let output: { answer: string } | null = null;
  try {
    output = result.output;
  } catch (err) {
    if (NoOutputGeneratedError.isInstance(err)) {
      output = {
        answer: `[Fallback: Could not generate structured answer for this question. Reaffirming position from thesis.]`,
      };
    } else {
      throw err;
    }
  }
  if (output == null) {
    output = {
      answer: `[Fallback: No structured answer returned. Reaffirming position from thesis.]`,
    };
  }

  params.callbacks?.onModelOutput?.({
    kind: 'debate_turn',
    title: 'Crossfire Answer',
    content: { question: params.question, answer: output.answer },
    messageId,
  });

  return output.answer;
}

interface RunDebateLoopOptions {
  callbacks?: RunCallbacks;
  abortSignal?: AbortSignal;
}

export async function runDebateLoop(
  params: RunDebateLoopParams,
  options?: RunDebateLoopOptions,
): Promise<DebateLoopResult> {
  const {
    problem,
    firstIdeology,
    secondIdeology,
    firstThesis,
    secondThesis,
    firstAgentQuestionsForSecond,
    secondAgentQuestionsForFirst,
    maxRounds = 10,
  } = params;
  const callbacks = options?.callbacks;
  const abortSignal = options?.abortSignal;

  const contextCache = new Map<string, [string, string]>();

  const addMessageToContext = async (message: string): Promise<string> => {
    const id = crypto.randomUUID();
    const summary = await summarizeMessage(message);
    contextCache.set(id, [summary, message]);
    return id;
  };

  const getAvailableContext = tool({
    description: 'Get all available context IDs and summaries.',
    inputSchema: z.object({}),
    execute: async () => {
      let output = '';
      for (const [id, [summary]] of contextCache.entries()) {
        output += `Lookup ID: ${id}\nSummary: ${summary}\n`;
      }
      return output || 'No context available yet.';
    },
  });

  const getContext = tool({
    description: 'Get full context content for a given lookup ID.',
    inputSchema: z.object({
      lookup_id: z.string(),
    }),
    execute: async ({ lookup_id }) => {
      return contextCache.get(lookup_id)?.[1] ?? 'Context not found';
    },
  });

  const crossfire: Crossfire = {
    firstAgentCrossfire: [],
    secondAgentCrossfire: [],
  };

  for (const question of firstAgentQuestionsForSecond) {
    callbacks?.onActivity?.({ kind: 'thinking', message: 'Preparing crossfire response' });
    const answer = await answerCrossfireQuestion({
      problem,
      answererIdeology: secondIdeology,
      answererThesis: secondThesis,
      question,
      callbacks,
      abortSignal,
    });
    const pair: CrossfirePair = { question, answer };
    crossfire.firstAgentCrossfire.push(pair);
    await addMessageToContext(
      `CROSSFIRE (first asked, second answered)\nQ: ${question}\nA: ${answer}`,
    );
  }

  for (const question of secondAgentQuestionsForFirst) {
    callbacks?.onActivity?.({ kind: 'thinking', message: 'Preparing crossfire response' });
    const answer = await answerCrossfireQuestion({
      problem,
      answererIdeology: firstIdeology,
      answererThesis: firstThesis,
      question,
      callbacks,
      abortSignal,
    });
    const pair: CrossfirePair = { question, answer };
    crossfire.secondAgentCrossfire.push(pair);
    await addMessageToContext(
      `CROSSFIRE (second asked, first answered)\nQ: ${question}\nA: ${answer}`,
    );
  }

  const debateTranscript: DebateTranscriptItem[] = [];
  let pendingProposal: { proposer: AgentSide; text: string } | null = null;
  let debateSummary = await summarizeMessage(
    formatDebateStateForSummary({
      crossfire,
      transcript: debateTranscript,
      pendingProposal,
    }),
    220,
  );
  const firstThesisSummary = await summarizeMessage(
    `FIRST AGENT THESIS\n${JSON.stringify(firstThesis, null, 2)}`,
    180,
  );
  const secondThesisSummary = await summarizeMessage(
    `SECOND AGENT THESIS\n${JSON.stringify(secondThesis, null, 2)}`,
    180,
  );

  const makeGetThesisPartTool = (speaker: AgentSide) =>
    tool({
      description: 'Get a specific thesis part from your thesis or the opposing thesis.',
      inputSchema: z.object({
        side: z.enum(['self', 'opponent']),
        field: z.enum(['thesis', 'evidence', 'cost_estimate', 'weaknesses', 'risk_scenarios']),
      }),
      execute: async ({ side, field }) => {
        const isFirst = speaker === 'first';
        const selfThesis = isFirst ? firstThesis : secondThesis;
        const opponentThesis = isFirst ? secondThesis : firstThesis;
        return side === 'self'
          ? thesisPartValue(selfThesis, field)
          : thesisPartValue(opponentThesis, field);
      },
    });

  const makeGetCrossfirePairTool = (speaker: AgentSide) =>
    tool({
      description:
        'Get a specific crossfire question-answer pair. source=self returns your own crossfire list; source=opponent returns opposing side list.',
      inputSchema: z.object({
        source: z.enum(['self', 'opponent']),
        index: z.number().int().nonnegative(),
      }),
      execute: async ({ source, index }) => {
        const isFirst = speaker === 'first';
        const selfList = isFirst ? crossfire.firstAgentCrossfire : crossfire.secondAgentCrossfire;
        const opponentList = isFirst ? crossfire.secondAgentCrossfire : crossfire.firstAgentCrossfire;
        const list = source === 'self' ? selfList : opponentList;
        return list[index] ?? 'Crossfire pair not found at index';
      },
    });

  const buildDebateSystemPrompt = (speaker: AgentSide): string => {
    const isFirst = speaker === 'first';
    const selfIdeology = isFirst ? firstIdeology : secondIdeology;
    const selfLabel = isFirst ? 'first' : 'second';
    const opponentLabel = isFirst ? 'second' : 'first';
    const selfThesisSummary = isFirst ? firstThesisSummary : secondThesisSummary;
    const opponentThesisSummary = isFirst ? secondThesisSummary : firstThesisSummary;

    return `You are the ${selfLabel} agent in a structured policy debate.

You can use tools to inspect:
- your thesis vs opponent thesis
- crossfire question/answer pairs
- prior context entries

Rules:
- Always output exactly one structured object.
- Output kinds allowed:
  - message
  - proposed_solution
  - confirm_solution
  - deny_solution
- If the opponent has an active proposed solution pending your response, you should output confirm_solution or deny_solution.
- Keep arguments concise, evidence-focused, and aligned with your ideology.

Belief and compromise guidance:
- Strongly represent and defend your core beliefs and policy priorities.
- Stand up for what you believe with clear reasoning and evidence.
- At the same time, be open to compromise and negotiation to reach a workable solution.
- Prefer principled compromise over deadlock when a reasonable joint solution is possible.

Your ideology:
${selfIdeology}

Summary of your thesis:
${selfThesisSummary}

Summary of opponent thesis:
${opponentThesisSummary}

Debate problem:
${JSON.stringify(problem, null, 2)}

You are debating against the ${opponentLabel} agent.`;
  };

  const formatRecentTranscript = (count: number): string => {
    const recent = debateTranscript.slice(-count);
    if (recent.length === 0) return 'none';
    return recent
      .map(
        item =>
          `Turn ${item.turn + 1} | ${item.speaker} | ${item.output.kind}: ${item.output.content}`,
      )
      .join('\n');
  };

  const buildRetryPrompt = (params: {
    turn: number;
    speaker: AgentSide;
    pendingText: string;
    retryReason: string;
  }): string => `Current turn: ${params.turn + 1}
Current speaker: ${params.speaker}
Pending proposal status: ${params.pendingText}

Running summary of the entire debate so far:
${debateSummary}

Most recent transcript items:
${formatRecentTranscript(2)}

Previous parse failure note:
${params.retryReason}

You MUST return exactly one JSON object with this shape:
{
  "kind": "message" | "proposed_solution" | "confirm_solution" | "deny_solution",
  "content": "non-empty string"
}

Return only valid JSON. No prose, no markdown, no backticks.`;

  const executeDebateTurnAttempt = async (params: {
    speaker: AgentSide;
    turn: number;
    prompt: string;
    toolsMode: DebateTurnToolsMode;
  }): Promise<DebateTurnAttemptResult> => {
    const messageId = crypto.randomUUID();

    let tools: NonNullable<Parameters<typeof generateText>[0]['tools']>;
    if (params.toolsMode === 'full_tools') {
      tools = {
        getThesisPart: makeGetThesisPartTool(params.speaker),
        getCrossfirePair: makeGetCrossfirePairTool(params.speaker),
        getAvailableContext,
        getContext,
      };
    } else {
      tools = {
        getThesisPart: makeGetThesisPartTool(params.speaker),
        getCrossfirePair: makeGetCrossfirePairTool(params.speaker),
      };
    }

    const response = await generateText({
      model: openai('gpt-5.2'),
      system: buildDebateSystemPrompt(params.speaker),
      prompt: params.prompt,
      output: Output.object({
        schema: debateTurnOutputSchema,
        name: 'DebateTurnOutput',
        description:
          'One debate action: message, proposed_solution, confirm_solution, or deny_solution.',
      }),
      tools,
      experimental_onToolCallStart: ({ toolCall }) => {
        callbacks?.onActivity?.({
          kind: 'tool_activity',
          message: mapDebateToolToActivity(toolCall.toolName),
        });
        if (callbacks == null) {
          logDebateToolCall({
            speaker: params.speaker,
            turn: params.turn + 1,
            tool: toolCall.toolName,
            args: toolCall.input ?? {},
          });
        }
      },
      stopWhen: stepCountIs(
        params.toolsMode === 'full_tools' ? debateTurnPrimaryStepLimit : debateTurnRetryStepLimit,
      ),
      abortSignal,
    });

    try {
      const outputResult = response.output;
      if (outputResult == null) {
        return {
          messageId,
          output: null,
          failureCategory: 'missing_output',
          failureMessage: 'Structured output was missing.',
        };
      }
      return { messageId, output: outputResult as DebateTurnOutput };
    } catch (error) {
      const parsed = classifyParseFailure(error);
      return {
        messageId,
        output: null,
        failureCategory: parsed.category,
        failureMessage: parsed.message,
      };
    }
  };

  const totalTurns = maxRounds * 2;
  for (let turn = 0; turn < totalTurns; turn += 1) {
    const speaker: AgentSide = turn % 2 === 0 ? 'first' : 'second';
    const opponent: AgentSide = speaker === 'first' ? 'second' : 'first';
    callbacks?.onActivity?.({ kind: 'thinking', message: 'Analyzing debate turn' });
    const pendingText =
      pendingProposal == null
        ? 'No pending proposal.'
        : `Pending proposal from ${pendingProposal.proposer}: ${pendingProposal.text}`;

    const turnPrompt = `Current turn: ${turn + 1}
Current speaker: ${speaker}
Pending proposal status: ${pendingText}

Running summary of the entire debate so far:
${debateSummary}

Respond with one structured output item now.`;
    let output: DebateTurnOutput | null = null;
    let messageId = crypto.randomUUID();
    let failureReason = 'Unknown parse failure.';

    for (let attempt = 0; attempt <= debateTurnMaxRetries; attempt += 1) {
      const toolsMode: DebateTurnToolsMode = attempt === 0 ? 'full_tools' : 'retry_limited_tools';
      const prompt =
        attempt === 0
          ? turnPrompt
          : buildRetryPrompt({
              turn,
              speaker,
              pendingText,
              retryReason: failureReason,
            });

      const attemptResult = await executeDebateTurnAttempt({
        speaker,
        turn,
        prompt,
        toolsMode,
      });
      messageId = attemptResult.messageId;
      if (attemptResult.output != null) {
        output = attemptResult.output;
        break;
      }

      failureReason =
        attemptResult.failureMessage ??
        `No structured object generated (${attemptResult.failureCategory ?? 'unknown'}).`;
      const failureCategory = attemptResult.failureCategory ?? 'provider_parse_error';
      callbacks?.onActivity?.({
        kind: 'thinking',
        message:
          attempt < debateTurnMaxRetries
            ? `Turn ${turn + 1}: structured output parse failed (${failureCategory}), retrying.`
            : `Turn ${turn + 1}: structured output parse failed (${failureCategory}), applying fallback.`,
      });

      if (callbacks == null) {
        logDebateRetry({
          speaker,
          turn: turn + 1,
          attempt: attempt + 1,
          toolsMode,
          failureCategory,
          failureMessage: attemptResult.failureMessage,
        });
      }
    }

    if (output == null) {
      output =
        pendingProposal && pendingProposal.proposer === opponent
          ? {
              kind: 'deny_solution',
              content:
                'Denying pending proposal after repeated structured-output parse failures for this turn.',
            }
          : {
              kind: 'message',
              content:
                'Continuing debate after temporary structured-output parse issues. Reaffirming stance and moving to the next point.',
            };
    }

    if (
      pendingProposal &&
      pendingProposal.proposer === opponent &&
      output.kind !== 'confirm_solution' &&
      output.kind !== 'deny_solution'
    ) {
      output = {
        kind: 'deny_solution',
        content:
          'Denying pending proposal because response did not explicitly confirm or deny it.',
      };
    }

    debateTranscript.push({ speaker, turn, output });
    callbacks?.onModelOutput?.({
      kind: 'debate_turn',
      title: `Debate Turn ${turn + 1}`,
      content: { speaker, kind: output.kind, content: output.content },
      messageId,
    });
    if (callbacks == null) {
      logDebateMessage({
        speaker,
        turn: turn + 1,
        kind: output.kind,
        content: output.content,
      });
    }
    await addMessageToContext(
      `DEBATE TURN\nspeaker: ${speaker}\nkind: ${output.kind}\ncontent: ${output.content}`,
    );
    if (output.kind === 'proposed_solution') {
      pendingProposal = { proposer: speaker, text: output.content };
      debateSummary = await summarizeMessage(
        formatDebateStateForSummary({
          crossfire,
          transcript: debateTranscript,
          pendingProposal,
        }),
        220,
      );
      continue;
    }

    if (output.kind === 'deny_solution') {
      pendingProposal = null;
      debateSummary = await summarizeMessage(
        formatDebateStateForSummary({
          crossfire,
          transcript: debateTranscript,
          pendingProposal,
        }),
        220,
      );
      continue;
    }

    if (output.kind === 'confirm_solution' && pendingProposal && pendingProposal.proposer === opponent) {
      const result: DebateLoopResult = {
        crossfire,
        debateTranscript,
        resolution: {
          resolved: true,
          acceptedBy: speaker,
          solutionText: pendingProposal.text,
          stopReason: 'agreement',
        },
      };
      const parsed = debateLoopResultSchema.safeParse(result);
      if (!parsed.success) throw new Error(`Invalid debate result: ${parsed.error.message}`);
      callbacks?.onModelOutput?.({
        kind: 'debate_result',
        title: 'Debate Resolution',
        content: parsed.data.resolution,
      });
      return parsed.data;
    }

    debateSummary = await summarizeMessage(
      formatDebateStateForSummary({
        crossfire,
        transcript: debateTranscript,
        pendingProposal,
      }),
      220,
    );
  }

  const result: DebateLoopResult = {
    crossfire,
    debateTranscript,
    resolution: {
      resolved: false,
      stopReason: 'max_rounds',
    },
  };

  const parsed = debateLoopResultSchema.safeParse(result);
  if (!parsed.success) throw new Error(`Invalid debate result: ${parsed.error.message}`);
  callbacks?.onModelOutput?.({
    kind: 'debate_result',
    title: 'Debate Resolution',
    content: parsed.data.resolution,
  });
  return parsed.data;
}
