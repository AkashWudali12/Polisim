/**
 * CLI to test the problem-framing chatbot and problem generator.
 * Run with: npx tsx src/app/api/test_driver.ts
 * Ensure OPENAI_API_KEY is set (e.g. in .env.local).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { type ChatMessage } from './problem_agent';
import { runChatTurn, runDebateSequence } from './_core/debate_orchestrator';

function loadEnvLocal(): void {
  try {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match) {
          const key = match[1];
          const value = match[2].replace(/^["']|["']$/g, '').trim();
          if (!process.env[key]) process.env[key] = value;
        }
      }
    }
  } catch {
    // ignore
  }
}

function printJsonSection(title: string, data: unknown): void {
  console.log(`\n========== ${title} ==========`); 
  console.log(JSON.stringify(data, null, 2));
  console.log('================================\n');
}

async function main(): Promise<void> {
  loadEnvLocal();

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Set it in .env.local or the environment.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (answer) => resolve((answer ?? '').trim())));

  const messages: ChatMessage[] = [];

  console.log(
    'Policy debate problem helper. Ask anything; I’ll ask follow-ups until we have enough to define a problem. Type "exit" or "quit" to stop.\n',
  );

  while (true) {
    const userInput = await prompt('You: ');
    if (!userInput || userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
      console.log('Bye.');
      rl.close();
      process.exit(0);
    }

    messages.push({ sender: 'User', message: userInput });

    try {
      const { response } = await runChatTurn(messages);
      console.log(`\nAssistant: ${response.message}\n`);

      messages.push({ sender: 'Assistant', message: response.message });

      const canGenerate =
        response.can_generate_problem.toLowerCase() === 'yes' ||
        response.can_generate_problem.toLowerCase() === 'true';

      if (canGenerate) {
        console.log('Generating problem from conversation...\n');
        const firstAgentPoliticalViews = await prompt(
          "Enter the first agent's political views (e.g. ideology, priorities, constraints): ",
        );
        if (!firstAgentPoliticalViews.trim()) {
          console.log('No first agent political views entered. Skipping thesis generation.');
        } else {
          console.log('\nRunning full debate sequence...\n');
          try {
            const secondAgentPoliticalViews = await prompt(
              "Enter the second agent's political views: ",
            );
            if (!secondAgentPoliticalViews.trim()) {
              console.log('No second agent political views entered. Skipping second thesis generation.');
            } else {
              const runResult = await runDebateSequence(
                {
                  messages,
                  firstIdeology: firstAgentPoliticalViews.trim(),
                  secondIdeology: secondAgentPoliticalViews.trim(),
                },
                {
                  onStage: ({ message }) => console.log(`${message}...\n`),
                  onModelOutput: ({ title, content }) => printJsonSection(title, content),
                  onActivity: ({ message }) => console.log(`[activity] ${message}`),
                },
              );
              printJsonSection('Debate Loop Result', runResult.debateResult);
            }
          } catch (err) {
            console.error(
              'Thesis generation error:',
              err instanceof Error ? JSON.stringify(err, null, 2) : err,
            );
          }
        }

        const again = await prompt('Generate another problem from this chat? (y/n): ');
        if (again.toLowerCase() !== 'y' && again.toLowerCase() !== 'yes') {
          console.log('Bye.');
          rl.close();
          process.exit(0);
        }
      }
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
    }
  }
}

main();
