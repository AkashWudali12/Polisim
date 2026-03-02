import { generateText, NoOutputGeneratedError, Output, tool, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { Problem } from './problem_agent';
import type { RunCallbacks } from '@/lib/run-events';

interface Evidence {
    source: string;
    quote: string;
    reasoning: string;
}

interface PolicyThesis {
    thesis: string;
    evidence: Evidence[];
    cost_estimate: string;
    weaknesses: string;
    risk_scenarios: string;
}

interface ResearchResponse {
    message: string | Evidence;
    thesis_field: number;
}

const THESIS_FIELD_NAMES: Record<number, string> = {
    1: 'thesis',
    2: 'evidence',
    3: 'cost_estimate',
    4: 'weaknesses',
    5: 'risk_scenarios',
};

function logResearchToolCall(toolName: string, args: unknown): void {
    console.log('\n--- Research Tool Call ---');
    console.log(`tool: ${toolName}`);
    console.log('args:');
    console.log(JSON.stringify(args ?? {}, null, 2));
    console.log('--------------------------\n');
}

function logThesisUpdate(part: string, update: string | Evidence): void {
    console.log('\n--- Thesis Update ---');
    console.log(`part: ${part}`);
    console.log('update:');
    if (typeof update === 'string') {
        console.log(update);
    } else {
        console.log(JSON.stringify(update, null, 2));
    }
    console.log('---------------------\n');
}

function mapResearchToolToActivity(toolName: string): string {
    switch (toolName) {
        case 'webSearch':
        case 'extractUrl':
            return 'Consulting sources';
        case 'getAvailableContext':
        case 'getContext':
            return 'Reviewing context';
        case 'getThesisField':
            return 'Checking thesis progress';
        case 'getSearchedLinks':
            return 'Checking prior source coverage';
        default:
            return 'Using tools';
    }
}

const thesis: PolicyThesis = {
    thesis: '',
    evidence: [],
    cost_estimate: '',
    weaknesses: '',
    risk_scenarios: '',
};

const researchResponseSchema = z.object({
    message: z.string().or(z.object({
        source: z.string(),
        quote: z.string(),
        reasoning: z.string(),
    })),
    thesis_field: z.number(),
});

const contextCache = new Map<string, [string, string]>();
const searchedQueryCache = new Set<string>();
const searchedLinkCache = new Set<string>();
const TAVILY_API_URL = 'https://api.tavily.com';

export function resetResearchState(): void {
    thesis.thesis = '';
    thesis.evidence = [];
    thesis.cost_estimate = '';
    thesis.weaknesses = '';
    thesis.risk_scenarios = '';
    contextCache.clear();
    searchedQueryCache.clear();
    searchedLinkCache.clear();
}

function normalizeQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url.trim());
        parsed.hash = '';
        let normalized = parsed.toString();
        if (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
        return normalized.toLowerCase();
    } catch {
        return url.trim().toLowerCase();
    }
}

const getAvailableContext = tool({
    description: 'Get the available context',
    inputSchema: z.object({}),
    execute: async () => {
        let availableContext = '';
        for (const [key, value] of contextCache.entries()) {
            const contextDescription = value[0];
            availableContext += `Lookup ID: ${key}\nDescription: ${contextDescription}\n`;
        }
        return availableContext;
    },
});

const getContext = tool({
    description: 'Get the context for a given lookup ID',
    inputSchema: z.object({
        lookup_id: z.string(),
    }),
    execute: async ({ lookup_id }) => {
        return contextCache.get(lookup_id)?.[1] ?? 'Context not found';
    },
});

