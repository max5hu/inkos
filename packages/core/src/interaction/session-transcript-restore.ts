import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { readTranscriptEvents } from "./session-transcript.js";
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

  return cleaned;
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
