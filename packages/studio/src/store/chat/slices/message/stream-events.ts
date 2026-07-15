import type { StateCreator } from "zustand";
import type { ChatStore, Message, MessageActions, MessagePart, PipelineStage, ToolExecution } from "../../types";
import { shouldRefreshSidebarForTool } from "../../message-policy";
import { tr } from "../../../../lib/app-language";
import {
  deriveFlat,
  extractToolDetails,
  extractToolError,
  findRunningToolPart,
  getOrCreateStream,
  hasAnyInFlightExecution,
  hasInFlightExecution,
  mergeTaskExecution,
  replaceLast,
  resolveToolLabel,
  sessionMatchesEvent,
  summarizeResult,
  updateSession,
  updateToolPartById,
} from "./runtime";

type SliceSet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[0];
type SliceGet = Parameters<StateCreator<ChatStore, [], [], MessageActions>>[1];

type ContextCompressionCategory = "session_context" | "story_context";
type ContextCompressionPhase = "start" | "end" | "error";

interface ContextCompressionEventPayload {
  readonly sessionId?: string;
  readonly category?: ContextCompressionCategory;
  readonly phase?: ContextCompressionPhase;
  readonly message?: string;
  readonly protectedTokens?: number;
  readonly compressibleTokens?: number;
  readonly budgetTokens?: number;
  readonly sources?: readonly string[];
}

interface AttachSessionStreamListenersInput {
  sessionId: string;
  streamTs: number;
  streamEs: EventSource;
  set: SliceSet;
  get: SliceGet;
}

export const STREAM_TEXT_FLUSH_MS = 48;
export const TOOL_PROGRESS_FLUSH_MS = 750;
export const MAX_TOOL_LOGS = 80;

export type StreamTextDelta =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string };

interface StreamProgressEventData {
  readonly status?: string;
  readonly elapsedMs: number;
  readonly totalChars: number;
  readonly chineseChars: number;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function applyStreamTextDeltas(
  parts: ReadonlyArray<MessagePart>,
  deltas: ReadonlyArray<StreamTextDelta>,
): MessagePart[] {
  const next = [...parts];

  for (const delta of deltas) {
    if (!delta.text) continue;

    if (delta.kind === "thinking") {
      const last = next[next.length - 1];
      if (last?.type === "thinking") {
        next[next.length - 1] = { ...last, content: last.content + delta.text };
      }
      continue;
    }

    const last = next[next.length - 1];
    if (last?.type === "text") {
      next[next.length - 1] = { ...last, content: last.content + delta.text };
    } else {
      next.push({ type: "text", content: delta.text });
    }
  }

  return next;
}

export function appendBoundedToolLogs(
  existing: ReadonlyArray<string> | undefined,
  incoming: ReadonlyArray<string>,
): string[] {
  return [...(existing ?? []), ...incoming].slice(-MAX_TOOL_LOGS);
}

/**
 * 倒序扫描消息，找到最近一个仍在运行的工具卡并更新它。
 * 任务与聊天并行时，任务卡挂在更早的任务轮消息上，不能只看当前 streamTs
 * 的消息。update 返回 null 表示这张卡不需要更新（整体视为 no-op）。
 */
export function updateLatestRunningToolMessage(
  messages: ReadonlyArray<Message>,
  update: (execution: ToolExecution) => ToolExecution | null,
): ReadonlyArray<Message> | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    const running = findRunningToolPart([...(message.parts ?? [])]);
    if (!running) continue;
    const updated = update(running.execution);
    if (!updated) return null;
    const parts = (message.parts ?? []).map((part) => (
      part.type === "tool" && part.execution.id === running.execution.id
        ? { type: "tool" as const, execution: updated }
        : part
    ));
    return [
      ...messages.slice(0, i),
      { ...message, ...deriveFlat(parts), parts },
      ...messages.slice(i + 1),
    ];
  }
  return null;
}

export function createStreamTextDeltaBatcher(
  flushDeltas: (deltas: StreamTextDelta[]) => void,
  delayMs = STREAM_TEXT_FLUSH_MS,
): { enqueue: (delta: StreamTextDelta) => void; flush: () => void } {
  let pending: StreamTextDelta[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    clearTimer();
    if (pending.length === 0) return;
    const deltas = pending;
    pending = [];
    flushDeltas(deltas);
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, delayMs);
  };

  return {
    enqueue(delta) {
      pending.push(delta);
      schedule();
    },
    flush,
  };
}

