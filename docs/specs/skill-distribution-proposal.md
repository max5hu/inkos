# Skill Distribution Proposal: 写作方法论的分层注入

## 现状诊断

### 当前架构

```
architect（LLM）→ planner（纯规则）→ composer（LLM）→ writer（LLM）→ auditor（LLM）
```

### 各 agent 的 skill 认知

| Agent | 用 LLM？ | 知道 skill？ | 实际情况 |
|-------|---------|-------------|---------|
| **architect** | 是 | 部分 | 有"黄金三章法则""冲突开篇法"（硬编码�� prompt 里），但没有情绪升级、代入感、流水账修法 |
| **planner** | **否（纯规则引擎）** | 极少 | 只有 mood/scene/title directive（基于 cadence 分析的机械规则），不知道黄金三章、欲望驱动、情绪升级 |
| **composer** | 是 | 无 | 组装 contextPackage + ruleStack，不注入任何写作方法论 |
| **writer** | 是 | **全部（4500 tokens）** | 9 个方法论模块全塞在 system prompt 里 |
| **auditor** | 是 | 部分 | 有"爽点虚化""流水账"审查维度，但不知道"欲望驱动""情绪升级""盐溶于汤" |
| **reviser** | 是 | 无 | 只有 tiered issues，不知道写作方法论 |

### 核心问题

1. planner 是纯规则引擎，不调 LLM → 不能通过 prompt 注入 skill → 只能硬编码
2. writer 扛了全部 skill（4500 tokens）→ 注意力分散 → 方法论被 lost in the middle
3. architect 有一些 skill（黄金三章、冲突开篇）但不完整
4. auditor 有审查维度但不知道对应的写作技法
5. 层间没有 skill 传递机制 → planner 不知道黄金三章 → 生成的 goal 不包含"ch1 冲突开场"指令 → writer 的黄金三章规则被 goal 覆盖

## 方案：skill 按职责分层

### 原则

每个 agent 只拿它那个层级能用的 skill。不是"谁都塞全套"，是"谁做什么决策就给它什么工具"。

### 层级划分

```
┌─────────────────────────────────────────────────────────┐
│ L1: 结构层 skill（architect + planner）                   │
│     · 决定"故事怎么组织"                                  │
│     · 黄金开篇（按语言区分）：                               │
│       中文：黄金3章 ch1冲突 ch2金手指 ch3短期目标             │
│       英文：黄金5章 ch1冲突 ch2金手指 ch3目标                │
│              ch4第一个大爽点 ch5提升赌注/新势力介入            │
│     · 情绪波形：压制→释放→更大压制→更大释放                 │
│     · 节奏控制：连续 2 章高压后必须给呼吸空间               │
│     · 日常段必须为主线服务（万物皆为"饵"）                  │
│     · 开篇场景限制：最多 1-2 场景、3 角色                  │
│     · 付费卡点意识（按语言区分）：                           │
│       中文：第15章付费墙，但前3章决定留存                    │
│       英文：第6-8章付费墙，前5章必须建立强追读动力           │
├─────────────────────────────────────────────────────────┤
│ L2: 内容层 skill（writer）                                │
│     · 决定"每段话怎么写"                                  │
│     · 动作外化情绪（不写"他感到愤怒"）                     │
│     · 盐溶于汤（价值观通过行为传达）                       │
│     · 五感描写（视觉/听觉/嗅觉/触觉/味觉）               │
│     · 具体化/可视化/熟悉感                                │
│     · 句式控制（少用"虽然但是"/"然而"/"了"）               │
│     · 通过事件立人设（不用外貌描写堆砌）                   │
│     · 语言区分度（不同角色说话方式不同）                   │
├─────────────────────────────────────────────────────────┤
│ L3: 审查层 skill（auditor + reviser）                     │
│     · 决定"写得好不好"                                    │
│     · 流水账检测：有没有无冲突的���常流水叙述                │
│     · 欲望缺口检测：有没有制造读者的情绪缺口               │
│     · 人设一致性：角色行为是否由"经历+利益+性格"驱动        │
│     · 爽点密度：本章有没有至少一个读者满足点               │
│     · 代入感检查：主角困境是否有普遍性共鸣                 │
│     · AI-tell 检测：已有的确定性检查                       │
└─────────────────────────────────────────────────────────┘
```

### 具体实现

#### L1: architect + planner

