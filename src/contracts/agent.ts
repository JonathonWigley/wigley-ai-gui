// The MCP tool that answers a harness's permission prompts, served to every
// session by the app's MCP server. Claude Code names a plugin's MCP tool
// `mcp__plugin_<plugin>_<server>__<tool>`: the server is `wigley-forms` in the
// marketplace's `wigley` plugin.
export const PERMISSION_TOOL_NAME = 'permission_prompt';
export const CLAUDE_PERMISSION_TOOL = `mcp__plugin_wigley_wigley-forms__${PERMISSION_TOOL_NAME}`;

export interface ControlChoice {
  value: string;
  label: string;
}
// A setting of a running session the harness declares; `value` is null until the harness reports it.
export interface SessionControl {
  id: string;
  label: string;
  choices: ControlChoice[];
  value: string | null;
}

export type ProcessActivity = 'idle' | 'working' | 'waiting';

// `id` is unique within its session; an entry sent again with the same id replaces the earlier one.
// `raw` holds the harness events the entry was built from, oldest first.
export type ChatEntry =
  | { kind: 'user'; id: string; text: string; raw: unknown[] }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'thinking';
      id: string;
      text: string;
      streaming: boolean;
      raw: unknown[];
    }
  | {
      kind: 'tool';
      id: string;
      toolUseId: string;
      name: string;
      input: unknown;
      summary: string;
      result: { text: string; isError: boolean } | null;
      raw: unknown[];
    }
  | {
      kind: 'permission';
      id: string;
      toolName: string;
      input: unknown;
      answer: { allowed: boolean; reason: string | null } | null;
      raw: unknown[];
    }
  | {
      kind: 'result';
      id: string;
      stopReason: string;
      costUsd: number | null;
      durationMs: number | null;
      raw: unknown[];
    }
  | {
      kind: 'notice';
      id: string;
      text: string;
      tone: 'info' | 'error';
      raw: unknown[];
    }
  | { kind: 'raw'; id: string; raw: unknown[] };

export type ChatEntryKind = ChatEntry['kind'];

// `sessionId` is the host's session id: fresh for a new session, the old one when `resume` is true.
// `profileDir` is the harness's config folder (Claude's `CLAUDE_CONFIG_DIR`), null for the harness default.
export interface AgentStart {
  sessionId: string;
  resume: boolean;
  projectDir: string;
  profileDir: string | null;
}

// An event caused by `start` or by a call on the process arrives in a later
// microtask, never inside that call.
export interface AgentProcessEvents {
  entry(entry: ChatEntry): void;
  controls(controls: SessionControl[]): void;
  activity(activity: ProcessActivity): void;
  // The slash commands and skills the session offers, as typed after `/`; plan B reads it.
  commands(names: string[]): void;
  ended(end: { code: number | null; error: string | null }): void;
}

// `send`, `interrupt` and `setControl` throw after `end`. `setControl` also
// throws for a control or choice the harness did not declare, or when the
// harness cannot change that control now.
export interface AgentProcess {
  send(text: string): void;
  interrupt(): void;
  setControl(id: string, value: string): void;
  // Resolves once the process has exited, after `ended` has fired.
  end(): Promise<void>;
}

export interface AgentHarness {
  id: string;
  start(request: AgentStart, events: AgentProcessEvents): AgentProcess;
}
