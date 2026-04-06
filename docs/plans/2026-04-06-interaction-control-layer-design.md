# Interaction Control Layer Design

## Goal

Build a shared interaction control layer for InkOS so that `TUI` and `Studio` stop acting like separate products and instead become two shells over the same writing control brain.

This layer must let users:
- create a book through natural conversation
- continue an active book inside a project workspace
- see exactly what the system is doing right now
- intervene safely on chapters, truth files, and direction
- choose how much autonomy the system has

## Why This Exists

Current InkOS has strong execution primitives but weak control ergonomics.

Today the user experience is split across:
- CLI commands
- Studio buttons and pages
- a shallow `/api/agent` chat box
- daemon logs
- direct truth-file editing

That produces the exact failures users complain about:
- the system keeps writing when the user expected it to stop
- the user cannot tell what stage the system is in
- edits to truth files do not feel authoritative
- rejecting or revising a chapter does not feel like part of one coherent flow
- Studio chat does not hold enough session context to feel like a real assistant

The solution is not “more buttons” and not “just add a TUI”. The solution is a single interaction control layer that owns:
- session context
- book binding
- autonomy policy
- natural-language intent routing
- execution status
- human edit transactions

## Product Principles

### 1. Project-first

InkOS should behave like a writing version of Coding CLI.

The user opens a project directory and runs:

```bash
inkos
```

The current working directory is the project context. The control layer restores:
- project config
- books in the project
- active book, if one exists
- current running task, if one exists

The user should not be thrown into a global dashboard first.

### 2. Conversation-first, not form-first

When there is no active task, the interface should be quiet.

It should not dump a questionnaire. It should wait for the user to speak first. The system then gradually narrows the task by asking only the most important next question.

Bad:
- “Choose language / genre / length / mode / trend scanning / source mode”

Good:
- user: “I want to write a cold urban mystery”
- system: “I’ll hold it as a cold urban mystery. Do you want something long-running, or something that can close within about 10-20 chapters?”

### 3. Status must stay visible at all times

The user must always be able to answer:
- which book is active?
- what chapter is being worked on?
- which stage is running right now?
- why is the system waiting or blocked?

### 4. Human edits are transactions, not raw file writes

Users must be able to change:
- a person name
- a chapter
- a paragraph
- `current_focus`
- `author_intent`
- truth files

But these changes cannot be “write to one file and hope the rest follows”. The control layer must route human edits through a consistency-preserving edit controller.

### 5. TUI and Studio share the same brain

`TUI` and `Studio` may have different layouts, but they must share:
- session model
- intent routing
- autonomy policy
- control actions
- execution status
- pending decisions

No duplicate business logic in both shells.

## User Journeys

### Journey A: New book from a vague idea

1. User runs `inkos` inside a project.
2. No active book exists.
3. User types: “I want to write a quiet harbor mystery.”
4. The control layer opens a book-creation conversation.
5. Through a few turns, the system gathers enough intent to draft:
   - title direction
   - genre
   - target scale
   - language
   - source mode: original / continuation / fanfic
   - autonomy preference
6. System proposes a structured book draft.
7. User confirms or adjusts.
8. System runs foundation generation.
9. If the autonomy policy allows, it proceeds into writing; otherwise it waits for outline review.

### Journey B: Continue an active book

1. User runs `inkos` in a project that already has books.
2. The control layer restores the active book.
3. The interface opens on that book’s current session.
4. User types “continue”.
5. Control layer maps that to `write_next`.
6. Status stream shows:
   - planning
   - composing
   - writing
   - assessing
   - repairing
   - persisting
7. If a stop condition is met, the task switches to `waiting_human`.

### Journey C: Intervene on a chapter

1. User types: “Rewrite chapter 3, but keep the ending reveal.”
2. Control layer identifies:
   - action: `rewrite_chapter`
   - chapter: `3`
   - constraint: keep ending reveal
3. It builds an edit transaction.
4. Runtime executes rewrite + reanalysis + truth/state rebuild for affected scope.
5. User sees diff, updated status, and any downstream invalidations.

### Journey D: Fix authority confusion

1. User types: “Why is the protagonist still called Lu Chen?”
2. Control layer resolves authoritative sources:
   - story bible
   - current state
   - book rules
   - recent chapters
   - active entity state
