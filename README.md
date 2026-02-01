# Gumploop MCP v2.4.0

> "Run Forrest Run!" - Multi-agent development pipeline with consensus-based planning.

[![Version](https://img.shields.io/badge/version-2.4.0-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)]()

## Overview

Gumploop is an MCP (Model Context Protocol) server that orchestrates multiple AI agents (Claude, Gemini, Codex) to work together on software development tasks. Instead of relying on a single AI, Gumploop creates a collaborative pipeline where agents review each other's work until consensus is reached.

## Features

| Feature | Description |
|---------|-------------|
| **Consensus Planning** | Claude writes plans, Gemini + Codex review until both approve |
| **Multi-Phase Pipeline** | Planning → Coding → Testing → Debugging |
| **Parallel Execution** | Agents run in separate terminal windows via tmux |
| **Adaptive Timeout** | 30min base + 15min extensions for active agents |
| **Progress Tracking** | Real-time via `.gumploop/progress.jsonl` |
| **Security Hardened** | Command injection prevention, safe temp files |

## Requirements

| Dependency | Purpose |
|------------|---------|
| **Bun** | JavaScript runtime |
| **tmux** | Terminal multiplexer for agent sessions |
| **ghostty** | Terminal emulator (configurable) |
| **claude** | Claude Code CLI |
| **gemini** | Gemini CLI |
| **codex** | Codex CLI |
| **i3** | Window manager (for workspace management) |

## Installation

```bash
# Clone
git clone <repo-url> gumploop
cd gumploop

# Install & Build
bun install
bun run build
```

## MCP Configuration

Add to `~/.claude.json` or project `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "gumploop": {
      "command": "bun",
      "args": ["run", "/path/to/gumploop/dist/index.js"],
      "env": {
        "PIPELINE_TERMINAL": "ghostty"
      }
    }
  }
}
```

## Quick Start

### 1. Plan
```
mcp__gumploop__plan
  task: "Implement Stack<T> with push, pop, peek methods"
  workDir: "/home/user/my-project"
  maxIterations: 3
```

### 2. Code
```
mcp__gumploop__code
  maxIterations: 5
```

### 3. Test
```
mcp__gumploop__test
```

### 4. Debug (if tests fail)
```
mcp__gumploop__debug
  maxIterations: 3
```

## Available Tools

| Tool | Description |
|------|-------------|
| `plan` | Start consensus-based planning phase |
| `code` | Start coding phase with code review |
| `test` | Write and run tests |
| `debug` | Debug failing tests |
| `status` | Get current pipeline status |
| `stop` | Stop all running agents |
| `reset` | Reset pipeline state |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PIPELINE_TERMINAL` | `ghostty` | Terminal emulator |

## Timeout Configuration

| Constant | Value | Description |
|----------|-------|-------------|
| `TIMEOUT_BASE` | 30 min | Base timeout per agent |
| `TIMEOUT_EXTENSION` | 15 min | Extension if agent active |
| `ACTIVITY_THRESHOLD` | 60 sec | Activity detection window |

## Project Structure

```
gumploop/
├── index.ts          # Main MCP server
├── dist/             # Built output
├── docs/             # Documentation
│   ├── architecture.md
│   ├── tools.md
│   ├── workflows.md
│   └── troubleshooting.md
├── CHANGELOG.md      # Version history
├── ISSUES.md         # Known issues & solutions
└── README.md         # This file
```

## Documentation

- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [ISSUES.md](./ISSUES.md) - Known issues and solutions
- [docs/architecture.md](./docs/architecture.md) - System design
- [docs/tools.md](./docs/tools.md) - API reference
- [docs/troubleshooting.md](./docs/troubleshooting.md) - Common issues

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.4.0 | 2026-02-01 | Bug fixes: test phase, workDir, planningComplete |
| 2.3.0 | 2026-02-01 | Adaptive timeout (30min + 15min extensions) |
| 2.2.0 | 2026-02-01 | Security hardening, bug fixes |
| 2.1.1 | 2026-01-30 | Initial release |

## License

MIT
