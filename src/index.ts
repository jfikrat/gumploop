// Re-exports for testing
export { generateRequestId } from "./constants";
export { sanitizeSessionName, getWorkDirHash } from "./workspace";
export { validateWorkDir, getProjectDir, getPipelineDir, getPipelineFiles } from "./workdir";
export { safeJsonParse, isValidState, defaultState, getStateFile, loadState, saveState } from "./state";
export { TmuxAgent } from "./tmux-agent";
export type { AgentType, PipelineState } from "./types";

// Re-export tools for external use
export { tools, startServer } from "./mcp-server";

// Main entry point
import { startServer } from "./mcp-server";

startServer().catch(console.error);