export function createLatestEventThrottle<T>(
  publishLatest: (event: T) => void,
  intervalMs = TOOL_PROGRESS_FLUSH_MS,
): { enqueue: (event: T) => void; flush: () => void } {
  let latest: T | undefined;
  let hasLatest = false;
  let lastPublishedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const publishNow = (event: T) => {
    lastPublishedAt = Date.now();
    publishLatest(event);
  };

  const flush = () => {
    clearTimer();
    if (!hasLatest) return;
    const event = latest as T;
    latest = undefined;
    hasLatest = false;
    publishNow(event);
  };

  const schedule = () => {
    if (timer !== null) return;
    const elapsed = lastPublishedAt === null ? intervalMs : Date.now() - lastPublishedAt;
    const delay = Math.max(0, intervalMs - elapsed);
    timer = setTimeout(flush, delay);
  };

  return {
    enqueue(event) {
      if (lastPublishedAt === null) {
        publishNow(event);
        return;
      }

      latest = event;
      hasLatest = true;

      if (Date.now() - lastPublishedAt >= intervalMs) {
        flush();
      } else {
        schedule();
      }
    },
    flush,
  };
}

export function attachSessionStreamListeners({
  sessionId,
  streamTs,
  streamEs,
  set,
  get,
}: AttachSessionStreamListenersInput): void {
  const textDeltaBatcher = createStreamTextDeltaBatcher((deltas) => {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => {
        const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
        const parts = applyStreamTextDeltas(stream.parts ?? [], deltas);
        const flat = deriveFlat(parts);
        return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
      }),
    }));
  });

  const flushTextDeltas = () => textDeltaBatcher.flush();

  const progressThrottle = createLatestEventThrottle<StreamProgressEventData>((data) => {
    set((state) => ({
      sessions: updateSession(state.sessions, sessionId, (runtime) => {
        const messages = updateLatestRunningToolMessage(runtime.messages, (execution) => {
          if (!execution.stages) return null;
          return {
            ...execution,
            stages: execution.stages.map((stage) =>
              stage.status === "active"
                ? {
                    ...stage,
                    progress: {
                      status: data.status,
                      elapsedMs: data.elapsedMs,
                      totalChars: data.totalChars,
                      chineseChars: data.chineseChars,
                    },
                  }
                : stage,
            ),
          };
        });
        return messages ? { messages } : {};
      }),
    }));
  });

  streamEs.addEventListener("draft:complete", flushTextDeltas);
  streamEs.addEventListener("draft:error", flushTextDeltas);

  // agent:complete / agent:error / agent:aborted 都是"某一轮请求结束"的信号，
  // 但事件本身分不清结束的是聊天轮还是后台任务轮（两者共享 sessionId）：
  // - 聊天轮还在进行（isChatStreaming=true）时不能关连接——事件既可能属于
  //   聊天轮自己（随后 sendMessage 的 finally 会收尾），也可能属于后台任务
  //   （聊天要继续）；
  // - 聊天轮已结束时，只要消息里还有 in-flight 的任务卡，连接也要保持，
  //   等任务自己的终态事件（tool:end → agent:complete）到来再关闭。
  const finishSessionStream = (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      progressThrottle.flush();
      const runtime = get().sessions[sessionId];
      if (!runtime || runtime.isChatStreaming) return;
      if (hasAnyInFlightExecution(runtime.messages)) return;
      streamEs.close();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, () => ({
          isStreaming: false,
          stream: null,
        })),
      }));
    } catch {
      // ignore
    }
  };
  streamEs.addEventListener("agent:complete", finishSessionStream);
  streamEs.addEventListener("agent:error", finishSessionStream);

  streamEs.addEventListener("task:snapshot", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.execution) return;
      const execution = data.execution as ToolExecution;
      const running = execution.status === "running" || execution.status === "processing";
      // 服务端在每次 SSE 连接建立时都会重放该会话的任务快照。终态快照只用于
      // 收尾一个当前确实还在运行中的任务卡（刷新恢复场景）；如果本会话没有在
      // 跟踪这个任务，说明它是上一轮已结束任务的残留快照，直接忽略——否则
      // 会把本轮新建立的流关掉，导致后续实时事件全部丢失。
      if (!running && !hasInFlightExecution(get().sessions[sessionId]?.messages ?? [], execution.id)) {
        return;
      }
      // 聊天轮正在流式时收到终态快照（任务刚结束、新连接建立时服务端重放）：
      // 只收尾任务卡，连接与流式状态保持不动，由聊天轮自己收尾——否则会把
      // 正在跑的聊天流关掉，本轮增量全部丢失。
      const chatStreaming = Boolean(get().sessions[sessionId]?.isChatStreaming);
      const keepStream = running || chatStreaming;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => ({
          messages: mergeTaskExecution(runtime.messages, execution),
          isStreaming: keepStream,
          stream: keepStream ? runtime.stream : null,
        })),
      }));
      if (!keepStream) streamEs.close();
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("agent:aborted", finishSessionStream);

  streamEs.addEventListener("thinking:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? []), { type: "thinking" as const, content: "", streaming: true }];
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      textDeltaBatcher.enqueue({ kind: "thinking", text: data.text as string });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("thinking:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          const last = parts[parts.length - 1];
          if (last?.type === "thinking") {
            parts[parts.length - 1] = { ...last, streaming: false };
          }
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("draft:delta", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.text) return;
      textDeltaBatcher.enqueue({ kind: "text", text: data.text as string });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:start", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];

          if (data.tool === "sub_agent") {
            const last = parts[parts.length - 1];
            if (last?.type === "text" && last.content) {
              parts.pop();
              const prev = parts[parts.length - 1];
              if (prev?.type === "thinking") {
                parts[parts.length - 1] = {
                  ...prev,
                  content: prev.content + (prev.content ? "\n\n" : "") + last.content,
                };
              } else {
                parts.push({ type: "thinking", content: last.content, streaming: false });
              }
            }
          }

          const agent = data.tool === "sub_agent" ? (data.args?.agent as string | undefined) : undefined;
          const stages: PipelineStage[] | undefined = Array.isArray(data.stages) && data.stages.length > 0
            ? (data.stages as string[]).map((label) => ({ label, status: "pending" as const }))
            : undefined;

          parts.push({
            type: "tool",
            execution: {
              id: data.id as string,
              tool: data.tool as string,
              agent,
              label: resolveToolLabel(data.tool as string, agent),
              status: "running",
              args: data.args as Record<string, unknown> | undefined,
              stages,
              startedAt: Date.now(),
            },
          });

          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("tool:end", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.tool) return;
      flushTextDeltas();
      progressThrottle.flush();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          // 按 execution id 全量定位：并行聊天时任务卡在更早的消息里
          const messages = updateToolPartById(runtime.messages, data.id as string, (previous) => {
            const execution = { ...previous };
            execution.status = data.isError ? "error" : "completed";
            execution.completedAt = Date.now();
            execution.stages = execution.stages?.map((stage) =>
              stage.status !== "completed"
                ? { ...stage, status: "completed" as const, progress: undefined }
                : stage,
            );
            if (data.isError) execution.error = extractToolError(data.result);
            else execution.result = summarizeResult(data.result);
            const details = data.details ?? extractToolDetails(data.result);
            if (details !== undefined) execution.details = details;
            return execution;
          });
          return messages ? { messages } : {};
        }),
      }));

      if (shouldRefreshSidebarForTool(data.tool as string)) {
        get().bumpBookDataVersion();
      }
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("log", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      const message = data?.message as string | undefined;
      if (!message) return;
      flushTextDeltas();
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const messages = updateLatestRunningToolMessage(runtime.messages, (execution) => ({
            ...execution,
            logs: appendBoundedToolLogs(execution.logs, [message]),
          }));
          return messages ? { messages } : {};
        }),
      }));
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("llm:progress", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) : null;
      if (!sessionMatchesEvent(sessionId, data)) return;
      flushTextDeltas();
      progressThrottle.enqueue({
        status: typeof data.status === "string" ? data.status : undefined,
        elapsedMs: numberOrZero(data.elapsedMs),
        totalChars: numberOrZero(data.totalChars),
        chineseChars: numberOrZero(data.chineseChars),
      });
    } catch {
      // ignore
    }
  });

  streamEs.addEventListener("context:compression", (event: MessageEvent) => {
    try {
      const data = event.data ? JSON.parse(event.data) as ContextCompressionEventPayload : null;
      if (!sessionMatchesEvent(sessionId, data) || !data?.category || !data.phase) return;
      const category = data.category;
      const phase = data.phase;
      set((state) => ({
        sessions: updateSession(state.sessions, sessionId, (runtime) => {
          const [messages, stream] = getOrCreateStream(runtime.messages, streamTs);
          const parts = [...(stream.parts ?? [])];
          applyContextCompressionToParts(parts, category, phase, data);
          const flat = deriveFlat(parts);
          return { messages: replaceLast(messages, { ...stream, ...flat, parts }) };
        }),
      }));
    } catch {
      // ignore
    }
  });
}

