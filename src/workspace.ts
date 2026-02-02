/**
 * Gumploop MCP - Workspace Utilities
 *
 * i3 workspace management and session naming utilities.
 */

import { $ } from "bun";
import type { I3Node, I3Workspace } from "./types";
import { safeJsonParse } from "./state";

// ─────────────────────────────────────────────────────────────────────────────
// Target Workspace
// ─────────────────────────────────────────────────────────────────────────────

/** Target workspace for all agents (set before parallel start) */
export let targetWorkspace: number = 7;

export function setTargetWorkspace(ws: number): void {
  targetWorkspace = ws;
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find an empty i3 workspace for spawning agent windows.
 * Prefers workspaces 6-20, then falls back to 1-5.
 */
export async function findEmptyWorkspace(): Promise<number> {
  try {
    const result = await $`i3-msg -t get_workspaces`.quiet().text();
    const workspaces = safeJsonParse<I3Workspace[]>(result);
    if (!workspaces) return 6;

    const treeResult = await $`i3-msg -t get_tree`.quiet().text();
    const tree = safeJsonParse<I3Node>(treeResult);
    if (!tree) return 6;

    const occupiedWorkspaces = new Set<number>();

    function countWindows(node: I3Node, wsNum: number | null): void {
      if (node.type === "workspace" && node.num && node.num > 0) {
        wsNum = node.num;
      }
      if (node.window && wsNum) {
        occupiedWorkspaces.add(wsNum);
      }
      if (node.nodes) {
        for (const child of node.nodes) {
          countWindows(child, wsNum);
        }
      }
      if (node.floating_nodes) {
        for (const child of node.floating_nodes) {
          countWindows(child, wsNum);
        }
      }
    }

    countWindows(tree, null);

    // Prefer 6-20, then 1-5
    const preferred = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 5, 4, 3, 2, 1];
    for (const num of preferred) {
      if (!occupiedWorkspaces.has(num)) {
        return num;
      }
    }

    return 10; // Fallback if all occupied
  } catch {
    return 7;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Naming
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize session names to prevent command injection.
 * Only allows alphanumeric, underscore, and hyphen.
 */
export function sanitizeSessionName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50);
}

/**
 * Generate a short hash from workDir for session isolation.
 * Ensures different projects get unique session names.
 */
export function getWorkDirHash(workDir: string): string {
  let hash = 0;
  for (let i = 0; i < workDir.length; i++) {
    hash = ((hash << 5) - hash) + workDir.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}
