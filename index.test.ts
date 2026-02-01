/**
 * Gumploop MCP v2.5.0 Tests
 *
 * Tests for:
 * - Request ID generation and ANS marker
 * - Session name sanitization
 * - Working directory validation
 * - Safe JSON parsing
 * - State validation
 * - Pipeline file structure
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  generateRequestId,
  sanitizeSessionName,
  validateWorkDir,
  safeJsonParse,
  isValidState,
  defaultState,
  getProjectDir,
  getPipelineDir,
  getPipelineFiles,
  type PipelineState,
} from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Request ID Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("generateRequestId", () => {
  test("generates valid RQ- prefixed ID", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^RQ-\d+-[a-z0-9]{4}$/);
  });

  test("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });

  test("ANS marker derivation works correctly", () => {
    const requestId = "RQ-1234567890-abcd";
    const ansId = requestId.replace("RQ-", "ANS-");
    expect(ansId).toBe("ANS-1234567890-abcd");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session Name Sanitization Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitizeSessionName", () => {
  test("allows alphanumeric, underscore, and hyphen", () => {
    expect(sanitizeSessionName("my-session_123")).toBe("my-session_123");
  });

  test("replaces special characters with underscore", () => {
    expect(sanitizeSessionName("my session!@#$%")).toBe("my_session_____");
  });

  test("truncates to 50 characters", () => {
    const longName = "a".repeat(100);
    expect(sanitizeSessionName(longName).length).toBe(50);
  });

  test("handles empty string", () => {
    expect(sanitizeSessionName("")).toBe("");
  });

  test("prevents command injection", () => {
    const malicious = "session; rm -rf /";
    const sanitized = sanitizeSessionName(malicious);
    expect(sanitized).not.toContain(";");
    expect(sanitized).not.toContain(" ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Working Directory Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateWorkDir", () => {
  const testDir = join(tmpdir(), "gumploop-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("accepts valid directory", () => {
    const result = validateWorkDir(testDir);
    expect(result.valid).toBe(true);
    expect(result.resolved).toBe(testDir);
  });

  test("rejects non-existent directory", () => {
    const result = validateWorkDir("/nonexistent/path/xyz");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("does not exist");
  });

  test("rejects path traversal", () => {
    const result = validateWorkDir(testDir + "/../../../etc");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("traversal");
  });

  test("rejects forbidden system paths", () => {
    const forbidden = ["/", "/etc", "/usr", "/bin", "/root"];
    for (const path of forbidden) {
      const result = validateWorkDir(path);
      // Only test if path exists (some may not on all systems)
      if (existsSync(path)) {
        expect(result.valid).toBe(false);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safe JSON Parse Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("safeJsonParse", () => {
  test("parses valid JSON", () => {
    const result = safeJsonParse<{ name: string }>('{"name": "test"}');
    expect(result).toEqual({ name: "test" });
  });

  test("returns null for invalid JSON", () => {
    const result = safeJsonParse("not json");
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = safeJsonParse("");
    expect(result).toBeNull();
  });

  test("handles nested objects", () => {
    const result = safeJsonParse<{ a: { b: number } }>('{"a": {"b": 42}}');
    expect(result?.a.b).toBe(42);
  });

  test("handles arrays", () => {
    const result = safeJsonParse<number[]>("[1, 2, 3]");
    expect(result).toEqual([1, 2, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidState", () => {
  test("accepts valid state", () => {
    const state: PipelineState = {
      currentPhase: "planning",
      task: "Test task",
      workDir: "/tmp/test",
      iteration: 1,
      planningComplete: false,
      codingComplete: false,
      testingComplete: false,
      debuggingComplete: false,
      activeSessions: [],
      lastUpdate: new Date().toISOString(),
    };
    expect(isValidState(state)).toBe(true);
  });

  test("accepts null currentPhase", () => {
    const state = defaultState();
    state.currentPhase = null;
    expect(isValidState(state)).toBe(true);
  });

  test("rejects non-object", () => {
    expect(isValidState(null)).toBe(false);
    expect(isValidState(undefined)).toBe(false);
    expect(isValidState("string")).toBe(false);
    expect(isValidState(123)).toBe(false);
  });

  test("rejects missing fields", () => {
    expect(isValidState({})).toBe(false);
    expect(isValidState({ task: "test" })).toBe(false);
  });

  test("rejects wrong types", () => {
    const badState = {
      currentPhase: 123, // should be string or null
      task: "test",
      iteration: "1", // should be number
      planningComplete: "yes", // should be boolean
      codingComplete: false,
      testingComplete: false,
      debuggingComplete: false,
      activeSessions: "not array", // should be array
    };
    expect(isValidState(badState)).toBe(false);
  });
});

describe("defaultState", () => {
  test("returns valid default state", () => {
    const state = defaultState();
    expect(isValidState(state)).toBe(true);
    expect(state.currentPhase).toBeNull();
    expect(state.task).toBe("");
    expect(state.iteration).toBe(0);
    expect(state.planningComplete).toBe(false);
    expect(state.codingComplete).toBe(false);
    expect(state.testingComplete).toBe(false);
    expect(state.debuggingComplete).toBe(false);
    expect(state.activeSessions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Directory Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getPipelineDir", () => {
  test("returns .gumploop subdirectory", () => {
    const projectDir = "/tmp/myproject";
    const pipelineDir = getPipelineDir(projectDir);
    expect(pipelineDir).toBe("/tmp/myproject/.gumploop");
  });
});

describe("getPipelineFiles", () => {
  test("returns correct file paths", () => {
    const projectDir = "/tmp/myproject";
    const files = getPipelineFiles(projectDir);

    expect(files.pipelineDir).toBe("/tmp/myproject/.gumploop");
    expect(files.gumploopDir).toBe("/tmp/myproject/.gumploop");
    expect(files.planFile).toBe("/tmp/myproject/.gumploop/plan.md");
    expect(files.reviewGeminiFile).toBe("/tmp/myproject/.gumploop/review-gemini.md");
    expect(files.reviewCodexFile).toBe("/tmp/myproject/.gumploop/review-codex.md");
    expect(files.codeReviewFile).toBe("/tmp/myproject/.gumploop/code-review.md");
    expect(files.testResultsFile).toBe("/tmp/myproject/.gumploop/test-results.md");
    expect(files.bugAnalysisFile).toBe("/tmp/myproject/.gumploop/bug-analysis.md");
    expect(files.progressFile).toBe("/tmp/myproject/.gumploop/progress.jsonl");
  });
});

describe("getProjectDir", () => {
  const testDir = join(tmpdir(), "gumploop-project-test-" + Date.now());

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("creates directory if not exists", () => {
    const result = getProjectDir(testDir);
    expect(existsSync(testDir)).toBe(true);
    expect(result).toBe(testDir);
  });

  test("returns default for invalid workDir", () => {
    // Path traversal should fall back to default
    const result = getProjectDir("/tmp/../../../etc");
    expect(result).toBe("/tmp/collab-mcp/project");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ANS Marker Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ANS Marker Detection", () => {
  test("ANS marker format matches request ID", () => {
    const requestId = generateRequestId();
    const ansId = requestId.replace("RQ-", "ANS-");

    // Simulate agent response with ANS marker
    const agentResponse = `Here is my analysis...\n\n[${ansId}]`;

    expect(agentResponse.includes(`[${ansId}]`)).toBe(true);
  });

  test("detects ANS marker in Codex session format", () => {
    const requestId = "RQ-1706745600000-a1b2";
    const ansId = requestId.replace("RQ-", "ANS-");

    // Simulated Codex session JSONL line
    const codexEvent = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: `Task completed successfully.\n\n[${ansId}]`,
      },
    });

    const parsed = safeJsonParse<{
      payload?: { type: string; message?: string };
    }>(codexEvent);

    expect(parsed?.payload?.message?.includes(`[${ansId}]`)).toBe(true);
  });

  test("detects ANS marker in Gemini session format", () => {
    const requestId = "RQ-1706745600000-c3d4";
    const ansId = requestId.replace("RQ-", "ANS-");

    // Simulated Gemini chat JSON
    const geminiChat = JSON.stringify({
      messages: [
        { type: "user", content: `[${requestId}]\nAnalyze this code` },
        { type: "gemini", content: `Analysis complete.\n\n[${ansId}]` },
      ],
    });

    const parsed = safeJsonParse<{
      messages?: Array<{ type: string; content?: string }>;
    }>(geminiChat);

    const geminiMessage = parsed?.messages?.find((m) => m.type === "gemini");
    expect(geminiMessage?.content?.includes(`[${ansId}]`)).toBe(true);
  });

  test("detects ANS marker in Claude session format", () => {
    const requestId = "RQ-1706745600000-e5f6";
    const ansId = requestId.replace("RQ-", "ANS-");

    // Simulated Claude session JSONL line
    const claudeEvent = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: `I've completed the task.\n\n[${ansId}]`,
          },
        ],
      },
    });

    const parsed = safeJsonParse<{
      type: string;
      message?: { content?: Array<{ type: string; text?: string }> };
    }>(claudeEvent);

    const textBlock = parsed?.message?.content?.find((b) => b.type === "text");
    expect(textBlock?.text?.includes(`[${ansId}]`)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Progress File Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Progress File Format", () => {
  const testDir = join(tmpdir(), "gumploop-progress-test-" + Date.now());
  const progressFile = join(testDir, "progress.jsonl");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("progress events are valid JSONL", () => {
    const events = [
      { agent: "claude", action: "plan_written", iteration: 1 },
      { agent: "gemini", action: "review_written", iteration: 1 },
      { agent: "codex", action: "review_written", iteration: 1 },
    ];

    // Write events
    const content = events.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(progressFile, content);

    // Read and parse
    const lines = readFileSync(progressFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(3);

    for (let i = 0; i < lines.length; i++) {
      const event = safeJsonParse<{ agent: string; action: string; iteration: number }>(lines[i]);
      expect(event).not.toBeNull();
      expect(event?.agent).toBe(events[i].agent);
      expect(event?.action).toBe(events[i].action);
      expect(event?.iteration).toBe(events[i].iteration);
    }
  });

  test("can find specific agent/action/iteration", () => {
    const events = [
      { agent: "claude", action: "plan_written", iteration: 1 },
      { agent: "gemini", action: "review_written", iteration: 1 },
      { agent: "claude", action: "plan_written", iteration: 2 },
    ];

    writeFileSync(progressFile, events.map((e) => JSON.stringify(e)).join("\n"));

    const content = readFileSync(progressFile, "utf-8");
    const lines = content.trim().split("\n").filter((l) => l.trim());

    // Find claude plan_written iteration 2
    let found = false;
    for (const line of lines) {
      const event = safeJsonParse<{ agent: string; action: string; iteration: number }>(line);
      if (event && event.agent === "claude" && event.action === "plan_written" && event.iteration === 2) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
