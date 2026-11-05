import type { ActiveTime } from '../../contracts/active-time';
import type {
  AccountStatus,
  AgentCommand,
  AgentEvent,
  ChatEntry,
  CompactionTrigger,
  PlanRowUpdate,
  ProcessActivity,
  SessionControl,
  UserMessage,
} from '../../contracts/agent';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type { KeyedSlotKey, ListSlotKey } from '../../contracts/state';
import type { SessionTitles } from '../sessions/contract';

// The `id` of the agent harness chat runs its sessions on: chat's profiles are
// that harness's config folders.
export const CHAT_HARNESS_ID = 'claude';

// The layout preview's row host session id; no harness holds a session by it.
export const CHAT_PREVIEW_HOST_ID = 'chat-layout-preview';

export interface ChatProfile {
  name: string;
  configDir: string;
}

export interface RecentFolder {
  projectDir: string;
  profile: string;
  lastUsed: number;
}

export interface StartRequest {
  projectDir: string;
  profile: string;
}

export interface LaunchRequest {
  projectDir: string;
  profile: string;
  message: UserMessage;
}

// `hostSessionId` is the harness's id for the saved session.
export interface PastSessionRow {
  hostSessionId: string;
  title: string;
  modified: number;
  archived: boolean;
}

// `title` is the saved session's title, which the new row takes as its
// first-message title.
export interface ResumeRequest {
  projectDir: string;
  profile: string;
  hostSessionId: string;
  title: string;
}

// A message sent while its session's turn ran, held by chat main until the
// turn ends or the user sends it now; `id` is unique within its session.
// `sentEntryId` is null while it waits, and once sent now the id of the user
// entry the agent adds when it takes the message in, which drops the row.
// `holdReason` is non-null on a held row, a send gate's reason: the row waits
// for its session's compaction and is written when the compaction ends. A
// session has at most one held row.
export interface QueuedMessage extends UserMessage {
  id: string;
  sentEntryId: string | null;
  holdReason: string | null;
}

// A compaction running in a session. `reason` is the send gate's reason for a
// compaction a hold started; null for any other.
export interface SessionCompaction {
  trigger: CompactionTrigger;
  reason: string | null;
  startedAt: number;
}

// What a send gate reads about a send to an idle session. `sessionId` is the
// row's id, `hostSessionId` the id its `agentEvent`s carry now, and `text` the
// message as the user wrote it.
export interface SendGateInput {
  sessionId: string;
  hostSessionId: string;
  text: string;
  now: number;
}

// `action: 'compact'` compacts the session before the send is written, and
// `reason` names why on the held row and the dock.
export interface SendGateVerdict {
  action: 'compact';
  reason: string;
}

// A rule run before chat main writes a message to an idle session; null lets
// the write go on.
export type SendGate = (input: SendGateInput) => SendGateVerdict | null;

// A saved session a resume section lists.
export interface ResumeSectionRow {
  hostSessionId: string;
  projectDir: string;
  profile: string;
  title: string;
  at: number;
}

// One section's answer; `rows` is never empty.
export interface ResumeSectionRows {
  title: string;
  rows: ResumeSectionRow[];
}

// A titled list of saved sessions at the top of the start prompt. `rows` is in
// list order: the last row sits next to the cursor. `isResumable` is false for
// a session chat holds, one open in the app on another row, and an archived one.
// The start prompt waits for `rows`, so a section that never settles holds it.
export interface ResumeSection {
  title: string;
  rows(
    isResumable: (hostSessionId: string) => boolean,
  ): Promise<ResumeSectionRow[]>;
}

// A message on its way back into its session's box; `id` is unique within the
// session.
export interface ReturnedMessage extends UserMessage {
  id: string;
}

