# Workflows

## Full Development Pipeline

The complete workflow from task to tested implementation.

### Step 1: Reset (Optional)

If starting fresh or cleaning up a previous run:

```
Use reset tool
```

### Step 2: Planning

```
Use plan tool with:
  task: "Implement a LRU Cache with get, put, delete, and clear methods.
         Support configurable capacity. Use TypeScript generics for key/value types."
  maxIterations: 5
```

Wait for consensus. The agents will:
- Claude: Write detailed plan to `.gumploop/plan.md`
- Gemini: Review UX/API design, suggest improvements
- Codex: Review technical correctness, find edge cases
- Iterate until both reviewers approve

### Step 3: Coding

```
Use code tool with:
  maxIterations: 5
```

The agents will:
- Claude: Implement code based on approved plan
- Codex: Review for bugs, style, best practices
- Iterate until code passes review

### Step 4: Testing

```
Use test tool
```

Claude will:
- Read implemented code
- Write comprehensive tests
- Run `bun test`
- Report results

### Step 5: Debugging (if tests fail)

```
Use debug tool with:
  maxIterations: 3
```

The agents will:
- Codex: Analyze failures, identify root cause
- Claude: Apply minimal fixes
- Re-run tests
- Iterate until tests pass

---

## Quick Bug Fix

For fixing a known bug in existing code.

### Step 1: Setup

Copy your buggy code to `/tmp/collab-mcp/project/`:

```bash
cp -r ~/my-project/* /tmp/collab-mcp/project/
```

### Step 2: Debug Directly

Skip planning/coding phases, go straight to debugging:

```
Use debug tool with:
  maxIterations: 5
```

Note: This requires manually setting `codingComplete: true` in the state file, or running the full pipeline first.

---

## Code Review Only

For reviewing existing code without making changes.

### Using Planning Phase

```
Use plan tool with:
  task: "Review the existing code in this project. Identify bugs,
         security issues, performance problems, and code quality issues.
         Do NOT modify any code - just create a detailed review."
  maxIterations: 1
```

The reviews will be in:
- `.gumploop/review-gemini.md` - UX/API review
- `.gumploop/review-codex.md` - Technical review

---

## API Design

For designing a new API without implementing it.

```
Use plan tool with:
  task: "Design a REST API for a blog platform. Include:
         - User authentication (JWT)
         - CRUD for posts, comments, tags
         - Pagination and filtering
         - Rate limiting strategy

         Output a detailed API specification with endpoints,
         request/response schemas, and error codes."
  maxIterations: 3
```

The final plan in `.gumploop/plan.md` will contain the API specification after consensus.

---

## Monitoring Progress

### During Execution

Check status while pipeline is running:

```
Use status tool
```

### View Pipeline Files

Read the generated files directly:

```bash
# Current plan
cat /tmp/collab-mcp/project/.gumploop/plan.md

# Gemini's review
cat /tmp/collab-mcp/project/.gumploop/review-gemini.md

# Codex's review
cat /tmp/collab-mcp/project/.gumploop/review-codex.md

# Progress events
cat /tmp/collab-mcp/project/.gumploop/progress.jsonl
```

### Watch Agent Windows

The agents run in visible tmux sessions. Find them:

```bash
tmux list-sessions | grep pipeline
```

Attach to watch:

```bash
tmux attach -t pipeline-planner-claude
```

---

## Stopping a Runaway Pipeline

If a pipeline is taking too long or stuck:

```
Use stop tool
```

Or manually:

```bash
# Kill all pipeline tmux sessions
tmux list-sessions -F '#{session_name}' | grep pipeline | xargs -I {} tmux kill-session -t {}
```

---

## Working with Existing Projects

### Import Existing Code

```bash
# Copy to pipeline project directory
cp -r ~/existing-project/* /tmp/collab-mcp/project/

# Or symlink (be careful - agents will modify files)
# ln -s ~/existing-project /tmp/collab-mcp/project
```

### Export Results

After pipeline completes:

```bash
# Copy back to your project
cp -r /tmp/collab-mcp/project/* ~/my-project/

# Excluding pipeline metadata
rsync -av --exclude='.gumploop' /tmp/collab-mcp/project/ ~/my-project/
```

---

## Tips

### Iteration Counts

- **Planning**: Start with 3-5 iterations. Complex tasks may need more.
- **Coding**: 3-5 iterations usually sufficient.
- **Debugging**: 2-3 iterations. If bugs persist, the problem may be architectural.

### Task Descriptions

Be specific in your task descriptions:

**Good:**
```
Implement a priority queue using a binary heap. Support:
- insert(item, priority): O(log n)
- extractMax(): O(log n)
- peek(): O(1)
- isEmpty(): O(1)
Use TypeScript generics for item type.
```

**Bad:**
```
Make a priority queue
```

### Monitoring Tip

To monitor agents:
- Use `status` to see active sessions
- Or `tmux attach -t <session-name>` to watch directly