function compressionLabel(category: ContextCompressionCategory): string {
  return category === "session_context"
    ? tr("整理会话记忆", "Organize session memory")
    : tr("压缩故事上下文", "Compress story context");
}

function compressionSourceSummary(sources: readonly string[] | undefined): string {
  if (!sources || sources.length === 0) return "";
  const preview = sources.slice(0, 3).join(", ");
  const suffix = sources.length > 3 ? ` +${sources.length - 3}` : "";
  return `${tr("来源", "sources")} ${sources.length}: ${preview}${suffix}`;
}

function compressionProgress(data: ContextCompressionEventPayload): PipelineStage["progress"] | undefined {
  if (data.phase !== "start") return undefined;
  const parts = [
    data.protectedTokens !== undefined ? `${tr("保护", "protected")} ${data.protectedTokens}` : "",
    data.compressibleTokens !== undefined ? `${tr("可压缩", "compressible")} ${data.compressibleTokens}` : "",
    data.budgetTokens !== undefined ? `${tr("预算", "budget")} ${data.budgetTokens}` : "",
    compressionSourceSummary(data.sources),
  ].filter(Boolean);
  return {
    status: parts.length > 0 ? parts.join(" · ") : "compressing",
    elapsedMs: 0,
    totalChars: 0,
    chineseChars: 0,
  };
}

