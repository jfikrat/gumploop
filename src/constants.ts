/**
 * Gumploop MCP - Constants
 */

import { homedir, tmpdir } from "os";
import { join } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

export const HOME = homedir();
export const DEFAULT_BASE_DIR = "/tmp/collab-mcp";
export const DEFAULT_PROJECT_DIR = join(DEFAULT_BASE_DIR, "project");
export const STATE_FILE = join(DEFAULT_BASE_DIR, ".state.json");

// Agent session directories
export const CODEX_SESSIONS_DIR = join(HOME, ".codex", "sessions");
export const GEMINI_SESSIONS_DIR = join(HOME, ".gemini", "tmp");
export const CLAUDE_PROJECTS_DIR = join(HOME, ".claude", "projects");

// ─────────────────────────────────────────────────────────────────────────────
// Terminal & Timeout Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const TERMINAL = process.env.PIPELINE_TERMINAL || "xterm";

// Adaptive timeout strategy
export const TIMEOUT_BASE = 30 * 60 * 1000;         // 30 minutes base timeout
export const TIMEOUT_EXTENSION = 15 * 60 * 1000;    // 15 minutes extension if active
export const ACTIVITY_CHECK_INTERVAL = 2000;         // Check every 2 seconds
export const ACTIVITY_THRESHOLD = 60 * 1000;         // Active if output changed in last 60s

// ─────────────────────────────────────────────────────────────────────────────
// Security
// ─────────────────────────────────────────────────────────────────────────────

export const FORBIDDEN_PATHS = [
  "/",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/root",
  "/boot",
  "/sys",
  "/proc",
];

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function generateRequestId(): string {
  return `RQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// Re-export tmpdir for convenience
export { tmpdir };
