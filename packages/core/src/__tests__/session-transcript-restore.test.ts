import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTranscriptEvent } from "../interaction/session-transcript.js";
import {
  adaptRestoredAgentMessagesForModel,
  deriveBookSessionFromTranscript,
  restoreAgentMessagesFromTranscript,
} from "../interaction/session-transcript-restore.js";
import type { MessageEvent } from "../interaction/session-transcript-schema.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("session transcript restore", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-restore-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("只恢复已 committed request 内的 message", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "hi",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 2,
      role: "user",
      timestamp: 2,
      message: { role: "user", content: "hi", timestamp: 2 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 3,
      timestamp: 3,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 4,
      timestamp: 4,
      input: "lost",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: "u1",
      seq: 5,
      role: "user",
      timestamp: 5,
      message: { role: "user", content: "lost", timestamp: 5 },
    } as MessageEvent);

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ role: "user", content: "hi" });
  });

  it("保留 committed toolResult 和 assistant thinking signature", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "tool",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 2,
      role: "assistant",
      timestamp: 2,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "需要查资料", signature: "sig" },
          { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "a.md" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "tool_use",
        timestamp: 2,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 3,
      role: "toolResult",
      timestamp: 3,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "资料" }],
        details: { path: "a.md" },
        isError: false,
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 4,
      timestamp: 4,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    expect(restored).toHaveLength(3);
    expect(restored[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "需要查资料", signature: "sig" },
        { type: "toolCall", id: "tool-1" },
      ],
    });
    expect(restored[1]).toMatchObject({ role: "toolResult", toolCallId: "tool-1", toolName: "read" });
    expect(restored[2]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "I have processed the tool results." }],
    });
  });

  it("恢复中断工具轮次时在 toolResult 后补 assistant bridge", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "tool",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 2,
      role: "user",
      timestamp: 2,
      message: { role: "user", content: "tool", timestamp: 2 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 3,
      role: "assistant",
      timestamp: 3,
      toolCallId: "tool-1",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "a.md" } }],
        api: "openai-completions",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 3,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "t1",
      parentUuid: "a1",
      seq: 4,
      role: "toolResult",
      timestamp: 4,
      toolCallId: "tool-1",
      sourceToolAssistantUuid: "a1",
      message: {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "资料" }],
        isError: false,
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a2",
      parentUuid: "t1",
      seq: 5,
      role: "assistant",
      timestamp: 5,
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "error",
        errorMessage: "400 status code",
        timestamp: 5,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 6,
      timestamp: 6,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 7,
      timestamp: 7,
      input: "继续",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      uuid: "u2",
      parentUuid: "a2",
      seq: 8,
      role: "user",
      timestamp: 8,
      message: { role: "user", content: "继续", timestamp: 8 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r2",
      seq: 9,
      timestamp: 9,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    expect(restored.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
      "user",
    ]);
    expect(restored[3]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "I have processed the tool results." }],
    });
  });

  it("移除最后 assistant message 的 trailing thinking block", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 1,
      timestamp: 1,
      input: "hi",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: null,
      seq: 2,
      role: "assistant",
      timestamp: 2,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "回答" },
          { type: "thinking", thinking: "尾部", signature: "sig" },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 2,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 3,
      timestamp: 3,
    });

    const restored = await restoreAgentMessagesFromTranscript(projectRoot, "s1");

    expect((restored[0] as any).content).toEqual([{ type: "text", text: "回答" }]);
  });

  it("跨模型恢复时移除 provider-specific thinking，但保留正文", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "DeepSeek reasoning", thinkingSignature: "reasoning_content" },
          { type: "text", text: "可见回答" },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "stop",
        timestamp: 1,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "gemini-pro-latest",
    });

    expect((adapted[0] as any).content).toEqual([{ type: "text", text: "可见回答" }]);
  });

  it("同模型恢复时保留 thinking continuity", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "DeepSeek reasoning", thinkingSignature: "reasoning_content" },
          { type: "text", text: "可见回答" },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "deepseek-v4-pro",
        usage,
        stopReason: "stop",
        timestamp: 1,
      },
    ] as any;

    const adapted = adaptRestoredAgentMessagesForModel(messages, {
      api: "openai-completions",
      provider: "openai",
      id: "deepseek-v4-pro",
    });

    expect((adapted[0] as any).content).toEqual(messages[0].content);
  });

  it("派生 BookSession 时跳过没有正文的 assistant tool-use message", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: null,
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "你好",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "你好", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "内部推理" },
          { type: "toolCall", id: "read-1", name: "read", arguments: { path: "books/a.md" } },
        ],
        api: "openai-completions",
        provider: "google",
        model: "gemini-pro-latest",
        usage,
        stopReason: "toolUse",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 5,
      timestamp: 5,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session?.messages).toEqual([{ role: "user", content: "你好", timestamp: 3 }]);
  });

  it("从 transcript 派生 BookSession UI 视图", async () => {
    await appendTranscriptEvent(projectRoot, {
      type: "session_created",
      version: 1,
      sessionId: "s1",
      seq: 1,
      timestamp: 1,
      bookId: "book-a",
      title: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await appendTranscriptEvent(projectRoot, {
      type: "request_started",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 2,
      timestamp: 2,
      input: "第一条问题",
    });
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "u1",
      parentUuid: null,
      seq: 3,
      role: "user",
      timestamp: 3,
      message: { role: "user", content: "第一条问题", timestamp: 3 },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "message",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      uuid: "a1",
      parentUuid: "u1",
      seq: 4,
      role: "assistant",
      timestamp: 4,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "思考" },
          { type: "text", text: "回答" },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude",
        usage,
        stopReason: "stop",
        timestamp: 4,
      },
    } as MessageEvent);
    await appendTranscriptEvent(projectRoot, {
      type: "request_committed",
      version: 1,
      sessionId: "s1",
      requestId: "r1",
      seq: 5,
      timestamp: 5,
    });

    const session = await deriveBookSessionFromTranscript(projectRoot, "s1");

    expect(session).toMatchObject({
      sessionId: "s1",
      bookId: "book-a",
      title: "第一条问题",
      messages: [
        { role: "user", content: "第一条问题" },
        { role: "assistant", content: "回答", thinking: "思考" },
      ],
    });
  });
});