// The small values of one session, whole in `chat.session` on each change.
// `sessionId` is the sessions plugin's id for the row. A session's row lasts
// until the user closes it, across a relaunch, where it comes back resting
// with its earlier conversation read again; a closed session's keys are
// deleted at once.
export interface ChatSessionInfo {
  sessionId: string;
  projectDir: string;
  profile: string;
  activity: ProcessActivity;
  // The subagents and background tasks still running in the session's
  // process; while any runs, a turn's end does not end the agent's work.
  background: number;
  // How long the agent has worked: it runs while `activity` is `working` or
  // `background` is above 0. A restored row starts paused at its saved total,
  // any other row at 0, and `/clear` resets it to 0. `since` is epoch ms on the
  // wall clock main and the page share, so the page reads it with `activeMsAt`.
  activeTime: ActiveTime;
  // True while the session's process runs; false while it rests, with no
  // process yet or its process exited.
  running: boolean;
  // The compaction running in the session, whatever started it; null while
  // none runs.
  compaction: SessionCompaction | null;
  // The name of the clone's top folder holding `projectDir`; the folder's own
  // name outside a clone, and until the first read.
  repo: string;
  // The clone's checked-out branch, or its short commit on a detached HEAD;
  // null outside a clone, and until the first read.
  branch: string | null;
}

// What the slots add up to for one session.
export interface ChatSessionState extends ChatSessionInfo {
  entries: ChatEntry[];
  controls: SessionControl[];
  // The session's slash commands and skills; [] until the harness reports them.
  commands: AgentCommand[];
  // The messages waiting for the running turn to end, the held row waiting on
  // its compaction and the rows behind it, and those sent now not yet taken in,
  // oldest first; [] while nothing waits.
  queued: QueuedMessage[];
  // The messages returned to the box that the page has not placed yet, oldest
  // first; a page mounting the session's tab puts them in its box.
  returned: ReturnedMessage[];
}

// A session's state, split by size and listener. Every key in every slot is the
// session id, and the item id in `chat.entries` is `ChatEntry.id`. A session opens
// with `chat.session` written last, and closes with it deleted first, so a reader
// that finds the key finds its lists.
export const chatSessionSlot: KeyedSlotKey<ChatSessionInfo, 'main', 'chat'> = {
  id: 'chat.session',
  process: 'main',
  kind: 'keyed',
};
export const chatEntriesSlot: ListSlotKey<ChatEntry, 'main', 'chat'> = {
  id: 'chat.entries',
  process: 'main',
  kind: 'list',
};
export const chatControlsSlot: KeyedSlotKey<SessionControl[], 'main', 'chat'> =
  { id: 'chat.controls', process: 'main', kind: 'keyed' };
export const chatCommandsSlot: KeyedSlotKey<AgentCommand[], 'main', 'chat'> = {
  id: 'chat.commands',
  process: 'main',
  kind: 'keyed',
};
export const chatQueuedSlot: KeyedSlotKey<QueuedMessage[], 'main', 'chat'> = {
  id: 'chat.queued',
  process: 'main',
  kind: 'keyed',
};
export const chatReturnedSlot: KeyedSlotKey<ReturnedMessage[], 'main', 'chat'> =
  { id: 'chat.returned', process: 'main', kind: 'keyed' };

export interface PermissionAnswer {
  allowed: boolean;
  reason: string | null;
}

