import path from 'node:path';
import type { ActiveTime } from '../../../contracts/active-time';
import {
  type AgentEvent,
  type AgentHarness,
  type AgentProcess,
  type AgentProcessEvents,
  type AgentStart,
  CONTROL_ROLES,
  type ChatEntry,
  type HarnessProfile,
  type PermissionDecision,
  type ProcessActivity,
  type SessionControl,
  type UsageAgentEvent,
  type UserDelivery,
  type UserMessage,
} from '../../../contracts/agent';
import type { Clock, RandomUuid } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Files } from '../../../contracts/files';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { MainChannel, PluginEvents } from '../../../contracts/plugin';
import type {
  HostedProcessInfo,
  SessionHost,
} from '../../../contracts/session-host';
import {
  activeMsAt,
  NO_ACTIVE_TIME,
  startActiveTime,
  stopActiveTime,
} from '../../../shared/active-time';
import { bashCommandOf } from '../../../shared/bash-command';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import { createListeners } from '../../../shared/listeners';
import { readAgentFrame } from '../agent-frame';
import { refusalOf } from '../image-rules';
import { isWorkRunning } from '../session-work';
import {
  type AgentSession,
  type OpenOptions,
  type OwnedSession,
  type SessionsMainExports,
  type SessionTitles,
  TITLE_SOURCES,
} from '../../sessions/contract';
import {
  type AdoptRequest,
  type ChatChannel,
  type ChatMainEvents,
  type ChatProject,
  type ChatSessionState,
  HEADLESS_NOTE,
  type HistoryLoad,
  type LaunchRequest,
  type PastSessionRow,
  type PermissionAnswer,
  type PoolProvider,
  type PreparedLaunch,
  type ProcessEndReason,
  type ProjectPastSessionRow,
  type QueuedMessage,
  type ResumeRequest,
  type ReturnedMessage,
  type ResumeSection,
  type ResumeSectionRow,
  type ResumeSectionRows,
  type SendGate,
  type SessionCloseReason,
  type SessionCompaction,
  type SessionOrigin,
  type StartRequest,
} from '../contract';
import type { ArchivedSessions } from './archived-sessions';
import type { ChatSlots, SessionSlots } from './chat-slots';
import {
  type ChatHarnesses,
  requireHarness,
  requireHarnessOfProfile,
  requireProfile,
} from './lookups';
import {
  NO_TITLES,
  type OpenSessions,
  type SavedSession,
  type SavedSessions,
} from './open-sessions';
import type { RecentFolders } from './recent-folders';
import type { ToolCallers } from './tool-callers';
import {
  type ResolvedFolder,
  rootSpellings,
  runsGitWorktree,
  worktreeNameOf,
  worktreesInCommand,
} from './worktree-name';

export interface ChatSessionsDeps {
  // Read at each start, resume and row lookup: a row runs on the harness
  // registered under its `harness` id, and its profile is one the registry
  // publishes for that harness.
  harnesses: ChatHarnesses;
  // The label `core.agentHarnesses` last held for a harness id, else the id;
  // read at each notice and refusal that names a harness.
  harnessLabelOf(harnessId: string): string;
  sessions: Pick<
    SessionsMainExports,
    'open' | 'mark' | 'activate' | 'setTitle' | 'titles' | 'label'
  >;
  selectedSessionId(): string | null;
  // Read at each start and past-session read naming a project.
  projects(): readonly ChatProject[];
  // The newest registered pool provider, null with none; read at each pool
  // start and past-session read.
  poolProvider(): PoolProvider | null;
  // Expand a folder project's `~`.
  homeDir: string;
  paths: Pick<Paths, 'expandTilde' | 'join' | 'parent' | 'segmentsBelow'>;
  recent: RecentFolders;
  archived: ArchivedSessions;
  saved: OpenSessions;
  slots: ChatSlots;
  send: MainChannel<ChatChannel>['send'];
  emit: PluginEvents<ChatMainEvents>['emit'];
  window: { isFocused(): boolean };
  // Reads each row's repo, branch and linked worktrees at its open and after
  // each turn, and the worktrees again after a Bash call runs `git worktree`.
  git: Pick<Git, 'topLevel' | 'currentBranch' | 'worktrees'>;
  // Resolves the row's folder and every folder above it at each worktree
  // read, so a root git lists resolved also matches under the folder's own
  // spelling.
  files: Pick<Files, 'realPath'>;
  // Told the agent of each `toolStarted`, before chat emits it.
  toolCallers: Pick<ToolCallers, 'noteToolStarted'>;
  log: PluginLog;
  // Stamps the `at` of the notices chat makes itself, and times each
  // session's active time.
  clock: Clock;
  // Mints a prepared launch's host session and row ids: the run starts
  // later, without the app, so no harness reports an id first.
  randomUuid: RandomUuid;
  // Lists the host's processes before a resume, and before a send or history
  // read on an unheld row.
  sessionHost: Pick<SessionHost, 'list'>;
}

export interface ChatSessions {
  sessions(): ChatSessionState[];
  // The held session's current host id, which a `clear` replaces once the
  // fresh process reports its id; null for a row chat does not hold, and for a
  // held row whose harness has not reported an id yet.
  hostSessionIdOf(sessionId: string): string | null;
  // The held session's host id once it holds one and no clear is pending: at
  // once when it does, else when its harness reports an id. Rejects with
  // `chat holds no session <id>` for a row chat does not hold, and with
  // `session <id> closed before its harness reported a session id` when the
  // row closes first, `session <id> ended before its harness reported a
  // session id` when the process it waits on ends first, and `session <id>
  // not settled: chat is stopping` at `detachAll` and for a call after it that
  // would wait.
  hostSessionIdSettled(sessionId: string): Promise<string>;
  // The held session's active-time clock; null for a row chat does not hold.
  activeTimeOf(sessionId: string): ActiveTime | null;
  // Whether the held session is headless; false for a row chat does not hold.
  isHeadless(sessionId: string): boolean;
  // Whether the held session is unattended; false for a row chat does not hold.
  isUnattended(sessionId: string): boolean;
  // Whether the held session's last process start carried the headless note;
  // the saved flag until its first start in this app run. False for a row
  // chat does not hold.
  launchedHeadless(sessionId: string): boolean;
  // Sets the held session's headless flag, publishes it in `chat.session` and
  // saves; the value it already holds changes nothing. Logs and does nothing
  // for a row chat does not hold.
  setHeadless(sessionId: string, headless: boolean): void;
  // Opens a row selected and not headless, on the request's harness. A folder,
  // a folder project's tilde-expanded folder, or a pool project's
  // lowest-numbered clone starts its process at once. Throws, opening nothing,
  // on a harness not registered, a profile that harness does not declare, an
  // unknown project, a profile other than the project's own, no pool provider
  // for a pool project, or a pool with no clones.
  start(request: StartRequest): string;
  // Starts a session with its row unselected, on the harness that declares the
  // request's profile, and sends `message` as its first message; returns the
  // row's sessionId. A request with `unattended` true
  // makes the row deny each permission prompt at once, one with `permissions`
  // passes it to each of the row's process starts and attaches ('default' when
  // left out), and one with `headless` true opens it headless. The request's
  // `instructions` follow the global ones at each of the row's process starts,
  // and its `owner` goes to sessions with the row; both are kept across a clear
  // and a relaunch, and a row with an owner raises no `Turn finished` mark.
  // The request's `controls` open the row as its held mode and confirmed
  // picks, so its first start and each later one pass them.
  // Throws before opening anything on an image chat would refuse to attach,
  // on each target `start` refuses, and on a control id the harness's
  // `startControls` does not declare.
  launch(request: LaunchRequest): string;
  // A launch the session host starts later, as `launch` would start it: the
  // harness's `prepareRun` of a first start under fresh host session, row and
  // process ids, with the global instructions as they stand now, then the
  // request's own, then the headless note when the request is headless, and
  // `env` passed to the harness unchanged; `adopt` opens its row. Opens,
  // starts, records and saves nothing, also after `detachAll`. Rejects where
  // `launch` throws, on an ephemeral or permissive request, and where the
  // harness's `prepareRun` rejects.
  prepareLaunch(
    request: LaunchRequest,
    env: Readonly<Record<string, string>>,
  ): Promise<PreparedLaunch>;
  // Opens the row of a run the session host started from a `prepareLaunch`,
  // unselected under `run.rowId` (a new id when another session holds it), as
  // `restore` opens a saved record that sent a message and has no turn
  // running, with origin `launched`; resolves to its sessionId once its attach
  // settled and, for a resting row, its history was read and its tool calls
  // noted, then saves. A host session id a row already holds opens nothing and
  // resolves to that row, checked before and after the host list, once a
  // resting row chat holds has its history read and its tool calls noted. A
  // control id the harness no longer declares is dropped and logged, never
  // refused. Rejects after `detachAll`, and when the row cannot open.
  adopt(run: AdoptRequest): Promise<string>;
  // `pastSessions` of every folder the project covers under the profile (a
  // folder project's expanded folder, a pool project's clones), each row with
  // its folder, newest first; rows of equal `modified` keep folder order.
  // Rejects for an unknown project, with no pool provider for a pool project,
  // and when any folder's read rejects.
  projectPastSessions(
    project: string,
    profile: string,
  ): Promise<ProjectPastSessionRow[]>;
  // Opens a row for each saved session in order, unselected, under its saved
  // row id, with its saved titles, queued messages and returned messages, then
  // activates the saved selection. Each row runs on its saved harness; a row
  // whose harness is not registered rests waiting on it, as `harnessLeft`
  // leaves a row, and attaches nothing until `harnessReturned`. A row whose
  // process `hosted` lists running in the current host re-attaches to it; any
  // other row rests, unheld when the host may still run its process (`hosted`
  // null: the host list is unknown). With the list unknown a saved busy turn may
  // still run, so it adds no quit-during-turn notice. A record already open in
  // the app is skipped, and stays saved while it holds queued or returned
  // messages, until a row chat holds opens under its host id and takes them over
  // behind its own, adding the record's active time to its clock. A record of a
  // row chat already holds adds its messages and active time to that row.
  // Saving starts here: nothing is saved before it runs.
  restore(
    saved: SavedSessions,
    hosted: readonly HostedProcessInfo[] | null,
  ): void;
  // Reads a restored session's earlier conversation once and puts it before
  // the entries held so far, up to its process's start on a re-attached row,
  // noting the agent of each tool call it holds; does nothing for a session
  // with none pending. It waits out a running attach, and resolves once any
  // read already running has landed. It reads nothing, leaving the history
  // pending for a later call, while the row waits on its harness, while its
  // harness or profile is missing, and while its unheld process runs in
  // another app version or the host cannot be listed.
  loadHistory(sessionId: string): Promise<void>;
  // `loadHistory`, tried again each time the history may have turned readable
  // (a read ended, a harness returned or published new profiles, a row
  // closed, chat stopped) until it resolves: `read` once the history pends no
  // more (read now or earlier, a failed read's notice included, or none
  // pending); `unreadable`, with the reason, while the row's unheld process
  // runs in another app version or the host cannot be listed, since chat
  // cannot see either end; `gone` for a session chat does not hold, one it
  // stops holding while the call waits, and after `detachAll`. A row waiting
  // on its harness, or whose harness or profile is missing, keeps the call
  // waiting until that cause clears.
  loadHistoryWhenReadable(sessionId: string): Promise<HistoryLoad>;
  // The sessions plugin's `titleChanged` event: a row chat holds is saved with
  // its new titles; any other row is left alone.
  titleChanged(sessionId: string): void;
  // The sessions plugin's selection slot: a row chat holds becomes the
  // saved selection; any other row, or none, leaves it as it was.
  selected(sessionId: string | null): void;
  // The folder's saved sessions under the profile, newest first, leaving out
  // every session open in the app on a row chat does not hold or on a row with
  // an owner. When the archived-sessions file cannot be read, every row lists
  // as not archived and the failure is logged; the file is left as it is.
  pastSessions(projectDir: string, profile: string): Promise<PastSessionRow[]>;
  // Each resume section's rows, in registration order, never rejecting for a
  // section's failure: one that fails is logged and left out, as is one with no
  // rows. A section whose `rows` never settles holds the answer. When the
  // archived-sessions file cannot be read, no session counts as archived and the
  // failure is logged.
  resumeSections(): Promise<ResumeSectionRows[]>;
  // Writes the archived flag, then fires `sessionArchived`; a rejected write
  // fires nothing.
  setArchived(hostSessionId: string, archived: boolean): Promise<void>;
  // Opens a row for a saved session, its earlier conversation as the first
  // entries and the request's title as its first-message title, and resumes
  // its process on the request's harness, else on the harness that declares
  // its profile; resolves to the row's sessionId. The request's `instructions`
  // and `owner` are carried as `launch` carries them, and a request with an
  // `owner` opens its row unselected. A session chat holds a row for resolves
  // to that row when the request's owner (none when absent) is the row's,
  // keeping the row's own instructions, and has it activated when it has no
  // owner; one held for another owner rejects, naming both, as does one open in
  // the app on any other row and any after `detachAll`; each holds after each
  // wait as well, so two resumes of one id open one row. It lists
  // the host first, so a session never runs two processes: a process of the
  // session (the last one chat knew to run it, or one whose id starts with its
  // host id) running in the current host has the row open and attach to it,
  // as a restored row does, its history pending; one running in another app
  // version, or a list that rejects, rejects and opens nothing.
  resume(request: ResumeRequest): Promise<string>;
  // Starts a resting session's process first, rejecting when its profile is
  // missing or the start fails; the row then stays resting. A restored row
  // whose earlier conversation is still pending has it read before the start,
  // so the read holds none of this turn. After `detachAll` a resting session
  // starts no process and the message is dropped. A send waits out a running
  // attach, then goes on from its start. On an unheld row it lists the host
  // first: it rejects while that process runs in another app version or the
  // host cannot be listed, and re-attaches when the process runs in the current
  // host, so a session never runs two processes. While the harness reports
  // its turn running, a compaction runs or a hold is up, the message is queued
  // instead, and each `idle` the harness reports writes the oldest queued
  // message not sent now until none is left; a permission request left waiting
  // after the turn ended queues nothing. An idle send asks the send gates once
  // the process runs: a verdict queues the message as the held row and compacts,
  // and the row is written when the compaction ends, whatever its outcome, or
  // when the process's working stretch goes idle with no compaction running; a
  // `compact` that throws writes the message at once. A send at idle in a row
  // holding unsent queued messages queues behind them and writes the oldest. A
  // written message is held until its entry arrives, and returned when the
  // harness reports it dropped. The first message written in a row with no
  // first-message title that its harness reports reached the model sets it, at
  // once from a harness that reports no delivery; a local command sets none. A
  // row waiting on its harness rejects with
  // `<label> is not loaded. Send again once it is.` before anything queues.
  send(sessionId: string, message: UserMessage): Promise<void>;
  // While the harness reports the turn running, with no compaction running and
  // no hold up, writes `message` to the agent at once and plainly, never asking
  // it to take the message in now, so the running turn takes it in after its
  // running tool returns: a `now` write would end that tool. Its row shows in
  // `chat.queued`, marked with the entry id, until the agent takes it in, and
  // never returns to the box. Resolves true at the harness's `messageQueued`
  // or the message's entry with a delivery, false at an entry with none (no
  // lifecycle confirms it), its `messageDropped`, the process's end or the
  // row's close. Otherwise, and when the write throws, it writes and queues
  // nothing and resolves false; `send`'s refusal still rejects. A line already
  // written may still fold into the turn after the caller gave up on it, or run
  // as a turn of its own after an interrupt.
  sendIntoTurn(sessionId: string, message: UserMessage): Promise<boolean>;
  // Adds an app notice to the session's entries, as harness entries travel.
  notice(sessionId: string, text: string, tone: 'info' | 'error'): void;
  // Returns every queued message not sent now, then interrupts the process;
  // messages sent now stay queued. While a hold is up it interrupts and returns
  // nothing, so the compaction ends and the rows go out in order. During an
  // attach it waits for the attach to settle, then does this when the row holds
  // a process.
  interrupt(sessionId: string): void;
  // Ends the session's process, interrupting a running turn first, and starts a
  // fresh one at once as a new conversation with the row's held mode and the
  // model and effort the user picked that a report confirmed; the row moves to
  // the host id the fresh process reports, and `sessionCleared` fires then.
  // Until that report the row keeps its old host id, and is saved with it,
  // its pre-clear `sent` and no process id. A row with no host id yet clears
  // nothing for listeners: no `sessionCleared` follows. Waiting permission
  // requests end with the old process, a running compaction's end goes out as
  // an `interrupted` `agentEvent`, since the old process's own is dropped, and
  // messages written but not taken in and every queued message, the held row
  // included, returned in the order written; the old
  // process raises no exit notice and no turn-finished mark. The entries
  // become one `Conversation cleared` notice. A resting session just starts its
  // fresh process. Throws before changing anything when the profile or harness
  // is missing or while the row attaches; a fresh start that throws leaves the
  // row resting with the clear pending, then rethrows: its next start passes no
  // session id, and that start's report fires `sessionCleared`. An unheld
  // process is left running on the host, since the fresh
  // process shares no transcript with it. A row waiting on its harness throws
  // `send`'s refusal.
  // Logs and does nothing for a session chat does not hold, or after
  // `detachAll`.
  clear(sessionId: string): void;
  // Takes the queued message out of the queue and returns it; logs and sends
  // nothing for one no longer queued or already sent now. On the held row the
  // compaction goes on, and the rows behind wait for its end.
  pullBack(sessionId: string, queuedId: string): void;
  // The page put these returned messages into the session's box: the row holds
  // and saves them no longer.
  returnedPlaced(sessionId: string, returnedIds: readonly string[]): void;
  // Writes the queued message at once and keeps its row, marked with the
  // entry id the write returned, until that entry arrives; logs and sends
  // nothing for one no longer queued or already sent now, and a write that
  // throws leaves the row unsent. On the held row it interrupts as `interrupt`
  // does and writes nothing now. A row waiting on its harness throws `send`'s
  // refusal and writes nothing.
  sendNow(sessionId: string, queuedId: string): void;
  // While the harness reports the turn running, writes every queued message
  // not sent now, oldest first, then `message` as a new last row, each as
  // `sendNow` does, stopping at a write that throws; the same while a compaction
  // runs with no hold up. While a hold is up, queues `message` behind the held row
  // and interrupts as `interrupt` does, writing nothing now. Otherwise sends
  // `message` as `send` does, and a null `message` does nothing. A row waiting
  // on its harness rejects with `send`'s refusal.
  sendAllNow(sessionId: string, message: UserMessage | null): Promise<void>;
  // Throws `send`'s refusal for a row waiting on its harness, and throws for a
  // session chat no longer holds, that has no running process or that is
  // still attaching, as the process's own `setControl` throws for a
  // value it refuses, so the
  // caller learns the change was not made. A model or effort set this way is
  // the user's once a controls report from the same process holds the picked
  // value; every later start in the row then passes its held value. A pick no
  // report confirms before the process ends, or a newer pick replaces, is
  // never passed.
  setControl(sessionId: string, controlId: string, value: string): void;
  // Hands the answer to the permission card `entryId` to the row's process,
  // whose answered entry then replaces the card; logs and does nothing for an
  // entry no request of the row's running process waits on.
  answerPermission(
    sessionId: string,
    entryId: string,
    answer: PermissionAnswer,
  ): void;
  // Closes the row of a session chat holds, for `reason`: fires `sessionClosed`,
  // drops its saved record, ends the process, then the owned session, which
  // drops its row; a resting session has its owned session ended at once.
  // During an attach it waits for the attach to settle first. An unheld process
  // is left running on the host: chat holds nothing to end it with. Any other
  // session id does nothing.
  closed(sessionId: string, reason: SessionCloseReason): void;
  // Kills every process chat holds, a closed session's still ending included,
  // and rests its row with a notice. A row still attaching or an unheld row's
  // process is not stopped.
  stopAll(): void;
  // Detaches every held process, which keeps running on the session host, and
  // kills every other process not yet exited, a closed or cleared session's
  // still ending, for an app quit or a chat plugin reload. A closed row's attach
  // resolving after it is killed too; a held row's is detached. It tries one
  // last save first, a running clock's span up to now included, and returns that
  // write's promise, which never rejects: a write that fails or is cut short
  // leaves the last saved total. Nothing is saved or started after it, and
  // every later process event is ignored. Every `hostSessionIdSettled` call
  // still waiting rejects. A detach or kill that throws skips none of the
  // rest, and the returned promise rejects with the first such error once the
  // save settles; `detachAll` itself never throws.
  detachAll(): Promise<void>;
  // Keeps every held row's owned session through chat's restart
  // (`OwnedSession.keep`), so the restarted chat's restore adopts the rows.
  keepRows(): void;
  // The sessions plugin's `connected` and `hostSessionChanged` events: records
  // the session's current host id as open in the app.
  recordOpenHostId(session: AgentSession): void;
  // The sessions plugin's `ended` event: the session's host id is no longer
  // open.
  sessionEnded(sessionId: string): void;
  // Registers `text` for every process start from now on, in registration
  // order; a running process keeps what it started with. Disposing the
  // registration drops it from later starts; a second dispose does nothing.
  addInstructions(text: string): Disposable;
  // Calls `listener` after each `addInstructions` registration and after each
  // disposal that drops one, until the returned handle is disposed. A listener
  // that throws is logged, and the other listeners and the registration go on.
  onInstructionsChanged(listener: () => void): Disposable;
  // Adds `gate` at the end of the gates an idle send asks, in order: the first
  // non-null verdict holds the send and no later gate is asked, and a gate that
  // throws is logged and counts as null. Each call is its own registration, and
  // its handle removes only it; a second `dispose` does nothing.
  addSendGate(gate: SendGate): Disposable;
  // Registers `read`; each process start from now on asks the newest reader
  // still registered for its `idleCompactMinTokens`, null with none or when it
  // throws, which is logged. Its handle removes only this registration; a second
  // `dispose` does nothing.
  addIdleCompactThreshold(read: () => number | null): Disposable;
  // Starts an app compaction in an idle session chat holds, its process
  // running, with no compaction running and no hold up; the session's
  // `compaction` shows `reason` from now until the compaction ends, and a
  // message sent meanwhile queues behind it. Returns false, logged, and starts
  // nothing for any other session, during an attach, or when the process's
  // `compact` throws.
  compact(sessionId: string, reason: string): boolean;
  // Adds `section` at the end of the sections `resumeSections` asks. Each call is
  // its own registration, and its handle removes only it; a second `dispose` does
  // nothing.
  addResumeSection(section: ResumeSection): Disposable;
  // The harness `harnessId` left the registry: every held row on it waits for
  // it to load again, with the info notice `<label> is not loaded. This session
  // waits for it to load again.`. A row's process is detached and kept as the
  // row's unheld process, except one that has not reported its session id yet
  // or is a clear's fresh process: chat cannot find that one again, so it ends
  // it, logged, and rejects the row's `hostSessionIdSettled` calls. The row
  // rests with no saved-usage read and no exit notice, its queue left as it
  // was, and each permission card still waiting shows as cancelled. A row still
  // attaching does this once its attach settles. Does nothing after
  // `detachAll`.
  harnessLeft(harnessId: string): void;
  // The harness `harnessId` is registered again: each row waiting on it waits
  // no more and loses its waiting notice. A row whose profile the harness no
  // longer declares rests with the missing-profile notice; a row with no unheld
  // process changes nothing more; any other row drops its entries, re-attaches
  // through the harness's `attach` as a relaunch does (the older-host guard
  // included) and reads its earlier conversation at once. Resolves once each
  // row's step has settled; logs and changes nothing when the registry holds no
  // such harness, and after `detachAll`.
  harnessReturned(harnessId: string): Promise<void>;
  // The harness `harnessId`, still registered, published its declarations
  // again, its profiles among them: each `loadHistoryWhenReadable` call still
  // waiting tries its row again, so a row whose profile came back reads.
  // Does nothing after `detachAll`.
  harnessRefreshed(harnessId: string): void;
}

