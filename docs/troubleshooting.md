# Troubleshooting

## Agent Won't Start

### Symptoms
- Pipeline hangs at "Starting agents..."
- No tmux sessions created
- Terminal window doesn't appear

### Causes & Solutions

**1. Terminal not found**

Check if your terminal is installed:
```bash
which ghostty  # or your configured terminal
```

If using a different terminal, set the environment variable:
```bash
export PIPELINE_TERMINAL=kitty  # or alacritty, wezterm, etc.
```

**2. CLI not installed**

Verify CLI tools are available:
```bash
which claude
which gemini
which codex
```

**3. tmux not running**

Start tmux first:
```bash
tmux new-session -d  # Start detached session
```

---

## Completion Detection Fails

### Symptoms
- "Timeout waiting for X completion"
- Agent clearly finished but pipeline still waiting

### Solutions

**1. Check session file locations**

For Codex:
```bash
ls -la ~/.codex/sessions/$(date +%Y/%m/%d)/
```

For Gemini:
```bash
ls -la ~/.gemini/tmp/
```

**2. Increase timeout**

The default timeout is 5 minutes. For complex tasks, this may not be enough. Currently, timeout is hardcoded - check `index.ts` for `timeoutMs` values.

**3. Check pane output (Claude)**

```bash
tmux capture-pane -t pipeline-planner-claude -p -S -50
```

Look for the expected completion indicators:
- `❯` prompt
- "Worked for" message
- No `⏳` or "Running"

**4. Manually trigger progress event**

If agent finished but didn't write to progress.jsonl:
```bash
echo '{"agent": "claude", "action": "plan_written", "iteration": 1}' >> /tmp/collab-mcp/project/.gumploop/progress.jsonl
```

---

## Plan Not Created

### Symptoms
- "Plan file not created or too short!"
- Empty or minimal `.gumploop/plan.md`

### Solutions

**1. Check Claude session**

Attach and see what happened:
```bash
tmux attach -t pipeline-planner-claude
```

**2. Check for errors**

Look for error messages in the pane output.

**3. Task too vague**

Make your task description more specific. Claude needs clear requirements to write a good plan.

---

## Reviewers Always Reject

### Symptoms
- Max iterations reached without consensus
- Reviewers keep finding issues

### Solutions

**1. Increase max iterations**

```json
{
  "task": "...",
  "maxIterations": 7
}
```

**2. Simplify the task**

Break complex tasks into smaller pieces.

**3. Check reviewer prompts**

The reviewers are intentionally strict in early iterations. This is by design to ensure thorough review. In the final iteration, they're more lenient.

---

## tmux Session Cleanup

### Orphaned Sessions

If pipeline crashes, sessions may remain:

```bash
# List all pipeline sessions
tmux list-sessions | grep pipeline

# Kill all
tmux list-sessions -F '#{session_name}' | grep pipeline | xargs -I {} tmux kill-session -t {}

# Or use the tool
Use mcp__gumploop__stop tool
```

### Session Name Conflicts

If you see "duplicate session" errors:
```bash
# Kill specific session
tmux kill-session -t pipeline-planner-claude
tmux kill-session -t pipeline-planner-gemini
tmux kill-session -t pipeline-planner-codex
```

---

## State Corruption

### Symptoms
- "Planning not complete" when planning was done
- Weird phase transitions

### Solutions

**1. Check state file**

```bash
cat /tmp/collab-mcp/.state.json | jq .
```

**2. Manual state fix**

```bash
# Edit the state
nano /tmp/collab-mcp/.state.json

# Set planningComplete: true, etc.
```

**3. Full reset**

```
Use mcp__gumploop__reset tool
```

---

## Gemini Specific Issues

### Slash Command Interpretation

Gemini may interpret certain patterns as commands. The pipeline prepends "Soru: " to avoid this, but if issues persist:

- Avoid starting messages with `/`
- Avoid `!` in task descriptions

### YOLO Mode

Gemini needs to be in YOLO mode for autonomous operation. The `-y` flag enables this. If prompts appear, Gemini isn't in YOLO mode.

---

## Codex Specific Issues

### Sandbox Bypass

Codex needs `--dangerously-bypass-approvals-and-sandbox` for autonomous file operations. Without it, Codex will ask for permission.

### Session File Location

Codex session files are at:
```
~/.codex/sessions/YYYY/MM/DD/*.jsonl
```

If completion detection fails, check these files exist and contain recent events.

---

## Performance Issues

### Pipeline Very Slow

**1. Agent startup**

Initial agent startup takes time as CLIs initialize. This is normal.

**2. Completion polling**

The pipeline polls every 2 seconds. This adds latency but is necessary for reliability.

**3. Large codebase**

If working with a large project, agents may take longer to analyze. Increase timeouts.

### Memory Issues

tmux sessions and terminal windows consume memory. If running many pipelines:

```bash
# Clean up old sessions
tmux kill-server

# Or selectively
tmux list-sessions | grep -v needed | cut -d: -f1 | xargs -I {} tmux kill-session -t {}
```

---

## Logs and Debugging

### Enable Debug Output

Currently, Gumploop outputs to stderr:
```bash
bun run /path/to/gumploop/dist/index.js 2>&1 | tee gumploop.log
```

### Progress File

The progress file shows what happened:
```bash
cat /tmp/collab-mcp/project/.gumploop/progress.jsonl
```

### Pipeline Files

All communication happens via files:
```bash
ls -la /tmp/collab-mcp/project/.gumploop/
cat /tmp/collab-mcp/project/.gumploop/*.md
```
