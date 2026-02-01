# Tools Reference

## plan

Start planning phase with Claude + Gemini + Codex consensus.

### Description

Orchestrates three agents to create and refine a development plan:
1. Claude writes the initial plan
2. Gemini reviews from UX/UI perspective
3. Codex reviews from technical perspective
4. Claude revises based on feedback
5. Loop until both reviewers approve or max iterations

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | string | Yes | - | The task/feature to plan |
| `workDir` | string | No | `/tmp/collab-mcp/project` | Working directory. Agents will write code here. |
| `maxIterations` | number | No | 5 | Maximum planning iterations |

### Example

```json
{
  "task": "Implement a Stack<T> data structure with push, pop, peek, isEmpty, size, and clear methods. Include comprehensive error handling and TypeScript generics.",
  "workDir": "/home/user/my-project",
  "maxIterations": 3
}
```

### Security

The `workDir` parameter has the following protections:
- Must be an absolute path
- Must exist and be a directory
- Cannot be system directories (`/`, `/etc`, `/usr`, `/bin`, `/root`, etc.)
- Path traversal is blocked

### Output

```markdown
Starting agents in parallel on workspace 7...
All agents started.

## Iteration 1/3

**Step 1: Claude writing plan...**
  ✓ Claude done (plan.md created)

**Step 2: Gemini reviewing...**
  ✓ Gemini done

**Step 3: Codex reviewing...**
  ✓ Codex done

**Results:**
- Gemini: ✗ NEEDS_REVISION
- Codex: ✗ NEEDS_REVISION

⏳ Continuing to next iteration...

## Iteration 2/3
...

✅ **Consensus reached!**
```

### Generated Files

| File | Description |
|------|-------------|
| `.gumploop/plan.md` | The development plan |
| `.gumploop/review-gemini.md` | Gemini's review |
| `.gumploop/review-codex.md` | Codex's review |
| `.gumploop/progress.jsonl` | Progress events |

---

## code

Start coding phase with Coder ↔ Reviewer loop.

### Description

Implements code based on the approved plan:
1. Claude (Coder) implements the code
2. Codex (Reviewer) reviews the implementation
3. Claude fixes any issues
4. Loop until code is approved or max iterations

### Prerequisites

- Planning phase must be complete (`planningComplete: true`)

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `maxIterations` | number | No | 5 | Maximum coding iterations |

### Example

```json
{
  "maxIterations": 5
}
```

### Output

```markdown
Starting coding agents...
Agents started.

## Iteration 1/5

**Step 1: Coder implementing...**
  ✓ Coder done

**Step 2: Reviewer reviewing...**
  ✓ Reviewer done

**Result:** ✗ NEEDS_REVISION
⏳ Continuing to next iteration...

## Iteration 2/5
...

✅ **Code approved!**
```

### Generated Files

| File | Description |
|------|-------------|
| `.gumploop/code-review.md` | Code review results |
| `[project files]` | Implemented code |

---

## test

Write and run tests for the implemented code.

### Description

Creates comprehensive tests and runs them:
1. Claude reads the implemented code
2. Claude writes tests (`.test.ts` files)
3. Runs `bun test`
4. Writes results to test-results.md

### Prerequisites

- Coding phase must be complete (`codingComplete: true`)

### Parameters

None.

### Example

```json
{}
```

### Output

```markdown
Starting tester...
Tester done.

✅ **All tests passed!**

## Test Results
- Tests run: 15
- Passed: 15
- Failed: 0

## Status
TESTS_PASS
```

### Generated Files

| File | Description |
|------|-------------|
| `.gumploop/test-results.md` | Test execution results |
| `*.test.ts` | Test files |

---

## debug

Start debugging phase with Codex analyzer → Claude fixer loop.

### Description

Debugs failing tests:
1. Codex analyzes test failures to find root cause
2. Claude applies fixes
3. Re-runs tests
4. Loop until tests pass or max iterations

### Prerequisites

- Coding phase must be complete (`codingComplete: true`)
- Typically used after `test` shows failures

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `maxIterations` | number | No | 3 | Maximum debug iterations |

### Example

```json
{
  "maxIterations": 3
}
```

### Output

```markdown
## Debug Iteration 1/3

**Step 1: Codex analyzing bugs...**
  ✓ Analysis done

**Step 2: Claude fixing bugs...**
  ✓ Fixes applied

**Step 3: Re-testing...**
  ✓ Tests pass!

✅ **Bugs fixed!**
```

### Generated Files

| File | Description |
|------|-------------|
| `.gumploop/bug-analysis.md` | Bug analysis from Codex |

---

## status

Get current pipeline status.

### Description

Returns a summary of the pipeline state including:
- Current phase
- Task description
- Iteration count
- Active sessions
- Phase completion status
- Pipeline file status

### Parameters

None.

### Example

```json
{}
```

### Output

```markdown
## Pipeline Status

**Current Phase:** planning
**Task:** Implement Stack<T> data structure
**Iteration:** 2
**Active Sessions:** pipeline-planner-claude, pipeline-planner-gemini, pipeline-planner-codex
**Last Update:** 2026-01-30T20:15:30.000Z

### Phase Status
- Planning: ⏳ Pending
- Coding: ⏳ Pending
- Testing: ⏳ Pending
- Debugging: ⏳ Pending

### Pipeline Files
- plan.md: ✓ exists
- review-gemini.md: ✓ exists
- review-codex.md: ✗ missing

**Project Directory:** /tmp/collab-mcp/project
```

---

## stop

Stop all running agents.

### Description

Kills all active tmux sessions and resets the current phase. Does not clear project files or state history.

### Parameters

None.

### Example

```json
{}
```

### Output

```
All agents stopped.
```

---

## reset

Reset entire pipeline state.

### Description

Performs a complete reset:
1. Stops all running agents
2. Deletes all project files
3. Clears state file
4. Recreates empty directories

Use this when starting a new task from scratch.

### Parameters

None.

### Example

```json
{}
```

### Output

```
Pipeline reset complete.
```

---

## Common Return Format

All tools return content in MCP format:

```typescript
{
  content: [
    {
      type: "text",
      text: "Result text here..."
    }
  ],
  isError?: boolean  // true if error occurred
}
```

## Error Handling

On error, tools return:

```typescript
{
  content: [
    {
      type: "text",
      text: "Error: [error message]"
    }
  ],
  isError: true
}
```

Common errors:
- "Planning not complete. Run planning phase first."
- "Coding not complete. Run coding phase first."
- "Timeout waiting for [agent] completion"
