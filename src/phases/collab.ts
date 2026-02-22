/**
 * Gumploop MCP - Collab Phase
 * Parallel independent authorship + cross-review + synthesis.
 *
 * Phase 1: Each agent independently writes its own draft (Promise.all)
 * Phase 2: Each agent cross-reviews the other two drafts (Promise.all)
 * Phase 3: Claude synthesizes all drafts + reviews into a final synthesis
 */
import { mkdirSync, existsSync, unlinkSync, readFileSync } from "fs";
import { getProjectDir, getPipelineFiles } from "../workdir";
import { loadState, saveState } from "../state";
import { findEmptyWorkspace, targetWorkspace, setTargetWorkspace } from "../workspace";
import { TmuxAgent } from "../tmux-agent";

/** Execute parallel independent authorship + cross-review + synthesis. */
export async function executeCollab(
  prompt: string,
  workDir?: string
): Promise<{ success: boolean; result: string }> {
  const projectDir = getProjectDir(workDir);
  const files = getPipelineFiles(projectDir);

  // Ensure directories exist
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(files.gumploopDir, { recursive: true });

  const state = loadState(projectDir);
  state.currentPhase = "collab";
  state.workDir = projectDir;
  state.iteration = 0;
  state.activeSessions = [];
  saveState(state);

  // Clean old collab files
  const collabFiles = [
    files.draftClaudeFile,
    files.draftGeminiFile,
    files.draftCodexFile,
    files.crossreviewClaudeFile,
    files.crossreviewGeminiFile,
    files.crossreviewCodexFile,
    files.synthesisFile,
  ];
  for (const f of collabFiles) {
    if (existsSync(f)) unlinkSync(f);
  }
  if (existsSync(files.progressFile)) unlinkSync(files.progressFile);

  const results: string[] = [];
  results.push(`## Collab Phase`);
  results.push(`**Prompt:** ${prompt}`);
  results.push(`**Working Directory:** ${projectDir}\n`);

  const claude = new TmuxAgent("collab-claude", "claude", projectDir);
  const gemini = new TmuxAgent("collab-gemini", "gemini", projectDir);
  const codex = new TmuxAgent("collab-codex", "codex", projectDir);

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
    // PHASE 1: INDEPENDENT DRAFTS (Parallel)
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 1: Independent Drafts\n");
    state.iteration = 1;
    saveState(state);

    const draftInstructions = `# Task
${prompt}

# Instructions
Write YOUR OWN independent proposal/solution to this task.
Do NOT consider what other agents might write. Think completely independently.
Bring your unique perspective and strengths to this task.`;

    const claudeDraftPrompt = `${draftInstructions}

Write your draft to: ${files.draftClaudeFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "draft_done", "iteration": 1}`;

    const geminiDraftPrompt = `${draftInstructions}

Write your draft to: ${files.draftGeminiFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "gemini", "action": "draft_done", "iteration": 1}`;

    const codexDraftPrompt = `${draftInstructions}

Write your draft to: ${files.draftCodexFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "codex", "action": "draft_done", "iteration": 1}`;

    await Promise.all([
      claude.sendMessage(claudeDraftPrompt),
      gemini.sendMessage(geminiDraftPrompt),
      codex.sendMessage(codexDraftPrompt),
    ]);

    await Promise.all([
      claude.waitForProgressEvent("claude", "draft_done", 1, files.progressFile),
      gemini.waitForProgressEvent("gemini", "draft_done", 1, files.progressFile),
      codex.waitForProgressEvent("codex", "draft_done", 1, files.progressFile),
    ]);

    results.push("- Claude: Draft written");
    results.push("- Gemini: Draft written");
    results.push("- Codex: Draft written\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: CROSS-REVIEW (Parallel — each reads the OTHER TWO drafts)
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 2: Cross-Review\n");
    state.iteration = 2;
    saveState(state);

    const crossReviewInstructions = `# Cross-Review Task
Original prompt that all agents responded to:
> ${prompt}

Read the drafts written by the other two agents below and write a critical cross-review.

Your review should include:
- **Strengths**: What is strong or insightful in each draft?
- **Weaknesses**: What is weak, missing, or flawed?
- **What you'd adopt**: Specific ideas you would incorporate into your own draft
- **Overall verdict**: Which draft (excluding yours) has the strongest approach and why?`;

    const claudeCrossReviewPrompt = `${crossReviewInstructions}

## Drafts to Review
- Gemini's draft: ${files.draftGeminiFile}
- Codex's draft: ${files.draftCodexFile}

Write your cross-review to: ${files.crossreviewClaudeFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "crossreview_done", "iteration": 2}`;

    const geminiCrossReviewPrompt = `${crossReviewInstructions}

## Drafts to Review
- Claude's draft: ${files.draftClaudeFile}
- Codex's draft: ${files.draftCodexFile}

Write your cross-review to: ${files.crossreviewGeminiFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "gemini", "action": "crossreview_done", "iteration": 2}`;

    const codexCrossReviewPrompt = `${crossReviewInstructions}

## Drafts to Review
- Claude's draft: ${files.draftClaudeFile}
- Gemini's draft: ${files.draftGeminiFile}

Write your cross-review to: ${files.crossreviewCodexFile}

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "codex", "action": "crossreview_done", "iteration": 2}`;

    await Promise.all([
      claude.sendMessage(claudeCrossReviewPrompt),
      gemini.sendMessage(geminiCrossReviewPrompt),
      codex.sendMessage(codexCrossReviewPrompt),
    ]);

    await Promise.all([
      claude.waitForProgressEvent("claude", "crossreview_done", 2, files.progressFile),
      gemini.waitForProgressEvent("gemini", "crossreview_done", 2, files.progressFile),
      codex.waitForProgressEvent("codex", "crossreview_done", 2, files.progressFile),
    ]);

    results.push("- Claude: Cross-review written (reviewed Gemini + Codex)");
    results.push("- Gemini: Cross-review written (reviewed Claude + Codex)");
    results.push("- Codex: Cross-review written (reviewed Claude + Gemini)\n");

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 3: SYNTHESIS (Claude only)
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Phase 3: Synthesis\n");
    state.iteration = 3;
    saveState(state);

    const synthPrompt = `# Synthesis Task
Original prompt:
> ${prompt}

You have access to 3 independent drafts and 3 cross-reviews from all agents.

## Read These Files
- Claude's draft: ${files.draftClaudeFile}
- Gemini's draft: ${files.draftGeminiFile}
- Codex's draft: ${files.draftCodexFile}
- Claude's cross-review (reviewed Gemini + Codex): ${files.crossreviewClaudeFile}
- Gemini's cross-review (reviewed Claude + Codex): ${files.crossreviewGeminiFile}
- Codex's cross-review (reviewed Claude + Gemini): ${files.crossreviewCodexFile}

## Your Task
Synthesize all of the above into a final, unified response that:
1. Takes the best ideas from each draft
2. Addresses the weaknesses identified in cross-reviews
3. Resolves any conflicts or disagreements between drafts
4. Produces a better result than any single draft alone

## Output Format
Write a comprehensive synthesis to: ${files.synthesisFile}

Include:
- **Executive Summary**: The unified answer in 2-3 sentences
- **Key Insights** (from across all drafts)
- **Synthesized Solution/Proposal** (the main content)
- **Points of Agreement** between agents
- **Resolved Disagreements** (how you resolved conflicts)
- **What was discarded and why**

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "synthesis_done", "iteration": 3}`;

    await claude.sendMessage(synthPrompt);
    await claude.waitForProgressEvent("claude", "synthesis_done", 3, files.progressFile);
    results.push("- Claude: Synthesis written\n");

    // ─────────────────────────────────────────────────────────────────────────
    // DONE
    // ─────────────────────────────────────────────────────────────────────────
    results.push("### Collab Complete!\n");

    if (existsSync(files.synthesisFile)) {
      const synthesis = readFileSync(files.synthesisFile, "utf-8");
      results.push("## Synthesis\n");
      results.push(synthesis);
    }

    results.push("\n---");
    results.push("**Artifacts:**");
    results.push(`- Drafts: draft-claude.md, draft-gemini.md, draft-codex.md`);
    results.push(`- Cross-reviews: crossreview-claude.md, crossreview-gemini.md, crossreview-codex.md`);
    results.push(`- Synthesis: synthesis.md`);

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
