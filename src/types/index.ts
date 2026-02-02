/**
 * Gumploop MCP Types
 */

export type AgentType = "claude" | "gemini" | "codex";

export interface I3Node {
  type?: string;
  num?: number;
  window?: number;
  nodes?: I3Node[];
  floating_nodes?: I3Node[];
}

export interface I3Workspace {
  num: number;
  name: string;
  focused: boolean;
}

export interface PipelineState {
  currentPhase: string | null;
  task: string;
  workDir: string;
  iteration: number;
  planningComplete: boolean;
  codingComplete: boolean;
  testingComplete: boolean;
  debuggingComplete: boolean;
  activeSessions: string[];
  lastUpdate: string;
}