export interface ChatChannel extends ChannelShape {
  invoke: {
    // Sent once on each page load; cancels any running sign-in, since the page
    // that started it is gone.
    loaded(): void;
    // Newest first: the folders chat started sessions in merged with every
    // folder each profile's harness saved sessions in, one per folder, missing
    // folders and those in the OS's temp folders left out.
    recentFolders(): Promise<RecentFolder[]>;
    // The new row's sessionId.
    start(request: StartRequest): string;
    // Newest first; a session open in the app on a row chat does not hold is
    // left out, and one with a chat row is listed.
    pastSessions(
      projectDir: string,
      profile: string,
    ): Promise<PastSessionRow[]>;
    // Each resume section's rows, in registration order; a section with none,
    // or whose read failed (logged), is left out.
    resumeSections(): Promise<ResumeSectionRows[]>;
    setArchived(hostSessionId: string, archived: boolean): Promise<void>;
    // Resolves to the new row's sessionId; a session with a chat row selects
    // that row and resolves to its sessionId, and one open in the app on any
    // other row rejects.
    resume(request: ResumeRequest): Promise<string>;
    // Starts a resting session's process first; rejects, leaving it resting,
    // when its profile is missing or the start fails. A restored session's
    // earlier conversation still pending is read first, into `chat.entries`.
    // While the agent reports the session's turn running the message is queued
    // in `chat.queued`, and written to the agent when the turns before it end,
    // unless sent now first; a permission call left waiting after its turn ended
    // queues nothing. The same goes while a compaction runs or a hold is up. An
    // idle send can be held by a send gate: it shows in `chat.queued` as the held
    // row, and the session compacts first. A written message the agent never
    // takes in comes back in `chat.returned`.
    send(sessionId: string, message: UserMessage): Promise<void>;
    // Reads a restored session's earlier conversation into `chat.entries`.
    // While its profile is missing a call reads nothing and a later call
    // tries again; once read, or for a session with none pending, a call does
    // nothing.
    loadHistory(sessionId: string): Promise<void>;
    // Adds a notice entry to the session's chat, kept across a page reload.
    notice(sessionId: string, text: string, tone: 'info' | 'error'): void;
    accountStatus(profile: string): Promise<AccountStatus>;
    // Starts sign-in `id` to the profile; throws while any sign-in runs. The
    // page picks `id`, unique within its load, since the sign-in's messages
    // can arrive before this call answers. Its link arrives as `logInLink`
    // and its end as `logInEnded`, each carrying `id`; a cancelled sign-in
    // sends neither.
    logIn(id: number, profile: string): void;
    // The code the sign-in page showed, for sign-in `id`; ignored when `id`
    // is not the running sign-in.
    logInCode(id: number, code: string): void;
    // Cancels sign-in `id`, so another may start at once; ignored when `id`
    // is not the running sign-in.
    cancelLogIn(id: number): void;
    logOut(profile: string): Promise<void>;
    // Returns every queued message not sent now, into `chat.returned`, then
    // interrupts the running turn; messages sent now stay queued. While a hold
    // is up it skips the compaction and returns nothing: the held row is written
    // when the compaction ends, then the rows behind it.
    interrupt(sessionId: string): void;
    // Ends the session's process and starts a fresh one under a new host
    // session id; the entries become one `Conversation cleared` notice in
    // `chat.entries`, the active time returns to 0 in `chat.session`, and
    // every message written but not taken in, then every queued message,
    // goes into `chat.returned`. Rejects when the fresh process cannot start,
    // leaving the row resting.
    clear(sessionId: string): void;
    // Takes the queued message out of the queue, into `chat.returned`; does
    // nothing for one already written to the agent or sent now. On the held row
    // the compaction goes on, and the rows behind wait for its end.
    pullBack(sessionId: string, queuedId: string): void;
    // The page put these messages from `chat.returned` into the session's box, so
    // main holds them no longer.
    returnedPlaced(sessionId: string, returnedIds: string[]): void;
    // Writes the queued message to the agent at once, ahead of the rest of the
    // queue; its row stays in `chat.queued` with `sentEntryId` set, until
    // the agent takes it in. Does nothing for one already written or sent now.
    // On the held row it skips the compaction, as `interrupt` does, and the row
    // is written when the compaction ends.
    sendNow(sessionId: string, queuedId: string): void;
    // While the agent reports the session's turn running, writes every queued
    // message not sent now, oldest first, then `message` as a new last row,
    // each as `sendNow` does; a write that throws leaves that row and every
    // later one unsent; the same while a compaction runs with no hold up. While
    // a hold is up it queues `message` behind the held row and skips the
    // compaction, as `interrupt` does, writing nothing now. Otherwise sends
    // `message` as `send` does, and a null `message` does nothing.
    sendAllNow(sessionId: string, message: UserMessage | null): Promise<void>;
    setControl(sessionId: string, controlId: string, value: string): void;
    answerPermission(
      sessionId: string,
      entryId: string,
      answer: PermissionAnswer,
    ): void;
    // Kills every session process chat holds; the rows stay, resting.
    stopAll(): void;
    // Opens the layout preview's sample session and selects its row, or
    // selects the row of the one already open.
    openPreview(): void;
  };
  messages: {
    // A started process exited, or a re-attach or a clear left the row with none,
    // and its row rests until the user closes it. `running: false` reaches
    // `chat.session` first.
    sessionRested: { sessionId: string; error: string | null };
    // The page the user opens to finish sign-in `id`.
    logInLink: { id: number; profile: string; url: string };
    // `status` is null when the status could not be read; `error` is null
    // only for a finished sign-in, and a failed one may still read signed in
    // (a wrong code on a signed-in profile).
    logInEnded: {
      id: number;
      profile: string;
      status: AccountStatus | null;
      error: string | null;
    };
  };
}

