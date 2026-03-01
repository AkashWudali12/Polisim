'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="space-y-2 text-sm leading-7 text-[#6b2130] dark:text-[#6b2130]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          h1: ({ children }) => <h1 className="text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
          code: ({ children, className }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="rounded-md bg-[#f8f2e8] px-1 py-0.5 text-xs dark:bg-[#f8f2e8]">
                  {children}
                </code>
              );
            }
            return (
              <code className="block overflow-x-auto rounded-xl bg-[#f8f2e8] p-3 text-xs text-[#4d1b28] dark:bg-[#f8f2e8] dark:text-[#4d1b28]">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#b07b85] pl-3 italic dark:border-[#9e6674]">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[#8d2d43] underline underline-offset-2 dark:text-[#d58a9b]"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
