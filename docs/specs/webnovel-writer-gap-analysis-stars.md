# InkOS vs webnovel-writer 星级差距总览

## 维度评级

| 维度 | webnovel-writer | InkOS | 差距说明 |
|------|:-:|:-:|---|
| outline 粒度 | ★★★★★ | ★★☆ | 每章16字段 vs 卷级描述 |
| 写前 brief | ★★★★★ | ★★☆ | 3层8面板执行包 vs 一句goal |
| Anti-AI | ★★★★★ | ★★☆ | 7层200+词+改写算法+阻断 vs 确定性检测+提示 |
| 审稿深度 | ★★★★★ | ★★★☆ | 6独立checker vs 1个auditor（但InkOS有33维度） |
| 伏笔管理 | ★★★★ | ★★★★ | 差距小（两者都有紧迫度排序） |
| 节奏控制 | ★★★★★ | ★★☆ | Strand Weave+时间系统 vs cadence mood分析 |
| 状态管理 | ★★★★ | ★★★★ | 差距小（两者都有持久化状态） |
| 实体管理 | ★★★★★ | ★★☆ | 置信度实体提取 vs 无 |
| 题材 Profile | ★★★★★ | ★★★ | 12+题材定制参数+反套路库 vs 基础genre profile |
| 自动化程度 | ★★☆ | ★★★★★ | 半自动(Claude Code触发) vs 全自动pipeline |
| 多模型支持 | ★☆ | ★★★★★ | 绑死Claude vs 任意LLM |
| Hook 调度 | ★★★ | ★★★★★ | 简单紧迫度排序 vs lifecycle-aware timing profile |
| 导入/续写 | ☆ | ★★★★★ | 无 vs continuation/series/fanfic 三模式 |

## 版本演进分数追踪

### 断崖残局（玄幻生存）
| 版本 | 分数 | 核心问题 |
|------|------|----------|
| v6 | 92 | 基线最高 |
| v8 | 83.5 | 多门槛veto压掉修复 |
| v9r2 | 89.5 | 评分循环生效 |
| v9r3 | 90.5 | 控制层泄漏拉低到84（sanitize前） |
| v9 final | 84 | H001/"前几章"/"金手指"泄漏 |
| v10 | 72 | "第一章"/"小爽点"新型泄漏（mustKeep污染） |

### 旧城暗号（都市悬疑）
| 版本 | 分数 | 核心问题 |
|------|------|----------|
| v6 | 92 | 基线 |
| v8 | 76.5 | 最大跌幅 |
| v9r2 | 91 | 恢复 |
| v9r3 | 93 | 历史最高（sanitize前） |
| v9 final | 90 | ch5 有H-code泄漏 |
| v10 | 91 | 追读性9/10，接近可上架 |

### 斗破同人（同人）
| 版本 | 分数 | 核心问题 |
|------|------|----------|
| v8 | 73 | 基线 |
| v9r2 | 81 | 提升 |
| v9r3 | 82.5 | 微升 |
| v9 final | 82 | 节奏慢（退婚跨3章） |
| v10 | 78 | 更慢（5章1个beat），缺beat decomposition |

### 三体续写（续写模式）
| 版本 | 分数 | 核心问题 |
|------|------|----------|
| v8 | 56 | 会议室死循环 |
| v9 final | 85 | 大幅提升，偏家庭日常 |

### 三体系列（系列模式）
| 版本 | 分数 | 核心问题 |
|------|------|----------|
| v8 | 82 | 重述原著 |
| v9r3 (bug) | 69.4 | planner锚错到卷一 |
| v9 final | 90 | planner fix后outline全部落地 |
| v10 | 92 | 历史最高，钟绍林象棋场景最佳 |

## 关键根因追踪

### 问题1: 控制层泄漏
- v9: H001/H002/"前几章"/"金手指" → 修了narrative-control sanitize
- v10: "第一章"/"这一章"/"小爽点" → 根因：mustKeep槽被方法论污染
- 根本修法：craft rules 从 mustKeep 拆出去，planner 做语义编译

### 问题2: 节奏慢/beat稀疏
- 根因：系统缺少"volume outline → chapter beats"的中间层
- architect 给粗事件 → planner 原样传 → writer 在同一事件里打转
- 根本修法：planner 调 LLM 做 beat decomposition

### 问题3: AI味
- 根因：Anti-AI 只在写前给提示（教育），不在写后审+阻断（执法）
- webnovel-writer 方案：独立 polish 步骤，7层审查，pass/fail 阻断
- 根本修法：加独立 anti-AI polish 步骤

### 问题4: 写作方法论注入
- v9之前：governed mode 下9个方法论模块全部跳过
- v10：改成 craft card（800 tokens）+ style_guide 完整版
- 仍有问题：planner 的 skill 注入（injectStructuralSkills）混进 mustKeep 导致泄漏
- 根本修法：planner LLM 化，skill 编译成具体剧情指令

### 问题5: planner 太薄
- 现状：纯规则引擎，不调 LLM，只做 outline 匹配 + 数组 push
- 做不了：beat decomposition、craft brief 编译、标题生成
- webnovel-writer 方案：Context Agent（LLM）组装 3 层执行包
- AI_NovelGenerator 方案：chapter_blueprint（LLM）每章元数据
- 根本修法：planner 变成 LLM agent
