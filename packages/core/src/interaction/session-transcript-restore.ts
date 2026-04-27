import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { readTranscriptEvents } from "./session-transcript.js";
import {
  BookSessionSchema,
  type BookSession,
  type InteractionMessage,
  type ToolExecution,
} from "./session.js";
import type { MessageEvent, TranscriptEvent } from "./session-transcript-schema.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function contentBlocks(message: Record<string, unknown>): unknown[] {
  return Array.isArray(message.content) ? message.content : [];
}

function hasTextContent(message: Record<string, unknown>): boolean {
  return contentBlocks(message).some(
    (block) =>
      isObject(block) &&
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.length > 0,
  );
}

function hasToolCallContent(message: Record<string, unknown>): boolean {
  return contentBlocks(message).some(
    (block) => isObject(block) && block.type === "toolCall" && typeof block.id === "string",
  );
}

function toolCallIds(message: Record<string, unknown>): string[] {
  return contentBlocks(message)
    .filter(
      (block): block is Record<string, unknown> =>
        isObject(block) && block.type === "toolCall" && typeof block.id === "string",
    )
    .map((block) => block.id as string);
}

function isThinkingBlock(block: unknown): boolean {
  return isObject(block) && (block.type === "thinking" || block.type === "redacted_thinking");
}

function removeTrailingThinking(message: AgentMessage): AgentMessage {
  if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
    return message;
  }

  const content = [...message.content];
  while (content.length > 0 && isThinkingBlock(content[content.length - 1])) {
    content.pop();
  }

  if (content.length === message.content.length) return message;
  return { ...message, content } as AgentMessage;
}

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const TOOL_RESULT_BRIDGE_TEXT = "I have processed the tool results.";

function toolResultBridgeMessage(timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: TOOL_RESULT_BRIDGE_TEXT }],
    api: "openai-completions",
    provider: "inkos",
    model: "synthetic-tool-result-bridge",
    usage: emptyUsage,
    stopReason: "stop",
    timestamp,
  } as AgentMessage;
}

function addToolResultBridges(messages: AgentMessage[]): AgentMessage[] {
  const bridged: AgentMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    bridged.push(message);

    if (!isObject(message) || message.role !== "toolResult") continue;

    const next = messages[i + 1];
    if (isObject(next) && (next.role === "toolResult" || next.role === "assistant")) continue;

    const timestamp = typeof message.timestamp === "number" ? message.timestamp + 1 : Date.now();
    bridged.push(toolResultBridgeMessage(timestamp));
  }

  return bridged;
}

export function cleanRestoredAgentMessages(messages: AgentMessage[]): AgentMessage[] {
  const availableToolCalls = new Set<string>();
  for (const message of messages) {
    if (isObject(message) && message.role === "assistant") {
      for (const id of toolCallIds(message)) availableToolCalls.add(id);
    }
  }

  const cleaned = messages.filter((message) => {
    if (!isObject(message)) return false;
    if (message.role === "toolResult") {
      return typeof message.toolCallId === "string" && availableToolCalls.has(message.toolCallId);
    }
    if (message.role === "assistant") {
      return hasTextContent(message) || hasToolCallContent(message);
    }
    return message.role === "user" || message.role === "system";
  });

  if (cleaned.length === 0) return cleaned;
  const last = cleaned[cleaned.length - 1];
  if (isObject(last) && last.role === "assistant") {
    cleaned[cleaned.length - 1] = removeTrailingThinking(last);
  }

  return addToolResultBridges(cleaned);
}

interface TargetModelIdentity {
  readonly api?: unknown;
  readonly provider?: unknown;
  readonly id?: unknown;
}

function isSameAssistantModel(message: Record<string, unknown>, target: TargetModelIdentity): boolean {
  return (
    typeof message.api === "string" &&
    typeof message.provider === "string" &&
    typeof message.model === "string" &&
    message.api === target.api &&
    message.provider === target.provider &&
    message.model === target.id
  );
}

