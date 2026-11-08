import type { CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type {
  KeyedSlotKey,
  KeyedSlotReader,
  SlotKey,
} from '../../contracts/state';
import { callEach } from '../../shared/call-each';

// Activates the session whose id is the arg and closes the side bar's overlay,
// as a click on its row does.
export const sessionsSelectRowCommand: CommandKey<
  string,
  'sessions.selectRow'
> = {
  id: 'sessions.selectRow',
};

// Shows tab `tab` of session `sessionId`, as a click on the tab does.
export const sessionsSelectTabCommand: CommandKey<
  { sessionId: string; tab: string },
  'sessions.selectTab'
> = { id: 'sessions.selectTab' };

// Favorites or unfavorites the project whose key is the arg, as a click on its
// group's star does.
export const sessionsFavoriteProjectAtCommand: CommandKey<
  string,
  'sessions.favoriteProjectAt'
> = { id: 'sessions.favoriteProjectAt' };

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
} as const satisfies {
  harnesses: readonly Harness[];
  projectDir: string;
  harness: Harness;
};

// Every source a session title comes from, in the order the row prefers them:
// the user's rename, the agent's `set_session_title`, the first message.
export const TITLE_SOURCES = ['user', 'agent', 'firstMessage'] as const;

export type TitleSource = (typeof TITLE_SOURCES)[number];

// A session's title from each source, each normalized; null where that source
// set none.
export type SessionTitles = Record<TitleSource, string | null>;

// The title a rename starts from, uncut; empty when no source set one.
export function editableTitle(titles: SessionTitles): string {
  return titles.user ?? titles.agent ?? titles.firstMessage ?? '';
}

// What a session's host and its starter say of it.
export interface SessionInfo {
  sessionId: string | null;
  projectDir: string | null;
  // Null when the relay did not say, or named a harness the app does not know.
  harness: Harness | null;
  // A connected session's harness config folder, as `AgentStart` holds one, which
  // a form source has no use for; absent for the harness default.
  profileDir?: string;
  // Every relay hello field sessions does not read, as the host sent it, for
  // the plugins that know the host; absent when there are none.
  host?: Readonly<Record<string, unknown>>;
  // The row's label in place of the folder's name, numbered as that would be.
  label?: string;
}

// A tool a form source exposes, as MCP `tools/list` describes it.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const RELAY_PROTOCOL = 1;

// The first line the relay sends, before any MCP message. Every other field
// is the host's own, and lands in `SessionInfo.host`.
export interface RelayHello {
  protocol: number;
  session_id: string | null;
  project_dir: string | null;
  // Absent reads as null, as does a harness the app does not know.
  harness?: string | null;
  // Absent reads as null.
  config_dir?: string | null;
  [field: string]: unknown;
}

// The app's one-line answer to a hello; MCP follows only after `ok: true`.
export type RelayHelloReply = { ok: true } | { ok: false; error: string };