**architect**（已有 LLM 调用）:
- 当前已有：黄金三章法则、冲突开篇法 → 保留
- 需新增：情绪波形设计（volume_outline 里应该标注每卷的情绪曲线）
- 需新增：付费卡点意识（前 6-8 章的 outline 要特别密集）

**planner**（纯规则引擎，不调 LLM）:
- 当前已有：moodDirective（连续高压后降调）、sceneDirective（连续同场景后换场）→ 保留
- 需新增的**硬编码规则**：
  ```typescript
  // 黄金开篇（按语言区分）
  const goldenLimit = language === "en" ? 5 : 3;
  if (chapterNumber <= goldenLimit) {
    intent.mustKeep.push(GOLDEN_CHAPTER_RULES[language][chapterNumber]);
  }

  // 付费卡点前强化钩子
  const paywallZone = language === "en" ? [4, 8] : [10, 15];
  if (chapterNumber >= paywallZone[0] && chapterNumber <= paywallZone[1]) {
    const msg = language === "en"
      ? "Paywall approaching — chapter must end with a strong cliffhanger that makes the reader unable to stop"
      : "本章结尾必须有强悬念钩子，读者即将进入付费区";
    intent.mustKeep.push(msg);
  }

  // 日常段服务主线
  if (cadence.moodPressure?.pressure === "low") {
    const msg = language === "en"
      ? "This quiet chapter must still plant a hook or advance a relationship — no pure filler"
      : "日常段必须埋伏笔或推关系，不可纯填充";
    intent.softConstraints.push(msg);
  }
  ```
- 关键：planner 不是 LLM，不能"理解" skill → 只能把 skill 翻译成具体的 mustKeep/mustAvoid/directive 规则

#### L2: writer

- 从 system prompt 移除 9 个完整方法论模块（-4500 tokens）
- 替换为速查卡（~800 tokens）—— 只有规则，不需要例子（因为 L1 已经确保结构正确）
- 完整方法论写进 style_guide.md（writer 读 style_guide，进入上下文但不占 system prompt 核心位置）

速查卡内容：
```
## 写作铁律
- 情绪用动作外化，不写"他感到愤怒"，写"他捏碎了茶杯"
- 盐溶于汤：价值观通过行为传达
- 配角有自己的算盘，主角压服聪明人
- 五感代入：潮湿的短袖黏在后背上、医院消毒水的味
- 具体化：不写"大城市"，写"三环堵了四十分钟的出租车后座"
- 句式：少用"虽然但是/然而/因此"，用角色吐槽替代
- 禁止：资料卡式介绍角色 / 一次引入超3角色 / 众人齐声惊呼
- 人设三问：为什么？符合人设？读者突兀？
```

#### L3: auditor

- 当前审查维度已有：爽点虚化、流水账 → 保留
- 需新增维度描述（不是新代码，是审稿 prompt 里的维度说明）：
  ```
  维度 N: 欲望缺口——本章是否制造了读者的情绪缺口（压制后期待释放）？
  维度 M: 代入感——主角的困境是否有普遍性？读者能否觉得"我也会这么做"？
  ```

### 改动量估算

| 文件 | 改动 | 大小 |
|------|------|------|
| `planner.ts` | 加黄金三章/付费卡点/日常服务主线的硬编码规则 | ~30 行 |
| `writer-prompts.ts` | 9 个完整模块 → 1 个速查卡函数 | -3500 tokens, +800 tokens |
| `writer.ts` initBook 路径 | 把完整方法论写入 style_guide.md | ~20 行 |
| `continuity.ts` | 审稿维度描述加欲望缺口和代入感 | ~10 行 |
| `architect.ts` | 加情绪波形和付费卡点提示 | ~15 行 |

### 效果预期

| 指标 | 改前 | 改后 |
|------|------|------|
| writer system prompt tokens | ~8000 | ~4300（-46%）|
| planner 黄金三章感知 | ❌ | ✅（硬编码规则）|
| planner 付费卡点意识 | ❌ | ✅（ch4-8 加强钩子）|
| auditor 欲望缺口检测 | ❌ | ✅ |
| skill 跨层传递 | writer 独扛 | 各层各司其职 |

### 风险

1. planner 是纯规则引擎，硬编码规则不如 LLM prompt 灵活 → 但 planner 的决策本来就是结构性的，硬编码更可靠
2. writer 速查卡可能不如完整版有效 → 但 style_guide 有完整版兜底，只是注意力层级低一些
3. 改动涉及 4 个 agent → 需要回归测试 → 但每个改动都很小（10-30 行）
