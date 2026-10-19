import type { ChannelShape, EventShape } from '../../contracts/plugin';

// What a round source knows about the session it serves.
export interface SessionInfo {
  sessionId: string | null;
  projectDir: string | null;
  // The host's soft deadline; null means the default.
  deadlineSeconds: number | null;
}

// A tool a round source exposes, as MCP `tools/list` describes it.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const RELAY_PROTOCOL = 1;

// The first line the relay sends, before any MCP message.
export interface RelayHello {
  protocol: number;
  session_id: string | null;
  project_dir: string | null;
  deadline_seconds: number | null;
}

// The app's one-line answer to a hello; MCP follows only after `ok: true`.
export type RelayHelloReply = { ok: true } | { ok: false; error: string };

// `~/.agents/wigley-ai-gui/endpoint.json`.
export interface RelayEndpoint {
  protocol: number;
  // A Unix socket path (macOS) or a named pipe path (Windows).
  channel: string;
  launch: { command: string[]; cwd: string };
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// `toolUseId` is the host's id for the calling tool use, when it sent one.
export interface ToolCallContext {
  toolUseId: string | null;
  signal: AbortSignal;
}

export interface ToolSession {
  call(
    name: string,
    args: unknown,
    context: ToolCallContext,
  ): Promise<ToolResult>;
  end(): void;
}

// `id` is the app's own id for the session; `info.sessionId` is the host's.
export interface AgentSession {
  id: string;
  info: SessionInfo;
}

export interface ConnectedSession extends ToolSession {
  session: AgentSession;
}

export interface SessionsMainExports {
  // A contribution reaches only sessions that connect after it, so a plugin
  // contributes during its start. Throws on a tool name another contribution
  // already holds, or one this contribution lists twice.
  contributeTools(
    tools: ToolDefinition[],
    start: (session: AgentSession) => ToolSession,
  ): void;
  connect(info: SessionInfo): ConnectedSession;
  showTab(sessionId: string): void;
  activate(sessionId: string): void;
  // The user closing a session's tab asks every guard first, and the tab stays
  // while any answers false; a session that ends loses its tab regardless.
  addCloseGuard(mayClose: (sessionId: string) => boolean): void;
}

export interface SessionsMainEvents extends EventShape {
  connected: AgentSession;
  ended: { sessionId: string };
}

export interface SessionTab {
  sessionId: string;
  label: string;
  marked: boolean;
}

export interface SessionsState {
  tabs: SessionTab[];
  activeSessionId: string | null;
}

export interface SessionsChannel extends ChannelShape {
  invoke: {
    state(): SessionsState;
    activate(sessionId: string): void;
    closeTab(sessionId: string): void;
  };
  messages: { stateChanged: SessionsState };
}

// The page part's exports and events.

// `beforeClose` returns whether the tab may close now; false keeps it open.
export interface SessionView {
  element: HTMLElement;
  title: string;
  beforeClose(): boolean;
}

export interface SessionsPageExports {
  fill(
    sessionId: string,
    view: SessionView,
  ): { setTitle(title: string): void; remove(): void };
  activeSessionId(): string | null;
  activate(sessionId: string): void;
  closeTab(sessionId: string): void;
}

export interface SessionsPageEvents extends EventShape {
  activeChanged: { sessionId: string | null };
}
