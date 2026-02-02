/**
 * Completion detection functions for CLI agents
 *
 * These functions check session files and pane content to detect
 * when an agent has completed its response.
 */

import { existsSync } from "fs";
import { readdir, stat, readFile } from "fs/promises";
import { join } from "path";

import {
  TIMEOUT_BASE,
  TIMEOUT_EXTENSION,
  ACTIVITY_CHECK_INTERVAL,
  ACTIVITY_THRESHOLD,
  CLAUDE_PROJECTS_DIR,
  CODEX_SESSIONS_DIR,
  GEMINI_SESSIONS_DIR,
} from "./constants";
import { safeJsonParse } from "./state";

/**
 * Callback type for capturing tmux pane content
 */
export type CapturePaneCallback = (lines?: number) => Promise<string>;

/**
 * Find the latest Codex session file
 */
export async function findLatestCodexSession(messageStartTime: number): Promise<string | null> {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");

  const dayDir = join(CODEX_SESSIONS_DIR, year, month, day);
  if (!existsSync(dayDir)) return null;

  try {
    const files = await readdir(dayDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl")).map(f => join(dayDir, f));

    const withStats = await Promise.all(
      jsonlFiles.map(async f => {
        try {
          const s = await stat(f);
          return { path: f, mtime: s.mtimeMs };
        } catch { return null; }
      })
    );

    const valid = withStats.filter((x): x is { path: string; mtime: number } => x !== null);
    valid.sort((a, b) => b.mtime - a.mtime);

    for (const { path, mtime } of valid) {
      if (mtime >= messageStartTime) {
        return path;
      }
    }
    return valid[0]?.path || null;
  } catch { return null; }
}

/**
 * Check if Codex has completed by examining session file
 */
export async function checkCodexCompletion(
  sessionFile: string,
  messageStartTime: number,
  currentRequestId: string
): Promise<boolean> {
  try {
    const content = await readFile(sessionFile, "utf-8");
    const lines = content.trim().split("\n");

    // Check from end for faster detection
    interface CodexEvent {
      timestamp: string;
      type: string;
      payload?: { type: string; message?: string };
    }
    for (const line of lines.reverse()) {
      const event = safeJsonParse<CodexEvent>(line);
      if (!event) continue;

      const ts = new Date(event.timestamp).getTime();
      if (ts < messageStartTime) continue;

      // ONLY check for ANS marker - no fallbacks
      if (event.type === "event_msg" && event.payload?.type === "agent_message") {
        const msg = event.payload.message || "";
        const ansId = currentRequestId.replace("RQ-", "ANS-");
        if (msg.includes(`[${ansId}]`)) return true;
      }
    }
  } catch {}
  return false;
}

/**
 * Wait for Codex to complete using session file (adaptive timeout)
 */
export async function waitForCodexCompletion(
  capturePane: CapturePaneCallback,
  messageStartTime: number,
  currentRequestId: string
): Promise<void> {
  let deadline = Date.now() + TIMEOUT_BASE;
  let lastPaneContent = "";
  let lastActivityTime = Date.now();

  while (Date.now() < deadline) {
    await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

    const sessionFile = await findLatestCodexSession(messageStartTime);
    if (sessionFile) {
      const completed = await checkCodexCompletion(sessionFile, messageStartTime, currentRequestId);
      if (completed) {
        return;
      }
    }

    // Check if agent is still active
    try {
      const currentPane = await capturePane(100);
      if (currentPane !== lastPaneContent) {
        lastPaneContent = currentPane;
        lastActivityTime = Date.now();
      }

      const timeToDeadline = deadline - Date.now();
      const timeSinceActivity = Date.now() - lastActivityTime;

      if (timeToDeadline < TIMEOUT_EXTENSION && timeSinceActivity < ACTIVITY_THRESHOLD) {
        deadline = Date.now() + TIMEOUT_EXTENSION;
        console.error(`[codex] Still active, extending timeout by 15 minutes`);
      }
    } catch {}
  }

  throw new Error(`Timeout waiting for Codex completion`);
}

/**
 * Check Gemini session file for completion
 */
export async function checkGeminiSessionFile(
  messageStartTime: number,
  currentRequestId: string
): Promise<boolean> {
  try {
    const projectDirs = await readdir(GEMINI_SESSIONS_DIR);

    for (const projectHash of projectDirs) {
      const chatsDir = join(GEMINI_SESSIONS_DIR, projectHash, "chats");
      if (!existsSync(chatsDir)) continue;

      const files = await readdir(chatsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(chatsDir, file);
        const stats = await stat(filePath);

        // Only check recently modified files
        if (stats.mtimeMs < messageStartTime) continue;

        interface GeminiChat {
          messages?: Array<{ type: string; content?: string }>;
        }
        const data = safeJsonParse<GeminiChat>(await readFile(filePath, "utf-8"));
        if (!data) continue;
        const messages = data.messages || [];

        // Find gemini message with ANS marker - no fallbacks
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.type === "gemini") {
            const content = msg.content || "";

            // ONLY check for ANS marker (request ID based)
            const ansId = currentRequestId.replace("RQ-", "ANS-");
            if (content.includes(`[${ansId}]`)) return true;
          }
        }
      }
    }
  } catch {}
  return false;
}

