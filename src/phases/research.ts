/**
 * Gumploop MCP - Research Phase
 * Deep research on a topic before coding: gather, analyze, synthesize.
 */
import { mkdirSync, existsSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { getProjectDir, getPipelineFiles } from "../workdir";
import { loadState, saveState } from "../state";
import { findEmptyWorkspace, targetWorkspace, setTargetWorkspace } from "../workspace";
import { TmuxAgent } from "../tmux-agent";

export type ResearchDepth = "quick" | "deep";

/** Execute research phase: gather → analyze → synthesize. */
export async function executeResearch(
  question: string,
  depth: ResearchDepth = "deep",
  workDir?: string
): Promise<{ success: boolean; result: string }> {
  const projectDir = getProjectDir(workDir);
  const files = getPipelineFiles(projectDir);

  // Ensure directories exist
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(files.gumploopDir, { recursive: true });

  const state = loadState(projectDir);
  state.currentPhase = "research";
  state.task = question;
  state.workDir = projectDir;
  state.iteration = 0;
  state.activeSessions = [];
  saveState(state);

  // Clean old research files
  const researchFiles = [
    files.researchFile,
    files.researchSourcesFile,
    files.researchClaudeFile,
    files.researchGeminiFile,
    files.researchCodexFile,
  ];
  for (const f of researchFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  if (existsSync(files.progressFile)) unlinkSync(files.progressFile);

  const results: string[] = [];
  results.push(`## Research Phase`);
  results.push(`**Question:** ${question}`);
  results.push(`**Depth:** ${depth}`);
  results.push(`**Working Directory:** ${projectDir}\n`);

  // Start agents
  const claude = new TmuxAgent("research-claude", "claude", projectDir);
  const gemini = new TmuxAgent("research-gemini", "gemini", projectDir);
  const codex = new TmuxAgent("research-codex", "codex", projectDir);

  try {
    setTargetWorkspace(await findEmptyWorkspace());
    results.push(`Starting agents on workspace ${targetWorkspace}...`);

    await Promise.all([claude.start(), gemini.start(), codex.start()]);

    state.activeSessions = [
      claude.getSessionName(),
      gemini.getSessionName(),
      codex.getSessionName(),
    ];
    saveState(state);
    results.push("All agents started.\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1: GATHER - Web search and collect sources
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 1: Gather Sources\n");
    state.iteration = 1;
    saveState(state);

    // Generate search queries based on the question
    const searchQueries = generateSearchQueries(question, depth);

    const gatherPrompt = `# Research - Gather Sources

## Research Question
${question}

## Your Task
Search the web for information about this topic. Use multiple search queries to get comprehensive coverage.

## Suggested Search Queries
${searchQueries.map((q, i) => `${i + 1}. "${q}"`).join("\n")}

## Instructions
1. Use web search to find relevant sources
2. For each useful source, extract:
   - URL
   - Key points
   - Code examples (if any)
   - Best practices mentioned
3. Focus on recent information (2024-2026)
4. Look for:
   - Official documentation
   - Well-regarded tutorials
   - GitHub repositories with good examples
   - Stack Overflow discussions
   - Blog posts from experts

## Write your findings to: ${files.researchSourcesFile}

Format:
\`\`\`markdown
# Research Sources

## Source 1: [Title](URL)
**Type:** Documentation | Tutorial | GitHub | Blog | Discussion
**Key Points:**
- Point 1
- Point 2

**Code Example (if any):**
\`\`\`code
...
\`\`\`

## Source 2: ...
\`\`\`

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "gather_done", "iteration": 1}`;

    await claude.sendMessage(gatherPrompt);
    await claude.waitForProgressEvent("claude", "gather_done", 1, files.progressFile);
    results.push("- Sources gathered\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: ANALYZE - Each agent analyzes from different perspective
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 2: Analyze\n");
    state.iteration = 2;
    saveState(state);

    const sourcesExist = existsSync(files.researchSourcesFile);
    const sourcesContent = sourcesExist ? `\n\nSources gathered:\n${files.researchSourcesFile}` : "";

    // Claude: Best practices & architecture
    const claudeAnalyzePrompt = `# Research Analysis - Best Practices Focus

## Research Question
${question}
${sourcesContent}

## Your Focus
Analyze from a **best practices and architecture** perspective:
- What are the recommended patterns?
- What architecture decisions should be made?
- What are the trade-offs between different approaches?
- What do official docs recommend?

## Read the sources file first: ${files.researchSourcesFile}

## Write your analysis to: ${files.researchClaudeFile}

Format:
\`\`\`markdown
# Best Practices Analysis

## Recommended Approach
[Your recommendation]

## Architecture Considerations
- [Point 1]
- [Point 2]

## Trade-offs
| Approach | Pros | Cons |
|----------|------|------|
| ... | ... | ... |

## Key Patterns
1. [Pattern with explanation]
2. [Pattern with explanation]

## References
- [Source 1]
- [Source 2]
\`\`\`

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "analyze_done", "iteration": 2}`;

    // Gemini: Modern trends & DX
    const geminiAnalyzePrompt = `# Research Analysis - Modern Trends Focus

## Research Question
${question}
${sourcesContent}

## Your Focus
Analyze from a **modern trends and developer experience** perspective:
- What's the latest approach in 2026?
- What tools/libraries are trending?
- How can we make the DX better?
- What are innovative solutions?

## Read the sources file first: ${files.researchSourcesFile}

## Write your analysis to: ${files.researchGeminiFile}

Format:
\`\`\`markdown
# Modern Trends Analysis

## Current Best Tools (2026)
1. [Tool/Library] - why it's recommended
2. [Tool/Library] - why it's recommended

## Latest Approaches
- [Trend 1]
- [Trend 2]

## DX Recommendations
- [How to make implementation easier]

## Code Example (Modern Approach)
\`\`\`typescript
// Modern implementation
\`\`\`

## What to Avoid (Outdated)
- [Outdated approach 1]
- [Outdated approach 2]
\`\`\`

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "gemini", "action": "analyze_done", "iteration": 2}`;

    // Codex: Security & edge cases
    const codexAnalyzePrompt = `# Research Analysis - Security & Edge Cases Focus

## Research Question
${question}
${sourcesContent}

## Your Focus
Analyze from a **security and edge cases** perspective:
- What are the security considerations?
- What can go wrong?
- What edge cases need handling?
- What are common mistakes?

## Read the sources file first: ${files.researchSourcesFile}

## Write your analysis to: ${files.researchCodexFile}

Format:
\`\`\`markdown
# Security & Edge Cases Analysis

## Security Considerations
1. [Security concern + mitigation]
2. [Security concern + mitigation]

## Common Mistakes
- [Mistake 1] → How to avoid
- [Mistake 2] → How to avoid

## Edge Cases to Handle
1. [Edge case + how to handle]
2. [Edge case + how to handle]

## Error Handling
\`\`\`typescript
// Recommended error handling pattern
\`\`\`

## Checklist Before Implementation
- [ ] [Security check 1]
- [ ] [Security check 2]
- [ ] [Edge case check 1]
\`\`\`

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "codex", "action": "analyze_done", "iteration": 2}`;

    // Send all analyze prompts in parallel
    await Promise.all([
      claude.sendMessage(claudeAnalyzePrompt),
      gemini.sendMessage(geminiAnalyzePrompt),
      codex.sendMessage(codexAnalyzePrompt),
    ]);

    // Wait for all to complete
    await Promise.all([
      claude.waitForProgressEvent("claude", "analyze_done", 2, files.progressFile),
      gemini.waitForProgressEvent("gemini", "analyze_done", 2, files.progressFile),
      codex.waitForProgressEvent("codex", "analyze_done", 2, files.progressFile),
    ]);

    results.push("- Claude: Best practices analysis");
    results.push("- Gemini: Modern trends analysis");
    results.push("- Codex: Security analysis\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 3: SYNTHESIZE - Combine all analyses into final report
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 3: Synthesize\n");
    state.iteration = 3;
    saveState(state);

    const synthesizePrompt = `# Research - Final Synthesis

## Original Question
${question}

## Your Task
Read ALL analysis files and create a comprehensive research report.

## Read These Files
- ${files.researchSourcesFile} (Raw sources)
- ${files.researchClaudeFile} (Best practices analysis)
- ${files.researchGeminiFile} (Modern trends analysis)
- ${files.researchCodexFile} (Security analysis)

## Create Final Report: ${files.researchFile}

Format:
\`\`\`markdown
# Research Report: ${question}

**Generated:** ${new Date().toISOString().split("T")[0]}
**Depth:** ${depth}

## Executive Summary
[2-3 sentence summary of findings]

## Recommended Approach
[Clear recommendation based on all analyses]

## Key Findings

### Best Practices
[From Claude's analysis]

### Modern Tools & Trends (2026)
[From Gemini's analysis]

### Security Considerations
[From Codex's analysis]

## Implementation Guide

### Step 1: [First step]
[Details]

### Step 2: [Second step]
[Details]

### Step 3: [Third step]
[Details]

## Code Examples

### Basic Implementation
\`\`\`typescript
// Code example
\`\`\`

### With Error Handling
\`\`\`typescript
// Code example with proper error handling
\`\`\`

## Pitfalls to Avoid
1. [Pitfall + why]
2. [Pitfall + why]

## Checklist
- [ ] [Item 1]
- [ ] [Item 2]
- [ ] [Item 3]

## Sources
- [Source 1](URL)
- [Source 2](URL)

---
*Research conducted by Claude, Gemini, and Codex*
\`\`\`

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "synthesize_done", "iteration": 3}`;

    await claude.sendMessage(synthesizePrompt);
    await claude.waitForProgressEvent("claude", "synthesize_done", 3, files.progressFile);

    results.push("- Final report synthesized\n");

    // ─────────────────────────────────────────────────────────────────────────
    // DONE - Read and display results
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Research Complete!\n");

    if (existsSync(files.researchFile)) {
      const research = readFileSync(files.researchFile, "utf-8");
      results.push("## Research Report\n");
      results.push(research);
    }

    results.push("\n---");
    results.push("**Next Steps:**");
    results.push("1. Review the research report above");
    results.push("2. Use findings to inform your implementation");
    results.push("3. Run `plan` with insights from research");

    // Stop agents
    await claude.stop();
    await gemini.stop();
    await codex.stop();
    state.activeSessions = [];
    state.currentPhase = null;
    saveState(state);

    return { success: true, result: results.join("\n") };
  } catch (error) {
    await claude.stop();
    await gemini.stop();
    await codex.stop();
    state.activeSessions = [];
    state.currentPhase = null;
    saveState(state);
    throw error;
  }
}

/**
 * Generate search queries based on the research question
 */
function generateSearchQueries(question: string, depth: ResearchDepth): string[] {
  const baseQueries = [
    `${question} best practices 2026`,
    `${question} tutorial`,
    `${question} security considerations`,
  ];

  if (depth === "deep") {
    return [
      ...baseQueries,
      `${question} common mistakes`,
      `${question} production ready`,
      `${question} TypeScript implementation`,
      `${question} performance optimization`,
      `${question} alternatives comparison`,
    ];
  }

  return baseQueries;
}