const getThesisField = tool({
    description: 'Get the current version of a part of the thesis you are working on. The input can be 1 of 5 strings: "thesis", "evidence", "cost_estimate", "weaknesses", "risk_scenarios".',
    inputSchema: z.object({
        field: z.enum(['thesis', 'evidence', 'cost_estimate', 'weaknesses', 'risk_scenarios']),
    }),
    execute: async ({ field }) => {
        switch (field) {
            case 'thesis':
                return thesis.thesis;
            case 'evidence':
                return thesis.evidence;
            case 'cost_estimate':
                return thesis.cost_estimate;
            case 'weaknesses':
                return thesis.weaknesses;
            case 'risk_scenarios':
                return thesis.risk_scenarios;
            default:
                throw new Error('Invalid thesis field.');
        }
    },
});

const getSearchedLinks = tool({
    description: 'Get all cached queries and links that were already searched.',
    inputSchema: z.object({}),
    execute: async () => {
        return {
            queries: Array.from(searchedQueryCache.values()),
            links: Array.from(searchedLinkCache.values()),
        };
    },
});

async function addToolOutputToContext(
    toolName: string,
    input: unknown,
    output: unknown,
): Promise<string> {
    const payload = `TOOL CALL RESULT
Tool: ${toolName}
Input:
${JSON.stringify(input, null, 2)}

Output:
${JSON.stringify(output, null, 2)}`;
    return add_message_to_context(payload);
}

