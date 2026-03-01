'use client';

import type { StructuredDisplayContent } from '@/lib/model-output-display';
import { MarkdownRenderer } from './MarkdownRenderer';

interface AssistantMessageBodyProps {
  content: StructuredDisplayContent;
}

export function AssistantMessageBody({ content }: AssistantMessageBodyProps) {
  return (
    <div className="space-y-3">
      {content.blocks.map((block, index) => {
        if (block.type === 'markdown') {
          return (
            <section key={`${block.type}-${index}`} className="space-y-1">
              {block.title ? (
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#6b2130] dark:text-[#6b2130]">
                  {block.title}
                </h4>
              ) : null}
              <MarkdownRenderer content={block.markdown} />
            </section>
          );
        }

        if (block.type === 'list') {
          return (
            <section key={`${block.type}-${index}`} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6b2130] dark:text-[#6b2130]">
                {block.title}
              </h4>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-6">
                {block.items.map((item, itemIndex) => (
                  <li key={`${itemIndex}-${item}`}>{item}</li>
                ))}
              </ol>
            </section>
          );
        }

        return (
          <section key={`${block.type}-${index}`} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[#6b2130] dark:text-[#6b2130]">
              {block.title}
            </h4>
            <dl className="space-y-2 text-sm leading-6">
              {block.entries.map((entry, entryIndex) => (
                <div
                  key={`${entryIndex}-${entry.label}`}
                  className="rounded-lg border border-[#b07b85]/35 bg-[#f8f2e8] p-2 dark:border-[#9e6674]/45 dark:bg-[#f8f2e8]"
                >
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#6b2130] dark:text-[#6b2130]">
                    {entry.label}
                  </dt>
                  <dd className="mt-1 text-[#6b2130] dark:text-[#6b2130]">
                    <MarkdownRenderer content={entry.value} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}

      {content.rawJson ? (
        <details className="rounded-lg border border-[#b07b85]/35 bg-[#f8f2e8] p-2 text-xs dark:border-[#9e6674]/45 dark:bg-[#f8f2e8]">
          <summary className="cursor-pointer font-medium text-[#6b2130] dark:text-[#6b2130]">
            Raw data
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[#f8f2e8] p-2 text-[#6b2130] dark:bg-[#f8f2e8] dark:text-[#6b2130]">
            {content.rawJson}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
