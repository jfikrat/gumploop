/**
 * Gumploop MCP - State Management
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { STATE_FILE, DEFAULT_PROJECT_DIR } from "./constants";
import { getPipelineDir } from "./workdir";
import type { PipelineState } from "./types";

/** Safely parse JSON string with type assertion. Returns null if parsing fails. */
export function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/** Type guard to validate PipelineState shape. */
export function isValidState(obj: unknown): obj is PipelineState {
  if (!obj || typeof obj !== "object") return false;
  const state = obj as Record<string, unknown>;
  return (
    (state.currentPhase === null || typeof state.currentPhase === "string") &&
    typeof state.task === "string" &&
    typeof state.iteration === "number" &&
    // discoveryComplete is optional for backwards compat
    (state.discoveryComplete === undefined || typeof state.discoveryComplete === "boolean") &&
    (state.selectedFeature === undefined || state.selectedFeature === null || typeof state.selectedFeature === "string") &&
    typeof state.planningComplete === "boolean" &&
    typeof state.codingComplete === "boolean" &&
    typeof state.testingComplete === "boolean" &&
    typeof state.debuggingComplete === "boolean" &&
    Array.isArray(state.activeSessions)
  );
}

/** Create a default PipelineState object. */
export function defaultState(): PipelineState {
  return {
    currentPhase: null,
    task: "",
    workDir: DEFAULT_PROJECT_DIR,
    iteration: 0,
    discoveryComplete: false,
    selectedFeature: null,
    planningComplete: false,
    codingComplete: false,
    testingComplete: false,
    debuggingComplete: false,
    activeSessions: [],
    lastUpdate: new Date().toISOString(),
  };
}

/** Get state file path for a project (or global fallback). */
export function getStateFile(workDir?: string): string {
  if (workDir) {
    return `${getPipelineDir(workDir)}/.state.json`;
  }
  return STATE_FILE;
}

/** Load pipeline state from disk. Tries project-specific state first, then global. */
export function loadState(workDir?: string): PipelineState {
  // Try project-specific state first
  if (workDir) {
    const projectStateFile = getStateFile(workDir);
    if (existsSync(projectStateFile)) {
      try {
        const raw = readFileSync(projectStateFile, "utf-8");
        const state = safeJsonParse<PipelineState>(raw);
        if (state && isValidState(state)) {
          return { ...state, workDir: state.workDir || workDir };
        }
      } catch {
        // Fall through to global state
      }
    }
  }

  // Fallback to global state (backwards compat)
  if (existsSync(STATE_FILE)) {
    try {
      const raw = readFileSync(STATE_FILE, "utf-8");
      const state = safeJsonParse<PipelineState>(raw);
      if (state && isValidState(state)) {
        return { ...state, workDir: state.workDir || DEFAULT_PROJECT_DIR };
      }
      console.error("Invalid state shape, resetting.");
    } catch (err) {
      console.error("State file corrupt, resetting:", err);
    }
  }

  return defaultState();
}

/** Save pipeline state to disk. Also updates global state for cross-phase continuity. */
export function saveState(state: PipelineState): void {
  state.lastUpdate = new Date().toISOString();
  const stateJson = JSON.stringify(state, null, 2);

  // Save to project-specific location
  const stateFile = getStateFile(state.workDir);
  const stateDir = getPipelineDir(state.workDir);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, stateJson);

  // Also save to global state for phases that don't receive workDir parameter
  writeFileSync(STATE_FILE, stateJson);
}
