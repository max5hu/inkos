import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ChatStore } from "../../types";
import { initialChatState } from "../../initialState";
import { createCreateSlice } from "../create/action";
import { createMessageSlice } from "./action";

const { fetchJson } = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock("../../../../hooks/use-api", () => ({ fetchJson }));

class FakeEventSource {
  readonly url: string;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;
  constructor(url: string) {
    this.url = url;
    fakeEventSources.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const fakeEventSources: FakeEventSource[] = [];

function createTestStore() {
  return createStore<ChatStore>()((...args) => ({
    ...initialChatState,
    ...createMessageSlice(...args),
    ...createCreateSlice(...args),
  }));
}

describe("chat message actions", () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    fetchJson.mockReset();
    fetchJson.mockResolvedValue({});
    fakeEventSources.length = 0;
    (globalThis as any).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  it("keeps play mode local for draft sessions until the first message persists them", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().setSessionPlayMode(sessionId, "guided");

    expect(store.getState().sessions[sessionId]?.playMode).toBe("guided");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("syncs the created book id returned by /agent back into the current runtime session", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockResolvedValueOnce({
        response: "已创建书籍。",
        session: { sessionId, activeBookId: "new-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "创建一本债务悬疑长篇", { sessionKind: "book-create" });

    expect(store.getState().sessions[sessionId]).toMatchObject({
      bookId: "new-book",
      sessionKind: "book",
      isDraft: false,
    });
    expect(store.getState().sessionIdsByBook["new-book"]).toContain(sessionId);
  });

  it("sends the session-bound book id when no explicit activeBookId option is provided", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("harbor-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    store.getState().setSelectedModel("MiniMax-M2.7", "minimax");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "harbor-book", sessionKind: "book" } })
      .mockResolvedValueOnce({
        response: "ok",
        session: { sessionId, activeBookId: "harbor-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "审第 1 章");

    const agentCall = fetchJson.mock.calls.find(([path]) => path === "/agent");
    expect(agentCall).toBeDefined();
    const body = JSON.parse((agentCall?.[1] as { body: string }).body);
    expect(body.activeBookId).toBe("harbor-book");
    expect(body.sessionKind).toBe("book");
    expect(body.service).toBe("kkaiapi");
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("parses @skill directives into requestedSkills and strips them from the agent instruction", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "play" } })
      .mockResolvedValueOnce({
        response: "ok",
        session: { sessionId, bookId: null, sessionKind: "play" },
      });

    await store.getState().sendMessage(sessionId, "@open-world-play 做一个魔兽风开放世界", {
      sessionKind: "play",
    });

    const agentCall = fetchJson.mock.calls.find(([path]) => path === "/agent");
    expect(agentCall).toBeDefined();
    const body = JSON.parse((agentCall?.[1] as { body: string }).body);
    expect(body.instruction).toBe("做一个魔兽风开放世界");
    expect(body.requestedSkills).toEqual(["open-world-play"]);
  });

  it("keeps a tool-only stream when /agent returns an empty response after a proposal", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "创建一本债务悬疑长篇", { sessionKind: "book-create" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
    });
    fakeEventSources[0].emit("tool:end", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
      details: {
        kind: "proposed_action",
        action: "create_book",
        targetSessionKind: "book-create",
        sameSession: true,
        title: "确认建书",
        instruction: "创建一本债务悬疑长篇",
      },
    });

    resolveAgent({ response: "", session: { sessionId, sessionKind: "book-create" } });
    await sent;

    const messages = store.getState().sessions[sessionId]?.messages ?? [];
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).not.toContain("模型未返回文本内容");
    expect(assistant?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        execution: expect.objectContaining({
          tool: "propose_action",
          status: "completed",
        }),
      }),
    ]);
  });

  it("restores confirmed proposal cards when loading persisted session messages", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().loadSessionMessages(sessionId, [
      {
        role: "assistant",
        content: "",
        timestamp: 1,
        toolExecutions: [
          {
            id: "proposal-1",
            tool: "propose_action",
            label: "确认动作",
            status: "completed",
            startedAt: 1,
            details: {
              kind: "proposed_action",
              action: "play_start",
              targetSessionKind: "play",
              instruction: "启动旧影院",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "",
        timestamp: 2,
        toolExecutions: [
          {
            id: "play-1",
            tool: "play_start",
            label: "启动互动世界",
            status: "completed",
            startedAt: 2,
            details: { kind: "play_world_started" },
          },
        ],
      },
    ]);

    expect(store.getState().resolvedProposals).toEqual({ "proposal-1": "confirmed" });
  });

  it("does not replace an active local stream while session detail is loading", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    const stream = new FakeEventSource(`/api/v1/events?sessionId=${sessionId}`);
    store.setState((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...state.sessions[sessionId]!,
          isDraft: false,
          isStreaming: true,
          stream: stream as unknown as EventSource,
        },
      },
    }));
    fetchJson.mockClear();

    await store.getState().loadSessionDetail(sessionId);

    expect(fetchJson).not.toHaveBeenCalled();
    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: true,
      stream,
    });
  });

  it("restores and reconnects a running production task when session detail reloads", async () => {
    const store = createTestStore();
    fetchJson.mockResolvedValueOnce({
      session: { sessionId: "short-session-1", bookId: null, sessionKind: "short", title: "雨夜账本" },
    });
    const sessionId = await store.getState().createSession(null, "short");
    fetchJson.mockResolvedValueOnce({
      session: {
        sessionId,
        bookId: null,
        sessionKind: "short",
        title: "雨夜账本",
        messages: [],
      },
      task: {
        version: 1,
        sessionId,
        requestedIntent: "short_run",
        updatedAt: 20,
        execution: {
          id: "short-task-1",
          tool: "short_fiction_run",
          label: "生成短篇",
          status: "running",
          startedAt: 10,
          logs: ["正在生成大纲"],
        },
      },
    });

    await store.getState().loadSessionDetail(sessionId);

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });
    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      id: "short-task-1",
      status: "running",
      logs: ["正在生成大纲"],
    });
    expect(fakeEventSources).toHaveLength(1);
    expect(fakeEventSources[0]?.url).toBe(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}`);

    fakeEventSources[0]?.emit("task:snapshot", {
      version: 1,
      sessionId,
      requestedIntent: "short_run",
      updatedAt: 30,
      execution: {
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "生成短篇",
        status: "completed",
        startedAt: 10,
        completedAt: 30,
        result: "短篇已完成",
      },
    });

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: false, stream: null });
    expect(store.getState().sessions[sessionId]?.messages).toHaveLength(1);
    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      id: "short-task-1",
      status: "completed",
      result: "短篇已完成",
    });
  });

  it("ignores a stale terminal task snapshot replayed onto a new agent stream", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "short" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "再生成一篇短篇", { sessionKind: "short" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    // 服务端在 SSE 连接建立时会重放该会话磁盘上的任务快照；
    // 上一轮已完成的任务快照不能把本轮新建立的流关掉。
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "finished-task-9",
        tool: "short_fiction_run",
        label: "短篇生产",
        status: "completed",
        startedAt: 100,
        completedAt: 200,
        result: "上一轮短篇已完成",
      },
    });

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });
    expect(store.getState().sessions[sessionId]?.stream).not.toBeNull();
    const staleExecutions = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === "finished-task-9");
    expect(staleExecutions).toHaveLength(0);

    resolveAgent({ response: "ok", session: { sessionId, sessionKind: "short" } });
    await sent;
  });

  it("marks the active tool card as stopped without requiring a refresh", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().loadSessionMessages(sessionId, [{
      role: "assistant",
      content: "",
      timestamp: 10,
      toolExecutions: [{
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "短篇生产",
        status: "running",
        startedAt: 10,
      }],
    }]);

    await store.getState().abortSession(sessionId);

    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      status: "error",
      error: "已由用户停止",
      completedAt: expect.any(Number),
    });
    expect(fetchJson).toHaveBeenCalledWith(`/sessions/${sessionId}/abort`, { method: "POST" });
  });

  it("keeps one stopped task card when the aborted agent request later rejects", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let rejectAgent!: (error: Error) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "short" } })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectAgent = reject;
      }))
      .mockResolvedValueOnce({});

    const sent = store.getState().sendMessage(sessionId, "确认生成短篇", { sessionKind: "short" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "短篇生产",
        status: "running",
        startedAt: 1_100,
      },
    });

    now.mockReturnValue(2_000);
    await store.getState().abortSession(sessionId);
    rejectAgent(new Error("This operation was aborted"));
    await sent;

    const taskExecutions = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === "short-task-1");
    expect(taskExecutions).toEqual([
      expect.objectContaining({
        status: "error",
        error: "已由用户停止",
      }),
    ]);
    expect(store.getState().sessions[sessionId]?.messages).not.toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("This operation was aborted") }),
    );
    now.mockRestore();
  });

  // 恢复出一个"任务运行中"的会话：磁盘上有 running 任务快照，前端加载详情后
  // 会 merge 任务卡、建立 SSE 连接并把 isStreaming 置为 true。
  async function setupRunningTaskSession(store: ReturnType<typeof createTestStore>): Promise<string> {
    fetchJson.mockResolvedValueOnce({
      session: { sessionId: "task-session-1", bookId: null, sessionKind: "short", title: "雨夜账本" },
    });
    const sessionId = await store.getState().createSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson.mockResolvedValueOnce({
      session: { sessionId, bookId: null, sessionKind: "short", title: "雨夜账本", messages: [] },
      task: {
        version: 1,
        sessionId,
        requestedIntent: "short_run",
        updatedAt: 20,
        execution: {
          id: "direct-short_run-1",
          tool: "short_fiction_run",
          label: "短篇生产",
          status: "running",
          startedAt: 10,
        },
      },
    });
    await store.getState().loadSessionDetail(sessionId);
    expect(fakeEventSources).toHaveLength(1);
    return sessionId;
  }

  function findTaskExecution(store: ReturnType<typeof createTestStore>, sessionId: string) {
    return (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .find((execution) => execution.id === "direct-short_run-1");
  }

  it("sends a chat message while a production task is running without aborting the task", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    fetchJson.mockClear();
    fetchJson.mockResolvedValueOnce({ response: "任务还在跑。", session: { sessionId, sessionKind: "short" } });

    await store.getState().sendMessage(sessionId, "写得怎么样了？");

    // 发送没有被挡、也没有调用 abort 接口
    const calledPaths = fetchJson.mock.calls.map(([path]) => path);
    expect(calledPaths).toContain("/agent");
    expect(calledPaths).not.toContain(`/sessions/${sessionId}/abort`);
    // 单连接原则：旧的任务恢复连接被换成新连接
    expect(fakeEventSources).toHaveLength(2);
    expect(fakeEventSources[0]?.closed).toBe(true);
    expect(fakeEventSources[1]?.closed).toBe(false);
    // 聊天轮结束后任务仍在跑：isStreaming 保持 true、连接保持、任务卡还在 running
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });
    expect(store.getState().sessions[sessionId]?.stream).not.toBeNull();
    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "running" });
    // 聊天回复正常写入
    expect(store.getState().sessions[sessionId]?.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "任务还在跑。",
    });
  });

  it("keeps the task stream open when the chat round completes while the task is still running", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));

    const sent = store.getState().sendMessage(sessionId, "顺便聊两句");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    // 聊天轮的 agent:complete 到达时任务仍在跑：不能把连接关掉
    fakeEventSources[1]?.emit("agent:complete", { sessionId });
    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });

    resolveAgent({ response: "聊完了。", session: { sessionId, sessionKind: "short" } });
    await sent;

    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });

    // 任务完成：tool:end 按 execution id 找到早前消息里的任务卡收尾，随后的 agent:complete 关闭连接
    fakeEventSources[1]?.emit("tool:end", {
      sessionId,
      id: "direct-short_run-1",
      tool: "short_fiction_run",
      result: { content: [{ type: "text", text: "短篇已完成" }] },
    });
    fakeEventSources[1]?.emit("agent:complete", { sessionId });

    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "completed" });
    expect(fakeEventSources[1]?.closed).toBe(true);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: false, stream: null });
  });

  it("keeps the streaming chat open when a terminal task snapshot lands mid-chat", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let resolveAgent!: (value: unknown) => void;
    fetchJson.mockClear();
    fetchJson.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAgent = resolve;
    }));

    const sent = store.getState().sendMessage(sessionId, "顺便聊两句");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    // 竞态：任务刚结束、消息里还有 in-flight 任务卡，此刻聊天轮建立的新连接
    // 收到服务端重放的终态快照。任务卡要收尾，但正在流式的聊天连接不能被关掉。
    fakeEventSources[1]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "direct-short_run-1",
        tool: "short_fiction_run",
        label: "短篇生产",
        status: "completed",
        startedAt: 10,
        completedAt: 40,
        result: "短篇已完成",
      },
    });

    // 任务卡转为 completed
    expect(findTaskExecution(store, sessionId)).toMatchObject({
      status: "completed",
      result: "短篇已完成",
    });
    // 聊天轮仍在流式：连接未关、流式状态保持
    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: true });
    expect(store.getState().sessions[sessionId]?.stream).not.toBeNull();

    resolveAgent({ response: "聊完了。", session: { sessionId, sessionKind: "short" } });
    await sent;

    // 聊天轮自己收尾：任务已完成，连接关闭
    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });
    expect(fakeEventSources[1]?.closed).toBe(true);
  });

  it("closes the stream after a plain chat round when no production task is running", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "chat" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "你好");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: true });

    resolveAgent({ response: "你好！", session: { sessionId, sessionKind: "chat" } });
    await sent;

    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: false,
      isChatStreaming: false,
      stream: null,
    });
    expect(fakeEventSources[0]?.closed).toBe(true);
  });

  it("aborts only the chat round with scope=chat and keeps the running task card intact", async () => {
    const store = createTestStore();
    const sessionId = await setupRunningTaskSession(store);

    let rejectAgent!: (error: Error) => void;
    fetchJson.mockClear();
    fetchJson
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectAgent = reject;
      }))
      .mockResolvedValueOnce({ ok: true, aborted: true });

    const sent = store.getState().sendMessage(sessionId, "顺便问一下");
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(2));

    await store.getState().abortSession(sessionId, "chat");

    const abortCall = fetchJson.mock.calls.find(([path]) => path === `/sessions/${sessionId}/abort`);
    expect(abortCall?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ scope: "chat" }),
    });
    // scope=chat 不把任务卡标记为失败，也不关任务连接
    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "running" });
    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true, isChatStreaming: false });

    rejectAgent(new Error("This operation was aborted"));
    await sent;

    // 聊天轮收尾后任务照旧运行
    expect(findTaskExecution(store, sessionId)).toMatchObject({ status: "running" });
    expect(fakeEventSources[1]?.closed).toBe(false);
    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });
  });
});
