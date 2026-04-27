# AGENTS.md

InkOS 专业 agent 设计采用渐进式披露：先读 `docs/agents/agent-extraction-guide.md`，再按需深入 `docs/agents/<AgentName>.md`。

默认使用中文回答问题，并使用中文撰写计划和 SPEC 文件。

InkOS pi-agent 持久化模块设计在 `docs/superpowers/specs/2026-04-27-pi-agent-jsonl-persistence-design.md`，需要了解 JSONL transcript、requestId、toolResult、thinking、cache 和 legacy migration 时先读该文件。

## 回答结构规范

回答技术问题时要体现清晰的思考过程，而非堆叠语义相近的描述。

1. **先抽象分类**：先把问题归纳成少数几个大类，说明每一类解决什么核心矛盾。
2. **再建立推演链路**：按“问题背景 -> 关键数据结构 -> 执行步骤 -> 结果影响”的顺序解释机制。
3. **用证据支撑判断**：涉及源码时给出关键函数、字段、调用链或文件位置，让结论可以被验证。
4. **解释因果关系**：说明某个设计为什么能产生对应结果，以及缺少这个设计会触发什么失败场景。
5. **避免空泛对比**：不要用简单二分对比替代解释；对比只能作为结论，不能作为证明过程。
6. **控制信息密度**：每一层只放支撑当前结论所需的信息，细节服务于推理，不做无目的罗列。

## TypeScript 代码实践

回答或改写 TypeScript 代码时，先说明数据如何从“不可信输入”变成“可信领域对象”。每个判断都要回答四件事：它消除什么非法状态；由哪个类型、schema 或函数保证；下游因此获得什么前置条件；缺少它会触发什么失败场景。

### 1. 核心分类

1. **边界收敛**：外部输入不可信。文件、网络、JSON、数据库、第三方库返回值可以先是 `unknown`，但必须在模块边界通过 schema、parser 或 type guard 收窄。
2. **领域建模**：业务状态要可区分。字段集合随 `role`、`type`、`kind` 改变时，用 discriminated union，不用 optional 字段堆出一个宽接口。
3. **合法状态约束落地**：系统声称某份数据合法时必须满足的规则要有归属。单个对象自身就能判断的规则，放进类型或 schema；必须结合事件顺序、上下文或外部状态才能判断的规则，放进命名清楚的校验、转换或清理函数。
4. **演进验证**：新增分支不能静默漏处理。union 要穷尽处理，非法状态要有测试覆盖。

### 2. 推演链路

解释 TypeScript 代码时按这条链路展开：

```text
问题背景：哪些输入不可信，或哪些业务状态容易混在一起。
关键数据结构：raw input、validated event、domain message、cleaned message 分别是什么。
执行步骤：哪个函数负责读取，哪个函数负责收窄，哪个函数负责合法状态校验，哪个函数返回可信结果。
结果影响：下游少做哪些重复判断；缺少该设计时，非法状态会在哪里爆炸。
```

例如 transcript 恢复：`readTranscriptEvents()` 读取并解析事件，`committedMessageEvents()` 排除未提交请求，`cleanRestoredAgentMessages()` 清理孤立 `toolResult`、空 assistant 和非法 trailing thinking。推理重点不是“调用了这些函数”，而是这些函数分别阻断了哪些非法历史进入模型上下文。

### 3. 代码准则

1. 宽类型止于边界：`unknown`、`any`、`Record<string, unknown>` 不进入核心业务流程。
2. 互斥状态用 union：不要用大量 optional 字段模拟状态机。
3. 合法状态约束集中实现：不要把“必须 committed”“必须有对应 toolCall”“assistant 不能为空”散落成临时 `if`。
4. 类型断言要有证据：`as SomeType` 前面必须有 schema、parser 或 guard 支撑。
5. 分支处理要穷尽：用 `switch`、明确窄化和 `assertNever` 暴露新增分支。
6. 函数名表达可信度：`parse*` 表示可能失败，`normalize*` 表示转换形状，`clean*` 表示执行合法性修复。
7. 测试覆盖非法状态：恢复、迁移、IO、LLM message、tool loop 必须测坏数据、缺字段、未提交请求、孤立 `toolResult`、空 assistant、trailing thinking。