3. It explains which source currently wins.
4. User can then say:
   - “Rename the protagonist to Lin Yan everywhere”
5. Control layer opens an entity-level rename transaction instead of editing random files manually.

## Architecture

There should be one new subsystem spanning `core`, `cli`, and `studio`.

### Layer 1: Interaction Core

New `core` module family that owns conversation state and intent routing.

Responsibilities:
- maintain `InteractionSession`
- bind current project and active book
- classify user messages into intent types
- ask follow-up questions when required
- emit structured requests for execution

This layer does not directly run writing logic.

### Layer 2: Control Runtime

Execution orchestrator for interaction requests.

Responsibilities:
- turn a request into an executable action plan
- call existing pipeline capabilities
- track stage transitions
- publish execution events
- manage waiting-human transitions

This layer is the bridge between conversation and pipeline.

### Layer 3: Execution Substrate

Existing InkOS capabilities remain underneath:
- `PipelineRunner`
- `writer`
- `review`
- `repair-state`
- truth file read/write
- `scheduler`

This design avoids rewriting the execution engine from scratch.

### Layer 4: Shells

Two shells sit above the same control layer:
- `TUI`
- `Studio`

Both subscribe to the same session and status model.

## Core Objects

### `InteractionSession`

Represents one project-scoped working conversation.

Fields:
- `sessionId`
- `projectRoot`
- `activeBookId?`
- `activeChapterNumber?`
- `messages`
- `automationMode`
- `pendingDecision?`
- `currentExecution?`
- `lastResolvedIntent?`

### `AutomationMode`

Three explicit modes:
- `auto`
- `semi`
- `manual`

Meaning:
- `auto`: continue chapters automatically unless a true hard stop occurs
- `semi`: user starts each chapter; chapter-internal loop stays automatic
- `manual`: no autonomous progression; only explicit user commands run

### `InteractionIntent`

Normalized intent categories:
- `create_book`
- `select_book`
- `continue_book`
- `write_next`
- `pause_book`
- `resume_book`
- `revise_chapter`
- `rewrite_chapter`
- `edit_truth`
- `update_focus`
- `update_author_intent`
- `explain_status`
- `explain_failure`
- `export_book`
- `switch_mode`

### `InterventionRequest`

The structured handoff from interaction core to runtime.

Fields:
- `intent`
- `bookId`
- `chapterNumber?`
- `instruction?`
- `truthFile?`
- `modeOverride?`
- `constraints`

### `ExecutionStatus`

Normalized, shell-friendly runtime state:
- `idle`
- `planning`
- `composing`
- `writing`
- `assessing`
- `repairing`
- `persisting`
- `waiting_human`
- `blocked`
- `completed`
- `failed`

### `PendingDecision`

Represents a human decision that must be surfaced clearly.

Examples:
- approve current chapter before continuing
- choose whether to rewrite or keep a chapter
- resolve a truth authority conflict
- confirm a project-level change

## Edit Controller

This is required. Without it, human intervention will keep poisoning consistency.

### Why It Exists

Users need to change:
- names
- chapters
- paragraphs
- direction
- truth files

Those changes can affect:
- chapter text
- current state
- hook state
- chapter summaries
- future chapter assumptions

So edits must be transactional.

### Edit Types

#### 1. Entity edits

Examples:
- rename protagonist
- change a character attribute

These are not text replacements. They must update the authoritative entity definition and then determine which downstream material must be rebuilt or flagged.

#### 2. Chapter edits

Examples:
- rewrite chapter 3
- revise chapter 5

These rebuild chapter-derived truth outputs.

#### 3. Local text edits

Examples:
- rewrite one paragraph
- change the ending sentence

These still require reanalysis of the affected chapter.

#### 4. Direction/rule edits

Examples:
- update `current_focus`
- update `author_intent`
- edit `book_rules`
- edit `volume_outline`

These do not always require rewriting old chapters, but they must affect future planning deterministically.

### Consistency Rules

The edit controller should enforce:
- chapter body is authoritative for “what happened in this chapter”
- explicit user override is authoritative for user-owned fields
- truth projections must be regenerated from edited content where applicable
- downstream chapters may be marked stale if an upstream edit invalidates assumptions

## Status, Events, and Interaction Feedback