export const UNATTENDED_REASON =
  'This session runs unattended: nobody answers its permission prompts, so the app denied this tool call. Work without it, and report what it would have done.';

// The answer a waiting permission card shows once chat lets go of its process,
// its harness gone or its attach failed: no answer reaches the request.
export const PERMISSION_CANCELLED_REASON =
  'The tool call was cancelled before the user answered.';

// A permission card waiting on the user: the `processStart`th process's
// request `requestId`.
interface PendingPermission {
  processStart: number;
  requestId: string;
}

interface WrittenMessage {
  message: UserMessage;
  order: number;
}

// `process` is null whenever the session rests, and while the harness's
// `start` or `attach` runs.
interface HeldSession {
  sessionId: string;
  slots: SessionSlots;
  owned: OwnedSession;
  // Null for a new session from its open until its harness reports an id.
  hostId: string | null;
  // The origin of the `sessionOpened` a row opened with no host id fires once
  // its harness reports an id; null when none is pending.
  pendingOpened: SessionOrigin | null;
  // A clear whose fresh process has not reported its id: the row keeps its old
  // host id until then, and `sent` is the row's before the clear.
  pendingClear: { sent: boolean } | null;
  // The `hostSessionIdSettled` calls waiting on the harness's report.
  hostIdWaiters: {
    resolve(hostId: string): void;
    reject(error: Error): void;
  }[];
  process: AgentProcess | null;
  // A message was ever sent, so a start resumes the conversation.
  sent: boolean;
  // A restored session ever sent to whose earlier conversation is not read
  // yet.
  historyPending: boolean;
  // The read of the earlier conversation while it runs.
  historyRead: Promise<void> | null;
  harnessActivity: ProcessActivity;
  // Ids of the subagents and background tasks the running process has started
  // that have not finished.
  backgroundIds: Set<string>;
  // By the card's row entry id.
  pending: Map<string, PendingPermission>;
  noticeCount: number;
  // Messages ever queued in this row, numbering their ids.
  queuedCount: number;
  // Messages ever returned to the box in this row, numbering their ids.
  returnedCount: number;
  // Messages ever queued, or written with no queued row, in this row,
  // stamping each with its place in the order written.
  heldCount: number;
  // Each queued row's id → its stamp from `heldCount`, until no path can read
  // that row's order again.
  rowOrders: Map<string, number>;
  // Harness entry id → each message written with no queued row, with its
  // stamp from `heldCount`, until its entry arrives; ids restart with each
  // process.
  writtenMessages: Map<string, WrittenMessage>;
  // Harness entry id → the text of each message written in this process while
  // the row had no first-message title, and whether its entry arrived `sent`,
  // until its delivery shows whether it titles the row.
  titleCandidates: Map<string, { text: string; wasSent: boolean }>;
  // Harness entry ids of the queued rows sent `now` in this process; a sent row
  // whose id is missing here was written plainly.
  sentNowIds: Set<string>;
  // Harness entry id → the settle of each `sendIntoTurn` message written in
  // this row, until the agent queues, takes in or drops it, or its process
  // ends.
  intoTurnWaiters: Map<string, (isQueued: boolean) => void>;
  // Ids of the queued rows `sendIntoTurn` wrote; none returns to the box.
  intoTurnRowIds: Set<string>;
  // Processes started in this row, the one running included.
  processStarts: number;
  // Control id → the value the user picked in this row that a report confirmed,
  // until a report holds no value for that control. A start passes these and no
  // other model or effort. Saved with the row.
  confirmedPicks: Map<string, string>;
  // Control id → the value the user picked that the running process has not
  // reported yet.
  pendingPicks: Map<string, string>;
  // Since the last idle, the process ran an app compaction, a hold's or
  // `compact`'s, and no message was written to it, so that idle ends no turn.
  isOnlyAppCompaction: boolean;
  // The reason of the app compaction starting or running, a hold's or
  // `compact`'s, until that compaction ends.
  compactionReason: string | null;
  // How the process exited, once its `ended` arrives; a user close logs it.
  exit: { code: number | null; error: string | null } | null;
  // Branch reads started in this row, numbering them; only the latest applies.
  branchReads: number;
  // The clone's linked worktree roots, from the latest worktree read, each
  // under git's spelling and under the row folder's.
  worktreeRoots: readonly string[];
  // Worktree reads started in this row, numbering them; only the latest applies.
  worktreeReads: number;
  // The command of each Bash call the row has seen, each text once.
  bashCommands: Set<string>;
  // The id of the row's last process start or attach; never cleared, so after
  // an exit it still names the ended process.
  processId: string | null;
  // What the row's last process start passed as `controls` and `resume`, which
  // an attach passes again, and whether it carried the headless note: no pipe
  // line reports them. `launchHeadless` is the opening's flag before the
  // row's first start.
  launchControls: Record<string, string>;
  launchResume: boolean;
  launchHeadless: boolean;
  // Entry ids of the messages the row's last process start dropped that went
  // back to the page: a re-attach replays those drops.
  returnedDrops: Set<string>;
  // The `before` of the pending history read: the attached process's start;
  // null when the row replayed nothing.
  historyBefore: number | null;
  // The running attach; resolves after its result is applied, to the
  // rejection's error text, or null when it did not reject. Never rejects.
  attaching: Promise<string | null> | null;
  // The latest attach's replay, over once its attach settles.
  replay: { isReplaying: boolean };
  // `stopAll` killed the running process, so its `ended` says so.
  isStopRequested: boolean;
  // A process the host may still run for this row while chat holds no process
  // object for it.
  unheldProcessId: string | null;
  // The running guard step for `unheldProcessId`.
  unheldSettling: Promise<void> | null;
  // The harness the row waits on to load again, and the id of its waiting
  // notice once shown; null while the row's harness is loaded. Not saved.
  waiting: { harnessId: string; noticeId: string | null } | null;
  // The profile folder of the row's last process start or attach; null before
  // the first.
  processProfileDir: string | null;
  // Nobody answers this row: each permission prompt is denied at once, and a
  // finished turn raises no mark. Saved with the row, kept across a clear.
  unattended: boolean;
  // The launch mode each of the row's process starts and attaches passes.
  // Saved with the row, kept across a clear.
  permissions: AgentStart['permissions'];
  // The row is headless; mirrored in `chat.session`. Saved with the row, kept
  // across a clear.
  headless: boolean;
  // Texts the row's process starts carry after the global ones. Saved with the
  // row, kept across a clear.
  instructions: readonly string[];
  // The plugin the row belongs to, passed to sessions at open; null for none.
  // Saved with the row, kept across a clear.
  owner: string | null;
  // A process start records the row's folder in the recent folders; false for
  // a row started from a project, whose folder the Project step already offers,
  // and for an ephemeral row.
  recordsRecentFolder: boolean;
  // The row leaves no trace a later app run shows: it is never saved, and its
  // events carry `ephemeral: true`. Kept across a clear and a relaunch.
  ephemeral: boolean;
}

// Where a start resolved to: a folder, from a folder, a folder project or a
// pool project's lowest-numbered clone.
interface ResolvedTarget {
  projectDir: string;
  isProject: boolean;
}

// The flags a new row opens with, as `HeldSession` keeps them, and the
// controls its first process starts with, by control id.
interface StartFlags {
  unattended: boolean;
  permissions: AgentStart['permissions'];
  headless: boolean;
  instructions: readonly string[];
  owner: string | null;
  controls: Readonly<Record<string, string>>;
  ephemeral: boolean;
}

// What one guard step on an unheld process leaves its caller to do: whether a
// pending history read goes on, the error a send rejects with, and whether the
// process runs in another app version.
interface UnheldSettled {
  readsHistory: boolean;
  refusal: string | null;
  runsElsewhere: boolean;
}

// One try at a restored row's history: a `HistoryLoad`, or `pending` while a
// cause this app can see clear (a harness wait, a missing harness or profile)
// keeps it unread.
type HistoryTry = HistoryLoad | { kind: 'pending' };

// Why an unheld row's guard step leaves its history unreadable in this app:
// its process runs in another app version, or the host cannot be listed; null
// otherwise.
function unheldUnreadableReason(settled: UnheldSettled): string | null {
  if (settled.runsElsewhere) {
    return 'its process runs in another app version';
  }
  if (!settled.readsHistory && settled.refusal !== null) {
    return `the session host cannot be listed: ${settled.refusal}`;
  }
  return null;
}

const QUIT_DURING_TURN_TEXT =
  'The app quit during this turn. Your next message resumes this session.';

const OLDER_HOST_NOTICE_TEXT =
  'This session is finishing its turn in another app version. Send a message once it ends.';

const OLDER_HOST_REFUSAL_TEXT =
  'This session is still finishing in another app version. Send again once it ends.';

const STOPPED_TEXT = 'Session stopped. Your next message resumes this session.';

// The notice a row waiting on the harness labelled `harnessLabel` shows.
export function harnessWaitingText(harnessLabel: string): string {
  return `${harnessLabel} is not loaded. This session waits for it to load again.`;
}

// The error a send to a row waiting on its harness rejects with.
export function harnessRefusalText(harnessLabel: string): string {
  return `${harnessLabel} is not loaded. Send again once it is.`;
}

function missingProfileText(name: string, harnessLabel: string): string {
  return `Profile ${name} is not declared by ${harnessLabel}; add it back to resume this session.`;
}

function exitNoticeText(
  harnessLabel: string,
  code: number | null,
  error: string | null,
): string {
  const exitCode = code === null ? 'unknown' : String(code);
  const reason = error === null ? '' : `: ${error}`;
  return `${harnessLabel} stopped (exit code ${exitCode})${reason}. Your next message resumes this session.`;
}

// A harness numbers entry ids per process, so a row's later processes reuse
// its first process's ids; each start after the first gets its own prefix.
function rowEntryId(harnessEntryId: string, processStart: number): string {
  return processStart === 1
    ? harnessEntryId
    : `process-${processStart}:${harnessEntryId}`;
}

function rowEntryOf(entry: ChatEntry, processStart: number): ChatEntry {
  return { ...entry, id: rowEntryId(entry.id, processStart) };
}

// The launch values a process starts with, keyed by control id: the held
// value of the control whose role is `permissionMode` (a held mode narrows
// nothing, so a start passes it whoever set it), and each other control's
// confirmed pick.
function controlValuesOf(
  controls: readonly SessionControl[],
  confirmedPicks: ReadonlyMap<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const value =
      control.role === CONTROL_ROLES.permissionMode
        ? control.value
        : confirmedPicks.get(control.id);
    if (value !== null && value !== undefined) {
      values[control.id] = value;
    }
  }
  return values;
}

// The controls and confirmed picks a row opens with for a launch's `values`:
// none for no values; else the harness's start controls, each holding its
// value or null, and every value but the `permissionMode` role's as a confirmed pick, so
// `controlValuesOf` passes them all at each start. Throws on an id the harness
// does not declare; the harness checks the values.
function openingControlsOf(
  harness: AgentHarness,
  values: Readonly<Record<string, string>>,
): { controls: SessionControl[]; confirmedPicks: Record<string, string> } {
  const ids = Object.keys(values);
  if (ids.length === 0) {
    return { controls: [], confirmedPicks: {} };
  }
  const declared = harness.startControls();
  requireDeclaredControls(declared, values);
  return {
    controls: declared.map((control) => ({
      ...control,
      value: values[control.id] ?? null,
    })),
    confirmedPicks: Object.fromEntries(
      ids
        .filter(
          (id) =>
            declared.find((control) => control.id === id)?.role !==
            CONTROL_ROLES.permissionMode,
        )
        .map((id) => [id, values[id]]),
    ),
  };
}

// Throws naming the first id of `values` that `declared` holds no control
// for, and every id it holds.
function requireDeclaredControls(
  declared: readonly SessionControl[],
  values: Readonly<Record<string, string>>,
) {
  const declaredIds = declared.map((control) => control.id);
  const unknownId = Object.keys(values).find((id) => !declaredIds.includes(id));
  if (unknownId !== undefined) {
    throw new Error(
      `Unknown control "${unknownId}". Controls: ${declaredIds.join(', ')}.`,
    );
  }
}

// Throws the refusal of the first image of `message` chat would refuse to
// attach.
function requireAttachableImages(message: UserMessage) {
  for (const image of message.images) {
    const refusal = refusalOf(image.mediaType, image.data.length);
    if (refusal !== null) {
      throw new Error(refusal);
    }
  }
}

// `run.controls` without the ids the harness no longer declares, logging each
// one it drops.
function declaredControlValuesOf(
  run: AdoptRequest,
  harness: AgentHarness,
  log: PluginLog,
): Record<string, string> {
  const declaredIds = new Set(
    harness.startControls().map((control) => control.id),
  );
  const values: Record<string, string> = {};
  for (const [id, value] of Object.entries(run.controls)) {
    if (declaredIds.has(id)) {
      values[id] = value;
    } else {
      log(
        `session ${run.hostSessionId}: control "${id}" dropped, the harness no longer declares it`,
      );
    }
  }
  return values;
}

// The saved record `restore` would open an adopted run's row from: a first
// start that sent its message, with no turn running and nothing queued, its
// declared controls opened as a launch's.
function adoptedRecordOf(
  run: AdoptRequest,
  harness: AgentHarness | null,
  log: PluginLog,
): SavedSession {
  // A harness not registered yet declares no controls: the row opens with
  // none, and its launch controls still hold the run's.
  const { controls, confirmedPicks } =
    harness === null
      ? { controls: [], confirmedPicks: {} }
      : openingControlsOf(harness, declaredControlValuesOf(run, harness, log));
  return {
    hostSessionId: run.hostSessionId,
    projectDir: run.projectDir,
    harness: run.harness,
    profile: run.profile,
    sent: true,
    busy: false,
    titles: run.titles,
    processId: run.processId,
    queued: [],
    returned: [],
    launchControls: { ...run.controls },
    launchResume: false,
    launchHeadless: run.headless,
    controls,
    confirmedPicks,
    returnedDrops: [],
    activeMs: 0,
    rowId: run.rowId,
    unattended: run.unattended,
    permissions: 'default',
    headless: run.headless,
    instructions: [...run.instructions],
    owner: run.owner,
  };
}

// Moves each pending pick whose control `controls` holds at the picked value
// into `confirmedPicks`.
function confirmPicks(
  controls: readonly SessionControl[],
  pendingPicks: Map<string, string>,
  confirmedPicks: Map<string, string>,
) {
  for (const control of controls) {
    const pick = pendingPicks.get(control.id);
    const isConfirmed = pick !== undefined && pick === control.value;
    if (isConfirmed) {
      pendingPicks.delete(control.id);
      confirmedPicks.set(control.id, pick);
    }
  }
}

// Drops the confirmed pick of each control `controls` holds no value for.
function dropPicksOfUnsetControls(
  controls: readonly SessionControl[],
  confirmedPicks: Map<string, string>,
) {
  for (const control of controls) {
    if (control.value === null) {
      confirmedPicks.delete(control.id);
    }
  }
}

function userMessageOf(held: UserMessage): UserMessage {
  return { text: held.text, images: held.images };
}

function rowOrderOf(session: HeldSession, row: QueuedMessage): number {
  const order = session.rowOrders.get(row.id);
  if (order === undefined) {
    throw new Error(`queued message ${row.id} has no write order`);
  }
  return order;
}

function isUnsent(queued: QueuedMessage): boolean {
  return queued.sentEntryId === null;
}

