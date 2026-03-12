# InkOS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-orange.svg)](https://pnpm.io/)
[![Alpha](https://img.shields.io/badge/status-alpha-red.svg)](#status)

Open-source multi-agent novel production system. AI agents autonomously write, audit, and revise novels --- with human review gates that keep you in control.

Inspired by a validated workflow from a [linux.do](https://linux.do) community member who earned $10K+ in 3 months using AI-assisted novel writing (AI辅助网文写作).

---

## Why InkOS?

Writing a novel with AI isn't just "prompt and paste." Long-form fiction breaks down fast: characters forget things, items appear from nowhere, the same adjectives repeat every paragraph, and plot threads silently die. InkOS treats these as engineering problems.

- **Canonical truth files** track the real state of the world, not what the LLM hallucinates
- **Anti-information-leaking** ensures characters only know what they've actually witnessed
- **Resource decay** means supplies deplete and items break --- no infinite backpacks
- **Vocabulary fatigue detection** catches overused words before your readers do
- **Auto-revision** fixes critical issues (math errors, continuity breaks) before they reach human review

## How It Works

InkOS runs a multi-agent pipeline for each chapter:

```
 Radar ──> Architect ──> Writer ──> Continuity Auditor ──> Reviser
   │           │           │               │                   │
   │           │           │               │                   │
 Scans      Plans       Drafts         Audits the          Fixes issues
 trending   chapter     prose from      draft against       flagged by
 topics &   outline,    the outline     canonical truth     the auditor
 platform   scene       + state files   files               (auto or manual)
 trends     beats
```

### Agent Roles

| Agent | Responsibility |
|-------|---------------|
| **Radar** | Scans platform trends and reader preferences to inform story direction |
| **Architect** | Plans chapter structure: outline, scene beats, pacing targets |
| **Writer** | Produces prose from the architect's plan + current world state |
| **Continuity Auditor** | Validates the draft against three canonical truth files (see below) |
| **Reviser** | Fixes issues found by the auditor --- auto-fixes critical problems, flags others for human review |

### Three Canonical Truth Files (三大真相文件)

Every book maintains three files that act as the single source of truth:

| File | Purpose |
|------|---------|
| `current_state.md` | World state: character locations, relationships, knowledge, emotional arcs |
| `particle_ledger.md` | Resource accounting: items, money, supplies with quantities and decay tracking |
| `pending_hooks.md` | Open plot threads: foreshadowing planted, promises to readers, unresolved conflicts |

The Continuity Auditor checks every draft against these files. If a character "remembers" something they never witnessed, or pulls a weapon they lost two chapters ago, the auditor catches it.

## Architecture

```
inkos/
├── packages/
│   ├── core/              # Agent runtime, pipeline, state management
│   │   ├── agents/        # architect, writer, continuity, reviser, radar
│   │   ├── pipeline/      # runner (write→audit→revise), scheduler (daemon)
│   │   ├── state/         # File-based state manager
│   │   ├── llm/           # OpenAI-compatible provider (streaming)
│   │   ├── notify/        # Telegram, Feishu (飞书), WeCom (企业微信)
│   │   ├── models/        # Zod schemas
│   │   └── prompts/       # Agent prompt templates
│   └── cli/               # Commander.js CLI
│       └── commands/       # init, book, write, review, status, radar, daemon, doctor
├── templates/             # Project scaffolding templates
└── (future) studio/       # Web UI for review and editing
```

TypeScript monorepo managed with pnpm workspaces. `@inkos/core` handles all agent logic; the `inkos` CLI package consumes it.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- An OpenAI-compatible API key

### Install

```bash
git clone https://github.com/Narcooo/inkos.git
cd inkos
pnpm install
pnpm build
```

### Configure

```bash
cp .env.example .env
```

```env
# .env
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=https://api.openai.com/v1   # or any compatible endpoint
OPENAI_MODEL=gpt-4o

# Optional: notifications
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
FEISHU_WEBHOOK_URL=
WECOM_WEBHOOK_URL=
```

### Create Your First Book

```bash
# Initialize an InkOS project in the current directory
inkos init

# Create a new book with interactive prompts
inkos book create

# Write the next chapter (runs the full agent pipeline)
inkos write next

# Review the latest draft
inkos review

# Check project status
inkos status
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `inkos init` | Initialize a new InkOS project |
| `inkos book create` | Create a new book (interactive) |
| `inkos write next` | Run the agent pipeline to produce the next chapter |
| `inkos review` | Review and approve/reject the latest draft |
| `inkos status` | Show project and book status |
| `inkos radar` | Run the Radar agent to scan platform trends |
| `inkos config` | View or update project configuration |
| `inkos doctor` | Diagnose project setup issues |
| `inkos up` | Start daemon mode --- autonomous write cycles on a schedule |
| `inkos down` | Stop the daemon |

## Daemon Mode

`inkos up` starts an autonomous loop that writes chapters on a schedule. The pipeline runs fully unattended for non-critical issues, but pauses for human review when the auditor flags problems it cannot auto-fix.

Notifications go out via Telegram, Feishu (飞书), or WeCom (企业微信) so you can review from your phone.

## Status

**Early alpha.** The core pipeline works, but expect breaking changes. The API surface, file formats, and CLI commands may all change before v1.

What works:
- Agent pipeline (architect -> writer -> continuity auditor -> reviser)
- File-based state management with canonical truth files
- CLI for project init, book creation, writing, and review
- Notification dispatch (Telegram, Feishu, WeCom)
- Daemon mode with scheduler

What's planned:
- `packages/studio` --- web UI for review, editing, and book management
- Plugin system for custom agents
- Multi-LLM routing (different models for different agents)
- Export to platform-specific formats (起点, 番茄, etc.)

## Contributing

Contributions welcome. This is early-stage software --- if you're interested in AI-assisted creative writing infrastructure, open an issue or PR.

```bash
pnpm install
pnpm dev          # watch mode for all packages
pnpm test         # run tests
pnpm typecheck    # type-check without emitting
```

## License

[MIT](LICENSE)
