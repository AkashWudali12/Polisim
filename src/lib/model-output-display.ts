import type { ModelOutputEvent, ModelOutputKind } from '@/lib/run-events';

export interface DisplayKeyValue {
  label: string;
  value: string;
}

export type DisplayBlock =
  | {
      type: 'markdown';
      title?: string;
      markdown: string;
    }
  | {
      type: 'list';
      title: string;
      items: string[];
    }
  | {
      type: 'key_value';
      title: string;
      entries: DisplayKeyValue[];
    };

export interface StructuredDisplayContent {
  blocks: DisplayBlock[];
  rawJson?: string;
}

function placeholderForKind(kind: ModelOutputKind, title: string): StructuredDisplayContent {
  switch (kind) {
    case 'problem':
      return {
        blocks: [
          {
            type: 'markdown',
            title,
            markdown: 'Building structured problem fields...',
          },
        ],
      };
    case 'thesis':
      return {
        blocks: [
          {
            type: 'markdown',
            title,
            markdown: 'Building thesis update...',
          },
        ],
      };
    case 'questions':
      return {
        blocks: [
          {
            type: 'markdown',
            title,
            markdown: 'Generating cross-examination questions...',
          },
        ],
      };
    case 'debate_turn':
      return {
        blocks: [{ type: 'markdown', title, markdown: 'Generating debate turn...' }],
      };
    case 'debate_result':
      return {
        blocks: [{ type: 'markdown', title, markdown: 'Preparing debate resolution...' }],
      };
    default:
      return {
        blocks: [{ type: 'markdown', title, markdown: 'Generating response...' }],
      };
  }
}

function tryParseJsonBuffer(buffer: string): unknown | null {
  const trimmed = buffer.trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function decodeJsonStringFragment(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function extractJsonStringField(buffer: string, field: string): string | null {
  const start = buffer.search(new RegExp(`"${field}"\\s*:\\s*"`));
  if (start < 0) return null;
  const afterField = buffer.slice(start).replace(new RegExp(`^.*?"${field}"\\s*:\\s*"`), '');
  if (!afterField) return null;

  let escaped = false;
  let result = '';
  for (let i = 0; i < afterField.length; i += 1) {
    const char = afterField[i];
    if (escaped) {
      result += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return decodeJsonStringFragment(result);
    }
    result += char;
  }
  return decodeJsonStringFragment(result);
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => toText(entry)).filter((entry) => entry.trim().length > 0);
}

interface EvidenceEntry {
  source: string;
  quote: string;
  reasoning: string;
}

interface CrossfireQAPair {
  question: string;
  answer: string;
}

function asEvidenceArray(value: unknown): EvidenceEntry[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      if (!('source' in record) || !('quote' in record) || !('reasoning' in record)) return null;
      return {
        source: toText(record.source),
        quote: toText(record.quote),
        reasoning: toText(record.reasoning),
      };
    })
    .filter((entry): entry is EvidenceEntry => entry != null);
  return parsed.length === value.length ? parsed : null;
}

function asCrossfirePairArray(value: unknown): CrossfireQAPair[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      if (!('question' in record) || !('answer' in record)) return null;
      return {
        question: toText(record.question),
        answer: toText(record.answer),
      };
    })
    .filter((entry): entry is CrossfireQAPair => entry != null);
  return parsed.length === value.length ? parsed : null;
}

function toCrossfireMarkdown(pairs: CrossfireQAPair[]): string {
  return pairs
    .map(
      (pair, index) =>
        `**Q${index + 1}:** ${pair.question.trim() || 'N/A'}\n\n**A${index + 1}:** ${pair.answer.trim() || 'N/A'}`,
    )
    .join('\n\n---\n\n');
}

function toRawJson(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return undefined;
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return undefined;
}

function normalizeProblem(content: unknown): StructuredDisplayContent | null {
  const data = asRecord(content);
  if (!data) return null;

  const keys = ['policy_question', 'scope', 'time_horizon', 'jurisdiction', 'constraints'];
  const hasProblemShape = keys.every((key) => key in data);
  if (!hasProblemShape) return null;

  return {
    blocks: [
      {
        type: 'key_value',
        title: 'Debate Problem',
        entries: [
          { label: 'Policy Question', value: toText(data.policy_question) },
          { label: 'Scope', value: toText(data.scope) },
          { label: 'Time Horizon', value: toText(data.time_horizon) },
          { label: 'Jurisdiction', value: toText(data.jurisdiction) },
          { label: 'Constraints', value: toText(data.constraints) },
        ],
      },
    ],
    rawJson: toRawJson(content),
  };
}