// `~/.agents/<instance id>/endpoint.json`.
export interface RelayEndpoint {
  protocol: number;
  // A Unix socket path (macOS) or a named pipe path (Windows).
  channel: string;
  launch: { command: readonly string[]; cwd: string };
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
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

// What a mark asks the user: the page's toast reads `<text>`, or
// `<text> — <keys> to <action>` when keys show Sessions mode.
export interface MarkOptions {
  text: string;
  action: string;
}

export interface SessionsMainExports {
  // Starts the contribution's tool session in every live session, and in each
  // session that connects later. The handle's `dispose` ends those tool
  // sessions and frees the tool names; a second `dispose` does nothing. Throws
  // on a tool name another contribution already holds, or one this contribution
  // lists twice. A `start` that throws for a live session ends the tool sessions
  // already started, leaves no contribution, and rethrows.
  contributeTools(
    tools: ToolDefinition[],
    start: (session: AgentSession) => ToolSession,
  ): Disposable;
  // Connects the session with no row, writing none, or joins the owned
  // session whose host id the info carries; `mark` or `activate` adds a
  // connected session's row, and `release` closes it. A newer relay for that
  // host id takes the join from an older one still connected; the older
  // handle's `end` then leaves the join alone. Throws for a host id an owned
  // session moved away from, unless another owned session holds it.
  connect(info: SessionInfo): ConnectedSession;
  // Starts an owned session with its row selected, or, with `options.select`
  // false, added unmarked and the selected row (or none) left as it was.
  // Throws when `info.sessionId` is null or any session already holds that
  // host id.
  open(info: SessionInfo, options?: OpenOptions): OwnedSession;
  // Attention for the session: selects its row when none is selected, else
  // marks it; a connected session with no row, or a row the user closed, gets
  // its row at the end first. A row `release` closed while selected comes back
  // selected when this mark comes within 30 seconds of the release, unless in
  // between came an `activate` or `activateExistingRow`, a selecting `open`,
  // a mark that selected another session from none, or a `release` of another
  // selected row; the session's end drops it too. A row not yet selected keeps
  // the first mark's `options` as its `markToast` until an activate.
  mark(sessionId: string, options: MarkOptions): void;
  // The user's pick: selects the session's row and clears its mark; a
  // connected session with no row, or a row the user closed, gets its row at
  // the end first.
  activate(sessionId: string): void;
  // `activate` for a session that holds a row; adds none, and logs and
  // ignores a session with no row.
  activateExistingRow(sessionId: string): void;
  // Closes a connected session's row once every close guard allows, emitting
  // `closed`; a guard refusing keeps the row and logs. An unknown or owned
  // session, or one with no row, is left alone without a log line.
  release(sessionId: string): void;
  // The session's side-bar label (`gamma 2`), kept while its row is closed;
  // null for a session not connected.
  label(sessionId: string): string | null;
  // The user closing a session's row, or `release`, asks every guard first,
  // and the row stays while any answers a reason, the first of which the page
  // toasts; once every guard answers null, the row goes and `closed` is
  // emitted. The user's close key on a tab that closes at once first runs every
  // guard's `cancelHold`, which ends what the guard holds there. A session that
  // ends loses its row regardless. Each call is its own registration, which its
  // handle removes, so one function added twice keeps guarding until both
  // handles are disposed.
  addCloseGuard(
    mayClose: (sessionId: string) => string | null,
    cancelHold?: (sessionId: string) => void,
  ): Disposable;
  // Stores the source's title, normalized, or clears it for null or a string
  // that normalizes to empty; checks no limit, which callers own. A changed
  // value writes the session's row when it has one and emits `titleChanged`
  // either way. A session not connected is logged and ignored.
  setTitle(sessionId: string, source: TitleSource, title: string | null): void;
  // A copy of the session's titles, kept while its row is closed; null for a
  // session not connected.
  titles(sessionId: string): SessionTitles | null;
  // Holds each relay's connect until `until` settles, up to a bound, so a
  // relaunched relay joins the row a plugin is about to open rather than
  // opening its own. Only a relay's hello waits: `connect` does not.
  holdConnects(until: Promise<unknown>): void;
}

export const sessionsMainKey: DependencyKey<
  SessionsMainExports,
  'main',
  'sessions'
> = { id: 'sessions', process: 'main' };

// `owned` is true for a session `open` started, false for one `connect`
// connected.
export interface ConnectedSessionEvent extends AgentSession {
  owned: boolean;
}

// `closed` is a row the user closed, or one `release` closed, every guard
// allowing; the session itself stays until it ends.
// `hostSessionChanged` is an owned session moved to a new host id, emitted
// after the row write that carries it, with the session's info already updated.
// `titleChanged` is a session's titles changing, after the row write that carries
// them when the session has a row.
export interface SessionsMainEvents extends EventShape {
  connected: ConnectedSessionEvent;
  ended: { sessionId: string };
  closed: { sessionId: string };
  hostSessionChanged: AgentSession;
  titleChanged: { sessionId: string; titles: SessionTitles };
}

// One session's sidebar row; a connected session's row exists only while
// marked, activated or kept by a close guard. `marked` is attention a plugin
// asked for with `mark` and the user has not answered, cleared when selected;
// `markToast` is the first such mark's toast, kept until an activate clears it;
// `projectDir`, `hostSessionId` and `harness` are the session's info, fixed
// when the session connects, `hostSessionId` also changed by the owner through
// `setHostSessionId`. `titles` are the session's titles, kept across a host id
// change.
export interface SessionRow {
  sessionId: string;
  label: string;
  // The session's project: the origin repo name of its folder, else the
  // folder's name, else the no-folder label. Set to the fallback at connect and
  // changed once when the lookup lands.
  project: string;
  harness: Harness | null;
  marked: boolean;
  markToast: MarkOptions | null;
  projectDir: string | null;
  hostSessionId: string | null;
  titles: SessionTitles;
}

export interface SessionsState {
  rows: SessionRow[];
  selectedSessionId: string | null;
}

// `closeSession` returns the first close guard's reason for keeping the row,
// or null when the row closed, was already closed, or main knows no such
// session; the session stays connected either way. `atOnce` first runs every
// guard's `cancelHold`.
// `activate` returns whether it wrote the rows or the selection, which may reach
// the page after that reply. `activated` arrives before the writes the activation
// causes.
// `setUserTitle` sets the user title, a string that normalizes to empty or
// null clearing it; it throws a title past `sessions.titleMaxLength`.
export interface SessionsChannel extends ChannelShape {
  invoke: {
    activate(sessionId: string): boolean;
    closeSession(sessionId: string, atOnce: boolean): string | null;
    setUserTitle(sessionId: string, title: string | null): void;
  };
  messages: { activated: { sessionId: string } };
}

// The page part's exports and events.

// A tab a plugin adds to a session. The tab bar draws its `icon`, a Codicon
// name, with `title` as its tooltip and accessible name. `closesAtOnce` true
// means the user's close key ends what this tab holds with no prompt; left
// out, it is false. `beforeClose` returns whether the session may close now,
// false keeping it, for what only the page knows or must ask; `atOnce` is true
// when the user's close key runs while any of the session's tabs closes at
// once. `shown` runs each time this tab becomes the visible tab: the selected
// tab of the focused chat pane's session while Sessions mode shows. Its plugin
// sets its base key scope there. `hidden` runs when it stops being the visible
// tab, the mode hiding included, before the next tab's `shown`; a tab removed
// first gets none. `shown` may run inside `addTab`, before its handle returns,
// so it must not read that handle. `order` places the tab in the strip, as
// `addTab` says.
export interface SessionTabView {
  id: string;
  title: string;
  icon: string;
  element: HTMLElement;
  order?: number;
  closesAtOnce?(): boolean;
  beforeClose(atOnce: boolean): boolean;
  shown(): void;
  hidden?(): void;
}

// `select` selects the tab inside its session, never changing the selected
// session. `takeOver` selects the tab inside its session and returns a
// release; the release selects the tab selected before the take over, unless
// a tab was selected since (by the user or `select`, even back to this one),
// another tab's take over holds the session, or that tab is gone. A tab holds
// one take over: taking over again keeps the first. A release hands each later
// take over that remembered this tab the tab this one remembered, so chat
// selected, then form and docs taking over, then form and docs releasing,
// shows chat. `isVisible` reads, at the moment of the call, whether this tab
// is the visible tab. `dispose` releases the latest take over this handle gave
// out, then removes the tab. Each call on a tab already dropped does nothing.
export interface SessionTabHandle extends Disposable {
  select(): void;
  takeOver(): { release(): void };
  isVisible(): boolean;
}

// A part another plugin draws for every session on a sessions surface: under
// each session row, or in each session's tab bar. `build` draws into `parent`,
// its own wrapper on that surface; the returned `dispose` runs before the
// surface draws again and when it leaves. A part that throws is logged and
// draws nothing; the surface still draws. Sessions builds a part only when its
// surface draws: a row on each side-bar draw, a tab bar once per session, per
// sessions layout set and per bar part added or removed. A part whose content
// changes between those draws redraws into its wrapper itself. A row part's
// `tooltip` joins the row's tooltip, null adding nothing; it is read at each
// row draw and each time the pointer enters the row, so a change needs no
// redraw.
export interface SessionPart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };
  tooltip?(sessionId: string): string | null;
}

