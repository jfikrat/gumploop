# Gumploop MCP

Multi-agent development pipeline with consensus-based planning. Like Forrest Gump: simple but gets the job done.

> "Run Forrest Run!"

## What is Gumploop?

Gumploop is an MCP (Model Context Protocol) server that orchestrates multiple AI agents (Claude, Gemini, Codex) to work together on software development tasks. Instead of relying on a single AI, Gumploop creates a collaborative pipeline where agents review each other's work until consensus is reached.

## Features

- **Consensus-Based Planning**: Claude writes plans, Gemini and Codex review them. Iteration continues until both reviewers approve.
- **Multi-Phase Pipeline**: Planning → Coding → Testing → Debugging
- **Parallel Agent Execution**: Agents run in separate terminal windows via tmux
- **Session File Detection**: Completion detection via Codex/Gemini session files
- **Progress Tracking**: Real-time progress via `.gumploop/progress.jsonl`

## Requirements

- **Bun** - JavaScript runtime
- **tmux** - Terminal multiplexer for agent sessions
- **ghostty** - Terminal emulator (configurable via `PIPELINE_TERMINAL` env var)
- **claude** CLI - Claude Code CLI
- **gemini** CLI - Gemini CLI
- **codex** CLI - Codex CLI

## Installation

```bash
# Clone the repository
git clone <repo-url> gumploop
cd gumploop

# Install dependencies
bun install

# Build
bun run build
```

## MCP Configuration

Add to your Claude Code MCP settings (`~/.claude/config.json` or project-level):

```json
{
  "mcpServers": {
    "gumploop": {
      "command": "bun",
      "args": ["run", "/path/to/gumploop/dist/index.js"]
    }
  }
}
```

## Quick Start

### 1. Start a Planning Session

```
Use mcp__gumploop__plan tool with:
  task: "Implement a Stack<T> data structure with push, pop, peek, isEmpty, size, and clear methods"
  workDir: "/home/user/my-project"  # Optional: defaults to /tmp/collab-mcp/project
```

This will:
1. Start Claude, Gemini, and Codex agents in parallel
2. Claude writes a plan to `.gumploop/plan.md`
3. Gemini and Codex review the plan
4. If not approved, Claude revises based on feedback
5. Loop continues until consensus or max iterations

### 2. Implement the Code

```
Use mcp__gumploop__code tool
```

This will:
1. Claude implements the code based on the approved plan
2. Codex reviews the implementation
3. Claude fixes any issues
4. Loop until code is approved

### 3. Run Tests

```
Use mcp__gumploop__test tool
```

### 4. Debug if Tests Fail

```
Use mcp__gumploop__debug tool
```

## Project Directory

All pipeline work happens in `/tmp/collab-mcp/project/`. Pipeline metadata is stored in `.gumploop/` subdirectory.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PIPELINE_TERMINAL` | `ghostty` | Terminal emulator to use |

## Available Tools

Tools are prefixed with `mcp__gumploop__` when used in Claude Code:

| Tool | Full Name | Description |
|------|-----------|-------------|
| `plan` | `mcp__gumploop__plan` | Start consensus-based planning phase |
| `code` | `mcp__gumploop__code` | Start coding phase with code review |
| `test` | `mcp__gumploop__test` | Write and run tests |
| `debug` | `mcp__gumploop__debug` | Debug failing tests |
| `status` | `mcp__gumploop__status` | Get current pipeline status |
| `stop` | `mcp__gumploop__stop` | Stop all running agents |
| `reset` | `mcp__gumploop__reset` | Reset pipeline state |

See [tools.md](./tools.md) for detailed API reference.

## Documentation

- [Architecture](./architecture.md) - System design and internals
- [Tools Reference](./tools.md) - Detailed API documentation
- [Workflows](./workflows.md) - Usage examples and patterns
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
- [Loop System Design](./loop-system-design.md) - Future loop designs

## Version

**v2.1.1** - Multi-agent consensus pipeline with workDir support (`.gumploop` folder)
