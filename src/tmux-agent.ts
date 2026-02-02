/**
 * TmuxAgent - Manages CLI agents (Claude, Gemini, Codex) in tmux sessions
 *
 * Features:
 * - Spawns agents in separate terminal windows
 * - Secure message passing via tmux buffers
 * - Adaptive timeout with activity detection
 * - Completion detection via session files and request ID markers
 */

import { spawn, $ } from "bun";
import { existsSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  TERMINAL,
  TIMEOUT_BASE,
  TIMEOUT_EXTENSION,
  ACTIVITY_CHECK_INTERVAL,
  ACTIVITY_THRESHOLD,
  generateRequestId,
} from "./constants";
import type { AgentType } from "./types";
import { targetWorkspace, sanitizeSessionName, getWorkDirHash } from "./workspace";
import { safeJsonParse } from "./state";
import {
  waitForCodexCompletion,
  waitForGeminiCompletion,
  waitForClaudeCompletion,
} from "./completion";

export class TmuxAgent {
  private sessionName: string;
  private agentType: AgentType;
  private projectDir: string;
  private messageStartTime: number = 0;
  private currentRequestId: string | null = null;
  private terminalProc: ReturnType<typeof spawn> | null = null;

  constructor(name: string, type: AgentType, projectDir: string) {
    const hash = getWorkDirHash(projectDir);
    this.sessionName = sanitizeSessionName(`gumploop-${hash}-${type}`);
    this.agentType = type;
    this.projectDir = projectDir;
  }

  /**
   * Get CLI command arguments for each agent type
   */
  private getCliArgs(): string[] {
    switch (this.agentType) {
      case "claude":
        return ["claude", "--dangerously-skip-permissions"];
      case "gemini":
        return ["gemini", "-m", "gemini-3-flash-preview", "-y"];
      case "codex":
        return ["codex", "--dangerously-bypass-approvals-and-sandbox"];
    }
  }

  /**
   * Start the agent in a new tmux session
   */
  async start(): Promise<void> {
    await $`tmux kill-session -t ${this.sessionName} 2>/dev/null || true`.quiet();

    const cliArgs = this.getCliArgs();

    // Switch to target workspace first, then spawn window there
    await $`i3-msg workspace ${targetWorkspace}`.quiet();

    // Use tmux -c for safe directory change, pass args directly
    this.terminalProc = spawn([
      TERMINAL, "-e", "tmux", "new-session",
      "-s", this.sessionName,
      "-c", this.projectDir,
      ...cliArgs
    ], {
      stdout: "ignore",
      stderr: "ignore",
    });
    this.terminalProc.unref(); // Prevent orphan on crash

    // Wait for tmux session to be created (race condition fix)
    await Bun.sleep(1000);

    // Wait for prompt box to appear - poll frequently
    const readyIndicators = this.getReadyIndicators();

    for (let i = 0; i < 60; i++) {
      await Bun.sleep(500);
      try {
        const pane = await this.capturePane(50);
        for (const indicator of readyIndicators) {
          if (pane.includes(indicator)) {
            return; // Found prompt - ready to send
          }
        }
      } catch {
        // Session may not exist yet, continue polling
      }
    }

    // Prompt not detected but agent may have started - log and proceed
    console.error(`[${this.agentType}] Prompt not detected after 30s, proceeding anyway`);
  }

  /**
   * Get ready indicators for each agent type
   */
  private getReadyIndicators(): string[] {
    switch (this.agentType) {
      case "claude":
        return ["❯"];
      case "gemini":
        return ["Type your message", "YOLO mode"];
      case "codex":
        return ["context left", "›"];
    }
  }

  /**
   * Capture tmux pane content
   */
  private async capturePane(lines: number = 200): Promise<string> {
    return await $`tmux capture-pane -t ${this.sessionName} -p -S -${lines}`.quiet().text();
  }

