import type { ChannelShape, EventShape } from '../../contracts/plugin';

// Every agent harness a session can run in; the relay hello's parse reads a
// harness missing from this list as none.
export const HARNESSES = ['claude', 'codex'] as const;

// The agent harness a session runs in.
export type Harness = (typeof HARNESSES)[number];

// What a drive action connects a fixture session with when its caller leaves
// a field out, and the harnesses its caller may name.
export const DRIVE_SESSION_DEFAULTS = {
  harnesses: HARNESSES,
  projectDir: 'drive',
  harness: 'claude',
  deadlineSeconds: null,
} as const satisfies {
  harnesses: readonly Harness[];
  projectDir: string;
  harness: Harness;
  deadlineSeconds: null;
};

// What a form source knows about the session it serves.
export interface SessionInfo {
  sessionId: string | null;
  projectDir: string | null;
  // The host's soft deadline; null means the default.
  deadlineSeconds: number | null;
  // Null when the relay did not say, or named a harness the app does not know.
  harness: Harness | null;
}

// A tool a form source exposes, as MCP `tools/list` describes it.
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
  // Absent reads as null, as does a harness the app does not know.
  harness?: string | null;
}

// The app's one-line answer to a hello; MCP follows only after `ok: true`.
export type RelayHelloReply = { ok: true } | { ok: false; error: string };

// `~/.agents/<instance id>/endpoint.json`.
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

// A session the app started itself. `end` ends its tool sessions and removes
// its row; a second call does nothing.
export interface OwnedSession {
  session: AgentSession;
  end(): void;
}

// `select` false opens a session in the background: its row is added unmarked
// and the selected row stays as it was.
export interface OpenOptions {
  select: boolean;
}

export interface SessionsMainExports {
  // A contribution reaches only sessions that connect after it, so a plugin
  // contributes during its start. Throws on a tool name another contribution
  // already holds, or one this contribution lists twice.
  contributeTools(
    tools: ToolDefinition[],
    start: (session: AgentSession) => ToolSession,
  ): void;
  // Adds the session's row, unmarked and unselected, or joins the owned session
  // whose host id the info carries, adding no row. A newer relay for that host
  // id takes the join from an older one still connected; the older handle's
  // `end` then leaves the join alone.
  connect(info: SessionInfo): ConnectedSession;
  // Starts an owned session with its row selected, or, with `options.select`
  // false, added unmarked and the selected row (or none) left as it was.
  // Throws when `info.sessionId` is null or any session already holds that
  // host id.
  open(info: SessionInfo, options?: OpenOptions): OwnedSession;
  // Attention for the session: selects its row when none is selected, else
  // marks it; a row the user closed comes back at the end first.
  mark(sessionId: string): void;
  activate(sessionId: string): void;
  selectedSessionId(): string | null;
  // The user closing a session's row asks every guard first, and the row stays
  // while any answers false; once every guard allows, the row goes and
  // `closed` is emitted. A session that ends loses its row regardless.
  addCloseGuard(mayClose: (sessionId: string) => boolean): void;
}

// `closed` is the user closing a row every guard allowed; the session itself
// stays until it ends. `selected` is the selected row changing, to another row
// or to none, emitted after the state that carries it: an open that selects,
// an activate or mark that selects, or the selected row closing or ending.
export interface SessionsMainEvents extends EventShape {
  connected: AgentSession;
  ended: { sessionId: string };
  closed: { sessionId: string };
  selected: { sessionId: string | null };
}

// One connected session's sidebar row. `marked` is a form not yet opened;
// `projectDir`, `hostSessionId` and `harness` are the session's info, fixed at
// connect.
export interface SessionRow {
  sessionId: string;
  label: string;
  harness: Harness | null;
  marked: boolean;
  projectDir: string | null;
  hostSessionId: string | null;
}

export interface SessionsState {
  rows: SessionRow[];
  selectedSessionId: string | null;
}

// `closeSession` returns whether the row closed: false when a close guard kept
// it or main holds no such row; the session stays connected either way.
// `activated` arrives before the `stateChanged` the activation causes.
export interface SessionsChannel extends ChannelShape {
  invoke: {
    state(): SessionsState;
    activate(sessionId: string): void;
    closeSession(sessionId: string): boolean;
  };
  messages: { stateChanged: SessionsState; activated: { sessionId: string } };
}

// The page part's exports and events.

// A tab a plugin adds to a session. `beforeClose` returns whether the session
// may close now; false keeps it. `shown` runs each time this tab becomes the
// visible tab: the selected tab of the selected session while Sessions mode
// shows. Its plugin sets its base key scope there. `shown` may run inside
// `addTab`, before its handle returns, so it must not read that handle.
export interface SessionTabView {
  id: string;
  title: string;
  element: HTMLElement;
  beforeClose(): boolean;
  shown(): void;
}

// `setStatus` sets the tab's line in its session's sidebar row. `select`
// selects the tab inside its session, never changing the selected session.
// `takeOver` selects the tab inside its session and returns a release; the
// first release selects the tab selected before the take over, unless a tab
// was selected since (by the user or `select`, even back to this one), another
// tab's take over holds the session, or that tab is gone. `isVisible` reads,
// at the moment of the call, whether this tab is the visible tab. Each call on
// a tab already dropped does nothing.
export interface SessionTabHandle {
  setStatus(status: string): void;
  select(): void;
  takeOver(): { release(): void };
  remove(): void;
  isVisible(): boolean;
}

// `addTab` attaches the tab's element before returning and selects the tab
// when it is the session's first; it throws on a tab id the session already
// holds. A tab added before its session's row waits for the row. A session's
// tabs drop when its row leaves, and `sessionRemoved` says so.
export interface SessionsPageExports {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  selectedSessionId(): string | null;
  activate(sessionId: string): void;
  // Asks each of the session's tabs `beforeClose`, then asks main to close it.
  closeSession(sessionId: string): void;
}

// `sessionAdded` fires once for every row main sends, the rows present at
// start included, and `sessionRemoved` once when that row leaves.
export interface SessionsPageEvents extends EventShape {
  activeChanged: { sessionId: string | null };
  sessionAdded: {
    sessionId: string;
    projectDir: string | null;
    harness: Harness | null;
    hostSessionId: string | null;
  };
  sessionRemoved: { sessionId: string };
}