// The tones a row's activity shows in, the members of the page kit's
// `DotStatus`.
export type ActivityTone =
  | 'idle'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';

// What a session is doing, as one plugin sees it: the word its row and tooltip
// show and the `tone` of its label. Of a session's activities its row shows the
// one of highest `rank`. `emphasis` asks the row to catch the eye at a scan of
// the list: `raised` for a state the user may come to when ready, `urgent` for
// one blocked on the user. Left out, the row does not.
export interface RowActivity {
  word: string;
  tone: ActivityTone;
  rank: number;
  emphasis?: RowEmphasis;
}

export type RowEmphasis = 'raised' | 'urgent';

// Something waiting on the user: the one copy every source sets.
export const NEEDS_YOU_ACTIVITY: RowActivity = {
  word: 'needs you',
  tone: 'attention',
  rank: 40,
  emphasis: 'urgent',
};

// `addTab` attaches the tab's element before returning and selects the tab
// when it is the session's first; it throws on a tab id the session already
// holds. The strip holds tabs with an `order` first, lowest first, then the tabs
// with none; a tie keeps add order. A tab added before its session's row waits
// for the row. A session's tabs drop when its row leaves, and
// `sessionsRowsSlot`'s notice says so.
// `addRowPart` adds a part under every session
// row, `addBarPart` one in every session's tab bar. Each throws on a part id
// already added to its surface; adding a part and disposing its `Disposable`
// each redraw that surface: the rows or the tab bars. A row part shares one
// line that never wraps: its wrapper keeps its content's width, an empty
// wrapper takes no room, and a part may set its own wrapper's `order`. A part
// whose content can be long sets `flex: 0 1 auto; min-width: 0` on its wrapper,
// `.session-row-part[data-part='<id>']`. `setActivity` sets the
// activity `sourceId` (one per plugin or tab) holds for the session, null
// removing it; the row shows the highest-ranked one, the latest set winning a
// tie, and redraws only when that changed. An activity set before the
// session's row arrives shows once it does; a row leaving drops its
// activities, and every page load starts with none.
export interface SessionsPageExports {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  // The text cut to `sessions.titleMaxLength` with an ellipsis when longer, for
  // another plugin's short title.
  cutToTitleLimit(text: string): string;
  addRowPart(part: SessionPart): Disposable;
  addBarPart(part: SessionPart): Disposable;
  activate(sessionId: string): void;
  // Asks each of the session's tabs `beforeClose(false)`, then asks main to
  // close it, which a close guard refuses with the reason the page toasts;
  // never cancels what a guard holds, as the user's close key does.
  closeSession(sessionId: string): void;
  setActivity(
    sessionId: string,
    sourceId: string,
    activity: RowActivity | null,
  ): void;
}

