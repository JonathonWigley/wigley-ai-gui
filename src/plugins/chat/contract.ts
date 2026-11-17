import type { ActiveTime } from '../../contracts/active-time';
import type {
  AccountStatus,
  AgentCommand,
  AgentEvent,
  ChatEntry,
  ChatImage,
  CompactionTrigger,
  PlanRowUpdate,
  ProcessActivity,
  SessionControl,
  UserMessage,
} from '../../contracts/agent';
import type { CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type { KeyedSlotKey, ListSlotKey, SlotKey } from '../../contracts/state';
import type { SessionTitles } from '../sessions/contract';
import type { AnyEntryKind, EntryBuilder, EntryInput } from './layouts/layout';

// The layout preview's row host session id; no harness holds a session by it.
export const CHAT_PREVIEW_HOST_ID = 'chat-layout-preview';

// The note a headless row's agent starts with, and the line that tells it the
// row is headless no longer.
export const HEADLESS_NOTE =
  'This session is headless until a tool result says the session is no ' +
  'longer headless: nobody answers forms rounds. Build no round: take each ' +
  "item's recommended pick and list every pick as a Decided notice in your " +
  'reply. An auto-answered pick never approves a hard-gated action ' +
  '(third-party code, destroying user state, a push): name what the gate ' +
  'needs in the reply and end the turn.';
export const HEADLESS_OFF_NOTE =
  'This session is no longer headless: send each round to the form again.';

// `harness` is the id of the harness the folder's session ran on.
export interface RecentFolder {
  projectDir: string;
  harness: string;
  profile: string;
  lastUsed: number;
}

// One element of the `projects` setting as written: the settings check types
// no element of an empty default list, so every field is unchecked until
// `readProjects` reads it.
export interface ProjectSetting {
  name: string;
  folder?: string;
  pool?: string;
  profile?: string;
}

// One entry `readProjects` kept. `folder` is as written, a `~` unexpanded;
// `profile` null when the project fixes none.
export type ChatProject =
  | { kind: 'folder'; name: string; folder: string; profile: string | null }
  | { kind: 'pool'; name: string; pool: string; profile: string | null };

export interface PoolProvider {
  // The pool's clone paths by clone number; [] for an unknown pool.
  folders(pool: string): readonly string[];
}

// `changed()` says the provider's `folders` changed, so chat re-asks every
// row's project; `dispose` removes the provider.
export interface PoolProviderHandle extends Disposable {
  changed(): void;
}

// Where a new session starts: a folder, or a project from chat's `projects`
// setting.
export type StartTarget = { projectDir: string } | { project: string };

// `harness` is the id of the harness the session runs on, and `profile` one of
// that harness's profiles.
export type StartRequest = StartTarget & { harness: string; profile: string };

// `unattended`: true for a session nobody answers: chat denies each permission
// prompt at once. Kept with the row across a relaunch.
// `headless`: true opens the row headless; a caller launching from a session
// passes that session's flag.
// `instructions`: text this session alone carries to its harness, after the
// global `addInstructions` texts. Kept with the row across a clear and a
// relaunch.
// `owner`: the plugin the row belongs to (sessions' `OpenOptions.owner`). Kept
// with the row across a clear and a relaunch.
export type LaunchRequest = StartTarget & {
  profile: string;
  message: UserMessage;
  unattended?: boolean;
  headless?: boolean;
  instructions?: readonly string[];
  owner?: string;
};

// `hostSessionId` is the harness's id for the saved session.
export interface PastSessionRow {
  hostSessionId: string;
  title: string;
  modified: number;
  archived: boolean;
}

// A project's saved session, with the folder it ran in, which a resume opens
// it in.
export interface ProjectPastSessionRow extends PastSessionRow {
  projectDir: string;
}

// `title` is the saved session's title, which the new row takes as its
// first-message title. `instructions` and `owner` are as `LaunchRequest` has
// them; a resume with `owner` opens its row unselected. True `headless` opens
// the row headless, as a stashed session that was headless resumes. With no
// `harness` the session resumes on the harness that declares `profile`.
export interface ResumeRequest {
  projectDir: string;
  harness?: string;
  profile: string;
  hostSessionId: string;
  title: string;
  instructions?: readonly string[];
  owner?: string;
  headless?: boolean;
}

// A message sent while its session's turn ran, held by chat main until the
// turn ends or the user sends it now; `id` is unique within its session.
// `sentEntryId` is null while it waits, and once sent now the harness's id of
// the user entry the agent adds when it takes the message in, which drops the
// row; on a row's later processes that entry's id in `chat.entries` differs.
// `holdReason` is non-null on a held row, a send gate's reason: the row waits
// for its session's compaction and is written when the compaction ends. A
// session has at most one held row.
export interface QueuedMessage extends UserMessage {
  id: string;
  sentEntryId: string | null;
  holdReason: string | null;
}

// A compaction running in a session. `reason` is the reason of an app
// compaction, the send gate's for a hold's or the caller's for chat main's
// `compact`; null for any other.
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

// A saved session a resume section lists. `note` is the section's word about
// the session, drawn after its title. True `headless` resumes it headless.
// `harness` is as `ResumeRequest` has it.
export interface ResumeSectionRow {
  hostSessionId: string;
  projectDir: string;
  harness?: string;
  profile: string;
  title: string;
  note?: string;
  at: number;
  headless?: boolean;
}

// One section's answer; `rows` is never empty.
export interface ResumeSectionRows {
  title: string;
  rows: ResumeSectionRow[];
}

// A titled list of saved sessions at the top of the start prompt. `rows` is in
// list order: the last row sits next to the cursor. `isResumable` is false for
// a session chat holds, one open in the app on another row, an archived one,
// and one an earlier section listed: chat asks the sections one at a time, in
// registration order, so a section's cap counts only sessions it shows. The
// start prompt waits for `rows`, so a section that never settles holds it.
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
// deleted at once. `harness` is the id of the harness the row runs on, fixed
// when the row opens.
export interface ChatSessionInfo {
  sessionId: string;
  projectDir: string;
  harness: string;
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
  // The session's agent process pid while `running`; null otherwise, and
  // until the harness reports it.
  pid: number | null;
  // The compaction running in the session, whatever started it; null while
  // none runs.
  compaction: SessionCompaction | null;
  // The name of the clone's top folder holding `projectDir`; the folder's own
  // name outside a clone, and until the first read.
  repo: string;
  // The clone's checked-out branch, or its short commit on a detached HEAD;
  // null outside a clone, and until the first read.
  branch: string | null;
  // The git worktrees the session's agents wrote files in or named the root of
  // in a Bash command, by name, in the order of their first touch
  // (`worktreeNameOf` and `worktreesInCommand` in main). Kept after the
  // worktree is removed; [] until one is touched.
  worktrees: string[];
  // The row is headless. Saved with the row, kept across `/clear` and a
  // relaunch, and a stashed row's resume; any other resumed saved session
  // starts with it off.
  headless: boolean;
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

// Which stop of a session's list the entry keys act on, and the range open from
// an anchor. A stop is a row, or one block of an entry with blocks. A following
// focus stays on the latest stop as entries arrive.
export interface EntryFocus {
  stopId: string | null;
  following: boolean;
  anchorId: string | null;
}

// A Chat tab's place: the box's text, the entry cursor, the open runs' ids, and
// each entry's expanders' open states, by entry id.
export interface ChatPlace {
  draft: string;
  focus: EntryFocus;
  openRuns: string[];
  openExpanders: Record<string, boolean[]>;
}

// Each Chat tab's place, by session id; the page puts the last page's back as
// the tab is made, and a session's key leaves with its row.
export const chatPlaceSlot: KeyedSlotKey<ChatPlace, 'page', 'chat'> = {
  id: 'chat.place',
  process: 'page',
  kind: 'keyed',
};

// The images attached to each Chat tab's next message, by session id; a tab
// with none holds no key. Apart from `chat.place`, so a keystroke resends no
// image.
export const chatDraftImagesSlot: KeyedSlotKey<
  readonly ChatImage[],
  'page',
  'chat'
> = { id: 'chat.draftImages', process: 'page', kind: 'keyed' };

export interface PermissionAnswer {
  allowed: boolean;
  reason: string | null;
}

export interface ChatChannel extends ChannelShape {
  invoke: {
    // Sent once on each page load; cancels any running sign-in, since the page
    // that started it is gone.
    loaded(): void;
    // Settles once main's restore of the saved rows ends, a failed one
    // included, so it never rejects. Main sends each reopened row's slot
    // writes to the page before this reply, so the rows are in the page's
    // mirror when it settles.
    restored(): Promise<void>;
    // Newest first: the folders chat started sessions in merged with every
    // folder each profile's harness saved sessions in, one per folder, missing
    // folders and those in the OS's temp folders left out.
    recentFolders(): Promise<RecentFolder[]>;
    // The new row's sessionId; a pool project's row starts in the pool's
    // lowest-numbered clone. Throws, opening nothing, on a harness not
    // registered, a profile its harness does not declare, an unknown project, a
    // profile other than the project's, no pool provider, or a pool with no
    // clones.
    start(request: StartRequest): string;
    // Chat's checked projects, in settings order.
    projects(): ChatProject[];
    // The saved sessions of every folder the project covers under the
    // profile, newest first, each with its folder.
    projectPastSessions(
      project: string,
      profile: string,
    ): Promise<ProjectPastSessionRow[]>;
    // Newest first; a session open in the app on a row chat does not hold or
    // on a row with an owner is left out, and one with another chat row is
    // listed.
    pastSessions(
      projectDir: string,
      profile: string,
    ): Promise<PastSessionRow[]>;
    // Each resume section's rows, in registration order; a section with none,
    // or whose read failed (logged), is left out.
    resumeSections(): Promise<ResumeSectionRows[]>;
    setArchived(hostSessionId: string, archived: boolean): Promise<void>;
    // Resolves to the new row's sessionId; a session with a chat row with no
    // owner selects that row and resolves to its sessionId, and one on a row
    // with an owner, or open in the app on any other row, rejects.
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
    // Ends the session's process and starts a fresh one as a new conversation,
    // whose host session id the harness reports; the entries become one
    // `Conversation cleared` notice in
    // `chat.entries`, the active time returns to 0 in `chat.session`, and
    // every message written but not taken in, then every queued message,
    // goes into `chat.returned`. Rejects when the fresh process cannot start,
    // leaving the row resting.
    clear(sessionId: string): void;
    // Writes the row's headless flag into `chat.session` and saves it; a
    // session chat does not hold is logged and left alone.
    setHeadless(sessionId: string, headless: boolean): void;
    // Takes the queued message out of the queue, into `chat.returned`; does
    // nothing for one already written to the agent or sent now. On the held row
    // the compaction goes on, and the rows behind wait for its end.
    pullBack(sessionId: string, queuedId: string): void;
    // The page put these messages from `chat.returned` into the session's box, so
    // main holds them no longer.
    returnedPlaced(sessionId: string, returnedIds: string[]): void;
    // Writes the queued message to the agent at once, ahead of the rest of the
    // queue, and while a turn runs asks the agent to take it in now (not during
    // a compaction, for slash text, or behind a message written plainly and not
    // yet taken in); its row stays in `chat.queued` with `sentEntryId` set, until
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
// Why chat closed a row: `user` the sessions plugin's close, `start-failed` a
// start that threw, `project-closed` a close of the rows in a project folder
// (`closeSessionsIn`, and the self-test's cleanup of earlier runs), `finished`
// a plugin's `close` for a session whose work ended.
export type SessionCloseReason =
  | 'user'
  | 'start-failed'
  | 'project-closed'
  | 'finished';

const USER_CLOSES: Record<SessionCloseReason, boolean> = {
  user: true,
  'start-failed': false,
  'project-closed': false,
  finished: false,
};

// True only for the user's own close, the one Recently closed and the stash
// take.
export function isUserClose(reason: SessionCloseReason): boolean {
  return USER_CLOSES[reason];
}
export type ProcessEndReason = 'stopped' | 'clean' | 'crash';

// `agentEvent`: one agent event of a session chat owns, still sent after the
// row closes for its process's `sessionEnded`; also a restored or resumed
// row's saved usage, read from its transcript rather than sent by a process,
// and the `interrupted` `compactionEnded` chat makes for a compaction whose
// process a clear or a failed attach let go.
// `planUsage`: the plan rows one of those sessions saw. Both carry the
// `profileDir` of the profile the row opened under: its `configDir` as the
// harness's profiles setting writes it, unexpanded; null is the harness
// default, which chat never sends.
// `sessionOpened`: a session chat now owns, with the profile it opened under,
// its host id and folder, and how it came to open; a row whose profile is not
// among the profiles of its harness fires none. A restored, resumed or
// attached row fires it before the session's slots exist and before chat's
// exports know the row. A new session's row fires it once its harness reports
// the host id, after its slots exist and the sessions row holds that id; it
// fires none, nor `sessionClosed`, when the row closes first.
// `sessionClosed`: chat closing a row it holds, before its state goes, with the
// titles, `sent` and `headless` it had. A quit or relaunch fires none.
// `sessionCleared`: a clear moving a row to a new host id, once the fresh
// process reports that id, with the titles it holds and whether the old
// conversation was sent a message. A clear of a row with no host id yet fires
// none.
// `processEnded`: a row's live process exiting, outside a replay;
// `hostSessionId` is the id it started under.
// `sessionArchived`: a saved session's archived flag, once written.
// `messageSent`: a message written to the row's process, at the write: a queued
// message fires when it goes out, not when it queues. `entryId` is the id in
// `chat.entries` of the entry the agent adds when it takes the message in.
// `turnStarted`, `turnFinished`: the row's shown `activity` leaving or reaching
// idle outside a replay, once per crossing. Hear these for "the row's work began
// or ended": they cover a compaction with no harness turn, a stopped turn, and an
// exit with no `turnEnded` (`how: 'rested'`). They do not pair, since a crossing
// in a replay fires none: `chatSessionSlot` holds the state. `agentEvent`'s
// `turnStarted` and `turnEnded` report the harness stream instead, replays
// included. A listener reading `chatSessionSlot` finds the new `activity` and a
// current `activeTime`.
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
    headless: boolean;
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
  // selected row as it was. With `unattended` true the row denies each
  // permission prompt at once and raises no `Turn finished` mark.
  // `instructions` follow the global `addInstructions` texts at each of the
  // row's process starts; `owner` names the plugin the row belongs to, and
  // such a row raises no `Turn finished` mark. Resolves to the new row's
  // sessionId; rejects, opening nothing, on an image chat refuses (with the
  // refusal text), a profile no registered harness declares, an unknown
  // project, a profile other than the project's, no pool provider, or a pool
  // with no clones. A pool project's session starts in the pool's
  // lowest-numbered clone. It runs on the harness that declares its profile.
  launch(request: LaunchRequest): Promise<string>;
  // The channel's resume for another plugin: resolves to the row's sessionId.
  // A row chat holds for the host id is returned as it is only when its owner
  // is the request's (none when absent), activated only when it has no owner;
  // a held row with another owner rejects, naming both, and so does a session
  // open on a row chat does not hold.
  // `instructions` and `owner` are as `launch` has them, and a resume with
  // `owner` opens its row unselected.
  resume(request: ResumeRequest): Promise<string>;
  // The profile of a session chat owns; null for any other session id.
  profileOf(sessionId: string): string | null;
  // The clock of a session chat owns; null for any other session id.
  activeTime(sessionId: string): ActiveTime | null;
  // The agent that made a tool call, by its host tool-use id: MAIN_AGENT_ID or
  // a subagent's id, as the session's stream names it. For a call the stream
  // has not named yet it waits a short while, then resolves null; for a
  // session chat does not hold it resolves null at once.
  toolCaller(sessionId: string, toolUseId: string): Promise<string | null>;
  // Whether a session chat owns is headless; false for any other session id.
  isHeadless(sessionId: string): boolean;
  // Whether the harness process of a session chat owns started with the
  // headless note, which is the flag at its last process start (a `/clear`
  // included), or its saved flag when it has not started one in this app run;
  // false for any other session id. `isHeadless` can differ once the flag
  // changes, since a running process keeps the instructions it started with.
  launchedHeadless(sessionId: string): boolean;
  // The profile a launch takes when its caller names none: the profile of a
  // session chat owns, else the first profile of chat's `defaultHarness`; null
  // when that harness is not registered or has no profiles.
  // `sessionId` is null when the launch comes from no session.
  defaultProfile(sessionId: string | null): string | null;
  // Settles once main's restore of the saved rows ends, a failed one
  // included, so it never rejects; until then profileOf is null for a row the
  // restore is about to reopen.
  restored(): Promise<void>;
  // Sends as the composer does: queued while the session's turn or compaction
  // runs, and an idle send can be held by a send gate.
  // Rejects for a session chat does not hold, the layout preview included.
  send(sessionId: string, message: UserMessage): Promise<void>;
  // The `/clear` command's clear: resolves once the fresh process started and
  // reported its host session id; rejects when it cannot start, or for a
  // session chat does not hold.
  // `sessions.hostSessionChanged` is emitted before it resolves.
  clear(sessionId: string): Promise<void>;
  // Drops every session chat holds in `projectDir` (compared as samePath
  // does), a resting one included, as a `sessions.closed` would, without
  // asking the close guards: for a self-test that starts its project over.
  // Each fires `sessionClosed` with reason `project-closed`. Resolves once
  // each one's owned session has ended and its row is gone, or chat stops.
  closeSessionsIn(projectDir: string): Promise<void>;
  // Ends one session chat owns, as a sessions.closed would, without asking the
  // close guards; fires sessionClosed with `reason`. Resolves once its row is
  // gone or chat stops; rejects for a session chat does not hold.
  close(sessionId: string, reason: SessionCloseReason): Promise<void>;
  // Text every session chat starts from now on carries to its harness, after
  // the texts registered before it; a running session keeps what it started
  // with. Disposing it leaves later starts without it. A session's own
  // `instructions` follow these texts.
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
  // Compacts an idle session chat holds (trigger `app`), its dock showing
  // `reason` from the call until the compaction ends; messages sent meanwhile
  // queue behind it, and a working stretch that ran only it raises no
  // `Turn finished` mark. True when it started one. False, logged, starting
  // nothing, for a session chat does not hold, one whose process is not
  // running or still attaching, one not idle, one with a compaction running or
  // a hold up, or when the harness refuses.
  compact(sessionId: string, reason: string): boolean;
  // Sections show at the top of the start prompt in registration order. One
  // whose `rows` fails is logged and left out. Disposing the handle removes the
  // section.
  addResumeSection(section: ResumeSection): Disposable;
  // The newest provider still registered answers every pool question;
  // disposing the handle removes it, and the one registered before it answers
  // again. With none registered a pool project can neither start nor list its
  // saved sessions. Each row's project is re-asked at the add, at the handle's
  // `changed()` and at its `dispose`; `changed()` after `dispose` does nothing.
  addPoolProvider(provider: PoolProvider): PoolProviderHandle;
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
// and no key scope. The chat layout's `sideSection` gets the part's id, so a
// layout may frame one part its own way: the default draws `chat.session` as the
// hub's header, with no head, which the hub's cursor then passes over. A part
// marked `shrinksLast` keeps its height while the other sections give theirs up,
// down to a few lines each.
export interface ChatSidePart {
  id: string;
  title: string;
  order: number;
  shrinksLast?: true;
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
// added again or the chat layout changes. A part marked `shrinksLast` keeps its
// height while the other sections give theirs up, down to a few lines each.
// `activeTime` is the session's clock in `chat.session`, null for a session with
// no key there; read the total at a moment with `activeMsAt`.
// `setHeadless` turns the session's headless flag on or off through the
// channel's `setHeadless`; the flag shows in `chat.session`.
// `mountChat` draws the Chat tab's view of a session whose row has an owner
// into `element`, in place of a Sessions tab (`ChatMount`).
// `addEntryRenderer` adds a renderer for entries of `kind` until its
// `dispose`; an entry draws with the user's layout when it names the kind,
// else with the latest-added renderer whose `kind` matches and whose `match`
// passes, else with `default`; adding or disposing one redraws every Chat
// tab's entries.
export interface ChatPageExports {
  addSlashCommand(command: AppSlashCommand): Disposable;
  addCompletionRow(draw: CompletionRowDraw): Disposable;
  fillComposer(sessionId: string, text: string): void;
  addComposerPart(part: ChatComposerPart): Disposable;
  addStatusPart(part: ChatStatusPart): Disposable;
  addSidePart(part: ChatSidePart): Disposable;
  activeTime(sessionId: string): ActiveTime | null;
  setHeadless(sessionId: string, headless: boolean): Promise<void>;
  mountChat(element: HTMLElement, sessionId: string): ChatMount;
  addEntryRenderer<K extends AnyEntryKind>(
    renderer: ChatEntryRenderer<K>,
  ): Disposable;
}

// Draws entries of `kind`, a known kind or a harness's own
// (`<harness id>:<kind>`), whose `match`, when given, returns true; `build`
// takes a chat layout's entry builder's arguments. `match` is asked again at
// each update of the entry, and an answer that changes what draws it draws
// the entry anew. A `build` or view `update` that throws leaves the entry to
// `default`; a `match` that throws counts as false.
export interface ChatEntryRenderer<K extends AnyEntryKind = AnyEntryKind> {
  kind: K;
  match?(input: EntryInput<K>): boolean;
  build: EntryBuilder<K>;
}

// A session's chat view drawn into another plugin's element by `mountChat`:
// its entries, composer and session hub, as its Chat tab would show them. The
// host calls `shown` each time its pane becomes the visible surface, which hands
// the view chat's keys, and `hidden` when it stops, before it sets its own
// scope. `mountChat` throws an `Error` whose message is the reason when the
// page has stopped (`chat page is stopped`), when the session's row has no
// owner (`session <id> is not owned; it shows in Sessions`), or when the
// session is already mounted (`session <id> is already mounted`). A mount made
// before the session's `chat.session` key or its row reaches the page returns at
// once, leaves `element` empty, and draws once both arrive; one whose row
// arrives with no owner draws nothing. `dispose` removes the view and leaves
// the session running, and the session may be mounted again; the session's row
// leaving disposes the mount, and each call on a disposed mount does nothing.
export interface ChatMount extends Disposable {
  shown(): void;
  hidden(): void;
}

export const chatPageKey: DependencyKey<ChatPageExports, 'page', 'chat'> = {
  id: 'chat',
  process: 'page',
};

// The visible Chat tab's focused stop: the tab's session, the id of the slot the
// stop belongs to (an entry's id, an activity line's run id or a pending row's
// stop id; for a block stop the entry holding the block), and the block's index
// among that entry's `[data-md-lines]` elements in document order, null on a stop
// that is no block.
export interface ChatFocus {
  sessionId: string;
  entryId: string;
  block: number | null;
}

// The visible Chat tab's focused stop, null with no visible Chat tab, no focused
// stop, or while a composer part's stop holds the cursor; written as the cursor
// moves, before the key that moved it returns. A reader finds the elements by the
// marks chat sets: each Chat tab's root carries `data-chat-session` with its
// session id, and each slot (`.chat-entry-slot`) `data-chat-entry` with its id.
export const chatFocusSlot: SlotKey<ChatFocus | null, 'page', 'chat'> = {
  id: 'chat.focus',
  process: 'page',
  kind: 'value',
};

// The commands a click runs on what it landed on, each naming the session whose
// Chat tab holds it. A key on the focused item runs its own command instead.

// Allows the pending permission entry `entryId`, as its Allow once does.
export const chatAllowEntryCommand: CommandKey<
  { sessionId: string; entryId: string },
  'chat.allowEntry'
> = { id: 'chat.allowEntry' };

// Opens the reason box for the pending permission entry `entryId`.
export const chatDenyEntryCommand: CommandKey<
  { sessionId: string; entryId: string },
  'chat.denyEntry'
> = { id: 'chat.denyEntry' };

// Removes the attached image at `index`.
export const chatRemoveImageAtCommand: CommandKey<
  { sessionId: string; index: number },
  'chat.removeImageAt'
> = { id: 'chat.removeImageAt' };

// Opens or closes the activity line of run `runId`.
export const chatToggleRunCommand: CommandKey<
  { sessionId: string; runId: string },
  'chat.toggleRun'
> = { id: 'chat.toggleRun' };

// Opens or closes entry `entryId`'s expander at creation-order `place`.
export const chatToggleExpanderCommand: CommandKey<
  { sessionId: string; entryId: string; place: number },
  'chat.toggleExpander'
> = { id: 'chat.toggleExpander' };

// Pulls the pending message `queuedId` back into the box.
export const chatPullBackMessageCommand: CommandKey<
  { sessionId: string; queuedId: string },
  'chat.pullBackMessage'
> = { id: 'chat.pullBackMessage' };

// Collapses or expands the session hub section of the side part with this id,
// in every tab.
export const chatToggleSectionCommand: CommandKey<
  string,
  'chat.toggleSection'
> = { id: 'chat.toggleSection' };

// Opens the image viewer on user entry `entryId`'s images at `index`.
export const chatOpenImageCommand: CommandKey<
  { sessionId: string; entryId: string; index: number },
  'chat.openImage'
> = { id: 'chat.openImage' };

// Moves the entry cursor to stop `stopId`.
export const chatMoveFocusCommand: CommandKey<
  { sessionId: string; stopId: string },
  'chat.moveFocus'
> = { id: 'chat.moveFocus' };
