/**
 * Gumploop MCP - Feature Discovery Phase
 * Autonomous feature discovery: agents analyze codebase and propose features.
 */
import { mkdirSync, existsSync, unlinkSync, readFileSync, writeFileSync } from "fs";
import { getProjectDir, getPipelineFiles } from "../workdir";
import { loadState, saveState } from "../state";
import { findEmptyWorkspace, targetWorkspace, setTargetWorkspace } from "../workspace";
import { TmuxAgent } from "../tmux-agent";

/** Execute feature discovery phase with autonomous proposals. */
export async function executeDiscovery(
  maxIterations: number,
  workDir?: string
): Promise<{ success: boolean; result: string }> {
  const projectDir = getProjectDir(workDir);
  const files = getPipelineFiles(projectDir);

  // Ensure directories exist
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(files.gumploopDir, { recursive: true });

  const state = loadState(projectDir);
  state.currentPhase = "discovery";
  state.workDir = projectDir;
  state.iteration = 0;
  state.activeSessions = [];
  state.discoveryComplete = false;
  state.selectedFeature = null;
  saveState(state);

  // Clean old discovery files
  const discoveryFiles = [
    files.discoveryClaudeFile,
    files.discoveryGeminiFile,
    files.discoveryCodexFile,
    files.proposalsFile,
    files.consensusFile,
    `${files.gumploopDir}/consensus-review-gemini.md`,
    `${files.gumploopDir}/consensus-review-codex.md`,
  ];
  for (const f of discoveryFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  if (existsSync(files.progressFile)) unlinkSync(files.progressFile);

  const results: string[] = [];
  results.push(`## Feature Discovery Phase`);
  results.push(`**Working Directory:** ${projectDir}\n`);

  // Start all agents
  const claude = new TmuxAgent("discover-claude", "claude", projectDir);
  const gemini = new TmuxAgent("discover-gemini", "gemini", projectDir);
  const codex = new TmuxAgent("discover-codex", "codex", projectDir);

  try {
    setTargetWorkspace(await findEmptyWorkspace());
    results.push(`Starting agents in parallel on workspace ${targetWorkspace}...`);

    await Promise.all([claude.start(), gemini.start(), codex.start()]);

    state.activeSessions = [
      claude.getSessionName(),
      gemini.getSessionName(),
      codex.getSessionName(),
    ];
    saveState(state);
    results.push("All agents started.\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1: EXPLORE - Parallel codebase analysis
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 1: Codebase Exploration\n");
    state.iteration = 1;
    saveState(state);

    const explorePromptBase = `# Feature Discovery - Codebase Analysis

You are analyzing a codebase to understand it deeply and propose new features.

## Your Task
1. Explore the codebase structure (use ls, find, cat to read files)
2. Understand the architecture, patterns, and tech stack
3. Identify strengths, weaknesses, and gaps
4. Think about what features would add the most value

## Project Directory
${projectDir}

## Analysis Focus`;

    const claudeExplorePrompt = `${explorePromptBase}
- **Architecture & Design Patterns**: How is the code organized? What patterns are used?
- **Code Quality**: Are there areas that need improvement?
- **Missing Abstractions**: What's missing that would make the code better?

Write your analysis to: ${files.discoveryClaudeFile}

Include sections:
1. Architecture Overview
2. Key Components
3. Patterns Used
4. Gaps & Opportunities

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "explore_done", "iteration": 1}`;

    const geminiExplorePrompt = `${explorePromptBase}
- **User/Developer Experience**: How easy is it to use and extend?
- **API Design**: Are the interfaces intuitive?
- **Modern Practices**: What modern features/patterns are missing?

Write your analysis to: ${files.discoveryGeminiFile}

Include sections:
1. UX/DX Assessment
2. API Review
3. Missing Modern Features
4. Quick Wins

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "gemini", "action": "explore_done", "iteration": 1}`;

    const codexExplorePrompt = `${explorePromptBase}
- **Performance**: Any bottlenecks or inefficiencies?
- **Security**: Any vulnerabilities or missing validations?
- **Edge Cases**: What's not handled properly?
- **Testing**: Is the code testable? What's missing?

Write your analysis to: ${files.discoveryCodexFile}

Include sections:
1. Performance Analysis
2. Security Review
3. Edge Cases Not Handled
4. Testing Gaps

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "codex", "action": "explore_done", "iteration": 1}`;

    // Send explore prompts in parallel
    await Promise.all([
      claude.sendMessage(claudeExplorePrompt),
      gemini.sendMessage(geminiExplorePrompt),
      codex.sendMessage(codexExplorePrompt),
    ]);

    // Wait for all to complete
    await Promise.all([
      claude.waitForProgressEvent("claude", "explore_done", 1, files.progressFile),
      gemini.waitForProgressEvent("gemini", "explore_done", 1, files.progressFile),
      codex.waitForProgressEvent("codex", "explore_done", 1, files.progressFile),
    ]);

    results.push("- Claude: Explored (architecture focus)");
    results.push("- Gemini: Explored (UX/DX focus)");
    results.push("- Codex: Explored (technical focus)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: PROPOSE - Each agent proposes features
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 2: Feature Proposals\n");
    state.iteration = 2;
    saveState(state);

    const proposePromptBase = `# Feature Discovery - Propose Features

Based on your codebase analysis, propose 2-3 new features that would add significant value.

## Proposal Format (for each feature)
\`\`\`
### Feature: [Title]

**Description:** [What it does]

**Reasoning:** [Why this feature is needed - reference your analysis]

**Impact:** high | medium | low
**Effort:** high | medium | low

**Affected Files:**
- file1.ts
- file2.ts

**Implementation Outline:**
1. Step 1
2. Step 2
3. Step 3
\`\`\`

## Guidelines
- Focus on features that solve real problems you identified
- Be specific about what the feature does
- Consider the existing architecture
- Think about maintainability`;

    const claudeProposePrompt = `${proposePromptBase}

Read your analysis from ${files.discoveryClaudeFile} and propose features.

APPEND your proposals to: ${files.discoveryClaudeFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "propose_done", "iteration": 2}`;

    const geminiProposePrompt = `${proposePromptBase}

Read your analysis from ${files.discoveryGeminiFile} and propose features.

APPEND your proposals to: ${files.discoveryGeminiFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "gemini", "action": "propose_done", "iteration": 2}`;

    const codexProposePrompt = `${proposePromptBase}

Read your analysis from ${files.discoveryCodexFile} and propose features.

APPEND your proposals to: ${files.discoveryCodexFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "codex", "action": "propose_done", "iteration": 2}`;

    await Promise.all([
      claude.sendMessage(claudeProposePrompt),
      gemini.sendMessage(geminiProposePrompt),
      codex.sendMessage(codexProposePrompt),
    ]);

    await Promise.all([
      claude.waitForProgressEvent("claude", "propose_done", 2, files.progressFile),
      gemini.waitForProgressEvent("gemini", "propose_done", 2, files.progressFile),
      codex.waitForProgressEvent("codex", "propose_done", 2, files.progressFile),
    ]);

    results.push("- Claude: Proposed features");
    results.push("- Gemini: Proposed features");
    results.push("- Codex: Proposed features\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 3: CONSENSUS LOOP - Iterate until agreement
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 3: Consensus Loop\n");

    let consensusReached = false;
    let consensusIteration = 0;
    const maxConsensusIterations = maxIterations;

    while (!consensusReached && consensusIteration < maxConsensusIterations) {
      consensusIteration++;
      state.iteration = 2 + consensusIteration; // 3, 4, 5...
      saveState(state);

      results.push(`#### Consensus Iteration ${consensusIteration}/${maxConsensusIterations}`);

      // Step 1: Claude creates/revises ranking
      let claudeConsensusPrompt: string;

      if (consensusIteration === 1) {
        claudeConsensusPrompt = `# Feature Discovery - Build Consensus

You are the lead architect. Read ALL proposals from all agents and create a prioritized feature list.

## Read These Files
- ${files.discoveryClaudeFile} (Claude's analysis + proposals)
- ${files.discoveryGeminiFile} (Gemini's analysis + proposals)
- ${files.discoveryCodexFile} (Codex's analysis + proposals)

## Your Task
1. List ALL proposed features from all agents
2. Evaluate each based on: Impact, Effort, Alignment with codebase
3. Score each feature: Score = Impact(3/2/1) × (1/Effort(3/2/1))
4. Rank features by score
5. For top 3, add your recommendation

## Output Format (write to ${files.consensusFile})

# Feature Discovery - Consensus Report

## All Proposals Summary

| # | Feature | Proposed By | Impact | Effort | Score |
|---|---------|-------------|--------|--------|-------|
| 1 | ...     | claude      | high   | medium | 2.0   |
| 2 | ...     | gemini      | medium | low    | 2.0   |

## Top 3 Recommendations

### 1. [Feature Name] (Score: X.X)
**Proposed by:** [agent]
**Why recommended:** [your reasoning]
**Quick win potential:** Yes/No

### 2. [Feature Name] (Score: X.X)
...

### 3. [Feature Name] (Score: X.X)
...

## Implementation Order Suggestion
1. Start with: [feature] because [reason]
2. Then: [feature]
3. Finally: [feature]

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "consensus_written", "iteration": ${state.iteration}}`;
      } else {
        claudeConsensusPrompt = `# Feature Discovery - Revise Consensus

Read the review feedback and revise your ranking.

## Review Files
- ${files.gumploopDir}/consensus-review-gemini.md
- ${files.gumploopDir}/consensus-review-codex.md

## Your Task
1. Address ALL concerns raised by reviewers
2. Adjust scores/rankings if their arguments are valid
3. Explain any changes you made
4. Update ${files.consensusFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "consensus_written", "iteration": ${state.iteration}}`;
      }

      await claude.sendMessage(claudeConsensusPrompt);
      await claude.waitForProgressEvent("claude", "consensus_written", state.iteration, files.progressFile);
      results.push("  - Claude: Consensus written");

      // Step 2: Gemini reviews ranking
      const isLastIteration = consensusIteration >= maxConsensusIterations;

      const geminiReviewPrompt = `# Review Consensus Ranking

Read Claude's consensus report: ${files.consensusFile}

Also read all original proposals:
- ${files.discoveryClaudeFile}
- ${files.discoveryGeminiFile}
- ${files.discoveryCodexFile}

## Your Task
Evaluate if the ranking is fair and well-reasoned.

## Review Rules
- This is iteration ${consensusIteration} of ${maxConsensusIterations}
- ${isLastIteration ? "FINAL iteration - approve if major issues resolved" : "Find at least 2 issues with the ranking"}
- Check: Are scores calculated correctly? Is reasoning sound? Any bias?

## Write to ${files.gumploopDir}/consensus-review-gemini.md

### Ranking Review

#### Issues Found
1. [Issue with specific ranking/score]
2. [Another issue]

#### Suggestions
- [Concrete suggestion]

### Status
${isLastIteration ? "APPROVED or NEEDS_REVISION" : "NEEDS_REVISION"}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "gemini", "action": "consensus_reviewed", "iteration": ${state.iteration}}`;

      await gemini.sendMessage(geminiReviewPrompt);
      await gemini.waitForProgressEvent("gemini", "consensus_reviewed", state.iteration, files.progressFile);
      results.push("  - Gemini: Reviewed");

      // Step 3: Codex reviews ranking
      const codexReviewPrompt = `# Review Consensus Ranking (Technical)

Read Claude's consensus report: ${files.consensusFile}

Also read all original proposals:
- ${files.discoveryClaudeFile}
- ${files.discoveryGeminiFile}
- ${files.discoveryCodexFile}

## Your Task
Evaluate the ranking from a technical perspective.

## Review Rules
- This is iteration ${consensusIteration} of ${maxConsensusIterations}
- ${isLastIteration ? "FINAL iteration - approve if technical concerns resolved" : "Find at least 2 technical issues"}
- Check: Effort estimates realistic? Technical dependencies considered? Implementation order makes sense?

## Write to ${files.gumploopDir}/consensus-review-codex.md

### Technical Review

#### Issues Found
1. [Technical issue with ranking/estimates]
2. [Another issue]

#### Suggestions
- [Technical suggestion]

### Status
${isLastIteration ? "APPROVED or NEEDS_REVISION" : "NEEDS_REVISION"}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "codex", "action": "consensus_reviewed", "iteration": ${state.iteration}}`;

      await codex.sendMessage(codexReviewPrompt);
      await codex.waitForProgressEvent("codex", "consensus_reviewed", state.iteration, files.progressFile);
      results.push("  - Codex: Reviewed");

      // Check if both approved
      const geminiReviewPath = `${files.gumploopDir}/consensus-review-gemini.md`;
      const codexReviewPath = `${files.gumploopDir}/consensus-review-codex.md`;

      const geminiReview = existsSync(geminiReviewPath) ? readFileSync(geminiReviewPath, "utf-8") : "";
      const codexReview = existsSync(codexReviewPath) ? readFileSync(codexReviewPath, "utf-8") : "";

      const geminiApproved = geminiReview.includes("APPROVED") && !geminiReview.includes("NEEDS_REVISION");
      const codexApproved = codexReview.includes("APPROVED") && !codexReview.includes("NEEDS_REVISION");

      results.push(`  - Gemini: ${geminiApproved ? "APPROVED ✓" : "NEEDS_REVISION"}`);
      results.push(`  - Codex: ${codexApproved ? "APPROVED ✓" : "NEEDS_REVISION"}`);

      if (geminiApproved && codexApproved) {
        consensusReached = true;
        results.push("\n**Consensus reached!**\n");
      } else {
        results.push("");
      }
    }

    if (!consensusReached) {
      results.push(`\n**Max iterations (${maxConsensusIterations}) reached without full consensus.**\n`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DONE - Read and display results
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Discovery Complete!\n");

    if (existsSync(files.consensusFile)) {
      const consensus = readFileSync(files.consensusFile, "utf-8");
      results.push("## Consensus Report\n");
      results.push(consensus);
    }

    results.push("\n---");
    results.push("**Next Steps:**");
    results.push("1. Review the proposals above");
    results.push("2. Select a feature to implement");
    results.push("3. Run `plan` with the selected feature as task");

    // Stop agents
    await claude.stop();
    await gemini.stop();
    await codex.stop();
    state.activeSessions = [];
    state.currentPhase = null;
    state.discoveryComplete = true;
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