This system needs explicit event flow, not ad-hoc log strings.

### Event Stream

New shared execution events should include:
- `session.bound`
- `book.selected`
- `task.started`
- `task.progress`
- `task.waiting_human`
- `task.completed`
- `task.failed`
- `edit.applied`
- `truth.updated`
- `mode.changed`

### Stage Visibility

The user should always see:
- active book
- active chapter
- stage
- last successful action
- current warning/block reason

### Interaction Animation

Animations should communicate process, not decoration.

Required feedback:
- active stage indicator
- progress/event stream
- visible `waiting_human` state
- clear acceptance / rollback / rewrite transitions

No decorative motion that does not improve process readability.

## TUI Shape

The `TUI` is the first shell, but it must be designed as a reusable client for the shared control layer.

### Main layout

- **Top status bar**
  - project
  - active book
  - automation mode
  - current stage
- **Center conversation pane**
  - user messages
  - assistant responses
  - system event summaries
- **Right or bottom process pane**
  - current task
  - last 10 events
  - pending decisions
  - current warnings
- **Input row**
  - natural-language input
  - optional slash commands

### Slash commands

Support a small, stable command layer:
- `/books`
- `/open <book>`
- `/new`
- `/write`
- `/pause`
- `/resume`
- `/mode`
- `/revise`
- `/rewrite`
- `/focus`
- `/intent`
- `/truth`
- `/export`
- `/status`

Natural language remains primary.

## Studio Shape

Studio should stop treating chat as a side widget over a page collection.

Instead:
- chat becomes a first-class surface over the same interaction core
- book pages become supporting views, not the only control mechanism
- daemon/log/truth views subscribe to the same execution event model

Studio should preserve its richer visual editing affordances, but it should not own separate orchestration logic.

## File and Module Boundaries

This task is large, so file size control must be a design constraint from day one.

### New core modules

Create a focused module family, for example:

- `packages/core/src/interaction/session.ts`
- `packages/core/src/interaction/intents.ts`
- `packages/core/src/interaction/router.ts`
- `packages/core/src/interaction/runtime.ts`
- `packages/core/src/interaction/events.ts`
- `packages/core/src/interaction/modes.ts`
- `packages/core/src/interaction/edit-controller.ts`
- `packages/core/src/interaction/truth-authority.ts`

### New CLI/TUI modules

- `packages/cli/src/tui/app.tsx`
- `packages/cli/src/tui/layout.tsx`
- `packages/cli/src/tui/session-view.tsx`
- `packages/cli/src/tui/status-pane.tsx`
- `packages/cli/src/tui/input-bar.tsx`
- `packages/cli/src/tui/commands.ts`

### Studio changes

Keep Studio changes shallow:
- replace `/api/agent` one-shot orchestration with shared control-layer API
- adapt existing pages to subscribe to shared events
- move current `ChatBar` toward a shared interaction client

### File size guardrails

Hard constraints:
- New files should target `< 250` lines.
- Orchestrator files may reach `<= 350` lines if unavoidable.
- No new monolith comparable to `runner.ts`.
- Shared types go in dedicated model files, not in shells.
- UI shells should remain thin and call shared control-layer modules.

## Rollout Plan

### Phase 1: Shared models and runtime bridge

Build:
- session model
- intent model
- execution status/events
- automation modes
- runtime bridge to existing pipeline actions

No UI replacement yet.

### Phase 2: TUI shell

Build the project-scoped TUI:
- project startup
- active book binding
- chat input
- process/status pane
- core commands

### Phase 3: Human edit transactions

Add:
- chapter-level edit controller
- truth-file-aware edit flow
- entity rename flow

### Phase 4: Studio adoption

Refit Studio:
- shared conversation brain
- shared event/status model
- replace one-shot chat behavior

## What This Design Explicitly Avoids

- no separate Studio and TUI orchestration stacks
- no top-heavy onboarding questionnaire
- no raw file editing as the primary mutation model
- no giant new “god file”
- no rewriting the entire pipeline before the control layer exists

## Recommendation

Implement this as a new long-running branch rooted in an isolated worktree.

The order should be:
1. shared interaction/control models
2. runtime bridge
3. TUI shell
4. edit controller
5. Studio migration

That keeps the architecture correct while still delivering the writing-workbench experience early through TUI.