function isHeldRow(queued: QueuedMessage): boolean {
  return queued.holdReason !== null;
}

function isHoldUp(session: HeldSession): boolean {
  return session.slots.queued().some(isHeldRow);
}

function shownActivity(held: HeldSession): ProcessActivity {
  return held.pending.size > 0 ? 'waiting' : held.harnessActivity;
}

function processEndReasonOf(
  isStopRequested: boolean,
  isCleanExit: boolean,
): ProcessEndReason {
  if (isStopRequested) {
    return 'stopped';
  }
  return isCleanExit ? 'clean' : 'crash';
}

// The `ephemeral` key a row's events carry: present only for an ephemeral row.
function ephemeralKeyOf(ephemeral: boolean): { ephemeral?: true } {
  return ephemeral ? { ephemeral: true } : {};
}

// `sent` as listeners and the saved file know it: the row's before a pending
// clear.
function reportedSent(session: HeldSession): boolean {
  return session.pendingClear?.sent ?? session.sent;
}

// The session's record under `hostId`, its held host id.
function savedSessionOf(
  session: HeldSession,
  hostId: string,
  titles: SessionTitles,
  now: number,
): SavedSession {
  const { projectDir, harness, profile, activity, activeTime } =
    session.slots.info();
  return {
    hostSessionId: hostId,
    projectDir,
    harness,
    profile,
    sent: reportedSent(session),
    busy: activity !== 'idle',
    titles,
    // A clear's fresh process runs a conversation other than `hostId`.
    processId: session.pendingClear === null ? session.processId : null,
    queued: session.slots.queued().filter(isUnsent).map(userMessageOf),
    returned: session.slots.returned().map(userMessageOf),
    launchControls: session.launchControls,
    launchResume: session.launchResume,
    launchHeadless: session.launchHeadless,
    controls: session.slots.controls(),
    confirmedPicks: Object.fromEntries(session.confirmedPicks),
    returnedDrops: [...session.returnedDrops],
    activeMs: activeMsAt(activeTime, now),
    rowId: session.sessionId,
    unattended: session.unattended,
    permissions: session.permissions,
    headless: session.headless,
    instructions: [...session.instructions],
    owner: session.owner,
  };
}

// The first-message title held for a message: a pasted wall of text stays out
// of every state, and the row cuts it further. Leading whitespace goes before
// the cap, so a message opening on a wall of blanks still keeps its text. A
// message from another session's agent is titled from the text after its frame
// line.
const FIRST_MESSAGE_TITLE_CAP = 200;

function firstMessageTitleOf(text: string): string {
  const titled = readAgentFrame(text)?.body ?? text;
  return [...titled.trimStart()].slice(0, FIRST_MESSAGE_TITLE_CAP).join('');
}

// A row's owner as a resume's rejection names it.
function ownerName(owner: string | null): string {
  return owner ?? 'no owner';
}

// The error sessions' `open` throws when another session holds `rowId`.
function isRowIdHeldError(error: unknown, rowId: string): boolean {
  return (
    error instanceof Error &&
    error.message === `Session ${rowId} is already open`
  );
}