// One agent event of a session chat owns. `sessionId` is the sessions plugin's
// row id, `hostSessionId` the harness's session id, which a resumed session
// keeps. `replayed` is true for an event a re-attach replayed from a pipe log;
// a listener that appends or alerts skips it.
export interface ChatAgentEvent {
  sessionId: string;
  profileDir: string | null;
  hostSessionId: string;
  event: AgentEvent;
  replayed: boolean;
}

export type SessionOrigin = 'new' | 'resumed' | 'launched' | 'restored';
export type SessionCloseReason = 'user' | 'start-failed' | 'project-closed';
export type ProcessEndReason = 'stopped' | 'clean' | 'crash';

// `agentEvent`: one agent event of a session chat owns, still sent after the
// row closes for its process's `sessionEnded`; also a restored or resumed
// row's saved usage, read from its transcript rather than sent by a process,
// and the `interrupted` `compactionEnded` chat makes for a compaction whose
// process a clear or a failed attach let go.
// `planUsage`: the plan rows one of those sessions saw. Both carry the
// `profileDir` of the profile the row opened under: its `configDir` as the
// `profiles` setting writes it, unexpanded; null is the harness default, which
// chat never sends.
// `sessionOpened`: a session chat now owns, with the profile it opened under,
// its host id and folder, and how it came to open; a row whose profile is not
// in chat's profiles setting fires none.
// `sessionClosed`: chat closing a row it holds, before its state goes, with the
// titles and `sent` it had. A quit or relaunch fires none.
// `sessionCleared`: a clear moving a row to a new host id, with the titles it
// holds and whether the old conversation was sent a message.
// `processEnded`: a row's live process exiting, outside a replay;
// `hostSessionId` is the id it started under.
// `sessionArchived`: a saved session's archived flag, once written.
// `messageSent`: a message written to the row's process, at the write: a queued
// message fires when it goes out, not when it queues. `entryId` is the entry the
// agent adds when it takes the message in.
// `turnStarted`, `turnFinished`: the row's shown `activity` leaving or reaching
// idle outside a replay, once per crossing. Hear these for "the row's work began
// or ended": they cover a compaction with no harness turn, a stopped turn, and an
// exit with no `turnEnded` (`how: 'rested'`). `agentEvent`'s `turnStarted` and
// `turnEnded` report the harness stream instead, replays included. A listener
// reading `chatSessionSlot` finds the new `activity` and a current `activeTime`.
export interface ChatMainEvents extends EventShape {
  agentEvent: ChatAgentEvent;
  planUsage: { profileDir: string | null; update: PlanRowUpdate };
  sessionOpened: {
    sessionId: string;
    profileDir: string;
    hostSessionId: string;
    projectDir: string;
    profile: string;
    origin: SessionOrigin;
  };
  sessionClosed: {
    sessionId: string;
    hostSessionId: string;
    projectDir: string;
    profile: string;
    titles: SessionTitles;
    sent: boolean;
    reason: SessionCloseReason;
  };
  sessionCleared: {
    sessionId: string;
    oldHostSessionId: string;
    newHostSessionId: string;
    projectDir: string;
    profile: string;
    titles: SessionTitles;
    sent: boolean;
  };
  processEnded: {
    sessionId: string;
    hostSessionId: string;
    reason: ProcessEndReason;
    code: number | null;
    error: string | null;
  };
  sessionArchived: { hostSessionId: string; archived: boolean };
  messageSent: { sessionId: string; entryId: string };
  turnStarted: { sessionId: string };
  turnFinished: { sessionId: string; how: 'idle' | 'rested' };
}

