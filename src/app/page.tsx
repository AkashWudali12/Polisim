'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelOutputEvent, RunEvent, RunStage } from '@/lib/run-events';
import {
  normalizeModelOutputForDisplay,
  type StructuredDisplayContent,
} from '@/lib/model-output-display';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { AssistantMessageBody } from '@/components/AssistantMessageBody';

interface ChatMessage {
  sender: 'User' | 'Assistant';
  message: string;
}

interface ChatTurnResponse {
  message: string;
  can_generate_problem: string;
}

function isTruthyYes(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true';
}

type ThreadRole = 'user' | 'assistant' | 'system';

interface ThreadItem {
  id: string;
  role: ThreadRole;
  text: string;
  structuredContent?: StructuredDisplayContent;
  messageId?: string;
}

interface ActivityState {
  kind: 'thinking' | 'tool_activity';
  message: string;
}

function formatModelOutputForChat(event: ModelOutputEvent): string {
  if (typeof event.content === 'string') return event.content;

  if (Array.isArray(event.content)) {
    return event.content.map((entry, index) => `${index + 1}. ${String(entry)}`).join('\n');
  }

  if (event.content != null && typeof event.content === 'object') return event.title;

  return `${event.title}`;
}

function markdownOnlyContent(markdown: string): StructuredDisplayContent {
  return { blocks: [{ type: 'markdown', markdown }] };
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadItems, setThreadItems] = useState<ThreadItem[]>([
    {
      id: crypto.randomUUID(),
      role: 'system',
      text: 'Share your policy topic, and I will help frame the debate problem before running the full simulation.',
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [firstIdeology, setFirstIdeology] = useState('');
  const [secondIdeology, setSecondIdeology] = useState('');
  const [canGenerate, setCanGenerate] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [currentStage, setCurrentStage] = useState<RunStage | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const debateResultSeenRef = useRef(false);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (chatViewportRef.current) {
      chatViewportRef.current.scrollTop = chatViewportRef.current.scrollHeight;
    }
  }, [threadItems, chatLoading, activity]);

  const stageLabel = useMemo(() => {
    if (currentStage == null) return 'Idle';
    switch (currentStage) {
      case 'chatting':
        return 'Chatting';
      case 'problem_generation':
        return 'Generating Problem';
      case 'thesis_1':
        return 'First Thesis';
      case 'thesis_2':
        return 'Second Thesis';
      case 'questions':
        return 'Cross-Examination Questions';
      case 'debate':
        return 'Debate';
      case 'complete':
        return 'Complete';
      default:
        return 'Running';
    }
  }, [currentStage]);

  const appendThreadItem = (item: ThreadItem) => {
    setThreadItems((prev) => [...prev, item]);
  };

  const applyRunEvent = (event: RunEvent) => {
    if (event.type === 'run_stage') {
      setCurrentStage(event.stage);
      appendThreadItem({
        id: crypto.randomUUID(),
        role: 'system',
        text: event.message,
      });
      return;
    }

    if (event.type === 'model_output') {
      if (event.kind === 'debate_result' && debateResultSeenRef.current) {
        return;
      }
      if (event.kind === 'debate_result') {
        debateResultSeenRef.current = true;
      }

      const structured = normalizeModelOutputForDisplay(event);
      const formatted = formatModelOutputForChat(event);
      if (event.messageId) {
        setThreadItems((prev) => {
          const existing = prev.some((item) => item.messageId === event.messageId);
          if (existing) {
            return prev.map((item) =>
              item.messageId === event.messageId
                ? {
                    ...item,
                    text: item.text.trim().length > 0 ? item.text : formatted,
                    structuredContent: structured,
                  }
                : item,
            );
          }
          return [
            ...prev,
            {
              id: event.messageId ?? crypto.randomUUID(),
              role: 'assistant',
              text: formatted,
              structuredContent: structured,
              messageId: event.messageId,
            },
          ];
        });
      } else {
        appendThreadItem({
          id: crypto.randomUUID(),
          role: 'assistant',
          text: formatted,
          structuredContent: structured,
        });
      }
      setActivity(null);
      return;
    }

    if (event.type === 'agent_activity') {
      setActivity({ kind: event.kind, message: event.message });
      return;
    }

    if (event.type === 'run_error') {
      setErrorMessage(event.message);
      appendThreadItem({
        id: crypto.randomUUID(),
        role: 'system',
        text: `Run error: ${event.message}`,
      });
      setRunInProgress(false);
      setActivity(null);
      setCanGenerate(false);
      setMessages([]);
      return;
    }

    if (event.type === 'run_done') {
      appendThreadItem({
        id: crypto.randomUUID(),
        role: 'system',
        text: event.message,
      });
      setRunInProgress(false);
      setActivity(null);
      setCanGenerate(false);
      setMessages([]);
    }
  };

  const sendChatTurn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chatInput.trim() || chatLoading || runInProgress) return;

    setErrorMessage(null);
    setChatLoading(true);

    const updatedMessages: ChatMessage[] = [
      ...messages,
      { sender: 'User', message: chatInput.trim() },
    ];
    setMessages(updatedMessages);
    appendThreadItem({
      id: crypto.randomUUID(),
      role: 'user',
      text: chatInput.trim(),
    });
    setChatInput('');

    try {
      const response = await fetch('/api/chat/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to fetch chat turn');
      }

      const payload = (await response.json()) as ChatTurnResponse;
      const assistantMessage: ChatMessage = {
        sender: 'Assistant',
        message: payload.message,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      appendThreadItem({
        id: crypto.randomUUID(),
        role: 'assistant',
        text: payload.message,
        structuredContent: markdownOnlyContent(payload.message),
      });
      setCanGenerate(isTruthyYes(payload.can_generate_problem));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setChatLoading(false);
    }
  };

  const startRun = () => {
    if (runInProgress || !canGenerate) return;
    if (!firstIdeology.trim() || !secondIdeology.trim()) {
      setErrorMessage('Please provide both ideologies before starting.');
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setErrorMessage(null);
    setCurrentStage(null);
    setRunInProgress(true);
    setActivity(null);
    debateResultSeenRef.current = false;
    appendThreadItem({
      id: crypto.randomUUID(),
      role: 'system',
      text: 'Starting full debate run.',
    });

    const url = new URL('/api/run/stream', window.location.origin);
    url.searchParams.set('messages', JSON.stringify(messages));
    url.searchParams.set('firstIdeology', firstIdeology);
    url.searchParams.set('secondIdeology', secondIdeology);

    const source = new EventSource(url.toString());
    eventSourceRef.current = source;

    source.onmessage = (messageEvent) => {
      try {
        const event = JSON.parse(messageEvent.data) as RunEvent;
        applyRunEvent(event);

        if (event.type === 'run_error' || event.type === 'run_done') {
          source.close();
          eventSourceRef.current = null;
        }
      } catch {
        // Ignore malformed SSE entries.
      }
    };

    source.onerror = () => {
      setRunInProgress(false);
      setErrorMessage('Streaming connection ended unexpectedly.');
      setActivity(null);
      source.close();
      eventSourceRef.current = null;
    };
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 text-[#6b2130] md:px-6 dark:text-[#e0aeb7]">
      <header className="mb-3 rounded-2xl border border-[#b07b85]/35 bg-[#f8f2e8] px-5 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Polisim</h1>
        <p className="mt-1 text-sm text-[#6b2130] dark:text-[#6b2130]">
          AI agents perform deep policy research and debate one another to surface practical
          solutions to political problems.
        </p>
        <blockquote className="mt-2 border-l-2 border-[#8d2d43]/45 pl-3 text-xs italic text-[#7e3a49] dark:text-[#7e3a49]">
          “There mind must conspire with mind. Time is required to produce that union of minds
          which alone can produce all the good we aim at. Our patience will achieve more than our
          force”
        </blockquote>
        <p className="mt-2 text-xs text-[#6b2130] dark:text-[#6b2130]">
          Stage: {stageLabel} {runInProgress ? '• Running' : ''}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[#6b2130]/30 bg-[#f8f2e8]">
        <div
          ref={chatViewportRef}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6"
          aria-live="polite"
        >
          {threadItems.map((item) => {
            if (item.role === 'system') {
              return (
                <div key={item.id} className="flex justify-center">
                  <div className="rounded-full border border-[#b07b85]/35 bg-[#f8f2e8] px-3 py-1 text-[11px] text-[#7e3a49] dark:border-[#9e6674]/45 dark:bg-[#f8f2e8] dark:text-[#6b2130]">
                    {item.text}
                  </div>
                </div>
              );
            }

            const isUser = item.role === 'user';
            return (
              <div key={item.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
                    isUser
                      ? 'rounded-br-md bg-[#f6d5df] text-[#5f1f2d] dark:bg-[#f6d5df] dark:text-[#5f1f2d]'
                      : 'rounded-bl-md border border-[#b07b85]/30 bg-[#f8f2e8] text-[#6b2130] dark:border-[#9e6674]/40 dark:bg-[#f8f2e8] dark:text-[#6b2130]'
                  }`}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap">{item.text}</p>
                  ) : item.structuredContent ? (
                    <AssistantMessageBody content={item.structuredContent} />
                  ) : (
                    <MarkdownRenderer content={item.text} />
                  )}
                </div>
              </div>
            );
          })}

          {chatLoading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-[#b07b85]/30 bg-[#f8f2e8] px-4 py-3 text-sm dark:border-[#9e6674]/40 dark:bg-[#f8f2e8]">
                <span className="text-[#7e3a49] dark:text-[#7e3a49]">Assistant is typing...</span>
              </div>
            </div>
          ) : null}

          {activity ? (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#b07b85]/35 bg-[#f8f2e8] px-3 py-1 text-xs text-[#7e3a49] shadow-sm dark:border-[#9e6674]/45 dark:bg-[#f8f2e8] dark:text-[#7e3a49]">
                <span className="h-2 w-2 rounded-full bg-[#f8f2e8] shadow-[0_0_10px_rgba(141,45,67,0.75)] motion-safe:animate-pulse" />
                <span>{activity.message}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t border-[#b07b85]/30 bg-[#f8f2e8] p-3">
          <div className="mb-3 grid gap-2.5 md:grid-cols-2">
            <textarea
              className="min-h-20 rounded-xl border border-[#b07b85]/40 bg-[#f8f2e8] px-3 py-2 text-sm text-[#5f1f2d] outline-none placeholder:text-[#8a4a57] focus:border-[#8d2d43] dark:border-[#9e6674]/50 dark:bg-[#f8f2e8] dark:text-[#5f1f2d] dark:placeholder:text-[#8a4a57]"
              placeholder="First agent ideology, priorities, constraints..."
              value={firstIdeology}
              onChange={(event) => setFirstIdeology(event.target.value)}
              disabled={runInProgress}
            />
            <textarea
              className="min-h-20 rounded-xl border border-[#b07b85]/40 bg-[#f8f2e8] px-3 py-2 text-sm text-[#5f1f2d] outline-none placeholder:text-[#8a4a57] focus:border-[#8d2d43] dark:border-[#9e6674]/50 dark:bg-[#f8f2e8] dark:text-[#5f1f2d] dark:placeholder:text-[#8a4a57]"
              placeholder="Second agent ideology, priorities, constraints..."
              value={secondIdeology}
              onChange={(event) => setSecondIdeology(event.target.value)}
              disabled={runInProgress}
            />
          </div>

          <form onSubmit={sendChatTurn} className="flex items-end gap-2">
            <textarea
              className="min-h-11 max-h-36 flex-1 resize-y rounded-xl border border-[#b07b85]/40 bg-[#f8f2e8] px-3 py-2 text-sm text-[#5f1f2d] outline-none placeholder:text-[#8a4a57] focus:border-[#8d2d43] dark:border-[#9e6674]/50 dark:bg-[#f8f2e8] dark:text-[#5f1f2d] dark:placeholder:text-[#8a4a57]"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              disabled={chatLoading || runInProgress}
              rows={1}
            />
            <button
              type="submit"
              disabled={chatLoading || runInProgress || !chatInput.trim()}
              className="rounded-xl bg-[#f6d5df] px-4 py-2 text-sm font-medium text-[#6b2130] transition-colors hover:bg-[#efc3d1] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#f6d5df] dark:text-[#6b2130] dark:hover:bg-[#efc3d1]"
            >
              Send
            </button>
            <button
              type="button"
              onClick={startRun}
              disabled={!canGenerate || runInProgress}
              className="rounded-xl border border-[#8d2d43] bg-[#f8f2e8] px-4 py-2 text-sm font-medium text-[#8d2d43] transition-colors hover:bg-[#f8f2e8] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#8d2d43] dark:bg-[#f8f2e8] dark:text-[#8d2d43] dark:hover:bg-[#f8f2e8]"
            >
              {runInProgress ? 'Running...' : 'Run Debate'}
            </button>
          </form>

          <p className="mt-2 text-xs text-[#8a4a57] dark:text-[#c89ca7]">
            {canGenerate
              ? 'Conversation is ready. You can run the debate now.'
              : 'Keep chatting until a complete problem can be generated.'}
          </p>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-3 rounded-xl border border-red-200/80 bg-[#f8f2e8] px-3 py-2 text-sm text-red-700 dark:border-red-900/80 dark:bg-[#f8f2e8] dark:text-red-700">
          {errorMessage}
        </div>
      ) : null}
    </main>
  );
}
