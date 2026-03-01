import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type Problem } from './problem_agent';

/**
 * Generates a list of cross-examination questions for an opposing thesis.
 *
 * @param problem - The shared debate problem.
 * @param politicalIdeology - The generating agent's political ideology/views.
 * @param opposingThesis - The opposing agent's thesis object.
 * @param n - Number of questions to generate.
 * @returns A list of n questions.
 */
export async function generate_questions(
  problem: Problem,
  politicalIdeology: string,
  opposingThesis: unknown,
  n: number,
): Promise<string[]> {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('n must be a positive integer.');
  }

  const questionListSchema = z.object({
    questions: z.array(z.string().min(1)).length(n),
  });

  const result = await generateText({
    model: openai('gpt-4o'),
    system: `You are a policy debate strategist. Generate sharp, fair, specific cross-examination questions for an opposing thesis.

Rules:
- Return exactly ${n} questions.
- Questions should challenge assumptions, evidence quality, feasibility, trade-offs, and risks.
- Questions must be grounded in the provided problem and opposing thesis.
- Keep each question concise and clear.
- Output must be valid JSON matching the schema.`,
    prompt: `Problem:
${JSON.stringify(problem, null, 2)}

Generating agent ideology:
${politicalIdeology}

Opposing thesis:
${JSON.stringify(opposingThesis, null, 2)}
`,
    output: Output.object({
      schema: questionListSchema,
      name: 'QuestionList',
      description: `A list of exactly ${n} cross-examination questions.`,
    }),
  });

  if (result.output == null) {
    throw new Error('Model did not return a valid question list.');
  }

  return result.output.questions;
}
