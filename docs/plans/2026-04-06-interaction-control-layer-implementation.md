# Interaction Control Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a shared interaction control layer that powers a project-scoped writing TUI first and becomes the common control brain for both TUI and Studio.

**Architecture:** Introduce a new `core/interaction` subsystem for session state, intent routing, execution status, automation policy, and edit transactions. Keep `PipelineRunner` as the execution substrate, build a thin TUI shell in `packages/cli`, and refit Studio to call the same interaction APIs instead of owning separate orchestration logic.

**Tech Stack:** TypeScript, InkOS core pipeline, Commander CLI, Ink-based TUI shell, existing Studio React client, Vitest.

---

### Task 1: Add interaction domain models in core

**Files:**
- Create: `packages/core/src/interaction/session.ts`
- Create: `packages/core/src/interaction/intents.ts`
- Create: `packages/core/src/interaction/modes.ts`
- Create: `packages/core/src/interaction/events.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/interaction-models.test.ts`

**Step 1: Write the failing test**

Create coverage for:
- `InteractionSession`
- `AutomationMode`
- `InteractionIntent`
- `ExecutionStatus`
- `PendingDecision`

Include assertions for:
- valid mode parsing
- valid intent discrimination
- session book binding
- event payload shape

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-models.test.ts
```

Expected:
- fail because the new modules do not exist

**Step 3: Write minimal implementation**

Implement:
- `AutomationMode = "auto" | "semi" | "manual"`
- `InteractionIntentType` union
- `ExecutionStatus` union
- `InteractionSession` interface
- `PendingDecision` interface
- small helpers:
  - `bindActiveBook`
  - `clearPendingDecision`
  - `isTerminalExecutionStatus`

Keep each file under 200 lines.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-models.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/core/src/interaction/session.ts packages/core/src/interaction/intents.ts packages/core/src/interaction/modes.ts packages/core/src/interaction/events.ts packages/core/src/index.ts packages/core/src/__tests__/interaction-models.test.ts
git commit -m "feat(interaction): add shared control models"
```

### Task 2: Build the interaction runtime bridge

**Files:**
- Create: `packages/core/src/interaction/runtime.ts`
- Create: `packages/core/src/interaction/request-router.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/interaction-runtime.test.ts`

**Step 1: Write the failing test**

Cover:
- `continue_book` routes to `writeNextChapter`
- `revise_chapter` routes to `reviseDraft`
- `rewrite_chapter` routes to `reviseDraft(mode="rewrite")`
- `update_current_focus` routes to the existing write surface
- `switch_mode` updates session policy only

Use a mocked `PipelineRunner`-shaped object.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-runtime.test.ts
```

Expected:
- fail because runtime bridge is missing

**Step 3: Write minimal implementation**

Implement:
- `InteractionRuntime`
- `runInteractionRequest(...)`
- `routeIntentToRequest(...)`

Rules:
- no direct filesystem edits in this layer
- only call existing pipeline capabilities
- emit explicit `ExecutionStatus` transitions

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-runtime.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/core/src/interaction/runtime.ts packages/core/src/interaction/request-router.ts packages/core/src/index.ts packages/core/src/__tests__/interaction-runtime.test.ts
git commit -m "feat(interaction): add runtime bridge"
```

### Task 3: Introduce a project-scoped TUI entry

**Files:**
- Create: `packages/cli/src/commands/tui.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/__tests__/tui-command.test.ts`

**Step 1: Write the failing test**

Cover:
- `inkos` without a subcommand launches the TUI entry
- current working directory is treated as project root
- when no project config exists, the TUI still opens in a neutral state

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/cli exec vitest run src/__tests__/tui-command.test.ts
```

Expected:
- fail because command does not exist

**Step 3: Write minimal implementation**

Implement:
- `tuiCommand`
- fallback behavior so `inkos` opens TUI when no subcommand is provided

Do not add visual complexity yet.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/cli exec vitest run src/__tests__/tui-command.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/cli/src/commands/tui.ts packages/cli/src/index.ts packages/cli/src/__tests__/tui-command.test.ts
git commit -m "feat(cli): add project-scoped TUI entry"
```

### Task 4: Scaffold the TUI shell layout

**Files:**
- Create: `packages/cli/src/tui/app.tsx`
- Create: `packages/cli/src/tui/status-bar.tsx`
- Create: `packages/cli/src/tui/session-pane.tsx`
- Create: `packages/cli/src/tui/process-pane.tsx`
- Create: `packages/cli/src/tui/input-bar.tsx`
- Test: `packages/cli/src/__tests__/tui-layout.test.tsx`

**Step 1: Write the failing test**

Cover rendering for:
- status bar
- empty session pane
- process pane with current stage
- input bar placeholder

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/cli exec vitest run src/__tests__/tui-layout.test.tsx
```

Expected:
- fail because TUI components are missing

**Step 3: Write minimal implementation**

Render:
- project name
- active book
- automation mode
- current stage
- empty conversation area
- process/status area

Keep all components small:
- target `< 180` lines each

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/cli exec vitest run src/__tests__/tui-layout.test.tsx
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/cli/src/tui/app.tsx packages/cli/src/tui/status-bar.tsx packages/cli/src/tui/session-pane.tsx packages/cli/src/tui/process-pane.tsx packages/cli/src/tui/input-bar.tsx packages/cli/src/__tests__/tui-layout.test.tsx
git commit -m "feat(tui): scaffold interaction shell"
```

### Task 5: Add natural-language intent parsing for first-wave commands

