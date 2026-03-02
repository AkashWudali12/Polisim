'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [chatMessageIndex, setChatMessageIndex] = useState(0);
  const [debateJobId, setDebateJobId] = useState<string | null>(null);
  const [debateEventIndex, setDebateEventIndex] = useState(0);
  const debateResultSeenRef = useRef(false);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);

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

  const appendThreadItem = useCallback((item: ThreadItem) => {
    setThreadItems((prev) => [...prev, item]);
  }, []);

  const applyRunEvent = useCallback(
    (event: RunEvent) => {
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
    },
    [appendThreadItem],
  );

  useEffect(() => {
    if (!debateJobId || !runInProgress) return;

    const POLL_INTERVAL_MS = 1500;

    const intervalId = setInterval(async () => {
      try {
        const params = new URLSearchParams();
        params.set('jobId', debateJobId);
        params.set('fromIndex', String(debateEventIndex));
        const response = await fetch(`/api/run/status?${params.toString()}`);
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Failed to fetch debate status');
        }

        const data = (await response.json()) as {
          events: RunEvent[];
          nextIndex: number;
          status: 'pending' | 'running' | 'completed' | 'error';
          errorMessage?: string;
        };

        if (Array.isArray(data.events) && data.events.length > 0) {
          for (const event of data.events) {
            applyRunEvent(event);
          }
          setDebateEventIndex(data.nextIndex);
        }

        if (data.status === 'completed' || data.status === 'error') {
          if (data.errorMessage) {
            setErrorMessage(data.errorMessage);
          }
          setRunInProgress(false);
          setDebateJobId(null);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to poll debate status');
        setRunInProgress(false);
        setDebateJobId(null);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [debateJobId, debateEventIndex, runInProgress, applyRunEvent]);

  useEffect(() => {
    if (!chatJobId || !chatLoading) return;

    const POLL_INTERVAL_MS = 1000;

    const intervalId = setInterval(async () => {
      try {
        const params = new URLSearchParams();
        params.set('jobId', chatJobId);
        params.set('fromIndex', String(chatMessageIndex));
        const response = await fetch(`/api/chat/turn/status?${params.toString()}`);
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Failed to fetch chat status');
        }

        const data = (await response.json()) as {
          messages: ChatTurnResponse[];
          nextIndex: number;
          status: 'pending' | 'running' | 'completed' | 'error';
          errorMessage?: string;
        };

        if (Array.isArray(data.messages) && data.messages.length > 0) {
          for (const payload of data.messages) {
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
          }
          setChatMessageIndex(data.nextIndex);
        }

        if (data.status === 'completed' || data.status === 'error') {
          if (data.errorMessage) {
            setErrorMessage(data.errorMessage);
          }
          setChatLoading(false);
          setChatJobId(null);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to poll chat status');
        setChatLoading(false);
        setChatJobId(null);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [chatJobId, chatLoading, chatMessageIndex, appendThreadItem]);

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
      const response = await fetch('/api/chat/turn/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to start chat turn');
      }

      const data = (await response.json()) as { jobId: string };
      setChatJobId(data.jobId);
      setChatMessageIndex(0);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setChatLoading(false);
    }
  };

  const startRun = () => {
    if (runInProgress || !canGenerate) return;
    if (!firstIdeology.trim() || !secondIdeology.trim()) {
      setErrorMessage('Please provide both ideologies before starting.');
      return;
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

    const startDebate = async () => {
      try {
        const response = await fetch('/api/run/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            firstIdeology: firstIdeology.trim(),
            secondIdeology: secondIdeology.trim(),
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? 'Failed to start debate run');
        }

        const data = (await response.json()) as { jobId: string };
        setDebateJobId(data.jobId);
        setDebateEventIndex(0);
      } catch (error) {
        setRunInProgress(false);
        setErrorMessage(error instanceof Error ? error.message : 'Failed to start debate run');
        setActivity(null);
      }
    };

    void startDebate();
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
