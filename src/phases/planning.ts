/**
 * Gumploop MCP - Planning Phase
 * Consensus-based planning with Claude, Gemini, and Codex.
 */
import { mkdirSync, existsSync, unlinkSync, readFileSync } from "fs";
import { getProjectDir, getPipelineFiles } from "../workdir";
import { loadState, saveState } from "../state";
import { findEmptyWorkspace, targetWorkspace, setTargetWorkspace } from "../workspace";
import { TmuxAgent } from "../tmux-agent";

/** Execute planning phase with consensus-based review loop. */
export async function executePlanning(
  task: string,
  maxIterations: number,
  workDir?: string,
  context?: string
): Promise<{ success: boolean; result: string }> {
  // Resolve project directory
  const projectDir = getProjectDir(workDir);
  const files = getPipelineFiles(projectDir);

  // Ensure directories exist
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(files.gumploopDir, { recursive: true });

  const state = loadState(projectDir);
  state.currentPhase = "planning";
  state.task = task;
  state.workDir = projectDir;
  state.iteration = 0;
  state.activeSessions = [];
  saveState(state);

  // Clean old pipeline files
  if (existsSync(files.planFile)) unlinkSync(files.planFile);
  if (existsSync(files.reviewGeminiFile)) unlinkSync(files.reviewGeminiFile);
  if (existsSync(files.reviewCodexFile)) unlinkSync(files.reviewCodexFile);
  if (existsSync(files.progressFile)) unlinkSync(files.progressFile);

  const results: string[] = [];
  results.push(`**Working Directory:** ${projectDir}\n`);

  // Auto-detect synthesis context if not explicitly provided
  let planContext = context;
  if (!planContext && existsSync(files.synthesisFile)) {
    planContext = readFileSync(files.synthesisFile, "utf-8");
    results.push("*Context: auto-loaded from synthesis.md*\n");
  }

  let consensusReached = false;

  // Start all agents
  const claude = new TmuxAgent("planner-claude", "claude", projectDir);
  const gemini = new TmuxAgent("planner-gemini", "gemini", projectDir);
  const codex = new TmuxAgent("planner-codex", "codex", projectDir);

  try {
    // Find empty workspace for agents
    setTargetWorkspace(await findEmptyWorkspace());
    results.push(`Starting agents in parallel on workspace ${targetWorkspace}...`);

    // Start all agents in parallel
    await Promise.all([claude.start(), gemini.start(), codex.start()]);

    state.activeSessions = [
      claude.getSessionName(),
      gemini.getSessionName(),
      codex.getSessionName(),
    ];
    saveState(state);

    results.push("All agents started.\n");

    let prevGeminiReview = "";
    let prevCodexReview = "";

    while (!consensusReached && state.iteration < maxIterations) {
      state.iteration++;
      saveState(state);
      results.push(`## Iteration ${state.iteration}/${maxIterations}`);

      // Step 1: Claude writes/revises plan
      results.push("\n**Step 1: Claude writing plan...**");

      // Delete old review files for this iteration
      if (existsSync(files.reviewGeminiFile)) unlinkSync(files.reviewGeminiFile);
      if (existsSync(files.reviewCodexFile)) unlinkSync(files.reviewCodexFile);

      let claudePrompt: string;
      if (state.iteration === 1) {
        const contextSection = planContext
          ? `\n\n# Prior Research / Context\nUse the following as background for your plan:\n\n${planContext}`
          : "";
        claudePrompt = `# Task
${task}${contextSection}

# Iteration Info
This is iteration ${state.iteration} of ${maxIterations}.

# Instructions
Write a detailed implementation plan for this task.
Save your plan to: ${files.planFile}

The plan should include:
- Architecture overview
- File structure
- Implementation steps
- Edge cases to handle
- Error handling strategy

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "plan_written", "iteration": ${state.iteration}}`;
      } else {
        claudePrompt = `# Task
${task}

# Iteration Info
This is iteration ${state.iteration} of ${maxIterations}.

# Instructions
Read the reviews in:
- ${files.reviewGeminiFile}
- ${files.reviewCodexFile}

Address ALL the issues raised by reviewers.
Revise your plan in ${files.planFile} based on the feedback.

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "plan_written", "iteration": ${state.iteration}}`;
      }

      await claude.sendMessage(claudePrompt);

      // Wait for Claude to signal completion via progress.jsonl
      await claude.waitForProgressEvent("claude", "plan_written", state.iteration, files.progressFile);

      // Verify plan.md exists
      if (!existsSync(files.planFile) || readFileSync(files.planFile, "utf-8").trim().length < 100) {
        results.push("  Warning: Plan file not created or too short!");
        continue; // Skip to next iteration
      }
      results.push("  Done: Claude (plan.md created)");

      // Step 2: Gemini reviews plan
      results.push("\n**Step 2: Gemini reviewing...**");

      const isLastIteration = state.iteration >= maxIterations;

      const deltaGeminiSection = state.iteration > 1 && prevGeminiReview
        ? `\n## Your Previous Review (Iteration ${state.iteration - 1})\nThese were your concerns last time — check if they have been addressed:\n\`\`\`\n${prevGeminiReview.slice(0, 2000)}\n\`\`\`\nFocus on delta: is this version better? Are your old issues resolved?\n`
        : "";

      const geminiPrompt = `# Instructions
Read the plan in ${files.planFile}

Write your review to ${files.reviewGeminiFile}
${deltaGeminiSection}
## Review Rules
- This is iteration ${state.iteration} of ${maxIterations}
- Be honest: if significant issues remain, describe them specifically. If the plan is solid, say so.
- Do NOT invent issues. Only flag real problems.
- Check: UX/DX, API design, error handling, edge cases, documentation, testability

## Review Format
Write to ${files.reviewGeminiFile}:

## UX/DX Review

### Issues Found
[List real issues with specifics, or write "No significant issues found" if the plan is solid]

### Suggestions
- [Concrete improvement, if any]

## Status
APPROVED — if the plan adequately addresses the task and your concerns are resolved
NEEDS_REVISION — if there are specific issues that must be fixed (explain what and why)

## CRITICAL - COMPLETION SIGNAL
After writing review, you MUST append this exact JSON line to ${files.progressFile}:
{"agent": "gemini", "action": "review_written", "iteration": ${state.iteration}}

End your response with END`;

      await gemini.sendMessage(geminiPrompt);
      // Wait for Gemini to signal completion via progress.jsonl
      await gemini.waitForProgressEvent("gemini", "review_written", state.iteration, files.progressFile);
      results.push("  Done: Gemini");

      // Step 3: Codex reviews plan
      results.push("\n**Step 3: Codex reviewing...**");

      const deltaCodexSection = state.iteration > 1 && prevCodexReview
        ? `\n## Your Previous Review (Iteration ${state.iteration - 1})\nThese were your technical concerns last time — check if they have been addressed:\n\`\`\`\n${prevCodexReview.slice(0, 2000)}\n\`\`\`\nFocus on delta: is this version technically better? Are your old issues resolved?\n`
        : "";

      const codexPrompt = `# Instructions
Read the plan in ${files.planFile}

Write your review to ${files.reviewCodexFile}
${deltaCodexSection}
## Review Rules
- This is iteration ${state.iteration} of ${maxIterations}
- Be honest: only flag real technical problems, not hypothetical ones.
- Think about: memory leaks, race conditions, type safety, error propagation, testability, security

## Review Format
Write to ${files.reviewCodexFile}:

## Technical Review

### Critical Issues
[List real technical issues with specifics, or write "No critical issues found" if the plan is solid]

### Security/Performance Concerns
- [Any security or performance issues, if any]

### Missing Edge Cases
- [Edge cases not handled, if any]

## Status
APPROVED — if the plan is technically sound and your concerns are resolved
NEEDS_REVISION — if there are specific technical issues that must be fixed (explain what and why)

## CRITICAL - COMPLETION SIGNAL
After writing review, you MUST append this exact JSON line to ${files.progressFile}:
{"agent": "codex", "action": "review_written", "iteration": ${state.iteration}}`;

      await codex.sendMessage(codexPrompt);
      // Wait for Codex to signal completion via progress.jsonl
      await codex.waitForProgressEvent("codex", "review_written", state.iteration, files.progressFile);
      results.push("  Done: Codex");

      // Check if both approved
      const geminiReview = existsSync(files.reviewGeminiFile)
        ? readFileSync(files.reviewGeminiFile, "utf-8")
        : "";
      const codexReview = existsSync(files.reviewCodexFile)
        ? readFileSync(files.reviewCodexFile, "utf-8")
        : "";

      const geminiApproved = geminiReview.includes("APPROVED") && !geminiReview.includes("NEEDS_REVISION");
      const codexApproved = codexReview.includes("APPROVED") && !codexReview.includes("NEEDS_REVISION");

      results.push(`\n**Results:**`);
      results.push(`- Gemini: ${geminiApproved ? "APPROVED ✓" : "NEEDS_REVISION"}`);
      results.push(`- Codex: ${codexApproved ? "APPROVED ✓" : "NEEDS_REVISION"}`);

      if (geminiApproved && codexApproved) {
        consensusReached = true;
        results.push("\n**Consensus reached! (Both approved)**");
      } else if (state.iteration >= maxIterations - 1 && (geminiApproved || codexApproved)) {
        // Progressive threshold: from second-to-last iteration onwards, 1/2 is enough
        consensusReached = true;
        const approver = geminiApproved ? "Gemini" : "Codex";
        results.push(`\n**Progressive consensus: ${approver} approved (1/2 sufficient from iteration ${state.iteration}/${maxIterations})**`);
      } else if (isLastIteration) {
        // Final iteration: auto-accept regardless — remaining issues logged above
        consensusReached = true;
        results.push("\n**Auto-accepted on final iteration** (see reviewer files for remaining notes)");
      } else {
        results.push("\nContinuing to next iteration...");
      }

      prevGeminiReview = geminiReview;
      prevCodexReview = codexReview;
    }

    // If no consensus, have Claude read and summarize remaining issues
    if (!consensusReached) {
      results.push("\n**Final Step: Claude reading remaining issues...**");

      const finalClaudePrompt = `# Final Review Summary

Max iterations reached without full consensus.

Read the final reviews:
- ${files.reviewGeminiFile}
- ${files.reviewCodexFile}

Write a summary of remaining issues to ${files.gumploopDir}/remaining-issues.md

Include:
1. Issues that were addressed
2. Issues that still remain
3. Recommended next steps

# IMPORTANT: When done, append this line to ${files.progressFile}:
{"agent": "claude", "action": "summary_written", "iteration": ${state.iteration}}`;

      await claude.sendMessage(finalClaudePrompt);
      await claude.waitForProgressEvent("claude", "summary_written", state.iteration, files.progressFile);
      results.push("  Done: Claude summarized remaining issues");
      results.push("\n**Max iterations reached without consensus**");
      results.push(`\nSee: ${files.gumploopDir}/remaining-issues.md`);
    }

    // Stop agents
    await claude.stop();
    await gemini.stop();
    await codex.stop();
    state.activeSessions = [];

    state.planningComplete = consensusReached;

    saveState(state);
    return { success: consensusReached, result: results.join("\n") };
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
