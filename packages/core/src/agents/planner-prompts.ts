/**
 * Planner prompts for Phase 3 (new.txt methodology).
 *
 * The planner LLM receives the system prompt verbatim and a user message
 * assembled from `buildPlannerUserMessage`. Output is YAML frontmatter +
 * markdown body (NOT JSON-with-embedded-markdown).
 */

export const PLANNER_MEMO_SYSTEM_PROMPT = `你是这本小说的创作总编，职责是为下一章产生一份 chapter_memo。你不写正文——你只规划这章要完成什么、兑现什么、不要做什么。下游写手（writer）会按你的 memo 扩写正文。

你的工作原则（内化，不要在 memo 里引用条目号）：

1. 3-5 章一个小目标周期：每 3-5 章必须有一个小目标达成或悬念升级，主线持续推进
2. 主动塑造读者期待：作者刻意制造"还没兑现但快要兑现"的缺口，兑现时必须超过读者预期 70%
3. 万物皆饵：日常/过渡章节的每一笔都要是未来剧情的伏笔或钩子
4. 人设防崩：角色行为由"过往经历 + 当前利益 + 性格底色"共同驱动。禁止反派突然降智、主角突然圣母
5. 1 主线 + 1 支线：支线必须为主线服务，不同时推 3 条以上支线
6. 爽点密集化：每 3-5 章一个小爽点（小冲突→快解决→强反馈），全员智商在线
7. 高潮前铺垫：大高潮前 3-5 章必须有线索埋设
8. 高潮后影响：爆发章之后 1-2 章必须写出改变（主线推进、人设成长、关系变化）
9. 人物立体化：核心标签 + 反差细节 = 活人
10. 五感具体化：场景描写必须有具体可视化感官细节
11. 钩子承接：每章章尾留钩

## 输出格式（严格遵守）

输出 YAML frontmatter + markdown body，不要用 JSON 对象包 markdown 字符串，不要加代码块标记。

结构如下：

---
chapter: 12
goal: 把七号门被动过手脚从猜测钉成现场实证
isGoldenOpening: false
threadRefs:
  - H03
  - S004
---

## 当前任务
<一句话：本章主角要完成的具体动作，不要抽象描述>

## 读者此刻在等什么
<两行：
1) 读者现在期待什么（基于前几章的埋伏）
2) 本章对这个期待做什么——制造更强缺口 / 部分兑现 / 完全兑现 / 暂不兑现但给暗示>

## 该兑现的 / 暂不掀的
- 该兑现：X → 兑现到什么程度
- 暂不掀：Y → 先压住，留到第 N 章

## 日常/过渡承担什么任务
<如果本章是非高压章节，每段非冲突段落说明功能。格式：[段落位置] → [承担功能]
如果本章是高压/冲突章节，写"不适用 - 本章无日常过渡">

## 关键抉择过三连问
- 主角本章最关键的一次选择：
  - 为什么这么做？
  - 符合当前利益吗？
  - 符合他的人设吗？
- 对手/配角本章最关键的一次选择：
  - 为什么这么做？
  - 符合当前利益吗？
  - 符合他的人设吗？

## 章尾必须发生的改变
<1-3 条，从以下维度选：信息改变 / 关系改变 / 物理改变 / 权力改变>

## 不要做
<2-4 条硬约束>

## 输出要求

- goal 字段不超过 50 字
- threadRefs 是 YAML 数组，内容是从输入的 pending_hooks/subplot_board 中挑出的 id
- 每个二级标题（##）必须出现，内容不能为空
- 不要在 memo 里提方法论术语（"情绪缺口"、"cyclePhase"、"蓄压"等）——直接用这本书的人物、地点、事件说事
- 不要产生正文片段或对话片段
- 如果卷纲和上章摘要冲突，信上章摘要（剧情已实际发生）`;

export const PLANNER_MEMO_USER_TEMPLATE = `# 第 {{chapterNumber}} 章 memo 请求

## 上一章最后一屏（原文节选）
{{previous_chapter_ending_excerpt}}

## 最近 3 章摘要
{{recent_summaries}}

## 当前 arc 正在推进什么
{{current_arc_prose}}

## 主角当前状态
{{protagonist_matrix_row}}

## 本章主要对手/阻力方
{{opponent_rows}}

## 本章主要协作者
{{collaborator_rows}}

## 可能被牵动的 thread（伏笔 + 支线）
{{relevant_threads}}

## 本章卷外约束
- 是否黄金三章：{{isGoldenOpening}}
- 硬约束（摘取本章可能触碰的条目）：
{{book_rules_relevant}}

请为第 {{chapterNumber}} 章产生 memo。严格按 YAML frontmatter + markdown 格式输出。`;

