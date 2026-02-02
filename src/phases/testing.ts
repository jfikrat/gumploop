/**
 * Testing and Debugging phases for Gumploop pipeline
 */

import { existsSync, readFileSync } from "fs";
import { getPipelineFiles } from "../workdir";
import { loadState, saveState } from "../state";
import { TmuxAgent } from "../tmux-agent";

/**
 * Execute testing phase - runs tests and writes results
 */
export async function executeTesting(): Promise<{ success: boolean; result: string }> {
  const state = loadState();

  if (!state.codingComplete) {
    return { success: false, result: "Coding not complete. Run coding phase first." };
  }

  // Use workDir from state
  const projectDir = state.workDir;
  const files = getPipelineFiles(projectDir);

  state.currentPhase = "testing";
  state.activeSessions = [];
  saveState(state);

  const results: string[] = [];
  results.push(`**Working Directory:** ${projectDir}\n`);
  const tester = new TmuxAgent("tester", "claude", projectDir);

  try {
    results.push("Starting tester...");
    await tester.start();
    state.activeSessions.push(tester.getSessionName());
    saveState(state);

    const testerPrompt = `# Instructions
You are testing the code in ${projectDir}

## Steps
1. Read the existing code files in the project
2. Create comprehensive tests in a .test.ts file
3. Run: bun test
4. Write results to: ${files.testResultsFile}

## Required Output Format for ${files.testResultsFile}:
\`\`\`markdown
## Test Results
- Tests run: [number]
- Passed: [number]
- Failed: [number]

## Output
[test output here]

## Status
TESTS_PASS or TESTS_FAIL
\`\`\`

## CRITICAL - COMPLETION SIGNAL
After writing test-results.md, you MUST append this exact JSON line to ${files.progressFile}:
{"agent": "claude", "action": "testing_complete", "iteration": 1}`;

    await tester.sendMessage(testerPrompt);
    await tester.waitForProgressEvent("claude", "testing_complete", 1, files.progressFile);
    results.push("Tester done.");

    await Bun.sleep(3000);
    await tester.stop();
    state.activeSessions = [];

    const testResults = existsSync(files.testResultsFile) ? readFileSync(files.testResultsFile, "utf-8") : "";
    const testsPassed = testResults.includes("TESTS_PASS");

    if (testsPassed) {
      state.testingComplete = true;
      results.push("\n All tests passed!");
    } else {
      results.push("\n Tests failed");
    }

    results.push(`\n${testResults.slice(0, 2000)}`);

    saveState(state);
    return { success: testsPassed, result: results.join("\n") };

  } catch (error) {
    await tester.stop();
    state.activeSessions = [];
    state.currentPhase = null;
    saveState(state);
    throw error;
  }
}

/**
 * Execute debugging phase - analyzes bugs and fixes them
 */
export async function executeDebugging(maxIterations: number): Promise<{ success: boolean; result: string }> {
  const state = loadState();

  if (!state.codingComplete) {
    return { success: false, result: "Coding not complete. Run coding phase first." };
  }

  // Use workDir from state
  const projectDir = state.workDir;
  const files = getPipelineFiles(projectDir);

  state.currentPhase = "debugging";
  state.iteration = 0;
  state.activeSessions = [];
  saveState(state);

  const results: string[] = [];
  results.push(`**Working Directory:** ${projectDir}\n`);
  let fixed = false;

  try {
    while (!fixed && state.iteration < maxIterations) {
      state.iteration++;
      saveState(state);
      results.push(`## Debug Iteration ${state.iteration}/${maxIterations}`);

      // Step 1: Codex analyzes
      results.push("\n**Step 1: Codex analyzing bugs...**");

      const analyzer = new TmuxAgent("analyzer", "codex", projectDir);
      await analyzer.start();
      state.activeSessions = [analyzer.getSessionName()];
      saveState(state);

      const analyzerPrompt = `# Instructions
Read ${files.testResultsFile} to see the failing tests.
Read the code files to understand the bugs.

Write your analysis to ${files.bugAnalysisFile}

Include:
## Bug Analysis
- Root cause of each failure
- Specific lines to fix
- Fix strategy

## Status
ANALYSIS_COMPLETE`;

      await analyzer.sendMessage(analyzerPrompt);
      await analyzer.waitForCompletion();
      await analyzer.stop();
      results.push("  Analysis done");

      // Step 2: Claude fixes
      results.push("\n**Step 2: Claude fixing bugs...**");

      const fixer = new TmuxAgent("fixer", "claude", projectDir);
      await fixer.start();
      state.activeSessions = [fixer.getSessionName()];
      saveState(state);

      const fixerPrompt = `# Instructions
Read ${files.bugAnalysisFile}
Apply the fixes to the code.
Keep changes minimal and focused.

After fixing, say "Bugs fixed."`;

      await fixer.sendMessage(fixerPrompt);
      await fixer.waitForCompletion();
      await fixer.stop();
      results.push("  Fixes applied");

      // Step 3: Re-test
      results.push("\n**Step 3: Re-testing...**");
      const testResult = await executeTesting();
      fixed = testResult.success;

      if (fixed) {
        results.push("  Tests pass!");
      } else {
        results.push("  Tests still failing");
      }
    }

    state.activeSessions = [];
    state.debuggingComplete = fixed;
    results.push(fixed ? "\n **Bugs fixed!**" : "\n **Could not fix all bugs**");

    saveState(state);
    return { success: fixed, result: results.join("\n") };

  } catch (error) {
    state.activeSessions = [];
    state.currentPhase = null;
    saveState(state);
    throw error;
  }
}
