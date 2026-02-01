#!/usr/bin/env bun
/**
 * Gumploop MCP v2.1 - "Run Forrest Run!"
 *
 * Multi-agent development pipeline with consensus-based planning.
 * Like Forrest Gump: simple but gets the job done.
 *
 * Planning Flow:
 * 1. Claude writes plan → .gumploop/plan.md
 * 2. Gemini reviews → .gumploop/review-gemini.md
 * 3. Codex reviews → .gumploop/review-codex.md
 * 4. Claude reads reviews, revises plan
 * 5. Loop until both approve (you never know what you're gonna get)
 *
 * Tools (mcp__gumploop__*):
 * - plan: Start planning phase with workDir support
 * - code: Start coding phase
 * - test: Start testing phase
 * - debug: Start debugging phase
 * - status: Get current status
 * - stop: Stop all agents
 * - reset: Reset pipeline state
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync, mkdtempSync } from "fs";
import { readdir, stat, readFile } from "fs/promises";
import { join, resolve, isAbsolute, sep } from "path";
import { homedir, tmpdir } from "os";
import { $ } from "bun";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const HOME = homedir();
const DEFAULT_BASE_DIR = "/tmp/collab-mcp";
const DEFAULT_PROJECT_DIR = join(DEFAULT_BASE_DIR, "project");
const STATE_FILE = join(DEFAULT_BASE_DIR, ".state.json");
const CODEX_SESSIONS_DIR = join(HOME, ".codex", "sessions");
const GEMINI_SESSIONS_DIR = join(HOME, ".gemini", "tmp");

// Terminal configuration (env variable support)
const TERMINAL = process.env.PIPELINE_TERMINAL || "ghostty";

// Timeout configuration (adaptive timeout strategy)
const TIMEOUT_BASE = 30 * 60 * 1000;        // 30 minutes base timeout per agent
const TIMEOUT_EXTENSION = 15 * 60 * 1000;   // 15 minutes extension if agent is active
const ACTIVITY_CHECK_INTERVAL = 2000;        // Check every 2 seconds
const ACTIVITY_THRESHOLD = 60 * 1000;        // Consider active if output changed in last 60s

// Request ID generator for completion detection
function generateRequestId(): string {
  return `RQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Working Directory Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Forbidden paths - never write to these
const FORBIDDEN_PATHS = ["/", "/etc", "/usr", "/bin", "/sbin", "/root", "/boot", "/sys", "/proc"];

function validateWorkDir(workDir: string): { valid: boolean; error?: string; resolved?: string } {
  // Path traversal check BEFORE resolve (Fix 7)
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

function getProjectDir(workDir?: string): string {
  if (workDir) {
    const validation = validateWorkDir(workDir);
    if (validation.valid && validation.resolved) {
      return validation.resolved;
    }
    // If invalid, log warning and use default
    console.error(`Invalid workDir "${workDir}": ${validation.error}. Using default.`);
  }
  return DEFAULT_PROJECT_DIR;
}

function getPipelineDir(projectDir: string): string {
  return join(projectDir, ".gumploop");
}

function getPipelineFiles(projectDir: string) {
  const pipelineDir = getPipelineDir(projectDir);
  return {
    pipelineDir,
    gumploopDir: pipelineDir, // Fix 1: Add gumploopDir alias
    planFile: join(pipelineDir, "plan.md"),
    reviewGeminiFile: join(pipelineDir, "review-gemini.md"),
    reviewCodexFile: join(pipelineDir, "review-codex.md"),
    codeReviewFile: join(pipelineDir, "code-review.md"),
    testResultsFile: join(pipelineDir, "test-results.md"),
    bugAnalysisFile: join(pipelineDir, "bug-analysis.md"),
    progressFile: join(pipelineDir, "progress.jsonl"),
  };
}

// Ensure default directories exist
mkdirSync(DEFAULT_PROJECT_DIR, { recursive: true });
mkdirSync(getPipelineDir(DEFAULT_PROJECT_DIR), { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AgentType = "claude" | "gemini" | "codex";

// Fix 10: Proper type for i3 tree nodes
interface I3Node {
  type?: string;
  num?: number;
  window?: number;
  nodes?: I3Node[];
  floating_nodes?: I3Node[];
}

interface I3Workspace {
  num: number;
  name: string;
  focused: boolean;
}

interface PipelineState {
  currentPhase: string | null;
  task: string;
  workDir: string;  // Working directory for this pipeline
  iteration: number;
  planningComplete: boolean;
  codingComplete: boolean;
  testingComplete: boolean;
  debuggingComplete: boolean;
  activeSessions: string[];
  lastUpdate: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State Management
// ─────────────────────────────────────────────────────────────────────────────

// Fix 8: Safe JSON parse helper
function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

// Fix 2: Validate state shape
function isValidState(obj: unknown): obj is PipelineState {
  if (!obj || typeof obj !== "object") return false;
  const state = obj as Record<string, unknown>;
  return (
    (state.currentPhase === null || typeof state.currentPhase === "string") &&
    typeof state.task === "string" &&
    typeof state.iteration === "number" &&
    typeof state.planningComplete === "boolean" &&
    typeof state.codingComplete === "boolean" &&
    typeof state.testingComplete === "boolean" &&
    typeof state.debuggingComplete === "boolean" &&
    Array.isArray(state.activeSessions)
  );
}

function defaultState(): PipelineState {
  return {
    currentPhase: null,
    task: "",
    workDir: DEFAULT_PROJECT_DIR,
    iteration: 0,
    planningComplete: false,
    codingComplete: false,
    testingComplete: false,
    debuggingComplete: false,
    activeSessions: [],
    lastUpdate: new Date().toISOString(),
  };
}

function loadState(): PipelineState {
  if (existsSync(STATE_FILE)) {
    try {
      const raw = readFileSync(STATE_FILE, "utf-8");
      const state = safeJsonParse<PipelineState>(raw);
      if (state && isValidState(state)) {
        // Ensure workDir exists (for backwards compatibility)
        return { ...state, workDir: state.workDir || DEFAULT_PROJECT_DIR };
      }
      console.error("Invalid state shape, resetting.");
    } catch (err) {
      console.error("State file corrupt, resetting:", err);
    }
  }
  return defaultState();
}

function saveState(state: PipelineState): void {
  state.lastUpdate = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Helper
// ─────────────────────────────────────────────────────────────────────────────

async function findEmptyWorkspace(): Promise<number> {
  try {
    // Get all workspaces with their window counts
    const result = await $`i3-msg -t get_workspaces`.quiet().text();
    const workspaces = safeJsonParse<I3Workspace[]>(result);
    if (!workspaces) return 6; // Fallback if parse fails

    // Get window counts per workspace
    const treeResult = await $`i3-msg -t get_tree`.quiet().text();
    const tree = safeJsonParse<I3Node>(treeResult);
    if (!tree) return 6; // Fallback if parse fails

    // Find workspaces with windows
    const occupiedWorkspaces = new Set<number>();

    // Fix 10: Proper type for countWindows
    function countWindows(node: I3Node, wsNum: number | null): void {
      if (node.type === "workspace" && node.num && node.num > 0) {
        wsNum = node.num;
      }
      // Any node with a window property means this workspace has windows
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

    // Find first empty workspace (prefer 6-20, then 1-5)
    for (const num of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 5, 4, 3, 2, 1]) {
      if (!occupiedWorkspaces.has(num)) {
        return num;
      }
    }

    // Fallback to 10 if all occupied
    return 10;
  } catch {
    return 7; // Fallback
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tmux Agent
// ─────────────────────────────────────────────────────────────────────────────

// Target workspace for all agents (set before parallel start)
let targetWorkspace: number = 7;

// Fix 4: Sanitize session names to prevent command injection
function sanitizeSessionName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50);
}

class TmuxAgent {
  private sessionName: string;
  private agentType: AgentType;
  private projectDir: string;
  private messageStartTime: number = 0;
  private currentRequestId: string | null = null;
  private terminalProc: ReturnType<typeof spawn> | null = null; // Fix 6: Track process

  constructor(name: string, type: AgentType, projectDir: string) {
    this.sessionName = sanitizeSessionName(`pipeline-${name}`); // Fix 4
    this.agentType = type;
    this.projectDir = projectDir;
  }

  // Fix 3: Return CLI args array instead of shell command string
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

  async start(): Promise<void> {
    await $`tmux kill-session -t ${this.sessionName} 2>/dev/null || true`.quiet();

    const cliArgs = this.getCliArgs();

    // Switch to target workspace first, then spawn window there
    await $`i3-msg workspace ${targetWorkspace}`.quiet();

    // Fix 3: Use tmux -c for safe directory change, pass args directly
    this.terminalProc = spawn([
      TERMINAL, "-e", "tmux", "new-session",
      "-s", this.sessionName,
      "-c", this.projectDir, // Safe directory handling
      ...cliArgs
    ], {
      stdout: "ignore",
      stderr: "ignore",
    });
    this.terminalProc.unref(); // Fix 6: Prevent orphan on crash

    // ISSUE-001 Fix: Wait for tmux session to be created (race condition)
    // spawn() is async, session may not exist immediately
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
  }

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

  private async capturePane(lines: number = 200): Promise<string> {
    return await $`tmux capture-pane -t ${this.sessionName} -p -S -${lines}`.quiet().text();
  }

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

    // Fix 5: Secure temp file creation with mkdtempSync
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

  // Wait for progress.jsonl to have a specific event (adaptive timeout)
  async waitForProgressEvent(agent: string, action: string, iteration: number, progressFile: string): Promise<void> {
    let deadline = Date.now() + TIMEOUT_BASE;
    let lastPaneContent = "";
    let lastActivityTime = Date.now();

    while (Date.now() < deadline) {
      await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

      // Check for completion first
      if (existsSync(progressFile)) {
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

  // Wait for Codex to complete using session file (adaptive timeout)
  async waitForCodexCompletion(): Promise<void> {
    let deadline = Date.now() + TIMEOUT_BASE;
    let lastPaneContent = "";
    let lastActivityTime = Date.now();

    while (Date.now() < deadline) {
      await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

      const sessionFile = await this.findLatestCodexSession();
      if (sessionFile) {
        const completed = await this.checkCodexCompletion(sessionFile);
        if (completed) {
          return;
        }
      }

      // Check if agent is still active
      try {
        const currentPane = await this.capturePane(100);
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

  private async findLatestCodexSession(): Promise<string | null> {
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
        if (mtime >= this.messageStartTime) {
          return path;
        }
      }
      return valid[0]?.path || null;
    } catch { return null; }
  }

  private async checkCodexCompletion(sessionFile: string): Promise<boolean> {
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
        if (ts < this.messageStartTime) continue;

        // Primary: Check agent_message event (more reliable than token_count)
        if (event.type === "event_msg" && event.payload?.type === "agent_message") {
          const msg = event.payload.message || "";
          // Request ID verification (if available)
          if (this.currentRequestId) {
            const ansId = this.currentRequestId.replace("RQ-", "ANS-");
            if (msg.includes(`[${ansId}]`)) return true;
          }
          // Fallback: agent_message presence indicates completion
          return true;
        }

        // Secondary: token_count as fallback
        if (event.type === "event_msg" && event.payload?.type === "token_count") {
          return true;
        }
      }
    } catch {}
    return false;
  }

  // Wait for Gemini to complete using session file (adaptive timeout)
  async waitForGeminiCompletion(): Promise<void> {
    let deadline = Date.now() + TIMEOUT_BASE;
    let lastPaneContent = "";
    let lastActivityTime = Date.now();

    while (Date.now() < deadline) {
      await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

      const completed = await this.checkGeminiSessionFile();
      if (completed) {
        return;
      }

      // Check if agent is still active
      try {
        const currentPane = await this.capturePane(100);
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

  private async checkGeminiSessionFile(): Promise<boolean> {
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
          if (stats.mtimeMs < this.messageStartTime) continue;

          interface GeminiChat {
            messages?: Array<{ type: string; content?: string }>;
          }
          const data = safeJsonParse<GeminiChat>(await readFile(filePath, "utf-8"));
          if (!data) continue;
          const messages = data.messages || [];

          // Find gemini message with completion markers
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.type === "gemini") {
              const content = msg.content || "";

              // Primary: Check for ANS marker (request ID based)
              if (this.currentRequestId) {
                const ansId = this.currentRequestId.replace("RQ-", "ANS-");
                if (content.includes(`[${ansId}]`)) return true;
              }

              // Secondary: Check for ◆END◆ marker (fallback)
              if (content.includes("◆END◆")) {
                return true;
              }
            }
          }
        }
      }
    } catch {}
    return false;
  }

  // Generic wait for completion - routes to the right method based on agent type
  async waitForCompletion(): Promise<void> {
    switch (this.agentType) {
      case "claude":
        return this.waitForClaudeCompletion();
      case "gemini":
        return this.waitForGeminiCompletion();
      case "codex":
        return this.waitForCodexCompletion();
    }
  }

  // Wait for Claude to complete using pane (adaptive timeout)
  async waitForClaudeCompletion(): Promise<void> {
    let deadline = Date.now() + TIMEOUT_BASE;
    let lastPaneContent = "";
    let lastActivityTime = Date.now();

    while (Date.now() < deadline) {
      await Bun.sleep(ACTIVITY_CHECK_INTERVAL);

      try {
        const pane = await this.capturePane(50);
        const lastLines = pane.split("\n").slice(-20).join("\n");

        // Check for completion
        if (lastLines.includes("Worked for") ||
            (lastLines.includes("❯") && !lastLines.includes("⏳") && !lastLines.includes("Running"))) {
          // Verify stability
          await Bun.sleep(3000);
          const newPane = await this.capturePane(50);
          const newLastLines = newPane.split("\n").slice(-20).join("\n");
          if (!newLastLines.includes("⏳") && !newLastLines.includes("Running")) {
            return;
          }
        }

        // Check if agent is still active
        const currentPane = await this.capturePane(100);
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

    throw new Error(`Timeout waiting for Claude completion`);
  }

  async stop(): Promise<void> {
    // Fix 6: Kill terminal process if still running
    if (this.terminalProc) {
      try {
        this.terminalProc.kill();
      } catch {}
      this.terminalProc = null;
    }
    await $`tmux kill-session -t ${this.sessionName} 2>/dev/null || true`.quiet();
  }

  getSessionName(): string {
    return this.sessionName;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Executors
// ─────────────────────────────────────────────────────────────────────────────

async function executePlanning(task: string, maxIterations: number, workDir?: string): Promise<{ success: boolean; result: string }> {
  // Resolve project directory
  const projectDir = getProjectDir(workDir);
  const files = getPipelineFiles(projectDir);

  // Ensure directories exist
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(files.gumploopDir, { recursive: true });

  const state = loadState();
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
    targetWorkspace = await findEmptyWorkspace();
    results.push(`Starting agents in parallel on workspace ${targetWorkspace}...`);

    // Start all agents in parallel
    await Promise.all([
      claude.start(),
      gemini.start(),
      codex.start()
    ]);

    state.activeSessions = [
      claude.getSessionName(),
      gemini.getSessionName(),
      codex.getSessionName()
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
        results.push("  ⚠️ Plan file not created or too short!");
        continue; // Skip to next iteration
      }
      results.push("  ✓ Claude done (plan.md created)");

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

End your response with ◆END◆`;

      await gemini.sendMessage(geminiPrompt);
      // Wait for Gemini to signal completion via progress.jsonl
      await gemini.waitForProgressEvent("gemini", "review_written", state.iteration, files.progressFile);
      results.push("  ✓ Gemini done");

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
      results.push("  ✓ Codex done");

      // Check if both approved
      const geminiReview = existsSync(files.reviewGeminiFile) ? readFileSync(files.reviewGeminiFile, "utf-8") : "";
      const codexReview = existsSync(files.reviewCodexFile) ? readFileSync(files.reviewCodexFile, "utf-8") : "";

      const geminiApproved = geminiReview.includes("APPROVED") && !geminiReview.includes("NEEDS_REVISION");
      const codexApproved = codexReview.includes("APPROVED") && !codexReview.includes("NEEDS_REVISION");

      results.push(`\n**Results:**`);
      results.push(`- Gemini: ${geminiApproved ? "✓ APPROVED" : "✗ NEEDS_REVISION"}`);
      results.push(`- Codex: ${codexApproved ? "✓ APPROVED" : "✗ NEEDS_REVISION"}`);

      if (geminiApproved && codexApproved) {
        consensusReached = true;
        results.push("\n✅ **Consensus reached!**");
      } else {
        results.push("\n⏳ Continuing to next iteration...");
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
      results.push("  ✓ Claude summarized remaining issues");
      results.push("\n❌ **Max iterations reached without consensus**");
      results.push(`\nSee: ${files.gumploopDir}/remaining-issues.md`);
    }

    // Stop agents
    await claude.stop();
    await gemini.stop();
    await codex.stop();
    state.activeSessions = [];

    if (consensusReached) {
      state.planningComplete = true;
    }

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

async function executeCoding(maxIterations: number): Promise<{ success: boolean; result: string }> {
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

    if (codeApproved) {
      state.codingComplete = true;
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

async function executeTesting(): Promise<{ success: boolean; result: string }> {
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
1. Read the code in the project
2. Create comprehensive tests in a .test.ts file
3. Run: bun test
4. Write results to .gumploop/test-results.md

Include in test-results.md:
## Test Results
- Tests run
- Output

## Status
TESTS_PASS (all pass) or TESTS_FAIL (with failures)`;

    await tester.sendMessage(testerPrompt);
    await tester.waitForCompletion();
    results.push("Tester done.");

    await Bun.sleep(3000);
    await tester.stop();
    state.activeSessions = [];

    const testResults = existsSync(files.testResultsFile) ? readFileSync(files.testResultsFile, "utf-8") : "";
    const testsPassed = testResults.includes("TESTS_PASS");

    if (testsPassed) {
      state.testingComplete = true;
      results.push("\n✅ **All tests passed!**");
    } else {
      results.push("\n❌ **Tests failed**");
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

async function executeDebugging(maxIterations: number): Promise<{ success: boolean; result: string }> {
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
      results.push("  ✓ Analysis done");

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
      results.push("  ✓ Fixes applied");

      // Step 3: Re-test
      results.push("\n**Step 3: Re-testing...**");
      const testResult = await executeTesting();
      fixed = testResult.success;

      if (fixed) {
        results.push("  ✓ Tests pass!");
      } else {
        results.push("  ✗ Tests still failing");
      }
    }

    state.activeSessions = [];
    state.debuggingComplete = fixed;
    results.push(fixed ? "\n✅ **Bugs fixed!**" : "\n❌ **Could not fix all bugs**");

    saveState(state);
    return { success: fixed, result: results.join("\n") };

  } catch (error) {
    state.activeSessions = [];
    state.currentPhase = null;
    saveState(state);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function stopAllAgents(): Promise<string> {
  const state = loadState();

  for (const session of state.activeSessions) {
    await $`tmux kill-session -t ${session} 2>/dev/null || true`.quiet();
  }

  // Also kill any lingering pipeline sessions
  await $`tmux list-sessions -F '#{session_name}' 2>/dev/null | grep pipeline | xargs -I {} tmux kill-session -t {} 2>/dev/null || true`.quiet();

  state.activeSessions = [];
  state.currentPhase = null;
  saveState(state);

  return "All agents stopped.";
}

function getStatus(): string {
  const state = loadState();
  const projectDir = state.workDir;
  const files = getPipelineFiles(projectDir);

  const planExists = existsSync(files.planFile);
  const geminiReviewExists = existsSync(files.reviewGeminiFile);
  const codexReviewExists = existsSync(files.reviewCodexFile);

  return `## Pipeline Status

**Current Phase:** ${state.currentPhase || "None"}
**Task:** ${state.task || "None"}
**Working Directory:** ${projectDir}
**Iteration:** ${state.iteration}
**Active Sessions:** ${state.activeSessions.length > 0 ? state.activeSessions.join(", ") : "None"}
**Last Update:** ${state.lastUpdate}

### Phase Status
- Planning: ${state.planningComplete ? "✅ Complete" : "⏳ Pending"}
- Coding: ${state.codingComplete ? "✅ Complete" : "⏳ Pending"}
- Testing: ${state.testingComplete ? "✅ Passed" : "⏳ Pending"}
- Debugging: ${state.debuggingComplete ? "✅ Fixed" : "⏳ Pending"}

### Pipeline Files
- plan.md: ${planExists ? "✓ exists" : "✗ missing"}
- review-gemini.md: ${geminiReviewExists ? "✓ exists" : "✗ missing"}
- review-codex.md: ${codexReviewExists ? "✓ exists" : "✗ missing"}

**Project Directory:** ${projectDir}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server
// ─────────────────────────────────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "plan",
    description: "Start planning phase with Claude + Gemini + Codex consensus. Returns when all agents approve or max iterations reached.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task/feature to plan (e.g., 'Stack<T> data structure with push, pop, peek, isEmpty, size, clear')",
        },
        workDir: {
          type: "string",
          description: "Working directory for the pipeline. Agents will write code here. Defaults to /tmp/collab-mcp/project if not specified.",
        },
        maxIterations: {
          type: "number",
          description: "Maximum planning iterations (default: 5)",
          default: 5,
        },
      },
      required: ["task"],
    },
  },
  {
    name: "code",
    description: "Start coding phase with Coder ↔ Reviewer loop. Requires planning to be completed first.",
    inputSchema: {
      type: "object",
      properties: {
        maxIterations: {
          type: "number",
          description: "Maximum coding iterations (default: 5)",
          default: 5,
        },
      },
    },
  },
  {
    name: "test",
    description: "Start testing phase. Writes and runs tests for the implemented code.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "debug",
    description: "Start debugging phase with Codex analyzer → Claude fixer loop. Requires testing to have failed.",
    inputSchema: {
      type: "object",
      properties: {
        maxIterations: {
          type: "number",
          description: "Maximum debug iterations (default: 3)",
          default: 3,
        },
      },
    },
  },
  {
    name: "status",
    description: "Get current pipeline status including active sessions and phase results.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "stop",
    description: "Stop all running agents and reset current phase.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "reset",
    description: "Reset entire pipeline state and clear .gumploop directory.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const server = new Server(
  { name: "gumploop", version: "2.3.0" }, // Bumped: Adaptive timeout (30min base + 15min extensions)
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// Fix 9: Type-safe argument parsing helpers
function parsePlanArgs(args: unknown): { task: string; workDir?: string; maxIterations: number } {
  const obj = (args && typeof args === "object") ? args as Record<string, unknown> : {};
  return {
    task: typeof obj.task === "string" ? obj.task : "",
    workDir: typeof obj.workDir === "string" ? obj.workDir : undefined,
    maxIterations: typeof obj.maxIterations === "number" ? obj.maxIterations : 5,
  };
}

function parseIterationsArg(args: unknown, defaultValue: number): number {
  const obj = (args && typeof args === "object") ? args as Record<string, unknown> : {};
  return typeof obj.maxIterations === "number" ? obj.maxIterations : defaultValue;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "plan": {
        const { task, workDir, maxIterations } = parsePlanArgs(args);
        if (!task) {
          throw new Error("task parameter is required");
        }
        const result = await executePlanning(task, maxIterations, workDir);
        return { content: [{ type: "text", text: result.result }] };
      }

      case "code": {
        const maxIterations = parseIterationsArg(args, 5);
        const result = await executeCoding(maxIterations);
        return { content: [{ type: "text", text: result.result }] };
      }

      case "test": {
        const result = await executeTesting();
        return { content: [{ type: "text", text: result.result }] };
      }

      case "debug": {
        const maxIterations = parseIterationsArg(args, 3);
        const result = await executeDebugging(maxIterations);
        return { content: [{ type: "text", text: result.result }] };
      }

      case "status": {
        return { content: [{ type: "text", text: getStatus() }] };
      }

      case "stop": {
        const result = await stopAllAgents();
        return { content: [{ type: "text", text: result }] };
      }

      case "reset": {
        const state = loadState();
        const projectDir = state.workDir;
        const pipelineDir = getPipelineDir(projectDir);
        await stopAllAgents();
        // Only reset .gumploop folder, not the entire project directory
        await $`rm -rf ${pipelineDir} ${STATE_FILE} 2>/dev/null || true`.quiet();
        mkdirSync(pipelineDir, { recursive: true });
        return { content: [{ type: "text", text: `Pipeline reset complete. Cleared: ${pipelineDir}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gumploop MCP v2.0 running on stdio - Run Forrest Run!");
}

main().catch(console.error);