function normalizeThesis(content: unknown): StructuredDisplayContent | null {
  const data = asRecord(content);
  if (!data) return null;

  if ('part' in data && 'update' in data) {
    const part = toText(data.part).replace(/_/g, ' ');
    const update = data.update;
    const updateRecord = asRecord(update);
    if (
      updateRecord &&
      'source' in updateRecord &&
      'quote' in updateRecord &&
      'reasoning' in updateRecord
    ) {
      return {
        blocks: [
          {
            type: 'key_value',
            title: `Thesis Update: ${part}`,
            entries: [
              { label: 'Source', value: toText(updateRecord.source) },
              { label: 'Quote', value: toText(updateRecord.quote) },
              { label: 'Reasoning', value: toText(updateRecord.reasoning) },
            ],
          },
        ],
        rawJson: toRawJson(content),
      };
    }

    return {
      blocks: [
        {
          type: 'markdown',
          title: `Thesis Update: ${part}`,
          markdown: toText(update),
        },
      ],
      rawJson: toRawJson(content),
    };
  }

  const evidenceEntries = asEvidenceArray(data.evidence);
  const evidenceList = asStringArray(data.evidence);
  const evidenceBlocks =
    evidenceEntries && evidenceEntries.length > 0
      ? evidenceEntries.map(
          (entry, index): DisplayBlock => ({
            type: 'key_value',
            title: `Evidence ${index + 1}`,
            entries: [
              { label: 'Source', value: entry.source },
              { label: 'Quote', value: entry.quote },
              { label: 'Reasoning', value: entry.reasoning },
            ],
          }),
        )
      : evidenceList && evidenceList.length > 0
        ? [{ type: 'list' as const, title: 'Evidence', items: evidenceList }]
        : [];

  return {
    blocks: [
      {
        type: 'key_value',
        title: 'Thesis Summary',
        entries: [
          { label: 'Thesis', value: toText(data.thesis) },
          { label: 'Cost Estimate', value: toText(data.cost_estimate) },
          { label: 'Weaknesses', value: toText(data.weaknesses) },
          { label: 'Risk Scenarios', value: toText(data.risk_scenarios) },
        ],
      },
      ...evidenceBlocks,
    ],
    rawJson: toRawJson(content),
  };
}

function normalizeQuestions(content: unknown): StructuredDisplayContent | null {
  const questions = asStringArray(content);
  if (!questions) return null;
  return {
    blocks: [{ type: 'list', title: 'Cross-Examination Questions', items: questions }],
    rawJson: toRawJson(content),
  };
}

function normalizeDebateResult(content: unknown): StructuredDisplayContent | null {
  const data = asRecord(content);
  if (!data) return null;

  // A full debate payload may include transcript/crossfire. We intentionally keep
  // only a concise resolution summary to avoid replaying the entire debate history.
  const resolution = asRecord('resolution' in data ? data.resolution : content);
  if (!resolution) return null;

  const resolvedValue = resolution.resolved;
  const isResolved =
    typeof resolvedValue === 'boolean'
      ? resolvedValue
      : toText(resolvedValue).toLowerCase() === 'true';
  const entries: DisplayKeyValue[] = [
    { label: 'Resolved', value: isResolved ? 'Yes' : 'No' },
    { label: 'Stop Reason', value: toText(resolution.stopReason ?? resolution.stop_reason) },
  ];
  const acceptedBy = toText(resolution.acceptedBy ?? resolution.accepted_by);
  if (acceptedBy.trim().length > 0) {
    entries.push({ label: 'Accepted By', value: acceptedBy });
  }

  const blocks: DisplayBlock[] = [{ type: 'key_value', title: 'Debate Resolution', entries }];
  const solutionText = toText(resolution.solutionText ?? resolution.solution_text);
  if (solutionText.trim().length > 0) {
    blocks.push({ type: 'markdown', title: 'Proposed Solution', markdown: solutionText });
  }

  const crossfireRecord = asRecord(data.crossfire);
  const firstAgentPairs = asCrossfirePairArray(crossfireRecord?.firstAgentCrossfire);
  const secondAgentPairs = asCrossfirePairArray(crossfireRecord?.secondAgentCrossfire);
  if (firstAgentPairs && firstAgentPairs.length > 0) {
    blocks.push({
      type: 'markdown',
      title: 'Crossfire Q&A (First asked, Second answered)',
      markdown: toCrossfireMarkdown(firstAgentPairs),
    });
  }
  if (secondAgentPairs && secondAgentPairs.length > 0) {
    blocks.push({
      type: 'markdown',
      title: 'Crossfire Q&A (Second asked, First answered)',
      markdown: toCrossfireMarkdown(secondAgentPairs),
    });
  }

  return {
    blocks,
    rawJson: toRawJson(content),
  };
}

