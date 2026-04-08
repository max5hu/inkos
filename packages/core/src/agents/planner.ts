import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import { parseBookRules } from "../models/book-rules.js";
import { ChapterIntentSchema, type ChapterConflict, type ChapterIntent } from "../models/input-governance.js";
import {
  parseChapterSummariesMarkdown,
  renderHookSnapshot,
  renderSummarySnapshot,
  retrieveMemorySelection,
} from "../utils/memory-retrieval.js";
import { analyzeChapterCadence } from "../utils/chapter-cadence.js";
import { buildPlannerHookAgenda } from "../utils/hook-agenda.js";

export interface PlanChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
}

export interface PlanChapterOutput {
  readonly intent: ChapterIntent;
  readonly intentMarkdown: string;
  readonly plannerInputs: ReadonlyArray<string>;
  readonly runtimePath: string;
}

export class PlannerAgent extends BaseAgent {
  get name(): string {
    return "planner";
  }

  async planChapter(input: PlanChapterInput): Promise<PlanChapterOutput> {
    const storyDir = join(input.bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });

    const sourcePaths = {
      authorIntent: join(storyDir, "author_intent.md"),
      currentFocus: join(storyDir, "current_focus.md"),
      storyBible: join(storyDir, "story_bible.md"),
      volumeOutline: join(storyDir, "volume_outline.md"),
      chapterSummaries: join(storyDir, "chapter_summaries.md"),
      bookRules: join(storyDir, "book_rules.md"),
      currentState: join(storyDir, "current_state.md"),
    } as const;

    const [
      authorIntent,
      currentFocus,
      storyBible,
      volumeOutline,
      chapterSummaries,
      bookRulesRaw,
      currentState,
    ] = await Promise.all([
      this.readFileOrDefault(sourcePaths.authorIntent),
      this.readFileOrDefault(sourcePaths.currentFocus),
      this.readFileOrDefault(sourcePaths.storyBible),
      this.readFileOrDefault(sourcePaths.volumeOutline),
      this.readFileOrDefault(sourcePaths.chapterSummaries),
      this.readFileOrDefault(sourcePaths.bookRules),
      this.readFileOrDefault(sourcePaths.currentState),
    ]);

    const outlineNode = this.findOutlineNode(volumeOutline, input.chapterNumber);
    const matchedOutlineAnchor = this.hasMatchedOutlineAnchor(volumeOutline, input.chapterNumber);
    const goal = this.deriveGoal(input.externalContext, currentFocus, authorIntent, outlineNode, input.chapterNumber);
    const parsedRules = parseBookRules(bookRulesRaw);
    const mustKeep = this.collectMustKeep(currentState, storyBible);
    const mustAvoid = this.collectMustAvoid(currentFocus, parsedRules.rules.prohibitions);
    const styleEmphasis = this.collectStyleEmphasis(authorIntent, currentFocus);
    const conflicts = this.collectConflicts(input.externalContext, currentFocus, outlineNode, volumeOutline);
    const planningAnchor = conflicts.length > 0 ? undefined : outlineNode;
    const memorySelection = await retrieveMemorySelection({
      bookDir: input.bookDir,
      chapterNumber: input.chapterNumber,
      goal,
      outlineNode: planningAnchor,
      mustKeep,
    });
    const activeHookCount = memorySelection.activeHooks.filter(
      (hook) => hook.status !== "resolved" && hook.status !== "deferred",
    ).length;
    const hookAgenda = buildPlannerHookAgenda({
      hooks: memorySelection.activeHooks,
      chapterNumber: input.chapterNumber,
      targetChapters: input.book.targetChapters,
      language: input.book.language ?? "zh",
    });
    const directives = this.buildStructuredDirectives({
      chapterNumber: input.chapterNumber,
      language: input.book.language,
      volumeOutline,
      outlineNode,
      matchedOutlineAnchor,
      chapterSummaries,
    });

