/**
 * Coding phase for Gumploop pipeline
 */

import { existsSync, readFileSync } from "fs";
import { getPipelineFiles } from "../workdir";
import { loadState, saveState } from "../state";
import { TmuxAgent } from "../tmux-agent";

/**
 * Execute coding phase - implements code based on approved plan
 */
export async function executeCoding(maxIterations: number): Promise<{ success: boolean; result: string }> {
  const state = loadState();

  if (!state.planningComplete) {
    return { success: false, result: "Planning not complete. Run planning phase first." };
  }

  // Use workDir from state (set during planning)
  const projectDir = state.workDir;
  const files = getPipelineFiles(projectDir);

  state.currentPhase = "coding";
  state.iteration = 0;
  state.activeSessions = [];
  saveState(state);

  const results: string[] = [];
  results.push(`**Working Directory:** ${projectDir}\n`);
  let codeApproved = false;

  const coder = new TmuxAgent("coder", "claude", projectDir);
  const reviewer = new TmuxAgent("reviewer", "codex", projectDir);

  try {
    results.push("Starting coding agents...");

    await coder.start();
    state.activeSessions.push(coder.getSessionName());
    saveState(state);

    await reviewer.start();
    state.activeSessions.push(reviewer.getSessionName());
    saveState(state);

    results.push("Agents started.\n");

    while (!codeApproved && state.iteration < maxIterations) {
      state.iteration++;
      saveState(state);
      results.push(`## Iteration ${state.iteration}/${maxIterations}`);

      // Step 1: Coder implements
      results.push("\n**Step 1: Coder implementing...**");

      let coderPrompt: string;
      if (state.iteration === 1) {
        coderPrompt = `# Instructions
Read the approved plan in .gumploop/plan.md
Implement the code according to the plan.

Write clean TypeScript code.
After implementing, say "Code implemented."`;
      } else {
        coderPrompt = `# Instructions
Read the code review in .gumploop/code-review.md
Fix the issues mentioned and improve the code.

After fixing, say "Code revised."`;
      }

      await coder.sendMessage(coderPrompt);
      await coder.waitForCompletion();
      results.push("  ✓ Coder done");

      // Step 2: Reviewer reviews code
      results.push("\n**Step 2: Reviewer reviewing...**");

      const reviewerPrompt = `# Instructions
Review all TypeScript files in the project.
Write your review to .gumploop/code-review.md

Include:
## Code Review
- Bugs found
- Missing error handling
- Code quality issues

## Status
CODE_APPROVED (if code is good) or NEEDS_REVISION (with specific issues)`;

      await reviewer.sendMessage(reviewerPrompt);
      await reviewer.waitForCompletion();
      await Bun.sleep(2000);
      results.push("  ✓ Reviewer done");

      // Check if approved
      const codeReview = existsSync(files.codeReviewFile) ? readFileSync(files.codeReviewFile, "utf-8") : "";
      codeApproved = codeReview.includes("CODE_APPROVED") && !codeReview.includes("NEEDS_REVISION");

      results.push(`\n**Result:** ${codeApproved ? "✓ CODE_APPROVED" : "✗ NEEDS_REVISION"}`);

      if (!codeApproved) {
        results.push("⏳ Continuing to next iteration...");
      }
    }

    await coder.stop();
    await reviewer.stop();
    state.activeSessions = [];

    // ISSUE-005 Fix (coding): Always mark complete after max iterations
    state.codingComplete = true;

    if (codeApproved) {
      results.push("\n✅ **Code approved!**");
    } else {
      results.push("\n❌ **Max iterations reached without approval**");
    }

    saveState(state);
    return { success: codeApproved, result: results.join("\n") };

  } catch (error) {
    await coder.stop();
    await reviewer.stop();
    state.activeSessions = [];
    state.currentPhase = null;
    saveState(state);
    throw error;
  }
}
