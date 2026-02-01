# Architecture

## Overview

Gumploop orchestrates multiple AI agents through tmux sessions, coordinating their work via shared files and a central state manager.

```
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code (Caller)                     │
│                          via MCP                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Gumploop MCP Server                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ State Manager│  │ TmuxAgent    │  │ Phase        │       │
│  │ (JSON file)  │  │ (sessions)   │  │ Executors    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Claude   │    │ Gemini   │    │ Codex    │
    │ (tmux)   │    │ (tmux)   │    │ (tmux)   │
    └──────────┘    └──────────┘    └──────────┘
          │               │               │
          └───────────────┼───────────────┘
                          ▼
                ┌─────────────────┐
                │ /tmp/collab-mcp │
                │   /project/     │
                │   /.gumploop/   │
                └─────────────────┘
```

## Directory Structure

By default, the pipeline uses `/tmp/collab-mcp/project/`. However, you can specify any directory using the `workDir` parameter:

```
<workDir>/                      # Your project directory (e.g., /home/user/my-app)
├── .gumploop/                  # Pipeline metadata
│   ├── plan.md                 # Current plan (Claude writes)
│   ├── review-gemini.md        # Gemini's review
│   ├── review-codex.md         # Codex's review
│   ├── code-review.md          # Code review results
│   ├── test-results.md         # Test output
│   ├── bug-analysis.md         # Debug analysis
│   └── progress.jsonl          # Progress events
└── [project files]             # Your actual code files

/tmp/collab-mcp/
└── .state.json                 # Pipeline state (always here)
```

### Working Directory Security

The `workDir` is validated before use:
- Must be an absolute path
- Must exist and be a directory
- System directories are forbidden (`/`, `/etc`, `/usr`, `/bin`, `/root`, etc.)
- Path traversal attempts are blocked

## Agent Types

### Claude
- **Role**: Planner, Coder, Fixer
- **CLI**: `claude --dangerously-skip-permissions`
- **Session files**: `~/.claude/projects/` (not used for completion detection)
- **Completion detection**: Pane polling for "Worked for" or idle prompt

### Gemini
- **Role**: Reviewer (UX/UI focus), Designer
- **CLI**: `gemini -m gemini-3-flash-preview -y`
- **Session files**: `~/.gemini/tmp/[project-hash]/chats/*.json`
- **Completion detection**: Session file parsing for `◆END◆` marker or ANS marker

### Codex
- **Role**: Reviewer (Technical focus), Analyzer
- **CLI**: `codex --dangerously-bypass-approvals-and-sandbox`
- **Session files**: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
- **Completion detection**: Session file parsing for `agent_message` or `token_count` events

## TmuxAgent Class

The `TmuxAgent` class manages individual agent sessions.

```typescript
class TmuxAgent {
  sessionName: string;      // e.g., "pipeline-planner-claude"
  agentType: AgentType;     // "claude" | "gemini" | "codex"
  messageStartTime: number; // Timestamp for completion detection
  currentRequestId: string; // Request ID for marker matching

  // Methods
  start(): Promise<void>;           // Create tmux session, launch CLI
  sendMessage(msg): Promise<void>;  // Send message via tmux paste-buffer
  waitForCompletion(): Promise<void>; // Wait for agent to finish
  stop(): Promise<void>;            // Kill tmux session
}
```

### Message Sending

Messages are sent via tmux's paste-buffer mechanism to handle multi-line content:

```typescript
// 1. Write message to temp file
writeFileSync(tmpFile, safeMessage);

// 2. Load into tmux buffer
await $`tmux load-buffer -b ${bufferName} ${tmpFile}`.quiet();

// 3. Paste into session
await $`tmux paste-buffer -t ${sessionName} -b ${bufferName} -p`.quiet();

// 4. Send Enter
await $`tmux send-keys -t ${sessionName} Enter`.quiet();
```

### Completion Detection

Each agent type has its own completion detection strategy:

| Agent | Strategy | Indicator |
|-------|----------|-----------|
| Claude | Pane polling | `❯` prompt visible, no `⏳` or `Running` |
| Gemini | Session file | `◆END◆` marker or `[ANS-*]` marker |
| Codex | Session file | `agent_message` or `token_count` event |

### Request ID System

To correlate requests with responses:

```typescript
// Generate unique ID
const requestId = `RQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Message includes instruction to echo marker
const ansId = requestId.replace("RQ-", "ANS-");
message += `\n\n[IMPORTANT: End your response with [${ansId}] marker]`;

// Completion detection looks for the marker
if (content.includes(`[${ansId}]`)) return true;
```

## State Management

Pipeline state is stored in `/tmp/collab-mcp/.state.json`:

```typescript
interface PipelineState {
  currentPhase: string | null;  // "planning" | "coding" | "testing" | "debugging"
  task: string;                 // Task description
  workDir: string;              // Working directory for this pipeline
  iteration: number;            // Current iteration count
  planningComplete: boolean;
  codingComplete: boolean;
  testingComplete: boolean;
  debuggingComplete: boolean;
  activeSessions: string[];     // Active tmux session names
  lastUpdate: string;           // ISO timestamp
}
```

The `workDir` is set during planning phase and persists through all subsequent phases.

State is loaded/saved synchronously via `readFileSync`/`writeFileSync` to ensure consistency.

## Progress Tracking

Agents write progress events to `.gumploop/progress.jsonl`:

```jsonl
{"agent": "claude", "action": "plan_written", "iteration": 1}
{"agent": "gemini", "action": "review_written", "iteration": 1}
{"agent": "codex", "action": "review_written", "iteration": 1}
```

The `waitForProgressEvent` method polls this file to detect phase completion:

```typescript
async waitForProgressEvent(agent, action, iteration, timeoutMs) {
  while (Date.now() < deadline) {
    const content = readFileSync(PROGRESS_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const event = JSON.parse(line);
      if (event.agent === agent && event.action === action && event.iteration === iteration) {
        return; // Found it
      }
    }
    await Bun.sleep(2000);
  }
  throw new Error("Timeout");
}
```

## Phase Execution Flow

### Planning Phase

```
1. Clean old pipeline files
2. Start Claude, Gemini, Codex agents in parallel
3. FOR each iteration:
   a. Claude writes/revises plan.md
   b. Wait for progress event: claude/plan_written
   c. Gemini reviews → review-gemini.md
   d. Wait for progress event: gemini/review_written
   e. Codex reviews → review-codex.md
   f. Wait for progress event: codex/review_written
   g. Check if both APPROVED
   h. If consensus: break
4. Stop all agents
5. Return result
```

### Coding Phase

```
1. Verify planning complete
2. Start Coder (Claude) and Reviewer (Codex)
3. FOR each iteration:
   a. Coder implements/fixes code
   b. Wait for completion
   c. Reviewer reviews → code-review.md
   d. Wait for completion
   e. Check if CODE_APPROVED
   f. If approved: break
4. Stop agents
5. Return result
```

## Error Handling

- **Agent crash**: Caught in try/catch, all sessions stopped, state reset
- **Timeout**: 5 minute default timeout for completion detection
- **Missing files**: Graceful handling with continue/retry logic
- **Tmux errors**: Silenced with `2>/dev/null || true`

## Design Principles

1. **Claude writes code** - Other agents analyze/review
2. **Autonomous operation** - No user intervention during loop
3. **File-based communication** - Results written directly to project
4. **Iterative refinement** - Loop until success or max iterations
5. **Parallel where possible** - Agent startup is parallelized
