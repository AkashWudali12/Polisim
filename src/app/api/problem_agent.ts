import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import type { RunCallbacks } from '@/lib/run-events';

/** A single chat message with sender and content. */
export interface ChatMessage {
  sender: string;
  message: string;
}

/**
 * Structured output for a policy debate problem.
 */
export interface Problem {
  policy_question: string;
  scope: string;
  time_horizon: string;
  jurisdiction: string;
  constraints: string;
}

/**
 * Structured response from the problem-framing chatbot.
 * can_generate_problem is "yes" when the conversation has enough information to create a Problem; otherwise "no".
 */
export interface ConversationResponse {
  message: string;
  can_generate_problem: string;
}

const problemSchema = z.object({
  policy_question: z.string(),
  scope: z.string(),
  time_horizon: z.string(),
  jurisdiction: z.string(),
  constraints: z.string(),
});

const conversationResponseSchema = z.object({
  message: z.string(),
  can_generate_problem: z.string(),
});

interface StreamedGenerationOptions {
  callbacks?: RunCallbacks;
  messageId?: string;
  abortSignal?: AbortSignal;
}

const PROBLEM_AGENT_SYSTEM_PROMPT = `You are an expert at framing policy debate problems. Given a conversation (as a transcript), extract or formulate a well-defined debate problem and fill in the following fields. Respond ONLY with valid JSON matching the schema.

Field definitions:

- **policy_question**: The central question or proposition to be debated. Single, clear, debatable statement; affirmative and negative positions must be possible.

- **scope**: What the policy applies to—geographic, sectoral, and/or population boundaries.

- **time_horizon**: Period for evaluation/implementation (e.g. short/medium/long term or concrete years).

- **jurisdiction**: Level of government (e.g. U.S. federal, EU, State of California).

- **constraints**: Limits, assumptions, or boundary conditions; or "None specified" if absent.`;

const CHATBOT_SYSTEM_PROMPT = `You are a friendly assistant helping users define a policy debate problem. Your goal is to gather enough information so a debate problem can be created.

**Target problem shape (concise):** We need: a clear policy question (debatable yes/no), scope (what/where it applies), time horizon (when), jurisdiction (which government level), and any constraints. Until we have enough of these, keep the conversation going.

**Your behavior:**
- Decide from the chat history whether there is NOW enough information to create a full problem (policy_question, scope, time_horizon, jurisdiction, constraints). Set can_generate_problem to "yes" only when we have enough; otherwise set it to "no".
- If information is missing, keep asking one or two short, focused questions. Do not lecture; ask and suggest.
- If the user is unsure or not very knowledgeable about politics, proactively suggest concrete ideas (e.g. "We could focus on healthcare, climate, or taxes—any of those interest you?" or "For jurisdiction, we could do U.S. federal, or a specific state—what fits your goal?").
- Once we have enough information, say so in your message and set can_generate_problem to "yes". Your message can briefly summarize what we have and confirm we're ready to generate the problem.`;

/**
 * Formats a list of chat messages into a single transcript string.
 */
function formatMessagesAsTranscript(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.sender}: ${m.message}`).join('\n');
}

/**
 * Generates a structured Problem from a list of chat messages using the Vercel AI SDK.
 * Messages are concatenated into a single transcript; the model extracts or formulates
 * a debate problem from the conversation.
 *
 * @param messages - List of messages with sender and message fields (e.g. from a chat UI).
 * @returns A Promise resolving to a Problem object.
 */
export async function generate_problem(
  messages: ChatMessage[],
  options?: StreamedGenerationOptions,
): Promise<Problem> {
  const transcript = formatMessagesAsTranscript(messages);

  const result = await generateText({
    model: openai('gpt-4o'),
    system: PROBLEM_AGENT_SYSTEM_PROMPT,
    prompt: transcript,
    output: Output.object({
      schema: problemSchema,
      name: 'Problem',
      description:
        'A structured policy debate problem with question, scope, time horizon, jurisdiction, and constraints.',
    }),
    abortSignal: options?.abortSignal,
  });
  const output = result.output;

  return problemSchema.parse(output);
}

/**
 * Chatbot that determines whether the conversation has enough information to create a problem.
 * Uses the same message list format; concatenates messages into one transcript for context.
 * Instructed to keep asking questions until can_generate_problem is "yes", and to propose
 * ideas when the user is not very knowledgeable about politics.
 *
 * @param messages - List of dictionaries with sender and message fields.
 * @returns A Promise resolving to ConversationResponse (message and can_generate_problem).
 */
export async function generate_chatbot_response(
  messages: ChatMessage[],
  options?: StreamedGenerationOptions,
): Promise<ConversationResponse> {
  const callbacks = options?.callbacks;
  const messageId = options?.messageId ?? crypto.randomUUID();
  const transcript =
    messages.length > 0 ? formatMessagesAsTranscript(messages) : '(No messages yet)';

  const result = await generateText({
    model: openai('gpt-4o'),
    system: CHATBOT_SYSTEM_PROMPT,
    prompt: transcript,
    output: Output.object({
      schema: conversationResponseSchema,
      name: 'ConversationResponse',
      description:
        'Assistant message and whether there is enough information to generate a problem (yes/no).',
    }),
    abortSignal: options?.abortSignal,
  });
  const output = result.output;
  const parsed = conversationResponseSchema.parse(output);

  callbacks?.onModelOutput?.({
    kind: 'chat_response',
    title: 'Assistant',
    content: parsed.message,
    messageId,
  });
  return parsed;
}
