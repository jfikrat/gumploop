/**
 * Gumploop MCP - Working Directory Helpers
 */

import { existsSync, mkdirSync } from "fs";
import { resolve, isAbsolute, sep, join } from "path";
import { FORBIDDEN_PATHS, DEFAULT_PROJECT_DIR } from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export function validateWorkDir(workDir: string): {
  valid: boolean;
  error?: string;
  resolved?: string;
} {
  // Path traversal check BEFORE resolve
  if (workDir.split(sep).includes("..")) {
    return { valid: false, error: "Path traversal detected" };
  }

  // Resolve to absolute path
  const resolved = resolve(workDir);

  // Must be absolute
  if (!isAbsolute(resolved)) {
    return { valid: false, error: "Path must be absolute" };
  }

  // Must exist and be a directory
  if (!existsSync(resolved)) {
    return { valid: false, error: `Directory does not exist: ${resolved}` };
  }

  // Check forbidden paths
  for (const forbidden of FORBIDDEN_PATHS) {
    if (resolved === forbidden) {
      return { valid: false, error: `Cannot use system directory: ${forbidden}` };
    }
  }

  return { valid: true, resolved };
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getProjectDir(workDir?: string): string {
  if (workDir) {
    // Create directory if it doesn't exist (before validation)
    const resolved = resolve(workDir);
    if (!existsSync(resolved)) {
      try {
        mkdirSync(resolved, { recursive: true });
        console.error(`Created workDir: ${resolved}`);
      } catch (err) {
        console.error(`Failed to create workDir "${resolved}": ${err}`);
      }
    }

    const validation = validateWorkDir(workDir);
    if (validation.valid && validation.resolved) {
      return validation.resolved;
    }
    // If invalid, log warning and use default
    console.error(`Invalid workDir "${workDir}": ${validation.error}. Using default.`);
  }
  return DEFAULT_PROJECT_DIR;
}

export function getPipelineDir(projectDir: string): string {
  return join(projectDir, ".gumploop");
}

export function getPipelineFiles(projectDir: string) {
  const pipelineDir = getPipelineDir(projectDir);
  return {
    pipelineDir,
    gumploopDir: pipelineDir, // Alias for compatibility
    stateFile: join(pipelineDir, ".state.json"),
    planFile: join(pipelineDir, "plan.md"),
    reviewGeminiFile: join(pipelineDir, "review-gemini.md"),
    reviewCodexFile: join(pipelineDir, "review-codex.md"),
    codeReviewFile: join(pipelineDir, "code-review.md"),
    testResultsFile: join(pipelineDir, "test-results.md"),
    bugAnalysisFile: join(pipelineDir, "bug-analysis.md"),
    progressFile: join(pipelineDir, "progress.jsonl"),
  };
}