    // ── Skill injection: translate writing methodology into concrete rules ──
    this.injectStructuralSkills({
      chapterNumber: input.chapterNumber,
      language: input.book.language ?? "zh",
      platform: input.book.platform,
      mustKeep,
      mustAvoid,
      styleEmphasis,
      hookAgenda,
      cadence: analyzeChapterCadence({
        language: this.isChineseLanguage(input.book.language) ? "zh" : "en",
        rows: parseChapterSummariesMarkdown(chapterSummaries)
          .filter((s) => s.chapter < input.chapterNumber)
          .sort((a, b) => a.chapter - b.chapter)
          .slice(-4)
          .map((s) => ({ chapter: s.chapter, title: s.title, mood: s.mood, chapterType: s.chapterType })),
      }),
    });

    const intent = ChapterIntentSchema.parse({
      chapter: input.chapterNumber,
      goal,
      outlineNode,
      ...directives,
      mustKeep,
      mustAvoid,
      styleEmphasis,
      conflicts,
      hookAgenda,
    });

    const runtimePath = join(runtimeDir, `chapter-${String(input.chapterNumber).padStart(4, "0")}.intent.md`);
    const intentMarkdown = this.renderIntentMarkdown(
      intent,
      input.book.language ?? "zh",
      renderHookSnapshot(memorySelection.hooks, input.book.language ?? "zh"),
      renderSummarySnapshot(memorySelection.summaries, input.book.language ?? "zh"),
      activeHookCount,
    );
    await writeFile(runtimePath, intentMarkdown, "utf-8");