/**
 * Wait for Gemini to complete using session file (adaptive timeout)
 */
export async function waitForGeminiCompletion(
  capturePane: CapturePaneCallback,
  messageStartTime: number,
  currentRequestId: string
): Promise<void> {
  let deadline = Date.now() + TIMEOUT_BASE;
  let lastPaneContent = "";
  let lastActivityTime = Date.now();

  while (Date.now() < deadline) {
    await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

    const completed = await checkGeminiSessionFile(messageStartTime, currentRequestId);
    if (completed) {
      return;
    }

    // Check if agent is still active
    try {
      const currentPane = await capturePane(100);
      if (currentPane !== lastPaneContent) {
        lastPaneContent = currentPane;
        lastActivityTime = Date.now();
      }

      const timeToDeadline = deadline - Date.now();
      const timeSinceActivity = Date.now() - lastActivityTime;

      if (timeToDeadline < TIMEOUT_EXTENSION && timeSinceActivity < ACTIVITY_THRESHOLD) {
        deadline = Date.now() + TIMEOUT_EXTENSION;
        console.error(`[gemini] Still active, extending timeout by 15 minutes`);
      }
    } catch {}
  }

  throw new Error(`Timeout waiting for Gemini completion`);
}

/**
 * Check Claude session file for ANS marker
 */
export async function checkClaudeSessionFile(
  projectDir: string,
  messageStartTime: number,
  currentRequestId: string
): Promise<boolean> {
  try {
    // Claude projects dir: ~/.claude/projects/{project-hash}/*.jsonl
    // Project hash is derived from working directory
    const projectHash = projectDir.replace(/\//g, "-").replace(/^-/, "");
    const projectSessionDir = join(CLAUDE_PROJECTS_DIR, projectHash);

    if (!existsSync(projectSessionDir)) return false;

    const files = await readdir(projectSessionDir);
    const jsonlFiles = files.filter(f => f.endsWith(".jsonl")).map(f => join(projectSessionDir, f));

    // Find most recently modified file
    const withStats = await Promise.all(
      jsonlFiles.map(async f => {
        try {
          const s = await stat(f);
          return { path: f, mtime: s.mtimeMs };
        } catch { return null; }
      })
    );

    const valid = withStats.filter((x): x is { path: string; mtime: number } => x !== null);
    valid.sort((a, b) => b.mtime - a.mtime);

    // Check the most recent file
    for (const { path, mtime } of valid) {
      if (mtime < messageStartTime) continue;

      const content = await readFile(path, "utf-8");
      const lines = content.trim().split("\n");

      // Check from end for faster detection
      interface ClaudeEvent {
        type: string;
        message?: { content?: Array<{ type: string; text?: string }> };
      }
      for (const line of lines.reverse()) {
        const event = safeJsonParse<ClaudeEvent>(line);
        if (!event) continue;

        // Look for assistant message with ANS marker
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && block.text) {
              const ansId = currentRequestId.replace("RQ-", "ANS-");
              if (block.text.includes(`[${ansId}]`)) return true;
            }
          }
        }
      }
    }
  } catch {}
  return false;
}

/**
 * Wait for Claude to complete using session file + pane fallback (adaptive timeout)
 */
export async function waitForClaudeCompletion(
  capturePane: CapturePaneCallback,
  projectDir: string,
  messageStartTime: number,
  currentRequestId: string
): Promise<void> {
  let deadline = Date.now() + TIMEOUT_BASE;
  let lastPaneContent = "";
  let lastActivityTime = Date.now();

  while (Date.now() < deadline) {
    await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

    try {
      // Primary: Check session file for ANS marker
      const sessionComplete = await checkClaudeSessionFile(projectDir, messageStartTime, currentRequestId);
      if (sessionComplete) {
        return;
      }

      // Fallback: Check pane for "Worked for" (legacy detection)
      const pane = await capturePane(50);
      const lastLines = pane.split("\n").slice(-20).join("\n");

      if (lastLines.includes("Worked for") ||
          (lastLines.includes("❯") && !lastLines.includes("⏳") && !lastLines.includes("Running"))) {
        // Verify stability
        await Bun.sleep(3000);
        const newPane = await capturePane(50);
        const newLastLines = newPane.split("\n").slice(-20).join("\n");
        if (!newLastLines.includes("⏳") && !newLastLines.includes("Running")) {
          return;
        }
      }

      // Check if agent is still active
      const currentPane = await capturePane(100);
      if (currentPane !== lastPaneContent) {
        lastPaneContent = currentPane;
        lastActivityTime = Date.now();
      }

      const timeToDeadline = deadline - Date.now();
      const timeSinceActivity = Date.now() - lastActivityTime;

      if (timeToDeadline < TIMEOUT_EXTENSION && timeSinceActivity < ACTIVITY_THRESHOLD) {
        deadline = Date.now() + TIMEOUT_EXTENSION;
        console.error(`[claude] Still active, extending timeout by 15 minutes`);
      }
    } catch {}
  }

  // Log pane content for debugging before timeout
  try {
    const finalPane = await capturePane(100);
    console.error(`[claude] Timeout - last pane content:\n${finalPane.slice(-500)}`);
  } catch {}

  throw new Error(`Timeout waiting for Claude completion`);
}
