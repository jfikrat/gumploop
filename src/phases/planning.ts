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
  workDir?: string
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
        claudePrompt = `# Task
${task}

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

      const geminiPrompt = `# Instructions
First, verify ${files.planFile} exists. If not, wait and check again.

Read the plan in ${files.planFile}

Write your review to ${files.reviewGeminiFile}

## CRITICAL REVIEW RULES
- This is iteration ${state.iteration} of ${maxIterations}
- You are a STRICT reviewer. Your job is to find problems, not to approve quickly.
- ${isLastIteration ? "This is the FINAL iteration. You may approve if all major issues are resolved." : "This is NOT the final iteration. You MUST find issues and request revision."}
- Find AT LEAST 3 specific issues or improvements
- Be harsh and thorough - lazy reviews waste everyone's time
- Check: API design, error handling, edge cases, documentation, testability

## Review Format
Write to ${files.reviewGeminiFile}:

## UX/UI Review

### Issues Found (minimum 3)
1. [Specific issue with exact problem]
2. [Another specific issue]
3. [Another specific issue]

### Suggestions
- [Concrete improvement suggestion]

## Status
${isLastIteration ? "APPROVED (only if all major issues resolved) or NEEDS_REVISION" : "NEEDS_REVISION (you MUST request revision in early iterations)"}

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

      const codexPrompt = `# Instructions
First, verify ${files.planFile} exists. If not, wait and check again.

Read the plan in ${files.planFile}

Write your review to ${files.reviewCodexFile}

## CRITICAL REVIEW RULES
- This is iteration ${state.iteration} of ${maxIterations}
- You are a STRICT technical reviewer. Find real problems.
- ${isLastIteration ? "This is the FINAL iteration. You may approve if all technical issues are resolved." : "This is NOT the final iteration. You MUST find technical issues and request revision."}
- Find AT LEAST 3 specific technical issues
- Be thorough - check EVERY edge case, error path, and potential bug
- Think about: memory leaks, race conditions, type safety, error propagation, testability

## Review Format
Write to ${files.reviewCodexFile}:

## Technical Review

### Critical Issues (minimum 3)
1. [Specific technical issue with code reference]
2. [Another technical issue]
3. [Another technical issue]

### Security/Performance Concerns
- [Any security or performance issues]

### Missing Edge Cases
- [Edge cases not handled]

## Status
${isLastIteration ? "APPROVED (only if all technical issues resolved) or NEEDS_REVISION" : "NEEDS_REVISION (you MUST find issues in early iterations)"}

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
      results.push(`- Gemini: ${geminiApproved ? "APPROVED" : "NEEDS_REVISION"}`);
      results.push(`- Codex: ${codexApproved ? "APPROVED" : "NEEDS_REVISION"}`);

      if (geminiApproved && codexApproved) {
        consensusReached = true;
        results.push("\n**Consensus reached!**");
      } else {
        results.push("\nContinuing to next iteration...");
      }
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

    // Always mark planning as complete after max iterations
    // This allows the user to continue to coding phase even without consensus
    state.planningComplete = true;

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