export interface PlannerUserMessageInput {
  readonly chapterNumber: number;
  readonly previousChapterEndingExcerpt: string;
  readonly recentSummaries: string;
  readonly currentArcProse: string;
  readonly protagonistMatrixRow: string;
  readonly opponentRows: string;
  readonly collaboratorRows: string;
  readonly relevantThreads: string;
  readonly isGoldenOpening: boolean;
  readonly bookRulesRelevant: string;
  readonly language?: "zh" | "en";
}

export function buildPlannerUserMessage(input: PlannerUserMessageInput): string {
  const filled = PLANNER_MEMO_USER_TEMPLATE
    .replaceAll("{{chapterNumber}}", String(input.chapterNumber))
    .replaceAll("{{previous_chapter_ending_excerpt}}", input.previousChapterEndingExcerpt)
    .replaceAll("{{recent_summaries}}", input.recentSummaries)
    .replaceAll("{{current_arc_prose}}", input.currentArcProse)
    .replaceAll("{{protagonist_matrix_row}}", input.protagonistMatrixRow)
    .replaceAll("{{opponent_rows}}", input.opponentRows)
    .replaceAll("{{collaborator_rows}}", input.collaboratorRows)
    .replaceAll("{{relevant_threads}}", input.relevantThreads)
    .replaceAll("{{isGoldenOpening}}", input.isGoldenOpening ? "是" : "否")
    .replaceAll("{{book_rules_relevant}}", input.bookRulesRelevant);

  const golden = buildGoldenOpeningGuidance(input.chapterNumber, input.language ?? "zh");
  return golden ? `${filled}\n\n${golden}` : filled;
}

// ---------------------------------------------------------------------------
// 黄金三章 prose guidance — Phase 6.5
// Single conditional append (chapterNumber <= 3). No new schema, no new
// runtime branch. Cohesive paragraphs, NOT a numbered checklist.
// ---------------------------------------------------------------------------

export function buildGoldenOpeningGuidance(
  chapterNumber: number,
  language: "zh" | "en" = "zh",
): string {
  if (chapterNumber > 3) return "";

  if (language === "en") {
    return `## Golden Opening Guidance — Chapter ${chapterNumber}

This is chapter ${chapterNumber} of the opening three — the chapters that decide whether a reader stays. The Golden Three Chapters rule from new.txt assigns each chapter a load-bearing slot: chapter 1 must throw the reader straight into the core conflict (the protagonist enters already facing the main contradiction — chase, dead-end, dispossession, transmigration-as-crisis), not a paragraph of background, family tree, weather, or dynastic preamble. Chapter 2 must put the protagonist's edge — the system, the power, the rebirth-memory, the information advantage — on the stage through one concrete event (not "he awakened a power" narrated, but "he used it for X and Y happened"). Chapter 3 must lock in a concrete short-term goal achievable within the next 3-10 chapters (build the first stake of capital, take down the small antagonist, save someone), giving the story forward pull.

The memo's goal field for this chapter must reflect the slot's verb — confront, demonstrate, or commit. The chapter-end change must be a small hook or emotional gap, never a flat resolution. Apply the opening-economy rule throughout: at most three scenes and at most three named characters this chapter (a side character may be only a name without expansion). Information layering is mandatory — basic facts (appearance, status, situation) ride on the protagonist's actions, world rules ride on plot triggers; do not stage a paragraph of exposition.`;
  }

  return `## 黄金三章规划指引 — 第 ${chapterNumber} 章

这是开篇三章中的第 ${chapterNumber} 章——决定读者是否留下来的关键章节。new.txt 的黄金三章法则给每一章分了硬槽位：第 1 章必须把主角直接抛进核心冲突里（主角出场即面对主线矛盾——追杀、死局、被夺权、穿越即危机），不要拿背景、家族、天气、朝代铺垫开场。第 2 章必须让金手指落地一次——系统/能力/重生记忆/信息差，必须通过**一次具体事件**展现出来（不是"他觉醒了 XX"的旁白，而是"他用了 XX，发生了 YY"）。第 3 章必须给主角钉下一个 3-10 章内可达成的具体短期目标（攒第一桶金、干翻某小反派、救某人），给故事一条往前拉的引力线。

本章 memo 的 goal 字段必须体现对应槽位的动词——抛出、展现、或锁定。章尾必须发生的改变要落在小钩子或情绪缺口上，不要写成平稳收束。开篇精简原则贯穿本章：场景 ≤ 3 个、人物 ≤ 3 个（配角可以只报名字，不展开）。信息分层强制要求：基础信息（外貌、身份、处境）通过主角行动自然带出，世界规则（设定、势力、底层逻辑）结合剧情节点揭示，禁止整段 exposition。`;
}
