import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendTranscriptEvent } from "../interaction/session-transcript.js";
import { restoreAgentMessagesFromTranscript } from "../interaction/session-transcript-restore.js";
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

    expect(restored).toHaveLength(2);
    expect(restored[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "需要查资料", signature: "sig" },
        { type: "toolCall", id: "tool-1" },
      ],
    });
    expect(restored[1]).toMatchObject({ role: "toolResult", toolCallId: "tool-1", toolName: "read" });
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
});
