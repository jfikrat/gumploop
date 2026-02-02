/**
 * Gumploop MCP - Server Setup
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { $ } from "bun";
import { mkdirSync, existsSync } from "fs";

import { loadState, saveState } from "./state";
import { getProjectDir, getPipelineDir } from "./workdir";
import { STATE_FILE } from "./constants";
import { executePlanning } from "./phases/planning";
import { executeCoding } from "./phases/coding";
import { executeTesting, executeDebugging } from "./phases/testing";

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
  const pipelineDir = getPipelineDir(projectDir);
  const planExists = existsSync(`${pipelineDir}/plan.md`);
  const geminiReviewExists = existsSync(`${pipelineDir}/review-gemini.md`);
  const codexReviewExists = existsSync(`${pipelineDir}/review-codex.md`);

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
// Tools Definition
// ─────────────────────────────────────────────────────────────────────────────

export const tools: Tool[] = [
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
        maxIterations: { type: "number", description: "Maximum planning iterations (default: 5)", default: 5 },
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
        maxIterations: { type: "number", description: "Maximum coding iterations (default: 5)", default: 5 },
      },
    },
  },
  {
    name: "test",
    description: "Start testing phase. Writes and runs tests for the implemented code.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "debug",
    description: "Start debugging phase with Codex analyzer → Claude fixer loop. Requires testing to have failed.",
    inputSchema: {
      type: "object",
      properties: {
        maxIterations: { type: "number", description: "Maximum debug iterations (default: 3)", default: 3 },
      },
    },
  },
  {
    name: "status",
    description: "Get current pipeline status including active sessions and phase results.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "stop",
    description: "Stop all running agents and reset current phase.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "reset",
    description: "Reset entire pipeline state and clear .gumploop directory.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Argument Parsers
// ─────────────────────────────────────────────────────────────────────────────

function parsePlanArgs(args: unknown): { task: string; workDir?: string; maxIterations: number } {
  const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  return {
    task: typeof obj.task === "string" ? obj.task : "",
    workDir: typeof obj.workDir === "string" ? obj.workDir : undefined,
    maxIterations: typeof obj.maxIterations === "number" ? obj.maxIterations : 5,
  };
}

function parseIterationsArg(args: unknown, defaultValue: number): number {
  const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  return typeof obj.maxIterations === "number" ? obj.maxIterations : defaultValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Instance & Handlers
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "gumploop", version: "2.6.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "plan": {
        const { task, workDir, maxIterations } = parsePlanArgs(args);
        if (!task) throw new Error("task parameter is required");
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
      case "status":
        return { content: [{ type: "text", text: getStatus() }] };
      case "stop": {
        const result = await stopAllAgents();
        return { content: [{ type: "text", text: result }] };
      }
      case "reset": {
        const state = loadState();
        const projectDir = state.workDir;
        const pipelineDir = getPipelineDir(projectDir);
        await stopAllAgents();
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

// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────────────

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Gumploop MCP v2.0 running on stdio - Run Forrest Run!");
}