const webSearch = tool({
    description: 'Search the web for current information using Tavily. Returns structured results.',
    inputSchema: z.object({
        query: z.string().min(1).max(300),
        max_results: z.number().int().min(1).max(10).optional(),
    }),
    execute: async ({ query, max_results = 5 }) => {
        const normalizedQuery = normalizeQuery(query);
        if (searchedQueryCache.has(normalizedQuery)) {
            const duplicateOutput = {
                query,
                skipped: true,
                reason: 'Query already searched; skipping duplicate web search.',
                results: [],
            };
            await addToolOutputToContext('web_search', { query, max_results }, duplicateOutput);
            return duplicateOutput;
        }

        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            throw new Error('TAVILY_API_KEY is not set.');
        }

        const response = await fetch(`${TAVILY_API_URL}/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results,
                search_depth: 'advanced',
                include_raw_content: false,
                include_images: false,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Tavily search failed (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as {
            results?: Array<{
                title?: string;
                url?: string;
                content?: string;
                score?: number;
            }>;
        };

        searchedQueryCache.add(normalizedQuery);

        const allResults = (data.results ?? []).map((result) => ({
            title: result.title ?? '',
            url: result.url ?? '',
            content: result.content ?? '',
            score: result.score ?? 0,
        }));

        const freshResults = allResults.filter((result) => {
            const normalizedResultUrl = normalizeUrl(result.url);
            if (!normalizedResultUrl) return false;
            return !searchedLinkCache.has(normalizedResultUrl);
        });

        for (const result of freshResults) {
            const normalizedResultUrl = normalizeUrl(result.url);
            if (normalizedResultUrl) {
                searchedLinkCache.add(normalizedResultUrl);
            }
        }

        const output = {
            query,
            skipped: false,
            filtered_cached_links: allResults.length - freshResults.length,
            results: freshResults,
        };

        await addToolOutputToContext('web_search', { query, max_results }, output);
        return output;
    },
});

const extractUrl = tool({
    description: 'Extract readable content from a specific URL using Tavily. Returns extracted text content.',
    inputSchema: z.object({
        url: z.string().url(),
    }),
    execute: async ({ url }) => {
        const normalizedUrl = normalizeUrl(url);
        if (searchedLinkCache.has(normalizedUrl)) {
            const duplicateMessage = `URL already searched. Skipping duplicate extraction for: ${url}`;
            await addToolOutputToContext('extract_url', { url }, duplicateMessage);
            return duplicateMessage;
        }

        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            throw new Error('TAVILY_API_KEY is not set.');
        }

        const response = await fetch(`${TAVILY_API_URL}/extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: apiKey,
                urls: [url],
                include_images: false,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Tavily extract failed (${response.status}): ${errorBody}`);
        }

        const data = (await response.json()) as {
            results?: Array<{
                raw_content?: string;
                content?: string;
            }>;
        };

        const extracted = data.results?.[0]?.raw_content ?? data.results?.[0]?.content ?? '';
        searchedLinkCache.add(normalizedUrl);
        await addToolOutputToContext('extract_url', { url }, extracted);
        return extracted;
    },
});

const getSystemPrompt = (political_views: string, problem: Problem) => {
    return `
You are an autonomous policy research agent executing a long-running task.

You are NOT a chat assistant and you are NOT in a conversation with a human user.
Do not ask the user questions or request guidance.
If information is missing, use your tools to retrieve it.
Only request human input if you are completely blocked and cannot proceed.

Your objective is to develop, refine, and complete a Policy Thesis proposing a solution to the given Problem, consistent with the specified Political Views.

You have access to tools that allow you to:
- Retrieve prior context and work
- Understand the current state of the thesis
- Continue improving or expanding the thesis
- Search the web and extract content from URLs

You must continuously:
1. Retrieve relevant prior context before acting.
2. Assess the current state of the thesis.
3. Identify the highest-leverage next step.
4. Use tools to gather evidence or context as needed.
5. Update and refine the thesis until it satisfies the Problem constraints.

Never assume you have full context without checking.
Before producing any final thesis output, use:
- get_available_context to see prior work
- get_context to retrieve relevant context by ID
- web_search to find current sources
- extract_url to read relevant page content
- get_searched_links to avoid duplicate queries/links

If prior thesis drafts or research exist, build upon them instead of restarting.

CRITICAL PROCESS REQUIREMENTS:
- At the start of each step, check thesis status using get_thesis_field.
- Always check at least one thesis field every step. Across steps, ensure all fields are regularly checked: thesis, evidence, cost_estimate, weaknesses, risk_scenarios.
- Before editing a field, check its latest value with get_thesis_field.
- After any tool calls and reasoning, you MUST end the step by returning a valid ResearchResponse JSON object.
- Never end a step without returning a thesis update payload.

CRITICAL OUTPUT REQUIREMENTS (every step):
- Always return a non-empty 'message' plus a valid 'thesis_field'.
- 'thesis_field' must be one of: 1,2,3,4,5 (or -1 only when truly complete).
- If 'thesis_field' is 1,3,4,5 -> 'message' must be a string update for that field.
- If 'thesis_field' is 2 -> 'message' must be an Evidence object with source, quote, reasoning.
- Do not return null, empty, or malformed output.

NOTE ABOUT COMPLETING THE THESIS:
- Once you see that all the fields are complete, you should either make small finishing touches to the thesis, or you must return a ResearchResponse object with thesis_field -1.

Your output should reflect progress toward completion, not a conversational response.

---

### Political Views:
${political_views}

---

### Problem Definition:

Policy Question: ${problem.policy_question}
Scope: ${problem.scope}
Time Horizon: ${problem.time_horizon}
Jurisdiction: ${problem.jurisdiction}
Constraints: ${problem.constraints}

---

Operate autonomously until the thesis is complete or you are blocked.
`;
}

const SUMMARIZE_MAX_TOKENS_DEFAULT = 100;

/**
 * Summarizes a message via LLM, keeping the summary under a given token limit.
 * @param message - Text to summarize.
 * @param maxTokens - Maximum output tokens for the summary (default 100).
 * @returns The summarized text.
 */
async function summarize_message(
    message: string,
    maxTokens: number = SUMMARIZE_MAX_TOKENS_DEFAULT,
): Promise<string> {
    if (!message.trim()) return message;

    const { text } = await generateText({
        model: openai('gpt-4o'),
        system: `Summarize the following text concisely. Preserve key facts and meaning. Use at most ${maxTokens} tokens. Output only the summary, no preamble.`,
        prompt: message,
        maxOutputTokens: maxTokens,
    });

    return text.trim() || message;
}

const add_message_to_context = async (message: string) => {
    const uuid = crypto.randomUUID();
    const summary = await summarize_message(message);
    contextCache.set(uuid as string, [summary, message]);
    // console.log('\n[context] Added entry');
    // console.log(`[context] id: ${uuid}`);
    // console.log(`[context] summary: ${summary}\n`);
    return uuid;
}

/**
 * Returns a snapshot of the current thesis, then clears thesis state and context cache.
 */
function cleanUp(): PolicyThesis {
    const thesisCopy: PolicyThesis = {
        thesis: thesis.thesis,
        evidence: thesis.evidence.map((item) => ({ ...item })),
        cost_estimate: thesis.cost_estimate,
        weaknesses: thesis.weaknesses,
        risk_scenarios: thesis.risk_scenarios,
    };
    resetResearchState();

    return thesisCopy;
}

function thesisStatusPromptBlock(currentThesis: PolicyThesis): string {
    const thesisDone = currentThesis.thesis.trim().length > 0;
    const evidenceCount = currentThesis.evidence.length;
    const evidenceDone = evidenceCount >= 5;
    const costEstimateDone = currentThesis.cost_estimate.trim().length > 0;
    const weaknessesDone = currentThesis.weaknesses.trim().length > 0;
    const riskScenariosDone = currentThesis.risk_scenarios.trim().length > 0;

    return `CURRENT THESIS FIELD STATUS:
- thesis: ${thesisDone ? 'done' : 'not done'}
- evidence: ${evidenceDone ? 'done' : 'not done'} (${evidenceCount}/5)
- cost_estimate: ${costEstimateDone ? 'done' : 'not done'}
- weaknesses: ${weaknessesDone ? 'done' : 'not done'}
- risk_scenarios: ${riskScenariosDone ? 'done' : 'not done'}`;
}

interface GenerateThesisOptions {
    callbacks?: RunCallbacks;
    abortSignal?: AbortSignal;
}

export async function generateThesis(
    political_views: string,
    problem: Problem,
    options?: GenerateThesisOptions,
) {
    const systemPrompt = getSystemPrompt(political_views, problem);
    const callbacks = options?.callbacks;

    const outputDescription =
        'JSON with message (string or Evidence: source, quote, reasoning) and thesis_field: -1 when done, or 1–5 for thesis, evidence, cost_estimate, weaknesses, risk_scenarios.';

    const maxConsecutiveNoOutput = 3;
    let consecutiveNoOutput = 0;

    while (true) {
        callbacks?.onActivity?.({ kind: 'thinking', message: 'Analyzing next thesis update' });
        const statusBlock = thesisStatusPromptBlock(thesis);
        const messageId = crypto.randomUUID();
        let output: unknown = null;
        try {
            const response = await generateText({
                model: openai('gpt-5.2'),
                system: systemPrompt,
                prompt:
                    `Work on your thesis autonomously.

${statusBlock}

Rules:
- First check thesis status using get_thesis_field.
- Prioritize fields marked "not done".
- A string field is "done" only if it has non-empty text.
- Evidence is "done" only when there are at least 5 evidence items.
- You MUST finish this step by returning a valid ResearchResponse object with thesis_field and non-empty message (string for fields 1/3/4/5, Evidence object for field 2).
- Return -1 only when all thesis fields are complete.`,
                output: Output.object({
                    schema: researchResponseSchema,
                    name: 'ResearchResponse',
                    description: outputDescription,
                }),
                tools: {
                    getAvailableContext,
                    getContext,
                    getThesisField,
                    getSearchedLinks,
                    webSearch,
                    extractUrl,
                },
                experimental_onToolCallStart: ({ toolCall }) => {
                    const activityMessage = mapResearchToolToActivity(toolCall.toolName);
                    callbacks?.onActivity?.({ kind: 'tool_activity', message: activityMessage });
                    if (callbacks == null) {
                        logResearchToolCall(toolCall.toolName, toolCall.input ?? {});
                    }
                },
                stopWhen: stepCountIs(10),
                abortSignal: options?.abortSignal,
            });
            output = response.output;
        } catch (err) {
            if (NoOutputGeneratedError.isInstance(err)) {
                consecutiveNoOutput += 1;
                callbacks?.onActivity?.({
                    kind: 'thinking',
                    message: `No structured output this step (${consecutiveNoOutput}/${maxConsecutiveNoOutput}), retrying.`,
                });
                if (consecutiveNoOutput >= maxConsecutiveNoOutput) {
                    const hasAnyContent =
                        thesis.thesis.trim().length > 0 ||
                        thesis.evidence.length > 0 ||
                        thesis.cost_estimate.trim().length > 0 ||
                        thesis.weaknesses.trim().length > 0 ||
                        thesis.risk_scenarios.trim().length > 0;
                    if (hasAnyContent) {
                        callbacks?.onActivity?.({ kind: 'thinking', message: 'Using current thesis as fallback after repeated no-output steps.' });
                        return cleanUp();
                    }
                    throw err;
                }
                continue;
            }
            throw err;
        }
        consecutiveNoOutput = 0;

        if (output == null) {
            continue;
        }

        const researchResponse = output as ResearchResponse;

        if (researchResponse.thesis_field === -1) {
            callbacks?.onActivity?.({ kind: 'thinking', message: 'Thesis generation complete' });
            if (callbacks == null) {
                console.log('Thesis complete');
            }
            return cleanUp();
        }

        if (researchResponse.thesis_field < 1 || researchResponse.thesis_field > 5) {
            continue;
        }

        switch (researchResponse.thesis_field) {
            case 1:
                thesis.thesis = researchResponse.message as string;
                callbacks?.onModelOutput?.({
                    kind: 'thesis',
                    title: 'Thesis Update',
                    content: { part: THESIS_FIELD_NAMES[1], update: researchResponse.message },
                    messageId,
                });
                if (callbacks == null) {
                    logThesisUpdate(THESIS_FIELD_NAMES[1], researchResponse.message);
                }
                break;
            case 2: 
                const payload = researchResponse.message as Evidence;
                thesis.evidence.push(payload);
                await add_message_to_context(JSON.stringify(payload));
                callbacks?.onModelOutput?.({
                    kind: 'thesis',
                    title: 'Thesis Update',
                    content: { part: THESIS_FIELD_NAMES[2], update: payload },
                    messageId,
                });
                if (callbacks == null) {
                    logThesisUpdate(THESIS_FIELD_NAMES[2], payload);
                }
                break;
            case 3:
                thesis.cost_estimate = researchResponse.message as string;
                callbacks?.onModelOutput?.({
                    kind: 'thesis',
                    title: 'Thesis Update',
                    content: { part: THESIS_FIELD_NAMES[3], update: researchResponse.message },
                    messageId,
                });
                if (callbacks == null) {
                    logThesisUpdate(THESIS_FIELD_NAMES[3], researchResponse.message);
                }
                break;
            case 4:
                thesis.weaknesses = researchResponse.message as string;
                callbacks?.onModelOutput?.({
                    kind: 'thesis',
                    title: 'Thesis Update',
                    content: { part: THESIS_FIELD_NAMES[4], update: researchResponse.message },
                    messageId,
                });
                if (callbacks == null) {
                    logThesisUpdate(THESIS_FIELD_NAMES[4], researchResponse.message);
                }
                break;
            case 5:
                thesis.risk_scenarios = researchResponse.message as string;
                callbacks?.onModelOutput?.({
                    kind: 'thesis',
                    title: 'Thesis Update',
                    content: { part: THESIS_FIELD_NAMES[5], update: researchResponse.message },
                    messageId,
                });
                if (callbacks == null) {
                    logThesisUpdate(THESIS_FIELD_NAMES[5], researchResponse.message);
                }
                break;
            default:
                throw new Error('Invalid thesis field.');
        }
    }
}