// The main part's exports.
export interface ChatMainExports {
  // Starts a session and sends `message` as its first message; leaves the
  // selected row as it was. Resolves to the new row's sessionId; rejects,
  // opening nothing, on an image chat refuses (with the refusal text), an
  // unknown profile, or no chat harness.
  launch(request: LaunchRequest): Promise<string>;
  // Chat's profiles, in settings order, read at each call. The first profile
  // is the one a drive `chat.start` takes when it names none, and the only
  // choice the start prompt skips to.
  profiles(): readonly ChatProfile[];
  // The profile of a session chat owns; null for any other session id.
  profileOf(sessionId: string): string | null;
  // The profile a launch takes when its caller names none: the profile of a
  // session chat owns, else chat's first; null when chat has no profiles.
  // `sessionId` is null when the launch comes from no session.
  defaultProfile(sessionId: string | null): string | null;
  // Sends as the composer does: queued while the session's turn or compaction
  // runs, and an idle send can be held by a send gate.
  // Rejects for a session chat does not hold, the layout preview included.
  send(sessionId: string, message: UserMessage): Promise<void>;
  // The `/clear` command's clear: resolves once the fresh process started;
  // rejects when it cannot start, or for a session chat does not hold.
  // `sessions.hostSessionChanged` is emitted before it resolves.
  clear(sessionId: string): Promise<void>;
  // Drops every session chat holds in `projectDir` (compared as samePath
  // does), a resting one included, as a `sessions.closed` would, without
  // asking the close guards: for a self-test that starts its project over.
  // Each fires `sessionClosed` with reason `project-closed`. Resolves once
  // each one's owned session has ended and its row is gone, or chat stops.
  closeSessionsIn(projectDir: string): Promise<void>;
  // Text every session chat starts from now on carries to its harness, after
  // the texts registered before it; a running session keeps what it started
  // with. Disposing it leaves later starts without it.
  addInstructions(text: string): Disposable;
  // Gates are asked in registration order before a write to an idle session; the
  // first non-null verdict holds the send, and no later gate is asked. A gate
  // that throws is logged and counts as null. Disposing the handle removes the
  // gate.
  addSendGate(gate: SendGate): Disposable;
  // At each process start chat asks the newest reader still registered for the
  // context size above which the harness may compact the idle session on its
  // own; with none, or when it throws (logged), the harness keeps its default. A
  // running process keeps what it started with. Disposing the handle removes the
  // reader.
  addIdleCompactThreshold(read: () => number | null): Disposable;
  // Sections show at the top of the start prompt in registration order. One
  // whose `rows` fails is logged and left out. Disposing the handle removes the
  // section.
  addResumeSection(section: ResumeSection): Disposable;
}

export const chatMainKey: DependencyKey<ChatMainExports, 'main', 'chat'> = {
  id: 'chat',
  process: 'main',
};

// The session an app slash command was sent in: `args` is the trimmed text
// after the name, '' when none. A resting session takes notices.
export interface SlashCommandContext {
  sessionId: string;
  profile: string;
  args: string;
}

// A `/name` the app runs itself in place of sending it to the agent. `name`
// has no leading `/` and no whitespace; a registered name wins over the
// agent's command of the same name.
export interface AppSlashCommand {
  name: string;
  description: string;
  run(context: SlashCommandContext): Promise<void> | void;
}

// A composer part's stop on a Chat tab's entry cursor: `j` on the last stop of
// the entries offers it the cursor.
export interface ComposerStop {
  // Takes the entry cursor in `sessionId`; false when the part has nothing to
  // select, and `j` stays put. Before it returns true the part sets its own
  // base scope through its own `api.keys.setScope`; returning false it changes
  // nothing.
  enter(sessionId: string, exits: ComposerStopExits): boolean;
  // The cursor left by a chat action (the box took focus, the tab hid); the
  // part drops its selection and scope. Chat also calls it right after the
  // part's `enter` threw, so it may find `enter` half done. It sets no scope:
  // chat, or the view that took the keys, sets one.
  leave(sessionId: string): void;
}

// How a holding part hands the cursor back. A part calls each at most once
// per `enter`; a call after chat took the cursor back does nothing.
export interface ComposerStopExits {
  // Back to the last entry, chat's scope in force again.
  toEntries(): void;
  // Focuses the chat box as `i` / `a` do.
  toBox(how: 'insert' | 'append'): void;
}

// What a plugin draws above every Chat tab's composer: chat hands it a
// wrapper and the tab's session id. A part with a `stop` is offered the entry
// cursor, in part order, the first to take it holding it.
export interface ChatComposerPart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };
  stop?: ComposerStop;
}

// What a plugin draws in every Chat tab's status line, after the control
// chips: chat hands it a wrapper and the tab's session id.
export interface ChatStatusPart {
  id: string;
  build(parent: HTMLElement, sessionId: string): { dispose?(): void };
}

// A side part's handle on its section's frame in one Chat tab. `setSummary` sets
// the text at the frame's end, null for none; after the build's dispose it does
// nothing.
export interface ChatSideSection {
  setSummary(text: string | null): void;
}