  /**
   * Send a message to the agent
   */
  async sendMessage(message: string): Promise<void> {
    const requestId = generateRequestId();
    this.currentRequestId = requestId;
    this.messageStartTime = Date.now();

    let safeMessage = message;

    // Add request ID and completion marker instruction
    const ansId = requestId.replace("RQ-", "ANS-");
    safeMessage = `[${requestId}]\n${message}\n\n[IMPORTANT: End your response with [${ansId}] marker]`;

    if (this.agentType === "gemini") {
      // Gemini safe prefix to prevent slash command interpretation + ! escape
      safeMessage = `Soru: ${safeMessage.replace(/!/g, ".")}`;
      await $`tmux send-keys -t ${this.sessionName} Escape`.quiet();
      await Bun.sleep(100);
      await $`tmux send-keys -t ${this.sessionName} C-u`.quiet();
      await Bun.sleep(100);
    }

    // Secure temp file creation with mkdtempSync
    const tmpDir = mkdtempSync(join(tmpdir(), "pipeline-msg-"));
    const tmpFile = join(tmpDir, "msg.txt");
    const bufferName = `msg-${this.sessionName}`;

    writeFileSync(tmpFile, safeMessage, { mode: 0o600, flag: "wx" });

    await $`tmux delete-buffer -b ${bufferName} 2>/dev/null || true`.quiet();
    await $`tmux load-buffer -b ${bufferName} ${tmpFile}`.quiet();
    await $`tmux paste-buffer -t ${this.sessionName} -b ${bufferName} -p`.quiet();

    // Clean up temp directory
    rmSync(tmpDir, { recursive: true, force: true });

    await Bun.sleep(300);
    await $`tmux send-keys -t ${this.sessionName} Enter`.quiet();
  }

  /**
   * Wait for progress.jsonl to have a specific event (adaptive timeout)
   */
  async waitForProgressEvent(agent: string, action: string, iteration: number, progressFile: string): Promise<void> {
    let deadline = Date.now() + TIMEOUT_BASE;
    let lastPaneContent = "";
    let lastActivityTime = Date.now();

    while (Date.now() < deadline) {
      await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

      // Check for completion first
      if (existsSync(progressFile)) {
        const { readFileSync } = await import("fs");
        const content = readFileSync(progressFile, "utf-8");
        const lines = content.trim().split("\n").filter(l => l.trim());

        for (const line of lines) {
          const event = safeJsonParse<{ agent: string; action: string; iteration: number }>(line);
          if (event && event.agent === agent && event.action === action && event.iteration === iteration) {
            return;
          }
        }
      }

      // Check if agent is still active (pane output changing)
      try {
        const currentPane = await this.capturePane(100);
        if (currentPane !== lastPaneContent) {
          lastPaneContent = currentPane;
          lastActivityTime = Date.now();
        }

        // If agent is active and we're near deadline, extend it
        const timeToDeadline = deadline - Date.now();
        const timeSinceActivity = Date.now() - lastActivityTime;

        if (timeToDeadline < TIMEOUT_EXTENSION && timeSinceActivity < ACTIVITY_THRESHOLD) {
          deadline = Date.now() + TIMEOUT_EXTENSION;
          console.error(`[${agent}] Still active, extending timeout by 15 minutes`);
        }
      } catch {}
    }

    throw new Error(`Timeout waiting for ${agent}/${action} in progress.jsonl`);
  }

  /**
   * Generic wait for completion - routes to the right method based on agent type
   */
  async waitForCompletion(): Promise<void> {
    // Request ID is required for reliable completion detection
    if (!this.currentRequestId) {
      throw new Error(`[${this.agentType}] Cannot wait for completion without request ID`);
    }

    // Create a bound capturePane callback for completion functions
    const capturePane = (lines?: number) => this.capturePane(lines);

    switch (this.agentType) {
      case "claude":
        return waitForClaudeCompletion(
          capturePane,
          this.projectDir,
          this.messageStartTime,
          this.currentRequestId
        );
      case "gemini":
        return waitForGeminiCompletion(
          capturePane,
          this.messageStartTime,
          this.currentRequestId
        );
      case "codex":
        return waitForCodexCompletion(
          capturePane,
          this.messageStartTime,
          this.currentRequestId
        );
    }
  }

  /**
   * Stop the agent and clean up
   */
  async stop(): Promise<void> {
    // Kill terminal process if still running
    if (this.terminalProc) {
      try {
        this.terminalProc.kill();
      } catch {}
      this.terminalProc = null;
    }
    await $`tmux kill-session -t ${this.sessionName} 2>/dev/null || true`.quiet();
  }

  /**
   * Get the tmux session name
   */
  getSessionName(): string {
    return this.sessionName;
  }
}