**Files:**
- Create: `packages/core/src/interaction/nl-router.ts`
- Modify: `packages/core/src/interaction/request-router.ts`
- Test: `packages/core/src/__tests__/interaction-nl-router.test.ts`

**Step 1: Write the failing test**

Cover parsing for:
- “continue”
- “write next”
- “pause this book”
- “rewrite chapter 3”
- “revise chapter 5 ending only”
- “set focus back to the old case”
- “why did the protagonist name not change”

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-nl-router.test.ts
```

Expected:
- fail because parser is missing

**Step 3: Write minimal implementation**

Implement a deterministic first-wave parser:
- command-first and phrase-first
- no LLM dependency in phase 1
- extract:
  - intent
  - chapter number
  - instruction payload
  - optional scope hints

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-nl-router.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/core/src/interaction/nl-router.ts packages/core/src/interaction/request-router.ts packages/core/src/__tests__/interaction-nl-router.test.ts
git commit -m "feat(interaction): add deterministic natural-language routing"
```

### Task 6: Implement automation modes and stop behavior

**Files:**
- Modify: `packages/core/src/interaction/modes.ts`
- Modify: `packages/core/src/interaction/runtime.ts`
- Modify: `packages/core/src/pipeline/runner.ts`
- Test: `packages/core/src/__tests__/interaction-modes.test.ts`

**Step 1: Write the failing test**

Cover:
- `auto` continues chapter progression unless a hard stop occurs
- `semi` requires an explicit next-chapter start
- `manual` never self-continues
- `state-degraded` still hard-blocks in all modes

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-modes.test.ts
```

Expected:
- fail because runtime does not honor these policies

**Step 3: Write minimal implementation**

Add:
- mode-aware continuation checks
- mode exposure in session/runtime status
- no duplicate policy logic in CLI and Studio

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/interaction-modes.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/core/src/interaction/modes.ts packages/core/src/interaction/runtime.ts packages/core/src/pipeline/runner.ts packages/core/src/__tests__/interaction-modes.test.ts
git commit -m "feat(interaction): add automation modes"
```

### Task 7: Add edit controller for chapter and truth-file transactions

**Files:**
- Create: `packages/core/src/interaction/edit-controller.ts`
- Create: `packages/core/src/interaction/truth-authority.ts`
- Test: `packages/core/src/__tests__/edit-controller.test.ts`

**Step 1: Write the failing test**

Cover:
- chapter rewrite produces a rebuild-required action
- local paragraph edit marks only the affected chapter dirty
- truth-file edit is classified as:
  - direction edit
  - truth authority edit
  - entity edit
- entity rename returns affected-scope metadata

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/edit-controller.test.ts
```

Expected:
- fail because edit controller is missing

**Step 3: Write minimal implementation**

Implement:
- edit transaction types
- affected-scope classification
- truth authority resolution helpers

Do not yet perform all downstream rewrites automatically; phase 1 only needs correct planning and scope marking.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/core exec vitest run src/__tests__/edit-controller.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/core/src/interaction/edit-controller.ts packages/core/src/interaction/truth-authority.ts packages/core/src/__tests__/edit-controller.test.ts
git commit -m "feat(interaction): add edit controller"
```

### Task 8: Connect Studio to the shared control layer

**Files:**
- Modify: `packages/studio/src/api/server.ts`
- Modify: `packages/studio/src/components/ChatBar.tsx`
- Modify: `packages/studio/src/App.tsx`
- Test: `packages/studio/src/api/server.test.ts`
- Test: `packages/studio/src/components/chatbar-state.test.ts`

**Step 1: Write the failing test**

Cover:
- Studio chat routes through shared interaction runtime
- active book binding is preserved
- stage/status events are surfaced through the same event model

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/studio exec vitest run src/api/server.test.ts src/components/chatbar-state.test.ts
```

Expected:
- fail because Studio still uses one-shot `/api/agent`

**Step 3: Write minimal implementation**

Replace one-shot behavior with:
- session-aware interaction endpoint(s)
- shared status/event contract
- ChatBar updates from the shared control state

Keep Studio page structure mostly intact for phase 1.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/studio exec vitest run src/api/server.test.ts src/components/chatbar-state.test.ts
```

Expected:
- PASS

**Step 5: Commit**

```bash
git add packages/studio/src/api/server.ts packages/studio/src/components/ChatBar.tsx packages/studio/src/App.tsx packages/studio/src/api/server.test.ts packages/studio/src/components/chatbar-state.test.ts
git commit -m "feat(studio): route chat through interaction control layer"
```

### Task 9: Run end-to-end verification for TUI + core

**Files:**
- Modify: `packages/cli/src/__tests__/cli-integration.test.ts`
- Modify: `packages/core/src/__tests__/pipeline-agent.test.ts`

**Step 1: Write the failing test**

Add one flow that covers:
- launch TUI in project context
- bind active book
- send natural-language “write next”
- observe stage/status progression
- switch to `semi`

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir packages/cli exec vitest run src/__tests__/cli-integration.test.ts
```

Expected:
- fail because the new flow is not wired

**Step 3: Write minimal implementation**

Fill any missing glue only.

Avoid broad refactors at this stage.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir packages/cli exec vitest run src/__tests__/cli-integration.test.ts
pnpm --dir packages/core exec tsc --noEmit --pretty false
pnpm --dir packages/core run build
```

Expected:
- all pass

**Step 5: Commit**

```bash
git add packages/cli/src/__tests__/cli-integration.test.ts packages/core/src/__tests__/pipeline-agent.test.ts
git commit -m "test(interaction): verify end-to-end control flow"
```