export const sessionsPageKey: DependencyKey<
  SessionsPageExports,
  'page',
  'sessions'
> = { id: 'sessions', process: 'page' };

// `tabAdded`: a plugin's tab added to the session through `addTab`.
// `tabShown`: a tab became the visible tab, after its `shown`.
export interface SessionsPageEvents extends EventShape {
  tabAdded: { sessionId: string; tabId: string };
  tabShown: { sessionId: string; tabId: string };
}

// One source's activity for a session.
export interface RowActivitySource {
  sourceId: string;
  activity: RowActivity;
}

// Each session's activities from `setActivity`, by the session id, in last-set
// order: the highest rank shows, the latest set winning a tie. A session with no
// sources holds no key. Every page load starts with none, and each source sets
// its activity again.
export const sessionsActivitySlot: KeyedSlotKey<
  RowActivitySource[],
  'page',
  'sessions'
> = { id: 'sessions.activity', process: 'page', kind: 'keyed' };

// Main's rows, keyed by each row's `sessionId`, in the order main added them. In
// one list operation main writes every row, then the selection, then emits its
// events, all in one synchronous block. A row's `label` (`gamma 2`) is fixed for
// its life.
export const sessionsRowsSlot: KeyedSlotKey<SessionRow, 'main', 'sessions'> = {
  id: 'sessions.rows',
  process: 'main',
  kind: 'keyed',
};

// Main's selected row, null for none. On the page, a value naming no row means
// main deleted that row and this slot's write is on its way.
export const sessionsSelectionSlot: SlotKey<string | null, 'main', 'sessions'> =
  {
    id: 'sessions.selection',
    process: 'main',
    kind: 'value',
  };

// The focused chat pane's session, null for an empty pane; not main's selection.
// Null from each page load until the first panes are placed. A notice of the rows
// or the selection reaches readers before the `sessions.active` write it causes.
export const sessionsActiveSlot: SlotKey<string | null, 'page', 'sessions'> = {
  id: 'sessions.active',
  process: 'page',
  kind: 'value',
};

// Follows the rows as a reader's lifecycle: `added` runs once per row `rows`
// holds, in order, inside the call, then once per later new row; `removed` once
// when a row leaves; `hostChanged` when a kept row's host id changes. A change to
// any other field of a row calls nothing. A row deleted and set again calls
// `removed`, then `added`. A throw from a catch-up `added` skips no other row and
// reaches the caller once every row had its call, with the follow still live until
// the part stops.
export function followRows(
  rows: KeyedSlotReader<SessionRow>,
  handlers: {
    added?(row: SessionRow): void;
    removed?(sessionId: string): void;
    hostChanged?(row: SessionRow): void;
  },
): Disposable {
  const hostIds = new Map<string, string | null>();
  for (const [sessionId, row] of rows.all()) {
    hostIds.set(sessionId, row.hostSessionId);
  }
  const following = rows.on((sessionId, row) => {
    if (row === undefined) {
      hostIds.delete(sessionId);
      handlers.removed?.(sessionId);
      return;
    }
    const isNewRow = !hostIds.has(sessionId);
    const lastHostId = hostIds.get(sessionId);
    hostIds.set(sessionId, row.hostSessionId);
    if (isNewRow) {
      handlers.added?.(row);
    } else if (lastHostId !== row.hostSessionId) {
      handlers.hostChanged?.(row);
    }
  });
  callEach([...rows.all().values()], (row) => handlers.added?.(row));
  return following;
}
