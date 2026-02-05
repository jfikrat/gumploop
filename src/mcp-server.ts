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
import { executeResearch, type ResearchDepth } from "./phases/research";
import { executeDiscovery } from "./phases/discovery";
import { executePlanning } from "./phases/planning";
import { executeCoding } from "./phases/coding";
import { executeTesting, executeDebugging } from "./phases/testing";

// Canvas visualization
import {
  allTools as canvasAllTools,
  handleCanvasTool,
  handlePipelineTool,
  broadcaster,
  stateManager,
} from "./canvas";

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
  // Research files
  const researchExists = existsSync(`${pipelineDir}/research.md`);
  // Discovery files
  const consensusExists = existsSync(`${pipelineDir}/consensus.md`);
  // Planning files
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
- Discovery: ${state.discoveryComplete ? "✅ Complete" : "⏳ Pending"}${state.selectedFeature ? ` (Selected: ${state.selectedFeature})` : ""}
- Planning: ${state.planningComplete ? "✅ Complete" : "⏳ Pending"}
- Coding: ${state.codingComplete ? "✅ Complete" : "⏳ Pending"}
- Testing: ${state.testingComplete ? "✅ Passed" : "⏳ Pending"}
- Debugging: ${state.debuggingComplete ? "✅ Fixed" : "⏳ Pending"}

### Pipeline Files
- research.md: ${researchExists ? "✓ exists" : "✗ missing"}
- consensus.md: ${consensusExists ? "✓ exists" : "✗ missing"}
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
    name: "research",
    description: "Deep research on a topic before coding. Gathers sources, analyzes from multiple perspectives (best practices, modern trends, security), and synthesizes into a comprehensive report.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The research question (e.g., 'JWT authentication best practices', 'WebSocket vs SSE for real-time')",
        },
        workDir: {
          type: "string",
          description: "Working directory where research files will be saved.",
        },
        depth: {
          type: "string",
          enum: ["quick", "deep"],
          description: "Research depth: 'quick' (3 queries) or 'deep' (8 queries). Default: deep",
          default: "deep",
        },
      },
      required: ["question", "workDir"],
    },
  },
  {
    name: "discover",
    description: "Start feature discovery phase. Agents autonomously analyze the codebase and propose new features. Returns prioritized feature list.",
    inputSchema: {
      type: "object",
      properties: {
        workDir: {
          type: "string",
          description: "Working directory to analyze. Agents will explore this codebase and propose features.",
        },
        maxIterations: { type: "number", description: "Maximum discovery iterations (default: 3)", default: 3 },
      },
      required: ["workDir"],
    },
  },
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
  {
    name: "canvas_server_start",
    description: "Start WebSocket server for real-time canvas updates. Clients connect via ws://localhost:19800/ws?workDir=/path",
    inputSchema: {
      type: "object",
      properties: {
        port: { type: "number", description: "WebSocket server port (default: 19800)" },
      },
    },
  },
  {
    name: "canvas_server_stop",
    description: "Stop WebSocket server for canvas updates",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "canvas_server_status",
    description: "Get WebSocket server status and connected clients",
    inputSchema: { type: "object", properties: {} },
  },
];

// Combine with canvas tools
const allTools: Tool[] = [...tools, ...canvasAllTools];

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
  { name: "gumploop", version: "2.9.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "research": {
        const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
        const question = typeof obj.question === "string" ? obj.question : undefined;
        const workDir = typeof obj.workDir === "string" ? obj.workDir : undefined;
        const depth = (obj.depth === "quick" || obj.depth === "deep" ? obj.depth : "deep") as ResearchDepth;
        if (!question) throw new Error("question parameter is required");
        if (!workDir) throw new Error("workDir parameter is required");
        const result = await executeResearch(question, depth, workDir);
        return { content: [{ type: "text", text: result.result }] };
      }
      case "discover": {
        const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
        const workDir = typeof obj.workDir === "string" ? obj.workDir : undefined;
        const maxIterations = typeof obj.maxIterations === "number" ? obj.maxIterations : 3;
        if (!workDir) throw new Error("workDir parameter is required");
        const result = await executeDiscovery(maxIterations, workDir);
        return { content: [{ type: "text", text: result.result }] };
      }
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
      // Canvas WebSocket server tools
      case "canvas_server_start": {
        const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
        const port = typeof obj.port === "number" ? obj.port : 19800;
        if (broadcaster.isRunning()) {
          return { content: [{ type: "text", text: "WebSocket server already running" }] };
        }
        // Wire up state manager to broadcaster
        stateManager.setOnStateChange((workDir, state) => {
          broadcaster.broadcastToTenant(workDir, state);
        });
        broadcaster.start();
        return { content: [{ type: "text", text: `Canvas WebSocket server started on port ${port}` }] };
      }
      case "canvas_server_stop": {
        broadcaster.stop();
        return { content: [{ type: "text", text: "Canvas WebSocket server stopped" }] };
      }
      case "canvas_server_status": {
        const running = broadcaster.isRunning();
        const tenants = broadcaster.getTenants();
        const count = broadcaster.getConnectionCount();
        return {
          content: [{
            type: "text",
            text: `WebSocket Server: ${running ? "Running" : "Stopped"}\nConnections: ${count}\nTenants: ${tenants.length > 0 ? tenants.join(", ") : "None"}`,
          }],
        };
      }
      default: {
        // Check if it's a canvas tool
        if (name.startsWith("canvas_") || name.startsWith("kanban_")) {
          return await handleCanvasTool(name, args);
        }
        // Check if it's a pipeline visualization tool
        if (name.startsWith("pipeline_") || name.startsWith("agent_") || name.startsWith("consensus_") || name.endsWith("_gumploop") || name === "full_pipeline_dashboard") {
          return await handlePipelineTool(name, args);
        }
        throw new Error(`Unknown tool: ${name}`);
      }
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
  console.error("Gumploop MCP v2.9.0 running on stdio - Run Forrest Run!");
}
