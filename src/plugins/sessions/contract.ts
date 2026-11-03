import type { Disposable } from '../../contracts/disposable';
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
// its row; a second call does nothing. `setHostSessionId` moves the session
// and its row to a new host id, keeping its app id, by changing `sessionId`
// inside the session's one info object, and emits `hostSessionChanged`. The
// relay joined under the old id loses its join and has its later calls
// refused, and a relay saying hello with the old id is refused while the
// session lasts, unless another owned session holds that id. It throws when
// another session holds that host id and does nothing after `end`.
export interface OwnedSession {
  session: AgentSession;
  end(): void;
  setHostSessionId(hostSessionId: string): void;
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
  // Connects the session with no row, sending no state, or joins the owned
  // session whose host id the info carries; `mark` or `activate` adds a
  // connected session's row, and `release` closes it. A newer relay for that host
  // id takes the join from an older one still connected; the older handle's
  // `end` then leaves the join alone. Throws for a host id an owned session
  // moved away from, unless another owned session holds it.
  connect(info: SessionInfo): ConnectedSession;
  // Starts an owned session with its row selected, or, with `options.select`
  // false, added unmarked and the selected row (or none) left as it was.
  // Throws when `info.sessionId` is null or any session already holds that
  // host id.
  open(info: SessionInfo, options?: OpenOptions): OwnedSession;
  // Attention for the session: selects its row when none is selected, else
  // marks it; a connected session with no row, or a row the user closed, gets
  // its row at the end first.
  mark(sessionId: string): void;
  // Selects the session's row and clears its mark; a connected session with
  // no row, or a row the user closed, gets its row at the end first.
  activate(sessionId: string): void;
  // Closes a connected session's row once every close guard allows, emitting
  // `closed`; a guard refusing keeps the row and logs. An unknown or owned
  // session, or one with no row, is left alone without a log line.
  release(sessionId: string): void;
  selectedSessionId(): string | null;
  // The session's side-bar label (`gamma 2`), kept while its row is closed;
  // null for a session not connected.
  label(sessionId: string): string | null;
  // The user closing a session's row, or `release`, asks every guard first,
  // and the row stays while any answers false; once every guard allows, the row goes and
  // `closed` is emitted. A session that ends loses its row regardless.
  addCloseGuard(mayClose: (sessionId: string) => boolean): void;
}

// `closed` is a row the user closed, or one `release` closed, every guard
// allowing; the session itself stays until it ends. `selected` is the selected row changing, to another row
// or to none, emitted after the state that carries it: an open that selects,
// an activate or mark that selects, or the selected row closing or ending.
// `hostSessionChanged` is an owned session moved to a new host id, emitted
// after the state that carries it, with the session's info already updated.
export interface SessionsMainEvents extends EventShape {
  connected: AgentSession;
  ended: { sessionId: string };
  closed: { sessionId: string };
  selected: { sessionId: string | null };
  hostSessionChanged: AgentSession;
}

// One session's sidebar row; a connected session's row exists only while
// marked, activated or holding a form. `marked` is a form not yet opened;
// `projectDir`, `hostSessionId` and `harness` are the session's info, fixed
// when the session connects, `hostSessionId` also changed by the owner through
// `setHostSessionId`.
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

// A tab a plugin adds to a session. The tab bar draws its `icon`, a Codicon
// name, with `title` as its tooltip and accessible name. `beforeClose` returns
// whether the session may close now; false keeps it. `shown` runs each time
// this tab becomes the visible tab: the selected tab of the focused chat pane's
// session while Sessions mode shows. Its plugin sets its base key scope there.
// `shown` may run inside `addTab`, before its handle returns, so it must not
// read that handle.
export interface SessionTabView {
  id: string;
  title: string;
  icon: string;
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

// A part another plugin draws for every session on a sessions surface: under
// each session row, or in each session's tab bar. `build` draws into `parent`,
// its own wrapper on that surface; the returned `dispose` runs before the
// surface draws again and when it leaves. A part that throws is logged and
// draws nothing; the surface still draws. Sessions builds a part only when its
// surface draws: a row on each side-bar draw, a tab bar once per session, per
// sessions layout set and per bar part added or removed. A part whose content
// changes between those draws redraws into its wrapper itself.
export interface SessionPart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };
}

// `addTab` attaches the tab's element before returning and selects the tab
// when it is the session's first; it throws on a tab id the session already
// holds. A tab added before its session's row waits for the row. A session's
// tabs drop when its row leaves, and `sessionRemoved` says so.
// `selectedSessionId` is the focused chat pane's session, null for an empty
// pane, not main's selection. `addRowPart` adds a part under every session
// row, `addBarPart` one in every session's tab bar. Each throws on a part id
// already added to its surface; adding a part and disposing its `Disposable`
// each redraw that surface: the rows or the tab bars.
export interface SessionsPageExports {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  addRowPart(part: SessionPart): Disposable;
  addBarPart(part: SessionPart): Disposable;
  selectedSessionId(): string | null;
  activate(sessionId: string): void;
  // Asks each of the session's tabs `beforeClose`, then asks main to close it.
  closeSession(sessionId: string): void;
}

// `activeChanged` fires when the focused chat pane's session changes, to
// null for an empty pane. `sessionAdded` fires once for every row main sends,
// the rows present at start included, carrying the row's `label` as the side
// bar shows it (`gamma 2`), fixed for the row's life, and `sessionRemoved`
// once when that row leaves. `sessionHostChanged` fires when a kept row's host
// id changes, after the `sessionAdded` and `sessionRemoved` events of the same
// state.
export interface SessionsPageEvents extends EventShape {
  activeChanged: { sessionId: string | null };
  sessionAdded: {
    sessionId: string;
    label: string;
    projectDir: string | null;
    harness: Harness | null;
    hostSessionId: string | null;
  };
  sessionRemoved: { sessionId: string };
  sessionHostChanged: { sessionId: string; hostSessionId: string | null };
}