// Chat's owned sessions: each one's agent process while it runs, its chat
// entries, controls and commands, the activity it shows, the permission
// requests waiting on the user, the messages queued behind its running turn
// or its compaction, the compaction running and the send gates that start
// one, and the messages written to the agent it has not taken in yet;
// the folder's saved sessions it can resume; and
// the open sessions it saves across a relaunch, re-attaching to each process
// the session host still runs, as it does when a harness that left registers
// again. A session's state lives in the slots
// (`session.slots`), which creation clears of the rows an earlier run left,
// and `send` carries only the moment a row rests.
export function createChatSessions(deps: ChatSessionsDeps): ChatSessions {
  const { sessions, send, log } = deps;
  // Insertion order is open order, the sidebar's order for chat's rows.
  const held = new Map<string, HeldSession>();
  // Row id → host session id of every session open in the app, owned or not.
  const openHostIds = new Map<string, string>();
  // Host session id → the id of the last process chat knew to run that
  // conversation, from each report, attach and restored record, so `resume`
  // finds a process still running whatever its id starts with. It lives one
  // chat run: after a reload, a process no saved record names is found by its
  // id's `<host id>-` prefix alone.
  const processIdsOfHost = new Map<string, string>();
  // Every started process until its `ended`, held or closed.
  const running = new Set<AgentProcess>();
  // Row id of the last row chat holds that was selected.
  let selectedRowId: string | null = null;
  // Saving waits for the restore, so no save overwrites the saved records
  // before they are read; it stops for good at `detachAll`.
  let isRestored = false;
  let isDetached = false;
  // Resolved, then replaced, each time a pending history may have turned
  // readable; a `loadHistoryWhenReadable` call takes it before each try, so a
  // change that lands while the try runs still sends it round again.
  let historyChance = Promise.withResolvers<void>();
  // Records the restore skipped that hold queued or returned messages, saved
  // unchanged so the next app start tries them again.
  let skippedRecords: SavedSession[] = [];
  // A restart keeps a plugin's slots: a row the restore does not open again
  // would stay in them.
  deps.slots.dropKept();
  // One object per `addInstructions` call, in registration order.
  const instructionRegistrations = new Set<{ text: string }>();
  const instructionListeners = createListeners<void>();
  // One object per `addSendGate` call, in registration order.
  const sendGateRegistrations = new Set<{ gate: SendGate }>();
  // One object per `addIdleCompactThreshold` call, in registration order.
  const idleCompactRegistrations = new Set<{ read: () => number | null }>();
  // One object per `addResumeSection` call, in registration order.
  const resumeSectionRegistrations = new Set<{ section: ResumeSection }>();

  // A row whose harness has not reported a host id yet is left out: a start
  // that fails leaves no record. An ephemeral row is left out, and when it is
  // selected the saved selection is null.
  function snapshot(): SavedSessions {
    const now = deps.clock.now();
    const records = [...held.values()].flatMap((session) =>
      session.hostId === null || session.ephemeral
        ? []
        : [
            savedSessionOf(
              session,
              session.hostId,
              sessions.titles(session.sessionId) ?? NO_TITLES,
              now,
            ),
          ],
    );
    const selected =
      selectedRowId === null ? undefined : held.get(selectedRowId);
    const selectedHostSessionId =
      selected === undefined || selected.ephemeral ? null : selected.hostId;
    return {
      sessions: [...records, ...skippedRecords],
      selectedHostSessionId,
    };
  }

  function writeSaved(): Promise<void> {
    if (!isRestored || isDetached) {
      return Promise.resolve();
    }
    return deps.saved
      .save(snapshot())
      .catch((error: unknown) =>
        log(`open sessions not saved: ${errorText(error)}`),
      );
  }

  function save() {
    void writeSaved();
  }

  // Held, and `processStart` is its running process, until `detachAll`.
  function isLive(session: HeldSession, processStart: number): boolean {
    return (
      !isDetached &&
      held.get(session.sessionId) === session &&
      session.slots.info().running &&
      session.processStarts === processStart
    );
  }

  // The harness reports the turn running.
  function isTurnRunning(session: HeldSession): boolean {
    return session.slots.info().running && session.harnessActivity !== 'idle';
  }

  // A message sent now queues rather than being written.
  function waits(session: HeldSession): boolean {
    return (
      isTurnRunning(session) ||
      session.slots.info().compaction !== null ||
      isHoldUp(session)
    );
  }

  // The session's held state while its process runs, or null after logging
  // that the call was ignored.
  function liveFor(method: string, sessionId: string): HeldSession | null {
    const session = held.get(sessionId) ?? null;
    if (session === null) {
      log(`${method} for unknown session ${sessionId} ignored`);
      return null;
    }
    if (!session.slots.info().running) {
      log(`${method} for resting session ${sessionId} ignored`);
      return null;
    }
    return session;
  }

  // The session's next app notice, numbered and stamped now.
  function nextNotice(
    session: HeldSession,
    text: string,
    tone: 'info' | 'error',
  ): ChatEntry {
    session.noticeCount += 1;
    return {
      kind: 'notice',
      id: `app-notice-${session.noticeCount}`,
      at: deps.clock.now(),
      text,
      tone,
      raw: [],
    };
  }

  function addNotice(
    session: HeldSession,
    text: string,
    tone: 'info' | 'error',
  ) {
    session.slots.putEntry(nextNotice(session, text, tone));
  }

  function markTurnFinished(session: HeldSession) {
    const { sessionId, projectDir } = session.slots.info();
    const label = sessions.label(sessionId) ?? path.basename(projectDir);
    sessions.mark(sessionId, {
      text: `Turn finished in ${label}`,
      action: 'read it',
    });
  }

  // Keeps the ids of the subagents and background tasks still running, so a
  // turn that ends while any runs marks nothing.
  function trackBackground(session: HeldSession, event: AgentEvent) {
    const ids = session.backgroundIds;
    if (event.type === 'agentSpawned') {
      ids.add(event.agentId);
    }
    if (event.type === 'taskStarted') {
      ids.add(event.taskId);
    }
    if (event.type === 'agentFinished') {
      ids.delete(event.agentId);
    }
    if (event.type === 'taskFinished') {
      ids.delete(event.taskId);
    }
    if (event.type === 'sessionEnded') {
      ids.clear();
    }
    writeBackground(session);
  }

  function clearBackground(session: HeldSession) {
    session.backgroundIds.clear();
    writeBackground(session);
  }

  // Writes the count of background work only when it changed.
  function writeBackground(session: HeldSession) {
    const background = session.backgroundIds.size;
    if (background === session.slots.info().background) {
      return;
    }
    session.slots.setInfo({ background });
    updateActiveTime(session);
  }

  // Starts or stops the session's clock after a change to its activity or
  // background count; writes and saves only when the clock changed. A replay
  // moves neither: a held attach's end settles the clock once, and a failed
  // attach leaves it paused.
  function updateActiveTime(session: HeldSession) {
    if (session.replay.isReplaying) {
      return;
    }
    const now = deps.clock.now();
    const info = session.slots.info();
    const current = info.activeTime;
    const next = isWorkRunning(info)
      ? startActiveTime(current, now)
      : stopActiveTime(current, now);
    if (next === current) {
      return;
    }
    session.slots.setInfo({ activeTime: next });
    save();
  }

  // A replayed turn's end marks nothing, since it ended while the app was
  // closed, and neither does one `stopAll` caused, an idle with a hold up, whose
  // row is still to go out, the end of a stretch that ran only an app
  // compaction, or any turn of an unattended row or a row with an owner.
  function updateActivity(session: HeldSession, isReplayed = false) {
    const previous = session.slots.info().activity;
    const activity = shownActivity(session);
    if (activity === previous) {
      return;
    }
    session.slots.setInfo({ activity });
    const { sessionId } = session;
    updateActiveTime(session);
    const turnFinished = activity === 'idle' && previous !== 'idle';
    const turnStarted = activity !== 'idle' && previous === 'idle';
    // Read before the emit: a `turnFinished` listener may start the next
    // stretch's compaction.
    const ranATurn = !isHoldUp(session) && !session.isOnlyAppCompaction;
    if (turnFinished) {
      session.isOnlyAppCompaction = false;
    }
    if (turnStarted && !isReplayed) {
      deps.emit('turnStarted', { sessionId });
    }
    if (turnFinished && !isReplayed) {
      deps.emit('turnFinished', { sessionId, how: 'idle' });
    }
    const userIsElsewhere =
      !deps.window.isFocused() || deps.selectedSessionId() !== sessionId;
    const workIsOver = session.backgroundIds.size === 0;
    const isTheTurnsOwnEnd = !isReplayed && !session.isStopRequested;
    if (
      turnFinished &&
      userIsElsewhere &&
      workIsOver &&
      isTheTurnsOwnEnd &&
      ranATurn &&
      !session.unattended &&
      session.owner === null
    ) {
      markTurnFinished(session);
    }
    if (turnFinished || turnStarted) {
      save();
    }
  }

  // A resting session runs no turn, so it shows idle; unlike a turn going
  // idle, its exit marks nothing, and a crossing outside a replay fires
  // `turnFinished` as `rested`.
  function showRestingIdle(session: HeldSession) {
    session.harnessActivity = 'idle';
    if (session.slots.info().activity === 'idle') {
      return;
    }
    session.slots.setInfo({ activity: 'idle' });
    updateActiveTime(session);
    if (!session.replay.isReplaying) {
      deps.emit('turnFinished', {
        sessionId: session.sessionId,
        how: 'rested',
      });
    }
  }

  // Hands `decision` to the request `requestId` of the row's `processStart`th
  // process, once a running attach has settled; nothing when the row has moved
  // on to a later process.
  function answerRequest(
    session: HeldSession,
    processStart: number,
    requestId: string,
    decision: PermissionDecision,
  ) {
    void afterAttach(session, () => {
      if (session.processStarts === processStart) {
        session.process?.answerPermission(requestId, decision);
      }
    });
  }

  // Puts messages in `chat.returned` for the page to place in the box. Each stays
  // in the slot and the row's record until the page reports it placed: with no
  // page to hear the write, the page reads it at mount.
  function returnToBox(session: HeldSession, messages: readonly UserMessage[]) {
    const returned = messages.map((message): ReturnedMessage => {
      session.returnedCount += 1;
      return {
        ...userMessageOf(message),
        id: `returned-${session.returnedCount}`,
      };
    });
    session.slots.setReturned([...session.slots.returned(), ...returned]);
    save();
  }

  // Empties the queue and the written messages, and returns every message they
  // held to the box in the order written, rows sent now or not; writes nothing
  // when both are empty.
  function returnAllHeld(session: HeldSession) {
    const queued = session.slots.queued();
    const held: WrittenMessage[] = [
      ...session.writtenMessages.values(),
      ...queued
        .filter((row) => !isIntoTurnRow(session, row))
        .map((row) => ({
          message: userMessageOf(row),
          order: rowOrderOf(session, row),
        })),
    ];
    const messages = held
      .sort((a, b) => a.order - b.order)
      .map((written) => written.message);
    session.writtenMessages.clear();
    if (queued.length > 0) {
      for (const row of queued) {
        session.rowOrders.delete(row.id);
        session.intoTurnRowIds.delete(row.id);
      }
      session.slots.setQueued([]);
      save();
    }
    if (messages.length > 0) {
      returnToBox(session, messages);
    }
  }

  // Takes every row not sent now out of the queue and returns its message to the
  // box, oldest first; writes nothing when none is unsent.
  function returnUnsent(session: HeldSession) {
    const queued = session.slots.queued();
    const unsent = queued.filter(isUnsent);
    if (unsent.length === 0) {
      return;
    }
    for (const row of unsent) {
      session.rowOrders.delete(row.id);
    }
    session.slots.setQueued(queued.filter((row) => !isUnsent(row)));
    save();
    returnToBox(session, unsent);
  }

  // Writes the oldest queued message not sent now to the agent; false when
  // none is queued, a hold is up, a compaction runs, or the write throws, which
  // puts it back at its place.
  function writeNextQueued(session: HeldSession): boolean {
    if (isHoldUp(session) || session.slots.info().compaction !== null) {
      return false;
    }
    const queued = session.slots.queued();
    const index = queued.findIndex(isUnsent);
    if (index === -1) {
      return false;
    }
    const next = queued[index];
    session.slots.setQueued(queued.filter((row) => row.id !== next.id));
    save();
    try {
      deliverWritten(session, userMessageOf(next), rowOrderOf(session, next));
    } catch (error) {
      const restored = [...session.slots.queued()];
      restored.splice(index, 0, next);
      session.slots.setQueued(restored);
      save();
      log(`queued message ${next.id} not sent: ${errorText(error)}`);
      return false;
    }
    session.rowOrders.delete(next.id);
    return true;
  }

  // Writes the row's message and marks it with the entry id the write
  // returned; false when the write throws, which leaves it unsent. While a
  // turn runs it asks the agent to take the message in now, unless
  // `asksNow` is false. It writes plainly
  // during a compaction, so the compaction is not cut short; for slash text,
  // which may start one (`/compact`); behind a plainly written message the
  // agent has not taken in, which a `now` message would run ahead of
  // (claude-stream.md § Send now); and on a harness that does not declare
  // `midTurnSend`, or is not registered, where the message waits for the turn's
  // end.
  function writeRowNow(
    session: HeldSession,
    row: QueuedMessage,
    asksNow = true,
  ): boolean {
    const info = session.slots.info();
    const takesMidTurnSend =
      deps.harnesses.get(info.harness)?.info().capabilities.midTurnSend ===
      true;
    const isNow =
      asksNow &&
      isTurnRunning(session) &&
      info.compaction === null &&
      !row.text.trimStart().startsWith('/') &&
      !hasPlainWriteWaiting(session) &&
      takesMidTurnSend;
    let sentEntryId: string;
    try {
      sentEntryId = deliver(session, userMessageOf(row), isNow);
    } catch (error) {
      log(`queued message ${row.id} not sent: ${errorText(error)}`);
      return false;
    }
    if (isNow) {
      session.sentNowIds.add(sentEntryId);
    }
    const sentRow = { ...row, sentEntryId };
    session.slots.setQueued(
      session.slots
        .queued()
        .map((queued) => (queued.id === row.id ? sentRow : queued)),
    );
    return true;
  }

  function hasPlainWriteWaiting(session: HeldSession): boolean {
    return (
      session.writtenMessages.size > 0 ||
      session.slots
        .queued()
        .some(
          (queued) =>
            queued.sentEntryId !== null &&
            !session.sentNowIds.has(queued.sentEntryId),
        )
    );
  }

  function setCompaction(
    session: HeldSession,
    compaction: SessionCompaction | null,
  ) {
    session.slots.setInfo({ compaction });
  }

  // Forgets the session's compaction and any hold's reason; writes `compaction`
  // only when one ran.
  function forgetCompaction(session: HeldSession) {
    session.compactionReason = null;
    if (session.slots.info().compaction !== null) {
      setCompaction(session, null);
    }
  }

  // Forgets the compaction of a process chat is letting go of, whose own
  // `compactionEnded` fails `isLive`, and emits its end in that one's place;
  // a null `profileDir`, a row that never ran a process, emits nothing.
  function clearCompaction(session: HeldSession, profileDir: string | null) {
    const running = session.slots.info().compaction;
    const { hostId } = session;
    forgetCompaction(session);
    if (running === null || hostId === null || profileDir === null) {
      return;
    }
    deps.emit('agentEvent', {
      sessionId: session.sessionId,
      profileDir,
      hostSessionId: hostId,
      event: {
        type: 'compactionEnded',
        at: deps.clock.now(),
        trigger: running.trigger,
        outcome: 'interrupted',
        beforeTokens: null,
        durationMs: null,
      },
      replayed: false,
    });
  }

  // Makes the held row an ordinary unsent row at its place; returns its id, or
  // null with no hold up.
  function releaseHeldRow(session: HeldSession): string | null {
    const queued = session.slots.queued();
    const row = queued.find(isHeldRow);
    if (row === undefined) {
      return null;
    }
    const released = { ...row, holdReason: null };
    session.slots.setQueued(
      queued.map((held) => (held.id === row.id ? released : held)),
    );
    save();
    return row.id;
  }

  function compactionStarted(
    session: HeldSession,
    event: Extract<AgentEvent, { type: 'compactionStarted' }>,
  ) {
    setCompaction(session, {
      trigger: event.trigger,
      reason: event.trigger === 'app' ? session.compactionReason : null,
      startedAt: event.at,
    });
  }

  // A replayed end acts on nothing that already happened: the attach's end
  // drains the queue. A stopped process takes no more.
  function compactionEnded(
    session: HeldSession,
    outcome: Extract<AgentEvent, { type: 'compactionEnded' }>['outcome'],
    isReplaying: boolean,
  ) {
    const { sessionId } = session;
    forgetCompaction(session);
    const releasedId = releaseHeldRow(session);
    if (releasedId !== null) {
      log(`held message ${releasedId} released in ${sessionId} (${outcome})`);
    }
    const writesNext =
      !isReplaying &&
      !session.isStopRequested &&
      session.harnessActivity === 'idle';
    if (writesNext) {
      writeNextQueued(session);
    }
  }

  // A hold whose process goes idle with no compaction running has no end coming:
  // its row becomes an ordinary one, and a later `compactionEnded` finds no hold.
  function releaseHoldWithNoCompaction(session: HeldSession) {
    const releasedId = releaseHeldRow(session);
    log(
      `held message ${releasedId} released in ${session.sessionId}: idle with no compaction`,
    );
  }

  // Interrupts the process so the running compaction ends and the held row and
  // those behind it go out.
  function skipCompaction(session: HeldSession) {
    session.process?.interrupt();
    log(`skipping the compaction in ${session.sessionId}`);
  }

  // The agent took in the message written under `entryId`: a sent row for it
  // leaves the queue, and a written message is held no longer. A `sendIntoTurn`
  // call waiting on it settles true only for `entry` carrying a delivery: a
  // harness reporting no lifecycle gives the entry at the write, which confirms
  // nothing.
  function takeIn(session: HeldSession, entry: ChatEntry) {
    session.writtenMessages.delete(entry.id);
    const isConfirmed = entry.kind === 'user' && entry.delivery !== null;
    settleIntoTurn(session, entry.id, isConfirmed);
    dropSentRow(session, entry.id);
  }

  // Settles the `sendIntoTurn` call waiting on `entryId`, if any.
  function settleIntoTurn(
    session: HeldSession,
    entryId: string,
    isQueued: boolean,
  ) {
    const settle = session.intoTurnWaiters.get(entryId);
    if (settle !== undefined) {
      session.intoTurnWaiters.delete(entryId);
      settle(isQueued);
    }
  }

  // Settles every `sendIntoTurn` call still waiting as not queued.
  function settleEveryIntoTurn(session: HeldSession) {
    const settles = [...session.intoTurnWaiters.values()];
    session.intoTurnWaiters.clear();
    for (const settle of settles) {
      settle(false);
    }
  }

  function isIntoTurnRow(session: HeldSession, row: QueuedMessage): boolean {
    return session.intoTurnRowIds.has(row.id);
  }

  // The row sent now under `entryId`, if any, leaves the queue for good.
  function dropSentRow(session: HeldSession, entryId: string) {
    const queued = session.slots.queued();
    const sent = queued.find((row) => row.sentEntryId === entryId);
    if (sent !== undefined) {
      session.rowOrders.delete(sent.id);
      session.intoTurnRowIds.delete(sent.id);
      session.slots.setQueued(queued.filter((row) => row.id !== sent.id));
      save();
    }
  }

  // The agent dropped `message`, written under `entryId`, without taking it in:
  // its sent row leaves the queue, and it goes back to the page once per process,
  // unless `sendIntoTurn` wrote it. A message written before a relaunch has no
  // row and no written record here.
  function returnDropped(
    session: HeldSession,
    entryId: string,
    message: UserMessage,
  ) {
    const intoTurnRow = session.slots
      .queued()
      .find(
        (row) => row.sentEntryId === entryId && isIntoTurnRow(session, row),
      );
    settleIntoTurn(session, entryId, false);
    if (intoTurnRow !== undefined) {
      session.intoTurnRowIds.delete(intoTurnRow.id);
      dropSentRow(session, entryId);
      log(`message ${entryId} sent into the turn dropped: never taken in`);
      return;
    }
    if (session.returnedDrops.has(entryId)) {
      log(`dropped message ${entryId} already returned`);
      return;
    }
    session.returnedDrops.add(entryId);
    session.writtenMessages.delete(entryId);
    dropSentRow(session, entryId);
    returnToBox(session, [message]);
    log(`sent message ${entryId} returned: never taken in`);
  }

  // The slots close first, so every later event for the session writes no slot
  // and fails `isLive`; its queue goes with them, returned nowhere. Every
  // `hostSessionIdSettled` still waiting rejects.
  function drop(session: HeldSession) {
    session.slots.close();
    held.delete(session.sessionId);
    historyMayBeReadable();
    session.pending.clear();
    settleEveryIntoTurn(session);
    rejectHostIdWaiters(
      session,
      `session ${session.sessionId} closed before its harness reported a session id`,
    );
  }

  // Rejects every `hostSessionIdSettled` call waiting on the row with `text`.
  function rejectHostIdWaiters(session: HeldSession, text: string) {
    const error = new Error(text);
    for (const waiter of session.hostIdWaiters.splice(0)) {
      waiter.reject(error);
    }
  }

  // Runs before the owned session ends: a resting row's titles end with it. A
  // row whose harness never reported a host id fired no `sessionOpened`, so it
  // fires no `sessionClosed`.
  function fireSessionClosed(session: HeldSession, reason: SessionCloseReason) {
    const { sessionId, projectDir, profile } = session.slots.info();
    const { hostId } = session;
    if (hostId === null) {
      return;
    }
    deps.emit('sessionClosed', {
      sessionId,
      hostSessionId: hostId,
      projectDir,
      profile,
      titles: sessions.titles(sessionId) ?? NO_TITLES,
      sent: reportedSent(session),
      headless: session.headless,
      reason,
      ...ephemeralKeyOf(session.ephemeral),
    });
  }

  // The harness emits `ended` before `end()` resolves, so the exit is known here.
  function logCloseExit(session: HeldSession) {
    const { sessionId } = session;
    if (session.exit === null) {
      log(`session ${sessionId} closed; no exit reported`);
      return;
    }
    const { code, error } = session.exit;
    log(
      `session ${sessionId} closed (code ${code}${error === null ? '' : `, error: ${error}`})`,
    );
  }

  // The events of the row's `processStart`th process, started or attached
  // under `profileDir` on the harness labelled `harnessLabel`;
  // `started.process` is that process once the harness's `start` returns or
  // its `attach` settles. While `replay.isReplaying` holds, events
  // show the session's state and act on nothing that already happened. A
  // permission request shows as a waiting card, pending by its row entry id
  // until chat answers it or its answered entry arrives; an unattended row
  // denies it at once and shows only the answered entry. The process's reported
  // session id comes before its other events, and a live one moves the row to
  // it (`adoptHostId`).
  function processEvents(
    session: HeldSession,
    processStart: number,
    started: { process: AgentProcess | null },
    profileDir: string,
    harnessLabel: string,
    replay: { isReplaying: boolean },
  ): AgentProcessEvents {
    const { sessionId } = session;
    // This process's own host id: a clear moves the row to a new one while this
    // process still ends.
    let hostSessionId = session.hostId;
    return {
      sessionId(id) {
        hostSessionId = id;
        if (isLive(session, processStart)) {
          adoptHostId(session, id, profileDir);
        }
      },
      entry(entry) {
        if (!isLive(session, processStart)) {
          return;
        }
        const rowEntry = rowEntryOf(entry, processStart);
        session.slots.putEntry(rowEntry);
        takeIn(session, entry);
        if (entry.kind === 'user') {
          settleTitleCandidate(session, entry.id, entry.delivery);
        }
        noteBashCommand(session, entry, replay.isReplaying);
        const isAnsweredCard =
          entry.kind === 'permission' && entry.answer !== null;
        if (isAnsweredCard && session.pending.delete(rowEntry.id)) {
          updateActivity(session, replay.isReplaying);
        }
      },
      permission(request) {
        if (!isLive(session, processStart)) {
          return;
        }
        const requestId = request.entry.id;
        if (session.unattended) {
          answerRequest(session, processStart, requestId, {
            allowed: false,
            reason: UNATTENDED_REASON,
          });
          return;
        }
        const card = rowEntryOf(request.entry, processStart);
        session.slots.putEntry(card);
        session.pending.set(card.id, { processStart, requestId });
        updateActivity(session, replay.isReplaying);
      },
      controls(controls) {
        if (isLive(session, processStart)) {
          confirmPicks(controls, session.pendingPicks, session.confirmedPicks);
          dropPicksOfUnsetControls(controls, session.confirmedPicks);
          session.slots.setControls(controls);
          save();
        }
      },
      pid(pid) {
        if (isLive(session, processStart)) {
          session.slots.setInfo({ pid });
        }
      },
      activity(activity) {
        if (!isLive(session, processStart)) {
          return;
        }
        // A queued message starts the next turn, so the session shows no idle
        // in between and the turn-finished mark waits for the last one. A
        // stopped process takes no more.
        const writesNext =
          !replay.isReplaying &&
          !session.isStopRequested &&
          activity === 'idle';
        // A fresh process's first idle can precede `compact`'s working stretch.
        const isHoldStranded =
          writesNext &&
          session.harnessActivity !== 'idle' &&
          isHoldUp(session) &&
          session.slots.info().compaction === null;
        if (isHoldStranded) {
          releaseHoldWithNoCompaction(session);
        }
        if (writesNext && writeNextQueued(session)) {
          return;
        }
        session.harnessActivity = activity;
        updateActivity(session, replay.isReplaying);
      },
      commands(commands) {
        if (
          !isLive(session, processStart) ||
          isSameJson(session.slots.commands(), commands)
        ) {
          return;
        }
        session.slots.setCommands([...commands]);
      },
      planUsage(update) {
        if (isLive(session, processStart) && !replay.isReplaying) {
          deps.emit('planUsage', { profileDir, update });
        }
      },
      agentEvent(event) {
        // A closed row's process still ends, and its log and roster close on
        // its `sessionEnded`.
        const endsTheSession = event.type === 'sessionEnded' && !isDetached;
        const isLiveEvent = isLive(session, processStart);
        // A replayed call too, so a subagent's call from while the app was
        // closed still reads as that subagent's.
        if (isLiveEvent && event.type === 'toolStarted') {
          deps.toolCallers.noteToolStarted(
            sessionId,
            event.toolUseId,
            event.agentId,
          );
        }
        const isReported = isLiveEvent || endsTheSession;
        if (isReported && hostSessionId !== null) {
          deps.emit('agentEvent', {
            sessionId,
            profileDir,
            hostSessionId,
            event,
            // The replay's fold emits no `sessionEnded`, so one here is a real
            // exit.
            replayed: replay.isReplaying && event.type !== 'sessionEnded',
          });
        }
        if (isLiveEvent) {
          trackBackground(session, event);
          if (event.type === 'fileWritten') {
            noteWorktree(session, event.path);
          }
        }
        const endsALiveTurn = isLiveEvent && event.type === 'turnEnded';
        if (endsALiveTurn && !replay.isReplaying) {
          readBranch(session);
          readWorktreeRoots(session);
        }
        if (isLiveEvent && event.type === 'compactionStarted') {
          compactionStarted(session, event);
        }
        if (isLiveEvent && event.type === 'compactionEnded') {
          compactionEnded(session, event.outcome, replay.isReplaying);
        }
      },
      // The agent queued a written message: a `sendIntoTurn` call waiting on
      // it settles.
      messageQueued(entryId) {
        if (isLive(session, processStart)) {
          settleIntoTurn(session, entryId, true);
        }
      },
      // Returns a written message the agent let go without taking it in.
      messageDropped(entryId, message) {
        if (isLive(session, processStart)) {
          session.titleCandidates.delete(entryId);
          returnDropped(session, entryId, message);
        }
      },
      ended({ code, error }) {
        // A close drops the row before its process ends, so the exit is
        // recorded for the row's latest process whether or not it is live.
        if (session.processStarts === processStart) {
          session.exit = { code, error };
        }
        if (started.process !== null) {
          running.delete(started.process);
        }
        if (!isLive(session, processStart)) {
          return;
        }
        log(`session ${sessionId} ended (code ${code})`);
        if (error !== null) {
          log(`session ${sessionId} failed: ${error}`);
        }
        // The row and its state stay, resting, until the user closes the row.
        // The harness ended any running compaction before `sessionEnded`.
        session.slots.setInfo({ running: false, pid: null });
        session.process = null;
        settleEveryIntoTurn(session);
        forgetCompaction(session);
        // The process sent each waiting card's cancelled entry before `ended`.
        session.pending.clear();
        if (session.hostId === null || session.pendingClear !== null) {
          rejectHostIdWaiters(
            session,
            `session ${sessionId} ended before its harness reported a session id`,
          );
        }
        // During a replay the queue holds only saved messages, which stay saved.
        if (!replay.isReplaying) {
          returnAllHeld(session);
        }
        const isCleanExit = code === 0 && error === null;
        if (session.isStopRequested) {
          addNotice(session, STOPPED_TEXT, 'info');
        } else {
          addNotice(
            session,
            exitNoticeText(harnessLabel, code, error),
            isCleanExit ? 'info' : 'error',
          );
        }
        send('sessionRested', { sessionId, error });
        clearBackground(session);
        showRestingIdle(session);
        save();
        if (!replay.isReplaying && hostSessionId !== null) {
          deps.emit('processEnded', {
            sessionId,
            hostSessionId,
            reason: processEndReasonOf(session.isStopRequested, isCleanExit),
            code,
            error,
            ...ephemeralKeyOf(session.ephemeral),
          });
        }
      },
    };
  }

  // The harness the row runs on; throws naming it when it is not registered.
  const harnessOfRow = (session: HeldSession) =>
    requireHarness(deps.harnesses, session.slots.info().harness);

  // The row's profile as `harness` declares it; throws naming it when the
  // harness does not.
  const profileOfRow = (session: HeldSession, harness: AgentHarness) =>
    requireProfile(
      deps.harnesses.profilesOf(harness.id),
      session.slots.info().profile,
    );

  function profileDirOf(profile: HarnessProfile): string {
    return profile.configDir;
  }

  // Opens the row for `opening.hostId` on the harness `harnessId` as `options`
  // says, gives it each title `opening.titles` holds, and holds its state,
  // resting, with `entries`. `profileDir` is null when the harness is not
  // registered or does not declare the profile; such a row emits no
  // `sessionOpened`. A null `opening.hostId` opens a row
  // for a new conversation, whose `sessionOpened` waits for its harness's
  // report (`adoptHostId`).
  function openRow(
    projectDir: string,
    harnessId: string,
    profileName: string,
    profileDir: string | null,
    opening: {
      hostId: string | null;
      entries: ChatEntry[];
      sent: boolean;
      historyPending: boolean;
      titles: SessionTitles;
      processId: string | null;
      launchControls: Record<string, string>;
      launchResume: boolean;
      launchHeadless: boolean;
      controls: SessionControl[];
      confirmedPicks: Record<string, string>;
      returnedDrops: readonly string[];
      activeMs: number;
      origin: SessionOrigin;
      unattended: boolean;
      permissions: AgentStart['permissions'];
      headless: boolean;
      instructions: readonly string[];
      owner: string | null;
      recordsRecentFolder: boolean;
      ephemeral: boolean;
    },
    options: OpenOptions,
  ): HeldSession {
    const { hostId, owner } = opening;
    const owned = sessions.open(
      {
        sessionId: hostId,
        projectDir,
        harness: harnessId,
        rowId: null,
        ...(profileDir === null ? {} : { profileDir }),
      },
      owner === null ? options : { ...options, owner },
    );
    const sessionId = owned.session.id;
    for (const source of TITLE_SOURCES) {
      const title = opening.titles[source];
      if (title !== null) {
        sessions.setTitle(sessionId, source, title);
      }
    }
    if (profileDir !== null && hostId !== null) {
      emitSessionOpened(
        { sessionId, hostSessionId: hostId, projectDir },
        profileName,
        profileDir,
        opening.origin,
        opening.ephemeral,
      );
    }
    const pendingOpened =
      profileDir !== null && hostId === null ? opening.origin : null;
    // The sessions plugin writes its selection inside `open`, before the row is
    // held, so `selected` cannot record it.
    if (options.select) {
      selectedRowId = sessionId;
    }
    const session: HeldSession = {
      sessionId,
      slots: deps.slots.open({
        sessionId,
        projectDir,
        harness: harnessId,
        profile: profileName,
        entries: opening.entries,
        controls: opening.controls,
        activity: 'idle',
        background: 0,
        activeTime: { totalMs: opening.activeMs, since: null },
        commands: [],
        running: false,
        pid: null,
        queued: [],
        compaction: null,
        returned: [],
        repo: path.basename(projectDir),
        branch: null,
        worktrees: [],
        headless: opening.headless,
      }),
      owned,
      hostId,
      pendingOpened,
      pendingClear: null,
      hostIdWaiters: [],
      process: null,
      sent: opening.sent,
      historyPending: opening.historyPending,
      historyRead: null,
      harnessActivity: 'idle',
      backgroundIds: new Set(),
      pending: new Map(),
      noticeCount: 0,
      queuedCount: 0,
      returnedCount: 0,
      heldCount: 0,
      rowOrders: new Map(),
      writtenMessages: new Map(),
      titleCandidates: new Map(),
      sentNowIds: new Set(),
      intoTurnWaiters: new Map(),
      intoTurnRowIds: new Set(),
      processStarts: 0,
      confirmedPicks: new Map(Object.entries(opening.confirmedPicks)),
      pendingPicks: new Map(),
      isOnlyAppCompaction: false,
      compactionReason: null,
      exit: null,
      branchReads: 0,
      worktreeRoots: [],
      worktreeReads: 0,
      bashCommands: new Set(),
      processId: opening.processId,
      launchControls: opening.launchControls,
      launchResume: opening.launchResume,
      returnedDrops: new Set(opening.returnedDrops),
      historyBefore: null,
      attaching: null,
      replay: { isReplaying: false },
      isStopRequested: false,
      unheldProcessId: null,
      unheldSettling: null,
      waiting: null,
      processProfileDir: null,
      unattended: opening.unattended,
      permissions: opening.permissions,
      headless: opening.headless,
      launchHeadless: opening.launchHeadless,
      instructions: opening.instructions,
      owner,
      recordsRecentFolder: opening.recordsRecentFolder,
      ephemeral: opening.ephemeral,
    };
    held.set(sessionId, session);
    takeOverSkipped(session);
    readBranch(session);
    readWorktreeRoots(session);
    return session;
  }

  // The row's process reported `id` as its session id, under `profileDir`:
  // chat notes the process as `id`'s, and the row moves to it, fires the
  // `sessionOpened` or `sessionCleared` it held back, settles its
  // `hostSessionIdSettled` waiters and saves. A move with no clear pending
  // forgets the process as the old id's: it now runs `id`. An id another
  // session holds is logged and leaves the row as it was.
  function adoptHostId(session: HeldSession, id: string, profileDir: string) {
    const { sessionId, pendingClear } = session;
    if (session.processId !== null) {
      processIdsOfHost.set(id, session.processId);
    }
    if (id === session.hostId && pendingClear === null) {
      return;
    }
    try {
      session.owned.setHostSessionId(id);
    } catch (error) {
      log(`session ${sessionId} not moved to host ${id}: ${errorText(error)}`);
      return;
    }
    const oldHostId = session.hostId;
    session.hostId = id;
    session.pendingClear = null;
    const isStaleEntry =
      pendingClear === null &&
      oldHostId !== null &&
      processIdsOfHost.get(oldHostId) === session.processId;
    if (isStaleEntry) {
      processIdsOfHost.delete(oldHostId);
    }
    const { projectDir, profile } = session.slots.info();
    const origin = session.pendingOpened;
    if (origin !== null) {
      session.pendingOpened = null;
      emitSessionOpened(
        { sessionId, hostSessionId: id, projectDir },
        profile,
        profileDir,
        origin,
        session.ephemeral,
      );
    }
    if (pendingClear !== null && oldHostId !== null) {
      deps.emit('sessionCleared', {
        sessionId,
        oldHostSessionId: oldHostId,
        newHostSessionId: id,
        projectDir,
        profile,
        titles: sessions.titles(sessionId) ?? NO_TITLES,
        sent: pendingClear.sent,
        ...ephemeralKeyOf(session.ephemeral),
      });
    }
    for (const waiter of session.hostIdWaiters.splice(0)) {
      waiter.resolve(id);
    }
    save();
  }

  function emitSessionOpened(
    row: { sessionId: string; hostSessionId: string; projectDir: string },
    profileName: string,
    profileDir: string,
    origin: SessionOrigin,
    ephemeral: boolean,
  ) {
    deps.emit('sessionOpened', {
      ...row,
      profileDir,
      profile: profileName,
      origin,
      ...ephemeralKeyOf(ephemeral),
    });
  }

  // The row's own record replaces any skipped one for its host id, and the row
  // takes over the active time and messages that record held.
  function takeOverSkipped(session: HeldSession) {
    const { hostId } = session;
    const records = skippedRecords.filter(
      (record) => record.hostSessionId === hostId,
    );
    skippedRecords = skippedRecords.filter(
      (record) => record.hostSessionId !== hostId,
    );
    takeSavedActiveTime(session, records);
    takeSavedMessages(session, records);
  }

  // Adds the active time `records` saved to the session's clock.
  function takeSavedActiveTime(
    session: HeldSession,
    records: readonly SavedSession[],
  ) {
    const savedMs = records.reduce((sum, record) => sum + record.activeMs, 0);
    if (savedMs === 0) {
      return;
    }
    const { activeTime } = session.slots.info();
    session.slots.setInfo({
      activeTime: { ...activeTime, totalMs: activeTime.totalMs + savedMs },
    });
  }

  // Queues what `records` saved, behind any row the session holds, and returns
  // to the box what they saved as not yet placed.
  function takeSavedMessages(
    session: HeldSession,
    records: readonly SavedSession[],
  ) {
    const queued = records.flatMap((record) => record.queued);
    if (queued.length > 0) {
      for (const message of queued) {
        appendQueued(session, message);
      }
      save();
    }
    const returned = records.flatMap((record) => record.returned);
    if (returned.length > 0) {
      returnToBox(session, returned);
    }
  }

  // Adds the worktree holding `filePath` to the row's worktrees, when it is in
  // one.
  function noteWorktree(session: HeldSession, filePath: string) {
    const name = worktreeNameOf(filePath);
    if (name !== null) {
      addWorktree(session, name);
    }
  }

  // Adds `name` to the row's worktrees when the row does not list it yet.
  function addWorktree(session: HeldSession, name: string) {
    const { worktrees } = session.slots.info();
    if (!worktrees.includes(name)) {
      session.slots.setInfo({ worktrees: [...worktrees, name] });
    }
  }

  // Lists each worktree a Bash call's command names. A call that ran
  // `git worktree` reads the roots again, so a worktree it made lists in the
  // same turn.
  function noteBashCommand(
    session: HeldSession,
    entry: ChatEntry,
    isReplaying: boolean,
  ) {
    if (entry.kind !== 'tool' || entry.name !== 'Bash') {
      return;
    }
    const command = bashCommandOf(entry.input);
    if (command === null) {
      return;
    }
    session.bashCommands.add(command);
    for (const name of worktreesInCommand(command, session.worktreeRoots)) {
      addWorktree(session, name);
    }
    const ranAWorktreeCommand =
      entry.result !== null && runsGitWorktree(command);
    if (ranAWorktreeCommand && !isReplaying) {
      readWorktreeRoots(session);
    }
  }

  // Reads the clone's linked worktree roots, and lists each worktree not yet
  // listed that a seen Bash command names under them. A read that a later one
  // started after, or that settles after the row closed or `detachAll`,
  // changes nothing; a failed read keeps the roots the row had.
  function readWorktreeRoots(session: HeldSession) {
    session.worktreeReads += 1;
    const read = session.worktreeReads;
    const { projectDir } = session.slots.info();
    linkedWorktreeRootsOf(projectDir).then(
      (roots) => {
        const isLatestRead =
          held.get(session.sessionId) === session &&
          session.worktreeReads === read;
        if (isDetached || !isLatestRead) {
          return;
        }
        session.worktreeRoots = roots;
        const { worktrees } = session.slots.info();
        let unlisted = roots.filter(
          (root) => !worktrees.includes(path.basename(root)),
        );
        for (const command of session.bashCommands) {
          if (unlisted.length === 0) {
            break;
          }
          const names = worktreesInCommand(command, unlisted);
          for (const name of names) {
            addWorktree(session, name);
          }
          unlisted = unlisted.filter(
            (root) => !names.includes(path.basename(root)),
          );
        }
      },
      (error: unknown) =>
        log(
          `worktrees not read in ${path.basename(projectDir)}: ${errorText(error)}`,
        ),
    );
  }

  // The top folder of each linked worktree of the clone holding `projectDir`,
  // under git's spelling and `projectDir`'s (`rootSpellings`, from the resolved
  // path of `projectDir` and each folder above it); [] outside a clone.
  async function linkedWorktreeRootsOf(projectDir: string): Promise<string[]> {
    const top = await deps.git.topLevel(projectDir);
    if (top === null) {
      return [];
    }
    const [worktrees, folders] = await Promise.all([
      deps.git.worktrees(top),
      resolvedFoldersUp(projectDir),
    ]);
    const roots = worktrees
      .filter((worktree) => !worktree.isMain)
      .map((worktree) => worktree.path);
    return rootSpellings(roots, folders, deps.paths);
  }

  // `folder` and each folder above it, deepest first, each with its resolved
  // path.
  function resolvedFoldersUp(folder: string): Promise<ResolvedFolder[]> {
    const folders: string[] = [];
    for (
      let each = folder;
      !folders.includes(each);
      each = deps.paths.parent(each)
    ) {
      folders.push(each);
    }
    return Promise.all(
      folders.map(async (each) => ({
        folder: each,
        realFolder: await deps.files.realPath(each),
      })),
    );
  }

  // Reads the row's repo and branch, and writes them when either changed.
  // A read that a later one started after, or that settles after the row
  // closed or `detachAll`, changes nothing.
  function readBranch(session: HeldSession) {
    session.branchReads += 1;
    const read = session.branchReads;
    const { projectDir } = session.slots.info();
    const folderName = path.basename(projectDir);
    repoAndBranchOf(projectDir, folderName).then(
      ({ repo, branch }) => {
        const isLatestRead =
          held.get(session.sessionId) === session &&
          session.branchReads === read;
        const info = session.slots.info();
        const changed = repo !== info.repo || branch !== info.branch;
        if (isDetached || !isLatestRead || !changed) {
          return;
        }
        session.slots.setInfo({ repo, branch });
      },
      (error: unknown) =>
        log(`branch not read in ${folderName}: ${errorText(error)}`),
    );
  }

  // The clone's top folder's name and its branch; the folder's own name and
  // no branch outside a clone.
  async function repoAndBranchOf(
    projectDir: string,
    folderName: string,
  ): Promise<{ repo: string; branch: string | null }> {
    const top = await deps.git.topLevel(projectDir);
    if (top === null) {
      return { repo: folderName, branch: null };
    }
    return {
      repo: path.basename(top),
      branch: await deps.git.currentBranch(projectDir),
    };
  }

  // Numbers the row's next process. A pick still pending, the background work,
  // a stop request, a hold's stretch and the title candidates belong to the old
  // process and are dropped.
  function beginProcess(session: HeldSession) {
    session.processStarts += 1;
    session.sentNowIds.clear();
    session.titleCandidates.clear();
    session.pendingPicks.clear();
    clearBackground(session);
    session.isStopRequested = false;
    session.isOnlyAppCompaction = false;
  }

  // Starts the session's process with the held mode and the confirmed picks,
  // and records the folder unless the row came from a project; a throw from
  // the harness leaves the session resting. The process id starts with the
  // conversation's host id when the start names one, so a later resume finds
  // the process, and with the row id for a new conversation.
  function startProcess(
    session: HeldSession,
    harness: AgentHarness,
    profile: HarnessProfile,
    resume: boolean,
  ) {
    const { sessionId, projectDir } = session.slots.info();
    beginProcess(session);
    const started: { process: AgentProcess | null } = { process: null };
    const profileDir = profileDirOf(profile);
    session.processProfileDir = profileDir;
    const hostId = session.pendingClear !== null ? null : session.hostId;
    const idPrefix = hostId ?? session.sessionId;
    session.processId = `${idPrefix}-${session.processStarts}-${deps.clock.now()}`;
    session.launchControls = controlValuesOf(
      session.slots.controls(),
      session.confirmedPicks,
    );
    session.launchResume = resume;
    session.launchHeadless = session.headless;
    session.returnedDrops.clear();
    const process = harness.start(
      {
        processId: session.processId,
        sessionId: hostId,
        resume,
        projectDir,
        profileDir,
        controls: session.launchControls,
        instructions: currentInstructions(session),
        idleCompactMinTokens: currentIdleCompactMinTokens(sessionId),
        rowId: sessionId,
        permissions: session.permissions,
      },
      processEvents(
        session,
        session.processStarts,
        started,
        profileDir,
        harness.info().label,
        { isReplaying: false },
      ),
    );
    started.process = process;
    session.process = process;
    session.exit = null;
    running.add(process);
    session.slots.setInfo({ running: true, pid: null });
    log(`session ${sessionId} process started (resume ${resume})`);
    if (session.recordsRecentFolder) {
      deps.recent
        .record(projectDir, harness.id, profile.name)
        .catch((error: unknown) =>
          log(`recent folders not saved: ${errorText(error)}`),
        );
    }
  }

  // The global texts in registration order, then `own`, then the headless
  // note when `headless`.
  function instructionsOf(own: readonly string[], headless: boolean): string[] {
    const texts = [
      ...[...instructionRegistrations].map((registration) => registration.text),
      ...own,
    ];
    return headless ? [...texts, HEADLESS_NOTE] : texts;
  }

  // The session's own texts after the global ones, then the headless note
  // while the row is headless.
  function currentInstructions(session: HeldSession): string[] {
    return instructionsOf(session.instructions, session.headless);
  }

  // The newest reader's value, or null with no reader or after logging its throw.
  function currentIdleCompactMinTokens(sessionId: string): number | null {
    const newest = [...idleCompactRegistrations].at(-1);
    if (newest === undefined) {
      return null;
    }
    try {
      return newest.read();
    } catch (error) {
      log(
        `idle compaction threshold failed in ${sessionId}: ${errorText(error)}`,
      );
      return null;
    }
  }

  // Attaches the row to the process the host lists as `hosted`, replaying what
  // it has done so far. The returned promise, also held as `attaching` until it
  // settles, never rejects: it resolves once the result is applied, to a
  // rejection's error text, or null when the attach did not reject. `busy` adds
  // the quit-during-turn notice when no process stays.
  function attachProcess(
    session: HeldSession,
    harness: AgentHarness,
    profile: HarnessProfile,
    hosted: HostedProcessInfo,
    busy: boolean,
  ): Promise<string | null> {
    const { sessionId, projectDir } = session.slots.info();
    beginProcess(session);
    session.exit = null;
    session.processId = hosted.id;
    if (session.hostId !== null) {
      processIdsOfHost.set(session.hostId, hosted.id);
    }
    session.historyBefore = hosted.startedAt;
    session.slots.setInfo({ running: true, pid: null });
    const started: { process: AgentProcess | null } = { process: null };
    const replay = { isReplaying: true };
    session.replay = replay;
    const profileDir = profileDirOf(profile);
    session.processProfileDir = profileDir;
    const attaching = harness
      .attach(
        {
          processId: hosted.id,
          sessionId: session.hostId,
          resume: session.launchResume,
          projectDir,
          profileDir,
          controls: session.launchControls,
          instructions: currentInstructions(session),
          idleCompactMinTokens: null,
          rowId: sessionId,
          permissions: session.permissions,
        },
        processEvents(
          session,
          session.processStarts,
          started,
          profileDir,
          harness.info().label,
          replay,
        ),
      )
      .then(
        (process) => {
          session.attaching = null;
          if (process === null) {
            // The replay stays on while the row rests, so clearing its
            // background count does not start the clock.
            restAfterFailedAttach(
              session,
              profile,
              `process ${hosted.id} is not running`,
              busy,
            );
            replay.isReplaying = false;
          } else {
            replay.isReplaying = false;
            holdAttached(session, process, started);
          }
          return null;
        },
        (error: unknown) => {
          session.attaching = null;
          const reason = errorText(error);
          // The host may still run the process, whatever the row does next, so
          // the turn may still run and no quit notice is added.
          if (!isDetached && session.exit === null) {
            session.unheldProcessId = hosted.id;
          }
          restAfterFailedAttach(session, profile, reason, false);
          replay.isReplaying = false;
          return reason;
        },
      );
    session.attaching = attaching;
    return attaching;
  }

  // An `ended` during the replay already rested the row, and the hosted process
  // has closed. A closed row keeps the process only for `closed` to end; after
  // `detachAll` its record is gone and the user asked it to end, so it is
  // killed.
  // A row whose harness left during the attach lets the process go, detached.
  function holdAttached(
    session: HeldSession,
    process: AgentProcess,
    started: { process: AgentProcess | null },
  ) {
    const { sessionId } = session;
    if (isDetached) {
      if (held.get(sessionId) === session) {
        process.detach();
      } else {
        process.kill();
      }
      return;
    }
    if (session.exit !== null) {
      return;
    }
    const waitsOnHarness =
      session.waiting !== null && held.get(sessionId) === session;
    if (waitsOnHarness) {
      cancelWaitingCards(session);
      restDetached(session, process);
      return;
    }
    started.process = process;
    session.process = process;
    running.add(process);
    if (held.get(sessionId) !== session) {
      return;
    }
    log(`session ${sessionId} re-attached to process ${session.processId}`);
    updateActiveTime(session);
    if (session.harnessActivity === 'idle') {
      writeNextQueued(session);
    }
  }

  // Rests a row whose attach found no process to hold, with no exit notice,
  // and shows each permission card the replay left waiting as cancelled. A
  // row that ended during the replay or closed is only logged. A row waiting
  // on its harness reads no saved usage: the harness is gone.
  function restAfterFailedAttach(
    session: HeldSession,
    profile: HarnessProfile,
    reason: string,
    busy: boolean,
  ) {
    if (isDetached) {
      return;
    }
    const { sessionId } = session;
    log(`session ${sessionId} not re-attached: ${reason}`);
    if (held.get(sessionId) !== session || session.exit !== null) {
      return;
    }
    session.slots.setInfo({ running: false, pid: null });
    session.process = null;
    session.historyBefore = null;
    clearCompaction(session, profileDirOf(profile));
    clearBackground(session);
    cancelWaitingCards(session);
    showRestingIdle(session);
    send('sessionRested', { sessionId, error: null });
    if (busy) {
      addNotice(session, QUIT_DURING_TURN_TEXT, 'info');
    }
    if (session.sent && session.waiting === null) {
      restoreSavedUsageOrLog(session, profile);
    }
    save();
  }

  // Lets go of the row's process, which keeps running on the session host as
  // the row's unheld process, and rests the row as a failed attach does, with
  // no saved-usage read and no notice. A process whose conversation has no
  // settled host id (none reported yet, or a clear's fresh process) leaves
  // nothing a return could resume, so it is ended instead, once the row
  // rests, and the row's `hostSessionIdSettled` calls reject.
  function restDetached(session: HeldSession, process: AgentProcess) {
    const { sessionId } = session;
    const isResumable =
      session.hostId !== null && session.pendingClear === null;
    if (isResumable) {
      process.detach();
      running.delete(process);
      session.unheldProcessId = session.processId;
    }
    session.slots.setInfo({ running: false, pid: null });
    session.process = null;
    session.historyBefore = null;
    clearCompaction(session, session.processProfileDir);
    clearBackground(session);
    showRestingIdle(session);
    send('sessionRested', { sessionId, error: null });
    save();
    if (isResumable) {
      log(
        `session ${sessionId} let go of process ${session.processId}: its harness left`,
      );
    } else {
      endWithNoHostId(session, process);
    }
  }

  // Ends the process of a resting row whose harness left before the row
  // settled on a host id, logged, and rejects the row's `hostSessionIdSettled`
  // calls. The row no longer runs, so the process's `ended` is not live.
  function endWithNoHostId(session: HeldSession, process: AgentProcess) {
    const { sessionId } = session;
    process
      .end()
      .catch((error: unknown) =>
        log(`session ${sessionId} end failed: ${errorText(error)}`),
      );
    log(
      `session ${sessionId} ended process ${session.processId}: its harness left before it reported a session id`,
    );
    rejectHostIdWaiters(
      session,
      `session ${sessionId} ended before its harness reported a session id`,
    );
  }

  // Shows each permission card still waiting as cancelled: its request went
  // with a process chat no longer holds, which no answer reaches.
  function cancelWaitingCards(session: HeldSession) {
    const entries = session.slots.entries();
    for (const cardId of session.pending.keys()) {
      const card = entries.find((entry) => entry.id === cardId);
      if (card?.kind === 'permission') {
        session.slots.putEntry({
          ...card,
          answer: { allowed: false, reason: PERMISSION_CANCELLED_REASON },
        });
      }
    }
    session.pending.clear();
  }

  // Adds the waiting notice of the harness the row waits on, unless the row
  // waits no more, closed, or chat is stopping.
  function showWaitingNotice(session: HeldSession) {
    const { waiting } = session;
    const isRowGone = held.get(session.sessionId) !== session || isDetached;
    if (waiting === null || isRowGone) {
      return;
    }
    const notice = nextNotice(
      session,
      harnessWaitingText(deps.harnessLabelOf(waiting.harnessId)),
      'info',
    );
    session.slots.putEntry(notice);
    waiting.noticeId = notice.id;
  }

  function removeWaitingNotice(session: HeldSession) {
    const noticeId = session.waiting?.noticeId ?? null;
    if (noticeId === null) {
      return;
    }
    session.slots.replaceEntries(
      session.slots.entries().filter((entry) => entry.id !== noticeId),
    );
  }

  // The row waits on `harnessId`: its process, if any, is let go detached (or
  // ended, when it has no settled host id: `restDetached`) and the row rests,
  // after its running attach when one runs.
  function waitOnHarness(session: HeldSession, harnessId: string) {
    session.waiting = { harnessId, noticeId: null };
    log(`session ${session.sessionId} waits for harness ${harnessId}`);
    if (session.attaching !== null) {
      void afterAttach(session, () => showWaitingNotice(session));
      return;
    }
    cancelWaitingCards(session);
    if (session.process !== null) {
      restDetached(session, session.process);
    }
    showWaitingNotice(session);
  }

  function harnessLeft(harnessId: string) {
    if (isDetached) {
      log(`harness ${harnessId} left; chat is stopping`);
      return;
    }
    for (const session of held.values()) {
      const isOnHarness =
        session.slots.info().harness === harnessId && session.waiting === null;
      if (isOnHarness) {
        waitOnHarness(session, harnessId);
      }
    }
  }

  // Lifts the row's wait on `harness` and re-attaches its unheld process as a
  // relaunch does. The entries are rebuilt from the transcript and the replay:
  // the attach numbers its entries under a new process start, so kept entries
  // would show twice.
  async function resumeOnHarness(session: HeldSession, harness: AgentHarness) {
    const { sessionId } = session;
    const isStillWaiting =
      !isDetached &&
      held.get(sessionId) === session &&
      session.waiting?.harnessId === harness.id;
    if (!isStillWaiting) {
      return;
    }
    // The wait lifts before the notice's entries write, so a reader woken by
    // that write finds the row no longer waiting.
    session.waiting = null;
    removeWaitingNotice(session);
    const { profile: profileName } = session.slots.info();
    const profile = deps.harnesses
      .profilesOf(harness.id)
      .find((candidate) => candidate.name === profileName);
    if (profile === undefined) {
      addNotice(
        session,
        missingProfileText(profileName, deps.harnessLabelOf(harness.id)),
        'error',
      );
      return;
    }
    if (session.unheldProcessId === null) {
      return;
    }
    session.slots.replaceEntries([]);
    session.historyPending = session.sent;
    session.historyBefore = null;
    const settled = await settleUnheld(session, harness, profile);
    if (settled.runsElsewhere) {
      addNotice(session, OLDER_HOST_NOTICE_TEXT, 'info');
    }
    if (!settled.readsHistory || held.get(sessionId) !== session) {
      return;
    }
    await historyReadOf(session, profile, harness);
  }

  async function harnessReturned(harnessId: string): Promise<void> {
    if (isDetached) {
      log(`harness ${harnessId} returned; chat is stopping`);
      return;
    }
    const harness = deps.harnesses.get(harnessId);
    if (harness === null) {
      log(`harness ${harnessId} set in core.agentHarnesses but not registered`);
      return;
    }
    const waitingRows = [...held.values()].filter(
      (session) => session.waiting?.harnessId === harnessId,
    );
    await Promise.all(
      waitingRows.map((session) =>
        afterAttach(session, () => resumeOnHarness(session, harness)),
      ),
    );
    // A row that rested on the harness with no unheld process, or one whose
    // harness was missing, reads its history only once asked again.
    historyMayBeReadable();
  }

  function harnessRefreshed(harnessId: string) {
    if (isDetached) {
      log(`harness ${harnessId} refreshed; chat is stopping`);
      return;
    }
    historyMayBeReadable();
  }

  // Wakes every `loadHistoryWhenReadable` call waiting, so each tries its row
  // again.
  function historyMayBeReadable() {
    historyChance.resolve();
    historyChance = Promise.withResolvers<void>();
  }

  // Throws `send`'s refusal while the row waits on its harness.
  function refuseWhileWaiting(session: HeldSession) {
    if (session.waiting !== null) {
      throw new Error(
        harnessRefusalText(deps.harnessLabelOf(session.waiting.harnessId)),
      );
    }
  }

  // The host's processes; a list that rejects is logged and rethrown.
  async function listHost(): Promise<readonly HostedProcessInfo[]> {
    try {
      return await deps.sessionHost.list();
    } catch (error) {
      log(`session host not listed: ${errorText(error)}`);
      throw error;
    }
  }

  // One step of the guard on `unheldId`: lists the host, then takes the row off
  // the guard and its older-host notice unless the process runs in another app
  // version, re-attaching when the process runs in the current host. A row
  // whose harness left while the host was listed is left as it is.
  async function runUnheldStep(
    session: HeldSession,
    harness: AgentHarness,
    profile: HarnessProfile,
    unheldId: string,
  ): Promise<UnheldSettled> {
    let listed: readonly HostedProcessInfo[];
    try {
      listed = await listHost();
    } catch (error) {
      return {
        readsHistory: false,
        refusal: errorText(error),
        runsElsewhere: false,
      };
    }
    const isRowElsewhere =
      held.get(session.sessionId) !== session ||
      isDetached ||
      session.unheldProcessId !== unheldId ||
      session.waiting !== null;
    if (isRowElsewhere) {
      return { readsHistory: false, refusal: null, runsElsewhere: false };
    }
    const entry = listed.find((hosted) => hosted.id === unheldId);
    const isRunning = entry !== undefined && entry.running;
    if (isRunning && !entry.current) {
      return {
        readsHistory: false,
        refusal: OLDER_HOST_REFUSAL_TEXT,
        runsElsewhere: true,
      };
    }
    session.unheldProcessId = null;
    removeOlderHostNotice(session);
    if (!isRunning) {
      return { readsHistory: true, refusal: null, runsElsewhere: false };
    }
    const attachError = await attachProcess(
      session,
      harness,
      profile,
      entry,
      false,
    );
    return { readsHistory: true, refusal: attachError, runsElsewhere: false };
  }

  function removeOlderHostNotice(session: HeldSession) {
    const entries = session.slots.entries();
    const kept = entries.filter(
      (entry) =>
        entry.kind !== 'notice' || entry.text !== OLDER_HOST_NOTICE_TEXT,
    );
    if (kept.length === entries.length) {
      return;
    }
    session.slots.replaceEntries(kept);
  }

  // Runs the guard on the row's unheld process; a call while a step runs awaits
  // that step, then checks again.
  async function settleUnheld(
    session: HeldSession,
    harness: AgentHarness,
    profile: HarnessProfile,
  ): Promise<UnheldSettled> {
    while (session.unheldSettling !== null) {
      await session.unheldSettling;
    }
    const unheldId = session.unheldProcessId;
    if (unheldId === null) {
      return { readsHistory: true, refusal: null, runsElsewhere: false };
    }
    const step = runUnheldStep(session, harness, profile, unheldId);
    const clearSettling = () => {
      session.unheldSettling = null;
    };
    session.unheldSettling = step.then(clearSettling, clearSettling);
    return step;
  }

  function isUnheld(session: HeldSession): boolean {
    return session.unheldProcessId !== null || session.unheldSettling !== null;
  }

  // `label` names the session in the refusal: its host id, or its folder for a
  // new one.
  function requireNotDetached(label: string) {
    if (isDetached) {
      throw new Error(`session ${label} not started: chat is stopping`);
    }
  }

  // Opens the row for `hostId`, null for a new conversation, its controls
  // opened from `opening.controls`, and starts its process; a start that throws
  // fires `sessionClosed` (none for a row with no host id), drops the session,
  // keeping any queued or returned messages it took over saved, then ends the
  // owned session. After `detachAll`, and on a control id the harness does not
  // declare, it throws and opens nothing.
  function openAndStart(
    harness: AgentHarness,
    profile: HarnessProfile,
    projectDir: string,
    opening: {
      hostId: string | null;
      resume: boolean;
      entries: ChatEntry[];
      titles: SessionTitles;
      origin: SessionOrigin;
      unattended: boolean;
      permissions: AgentStart['permissions'];
      headless: boolean;
      instructions: readonly string[];
      owner: string | null;
      controls: Readonly<Record<string, string>>;
      recordsRecentFolder: boolean;
      ephemeral: boolean;
    },
    options: OpenOptions,
  ): HeldSession {
    requireNotDetached(opening.hostId ?? `in ${projectDir}`);
    const { controls, confirmedPicks } = openingControlsOf(
      harness,
      opening.controls,
    );
    const session = openRow(
      projectDir,
      harness.id,
      profile.name,
      profileDirOf(profile),
      {
        hostId: opening.hostId,
        entries: opening.entries,
        sent: opening.resume,
        historyPending: false,
        titles: opening.titles,
        processId: null,
        launchControls: {},
        launchResume: false,
        launchHeadless: opening.headless,
        controls,
        confirmedPicks,
        returnedDrops: [],
        activeMs: 0,
        origin: opening.origin,
        unattended: opening.unattended,
        permissions: opening.permissions,
        headless: opening.headless,
        instructions: opening.instructions,
        owner: opening.owner,
        recordsRecentFolder: opening.recordsRecentFolder,
        ephemeral: opening.ephemeral,
      },
      options,
    );
    try {
      startProcess(session, harness, profile, opening.resume);
    } catch (error) {
      fireSessionClosed(session, 'start-failed');
      drop(session);
      const { hostId } = session;
      if (hostId !== null) {
        keepSkipped(
          savedSessionOf(
            session,
            hostId,
            sessions.titles(session.sessionId) ?? NO_TITLES,
            deps.clock.now(),
          ),
        );
      }
      session.owned.end();
      save();
      throw error;
    }
    save();
    return session;
  }

  // Opens the row, selected when `select` says, for the session of the process
  // the host lists as `hosted` and attaches to it. The closed row's launch
  // values went with its record, so the attach passes none and takes the
  // opening's headless flag as the launch's.
  function openAndAttach(
    harness: AgentHarness,
    profile: HarnessProfile,
    projectDir: string,
    opening: {
      hostId: string;
      titles: SessionTitles;
      hosted: HostedProcessInfo;
      instructions: readonly string[];
      owner: string | null;
      headless: boolean;
    },
    select: boolean,
  ): HeldSession {
    requireNotDetached(opening.hostId);
    const session = openRow(
      projectDir,
      harness.id,
      profile.name,
      profileDirOf(profile),
      {
        hostId: opening.hostId,
        entries: [],
        sent: true,
        historyPending: true,
        titles: opening.titles,
        processId: opening.hosted.id,
        launchControls: {},
        launchResume: true,
        launchHeadless: opening.headless,
        controls: [],
        confirmedPicks: {},
        returnedDrops: [],
        activeMs: 0,
        origin: 'resumed',
        unattended: false,
        permissions: 'default',
        headless: opening.headless,
        instructions: opening.instructions,
        owner: opening.owner,
        recordsRecentFolder: true,
        ephemeral: false,
      },
      { select },
    );
    void attachProcess(session, harness, profile, opening.hosted, false);
    save();
    return session;
  }

  // The project named `name`; throws naming every project when none is.
  function projectNamed(name: string): ChatProject {
    const projects = deps.projects();
    const project = projects.find((each) => each.name === name);
    if (project === undefined) {
      const names =
        projects.length === 0
          ? 'none'
          : projects.map((each) => each.name).join(', ');
      throw new Error(`Unknown project "${name}". Projects: ${names}.`);
    }
    return project;
  }

  function requirePoolProvider(projectName: string): PoolProvider {
    const provider = deps.poolProvider();
    if (provider === null) {
      throw new Error(
        `No Unity pool provider is registered for project "${projectName}".`,
      );
    }
    return provider;
  }

  // Where the request starts, or a throw naming why it cannot, before anything
  // opens: a pool project starts in its pool's lowest-numbered clone.
  function resolveTarget(request: StartRequest): ResolvedTarget {
    if ('projectDir' in request) {
      return { projectDir: request.projectDir, isProject: false };
    }
    const project = projectNamed(request.project);
    const { name } = project;
    const isOtherProfile =
      project.profile !== null && project.profile !== request.profile;
    if (isOtherProfile) {
      throw new Error(
        `Project "${name}" runs under profile ${project.profile}, not ${request.profile}.`,
      );
    }
    if (project.kind === 'folder') {
      return {
        projectDir: deps.paths.expandTilde(project.folder, deps.homeDir),
        isProject: true,
      };
    }
    const lowestClone = requirePoolProvider(name).folders(project.pool).at(0);
    if (lowestClone === undefined) {
      throw new Error(`Pool "${project.pool}" has no clones.`);
    }
    return { projectDir: lowestClone, isProject: true };
  }

  // A new session at the request's target, its row selected as `options` says.
  // `firstMessage`, when not null, is written once the process runs.
  function startNew(
    request: StartRequest,
    origin: SessionOrigin,
    options: OpenOptions,
    flags: StartFlags,
    firstMessage: UserMessage | null,
  ): HeldSession {
    const harness = requireHarness(deps.harnesses, request.harness);
    const profile = requireProfile(
      deps.harnesses.profilesOf(harness.id),
      request.profile,
    );
    const target = resolveTarget(request);
    const session = openAndStart(
      harness,
      profile,
      target.projectDir,
      {
        hostId: null,
        resume: false,
        entries: [],
        titles: NO_TITLES,
        origin,
        ...flags,
        recordsRecentFolder: !target.isProject && !flags.ephemeral,
      },
      options,
    );
    if (firstMessage !== null) {
      deliverWritten(session, firstMessage);
    }
    return session;
  }

  // Runs `act` now, or once `session`'s running attach has settled.
  function afterAttach<T>(
    session: HeldSession | undefined,
    act: () => T | Promise<T>,
  ): T | Promise<T> {
    const attaching = session?.attaching;
    if (!attaching) {
      return act();
    }
    return attaching.then(() => afterAttach(session, act));
  }

  async function sendMessage(sessionId: string, message: UserMessage) {
    await afterAttach(held.get(sessionId), () =>
      sendSettled(sessionId, message),
    );
  }

  async function sendSettled(sessionId: string, message: UserMessage) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log(`send for unknown session ${sessionId} ignored`);
      return;
    }
    refuseWhileWaiting(session);
    if (waits(session)) {
      queue(session, message);
      return;
    }
    await writeAtIdle(session, message, () => sendMessage(sessionId, message));
  }

  // Writes `message` to a session that waits on nothing, starting a resting
  // session's process first; saved queued messages go first. The send gates are
  // asked once the process runs, and a verdict holds the message instead. A send
  // that came to wait during the history read queues. An unheld row runs the
  // guard first, then `sendAgain`, since the guard may have attached a process.
  async function writeAtIdle(
    session: HeldSession,
    message: UserMessage,
    sendAgain: () => Promise<void>,
  ) {
    const { sessionId } = session;
    if (!session.slots.info().running) {
      const harness = harnessOfRow(session);
      const profile = profileOfRow(session, harness);
      if (isUnheld(session)) {
        const settled = await settleUnheld(session, harness, profile);
        if (held.get(sessionId) !== session) {
          log(
            `send for session ${sessionId} closed while listing the host ignored`,
          );
          return;
        }
        if (isDetached) {
          log(`send for session ${sessionId} ignored: chat is stopping`);
          return;
        }
        if (settled.refusal !== null) {
          throw new Error(settled.refusal);
        }
        await sendAgain();
        return;
      }
      const reading = historyReadOf(session, profile, harness);
      if (reading !== null) {
        await reading;
        if (held.get(sessionId) !== session) {
          log(`send for session ${sessionId} closed while reading ignored`);
          return;
        }
      }
      if (isDetached) {
        log(`send for session ${sessionId} ignored: chat is stopping`);
        return;
      }
      // The harness may have left during the history read.
      refuseWhileWaiting(session);
      if (!session.slots.info().running) {
        startProcess(session, harness, profile, session.sent);
        save();
      }
    }
    if (waits(session)) {
      queue(session, message);
      return;
    }
    const holdReason = askSendGates(session, message);
    if (
      holdReason !== null &&
      holdForCompaction(session, message, holdReason)
    ) {
      return;
    }
    if (session.slots.queued().some(isUnsent)) {
      queue(session, message);
      writeNextQueued(session);
      return;
    }
    deliverWritten(session, message);
  }

  // The first verdict's reason, in registration order; null with no running
  // process to compact, no verdict, or no host id yet: a new conversation has
  // nothing to compact.
  function askSendGates(
    session: HeldSession,
    message: UserMessage,
  ): string | null {
    const { sessionId, hostId } = session;
    if (session.process === null || hostId === null) {
      return null;
    }
    for (const { gate } of sendGateRegistrations) {
      try {
        const verdict = gate({
          sessionId,
          hostSessionId: hostId,
          text: message.text,
          now: deps.clock.now(),
        });
        if (verdict !== null) {
          return verdict.reason;
        }
      } catch (error) {
        log(`send gate failed in ${sessionId}: ${errorText(error)}`);
      }
    }
    return null;
  }

  // Queues `message` as the held row and starts the compaction; false when
  // `compact` throws, which takes the row back out.
  function holdForCompaction(
    session: HeldSession,
    message: UserMessage,
    reason: string,
  ): boolean {
    const { sessionId } = session;
    const row = appendQueued(session, message, reason);
    save();
    log(`send held in ${sessionId}: ${reason}`);
    if (!startAppCompaction(session, reason)) {
      session.rowOrders.delete(row.id);
      session.slots.setQueued(
        session.slots.queued().filter((queued) => queued.id !== row.id),
      );
      save();
      return false;
    }
    return true;
  }

  // Asks the process for a compaction under `reason`; false, logged, when
  // `compact` throws.
  function startAppCompaction(session: HeldSession, reason: string): boolean {
    session.compactionReason = reason;
    session.isOnlyAppCompaction = true;
    try {
      session.process?.compact();
    } catch (error) {
      session.compactionReason = null;
      session.isOnlyAppCompaction = false;
      log(
        `compaction not started in ${session.sessionId}: ${errorText(error)}`,
      );
      return false;
    }
    return true;
  }

  // Why `compact` starts nothing in `session` now; null when it can start one.
  function compactRefusal(session: HeldSession | undefined): string | null {
    if (session === undefined || isDetached) {
      return 'not held';
    }
    if (session.process === null || session.attaching !== null) {
      return 'no running process';
    }
    if (isHoldUp(session)) {
      return 'a hold is up';
    }
    if (session.slots.info().compaction !== null) {
      return 'a compaction runs';
    }
    if (session.slots.info().activity !== 'idle') {
      return 'not idle';
    }
    return null;
  }

  // The `compact` export: the compaction shows from the call, so a message
  // sent before the harness reports its start queues behind it.
  function compact(sessionId: string, reason: string): boolean {
    const session = held.get(sessionId);
    const refusal = compactRefusal(session);
    if (session === undefined || refusal !== null) {
      log(`compact for session ${sessionId} ignored: ${refusal}`);
      return false;
    }
    if (!startAppCompaction(session, reason)) {
      return false;
    }
    log(`compacting ${sessionId}: ${reason}`);
    setCompaction(session, {
      trigger: 'app',
      reason,
      startedAt: deps.clock.now(),
    });
    return true;
  }

  async function sendAllNow(sessionId: string, message: UserMessage | null) {
    await afterAttach(held.get(sessionId), () =>
      sendAllNowSettled(sessionId, message),
    );
  }

  async function sendAllNowSettled(
    sessionId: string,
    message: UserMessage | null,
  ) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log(`sendAllNow for unknown session ${sessionId} ignored`);
      return;
    }
    refuseWhileWaiting(session);
    if (isHoldUp(session)) {
      if (message !== null) {
        appendQueued(session, message);
        save();
      }
      skipCompaction(session);
      return;
    }
    if (!waits(session)) {
      if (message !== null) {
        await writeAtIdle(session, message, () =>
          sendAllNow(sessionId, message),
        );
      }
      return;
    }
    const hasUnsent = session.slots.queued().some(isUnsent);
    if (!hasUnsent && message === null) {
      log(`nothing to send now in ${sessionId}`);
      return;
    }
    if (message !== null) {
      appendQueued(session, message);
    }
    let isChanged = message !== null;
    for (const row of session.slots.queued().filter(isUnsent)) {
      if (!writeRowNow(session, row)) {
        break;
      }
      isChanged = true;
    }
    if (isChanged) {
      save();
    }
  }

  async function sendIntoTurn(
    sessionId: string,
    message: UserMessage,
  ): Promise<boolean> {
    return afterAttach(held.get(sessionId), () =>
      sendIntoTurnSettled(sessionId, message),
    );
  }

  function sendIntoTurnSettled(
    sessionId: string,
    message: UserMessage,
  ): Promise<boolean> {
    const session = held.get(sessionId);
    if (session === undefined) {
      log(`sendIntoTurn for unknown session ${sessionId} ignored`);
      return Promise.resolve(false);
    }
    refuseWhileWaiting(session);
    const isTurnTakingMessages =
      isTurnRunning(session) &&
      session.slots.info().compaction === null &&
      !isHoldUp(session);
    if (!isTurnTakingMessages) {
      log(
        `message not sent into the turn of ${sessionId}: no turn takes it in`,
      );
      return Promise.resolve(false);
    }
    const row = appendQueued(session, message);
    session.intoTurnRowIds.add(row.id);
    const entryId = writeRowNow(session, row, false)
      ? sentEntryIdOf(session, row.id)
      : null;
    if (entryId === null) {
      session.intoTurnRowIds.delete(row.id);
      session.rowOrders.delete(row.id);
      session.slots.setQueued(
        session.slots.queued().filter((queued) => queued.id !== row.id),
      );
      save();
      return Promise.resolve(false);
    }
    save();
    return new Promise((resolve) => {
      session.intoTurnWaiters.set(entryId, resolve);
    });
  }

  function sentEntryIdOf(session: HeldSession, rowId: string): string | null {
    const row = session.slots.queued().find((queued) => queued.id === rowId);
    return row?.sentEntryId ?? null;
  }

  function queue(session: HeldSession, message: UserMessage) {
    appendQueued(session, message);
    save();
    log(`queued a message in session ${session.sessionId}`);
  }

  function appendQueued(
    session: HeldSession,
    message: UserMessage,
    holdReason: string | null = null,
  ): QueuedMessage {
    session.queuedCount += 1;
    const row = {
      ...message,
      id: `queued-${session.queuedCount}`,
      sentEntryId: null,
      holdReason,
    };
    session.rowOrders.set(row.id, nextHeldOrder(session));
    session.slots.setQueued([...session.slots.queued(), row]);
    return row;
  }

  function nextHeldOrder(session: HeldSession): number {
    session.heldCount += 1;
    return session.heldCount;
  }

  // Writes `message` to the agent and returns the harness's id of the entry the
  // agent adds when it takes it in, which `takeIn` matches.
  function deliver(
    session: HeldSession,
    message: UserMessage,
    isNow = false,
  ): string {
    const { process } = session;
    if (process === null) {
      throw new Error(`session ${session.sessionId} has no running process`);
    }
    const entryId = isNow
      ? process.send(message, { now: true })
      : process.send(message);
    session.isOnlyAppCompaction = false;
    if (firstMessageTitleToSet(session, message.text) !== null) {
      session.titleCandidates.set(entryId, {
        text: message.text,
        wasSent: false,
      });
    }
    if (!session.sent) {
      session.sent = true;
      save();
    }
    deps.emit('messageSent', {
      sessionId: session.sessionId,
      entryId: rowEntryId(entryId, session.processStarts),
    });
    return entryId;
  }

  // Delivers a message that has no queued row, holding it until its entry
  // arrives under `order`, a new stamp when none is given.
  function deliverWritten(
    session: HeldSession,
    message: UserMessage,
    order = nextHeldOrder(session),
  ) {
    session.writtenMessages.set(deliver(session, message), { message, order });
  }

  // The written message under `entryId` titles the row once its harness reports
  // it reached the model, even if its turn failed, or at once from a harness
  // that reports no delivery; a local command, whose delivery goes from `sent`
  // to null, titles nothing.
  function settleTitleCandidate(
    session: HeldSession,
    entryId: string,
    delivery: UserDelivery | null,
  ) {
    const candidate = session.titleCandidates.get(entryId);
    if (candidate === undefined) {
      return;
    }
    if (delivery === 'sent') {
      candidate.wasSent = true;
      return;
    }
    session.titleCandidates.delete(entryId);
    const isLocalCommand = delivery === null && candidate.wasSent;
    if (isLocalCommand) {
      return;
    }
    const title = firstMessageTitleToSet(session, candidate.text);
    session.titleCandidates.clear();
    if (title !== null) {
      sessions.setTitle(session.sessionId, 'firstMessage', title);
      save();
    }
  }

  // The first-message title `text` gives the row, or null when it gives none:
  // a row whose first-message title is already set, such as a cleared one,
  // keeps it; a message with no text but whitespace, such as an images-only
  // one, or a row sessions no longer holds, sets none.
  function firstMessageTitleToSet(
    session: HeldSession,
    text: string,
  ): string | null {
    const titles = sessions.titles(session.sessionId);
    const isRowGone = titles === null;
    const hasFirstMessageTitle =
      titles !== null && titles.firstMessage !== null;
    const title = firstMessageTitleOf(text);
    const isTextless = title === '';
    if (isRowGone || hasFirstMessageTitle || isTextless) {
      return null;
    }
    return title;
  }

  function launch(request: LaunchRequest): string {
    requireAttachableImages(request.message);
    const harness = requireHarnessOfProfile(deps.harnesses, request.profile);
    const { sessionId } = startNew(
      { ...request, harness: harness.id },
      'launched',
      { select: false },
      {
        unattended: request.unattended === true,
        permissions: request.permissions ?? 'default',
        headless: request.headless === true,
        instructions: request.instructions ?? [],
        owner: request.owner ?? null,
        controls: request.controls ?? {},
        ephemeral: request.ephemeral === true,
      },
      request.message,
    );
    log(
      'projectDir' in request
        ? `launched session ${sessionId} in ${request.projectDir}`
        : `launched session ${sessionId} in project ${request.project}`,
    );
    return sessionId;
  }

  // Each check runs where `launch` runs it, so a prepared run fails where a
  // live launch would. `requireNotDetached` is left out: it opens nothing. A
  // prepared run's row is restored from its record, which an ephemeral row
  // never has. A prepared run starts with nobody present, under controls its
  // caller capped, so it never launches permissive.
  async function prepareLaunch(
    request: LaunchRequest,
    env: Readonly<Record<string, string>>,
  ): Promise<PreparedLaunch> {
    if (request.ephemeral === true) {
      throw new Error('chat cannot prepare an ephemeral launch');
    }
    if (request.permissions === 'auto') {
      throw new Error('chat cannot prepare a permissive launch');
    }
    requireAttachableImages(request.message);
    const harness = requireHarnessOfProfile(deps.harnesses, request.profile);
    const profile = requireProfile(
      deps.harnesses.profilesOf(harness.id),
      request.profile,
    );
    const { projectDir } = resolveTarget({ ...request, harness: harness.id });
    const controls = request.controls ?? {};
    requireDeclaredControls(harness.startControls(), controls);
    const hostSessionId = deps.randomUuid();
    const rowId = deps.randomUuid();
    const processId = `${hostSessionId}-1-${deps.clock.now()}`;
    const headless = request.headless === true;
    const instructions = request.instructions ?? [];
    const start: AgentStart = {
      processId,
      sessionId: hostSessionId,
      resume: false,
      projectDir,
      profileDir: profileDirOf(profile),
      controls,
      instructions: instructionsOf(instructions, headless),
      idleCompactMinTokens: currentIdleCompactMinTokens(rowId),
      rowId,
      permissions: 'default',
    };
    const spawn = await harness.prepareRun(start, request.message, env);
    const firstMessage = firstMessageTitleOf(request.message.text);
    log(`prepared session ${hostSessionId} in ${projectDir}`);
    return {
      spawn,
      adopt: {
        hostSessionId,
        processId,
        rowId,
        projectDir,
        harness: harness.id,
        profile: request.profile,
        headless,
        unattended: request.unattended === true,
        instructions,
        owner: request.owner ?? null,
        controls,
        titles: {
          ...NO_TITLES,
          firstMessage: firstMessage === '' ? null : firstMessage,
        },
      },
    };
  }

  // The folders a project covers: a folder project's expanded folder, a pool
  // project's clones.
  function foldersOf(project: ChatProject): readonly string[] {
    if (project.kind === 'folder') {
      return [deps.paths.expandTilde(project.folder, deps.homeDir)];
    }
    return requirePoolProvider(project.name).folders(project.pool);
  }

  // A stable sort, so rows of equal `modified` keep folder order, then each
  // folder's own.
  async function projectPastSessions(
    projectName: string,
    profileName: string,
  ): Promise<ProjectPastSessionRow[]> {
    const folders = foldersOf(projectNamed(projectName));
    const lists = await Promise.all(
      folders.map(async (folder) =>
        (await pastSessions(folder, profileName)).map((row) => ({
          ...row,
          projectDir: folder,
        })),
      ),
    );
    return lists.flat().sort((a, b) => b.modified - a.modified);
  }

  // The session chat holds on the row of `hostSessionId`, if any.
  function holding(hostSessionId: string): HeldSession | undefined {
    return [...held.values()].find(
      (session) => session.hostId === hostSessionId,
    );
  }

  // The row open in the app on `hostSessionId` that chat does not hold, a
  // relay session's; undefined when none is.
  function otherRowOf(hostSessionId: string): string | undefined {
    return [...openHostIds].find(
      ([rowId, hostId]) => hostId === hostSessionId && !held.has(rowId),
    )?.[0];
  }

  // Open in the app on a row chat does not hold: a relay session.
  function isOpenOnOtherRow(hostSessionId: string): boolean {
    return otherRowOf(hostSessionId) !== undefined;
  }

  // A session with a row that belongs to a plugin, which only its owner shows.
  function isOwned(hostSessionId: string): boolean {
    const existing = holding(hostSessionId);
    return existing !== undefined && existing.owner !== null;
  }

  // The row holding `hostSessionId`, activated when it has no owner, or null
  // when chat holds none; throws when the session is open on a row chat does
  // not hold, or on a row whose owner is not `owner`.
  function activateRowOf(
    hostSessionId: string,
    owner: string | null,
  ): string | null {
    const existing = holding(hostSessionId);
    if (existing !== undefined) {
      if (existing.owner !== owner) {
        throw new Error(
          `session ${hostSessionId} is open for ${ownerName(existing.owner)}, not ${ownerName(owner)}`,
        );
      }
      if (existing.owner === null) {
        sessions.activate(existing.sessionId);
      }
      return existing.sessionId;
    }
    if (isOpenOnOtherRow(hostSessionId)) {
      throw new Error(`session ${hostSessionId} is already open in the app`);
    }
    return null;
  }

  // A skipped record holding queued or returned messages stays saved, so they
  // are not lost.
  function keepSkipped(record: SavedSession) {
    const heldCount = record.queued.length + record.returned.length;
    if (heldCount === 0) {
      return;
    }
    skippedRecords.push(record);
    log(
      `session ${record.hostSessionId} not restored; its ${heldCount} queued or returned message(s) stay saved`,
    );
  }

  // Opens the record's row under its saved row id, or under a new one when
  // another session holds that id.
  function openRestoredRow(
    record: SavedSession,
    profileDir: string | null,
    origin: SessionOrigin,
  ): HeldSession {
    const open = (options: OpenOptions) =>
      openRow(
        record.projectDir,
        record.harness,
        record.profile,
        profileDir,
        {
          hostId: record.hostSessionId,
          entries: [],
          sent: record.sent,
          historyPending: record.sent,
          titles: record.titles,
          processId: record.processId,
          launchControls: record.launchControls,
          launchResume: record.launchResume,
          launchHeadless: record.launchHeadless,
          controls: record.controls,
          confirmedPicks: record.confirmedPicks,
          returnedDrops: record.returnedDrops,
          activeMs: record.activeMs,
          origin,
          unattended: record.unattended,
          permissions: record.permissions,
          headless: record.headless,
          instructions: record.instructions,
          owner: record.owner,
          recordsRecentFolder: true,
          ephemeral: false,
        },
        options,
      );
    const { rowId } = record;
    if (rowId === null) {
      return open({ select: false });
    }
    try {
      return open({ select: false, rowId });
    } catch (error) {
      if (!isRowIdHeldError(error, rowId)) {
        throw error;
      }
      log(
        `session ${record.hostSessionId} restored on a new row: row ${rowId} is held`,
      );
      return open({ select: false });
    }
  }

  function restoreRecord(
    record: SavedSession,
    hosted: readonly HostedProcessInfo[] | null,
  ) {
    const { hostSessionId } = record;
    const holder = holding(hostSessionId);
    if (holder !== undefined) {
      log(`session ${hostSessionId} already open; not restored`);
      takeSavedActiveTime(holder, [record]);
      takeSavedMessages(holder, [record]);
      return;
    }
    if (record.processId !== null) {
      processIdsOfHost.set(hostSessionId, record.processId);
    }
    if (isOpenOnOtherRow(hostSessionId)) {
      log(`session ${hostSessionId} already open; not restored`);
      keepSkipped(record);
      return;
    }
    const harness = deps.harnesses.get(record.harness);
    const profile = registeredProfile(record.harness, record.profile);
    let session: HeldSession;
    try {
      session = openRestoredRow(
        record,
        profile === undefined ? null : profileDirOf(profile),
        'restored',
      );
    } catch (error) {
      log(`session ${hostSessionId} not restored: ${errorText(error)}`);
      keepSkipped(record);
      return;
    }
    takeSavedMessages(session, [record]);
    attachOrRest(session, record, harness, profile, hosted);
  }

  // The profile named `name` that the registry publishes for harness
  // `harnessId`; undefined when it publishes none by that name.
  function registeredProfile(
    harnessId: string,
    name: string,
  ): HarnessProfile | undefined {
    return deps.harnesses
      .profilesOf(harnessId)
      .find((candidate) => candidate.name === name);
  }

  // Attaches a row `openRestoredRow` opened for `record` to its process when
  // `hosted` lists it running in the current host and its harness and profile
  // are known; otherwise rests it, unheld while the host may still run the
  // process, waiting on its harness when `harness` is null, with the
  // older-host, quit-during-turn, waiting and missing-profile notices that
  // apply, and reads its saved usage.
  function attachOrRest(
    session: HeldSession,
    record: SavedSession,
    harness: AgentHarness | null,
    profile: HarnessProfile | undefined,
    hosted: readonly HostedProcessInfo[] | null,
  ) {
    const entry = hosted?.find((listed) => listed.id === record.processId);
    const runsHere = entry !== undefined && entry.running && entry.current;
    const runsElsewhere =
      entry !== undefined && entry.running && !entry.current;
    const isListUnknown = hosted === null && record.processId !== null;
    if (runsHere && harness !== null && profile !== undefined) {
      void attachProcess(session, harness, profile, entry, record.busy);
      return;
    }
    if (runsHere || runsElsewhere || isListUnknown) {
      session.unheldProcessId = record.processId;
    }
    if (harness === null) {
      session.waiting = { harnessId: record.harness, noticeId: null };
    }
    if (runsElsewhere) {
      addNotice(session, OLDER_HOST_NOTICE_TEXT, 'info');
      log(
        `session ${session.sessionId} waits on process ${record.processId} in another app version`,
      );
    }
    const isKnownNotRunning = hosted !== null && !runsHere && !runsElsewhere;
    if (record.busy && isKnownNotRunning) {
      addNotice(session, QUIT_DURING_TURN_TEXT, 'info');
    }
    if (harness === null) {
      showWaitingNotice(session);
    } else if (profile === undefined) {
      addNotice(
        session,
        missingProfileText(record.profile, deps.harnessLabelOf(record.harness)),
        'error',
      );
    }
    if (record.sent && profile !== undefined) {
      restoreSavedUsageOrLog(session, profile);
    }
  }

  // The row that already holds the run's host session id, logged; null when
  // none does. Throws after `detachAll`.
  function adoptedRowOf(hostSessionId: string): string | null {
    if (isDetached) {
      throw new Error(`session ${hostSessionId} not adopted: chat is stopping`);
    }
    const rowId =
      holding(hostSessionId)?.sessionId ?? otherRowOf(hostSessionId);
    if (rowId === undefined) {
      return null;
    }
    log(`session ${hostSessionId} already open as ${rowId}`);
    return rowId;
  }

  // The host list is read before the row opens, so a process it lists running
  // here is attached and no other is started; a list that rejects leaves the
  // row unheld, as `restore` does with an unknown list.
  async function adopt(run: AdoptRequest): Promise<string> {
    const { hostSessionId } = run;
    const rowAtStart = adoptedRowOf(hostSessionId);
    if (rowAtStart !== null) {
      return notedOpenRow(rowAtStart);
    }
    let hosted: readonly HostedProcessInfo[] | null;
    try {
      hosted = await listHost();
    } catch {
      hosted = null;
    }
    const rowAfterList = adoptedRowOf(hostSessionId);
    if (rowAfterList !== null) {
      return notedOpenRow(rowAfterList);
    }
    const harness = deps.harnesses.get(run.harness);
    const profile = registeredProfile(run.harness, run.profile);
    let record: SavedSession;
    let session: HeldSession;
    try {
      record = adoptedRecordOf(run, harness, log);
      session = openRestoredRow(
        record,
        profile === undefined ? null : profileDirOf(profile),
        'launched',
      );
    } catch (error) {
      log(`session ${hostSessionId} not adopted: ${errorText(error)}`);
      throw error;
    }
    attachOrRest(session, record, harness, profile, hosted);
    if (session.attaching !== null) {
      await session.attaching;
    }
    // A resting row's calls are noted from its history, before any replayed
    // call of the run asks who made it.
    if (session.process === null) {
      await loadHistory(session.sessionId);
    }
    save();
    return session.sessionId;
  }

  // A row chat holds with no process notes its calls from its history before
  // any replayed call of the run asks who made them, as a row adopt opens does.
  async function notedOpenRow(sessionId: string): Promise<string> {
    if (held.get(sessionId)?.process === null) {
      await loadHistory(sessionId);
    }
    return sessionId;
  }

  function restoreSavedUsageOrLog(
    session: HeldSession,
    profile: HarnessProfile,
  ) {
    const { hostId } = session;
    restoreSavedUsage(session, profile).catch((error: unknown) =>
      log(`saved usage of ${hostId} not read: ${errorText(error)}`),
    );
  }

  // Emits the session's saved usage as its row's `agentEvent`, unless the row
  // closed or cleared, or chat stopped, while it was read.
  async function restoreSavedUsage(
    session: HeldSession,
    profile: HarnessProfile,
  ) {
    const { sessionId } = session;
    const { hostId } = session;
    if (hostId === null) {
      return;
    }
    const profileDir = profileDirOf(profile);
    const event = await readSavedUsage(
      harnessOfRow(session),
      hostId,
      session.slots.info().projectDir,
      profileDir,
    );
    if (event === null || isDetached) {
      return;
    }
    if (isClosedOrCleared(session, sessionId, hostId)) {
      return;
    }
    emitSavedUsage(session, hostId, profileDir, event);
  }

  // The session's saved usage, or null when it has none or it cannot be read,
  // so a usage failure never fails the restore or resume reading it.
  async function readSavedUsage(
    harness: AgentHarness,
    hostSessionId: string,
    projectDir: string,
    profileDir: string,
  ): Promise<UsageAgentEvent | null> {
    try {
      return await harness.lastUsage(hostSessionId, projectDir, profileDir);
    } catch (error) {
      log(`saved usage of ${hostSessionId} not read: ${errorText(error)}`);
      return null;
    }
  }

  function emitSavedUsage(
    session: HeldSession,
    hostSessionId: string,
    profileDir: string,
    event: UsageAgentEvent,
  ) {
    deps.emit('agentEvent', {
      sessionId: session.sessionId,
      profileDir,
      hostSessionId,
      event,
      replayed: false,
    });
  }

  function restore(
    saved: SavedSessions,
    hosted: readonly HostedProcessInfo[] | null,
  ) {
    if (isDetached) {
      log('open sessions not restored: chat is stopping');
      return;
    }
    for (const record of saved.sessions) {
      restoreRecord(record, hosted);
    }
    const selection =
      saved.selectedHostSessionId === null
        ? undefined
        : holding(saved.selectedHostSessionId);
    if (selection !== undefined) {
      selectedRowId = selection.sessionId;
      sessions.activate(selection.sessionId);
    }
    isRestored = true;
    save();
  }

  // The saved conversation, or one error notice in its place when it cannot
  // be read, so the session still resumes.
  async function readHistory(
    harness: AgentHarness,
    hostSessionId: string,
    projectDir: string,
    profileDir: string,
    before: number | null,
  ): Promise<ChatEntry[]> {
    try {
      return await harness.history(
        hostSessionId,
        projectDir,
        profileDir,
        before,
      );
    } catch (error) {
      const reason = errorText(error);
      log(`history of ${hostSessionId} not read: ${reason}`);
      return [
        {
          kind: 'notice',
          id: 'history:unread',
          at: deps.clock.now(),
          text: `Earlier conversation not read: ${reason}`,
          tone: 'error',
          raw: [],
        },
      ];
    }
  }

  // Starts reading the session's pending earlier conversation, which then
  // pends no more; returns the read while it runs, or null when none does.
  function historyReadOf(
    session: HeldSession,
    profile: HarnessProfile,
    harness: AgentHarness,
  ): Promise<void> | null {
    if (session.historyPending) {
      session.historyPending = false;
      session.historyRead = prependHistory(session, profile, harness).finally(
        () => {
          session.historyRead = null;
          historyMayBeReadable();
        },
      );
    }
    return session.historyRead;
  }

  // Whether the row `sessionId` no longer holds `session`, or `session` left
  // `hostId` for a new one.
  function isClosedOrCleared(
    session: HeldSession,
    sessionId: string,
    hostId: string,
  ): boolean {
    return held.get(sessionId) !== session || session.hostId !== hostId;
  }

  async function prependHistory(
    session: HeldSession,
    profile: HarnessProfile,
    harness: AgentHarness,
  ) {
    const { sessionId } = session;
    const { hostId } = session;
    if (hostId === null) {
      return;
    }
    const history = await readHistory(
      harness,
      hostId,
      session.slots.info().projectDir,
      profileDirOf(profile),
      session.historyBefore,
    );
    if (isDetached || isClosedOrCleared(session, sessionId, hostId)) {
      return;
    }
    for (const entry of history) {
      if (entry.kind === 'tool') {
        deps.toolCallers.noteToolStarted(
          sessionId,
          entry.toolUseId,
          entry.agentId,
        );
      }
    }
    session.slots.replaceEntries([...history, ...session.slots.entries()]);
  }

  async function loadHistory(sessionId: string): Promise<void> {
    await tryHistory(sessionId);
  }

  async function loadHistoryWhenReadable(
    sessionId: string,
  ): Promise<HistoryLoad> {
    while (!isDetached) {
      const chance = historyChance.promise;
      const tried = await tryHistory(sessionId);
      if (tried.kind !== 'pending') {
        return tried;
      }
      await chance;
    }
    return { kind: 'gone' };
  }

  // An attach that finds no process drops the history's cut, so the read waits
  // for its result.
  function tryHistory(sessionId: string): Promise<HistoryTry> {
    return Promise.resolve(
      afterAttach(held.get(sessionId), () => tryHistorySettled(sessionId)),
    );
  }

  async function tryHistorySettled(sessionId: string): Promise<HistoryTry> {
    const session = held.get(sessionId);
    if (session === undefined) {
      return { kind: 'gone' };
    }
    if (!session.historyPending) {
      // Another caller's read may still be running: resolve once its entries land.
      await session.historyRead;
      return { kind: 'read' };
    }
    // A row waiting on its harness, or with a missing harness or profile, reads
    // nothing and leaves the history pending: its notice says why.
    if (session.waiting !== null) {
      return { kind: 'pending' };
    }
    const { harness: harnessId, profile: profileName } = session.slots.info();
    const harness = deps.harnesses.get(harnessId);
    const profile = registeredProfile(harnessId, profileName);
    if (harness === null || profile === undefined) {
      return { kind: 'pending' };
    }
    if (isUnheld(session)) {
      const settled = await settleUnheld(session, harness, profile);
      if (held.get(sessionId) !== session) {
        return { kind: 'gone' };
      }
      const unreadable = unheldUnreadableReason(settled);
      if (unreadable !== null) {
        return { kind: 'unreadable', reason: unreadable };
      }
      if (!settled.readsHistory) {
        return { kind: 'pending' };
      }
    }
    await historyReadOf(session, profile, harness);
    return { kind: 'read' };
  }

  // A file that cannot be read marks no row archived, so every saved session
  // can still be resumed.
  async function archivedIdsOrNone(): Promise<ReadonlySet<string>> {
    try {
      return await deps.archived.ids();
    } catch (error) {
      log(`archived sessions not read: ${errorText(error)}`);
      return new Set();
    }
  }

  async function pastSessions(
    projectDir: string,
    profileName: string,
  ): Promise<PastSessionRow[]> {
    const harness = requireHarnessOfProfile(deps.harnesses, profileName);
    const profile = requireProfile(
      deps.harnesses.profilesOf(harness.id),
      profileName,
    );
    const [saved, archivedIds] = await Promise.all([
      harness.listSessions(projectDir, profileDirOf(profile)),
      archivedIdsOrNone(),
    ]);
    return saved
      .filter(
        (past) => !isOpenOnOtherRow(past.sessionId) && !isOwned(past.sessionId),
      )
      .map((past) => ({
        hostSessionId: past.sessionId,
        title: past.title,
        modified: past.modified,
        archived: archivedIds.has(past.sessionId),
      }));
  }

  // Asks each section in registration order, so a later section's
  // `isResumable` also refuses the sessions an earlier one listed.
  async function resumeSections(): Promise<ResumeSectionRows[]> {
    const archivedIds = await archivedIdsOrNone();
    const listed = new Set<string>();
    const isResumable = (hostSessionId: string) =>
      !listed.has(hostSessionId) &&
      !archivedIds.has(hostSessionId) &&
      holding(hostSessionId) === undefined &&
      !isOpenOnOtherRow(hostSessionId);
    const answers: ResumeSectionRows[] = [];
    // A copy, so a section registered or removed while one is read changes
    // nothing in this ask.
    for (const { section } of Array.from(resumeSectionRegistrations)) {
      const rows = await rowsOfSection(section, isResumable);
      for (const row of rows) {
        listed.add(row.hostSessionId);
      }
      if (rows.length > 0) {
        answers.push({ title: section.title, rows });
      }
    }
    return answers;
  }

  // The section's rows; none when they cannot be read, logged.
  async function rowsOfSection(
    section: ResumeSection,
    isResumable: (hostSessionId: string) => boolean,
  ): Promise<ResumeSectionRow[]> {
    try {
      return await section.rows(isResumable);
    } catch (error) {
      log(`resume section ${section.title} not read: ${errorText(error)}`);
      return [];
    }
  }

  async function resume(request: ResumeRequest): Promise<string> {
    const harness =
      request.harness === undefined
        ? requireHarnessOfProfile(deps.harnesses, request.profile)
        : requireHarness(deps.harnesses, request.harness);
    const profile = requireProfile(
      deps.harnesses.profilesOf(harness.id),
      request.profile,
    );
    const { hostSessionId, projectDir } = request;
    const owner = request.owner ?? null;
    const rowAtStart = activateRowOf(hostSessionId, owner);
    if (rowAtStart !== null) {
      return rowAtStart;
    }
    const titles = {
      ...NO_TITLES,
      firstMessage: firstMessageTitleOf(request.title),
    };
    const listed = await listHost();
    const knownProcessId = processIdsOfHost.get(hostSessionId);
    const runningOfSession = listed.filter(
      (hosted) =>
        hosted.running &&
        (hosted.id === knownProcessId ||
          hosted.id.startsWith(`${hostSessionId}-`)),
    );
    const rowAfterList = activateRowOf(hostSessionId, owner);
    if (rowAfterList !== null) {
      return rowAfterList;
    }
    const instructions = request.instructions ?? [];
    const select = request.owner === undefined;
    const runningHere = runningOfSession.find((hosted) => hosted.current);
    if (runningHere !== undefined) {
      const attached = openAndAttach(
        harness,
        profile,
        projectDir,
        {
          hostId: hostSessionId,
          titles,
          hosted: runningHere,
          instructions,
          owner,
          headless: request.headless === true,
        },
        select,
      );
      return attached.sessionId;
    }
    if (runningOfSession.length > 0) {
      throw new Error(OLDER_HOST_REFUSAL_TEXT);
    }
    const profileDir = profileDirOf(profile);
    const [entries, usage] = await Promise.all([
      readHistory(harness, hostSessionId, projectDir, profileDir, null),
      readSavedUsage(harness, hostSessionId, projectDir, profileDir),
    ]);
    const rowAfterRead = activateRowOf(hostSessionId, owner);
    if (rowAfterRead !== null) {
      return rowAfterRead;
    }
    const session = openAndStart(
      harness,
      profile,
      projectDir,
      {
        hostId: hostSessionId,
        resume: true,
        entries,
        titles,
        origin: 'resumed',
        unattended: false,
        permissions: 'default',
        headless: request.headless === true,
        instructions,
        owner,
        controls: {},
        recordsRecentFolder: true,
        ephemeral: false,
      },
      { select },
    );
    if (usage !== null) {
      emitSavedUsage(session, hostSessionId, profileDir, usage);
    }
    return session.sessionId;
  }

  // Ends the session's process, interrupting its turn first, and rests the
  // row with no exit notice and no mark; the process's later events are no
  // longer live. Does nothing for a resting session.
  function endForClear(session: HeldSession) {
    const { process } = session;
    if (process === null) {
      return;
    }
    const { sessionId } = session;
    if (session.slots.info().activity !== 'idle') {
      process.interrupt();
    }
    process
      .end()
      .catch((error: unknown) =>
        log(`session ${sessionId} end failed: ${errorText(error)}`),
      );
    session.slots.setInfo({ running: false, pid: null });
    session.process = null;
    showRestingIdle(session);
  }

  function clear(sessionId: string) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log(`clear for unknown session ${sessionId} ignored`);
      return;
    }
    refuseWhileWaiting(session);
    if (isDetached) {
      log(`clear for session ${sessionId} ignored: chat is stopping`);
      return;
    }
    if (session.attaching !== null) {
      throw new Error(`session ${sessionId} is still attaching`);
    }
    const harness = harnessOfRow(session);
    const profile = profileOfRow(session, harness);
    if (session.unheldProcessId !== null) {
      log(
        `session ${sessionId} cleared; process ${session.unheldProcessId} left running on the session host`,
      );
      session.unheldProcessId = null;
    }
    endForClear(session);
    session.slots.setInfo({ activeTime: NO_ACTIVE_TIME });
    clearCompaction(session, profileDirOf(profile));
    session.pending.clear();
    returnAllHeld(session);
    // A clear already pending keeps the `sent` from before it. A row with no
    // host id has nothing reported to clear.
    if (session.hostId !== null && session.pendingClear === null) {
      session.pendingClear = { sent: session.sent };
    }
    session.sent = false;
    session.historyPending = false;
    session.historyBefore = null;
    session.slots.replaceEntries([
      nextNotice(session, 'Conversation cleared', 'info'),
    ]);
    try {
      startProcess(session, harness, profile, false);
    } catch (error) {
      send('sessionRested', { sessionId, error: null });
      throw error;
    } finally {
      save();
    }
    log(
      `conversation cleared in ${path.basename(session.slots.info().projectDir)}`,
    );
  }

  // Today's end of a closed row: its process's, then the owned session's.
  function endClosed(session: HeldSession) {
    const { sessionId } = session;
    if (session.unheldProcessId !== null) {
      log(
        `session ${sessionId} closed; process ${session.unheldProcessId} left running on the session host`,
      );
    }
    if (!session.slots.info().running) {
      logCloseExit(session);
      session.owned.end();
      return;
    }
    const ended = session.process?.end() ?? Promise.resolve();
    ended.then(
      () => {
        logCloseExit(session);
        session.owned.end();
      },
      (error: unknown) => {
        log(`session ${sessionId} end failed: ${errorText(error)}`);
        session.owned.end();
      },
    );
  }

  // A resting session's queue holds only saved messages, which `liveFor`
  // skipping it leaves as pending rows.
  function interruptNow(session: HeldSession) {
    if (isHoldUp(session)) {
      skipCompaction(session);
      return;
    }
    returnUnsent(session);
    session.process?.interrupt();
  }

  return {
    sessions: () => [...held.values()].map((session) => session.slots.read()),
    hostSessionIdOf: (sessionId) => held.get(sessionId)?.hostId ?? null,
    hostSessionIdSettled(sessionId) {
      const session = held.get(sessionId);
      if (session === undefined) {
        return Promise.reject(new Error(`chat holds no session ${sessionId}`));
      }
      const { hostId } = session;
      if (hostId !== null && session.pendingClear === null) {
        return Promise.resolve(hostId);
      }
      if (isDetached) {
        return Promise.reject(
          new Error(`session ${sessionId} not settled: chat is stopping`),
        );
      }
      return new Promise<string>((resolve, reject) => {
        session.hostIdWaiters.push({ resolve, reject });
      });
    },
    activeTimeOf: (sessionId) =>
      held.get(sessionId)?.slots.info().activeTime ?? null,
    isHeadless: (sessionId) => held.get(sessionId)?.headless ?? false,
    isUnattended: (sessionId) => held.get(sessionId)?.unattended ?? false,
    launchedHeadless: (sessionId) =>
      held.get(sessionId)?.launchHeadless ?? false,
    setHeadless(sessionId, headless) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`setHeadless for unknown session ${sessionId} ignored`);
        return;
      }
      if (session.headless === headless) {
        return;
      }
      session.headless = headless;
      session.slots.setInfo({ headless });
      save();
    },
    start: (request) =>
      startNew(
        request,
        'new',
        { select: true },
        {
          unattended: false,
          permissions: 'default',
          headless: false,
          instructions: [],
          owner: null,
          controls: {},
          ephemeral: false,
        },
        null,
      ).sessionId,
    launch,
    prepareLaunch,
    adopt,
    projectPastSessions,
    restore,
    loadHistory,
    loadHistoryWhenReadable,
    titleChanged(sessionId) {
      if (held.has(sessionId)) {
        save();
      }
    },
    selected(sessionId) {
      const session = sessionId === null ? undefined : held.get(sessionId);
      if (session === undefined) {
        return;
      }
      selectedRowId = session.sessionId;
      save();
    },
    pastSessions,
    resumeSections,
    async setArchived(hostSessionId, archived) {
      await deps.archived.set(hostSessionId, archived);
      deps.emit('sessionArchived', { hostSessionId, archived });
    },
    resume,
    send: sendMessage,
    sendIntoTurn,
    notice(sessionId, text, tone) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`notice for unknown session ${sessionId} ignored`);
        return;
      }
      addNotice(session, text, tone);
    },
    interrupt(sessionId) {
      const session = liveFor('interrupt', sessionId);
      if (session === null) {
        return;
      }
      if (session.attaching === null) {
        interruptNow(session);
        return;
      }
      log(`session ${sessionId} interrupt waits for the attach`);
      void afterAttach(session, () => {
        if (held.get(sessionId) === session && session.process !== null) {
          interruptNow(session);
        }
      });
    },
    clear,
    pullBack(sessionId, queuedId) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`pullBack for unknown session ${sessionId} ignored`);
        return;
      }
      const queued = session.slots.queued();
      const pulled = queued.find((row) => row.id === queuedId);
      if (pulled === undefined) {
        log(`queued message ${queuedId} no longer queued`);
        return;
      }
      if (!isUnsent(pulled)) {
        log(`queued message ${queuedId} already sent`);
        return;
      }
      session.rowOrders.delete(pulled.id);
      session.slots.setQueued(queued.filter((row) => row.id !== pulled.id));
      save();
      returnToBox(session, [pulled]);
    },
    returnedPlaced(sessionId, returnedIds) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`returnedPlaced for unknown session ${sessionId} ignored`);
        return;
      }
      session.slots.setReturned(
        session.slots
          .returned()
          .filter((message) => !returnedIds.includes(message.id)),
      );
      save();
    },
    sendNow(sessionId, queuedId) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`sendNow for unknown session ${sessionId} ignored`);
        return;
      }
      refuseWhileWaiting(session);
      const row = session.slots
        .queued()
        .find((queued) => queued.id === queuedId);
      if (row === undefined) {
        log(`queued message ${queuedId} no longer queued`);
        return;
      }
      if (!isUnsent(row)) {
        log(`queued message ${queuedId} already sent`);
        return;
      }
      if (isHeldRow(row)) {
        skipCompaction(session);
        return;
      }
      if (writeRowNow(session, row)) {
        save();
      }
    },
    sendAllNow,
    setControl(sessionId, controlId, value) {
      const session = held.get(sessionId);
      if (session !== undefined) {
        refuseWhileWaiting(session);
      }
      if (session === undefined || !session.slots.info().running) {
        throw new Error(`session ${sessionId} has no running process`);
      }
      if (session.attaching !== null) {
        throw new Error(`session ${sessionId} is still attaching`);
      }
      session.process?.setControl(controlId, value);
      session.pendingPicks.set(controlId, value);
    },
    answerPermission(sessionId, entryId, answer) {
      const session = liveFor('answerPermission', sessionId);
      if (session === null) {
        return;
      }
      const pending = session.pending.get(entryId);
      if (!pending) {
        log(`answerPermission for unknown entry ${entryId} ignored`);
        return;
      }
      session.pending.delete(entryId);
      answerRequest(session, pending.processStart, pending.requestId, {
        allowed: answer.allowed,
        reason: answer.reason,
      });
      updateActivity(session);
    },
    closed(sessionId, reason) {
      const session = held.get(sessionId);
      if (!session) {
        return;
      }
      fireSessionClosed(session, reason);
      drop(session);
      save();
      void afterAttach(session, () => endClosed(session));
    },
    stopAll() {
      for (const session of held.values()) {
        if (session.process !== null) {
          session.isStopRequested = true;
        }
        if (session.attaching !== null) {
          log(`session ${session.sessionId} still attaching; not stopped`);
        }
      }
      const stopped = running.size;
      for (const process of running) {
        process.kill();
      }
      log(`stopped ${stopped} session process(es)`);
    },
    detachAll() {
      const lastSave = writeSaved();
      isDetached = true;
      historyMayBeReadable();
      const heldSessions = [...held.values()];
      const heldProcesses = new Set(
        heldSessions.flatMap((session) =>
          session.process === null ? [] : [session.process],
        ),
      );
      const unheld = [...running].filter(
        (process) => !heldProcesses.has(process),
      );
      try {
        callEach<() => void>(
          [
            () =>
              callEach(heldSessions, (session) => {
                rejectHostIdWaiters(
                  session,
                  `session ${session.sessionId} not settled: chat is stopping`,
                );
                session.process?.detach();
              }),
            () => callEach(unheld, (process) => process.kill()),
          ],
          (step) => step(),
        );
      } catch (error) {
        return lastSave.then(() => {
          throw error;
        });
      }
      return lastSave;
    },
    keepRows() {
      for (const session of held.values()) {
        session.owned.keep();
      }
    },
    recordOpenHostId(session) {
      if (session.info.sessionId !== null) {
        openHostIds.set(session.id, session.info.sessionId);
      }
    },
    sessionEnded(sessionId) {
      openHostIds.delete(sessionId);
    },
    addInstructions(text) {
      const registration = { text };
      instructionRegistrations.add(registration);
      instructionListeners.tell();
      return {
        dispose() {
          if (instructionRegistrations.delete(registration)) {
            instructionListeners.tell();
          }
        },
      };
    },
    onInstructionsChanged(listener) {
      return instructionListeners.add(() => {
        try {
          listener();
        } catch (error) {
          log(`instructions listener threw: ${errorText(error)}`);
        }
      });
    },
    addSendGate(gate) {
      const registration = { gate };
      sendGateRegistrations.add(registration);
      return {
        dispose() {
          sendGateRegistrations.delete(registration);
        },
      };
    },
    compact,
    addResumeSection(section) {
      const registration = { section };
      resumeSectionRegistrations.add(registration);
      return {
        dispose() {
          resumeSectionRegistrations.delete(registration);
        },
      };
    },
    addIdleCompactThreshold(read) {
      const registration = { read };
      idleCompactRegistrations.add(registration);
      return {
        dispose() {
          idleCompactRegistrations.delete(registration);
        },
      };
    },
    harnessLeft,
    harnessReturned,
    harnessRefreshed,
  };
}