export function adaptRestoredAgentMessagesForModel(
  messages: AgentMessage[],
  target: TargetModelIdentity,
): AgentMessage[] {
  return messages
    .map((message) => {
      if (
        !isObject(message) ||
        message.role !== "assistant" ||
        !Array.isArray(message.content) ||
        isSameAssistantModel(message, target)
      ) {
        return message;
      }

      const content = message.content.filter((block) => !isThinkingBlock(block));
      if (content.length === message.content.length) return message;
      return { ...message, content } as AgentMessage;
    })
    .filter((message) => {
      if (!isObject(message) || message.role !== "assistant") return true;
      return hasTextContent(message) || hasToolCallContent(message);
    });
}

export function committedMessageEvents(events: TranscriptEvent[]): MessageEvent[] {
  const committed = new Set(
    events
      .filter((event) => event.type === "request_committed")
      .map((event) => event.requestId),
  );

  return events
    .filter((event): event is MessageEvent => event.type === "message" && committed.has(event.requestId))
    .sort((a, b) => a.seq - b.seq);
}

export async function restoreAgentMessagesFromTranscript(
  projectRoot: string,
  sessionId: string,
): Promise<AgentMessage[]> {
  const events = await readTranscriptEvents(projectRoot, sessionId);
  return cleanRestoredAgentMessages(
    committedMessageEvents(events).map((event) => event.message as AgentMessage),
  );
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        isObject(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
}

function thinkingFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const value = content
    .filter((block): block is Record<string, unknown> => isObject(block) && block.type === "thinking")
    .map((block) => typeof block.thinking === "string" ? block.thinking : "")
    .join("");
  return value || undefined;
}

function firstUserMessageTitle(messages: InteractionMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const oneLine = message.content.trim().replace(/\s+/g, " ");
    if (!oneLine) return null;
    return oneLine.length > 20 ? `${oneLine.slice(0, 20)}…` : oneLine;
  }
  return null;
}

function messageEventToInteractionMessage(event: MessageEvent): InteractionMessage | null {
  const raw = event.message as Record<string, unknown>;
  if (!isObject(raw)) return null;
  if (event.role === "toolResult") return null;

  if (event.role === "user") {
    const content = textFromContent(raw.content);
    return content ? { role: "user", content, timestamp: event.timestamp } : null;
  }

  if (event.role === "assistant") {
    const content = textFromContent(raw.content);
    const thinking = thinkingFromContent(raw.content) ?? event.legacyDisplay?.thinking;
    if (!content) return null;
    return {
      role: "assistant",
      content,
      ...(thinking ? { thinking } : {}),
      ...(event.legacyDisplay?.toolExecutions
        ? { toolExecutions: event.legacyDisplay.toolExecutions as ToolExecution[] }
        : {}),
      timestamp: event.timestamp,
    };
  }

  if (event.role === "system") {
    const content = textFromContent(raw.content);
    return content ? { role: "system", content, timestamp: event.timestamp } : null;
  }

  return null;
}

export async function deriveBookSessionFromTranscript(
  projectRoot: string,
  sessionId: string,
): Promise<BookSession | null> {
  const events = await readTranscriptEvents(projectRoot, sessionId);
  if (events.length === 0) return null;

  const created = events.find((event) => event.type === "session_created");
  let bookId = created?.type === "session_created" ? created.bookId : null;
  let title = created?.type === "session_created" ? created.title : null;
  const createdAt = created?.type === "session_created"
    ? created.createdAt
    : events[0]?.timestamp ?? Date.now();
  let updatedAt = created?.type === "session_created"
    ? created.updatedAt
    : events[events.length - 1]?.timestamp ?? createdAt;

  for (const event of events) {
    if (event.type !== "session_metadata_updated") continue;
    if ("bookId" in event && event.bookId !== undefined) bookId = event.bookId;
    if ("title" in event && event.title !== undefined) title = event.title;
    updatedAt = event.updatedAt;
  }

  const messages = committedMessageEvents(events)
    .map(messageEventToInteractionMessage)
    .filter((message): message is InteractionMessage => message !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (title === null) {
    title = firstUserMessageTitle(messages);
  }

  return BookSessionSchema.parse({
    sessionId,
    bookId,
    title,
    messages,
    draftRounds: [],
    events: [],
    createdAt,
    updatedAt,
  });
}