    return {
      intent,
      intentMarkdown,
      plannerInputs: [
        ...Object.values(sourcePaths),
        join(storyDir, "pending_hooks.md"),
        ...(memorySelection.dbPath ? [memorySelection.dbPath] : []),
      ],
      runtimePath,
    };
  }

  private buildStructuredDirectives(input: {
    readonly chapterNumber: number;
    readonly language?: string;
    readonly volumeOutline: string;
    readonly outlineNode: string | undefined;
    readonly matchedOutlineAnchor: boolean;
    readonly chapterSummaries: string;
  }): Pick<ChapterIntent, "sceneDirective" | "arcDirective" | "moodDirective" | "titleDirective"> {
    const recentSummaries = parseChapterSummariesMarkdown(input.chapterSummaries)
      .filter((summary) => summary.chapter < input.chapterNumber)
      .sort((left, right) => left.chapter - right.chapter)
      .slice(-4);
    const cadence = analyzeChapterCadence({
      language: this.isChineseLanguage(input.language) ? "zh" : "en",
      rows: recentSummaries.map((summary) => ({
        chapter: summary.chapter,
        title: summary.title,
        mood: summary.mood,
        chapterType: summary.chapterType,
      })),
    });

    return {
      arcDirective: this.buildArcDirective(
        input.language,
        input.volumeOutline,
        input.outlineNode,
        input.matchedOutlineAnchor,
      ),
      sceneDirective: this.buildSceneDirective(input.language, cadence),
      moodDirective: this.buildMoodDirective(input.language, cadence),
      titleDirective: this.buildTitleDirective(input.language, cadence),
    };
  }

  private deriveGoal(
    externalContext: string | undefined,
    currentFocus: string,
    authorIntent: string,
    outlineNode: string | undefined,
    chapterNumber: number,
  ): string {
    const first = this.extractFirstDirective(externalContext);
    if (first) return first;
    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (localOverride) return localOverride;
    const outline = this.extractFirstDirective(outlineNode);
    if (outline) return outline;
    const focus = this.extractFocusGoal(currentFocus);
    if (focus) return focus;
    const author = this.extractFirstDirective(authorIntent);
    if (author) return author;
    return `Advance chapter ${chapterNumber} with clear narrative focus.`;
  }

  private collectMustKeep(currentState: string, storyBible: string): string[] {
    return this.unique([
      ...this.extractListItems(currentState, 2),
      ...this.extractListItems(storyBible, 2),
    ]).slice(0, 4);
  }

  private collectMustAvoid(currentFocus: string, prohibitions: ReadonlyArray<string>): string[] {
    const avoidSection = this.extractSection(currentFocus, [
      "avoid",
      "must avoid",
      "禁止",
      "避免",
      "避雷",
    ]);
    const focusAvoids = avoidSection
      ? this.extractListItems(avoidSection, 10)
      : currentFocus
        .split("\n")
        .map((line) => line.trim())
        .filter((line) =>
          line.startsWith("-") &&
          /avoid|don't|do not|不要|别|禁止/i.test(line),
        )
        .map((line) => this.cleanListItem(line))
        .filter((line): line is string => Boolean(line));

    return this.unique([...focusAvoids, ...prohibitions]).slice(0, 6);
  }

  private collectStyleEmphasis(authorIntent: string, currentFocus: string): string[] {
    return this.unique([
      ...this.extractFocusStyleItems(currentFocus),
      ...this.extractListItems(authorIntent, 2),
    ]).slice(0, 4);
  }

  private collectConflicts(
    externalContext: string | undefined,
    currentFocus: string,
    outlineNode: string | undefined,
    volumeOutline: string,
  ): ChapterConflict[] {
    const outlineText = outlineNode ?? volumeOutline;
    if (!outlineText || outlineText === "(文件尚未创建)") return [];
    if (externalContext) {
      const indicatesOverride = /ignore|skip|defer|instead|不要|别|先别|暂停/i.test(externalContext);
      if (!indicatesOverride && this.hasKeywordOverlap(externalContext, outlineText)) return [];

      return [
        {
          type: "outline_vs_request",
          resolution: "allow local outline deferral",
        },
      ];
    }

    const localOverride = this.extractLocalOverrideGoal(currentFocus);
    if (!localOverride || !outlineNode) {
      return [];
    }

    return [
      {
        type: "outline_vs_current_focus",
        resolution: "allow explicit current focus override",
        detail: localOverride,
      },
    ];
  }

  private extractFirstDirective(content?: string): string | undefined {
    if (!content) return undefined;
    return content
      .split("\n")
      .map((line) => line.trim())
      .find((line) =>
        line.length > 0
        && !line.startsWith("#")
        && !line.startsWith("-")
        && !this.isTemplatePlaceholder(line),
      );
  }

  private extractListItems(content: string, limit: number): string[] {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => this.cleanListItem(line))
      .filter((line): line is string => Boolean(line))
      .slice(0, limit);
  }

  private extractFocusGoal(currentFocus: string): string | undefined {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    const directives = this.extractFocusStyleItems(focusSection, 3);
    if (directives.length === 0) {
      return this.extractFirstDirective(focusSection);
    }
    return directives.join(this.containsChinese(focusSection) ? "；" : "; ");
  }

  private extractLocalOverrideGoal(currentFocus: string): string | undefined {
    const overrideSection = this.extractSection(currentFocus, [
      "local override",
      "explicit override",
      "chapter override",
      "local task override",
      "局部覆盖",
      "本章覆盖",
      "临时覆盖",
      "当前覆盖",
    ]);
    if (!overrideSection) {
      return undefined;
    }

    const directives = this.extractListItems(overrideSection, 3);
    if (directives.length > 0) {
      return directives.join(this.containsChinese(overrideSection) ? "；" : "; ");
    }

    return this.extractFirstDirective(overrideSection);
  }

  private extractFocusStyleItems(currentFocus: string, limit = 3): string[] {
    const focusSection = this.extractSection(currentFocus, [
      "active focus",
      "focus",
      "当前聚焦",
      "当前焦点",
      "近期聚焦",
    ]) ?? currentFocus;
    return this.extractListItems(focusSection, limit);
  }

  private buildArcDirective(
    language: string | undefined,
    volumeOutline: string,
    outlineNode: string | undefined,
    matchedOutlineAnchor: boolean,
  ): string | undefined {
    if (matchedOutlineAnchor || !outlineNode || volumeOutline === "(文件尚未创建)") {
      return undefined;
    }

    return this.isChineseLanguage(language)
      ? "不要继续依赖卷纲的 fallback 指令，必须把本章推进到新的弧线节点或地点变化。"
      : "Do not keep leaning on the outline fallback. Force this chapter toward a fresh arc beat or location change.";
  }

  private buildSceneDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.scenePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedType = cadence.scenePressure.repeatedType;

    return this.isChineseLanguage(language)
      ? `最近章节连续停留在“${repeatedType}”，本章必须更换场景容器、地点或行动方式。`
      : `Recent chapters are stuck in repeated ${repeatedType} beats. Change the scene container, location, or action pattern this chapter.`;
  }

  private buildMoodDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.moodPressure?.pressure !== "high") {
      return undefined;
    }
    const moods = cadence.moodPressure.recentMoods;

    return this.isChineseLanguage(language)
      ? `最近${moods.length}章情绪持续高压（${moods.slice(0, 3).join("、")}），本章必须降调——安排日常/喘息/温情/幽默场景，让读者呼吸。`
      : `The last ${moods.length} chapters have been relentlessly tense (${moods.slice(0, 3).join(", ")}). This chapter must downshift — write a quieter scene with warmth, humor, or breathing room.`;
  }

  private buildTitleDirective(
    language: string | undefined,
    cadence: ReturnType<typeof analyzeChapterCadence>,
  ): string | undefined {
    if (cadence.titlePressure?.pressure !== "high") {
      return undefined;
    }
    const repeatedToken = cadence.titlePressure.repeatedToken;

    return this.isChineseLanguage(language)
      ? `标题不要再围绕“${repeatedToken}”重复命名，换一个新的意象或动作焦点。`
      : `Avoid another ${repeatedToken}-centric title. Pick a new image or action focus for this chapter title.`;
  }

  private renderHookBudget(activeCount: number, language: "zh" | "en"): string {
    const cap = 12;
    if (activeCount < 10) {
      return language === "en"
        ? `### Hook Budget\n- ${activeCount} active hooks (capacity: ${cap})`
        : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔（容量：${cap}）`;
    }
    const remaining = Math.max(0, cap - activeCount);
    return language === "en"
      ? `### Hook Budget\n- ${activeCount} active hooks — approaching capacity (${cap}). Only ${remaining} new hook(s) allowed. Prioritize resolving existing debt over opening new threads.`
      : `### 伏笔预算\n- 当前 ${activeCount} 条活跃伏笔——接近容量上限（${cap}）。仅剩 ${remaining} 个新坑位。优先回收旧债，不要轻易开新线。`;
  }

  private extractSection(content: string, headings: ReadonlyArray<string>): string | undefined {
    const targets = headings.map((heading) => this.normalizeHeading(heading));
    const lines = content.split("\n");
    let buffer: string[] | null = null;
    let sectionLevel = 0;

    for (const line of lines) {
      const headingMatch = line.match(/^(#+)\s*(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const heading = this.normalizeHeading(headingMatch[2]!);

        if (buffer && level <= sectionLevel) {
          break;
        }

        if (targets.includes(heading)) {
          buffer = [];
          sectionLevel = level;
          continue;
        }
      }

      if (buffer) {
        buffer.push(line);
      }
    }

    const section = buffer?.join("\n").trim();
    return section && section.length > 0 ? section : undefined;
  }

  private normalizeHeading(heading: string): string {
    return heading
      .toLowerCase()
      .replace(/[*_`:#]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private cleanListItem(line: string): string | undefined {
    const cleaned = line.replace(/^-\s*/, "").trim();
    if (cleaned.length === 0) return undefined;
    if (/^[-|]+$/.test(cleaned)) return undefined;
    if (this.isTemplatePlaceholder(cleaned)) return undefined;
    return cleaned;
  }

  private isTemplatePlaceholder(line: string): boolean {
    const normalized = line.trim();
    if (!normalized) return false;

    return (
      /^\((describe|briefly describe|write)\b[\s\S]*\)$/i.test(normalized)
      || /^（(?:在这里描述|描述|填写|写下)[\s\S]*）$/u.test(normalized)
    );
  }

  private containsChinese(content: string): boolean {
    return /[\u4e00-\u9fff]/.test(content);
  }

  private findOutlineNode(volumeOutline: string, chapterNumber: number): string | undefined {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchExactOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[1]);
      if (inlineContent) {
        return inlineContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = this.matchRangeOutlineLine(line, chapterNumber);
      if (!match) continue;

      const inlineContent = this.cleanOutlineContent(match[3]);
      if (inlineContent) {
        return inlineContent;
      }

      // For "章节范围" format, the volume title is above this line.
      // Collect the heading + all content below until the next heading,
      // then pick the beat corresponding to this specific chapter.
      const rangeStart = Number(match[1]);
      const sectionContent = this.extractSectionAroundRange(lines, index);
      if (sectionContent) {
        const beatIndex = chapterNumber - rangeStart;
        const specificBeat = this.extractNumberedBeat(sectionContent, beatIndex);
        return specificBeat ?? sectionContent;
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!this.isOutlineAnchorLine(line)) continue;

      const exactMatch = this.matchAnyExactOutlineLine(line);
      if (exactMatch) {
        const inlineContent = this.cleanOutlineContent(exactMatch[1]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const rangeMatch = this.matchAnyRangeOutlineLine(line);
      if (rangeMatch) {
        const inlineContent = this.cleanOutlineContent(rangeMatch[3]);
        if (inlineContent) {
          return inlineContent;
        }
      }

      const nextContent = this.findNextOutlineContent(lines, index + 1);
      if (nextContent) {
        return nextContent;
      }

      break;
    }

    return this.extractFirstDirective(volumeOutline);
  }

  private cleanOutlineContent(content?: string): string | undefined {
    const cleaned = content?.trim();
    if (!cleaned) return undefined;
    if (/^[*_`~:：-]+$/.test(cleaned)) return undefined;
    return cleaned;
  }

  /**
   * For "章节范围：13-17章" format, extract the full section:
   * look upward for the volume heading, then collect everything
   * from the heading down to the next heading of the same or higher level.
   */
  private extractSectionAroundRange(lines: ReadonlyArray<string>, rangeLineIndex: number): string | undefined {
    // Walk backward to find the nearest heading (### or ##)
    // Only activate for "章节范围" style outlines where the heading is above.
    let headingIndex = -1;
    for (let i = rangeLineIndex - 1; i >= 0; i--) {
      if (lines[i]!.startsWith("#")) {
        headingIndex = i;
        break;
      }
      // Stop if we hit another range/anchor line (means no heading above)
      if (this.matchAnyRangeOutlineLine(lines[i]!) || this.matchAnyExactOutlineLine(lines[i]!)) {
        break;
      }
    }

    // If no heading found above, this isn't the "章节范围" format — bail out
    if (headingIndex < 0) {
      return undefined;
    }

    // Determine the heading level to know where this section ends
    const headingLine = lines[headingIndex]!;
    const headingLevel = headingLine.match(/^(#+)/)?.[1]?.length ?? 3;

    // Collect lines from heading to next same-or-higher heading
    const sectionLines: string[] = [];
    for (let i = headingIndex; i < lines.length; i++) {
      if (i > headingIndex) {
        const nextHeadingMatch = lines[i]!.match(/^(#+)/);
        if (nextHeadingMatch && (nextHeadingMatch[1]?.length ?? 0) <= headingLevel) {
          break;
        }
      }
      sectionLines.push(lines[i]!);
    }

    const content = sectionLines.join("\n").trim();
    return content.length > 0 ? content : undefined;
  }

  /**
   * Extract the Nth numbered beat from a section.
   * Beats are lines starting with "1.", "2.", "3." etc. in "关键转折" blocks.
   * beatIndex=0 → 1st beat, beatIndex=1 → 2nd beat, etc.
   */
  private extractNumberedBeat(section: string, beatIndex: number): string | undefined {
    if (beatIndex < 0) return undefined;

    const beats: string[] = [];
    for (const line of section.split("\n")) {
      const trimmed = line.trim();
      // Match "1. ...", "2. ..." or "1) ..." patterns
      if (/^\d+[.)]\s/.test(trimmed)) {
        beats.push(trimmed.replace(/^\d+[.)]\s*/, ""));
      }
    }

    if (beats.length === 0 || beatIndex >= beats.length) return undefined;
    return beats[beatIndex];
  }

  private findNextOutlineContent(lines: ReadonlyArray<string>, startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!line) {
        continue;
      }

      if (this.isOutlineAnchorLine(line)) {
        return undefined;
      }

      if (line.startsWith("#")) {
        continue;
      }

      const cleaned = this.cleanOutlineContent(line);
      if (cleaned) {
        return cleaned;
      }
    }

    return undefined;
  }

  private hasMatchedOutlineAnchor(volumeOutline: string, chapterNumber: number): boolean {
    const lines = volumeOutline.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.some((line) =>
      this.matchExactOutlineLine(line, chapterNumber) !== undefined
      || this.matchRangeOutlineLine(line, chapterNumber) !== undefined,
    );
  }

  private matchExactOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const patterns = [
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?Chapter\\s*${chapterNumber}(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`, "i"),
      new RegExp(`^(?:#+\\s*)?(?:[-*]\\s+)?(?:\\*\\*)?第\\s*${chapterNumber}\\s*章(?!\\d|\\s*[-~–—]\\s*\\d)(?:[:：-])?(?:\\*\\*)?\\s*(.*)$`),
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchAnyExactOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*\d+(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*\d+\s*章(?!\s*[-~–—]\s*\d)(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private matchRangeOutlineLine(line: string, chapterNumber: number): RegExpMatchArray | undefined {
    const match = this.matchAnyRangeOutlineLine(line);
    if (!match) return undefined;
    if (this.isChapterWithinRange(match[1], match[2], chapterNumber)) {
      return match;
    }

    return undefined;
  }

  private matchAnyRangeOutlineLine(line: string): RegExpMatchArray | undefined {
    const patterns = [
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?Chapter\s*(\d+)\s*[-~–—]\s*(\d+)\b(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      /^(?:#+\s*)?(?:[-*]\s+)?(?:\*\*)?第\s*(\d+)\s*[-~–—]\s*(\d+)\s*章(?:[:：-])?(?:\*\*)?\s*(.*)$/i,
      // Match "**章节范围**：13-17章" / "- **章节范围**：13-17章" format
      /^(?:[-*]\s+)?(?:\*\*)?章节范围(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\s*章\s*(.*)$/,
      /^(?:[-*]\s+)?(?:\*\*)?Chapter\s*[Rr]ange(?:\*\*)?[：:]\s*(\d+)\s*[-~–—]\s*(\d+)\b\s*(.*)$/i,
    ];

    return patterns
      .map((pattern) => line.match(pattern))
      .find((result): result is RegExpMatchArray => Boolean(result));
  }

  private isOutlineAnchorLine(line: string): boolean {
    return this.matchAnyExactOutlineLine(line) !== undefined
      || this.matchAnyRangeOutlineLine(line) !== undefined;
  }

  private isChapterWithinRange(startText: string | undefined, endText: string | undefined, chapterNumber: number): boolean {
    const start = Number.parseInt(startText ?? "", 10);
    const end = Number.parseInt(endText ?? "", 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    return chapterNumber >= lower && chapterNumber <= upper;
  }

  private hasKeywordOverlap(left: string, right: string): boolean {
    const keywords = this.extractKeywords(left);
    if (keywords.length === 0) return false;
    const normalizedRight = right.toLowerCase();
    return keywords.some((keyword) => normalizedRight.includes(keyword.toLowerCase()));
  }

  private extractKeywords(content: string): string[] {
    const english = content.match(/[a-z]{4,}/gi) ?? [];
    const chinese = content.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    return this.unique([...english, ...chinese]);
  }

  private renderIntentMarkdown(
    intent: ChapterIntent,
    language: "zh" | "en",
    pendingHooks: string,
    chapterSummaries: string,
    activeHookCount: number,
  ): string {
    const conflictLines = intent.conflicts.length > 0
      ? intent.conflicts.map((conflict) => `- ${conflict.type}: ${conflict.resolution}`).join("\n")
      : "- none";

    const mustKeep = intent.mustKeep.length > 0
      ? intent.mustKeep.map((item) => `- ${item}`).join("\n")
      : "- none";

    const mustAvoid = intent.mustAvoid.length > 0
      ? intent.mustAvoid.map((item) => `- ${item}`).join("\n")
      : "- none";

    const styleEmphasis = intent.styleEmphasis.length > 0
      ? intent.styleEmphasis.map((item) => `- ${item}`).join("\n")
      : "- none";
    const directives = [
      intent.arcDirective ? `- arc: ${intent.arcDirective}` : undefined,
      intent.sceneDirective ? `- scene: ${intent.sceneDirective}` : undefined,
      intent.moodDirective ? `- mood: ${intent.moodDirective}` : undefined,
      intent.titleDirective ? `- title: ${intent.titleDirective}` : undefined,
    ].filter(Boolean).join("\n") || "- none";
    const isEn = language === "en";
    const hookAgenda = [
      isEn ? "### Resolve — must deliver a concrete payoff this chapter" : "### 兑现（本章必须落地具体回收）",
      intent.hookAgenda.eligibleResolve.length > 0
        ? intent.hookAgenda.eligibleResolve.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none this round" : "- 本轮无",
      "",
      isEn ? "### Advance — must show visible progress this chapter" : "### 推进（本章必须有可见进展）",
      intent.hookAgenda.mustAdvance.length > 0
        ? intent.hookAgenda.mustAdvance.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none this round" : "- 本轮无",
      "",
      isEn ? "### Stale Debt — overdue hooks, prioritize clearing" : "### 逾期债务（积压伏笔，优先清理）",
      intent.hookAgenda.staleDebt.length > 0
        ? intent.hookAgenda.staleDebt.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none" : "- 无",
      "",
      isEn ? "### Do Not Open — avoid new hooks in these families" : "### 禁开新坑（以下类型不得新增伏笔）",
      intent.hookAgenda.avoidNewHookFamilies.length > 0
        ? intent.hookAgenda.avoidNewHookFamilies.map((item) => `- ${item}`).join("\n")
        : isEn ? "- none" : "- 无",
      "",
      this.renderHookBudget(activeHookCount, language),
    ].join("\n");

    return [
      "# Chapter Intent",
      "",
      "## Goal",
      intent.goal,
      "",
      "## Outline Node",
      intent.outlineNode ?? "(not found)",
      "",
      "## Must Keep",
      mustKeep,
      "",
      "## Must Avoid",
      mustAvoid,
      "",
      "## Style Emphasis",
      styleEmphasis,
      "",
      "## Structured Directives",
      directives,
      "",
      "## Hook Agenda",
      hookAgenda,
      "",
      "## Conflicts",
      conflictLines,
      "",
      "## Pending Hooks Snapshot",
      pendingHooks,
      "",
      "## Chapter Summaries Snapshot",
      chapterSummaries,
      "",
    ].join("\n");
  }

  private unique(values: ReadonlyArray<string>): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private isChineseLanguage(language: string | undefined): boolean {
    return (language ?? "zh").toLowerCase().startsWith("zh");
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }

  // ---------------------------------------------------------------------------
  // Structural skill injection (v10)
  // Translates writing methodology into concrete mustKeep/styleEmphasis rules.
  // ---------------------------------------------------------------------------

  private injectStructuralSkills(params: {
    chapterNumber: number;
    language: string;
    platform: string;
    mustKeep: string[];
    mustAvoid: string[];
    styleEmphasis: string[];
    hookAgenda: { eligibleResolve: ReadonlyArray<string> };
    cadence: ReturnType<typeof analyzeChapterCadence>;
  }): void {
    const ch = params.chapterNumber;
    const isEn = params.language === "en";
    const isTomato = params.platform === "tomato";

    // S01: 黄金开篇
    const goldenLimit = isEn ? 5 : 3;
    const goldenRulesZh: Record<number, string> = {
      1: "【黄金第1章】直接进入冲突场景，禁止背景介绍开头。第一段必须有动作或对话。核心矛盾本章浮出水面。最多2个场景3个角色。",
      2: "【黄金第2章】主角的金手指/核心能力必须初现，通过具体事件展现。第一个小爽点在本章出现。继续收紧核心冲突，不引入新支线。",
      3: "【黄金第3章】明确具体可衡量的短期目标（打败某人/获得某物/到达某处）。章尾钩子要最强——这是读者决定是否追读的关键章。",
    };
    const goldenRulesEn: Record<number, string> = {
      1: "[Golden Ch1] Drop into conflict — no worldbuilding preamble. First paragraph: action or dialogue. Core conflict surfaces. Max 2 scenes, 3 characters.",
      2: "[Golden Ch2] Reveal protagonist's edge through a concrete event. First small payoff lands. Tighten core conflict, no new subplots.",
      3: "[Golden Ch3] Lock in a specific measurable short-term goal. Strong chapter-end hook — make-or-break for retention.",
      4: "[Golden Ch4] First MAJOR payoff — reward reader investment. Raise emotional stakes: what protagonist stands to LOSE becomes clear.",
      5: "[Golden Ch5] Raise stakes before paywall — new threat/complication. World expands. Strongest cliffhanger yet — conversion chapter.",
    };
    if (ch <= goldenLimit) {
      const rule = isEn ? goldenRulesEn[ch] : goldenRulesZh[ch];
      if (rule) params.mustKeep.push(rule);
    }

    // S02: 付费卡点 / 留存生死线
    if (isTomato) {
      // 番茄：免费模式，前3章是编辑签约+读者留存的生死线（和S01重叠）
      // 不需要额外规则，S01已覆盖
    } else if (isEn) {
      // GoodNovel/Dreame：第6-8章付费墙
      if (ch >= 5 && ch <= 8) {
        params.mustKeep.push("[Paywall Zone] Reader hits paywall soon — chapter MUST end with an irresistible cliffhanger that makes paying feel inevitable.");
      }
    }

    // S04: 日常段服务主线
    if (params.cadence.moodPressure?.pressure !== "high") {
      params.styleEmphasis.push(isEn
        ? "If this chapter has quiet/daily scenes, each must plant a hook or advance a relationship — no pure filler. Every daily scene is bait for the main plot."
        : '如果本章有日常/过渡段，每段必须埋伏笔或推关系。万物皆为主线的"饵"，纯填充即流水账。');
    }

    // S03: 情绪升压（补充已有的降调逻辑）
    // 已有 moodDirective 处理连续高压→降调。这里处理反向：无压力时提醒升压
    if (!params.cadence.moodPressure && ch > goldenLimit) {
      params.styleEmphasis.push(isEn
        ? "Recent chapters have been quiet — this chapter needs to escalate tension. Introduce a complication, confrontation, or revelation."
        : "最近几章情绪偏平，本章必须升压——引入新冲突、对抗或揭秘。");
    }

    // S10+S11: 信息落差 + 欲望驱动（结合 hook 回收时机）
    if (params.hookAgenda.eligibleResolve.length > 0) {
      params.styleEmphasis.push(isEn
        ? "A major hook is ready to resolve — maximize tension BEFORE the payoff. The release must exceed reader expectations. Satisfy 70% = failure."
        : "有伏笔即将兑现——在兑现前把压制拉到最大。释放时必须超过读者预期，只满足70%等于失败。");
    }
  }
}
