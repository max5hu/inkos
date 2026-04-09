# InkOS vs webnovel-writer 差距分析

> 参考项目：https://github.com/lingfengQAQ/webnovel-writer
> 本地副本：/Users/majunxian/Desktop/PyProject/webnovel-writer

## 核心差距（按优先级）

### G1: outline 粒度（最大差距）
- **他们**：每章 16 字段（目标/阻力/代价/时间锚/爽点类型/Strand/钩子类型/反派层级/视角/关键实体/章末开放问题...）
- **我们**：卷级事件描述（"第13-17章：红岸残响"），不到章
- **影响**：斗破5章只推一个beat、三体全是会议
- **修法**：planner 调 LLM 做 chapter beat decomposition

### G2: 写前 brief（Context Agent）
- **他们**：3 层 8 面板的"创作执行包"
  - Layer 1: 任务简报（核心任务/接前章/出场人物状态/场景约束/时间约束/风格指导/伏笔紧迫度/读者牵引）
  - Layer 2: 上下文契约（冲突一句话/开场类型/情绪节奏/信息密度）
  - Layer 3: 直接写作提示（章内节拍：开场→推进→反转→钩子）
- **我们**：chapterIntent（一句 goal + mustKeep 数组 + hookAgenda）
- **修法**：planner LLM 输出结构化 chapter brief

### G3: Anti-AI（写完后独立审+阻断）
- **他们**：7 层逐段检查，200+ 词 blocklist，改写算法，`anti_ai_force_check: pass/fail` 阻断
  - L1: 10 类高危词（总结词/枚举词/学术腔/逻辑连接/直接情绪/动作套话/环境套话/叙事废话/抽象词/机械开头）
  - L2: 句式规则（禁3段式/禁连续同结构/禁列表叙述）
  - L3: 形容词副词限制（一名词前≤2形容词/每300字≤4程度副词）
  - L4: 四字成语限制（每500字≤3个/不连续/必须服务叙事）
  - L5: 对话去AI（禁说明书式/对话必须有意图/允许犹豫打断反问）
  - L6: 段落结构（单句段25-45%/段落20-100字/场景转换用动作）
  - L7: 标点节奏（不连续省略号感叹号/每段≤1个/4逗号以上必须拆）
  - 改写算法：抽象情绪→生理反应+意图+动作 / 结论句→事实+代价+决定 / 3+解释→混对话动作反问
- **我们**：analyzeAITells 确定性检测（5个高疲劳词）+ craft card 提示，不阻断
- **修法**：加独立 polish 步骤，从 webnovel-writer 的 polish-guide.md 抽取规则

### G4: Strand Weave 节奏配比
- **他们**：Quest 55-65% / Fire 20-30% / Constellation 10-20%，最大连续/缺席限制，30章模板
- **我们**：cadence mood/scene 分析（只检测连续同类型，不做配比规划）
- **修法**：在 planner 加 strand 追踪，plan 阶段分配每章 strand 类型

### G5: 时间系统
- **他们**：时间锚点 + 倒计时系统（"末世第3天"）+ 与上章时差 + 章内时间跨度
- **我们**：无
- **修法**：可选功能，在特定题材启用

### G6: 实体管理
- **他们**：AI 实体提取 + 置信度评分（>0.8自动/0.5-0.8警告/<0.5人审）+ 场景分块 + 向量索引
- **我们**：memory.db fact history（较简单）
- **修法**：可选增强，非核心

### G7: 题材 Profile 深度
- **他们**：每题材有定制参数（钩子偏好/爽点密度/微兑现配置/节奏红线/约束豁免）+ 反套路库 + 反派类型库
- **我们**：genre profile 有基础字段（satisfactionTypes/chapterTypes/fatigueWords），但没有钩子偏好和反套路库
- **修法**：扩展 genre profile + 从 webnovel-writer 移植反套路库

### G8: 债务系统（Override Contract）
- **他们**：过渡章无法满足爽点要求时签"欠条"，约定几章内补偿，10%/章利息
- **我们**：无
- **修法**：可选，优先级低

## 我们的独有优势（他们没有的）

1. **Hook lifecycle-aware 调度**：按 payoffTiming（immediate/near-term/mid-arc/slow-burn/endgame）差异化调度
2. **评分循环取最高分**：3 轮 assess→revise→assess，自动选最佳版本
3. **Continuation/Series 导入模式**：支持从已有作品续写/新时空生成
4. **多模型支持**：不绑死 Claude，可对接 OpenAI/DeepSeek/Qwen
5. **全自动 pipeline**：一条命令走完，不需要人在 loop 里
6. **narrative-control sanitize**：控制层泄漏的系统性防护（虽然还没完美）

## 修复优先级

| 优先级 | 差距 | 改动 | 预期效果 |
|--------|------|------|----------|
| P0 | G1+G2 | planner 调 LLM 做 beat decomposition + chapter brief | 解决节奏慢 + mustKeep 污染 |
| P0 | G3 | 独立 anti-AI polish 步骤 | 解决 AI 味 |
| P1 | G4 | Strand Weave 节奏配比 | 章节类型多样性 |
| P1 | G7 | 题材 profile 扩展 + 反套路库 | 番茄商业化 |
| P2 | G5 | 时间系统 | 时间逻辑一致性 |
| P2 | G6 | 实体管理增强 | 长篇连续性 |
| P3 | G8 | 债务系统 | 节奏弹性 |

## 关键文件参考（webnovel-writer 本地）

| 功能 | 文件 |
|------|------|
| Context Agent 执行包 | `webnovel-writer/agents/context-agent.md` |
| Anti-AI 7 层 | `webnovel-writer/skills/webnovel-write/references/polish-guide.md` |
| Strand Weave | `webnovel-writer/references/shared/strand-weave-pattern.md` |
| 爽点指南 | `webnovel-writer/references/shared/cool-points-guide.md` |
| 每章大纲规划 | `webnovel-writer/skills/webnovel-plan/references/outlining/chapter-planning.md` |
| 题材 Profile | `webnovel-writer/references/genre-profiles.md` |
| 题材套路库 | `webnovel-writer/skills/webnovel-init/references/genre-tropes.md` |
| 反套路规则 | `webnovel-writer/skills/webnovel-init/references/creativity/anti-trope-*.md` |
| 审查器输出格式 | `webnovel-writer/references/checker-output-schema.md` |
| 上下文契约 | `webnovel-writer/references/context-contract-v2.md` |
| 战斗场景写法 | `webnovel-writer/skills/webnovel-write/references/writing/combat-scenes.md` |
| 对话写法 | `webnovel-writer/skills/webnovel-write/references/writing/dialogue-writing.md` |
| 情绪心理写法 | `webnovel-writer/skills/webnovel-write/references/writing/emotion-psychology.md` |
| 场景描写 | `webnovel-writer/skills/webnovel-write/references/writing/scene-description.md` |
| 钩子/爽点类型库 | `webnovel-writer/skills/webnovel-write/references/writing/genre-hook-payoff-library.md` |
