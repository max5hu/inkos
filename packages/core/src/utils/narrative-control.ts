import type { ChapterBrief, ContextPackage } from "../models/input-governance.js";

const HOOK_ID_PATTERN = /\bH\d+\b/gi;
const HOOK_SLUG_PATTERN = /\b[a-z]+(?:-[a-z]+){1,3}\b/g;
const CHAPTER_REF_PATTERNS: ReadonlyArray<RegExp> = [
  /\bch(?:apter)?\s*\d+\b/gi,
  /第\s*\d+\s*章/g,
];

const ZH_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/前几章/g, "此前"],
  [/本章要做的是/g, "眼下要处理的是"],
  [/本章要做的/g, "眼下要处理的"],
  [/仿佛/g, "像"],
  [/似乎/g, "像是"],
];

const EN_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\bprevious chapters\b/gi, "earlier scenes"],
  [/\bthis chapter needs to\b/gi, "the current move is to"],
];

export function sanitizeNarrativeControlText(
  text: string,
  language: "zh" | "en" = "zh",
): string {
  let result = text;

  result = result.replace(HOOK_ID_PATTERN, language === "en" ? "this thread" : "这条线索");
  result = result.replace(HOOK_SLUG_PATTERN, language === "en" ? "this thread" : "这条线索");
  for (const pattern of CHAPTER_REF_PATTERNS) {
    result = result.replace(pattern, language === "en" ? "an earlier scene" : "此前");
  }

  for (const [pattern, replacement] of [...ZH_REPLACEMENTS, ...EN_REPLACEMENTS]) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Render a ChapterBrief into a sanitized narrative control block for the
 * writer / reviser prompt. This replaces the old buildNarrativeIntentBrief
 * path: the brief is the single source of chapter intent.
 */
export function renderBriefAsNarrativeBlock(
  brief: ChapterBrief,
  language: "zh" | "en" = "zh",
): string {
  // Sanitize free-text fields only. Enum/identifier fields (chapterType,
  // beat.phase, hook.movement, hookId) are passed through verbatim to
  // avoid HOOK_SLUG_PATTERN corrupting hyphenated values like
  // "knife-twist", "partial-payoff", "golden-opening".
  const s = (text: string) => sanitizeNarrativeControlText(text, language);
  const isEn = language === "en";

  const sections: string[] = [];

  // Goal — free text, sanitize
  sections.push(`## ${isEn ? "Goal" : "目标"}\n- ${s(brief.goal)}`);

  // Chapter type — enum value, do NOT sanitize
  sections.push(`## ${isEn ? "Chapter Type" : "章节类型"}\n- ${brief.chapterType}`);

  // Beat outline — phase is enum, instruction is free text
  if (brief.beatOutline.length > 0) {
    const beats = brief.beatOutline
      .map((beat) => `- ${beat.phase}: ${s(beat.instruction)}`)
      .join("\n");
    sections.push(`## ${isEn ? "Beat Outline" : "节拍大纲"}\n${beats}`);
  }

  // Hook plan — hookId and movement are identifiers, targetEffect is free text
  if (brief.hookPlan.length > 0) {
    const hooks = brief.hookPlan
      .map((hook) => `- ${hook.hookId} | ${hook.movement} | ${s(hook.targetEffect)}`)
      .join("\n");
    sections.push(`## ${isEn ? "Hook Plan" : "伏笔计划"}\n${hooks}`);
  }

  // Dormant reason — free text, sanitize
  if (brief.dormantReason) {
    sections.push(
      `## ${isEn ? "Dormant Hooks" : "按兵不动的伏笔"}\n- ${s(brief.dormantReason)}`,
    );
  }

  // Props and setting — proper nouns, do NOT sanitize
  if (brief.propsAndSetting.length > 0) {
    sections.push(
      `## ${isEn ? "Props & Setting" : "道具与场景"}\n- ${brief.propsAndSetting.join(", ")}`,
    );
  }

  // Golden opening flag
  if (brief.isGoldenOpening) {
    sections.push(
      `## ${isEn ? "Golden Opening" : "黄金开场"}\n- ${isEn ? "This is a golden opening chapter — prioritize hook-dense, high-tempo pacing." : "本章是黄金开场章——优先钩子密集、高节奏。"}`,
    );
  }

  return sections.join("\n\n");
}

export function buildNarrativeIntentBrief(
  chapterIntent: string,
  language: "zh" | "en" = "zh",
): string {
  const sections = [
    { heading: "## Goal", label: language === "en" ? "Goal" : "目标" },
    { heading: "## Outline Node", label: language === "en" ? "Outline Node" : "当前节点" },
    { heading: "## Must Keep", label: language === "en" ? "Keep" : "保留" },
    { heading: "## Must Avoid", label: language === "en" ? "Avoid" : "避免" },
    { heading: "## Style Emphasis", label: language === "en" ? "Style" : "风格" },
    { heading: "## Structured Directives", label: language === "en" ? "Directives" : "指令" },
  ] as const;

  const rendered = sections
    .map(({ heading, label }) => {
      const section = extractMarkdownSection(chapterIntent, heading);
      if (!section) return null;

      const lines = section
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !["- none", "- 无", "- 本轮无", "(not found)"].includes(line));
      if (lines.length === 0) return null;

      const normalized = lines
        .map((line) => line.startsWith("- ") ? line.slice(2) : line)
        .map((line) => sanitizeNarrativeControlText(line, language))
        .filter(Boolean)
        .map((line) => `- ${line}`)
        .join("\n");

      return `## ${label}\n${normalized}`;
    })
    .filter((section): section is string => Boolean(section));

  return rendered.join("\n\n");
}

export function renderNarrativeSelectedContext(
  entries: ReadonlyArray<ContextPackage["selectedContext"][number]>,
  language: "zh" | "en" = "zh",
): string {
  const heading = language === "en" ? "Evidence" : "证据";
  const reasonLabel = language === "en" ? "reason" : "原因";
  const detailLabel = language === "en" ? "detail" : "细节";

  return entries
    .map((entry, index) => {
      const lines = [
        `### ${heading} ${index + 1}`,
        `- ${reasonLabel}: ${sanitizeNarrativeControlText(entry.reason, language)}`,
        entry.excerpt ? `- ${detailLabel}: ${sanitizeNarrativeControlText(entry.excerpt, language)}` : "",
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function sanitizeNarrativeEvidenceBlock(
  block: string | undefined,
  language: "zh" | "en" = "zh",
): string | undefined {
  if (!block) return undefined;
  const withoutSources = block.replace(
    /(^|\n)-\s+(?:story|runtime)\/[^:\n]+:\s*/g,
    (_match, prefix: string) => `${prefix}- evidence: `,
  );
  return sanitizeNarrativeControlText(withoutSources, language);
}

function extractMarkdownSection(content: string, heading: string): string | undefined {
  const lines = content.split("\n");
  let buffer: string[] | null = null;

  for (const line of lines) {
    if (line.trim() === heading) {
      buffer = [];
      continue;
    }

    if (buffer && line.startsWith("## ") && line.trim() !== heading) {
      break;
    }

    if (buffer) {
      buffer.push(line);
    }
  }

  const section = buffer?.join("\n").trim();
  return section && section.length > 0 ? section : undefined;
}