function normalizeDebateTurn(content: unknown): StructuredDisplayContent | null {
  const data = asRecord(content);
  if (!data) return null;

  if ('question' in data && 'answer' in data) {
    return {
      blocks: [
        {
          type: 'key_value',
          title: 'Crossfire Q&A Pair',
          entries: [
            { label: 'Question', value: toText(data.question) },
            { label: 'Answer', value: toText(data.answer) },
          ],
        },
      ],
      rawJson: toRawJson(content),
    };
  }

  if ('speaker' in data && 'kind' in data && 'content' in data) {
    return {
      blocks: [
        {
          type: 'key_value',
          title: 'Debate Turn',
          entries: [
            { label: 'Speaker', value: toText(data.speaker) },
            { label: 'Turn Type', value: toText(data.kind).replace(/_/g, ' ') },
            { label: 'Message', value: toText(data.content) },
          ],
        },
      ],
      rawJson: toRawJson(content),
    };
  }

  return null;
}

export function normalizeModelOutputForDisplay(event: ModelOutputEvent): StructuredDisplayContent {
  if (typeof event.content === 'string') {
    return { blocks: [{ type: 'markdown', markdown: event.content }] };
  }

  if (event.kind === 'problem') {
    const normalized = normalizeProblem(event.content);
    if (normalized) return normalized;
  }

  if (event.kind === 'thesis') {
    const normalized = normalizeThesis(event.content);
    if (normalized) return normalized;
  }

  if (event.kind === 'questions') {
    const normalized = normalizeQuestions(event.content);
    if (normalized) return normalized;
  }

  if (event.kind === 'debate_turn') {
    const normalized = normalizeDebateTurn(event.content);
    if (normalized) return normalized;
  }

  if (event.kind === 'debate_result') {
    const normalized = normalizeDebateResult(event.content);
    if (normalized) return normalized;
  }

  if (Array.isArray(event.content)) {
    return {
      blocks: [{ type: 'list', title: event.title, items: event.content.map((entry) => toText(entry)) }],
      rawJson: toRawJson(event.content),
    };
  }

  if (event.content != null && typeof event.content === 'object') {
    return {
      blocks: [
        {
          type: 'markdown',
          title: event.title,
          markdown: 'Structured output available.',
        },
      ],
      rawJson: toRawJson(event.content),
    };
  }

  return {
    blocks: [{ type: 'markdown', markdown: event.title }],
  };
}

export function normalizeStreamingBufferForDisplay(
  kind: ModelOutputKind,
  title: string,
  rawBuffer: string,
): StructuredDisplayContent {
  const parsed = tryParseJsonBuffer(rawBuffer);
  if (parsed == null) {
    if (kind === 'thesis') {
      const partialMessage = extractJsonStringField(rawBuffer, 'message');
      if (partialMessage && partialMessage.trim().length > 0) {
        return {
          blocks: [
            {
              type: 'markdown',
              title: 'Thesis Update',
              markdown: partialMessage,
            },
          ],
        };
      }
    }

    if (kind === 'problem') {
      const policyQuestion = extractJsonStringField(rawBuffer, 'policy_question');
      const scope = extractJsonStringField(rawBuffer, 'scope');
      const timeHorizon = extractJsonStringField(rawBuffer, 'time_horizon');
      const jurisdiction = extractJsonStringField(rawBuffer, 'jurisdiction');
      const constraints = extractJsonStringField(rawBuffer, 'constraints');
      const hasAny =
        !!policyQuestion?.trim() ||
        !!scope?.trim() ||
        !!timeHorizon?.trim() ||
        !!jurisdiction?.trim() ||
        !!constraints?.trim();
      if (hasAny) {
        return {
          blocks: [
            {
              type: 'key_value',
              title: 'Debate Problem',
              entries: [
                { label: 'Policy Question', value: policyQuestion ?? '' },
                { label: 'Scope', value: scope ?? '' },
                { label: 'Time Horizon', value: timeHorizon ?? '' },
                { label: 'Jurisdiction', value: jurisdiction ?? '' },
                { label: 'Constraints', value: constraints ?? '' },
              ],
            },
          ],
        };
      }
    }

    return placeholderForKind(kind, title);
  }

  return normalizeModelOutputForDisplay({
    type: 'model_output',
    kind,
    title,
    content: parsed,
    timestamp: Date.now(),
  });
}
