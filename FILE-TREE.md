# Gumploop v2.6.0 - File Structure

## Directory Tree
```
src/
├── constants.ts        # Path constants, timeouts, generateRequestId (59 lines)
├── types/
│   └── index.ts        # Type definitions (AgentType, PipelineState, etc.) (32 lines)
├── workdir.ts          # Working directory validation and path helpers (91 lines)
├── state.ts            # Pipeline state management (load/save/validate) (101 lines)
├── workspace.ts        # i3 workspace detection and session naming (100 lines)
├── completion.ts       # Agent completion detection (ANS markers, session files) (358 lines)
├── tmux-agent.ts       # TmuxAgent class - agent lifecycle, messaging (273 lines)
├── phases/
│   ├── planning.ts     # executePlanning - consensus loop (295 lines)
│   ├── coding.ts       # executeCoding - coder/reviewer loop (133 lines)
│   └── testing.ts      # executeTesting, executeDebugging (199 lines)
├── mcp-server.ts       # MCP server setup, tool definitions (224 lines)
└── index.ts            # Main entry point and re-exports (15 lines)
```

## Module Descriptions

| Module | Description |
|--------|-------------|
| `constants.ts` | Defines paths (HOME, DEFAULT_BASE_DIR, SESSION_DIRS), timeout configuration (TIMEOUT_BASE, TIMEOUT_EXTENSION, ACTIVITY_THRESHOLD), forbidden system paths, and generateRequestId utility |
| `types/index.ts` | TypeScript type definitions: AgentType ("claude"/"gemini"/"codex"), I3Node/I3Workspace for i3 tree parsing, PipelineState for tracking pipeline progress |
| `workdir.ts` | Validates working directories (path traversal, forbidden paths), resolves paths, provides getPipelineDir and getPipelineFiles helpers for .gumploop directory structure |
| `state.ts` | JSON state persistence: safeJsonParse, isValidState type guard, defaultState factory, loadState/saveState with project-specific and global fallback |
| `workspace.ts` | i3 window manager integration: findEmptyWorkspace (prefers 6-20), targetWorkspace management, sanitizeSessionName, getWorkDirHash for session isolation |
| `tmux-agent.ts` | TmuxAgent class managing CLI agents in tmux sessions: start/stop lifecycle, secure message passing via tmux buffers, adaptive timeout, completion detection via session files and ANS markers |
| `phases/planning.ts` | Planning phase: Claude writes plan, Gemini and Codex review, iterates until consensus or max iterations reached |
| `phases/coding.ts` | Coding phase: Claude (coder) implements based on plan, Codex (reviewer) reviews code, iterates until approval |
| `phases/testing.ts` | Testing phase: runs tests, writes results; Debugging phase: Codex analyzes bugs, Claude fixes, re-tests |
| `mcp-server.ts` | MCP server: defines 7 tools (plan, code, test, debug, status, stop, reset), handles requests, stopAllAgents helper |
| `index.ts` | Main entry point: re-exports all public APIs and types, starts MCP server |

## Dependency Graph
```
                          constants
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              v               v               v
           types          workdir          (os/path)
              │               │
              │      ┌────────┴────────┐
              │      │                 │
              v      v                 v
           state ◄──────────────── workspace
              │                        │
              │    ┌───────────────────┤
              │    │                   │
              v    v                   │
         tmux-agent ◄──────────────────┘
              │
    ┌─────────┼─────────┐
    │         │         │
    v         v         v
planning   coding   testing
    │         │         │
    └─────────┼─────────┘
              │
              v
         mcp-server
              │
              v
           index
```

### Import Details

| Module | Imports From |
|--------|--------------|
| `constants` | `os` (homedir, tmpdir), `path` (join) |
| `types/index` | (standalone - no internal deps) |
| `workdir` | `constants` (FORBIDDEN_PATHS, DEFAULT_PROJECT_DIR), `fs`, `path` |
| `state` | `constants` (STATE_FILE, DEFAULT_PROJECT_DIR), `workdir` (getPipelineDir), `types` (PipelineState), `fs` |
| `workspace` | `bun` ($), `types` (I3Node, I3Workspace), `state` (safeJsonParse) |
| `completion` | `constants` (TIMEOUT_*, SESSION_DIRS), `state` (safeJsonParse), `fs/promises`, `path` |
| `tmux-agent` | `constants` (TERMINAL, generateRequestId), `types` (AgentType), `workspace` (targetWorkspace, sanitizeSessionName, getWorkDirHash), `completion` (wait*Completion), `bun`, `fs`, `path`, `os` |
| `phases/planning` | `workdir` (getProjectDir, getPipelineFiles), `state` (loadState, saveState), `workspace` (findEmptyWorkspace, targetWorkspace, setTargetWorkspace), `tmux-agent` (TmuxAgent), `fs` |
| `phases/coding` | `workdir` (getPipelineFiles), `state` (loadState, saveState), `tmux-agent` (TmuxAgent), `fs` |
| `phases/testing` | `workdir` (getPipelineFiles), `state` (loadState, saveState), `tmux-agent` (TmuxAgent), `fs` |
| `mcp-server` | `state` (loadState, saveState), `workdir` (getProjectDir, getPipelineDir), `constants` (STATE_FILE), `phases/*` (executePlanning, executeCoding, executeTesting, executeDebugging), `@modelcontextprotocol/sdk`, `bun`, `fs` |
| `index` | All modules (re-exports), `mcp-server` (startServer) |