function upsertCompressionStage(
  stages: PipelineStage[] | undefined,
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): PipelineStage[] {
  const label = compressionLabel(category);
  const found = stages?.some((stage) => stage.label === label) ?? false;
  const base = found ? [...(stages ?? [])] : [...(stages ?? []), { label, status: "pending" as const }];
  const status: PipelineStage["status"] = phase === "start" ? "active" : "completed";
  return base.map((stage) =>
    stage.label === label
      ? { ...stage, status, progress: phase === "start" ? compressionProgress(data) : undefined }
      : stage
  );
}

function findRunningExecution(parts: MessagePart[]): ToolExecution | undefined {
  const running = findRunningToolPart(parts);
  return running?.execution;
}

function applyContextCompressionToParts(
  parts: MessagePart[],
  category: ContextCompressionCategory,
  phase: ContextCompressionPhase,
  data: ContextCompressionEventPayload,
): void {
  const running = category === "session_context" ? undefined : findRunningExecution(parts);
  if (running) {
    running.stages = upsertCompressionStage(running.stages, category, phase, data);
    if (phase === "error") {
      running.status = "error";
      running.error = data.message ?? `${compressionLabel(category)}${tr("失败", " failed")}`;
    }
    return;
  }

  const id = `context-${category}`;
  const existing = parts.find((part): part is { type: "tool"; execution: ToolExecution } =>
    part.type === "tool" && part.execution.id === id
  );
  const status: ToolExecution["status"] = phase === "start" ? "running" : phase === "error" ? "error" : "completed";
  const execution = existing?.execution ?? {
    id,
    tool: "context_compression",
    label: compressionLabel(category),
    status,
    stages: [],
    startedAt: Date.now(),
  };
  execution.status = status;
  execution.label = compressionLabel(category);
  execution.stages = upsertCompressionStage(execution.stages, category, phase, data);
  if (phase !== "start") execution.completedAt = Date.now();
  if (phase === "error") execution.error = data.message ?? `${compressionLabel(category)}${tr("失败", " failed")}`;
  if (!existing) parts.push({ type: "tool", execution });
}
