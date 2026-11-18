import type { CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
  SelfTestStep,
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

// What a drive action connects a fixture session with when its caller leaves
// a field out.
export const DRIVE_SESSION_DEFAULTS: { projectDir: string; harness: string } = {
  projectDir: 'drive',
  harness: 'claude',
};

// The command each session row key runs.
const SESSION_STEP_COMMANDS = {
  '<A-S-o>': 'sessions.nextSession',
  '<A-S-i>': 'sessions.prevSession',
} as const;

// A self-test step to a session row however the rows draw: presses `key`
// again past each row on the way until the `until` line is logged, at most
// `max` presses. A press logs its command's line, the row's activation and the
// shown tab's line in one task. It steps rather than pressing a fixed count
// because rows opened together can tie on their stamps and earlier scripts can
// leave rows open, so the rows draw in no fixed order.
export function stepToSessionRow(
  key: keyof typeof SESSION_STEP_COMMANDS,
  until: string,
  max: number,
): SelfTestStep {
  return {
    keys: [key],
    expect: `[page] ${key} ran ${SESSION_STEP_COMMANDS[key]}`,
    repeat: { until, max },
    why: `${key} runs ${SESSION_STEP_COMMANDS[key]} and steps the rows until the session row this step wants is shown.`,
  };
}

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
  // The agent harness's id. Null when the relay did not say.
  harness: string | null;
  // The owned row a relay's hello names (`row_id`, the process's `WIGLEY_SESSION_ROW`); null when the hello names
  // none, and for every info a plugin builds itself.
  rowId: string | null;
  // The session's harness config folder, as `AgentStart` holds one, which a form
  // source has no use for; absent for the harness default.
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

// A hook hello's own protocol, so an app that knows no hook calls refuses one
// at once rather than opening a session for it.
export const HOOK_PROTOCOL = 2;

// The first line the relay sends, before any MCP message. Every other field
// is the host's own, and lands in `SessionInfo.host`. A hook hello carries
// HOOK_PROTOCOL and a string `hook`, and only it does: one request line
// follows, and the app answers it with one `HookReply` line and closes,
// opening no session.
export interface RelayHello {
  protocol: number;
  session_id: string | null;
  project_dir: string | null;
  // Absent reads as null.
  harness?: string | null;
  // Absent reads as null.
  config_dir?: string | null;
  // Absent reads as null.
  row_id?: string | null;
  // Absent reads as null.
  hook?: string | null;
  [field: string]: unknown;
}

// The app's one-line answer to a hello; MCP follows only after `ok: true`.
export type RelayHelloReply = { ok: true } | { ok: false; error: string };

// Answers one hook request from the session it came from; the request is the
// parsed request line, which the handler checks itself.
export type HookHandler = (
  session: AgentSession,
  request: unknown,
) => Promise<Record<string, unknown>>;

// The app's one-line answer to a hook hello and its request line.
export type HookReply =
  | { ok: true; reply: Record<string, unknown> }
  | { ok: false; error: string };

// `~/.agents/<instance id>/endpoint.json`.
export interface RelayEndpoint {
  protocol: number;
  // A Unix socket path (macOS) or a named pipe path (Windows).
  channel: string;
  launch: { command: readonly string[]; cwd: string };
  // The app's main process id.
  pid: number;
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
// its row; a second call does nothing. `setHostSessionId` gives a session
// opened with no host id its first one, or moves the session and its row to a
// new host id, keeping its app id, by changing `sessionId` inside the
// session's one info object, and emits `hostSessionChanged` either way. A
// first id retires nothing and keeps the relay's join. On a move the relay
// joined under the old id loses its join and has its later calls refused,
// and a relay saying hello with the old id is refused while the session
// lasts, unless another owned session holds that id. It throws when
// another session holds that host id and does nothing after `end`. `keep`
// hands the session to its owner's restart: it ends nothing, and its owner's
// stop no longer ends it; the next `open` naming its row id adopts it as it
// is, its row, relay join and tool sessions included, and one that no `open`
// adopts within 30 seconds ends then. After `keep` the handle does nothing.
export interface OwnedSession {
  session: AgentSession;
  end(): void;
  setHostSessionId(hostSessionId: string): void;
  keep(): void;
}

// `select` false opens a session in the background: its row is added unmarked
// and the selected row stays as it was. `rowId` is the id the session's row
// had before a restart of its owner or of sessions, or before a relaunch,
// which the row takes back, or the row of a session its owner kept, which the
// open adopts; left out, the row gets a new one. `owner` names the plugin the
// row belongs to (`practice`): such a row is never selected, whatever `select`
// says, and the Sessions page leaves it out of its side bar, its session step
// keys and its panes; the owner shows the session itself.
export interface OpenOptions {
  select: boolean;
  rowId?: string;
  owner?: string;
}

// What a mark asks the user: the page's toast reads `<text>`, or
// `<text> — <keys> to <action>` when keys show Sessions mode.
export interface MarkOptions {
  text: string;
  action: string;
}

// One tool call, as a tool-call guard sees it. `sessionId` is the app's own id (AgentSession.id).
export interface GuardedToolCall {
  readonly sessionId: string;
  readonly tool: string;
  readonly toolUseId: string | null;
  readonly mainAgentOnly: boolean;
  // True for a call `replayCalls` routes from a calls file; false for every live call.
  readonly replayed: boolean;
}

export type ToolCallVerdict =
  | { readonly kind: 'run' }
  | { readonly kind: 'skip'; readonly text: string };

export type ToolCallGuard = (call: GuardedToolCall) => Promise<ToolCallVerdict>;

// A tool's answer while the app is closed, and whether the call replays onto its row when the app adopts the run.
export interface OfflineAnswer {
  readonly result: ToolResult;
  readonly replay: boolean;
}

export interface ContributeToolsOptions {
  readonly mainAgentOnly?: boolean;
  // Each listed tool's offline answer, by tool name. A tool left out answers that it did not run, and does not replay.
  readonly offline?: Readonly<Record<string, OfflineAnswer>>;
}

// A project name for a session folder, or null when the namer names none.
export type ProjectNamer = (projectDir: string) => string | null;

// `changed()` re-asks every row's project; `dispose` removes the namer and
// re-asks every row without it.
export interface ProjectNamerHandle extends Disposable {
  changed(): void;
}

export interface SessionsMainExports {
  // Starts the contribution's tool session in every live session, and in each
  // session that connects later. The handle's `dispose` ends those tool
  // sessions and frees the tool names; a second `dispose` does nothing. Throws
  // on a tool name another contribution already holds, one this contribution
  // lists twice, or an `offline` key naming a tool this contribution does not
  // list. A `start` that throws for a live session ends the tool sessions
  // already started, leaves no contribution, and rethrows. `mainAgentOnly` true
  // marks each of the contribution's tools main-agent-only, which every
  // tool-call guard reads from the call; absent or false marks none. `offline`
  // joins the offline table written beside the tool list. The marks and the
  // offline answers go with the tool names when the handle disposes.
  contributeTools(
    tools: ToolDefinition[],
    start: (session: AgentSession) => ToolSession,
    options?: ContributeToolsOptions,
  ): Disposable;
  // Joins an owned session, or connects the session with no row, writing
  // none; `mark` or `activate` adds a connected session's row, and `release`
  // closes it. In order: an `info.rowId` naming an owned session joins it
  // while that session has no host id, `info.sessionId` is null or it equals
  // the session's host id; else an owned session holding `info.sessionId`
  // is joined; else a host id an owned session moved away from throws; else
  // the session connects as its own, keeping `info.rowId`. A row id naming a
  // connected session, or none, counts as none. A join takes the info's `host`
  // into the session's own info when it has one. A newer relay takes the join
  // from an older one still connected, whichever way each joined; the older
  // handle's `end` then leaves the join alone.
  connect(info: SessionInfo): ConnectedSession;
  // Starts an owned session with its row selected, or, with `options.select`
  // false, added unmarked and the selected row (or none) left as it was; with
  // `options.owner`, added unmarked and never selected. A null
  // `info.sessionId` opens the row with no host id, which its owner's
  // `setHostSessionId` sets later. Throws when any session already holds
  // `info.sessionId`, or one already holds `options.rowId`, except a session
  // its owner kept (`OwnedSession.keep`) under that row id, which it adopts:
  // no `connected` is emitted, and its host id moves to a non-null
  // `info.sessionId`. `info.rowId` is ignored: the row id is `options.rowId`.
  open(info: SessionInfo, options?: OpenOptions): OwnedSession;
  // Attention for the session: selects its row when none is selected, else
  // marks it; a connected session with no row, or a row the user closed, gets
  // its row at the end first. A row `release` closed while selected comes back
  // selected when this mark comes within 30 seconds of the release, unless in
  // between came an `activate`, a selecting `open`,
  // a mark that selected another session from none, or a `release` of another
  // selected row; the session's end drops it too. A mark that finds the row
  // unmarked stores its `options` as the row's `markToast`, and one that finds
  // it still marked keeps the toast there; an activate clears it. For a session
  // opened with an `owner`, `mark` is logged and adds no row, mark or
  // selection.
  mark(sessionId: string, options: MarkOptions): void;
  // The user's pick: selects the session's row and clears its mark; a
  // connected session with no row, or a row the user closed, gets its row at
  // the end first. A session opened with an `owner` is logged and ignored.
  activate(sessionId: string): void;
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
  // Every call of a contributed tool, from a connected session, an owned one or
  // its joined relay, asks each guard in registration order, one at a time,
  // awaiting each answer before asking the next; every guard sees every call,
  // whether or not its tool is main-agent-only. A call of a tool no
  // contribution holds rejects without asking any. The first `skip` resolves
  // the call with its text as a success, the handler not run and no later guard
  // asked; a guard that rejects makes the call reject with its error, the same
  // way. When every guard answers `run`, the handler runs, unless while the
  // guards answered the tool's contribution was disposed (rejects `Unknown
  // tool:`), the session ended (rejects `Session ended`), the session moved off
  // the host id a joined relay's call came under (rejects `moved from host`) or
  // the call's signal aborted (rejects with its reason). A guard disposed
  // while a call awaits it still decides that call; a guard disposed before
  // its turn in a call is not asked, and no later call asks it. Each call is
  // its own
  // registration, so one function added twice is asked twice until both
  // handles are disposed; a second `dispose` does nothing.
  addToolCallGuard(guard: ToolCallGuard): Disposable;
  // Stores the source's title, normalized, or clears it for null or a string
  // that normalizes to empty; checks no limit, which callers own. A changed
  // value writes the session's row when it has one and emits `titleChanged`
  // either way. A session not connected is logged and ignored.
  setTitle(sessionId: string, source: TitleSource, title: string | null): void;
  // A copy of the session's titles, kept while its row is closed; null for a
  // session not connected.
  titles(sessionId: string): SessionTitles | null;
  // Adds a namer for every row's project. A session with a folder takes the
  // name of the newest namer that answers non-null for it, namers asked newest
  // first and none after the first answer; a namer that throws is logged and
  // counts as null. With no name it takes its folder's origin repo name once
  // that lookup lands, else the folder's name. Adding asks nothing: the handle's
  // `changed()` re-asks every session, and its first `dispose` removes the
  // namer and re-asks every session; `changed()` after that does nothing. Each
  // call is its own registration, so one function added twice is two namers.
  addProjectNamer(namer: ProjectNamer): ProjectNamerHandle;
  // Answers each hook request named `name` with `handler`, given the live
  // session the hook hello names, found as `connect` finds the session it
  // joins; a hook opens no session. A handler that rejects answers the hook
  // with its error. Throws on a name another live registration holds. The
  // handle's `dispose` frees the name; a second `dispose` does nothing.
  addHookHandler(name: string, handler: HookHandler): Disposable;
  // The session's project, as its row shows it, also for a connected session
  // with no row; null for a session not connected. It can change at a namer's
  // `changed()` and when the origin lookup lands, so a caller reads it at each
  // use.
  project(sessionId: string): string | null;
  // Holds each relay's connect until `until` settles, up to a bound, so a
  // relaunched relay joins the row a plugin is about to open rather than
  // opening its own. Only a relay's hello waits: a hook hello and `connect`
  // do not.
  holdConnects(until: Promise<unknown>): void;
  // The environment a run the host may start while the app is closed carries: `WIGLEY_FORMS_OFFLINE` set to the
  // calls folder. Empty in the self-test, which writes no endpoint files.
  offlineEnv(): Readonly<Record<string, string>>;
  // Routes each replayable call the relay logged for `hostSessionId` to that session's tool sessions, in order,
  // through the guards, results dropped; then deletes the calls file. Resolves to the count routed; 0 with no file.
  // A main-agent-only call replays only once the row's tool callers are noted, which chat's `adopt` resolving
  // guarantees; before that it is skipped as a subagent's. Rejects when the claim or the read of the calls file fails
  // for any reason but a missing file; the file is then left on disk, and nothing replays it again.
  replayCalls(hostSessionId: string): Promise<number>;
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
// `hostSessionChanged` is an owned session given its first host id or moved
// to a new one, emitted after the row write that carries it, with the
// session's info already updated.
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
// `markToast` is the toast of the last mark that found the row unmarked, kept
// until an activate clears it;
// `projectDir`, `hostSessionId` and `harness` are the session's info, fixed
// when the session connects, `hostSessionId` also changed by the owner through
// `setHostSessionId`. `titles` are the
// session's titles, kept across a host id change.
export interface SessionRow {
  sessionId: string;
  label: string;
  // The session's project: the newest registered namer's name for its folder,
  // else the origin repo name of its folder, else the folder's name, else the
  // no-folder label. Re-asked at each namer's `changed()` and `dispose()` and
  // at the lookup's landing.
  project: string;
  harness: string | null;
  marked: boolean;
  markToast: MarkOptions | null;
  projectDir: string | null;
  hostSessionId: string | null;
  titles: SessionTitles;
  // The session's config folder as its harness resolves it, fixed at connect;
  // null when the app runs no such harness.
  profileDir: string | null;
  // The plugin the row belongs to, fixed at `open`; null for every other row.
  owner: string | null;
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
// out, it is false. `beforeClose` answers whether the session may close now,
// false keeping it, for what only the page knows or must ask; a promise
// answers once the tab has asked the user (chat's end-session confirm).
// `atOnce` is true when the user's close key runs while any of the session's
// tabs or popups closes at once, and on an agent's targeted `closeSession`
// run, which the user's Allow already confirmed. `shown` runs each time this
// tab becomes the visible tab: the selected tab of the focused chat pane's
// session while Sessions mode shows and that session has no open popup. Its
// plugin sets its base key scope there. `hidden` runs when it stops being the
// visible tab, the mode hiding or a popup opening over it included, before the
// next surface's `shown`; a tab removed first gets none. `shown` may run
// inside `addTab`, before its handle returns, so it must not read that handle.
// `order` places the tab in the strip, as `addTab` says.
export interface SessionTabView {
  id: string;
  title: string;
  icon: string;
  element: HTMLElement;
  order?: number;
  closesAtOnce?(): boolean;
  beforeClose(atOnce: boolean): boolean | Promise<boolean>;
  shown(): void;
  hidden?(): void;
}

// `select` selects the tab inside its session, never changing the selected
// session. `isVisible` reads, at the moment of the call, whether this tab is
// the visible tab. `dispose` removes the tab. Each call on a tab already
// dropped does nothing.
export interface SessionTabHandle extends Disposable {
  select(): void;
  isVisible(): boolean;
}

// A popup a plugin opens over a session's tabs while it has something for the
// user. The layout's `popup` part frames `element`; `title` and `icon`, a
// Codicon name, name it in the session's hidden bar. `beforeClose` answers
// whether the session may close now, false keeping it, asked after the tabs';
// `closesAtOnce` and `atOnce` are a tab's.
// `shown` runs each time this popup becomes the visible surface: the top open
// popup of the focused chat pane's session while Sessions mode shows. Its
// plugin sets its base key scope there and may move focus into the popup;
// sessions focuses nothing. `shown` may run inside `addPopup`, before its
// handle returns, so it must not read that handle.
export interface SessionPopupView {
  id: string;
  title: string;
  icon: string;
  element: HTMLElement;
  closesAtOnce?(): boolean;
  beforeClose(atOnce: boolean): boolean | Promise<boolean>;
  shown(): void;
}

// `setStatus` sets its entry's text in the session's hidden bar. `open` makes
// it the session's top open popup, and does nothing while it already is; `hide`
// hides it, the bar listing it. `isVisible` reads, at the moment of the call,
// whether this popup is the visible surface. `dispose` removes it. Each call
// on a popup already dropped does nothing.
export interface SessionPopupHandle extends Disposable {
  setStatus(status: string): void;
  open(): void;
  hide(): void;
  isVisible(): boolean;
}

// A session's place, as a page reload finds it: the selected tab, how many
// times the user's picks changed the selection, and the ids of its hidden
// popups.
export interface SessionsPlace {
  selectedTabId: string | null;
  selections: number;
  hiddenPopupIds: string[];
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

// A side bar section another plugin registers, drawn after Favorites and
// Recent: its label over the rows it claims, with no project groups.
export interface SidebarSection {
  id: string; // unique among registered sections
  label: string; // the section header's text
  order: number; // sections sort by order after Favorites and Recent
  claims(row: SessionRow): boolean;
  header?: SectionPart; // drawn at the header's end
}

// What a section draws at its header's end: `build` draws into `parent`, its
// own wrapper; the returned `dispose` runs before the side bar draws again.
export interface SectionPart {
  build(parent: HTMLElement): { dispose?(): void };
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
// `addPopup` attaches the popup's element before returning and opens it: it
// becomes the session's top open popup, over whichever popups were open or
// hidden. A `restored` popup, one whose content the last page showed, comes
// back hidden instead when the last page's place (`sessionsPlaceSlot`) had it
// hidden. It throws on a popup id the session already holds. A popup added
// before its session's row waits for the row, and a session's popups drop with
// its row, as its tabs do.
// `addRowPart` adds a part under every session
// row, `addBarPart` one in every session's tab bar. Each throws on a part id
// already added to its surface; adding a part and disposing its `Disposable`
// each redraw that surface: the rows or the tab bars. A row part shares one
// line: its wrapper keeps its content's width, an empty wrapper takes no room,
// and a part may set its own wrapper's `order`; the default layout puts the
// parts ordered 2 and later on a line of their own. A part
// whose content can be long sets `flex: 0 1 auto; min-width: 0` on its wrapper,
// `.session-row-part[data-part='<id>']`. `setActivity` sets the
// activity `sourceId` (one per plugin or tab) holds for the session, null
// removing it; the row shows the highest-ranked one, the latest set winning a
// tie, and redraws only when that changed. An activity set before the
// session's row arrives shows once it does; a row leaving drops its
// activities, and every page load starts with none.
// `addSection` registers a side bar section; it throws `section id <id> is
// reserved` for `favorites` or `recent`, and `part <id> is already added` on
// an id another registered section holds. On each side bar draw every
// section's `claims` is asked of every row with no owner: a claimed row leaves
// its project group and draws in the section, newest first; a row two sections
// claim goes to the lower `order`, a tie to the section registered first, and a
// `claims` that throws counts as false and is logged. The sections that claim
// a row draw after Recent, by `order`, a tie in registration order; one that
// claims none draws nothing. A row a section claims is never where main's
// selection lands after a close (`sessionsClaimedSlot`), unless `showOnly`
// shows that section. Adding a
// section and disposing its `Disposable` each redraw the side bar. `header`
// builds on each side bar draw, so a header whose content changes between
// draws redraws into its own wrapper itself.
// `showOnly`: while held, the side bar draws only that section — its header
// and its rows — and the list cursor, the next/previous session keys and the
// selection after a close move only among those rows. The latest holder wins;
// disposing it shows what the previous holder asked for, or every section.
// While a section shows alone, only its own `claims` decides its rows: a row
// another section also claims still draws in it. A section id no section
// registered gives an empty side bar.
export interface SessionsPageExports {
  addTab(sessionId: string, tab: SessionTabView): SessionTabHandle;
  addPopup(
    sessionId: string,
    popup: SessionPopupView,
    options?: { restored?: boolean },
  ): SessionPopupHandle;
  // The text cut to `sessions.titleMaxLength` with an ellipsis when longer, for
  // another plugin's short title.
  cutToTitleLimit(text: string): string;
  addRowPart(part: SessionPart): Disposable;
  addBarPart(part: SessionPart): Disposable;
  addSection(section: SidebarSection): Disposable;
  showOnly(sectionId: string): Disposable;
  activate(sessionId: string): void;
  // Asks each of the session's tabs `beforeClose(false)` in turn, then its
  // popups, waiting on a promise's answer and asking too a tab or popup added
  // meanwhile, then asks main to close it, which a close guard refuses with the
  // reason the page toasts; never cancels what a guard holds, as the user's
  // close key does. Resolves to true once the row closed; false when a tab, a
  // popup or main kept it, or the ask to main failed (logged).
  closeSession(sessionId: string): Promise<boolean>;
  // The focused pane's session while Sessions mode shows, the session the
  // close, rename, stash and workflow keys act on; null while the mode is
  // hidden or the pane is empty.
  shownSessionId(): string | null;
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

// Each session's place, by the session id, written on each change to its tabs,
// their selection or which of its popups are hidden; a row leaving deletes its
// key. Restores belong to a restore window, which a page load or a live start
// opens: once the window of the sessions page part's start settles, the part
// deletes the keys of rows main does not hold, the rows that ended while no
// page ran.
export const sessionsPlaceSlot: KeyedSlotKey<
  SessionsPlace,
  'page',
  'sessions'
> = { id: 'sessions.place', process: 'page', kind: 'keyed' };

// Main's rows, keyed by each row's `sessionId`, in the order main added them. In
// one list operation main writes every row, then the selection, then emits its
// events, all in one synchronous block. A row's `label` (`gamma 2`) is fixed for
// its life. It holds rows with an owner too; the Sessions page leaves them out.
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

// The rows main's post-close selection skips, by sessionId, as the side bar's
// last draw found them: with no `showOnly` held, the rows a registered side
// bar section claims; while one is held, every row the side bar does not draw.
// [] before the first draw and at each page start.
export const sessionsClaimedSlot: SlotKey<
  readonly string[],
  'page',
  'sessions'
> = {
  id: 'sessions.claimed',
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