// What a plugin draws in the session hub beside every Chat tab's entries and
// composer, as one section: chat draws the frame with `title` and hands `build`
// the frame's body, the tab's session id and the section. Chat sorts the sections
// by `order`, equal orders keeping add order. The body adds its own padding, so
// the part adds none. A part that draws nothing, by drawing no child element in
// `parent` or by setting `hidden` on each, hides its section. It takes no stop
// and no key scope.
export interface ChatSidePart {
  id: string;
  title: string;
  order: number;
  build(
    parent: HTMLElement,
    sessionId: string,
    section: ChatSideSection,
  ): { dispose?(): void };
}

// One command the `/` completion offers, whoever holds it: an app command, or
// an agent command the app holds no name of. An app command has no argument
// hint or aliases; a Claude command named `plugin:name` has the name after the
// first `:` among its aliases, unless another command is named it or the CLI
// gave it to another as an alias.
export interface CompletionCommand {
  name: string;
  description: string;
  argumentHint: string;
  aliases: readonly string[];
  source: 'app' | 'agent';
}

// Draws one `/` completion row into `row`, an element inside the row after its
// name that starts empty, holds one line and is cut to the width the name
// leaves, and returns true when it took the row: no older draw then runs. A draw
// that returns false or throws leaves `row` empty for the next. CodeMirror draws
// a row again each time it rebuilds the list, and only the rows it shows, so a
// draw runs any number of times for a command, on a new `row` each time.
export type CompletionRowDraw = (
  command: CompletionCommand,
  row: HTMLElement,
) => boolean;

// The page part's exports. `addSlashCommand` registers an app slash command
// until its `dispose`, and throws when the name is already registered.
// `addCompletionRow` adds a draw for the `/` completion's rows until its
// `dispose`; the newest draw goes first, and a draw that throws is logged and
// counts as false.
// `fillComposer` replaces the session's draft, leaving its attached images,
// selects its Chat tab and focuses the box in insert mode at the end; an
// unknown session is logged and ignored. `addComposerPart` throws on an id
// already added; adding a part and disposing its `Disposable` each draw every
// Chat tab's composer again. A part is built each time the composer draws,
// which is at a layout change and at a part add or removal, not on each status
// line draw, so a part whose content changes redraws into its wrapper itself.
// A part is drawn in every Chat tab, the layout preview's included.
// `addStatusPart` follows the same rules for a status part: it throws on an id
// already added; adding one and disposing its `Disposable` each draw every
// Chat tab's composer again; a status part is built at each composer draw and
// redraws into its wrapper itself when its content changes; it draws in every
// Chat tab, the preview's included.
// `addSidePart` throws on an id already added; a side part draws in every Chat
// tab, the preview's included, as a section of the session hub at its place by
// `order`. It is built once per tab, when it is added or its tab is built, and
// disposed when it is removed or its tab closes; a chat layout change disposes
// and builds it again. Adding or removing another side part, a composer draw and
// a change to its frame (a collapse, a summary) each leave it and its parent as
// they are, so a part whose content changes redraws into its parent itself. A
// part whose build throws is logged and stays unbuilt in that tab until it is
// added again or the chat layout changes.
// `focusedEntry` is the visible Chat tab's focused stop's slot element (an
// entry, an activity line or a pending row); null with no visible Chat tab, no
// focused stop, or while a composer part's stop holds the cursor.
// `focusedBlock` is the visible Chat tab's cursor block element, inside that
// slot; null in the same cases and on a stop with no blocks.
// `activeTime` is the session's clock in `chat.session`, null for a session with
// no key there; read the total at a moment with `activeMsAt`.
export interface ChatPageExports {
  addSlashCommand(command: AppSlashCommand): Disposable;
  addCompletionRow(draw: CompletionRowDraw): Disposable;
  fillComposer(sessionId: string, text: string): void;
  addComposerPart(part: ChatComposerPart): Disposable;
  addStatusPart(part: ChatStatusPart): Disposable;
  addSidePart(part: ChatSidePart): Disposable;
  focusedEntry(): HTMLElement | null;
  focusedBlock(): HTMLElement | null;
  activeTime(sessionId: string): ActiveTime | null;
}

export const chatPageKey: DependencyKey<ChatPageExports, 'page', 'chat'> = {
  id: 'chat',
  process: 'page',
};
