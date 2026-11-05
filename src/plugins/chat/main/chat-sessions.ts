import path from 'node:path';
import type {
  AgentEvent,
  AgentHarness,
  AgentProcess,
  AgentProcessEvents,
  ChatEntry,
  ProcessActivity,
  SessionControl,
  UsageAgentEvent,
  UserMessage,
} from '../../../contracts/agent';
import type { Alerts } from '../../../contracts/alerts';
import type { Clock, RandomUuid } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
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
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import { refusalOf } from '../image-rules';
import { isWorkRunning } from '../session-work';
import {
  type AgentSession,
  errorResult,
  type OpenOptions,
  type OwnedSession,
  type SessionsMainExports,
  type SessionTitles,
  textResult,
  TITLE_SOURCES,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import {
  CHAT_HARNESS_ID,
  type ChatChannel,
  type ChatMainEvents,
  type ChatProfile,
  type ChatSessionState,
  type LaunchRequest,
  type PastSessionRow,
  type PermissionAnswer,
  type ProcessEndReason,
  type QueuedMessage,
  type ResumeRequest,
  type ReturnedMessage,
  type ResumeSection,
  type ResumeSectionRows,
  type SendGate,
  type SessionCloseReason,
  type SessionCompaction,
  type SessionOrigin,
  type StartRequest,
} from '../contract';
import type { ArchivedSessions } from './archived-sessions';
import { requireChatHarness, requireProfile } from './lookups';
import {
  NO_TITLES,
  type OpenSessions,
  type SavedSession,
  type SavedSessions,
} from './open-sessions';
import {
  CANCELLED_REASON,
  NOT_OWNED_TEXT,
  PERMISSION_TOOL_NAME,
  type PermissionRequest,
  permissionReplyText,
  readPermissionRequest,
} from './permission-tool';
import type { RecentFolders } from './recent-folders';

export const TURN_FINISHED_TITLE = 'Turn finished';

export interface ChatSessionsDeps {
  harnesses: readonly AgentHarness[];
  sessions: Pick<
    SessionsMainExports,
    'open' | 'mark' | 'activate' | 'selectedSessionId' | 'setTitle' | 'titles'
  >;
  // Read at each session start.
  profiles(): readonly ChatProfile[];
  randomUuid: RandomUuid;
  recent: RecentFolders;
  archived: ArchivedSessions;
  saved: OpenSessions;
  send: MainChannel<ChatChannel>['send'];
  emit: PluginEvents<ChatMainEvents>['emit'];
  alerts: Pick<Alerts, 'announce'>;
  window: { show(): void; isFocused(): boolean };
  // Reads each row's repo and branch at its open and after each turn.
  git: Pick<Git, 'topLevel' | 'currentBranch'>;
  log: PluginLog;
  // Stamps the `at` of the notices and permission entries chat makes itself,
  // and times each session's active time.
  clock: Clock;
  // Lists the host's processes before a resume, and before a send or history
  // read on an unheld row.
  sessionHost: Pick<SessionHost, 'list'>;
}

export interface ChatSessions {
  sessions(): ChatSessionState[];
  // The held session's current host id, which a `clear` replaces; null for a
  // row chat does not hold.
  hostSessionIdOf(sessionId: string): string | null;
  start(request: StartRequest): string;
  // Starts a session with its row unselected and sends `message` as its first
  // message; returns the row's sessionId. Throws before opening anything on
  // an image chat would refuse to attach.
  launch(request: LaunchRequest): string;
  // Opens a row for each saved session in order, unselected, with its saved
  // titles, queued messages and returned messages, then activates the saved selection. A row whose
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
  // the entries held so far, up to its process's start on a re-attached row;
  // does nothing for a session with none pending. It waits out a running
  // attach. It reads nothing, leaving the history pending, while its profile is
  // missing, and while its unheld process runs in another app version or the
  // host cannot be listed.
  loadHistory(sessionId: string): Promise<void>;
  // The sessions plugin's `titleChanged` event: a row chat holds is saved with
  // its new titles; any other row is left alone.
  titleChanged(sessionId: string): void;
  // The sessions plugin's `selected` event: a row chat holds becomes the
  // saved selection; any other row, or none, leaves it as it was.
  selected(sessionId: string | null): void;
  // The folder's saved sessions under the profile, newest first, leaving out
  // every session open in the app on a row chat does not hold. When the
  // archived-sessions file cannot be read, every row lists as not archived
  // and the failure is logged; the file is left as it is.
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
  // its process; resolves to the row's sessionId. A
  // session chat holds a row for has that row activated instead; one open in
  // the app on any other row rejects, as does any after `detachAll`; both hold
  // after each wait as well, so two resumes of one id open one row. It lists
  // the host first, so a session never runs two processes: a process of the
  // session running in the current host has the row open and attach to it, as a
  // restored row does, its history pending; one running in another app version,
  // or a list that rejects, rejects and opens nothing.
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
  // message not sent now until none is left; a permission call left waiting
  // after the turn ended queues nothing. An idle send asks the send gates once
  // the process runs: a verdict queues the message as the held row and compacts,
  // and the row is written when the compaction ends, whatever its outcome, or
  // when the process's working stretch goes idle with no compaction running; a
  // `compact` that throws writes the message at once. A send at idle in a row
  // holding unsent queued messages queues behind them and writes the oldest. A
  // written message is held until its entry arrives, and returned when the
  // harness reports it dropped. The first message written in a row with no
  // first-message title sets it.
  send(sessionId: string, message: UserMessage): Promise<void>;
  // Adds an app notice to the session's entries and sends it as harness
  // entries travel, so `sessions()` keeps it.
  notice(sessionId: string, text: string, tone: 'info' | 'error'): void;
  // Returns every queued message not sent now, then interrupts the process;
  // messages sent now stay queued. While a hold is up it interrupts and returns
  // nothing, so the compaction ends and the rows go out in order. During an
  // attach it waits for the attach to settle, then does this when the row holds
  // a process.
  interrupt(sessionId: string): void;
  // Ends the session's process, interrupting a running turn first, and starts a
  // fresh one at once under a new host session id with the row's held mode and
  // the model and effort the user picked that a report confirmed. Waiting
  // permission calls are cancelled, a running compaction's end goes out as an
  // `interrupted` `agentEvent`, since the old process's own is dropped, and
  // messages written but not taken in and every queued message, the held row
  // included, returned in the order written; the old
  // process raises no exit notice and no turn-finished alert. The entries
  // become one `Conversation cleared` notice. A resting session just starts its
  // fresh process. Throws before changing anything when the profile or harness
  // is missing, or while the row attaches; a fresh start that throws leaves the
  // row resting under the new id, then rethrows, with `sessionCleared` already
  // fired. An unheld process is left running on the host, since the fresh
  // process shares no transcript with it.
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
  // does and writes nothing now.
  sendNow(sessionId: string, queuedId: string): void;
  // While the harness reports the turn running, writes every queued message
  // not sent now, oldest first, then `message` as a new last row, each as
  // `sendNow` does, stopping at a write that throws; the same while a compaction
  // runs with no hold up. While a hold is up, queues `message` behind the held row
  // and interrupts as `interrupt` does, writing nothing now. Otherwise sends
  // `message` as `send` does, and a null `message` does nothing.
  sendAllNow(sessionId: string, message: UserMessage | null): Promise<void>;
  // Throws for a session chat no longer holds, that has no running process or
  // that is still attaching, as the process's own `setControl` throws for a
  // value it refuses, so the
  // caller learns the change was not made. A model or effort set this way is
  // the user's once a controls report from the same process holds the picked
  // value; every later start in the row then passes its held value. A pick no
  // report confirms before the process ends, or a newer pick replaces, is
  // never passed.
  setControl(sessionId: string, controlId: string, value: string): void;
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
  // leaves the last saved total. Nothing is saved or started after it, and every
  // later process event is ignored.
  detachAll(): Promise<void>;
  // The sessions plugin's `connected` and `hostSessionChanged` events: records
  // the session's current host id as open in the app.
  recordOpenHostId(session: AgentSession): void;
  // The sessions plugin's `ended` event: the session's host id is no longer
  // open.
  sessionEnded(sessionId: string): void;
  // The `start` chat hands `sessions.contributeTools` with PERMISSION_TOOLS.
  permissionToolSession(session: AgentSession): ToolSession;
  // Registers `text` for every process start from now on, in registration
  // order; a running process keeps what it started with. Disposing the
  // registration drops it from later starts; a second dispose does nothing.
  addInstructions(text: string): Disposable;
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
  // Adds `section` at the end of the sections `resumeSections` asks. Each call is
  // its own registration, and its handle removes only it; a second `dispose` does
  // nothing.
  addResumeSection(section: ResumeSection): Disposable;
}

type PermissionEntry = Extract<ChatEntry, { kind: 'permission' }>;

// A permission call waiting on the user; `resolve` settles the call's promise
// with its reply text.
interface PendingPermission {
  entry: PermissionEntry;
  resolve(text: string): void;
  signal: AbortSignal;
  onAbort(): void;
}

interface WrittenMessage {
  message: UserMessage;
  order: number;
}

// `process` is null whenever the session rests, and while the harness's
// `start` or `attach` runs.
interface HeldSession {
  state: ChatSessionState;
  owned: OwnedSession;
  hostId: string;
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
  pending: Map<string, PendingPermission>;
  permissionCount: number;
  noticeCount: number;
  // Messages ever queued in this row, numbering their ids.
  queuedCount: number;
  // Messages ever returned to the box in this row, numbering their ids.
  returnedCount: number;
  // Messages ever queued, or written with no queued row, in this row,
  // stamping each with its place in the order written.
  heldCount: number;
  // Each queued row → its stamp from `heldCount`.
  rowOrders: WeakMap<QueuedMessage, number>;
  // Harness entry id → each message written with no queued row, with its
  // stamp from `heldCount`, until its entry arrives; ids restart with each
  // process.
  writtenMessages: Map<string, WrittenMessage>;
  // Processes started in this row, the one running included.
  processStarts: number;
  // Control id → the value the user picked in this row that a report confirmed,
  // until a report holds no value for that control. A start passes these and no
  // other model or effort. Saved with the row.
  confirmedPicks: Map<string, string>;
  // Control id → the value the user picked that the running process has not
  // reported yet.
  pendingPicks: Map<string, string>;
  // Since the last idle, the process ran a hold's compaction and no message was
  // written to it, so that idle ends no turn.
  isOnlyAHoldsCompaction: boolean;
  // The reason of the hold whose compaction is starting or running, until that
  // compaction ends.
  compactionReason: string | null;
  // How the process exited, once its `ended` arrives; a user close logs it.
  exit: { code: number | null; error: string | null } | null;
  // Branch reads started in this row, numbering them; only the latest applies.
  branchReads: number;
  // The id of the row's last process start or attach; never cleared, so after
  // an exit it still names the ended process.
  processId: string | null;
  // What the row's last process start passed as `controls` and `resume`, which
  // an attach passes again: no pipe line reports them.
  launchControls: Record<string, string>;
  launchResume: boolean;
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
}

// What one guard step on an unheld process leaves its caller to do: whether a
// pending history read goes on, and the error a send rejects with.
interface UnheldSettled {
  readsHistory: boolean;
  refusal: string | null;
}

const QUIT_DURING_TURN_TEXT =
  'The app quit during this turn. Your next message resumes this session.';

const OLDER_HOST_NOTICE_TEXT =
  'This session is finishing its turn in another app version. Send a message once it ends.';

const OLDER_HOST_REFUSAL_TEXT =
  'This session is still finishing in another app version. Send again once it ends.';

const STOPPED_TEXT = 'Session stopped. Your next message resumes this session.';

function missingProfileText(name: string): string {
  return `Profile ${name} is not in chat's profiles setting; add it back to resume this session.`;
}

function exitNoticeText(code: number | null, error: string | null): string {
  const exitCode = code === null ? 'unknown' : String(code);
  const reason = error === null ? '' : `: ${error}`;
  return `Claude stopped (exit code ${exitCode})${reason}. Your next message resumes this session.`;
}

// `entries` with `entry` in the place of the one holding its id, else appended.
function upsertEntry(entries: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  const index = entries.findIndex((held) => held.id === entry.id);
  if (index === -1) {
    return [...entries, entry];
  }
  return entries.map((held, at) => (at === index ? entry : held));
}

// A harness numbers entry ids per process, so a row's later processes reuse
// its first process's ids; each start after the first gets its own prefix.
function rowEntryOf(entry: ChatEntry, processStart: number): ChatEntry {
  if (processStart === 1) {
    return entry;
  }
  return { ...entry, id: `process-${processStart}:${entry.id}` };
}

function copyState(state: ChatSessionState): ChatSessionState {
  return {
    ...state,
    entries: [...state.entries],
    controls: [...state.controls],
    commands: [...state.commands],
    queued: [...state.queued],
    returned: [...state.returned],
  };
}

// A held mode narrows nothing, so a start passes it whoever set it.
const MODE_CONTROL_ID = 'mode';

// The launch values a process starts with: the held mode, and each other
// control's confirmed pick.
function controlValuesOf(
  controls: readonly SessionControl[],
  confirmedPicks: ReadonlyMap<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const value =
      control.id === MODE_CONTROL_ID
        ? control.value
        : confirmedPicks.get(control.id);
    if (value !== null && value !== undefined) {
      values[control.id] = value;
    }
  }
  return values;
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
  const order = session.rowOrders.get(row);
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
  return session.state.queued.some(isHeldRow);
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

function savedSessionOf(
  session: HeldSession,
  titles: SessionTitles,
  now: number,
): SavedSession {
  return {
    hostSessionId: session.hostId,
    projectDir: session.state.projectDir,
    profile: session.state.profile,
    sent: session.sent,
    busy: session.state.activity !== 'idle',
    titles,
    processId: session.processId,
    queued: session.state.queued.filter(isUnsent).map(userMessageOf),
    returned: session.state.returned.map(userMessageOf),
    launchControls: session.launchControls,
    launchResume: session.launchResume,
    controls: session.state.controls,
    confirmedPicks: Object.fromEntries(session.confirmedPicks),
    returnedDrops: [...session.returnedDrops],
    activeMs: activeMsAt(session.state.activeTime, now),
  };
}

// The first-message title held for a message: a pasted wall of text stays out
// of every state, and the row cuts it further. Leading whitespace goes before
// the cap, so a message opening on a wall of blanks still keeps its text.
const FIRST_MESSAGE_TITLE_CAP = 200;

function firstMessageTitleOf(text: string): string {
  return [...text.trimStart()].slice(0, FIRST_MESSAGE_TITLE_CAP).join('');
}

// Chat's owned sessions: each one's agent process while it runs, its chat
// entries, controls and commands, the activity it shows, the permission
// calls waiting on the user, the messages queued behind its running turn or its
// compaction, the compaction running and the send gates that start one, and
// the messages written to the agent it has not taken in yet;
// the folder's saved sessions it can resume; and
// the open sessions it saves across a relaunch, re-attaching to each process
// the session host still runs. Every state change reaches the page over `send`.
export function createChatSessions(deps: ChatSessionsDeps): ChatSessions {
  const { sessions, send, log } = deps;
  // Insertion order is open order, the sidebar's order for chat's rows.
  const held = new Map<string, HeldSession>();
  // Row id → host session id of every session open in the app, owned or not.
  const openHostIds = new Map<string, string>();
  // Every started process until its `ended`, held or closed.
  const running = new Set<AgentProcess>();
  // Host id of the last row chat holds that was selected.
  let selectedHostId: string | null = null;
  // Saving waits for the restore, so no save overwrites the saved records
  // before they are read; it stops for good at `detachAll`.
  let isRestored = false;
  let isDetached = false;
  // Records the restore skipped that hold queued or returned messages, saved unchanged so
  // the next app start tries them again.
  let skippedRecords: SavedSession[] = [];
  // One object per `addInstructions` call, in registration order.
  const instructionRegistrations = new Set<{ text: string }>();
  // One object per `addSendGate` call, in registration order.
  const sendGateRegistrations = new Set<{ gate: SendGate }>();
  // One object per `addIdleCompactThreshold` call, in registration order.
  const idleCompactRegistrations = new Set<{ read: () => number | null }>();
  // One object per `addResumeSection` call, in registration order.
  const resumeSectionRegistrations = new Set<{ section: ResumeSection }>();

  function snapshot(): SavedSessions {
    const now = deps.clock.now();
    const records = [...held.values()].map((session) =>
      savedSessionOf(
        session,
        sessions.titles(session.state.sessionId) ?? NO_TITLES,
        now,
      ),
    );
    const selectionHeld = records.some(
      (record) => record.hostSessionId === selectedHostId,
    );
    return {
      sessions: [...records, ...skippedRecords],
      selectedHostSessionId: selectionHeld ? selectedHostId : null,
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
      held.get(session.state.sessionId) === session &&
      session.state.running &&
      session.processStarts === processStart
    );
  }

  // The harness reports the turn running.
  function isTurnRunning(session: HeldSession): boolean {
    return session.state.running && session.harnessActivity !== 'idle';
  }

  // A message sent now queues rather than being written.
  function waits(session: HeldSession): boolean {
    return (
      isTurnRunning(session) ||
      session.state.compaction !== null ||
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
    if (!session.state.running) {
      log(`${method} for resting session ${sessionId} ignored`);
      return null;
    }
    return session;
  }

  function sendEntry(session: HeldSession, entry: ChatEntry) {
    session.state.entries = upsertEntry(session.state.entries, entry);
    send('entry', { sessionId: session.state.sessionId, entry });
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
    sendEntry(session, nextNotice(session, text, tone));
  }

  function announceTurnFinished(session: HeldSession) {
    const { sessionId, projectDir } = session.state;
    deps.alerts.announce(TURN_FINISHED_TITLE, path.basename(projectDir), () => {
      sessions.activate(sessionId);
      deps.window.show();
    });
    sessions.mark(sessionId);
  }

  // Keeps the ids of the subagents and background tasks still running, so a
  // turn that ends while any runs announces nothing.
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
    sendBackground(session);
  }

  function clearBackground(session: HeldSession) {
    session.backgroundIds.clear();
    sendBackground(session);
  }

  // Sends the count of background work only when it changed.
  function sendBackground(session: HeldSession) {
    const background = session.backgroundIds.size;
    if (background === session.state.background) {
      return;
    }
    session.state.background = background;
    send('background', { sessionId: session.state.sessionId, background });
    updateActiveTime(session);
  }

  function sendActiveTime(session: HeldSession) {
    const { sessionId, activeTime } = session.state;
    send('activeTime', { sessionId, activeTime });
  }

  // Starts or stops the session's clock after a change to its activity or
  // background count; sends and saves only when the clock changed. A replay
  // moves neither: a held attach's end settles the clock once, and a failed
  // attach leaves it paused.
  function updateActiveTime(session: HeldSession) {
    if (session.replay.isReplaying) {
      return;
    }
    const now = deps.clock.now();
    const current = session.state.activeTime;
    const next = isWorkRunning(session.state)
      ? startActiveTime(current, now)
      : stopActiveTime(current, now);
    if (next === current) {
      return;
    }
    session.state.activeTime = next;
    sendActiveTime(session);
    save();
  }

  // A replayed turn's end announces nothing, since it ended while the app was
  // closed, and neither does one `stopAll` caused, an idle with a hold up, whose
  // row is still to go out, or the end of a stretch that ran only a hold's
  // compaction.
  function updateActivity(session: HeldSession, isReplayed = false) {
    const previous = session.state.activity;
    const activity = shownActivity(session);
    if (activity === previous) {
      return;
    }
    session.state.activity = activity;
    const { sessionId } = session.state;
    send('activity', { sessionId, activity });
    updateActiveTime(session);
    const turnFinished = activity === 'idle' && previous !== 'idle';
    const turnStarted = activity !== 'idle' && previous === 'idle';
    const userIsElsewhere =
      !deps.window.isFocused() || sessions.selectedSessionId() !== sessionId;
    const workIsOver = session.backgroundIds.size === 0;
    const isTheTurnsOwnEnd = !isReplayed && !session.isStopRequested;
    const ranATurn = !isHoldUp(session) && !session.isOnlyAHoldsCompaction;
    if (
      turnFinished &&
      userIsElsewhere &&
      workIsOver &&
      isTheTurnsOwnEnd &&
      ranATurn
    ) {
      announceTurnFinished(session);
    }
    if (turnFinished) {
      session.isOnlyAHoldsCompaction = false;
    }
    if (turnFinished || turnStarted) {
      save();
    }
  }

  // A resting session runs no turn, so it shows idle; unlike a turn going
  // idle, its exit announces nothing.
  function showRestingIdle(session: HeldSession) {
    session.harnessActivity = 'idle';
    if (session.state.activity === 'idle') {
      return;
    }
    session.state.activity = 'idle';
    send('activity', { sessionId: session.state.sessionId, activity: 'idle' });
    updateActiveTime(session);
  }

  // Resolves every pending call as cancelled, sending no entry.
  function cancelPending(session: HeldSession) {
    const cancelled = permissionReplyText(
      { allowed: false, reason: CANCELLED_REASON },
      null,
    );
    for (const pending of session.pending.values()) {
      pending.signal.removeEventListener('abort', pending.onAbort);
      pending.resolve(cancelled);
    }
    session.pending.clear();
  }

  // Sends each waiting permission card its cancelled answer, for a session
  // whose tab stays open after its calls are cancelled.
  function showPendingCancelled(session: HeldSession) {
    for (const pending of session.pending.values()) {
      sendEntry(session, {
        ...pending.entry,
        answer: { allowed: false, reason: CANCELLED_REASON },
      });
    }
  }

  function sendQueued(session: HeldSession) {
    send('queued', {
      sessionId: session.state.sessionId,
      queued: [...session.state.queued],
    });
    save();
  }

  // Sends messages back to the page for the box. Each stays in the row's state
  // and record until the page reports it placed: with no page to hear this send,
  // the page reads it at mount.
  function returnToBox(session: HeldSession, messages: readonly UserMessage[]) {
    const returned = messages.map((message): ReturnedMessage => {
      session.returnedCount += 1;
      return {
        ...userMessageOf(message),
        id: `returned-${session.returnedCount}`,
      };
    });
    session.state.returned = [...session.state.returned, ...returned];
    send('returned', {
      sessionId: session.state.sessionId,
      messages: returned,
    });
    save();
  }

  // Empties the queue and the written messages, and sends every message they
  // held back to the page in the order written, rows sent now or not; sends
  // nothing when both are empty.
  function returnAllHeld(session: HeldSession) {
    const { queued } = session.state;
    const held: WrittenMessage[] = [
      ...session.writtenMessages.values(),
      ...queued.map((row) => ({
        message: userMessageOf(row),
        order: rowOrderOf(session, row),
      })),
    ];
    const messages = held
      .sort((a, b) => a.order - b.order)
      .map((written) => written.message);
    session.writtenMessages.clear();
    if (queued.length > 0) {
      session.state.queued = [];
      sendQueued(session);
    }
    if (messages.length > 0) {
      returnToBox(session, messages);
    }
  }

  // Takes every row not sent now out of the queue and sends its message back
  // to the page, oldest first; sends nothing when none is unsent.
  function returnUnsent(session: HeldSession) {
    const { queued } = session.state;
    const unsent = queued.filter(isUnsent);
    if (unsent.length === 0) {
      return;
    }
    session.state.queued = queued.filter((row) => !isUnsent(row));
    sendQueued(session);
    returnToBox(session, unsent);
  }

  // Writes the oldest queued message not sent now to the agent; false when
  // none is queued, a hold is up, a compaction runs, or the write throws, which
  // puts it back at its place.
  function writeNextQueued(session: HeldSession): boolean {
    if (isHoldUp(session) || session.state.compaction !== null) {
      return false;
    }
    const index = session.state.queued.findIndex(isUnsent);
    if (index === -1) {
      return false;
    }
    const next = session.state.queued[index];
    session.state.queued = session.state.queued.filter((row) => row !== next);
    sendQueued(session);
    try {
      deliverWritten(session, userMessageOf(next), rowOrderOf(session, next));
    } catch (error) {
      const restored = [...session.state.queued];
      restored.splice(index, 0, next);
      session.state.queued = restored;
      sendQueued(session);
      log(`queued message ${next.id} not sent: ${errorText(error)}`);
      return false;
    }
    return true;
  }

  // Writes the row's message and marks it with the entry id the write
  // returned; false when the write throws, which leaves it unsent.
  function writeRowNow(session: HeldSession, row: QueuedMessage): boolean {
    let sentEntryId: string;
    try {
      sentEntryId = deliver(session, userMessageOf(row));
    } catch (error) {
      log(`queued message ${row.id} not sent: ${errorText(error)}`);
      return false;
    }
    const sentRow = { ...row, sentEntryId };
    session.rowOrders.set(sentRow, rowOrderOf(session, row));
    session.state.queued = session.state.queued.map((queued) =>
      queued === row ? sentRow : queued,
    );
    return true;
  }

  function setCompaction(
    session: HeldSession,
    compaction: SessionCompaction | null,
  ) {
    session.state.compaction = compaction;
    send('compaction', { sessionId: session.state.sessionId, compaction });
  }

  // Forgets the session's compaction and any hold's reason; sends `compaction`
  // only when one ran.
  function forgetCompaction(session: HeldSession) {
    session.compactionReason = null;
    if (session.state.compaction !== null) {
      setCompaction(session, null);
    }
  }

  // Forgets the compaction of a process chat is letting go of, whose own
  // `compactionEnded` fails `isLive`, and emits its end in that one's place.
  function clearCompaction(session: HeldSession, profileDir: string) {
    const running = session.state.compaction;
    forgetCompaction(session);
    if (running === null) {
      return;
    }
    deps.emit('agentEvent', {
      sessionId: session.state.sessionId,
      profileDir,
      hostSessionId: session.hostId,
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
    const row = session.state.queued.find(isHeldRow);
    if (row === undefined) {
      return null;
    }
    const released = { ...row, holdReason: null };
    session.rowOrders.set(released, rowOrderOf(session, row));
    session.state.queued = session.state.queued.map((queued) =>
      queued === row ? released : queued,
    );
    sendQueued(session);
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
    const { sessionId } = session.state;
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
      `held message ${releasedId} released in ${session.state.sessionId}: idle with no compaction`,
    );
  }

  // Interrupts the process so the running compaction ends and the held row and
  // those behind it go out.
  function skipCompaction(session: HeldSession) {
    session.process?.interrupt();
    log(`skipping the compaction in ${session.state.sessionId}`);
  }

  // The agent took in the message written under `entryId`: a sent row for it
  // leaves the queue, and a written message is held no longer.
  function takeIn(session: HeldSession, entryId: string) {
    session.writtenMessages.delete(entryId);
    const { queued } = session.state;
    if (queued.some((row) => row.sentEntryId === entryId)) {
      session.state.queued = queued.filter(
        (row) => row.sentEntryId !== entryId,
      );
      sendQueued(session);
    }
  }

  // The agent dropped `message`, written under `entryId`, without taking it in:
  // its sent row leaves the queue, and it goes back to the page once per process.
  // A message written before a relaunch has no row and no written record here.
  function returnDropped(
    session: HeldSession,
    entryId: string,
    message: UserMessage,
  ) {
    if (session.returnedDrops.has(entryId)) {
      log(`dropped message ${entryId} already returned`);
      return;
    }
    session.returnedDrops.add(entryId);
    session.writtenMessages.delete(entryId);
    const { queued } = session.state;
    if (queued.some((row) => row.sentEntryId === entryId)) {
      session.state.queued = queued.filter(
        (row) => row.sentEntryId !== entryId,
      );
      sendQueued(session);
    }
    returnToBox(session, [message]);
    log(`sent message ${entryId} returned: never taken in`);
  }

  // The state is dropped first, so every later event for the session is
  // ignored; its queue goes with it, returned nowhere.
  function drop(session: HeldSession) {
    held.delete(session.state.sessionId);
    cancelPending(session);
  }

  // Runs before the owned session ends: a resting row's titles end with it.
  function fireSessionClosed(session: HeldSession, reason: SessionCloseReason) {
    const { sessionId, projectDir, profile } = session.state;
    deps.emit('sessionClosed', {
      sessionId,
      hostSessionId: session.hostId,
      projectDir,
      profile,
      titles: sessions.titles(sessionId) ?? NO_TITLES,
      sent: session.sent,
      reason,
    });
  }

  // The harness emits `ended` before `end()` resolves, so the exit is known here.
  function logCloseExit(session: HeldSession) {
    const { sessionId } = session.state;
    if (session.exit === null) {
      log(`session ${sessionId} closed; no exit reported`);
      return;
    }
    const { code, error } = session.exit;
    log(
      `session ${sessionId} closed (code ${code}${error === null ? '' : `, error: ${error}`})`,
    );
  }

  // Answers the waiting call. After `detachAll`, as when quit closes the relay,
  // only the call hears it: the saved row stands, so a relaunch asks again.
  function settlePermission(
    session: HeldSession,
    pending: PendingPermission,
    answer: PermissionAnswer,
  ) {
    pending.signal.removeEventListener('abort', pending.onAbort);
    session.pending.delete(pending.entry.id);
    pending.resolve(permissionReplyText(answer, pending.entry.input));
    if (isDetached) {
      return;
    }
    const entry: PermissionEntry = {
      ...pending.entry,
      answer: { allowed: answer.allowed, reason: answer.reason },
    };
    sendEntry(session, entry);
    updateActivity(session);
  }

  // The events of the row's `processStart`th process, started or attached under
  // `profileDir`; `started.process` is that process once the harness's `start`
  // returns or its `attach` settles. While `replay.isReplaying` holds, events
  // show the session's state and act on nothing that already happened.
  function processEvents(
    session: HeldSession,
    processStart: number,
    started: { process: AgentProcess | null },
    profileDir: string,
    replay: { isReplaying: boolean },
  ): AgentProcessEvents {
    const { sessionId } = session.state;
    // A clear moves the row to a new host id while this process still ends.
    const hostSessionId = session.hostId;
    return {
      entry(entry) {
        if (isLive(session, processStart)) {
          sendEntry(session, rowEntryOf(entry, processStart));
          takeIn(session, entry.id);
        }
      },
      controls(controls) {
        if (isLive(session, processStart)) {
          session.state.controls = controls;
          confirmPicks(controls, session.pendingPicks, session.confirmedPicks);
          dropPicksOfUnsetControls(controls, session.confirmedPicks);
          send('controls', { sessionId, controls });
          save();
        }
      },
      activity(activity) {
        if (!isLive(session, processStart)) {
          return;
        }
        // A queued message starts the next turn, so the session shows no idle
        // in between and the turn-finished alert waits for the last one. A
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
          session.state.compaction === null;
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
          isSameJson(session.state.commands, commands)
        ) {
          return;
        }
        session.state.commands = [...commands];
        send('commands', { sessionId, commands: [...commands] });
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
        if (isLiveEvent || endsTheSession) {
          deps.emit('agentEvent', {
            sessionId,
            profileDir,
            hostSessionId,
            event,
            // The replay's fold emits no `sessionEnded`, so one here is a real exit.
            replayed: replay.isReplaying && event.type !== 'sessionEnded',
          });
        }
        if (isLiveEvent) {
          trackBackground(session, event);
        }
        const endsALiveTurn = isLiveEvent && event.type === 'turnEnded';
        if (endsALiveTurn && !replay.isReplaying) {
          readBranch(session);
        }
        if (isLiveEvent && event.type === 'compactionStarted') {
          compactionStarted(session, event);
        }
        if (isLiveEvent && event.type === 'compactionEnded') {
          compactionEnded(session, event.outcome, replay.isReplaying);
        }
      },
      // Returns a written message the agent let go without taking it in.
      messageDropped(entryId, message) {
        if (isLive(session, processStart)) {
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
        session.state.running = false;
        session.process = null;
        forgetCompaction(session);
        showPendingCancelled(session);
        cancelPending(session);
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
            exitNoticeText(code, error),
            isCleanExit ? 'info' : 'error',
          );
        }
        send('sessionRested', { sessionId, error });
        clearBackground(session);
        showRestingIdle(session);
        save();
        if (!replay.isReplaying) {
          deps.emit('processEnded', {
            sessionId,
            hostSessionId,
            reason: processEndReasonOf(session.isStopRequested, isCleanExit),
            code,
            error,
          });
        }
      },
    };
  }

  const profileNamed = (name: string) => requireProfile(deps.profiles(), name);
  const requireHarness = () => requireChatHarness(deps.harnesses);

  function profileDirOf(profile: ChatProfile): string {
    return profile.configDir;
  }

  // Opens the row for `opening.hostId` as `options` says, gives it each title
  // `opening.titles` holds, and holds its state, resting, with `entries`.
  // `profileDir` is null when the profile is not in chat's profiles setting;
  // such a row emits no `sessionOpened`.
  function openRow(
    projectDir: string,
    profileName: string,
    profileDir: string | null,
    opening: {
      hostId: string;
      entries: ChatEntry[];
      sent: boolean;
      historyPending: boolean;
      titles: SessionTitles;
      processId: string | null;
      launchControls: Record<string, string>;
      launchResume: boolean;
      controls: SessionControl[];
      confirmedPicks: Record<string, string>;
      returnedDrops: readonly string[];
      activeMs: number;
      origin: SessionOrigin;
    },
    options: OpenOptions,
  ): HeldSession {
    const { hostId } = opening;
    const owned = sessions.open(
      {
        sessionId: hostId,
        projectDir,
        deadlineSeconds: null,
        harness: CHAT_HARNESS_ID,
      },
      options,
    );
    const sessionId = owned.session.id;
    for (const source of TITLE_SOURCES) {
      const title = opening.titles[source];
      if (title !== null) {
        sessions.setTitle(sessionId, source, title);
      }
    }
    const session: HeldSession = {
      state: {
        sessionId,
        projectDir,
        profile: profileName,
        entries: opening.entries,
        controls: opening.controls,
        activity: 'idle',
        background: 0,
        activeTime: { totalMs: opening.activeMs, since: null },
        commands: [],
        running: false,
        queued: [],
        compaction: null,
        returned: [],
        repo: path.basename(projectDir),
        branch: null,
      },
      owned,
      hostId,
      process: null,
      sent: opening.sent,
      historyPending: opening.historyPending,
      historyRead: null,
      harnessActivity: 'idle',
      backgroundIds: new Set(),
      pending: new Map(),
      permissionCount: 0,
      noticeCount: 0,
      queuedCount: 0,
      returnedCount: 0,
      heldCount: 0,
      rowOrders: new WeakMap(),
      writtenMessages: new Map(),
      processStarts: 0,
      confirmedPicks: new Map(Object.entries(opening.confirmedPicks)),
      pendingPicks: new Map(),
      isOnlyAHoldsCompaction: false,
      compactionReason: null,
      exit: null,
      branchReads: 0,
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
    };
    held.set(sessionId, session);
    if (profileDir !== null) {
      deps.emit('sessionOpened', {
        sessionId,
        profileDir,
        hostSessionId: hostId,
        projectDir,
        profile: profileName,
        origin: opening.origin,
      });
    }
    // The sessions plugin emits `selected` inside `open`, before the row is
    // held, so `selected` cannot record it.
    if (options.select) {
      selectedHostId = hostId;
    }
    send('sessionStarted', copyState(session.state));
    takeOverSkipped(session);
    readBranch(session);
    return session;
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
    const { activeTime } = session.state;
    session.state.activeTime = {
      ...activeTime,
      totalMs: activeTime.totalMs + savedMs,
    };
    sendActiveTime(session);
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
      sendQueued(session);
    }
    const returned = records.flatMap((record) => record.returned);
    if (returned.length > 0) {
      returnToBox(session, returned);
    }
  }

  // Reads the row's repo and branch, and sends `branch` when either changed.
  // A read that a later one started after, or that settles after the row
  // closed, changes nothing.
  function readBranch(session: HeldSession) {
    session.branchReads += 1;
    const read = session.branchReads;
    const { projectDir } = session.state;
    const folderName = path.basename(projectDir);
    repoAndBranchOf(projectDir, folderName).then(
      ({ repo, branch }) => {
        const isLatestRead =
          held.get(session.state.sessionId) === session &&
          session.branchReads === read;
        const changed =
          repo !== session.state.repo || branch !== session.state.branch;
        if (!isLatestRead || !changed) {
          return;
        }
        session.state.repo = repo;
        session.state.branch = branch;
        send('branch', { sessionId: session.state.sessionId, repo, branch });
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

  // Numbers the row's next process. A pick still pending, the background work, a
  // stop request and a hold's stretch belong to the old process and are dropped.
  function beginProcess(session: HeldSession) {
    session.processStarts += 1;
    session.pendingPicks.clear();
    clearBackground(session);
    session.isStopRequested = false;
    session.isOnlyAHoldsCompaction = false;
  }

  // Starts the session's process with the held mode and the confirmed picks,
  // and records the folder; a throw from the harness leaves the session
  // resting.
  function startProcess(
    session: HeldSession,
    harness: AgentHarness,
    profile: ChatProfile,
    resume: boolean,
  ) {
    const { sessionId, projectDir } = session.state;
    beginProcess(session);
    const started: { process: AgentProcess | null } = { process: null };
    const profileDir = profileDirOf(profile);
    session.processId = `${session.hostId}-${session.processStarts}-${deps.clock.now()}`;
    session.launchControls = controlValuesOf(
      session.state.controls,
      session.confirmedPicks,
    );
    session.launchResume = resume;
    session.returnedDrops.clear();
    const process = harness.start(
      {
        processId: session.processId,
        sessionId: session.hostId,
        resume,
        projectDir,
        profileDir,
        controls: session.launchControls,
        instructions: currentInstructions(),
        idleCompactMinTokens: currentIdleCompactMinTokens(sessionId),
        rowId: sessionId,
      },
      processEvents(session, session.processStarts, started, profileDir, {
        isReplaying: false,
      }),
    );
    started.process = process;
    session.process = process;
    session.exit = null;
    running.add(process);
    session.state.running = true;
    send('sessionRunning', { sessionId });
    log(`session ${sessionId} process started (resume ${resume})`);
    deps.recent
      .record(projectDir, profile.name)
      .catch((error: unknown) =>
        log(`recent folders not saved: ${errorText(error)}`),
      );
  }

  function currentInstructions(): string[] {
    return [...instructionRegistrations].map(
      (registration) => registration.text,
    );
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
    profile: ChatProfile,
    hosted: HostedProcessInfo,
    busy: boolean,
  ): Promise<string | null> {
    const { sessionId, projectDir } = session.state;
    beginProcess(session);
    session.exit = null;
    session.processId = hosted.id;
    session.historyBefore = hosted.startedAt;
    session.state.running = true;
    send('sessionRunning', { sessionId });
    const started: { process: AgentProcess | null } = { process: null };
    const replay = { isReplaying: true };
    session.replay = replay;
    const profileDir = profileDirOf(profile);
    const attaching = harness
      .attach(
        {
          processId: hosted.id,
          sessionId: session.hostId,
          resume: session.launchResume,
          projectDir,
          profileDir,
          controls: session.launchControls,
          instructions: currentInstructions(),
          idleCompactMinTokens: null,
          rowId: sessionId,
        },
        processEvents(
          session,
          session.processStarts,
          started,
          profileDir,
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
  // `detachAll` its record is gone and the user asked it to end, so it is killed.
  function holdAttached(
    session: HeldSession,
    process: AgentProcess,
    started: { process: AgentProcess | null },
  ) {
    const { sessionId } = session.state;
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

  // Rests a row whose attach found no process to hold, with no exit notice. A
  // row that ended during the replay or closed is only logged.
  function restAfterFailedAttach(
    session: HeldSession,
    profile: ChatProfile,
    reason: string,
    busy: boolean,
  ) {
    if (isDetached) {
      return;
    }
    const { sessionId } = session.state;
    log(`session ${sessionId} not re-attached: ${reason}`);
    if (held.get(sessionId) !== session || session.exit !== null) {
      return;
    }
    session.state.running = false;
    session.process = null;
    session.historyBefore = null;
    clearCompaction(session, profileDirOf(profile));
    clearBackground(session);
    showRestingIdle(session);
    send('sessionRested', { sessionId, error: null });
    if (busy) {
      addNotice(session, QUIT_DURING_TURN_TEXT, 'info');
    }
    if (session.sent) {
      restoreSavedUsageOrLog(session, profile);
    }
    save();
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
  // version, re-attaching when the process runs in the current host.
  async function runUnheldStep(
    session: HeldSession,
    harness: AgentHarness,
    profile: ChatProfile,
    unheldId: string,
  ): Promise<UnheldSettled> {
    let listed: readonly HostedProcessInfo[];
    try {
      listed = await listHost();
    } catch (error) {
      return { readsHistory: false, refusal: errorText(error) };
    }
    const isRowElsewhere =
      held.get(session.state.sessionId) !== session ||
      isDetached ||
      session.unheldProcessId !== unheldId;
    if (isRowElsewhere) {
      return { readsHistory: false, refusal: null };
    }
    const entry = listed.find((hosted) => hosted.id === unheldId);
    const isRunning = entry !== undefined && entry.running;
    if (isRunning && !entry.current) {
      return { readsHistory: false, refusal: OLDER_HOST_REFUSAL_TEXT };
    }
    session.unheldProcessId = null;
    removeOlderHostNotice(session);
    if (!isRunning) {
      return { readsHistory: true, refusal: null };
    }
    const attachError = await attachProcess(
      session,
      harness,
      profile,
      entry,
      false,
    );
    return { readsHistory: true, refusal: attachError };
  }

  function removeOlderHostNotice(session: HeldSession) {
    const { entries, sessionId } = session.state;
    const kept = entries.filter(
      (entry) =>
        entry.kind !== 'notice' || entry.text !== OLDER_HOST_NOTICE_TEXT,
    );
    if (kept.length === entries.length) {
      return;
    }
    session.state.entries = kept;
    send('entries', { sessionId, entries: [...kept] });
  }

  // Runs the guard on the row's unheld process; a call while a step runs awaits
  // that step, then checks again.
  async function settleUnheld(
    session: HeldSession,
    harness: AgentHarness,
    profile: ChatProfile,
  ): Promise<UnheldSettled> {
    while (session.unheldSettling !== null) {
      await session.unheldSettling;
    }
    const unheldId = session.unheldProcessId;
    if (unheldId === null) {
      return { readsHistory: true, refusal: null };
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

  function requireNotDetached(hostId: string) {
    if (isDetached) {
      throw new Error(`session ${hostId} not started: chat is stopping`);
    }
  }

  // Opens the row for `hostId` and starts its process; a start that throws
  // fires `sessionClosed`, drops the session, keeping any queued or returned
  // messages it took over saved, then ends the owned session. After `detachAll`
  // it throws and opens nothing.
  function openAndStart(
    harness: AgentHarness,
    profile: ChatProfile,
    projectDir: string,
    opening: {
      hostId: string;
      resume: boolean;
      entries: ChatEntry[];
      titles: SessionTitles;
      origin: SessionOrigin;
    },
    options: OpenOptions,
  ): HeldSession {
    requireNotDetached(opening.hostId);
    const session = openRow(
      projectDir,
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
        controls: [],
        confirmedPicks: {},
        returnedDrops: [],
        activeMs: 0,
        origin: opening.origin,
      },
      options,
    );
    try {
      startProcess(session, harness, profile, opening.resume);
    } catch (error) {
      fireSessionClosed(session, 'start-failed');
      drop(session);
      keepSkipped(
        savedSessionOf(
          session,
          sessions.titles(session.state.sessionId) ?? NO_TITLES,
          deps.clock.now(),
        ),
      );
      session.owned.end();
      save();
      throw error;
    }
    save();
    return session;
  }

  // Opens the selected row for the session of the process the host lists as
  // `hosted` and attaches to it. The closed row's launch values went with its
  // record, so the attach passes none.
  function openAndAttach(
    harness: AgentHarness,
    profile: ChatProfile,
    projectDir: string,
    opening: {
      hostId: string;
      titles: SessionTitles;
      hosted: HostedProcessInfo;
    },
  ): HeldSession {
    requireNotDetached(opening.hostId);
    const session = openRow(
      projectDir,
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
        controls: [],
        confirmedPicks: {},
        returnedDrops: [],
        activeMs: 0,
        origin: 'resumed',
      },
      { select: true },
    );
    void attachProcess(session, harness, profile, opening.hosted, false);
    save();
    return session;
  }

  // A new session in the folder, its row selected as `options` says.
  function startNew(
    request: StartRequest,
    origin: SessionOrigin,
    options: OpenOptions,
  ): HeldSession {
    const profile = profileNamed(request.profile);
    const harness = requireHarness();
    return openAndStart(
      harness,
      profile,
      request.projectDir,
      {
        hostId: deps.randomUuid(),
        resume: false,
        entries: [],
        titles: NO_TITLES,
        origin,
      },
      options,
    );
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
    const { sessionId } = session.state;
    if (!session.state.running) {
      const profile = profileNamed(session.state.profile);
      const harness = requireHarness();
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
      if (!session.state.running) {
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
    if (session.state.queued.some(isUnsent)) {
      queue(session, message);
      writeNextQueued(session);
      return;
    }
    deliverWritten(session, message);
  }

  // The first verdict's reason, in registration order; null with no running
  // process to compact or no verdict.
  function askSendGates(
    session: HeldSession,
    message: UserMessage,
  ): string | null {
    const { sessionId } = session.state;
    if (session.process === null) {
      return null;
    }
    for (const { gate } of sendGateRegistrations) {
      try {
        const verdict = gate({
          sessionId,
          hostSessionId: session.hostId,
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
    const { sessionId } = session.state;
    const row = appendQueued(session, message, reason);
    sendQueued(session);
    log(`send held in ${sessionId}: ${reason}`);
    session.compactionReason = reason;
    session.isOnlyAHoldsCompaction = true;
    try {
      session.process?.compact();
    } catch (error) {
      session.compactionReason = null;
      session.isOnlyAHoldsCompaction = false;
      log(`compaction not started in ${sessionId}: ${errorText(error)}`);
      session.state.queued = session.state.queued.filter(
        (queued) => queued !== row,
      );
      sendQueued(session);
      return false;
    }
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
    if (isHoldUp(session)) {
      if (message !== null) {
        appendQueued(session, message);
        sendQueued(session);
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
    const hasUnsent = session.state.queued.some(isUnsent);
    if (!hasUnsent && message === null) {
      log(`nothing to send now in ${sessionId}`);
      return;
    }
    if (message !== null) {
      appendQueued(session, message);
    }
    let isChanged = message !== null;
    for (const row of session.state.queued.filter(isUnsent)) {
      if (!writeRowNow(session, row)) {
        break;
      }
      isChanged = true;
    }
    if (isChanged) {
      sendQueued(session);
    }
  }

  function queue(session: HeldSession, message: UserMessage) {
    appendQueued(session, message);
    sendQueued(session);
    log(`queued a message in session ${session.state.sessionId}`);
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
    session.rowOrders.set(row, nextHeldOrder(session));
    session.state.queued = [...session.state.queued, row];
    return row;
  }

  function nextHeldOrder(session: HeldSession): number {
    session.heldCount += 1;
    return session.heldCount;
  }

  // Writes `message` to the agent and returns the id of the entry the agent
  // adds when it takes it in.
  function deliver(session: HeldSession, message: UserMessage): string {
    const { process } = session;
    if (process === null) {
      throw new Error(
        `session ${session.state.sessionId} has no running process`,
      );
    }
    const entryId = process.send(message);
    session.isOnlyAHoldsCompaction = false;
    if (!session.sent) {
      session.sent = true;
      setFirstMessageTitle(session, message.text);
      save();
    }
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

  // A row whose first-message title is already set, such as a cleared one,
  // keeps it; a message with no text but whitespace, such as an images-only
  // one, or a row sessions no longer holds, sets none.
  function setFirstMessageTitle(session: HeldSession, text: string) {
    const { sessionId } = session.state;
    const titles = sessions.titles(sessionId);
    const isRowGone = titles === null;
    const hasFirstMessageTitle =
      titles !== null && titles.firstMessage !== null;
    const title = firstMessageTitleOf(text);
    const isTextless = title === '';
    if (isRowGone || hasFirstMessageTitle || isTextless) {
      return;
    }
    sessions.setTitle(sessionId, 'firstMessage', title);
  }

  function launch(request: LaunchRequest): string {
    for (const image of request.message.images) {
      const refusal = refusalOf(image.mediaType, image.data.length);
      if (refusal !== null) {
        throw new Error(refusal);
      }
    }
    const session = startNew(request, 'launched', { select: false });
    deliverWritten(session, request.message);
    const { sessionId } = session.state;
    log(`launched session ${sessionId} in ${request.projectDir}`);
    return sessionId;
  }

  // The session chat holds on the row of `hostSessionId`, if any.
  function holding(hostSessionId: string): HeldSession | undefined {
    return [...held.values()].find(
      (session) => session.hostId === hostSessionId,
    );
  }

  // Open in the app on a row chat does not hold: a relay session.
  function isOpenOnOtherRow(hostSessionId: string): boolean {
    return [...openHostIds].some(
      ([rowId, hostId]) => hostId === hostSessionId && !held.has(rowId),
    );
  }

  // The row holding `hostSessionId`, activated, or null when chat holds none;
  // throws when the session is open on a row chat does not hold.
  function activateRowOf(hostSessionId: string): string | null {
    const existing = holding(hostSessionId);
    if (existing !== undefined) {
      sessions.activate(existing.state.sessionId);
      return existing.state.sessionId;
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
    if (isOpenOnOtherRow(hostSessionId)) {
      log(`session ${hostSessionId} already open; not restored`);
      keepSkipped(record);
      return;
    }
    const profile = deps
      .profiles()
      .find((candidate) => candidate.name === record.profile);
    let session: HeldSession;
    try {
      session = openRow(
        record.projectDir,
        record.profile,
        profile === undefined ? null : profileDirOf(profile),
        {
          hostId: hostSessionId,
          entries: [],
          sent: record.sent,
          historyPending: record.sent,
          titles: record.titles,
          processId: record.processId,
          launchControls: record.launchControls,
          launchResume: record.launchResume,
          controls: record.controls,
          confirmedPicks: record.confirmedPicks,
          returnedDrops: record.returnedDrops,
          activeMs: record.activeMs,
          origin: 'restored',
        },
        { select: false },
      );
    } catch (error) {
      log(`session ${hostSessionId} not restored: ${errorText(error)}`);
      keepSkipped(record);
      return;
    }
    takeSavedMessages(session, [record]);
    const entry = hosted?.find((listed) => listed.id === record.processId);
    const runsHere = entry !== undefined && entry.running && entry.current;
    const runsElsewhere =
      entry !== undefined && entry.running && !entry.current;
    const isListUnknown = hosted === null && record.processId !== null;
    if (runsHere && profile !== undefined) {
      void attachProcess(
        session,
        requireHarness(),
        profile,
        entry,
        record.busy,
      );
      return;
    }
    if (runsHere || runsElsewhere || isListUnknown) {
      session.unheldProcessId = record.processId;
    }
    if (runsElsewhere) {
      addNotice(session, OLDER_HOST_NOTICE_TEXT, 'info');
      log(
        `session ${session.state.sessionId} waits on process ${record.processId} in another app version`,
      );
    }
    const isKnownNotRunning = hosted !== null && !runsHere && !runsElsewhere;
    if (record.busy && isKnownNotRunning) {
      addNotice(session, QUIT_DURING_TURN_TEXT, 'info');
    }
    if (profile === undefined) {
      addNotice(session, missingProfileText(record.profile), 'error');
    }
    if (record.sent && profile !== undefined) {
      restoreSavedUsageOrLog(session, profile);
    }
  }

  function restoreSavedUsageOrLog(session: HeldSession, profile: ChatProfile) {
    const { hostId } = session;
    restoreSavedUsage(session, profile).catch((error: unknown) =>
      log(`saved usage of ${hostId} not read: ${errorText(error)}`),
    );
  }

  // Emits the session's saved usage as its row's `agentEvent`, unless the row
  // closed or cleared, or chat stopped, while it was read.
  async function restoreSavedUsage(session: HeldSession, profile: ChatProfile) {
    const { sessionId } = session.state;
    const { hostId } = session;
    const profileDir = profileDirOf(profile);
    const event = await readSavedUsage(
      requireHarness(),
      hostId,
      session.state.projectDir,
      profileDir,
    );
    if (event === null || isDetached) {
      return;
    }
    if (isClosedOrCleared(session, sessionId, hostId)) {
      return;
    }
    emitSavedUsage(session, profileDir, event);
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
    profileDir: string,
    event: UsageAgentEvent,
  ) {
    deps.emit('agentEvent', {
      sessionId: session.state.sessionId,
      profileDir,
      hostSessionId: session.hostId,
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
      selectedHostId = selection.hostId;
      sessions.activate(selection.state.sessionId);
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
    profile: ChatProfile,
    harness: AgentHarness,
  ): Promise<void> | null {
    if (session.historyPending) {
      session.historyPending = false;
      session.historyRead = prependHistory(session, profile, harness).finally(
        () => {
          session.historyRead = null;
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
    profile: ChatProfile,
    harness: AgentHarness,
  ) {
    const { sessionId } = session.state;
    const { hostId } = session;
    const history = await readHistory(
      harness,
      hostId,
      session.state.projectDir,
      profileDirOf(profile),
      session.historyBefore,
    );
    if (isClosedOrCleared(session, sessionId, hostId)) {
      return;
    }
    session.state.entries = [...history, ...session.state.entries];
    send('entries', { sessionId, entries: [...session.state.entries] });
  }

  // An attach that finds no process drops the history's cut, so the read waits
  // for its result.
  async function loadHistory(sessionId: string): Promise<void> {
    await afterAttach(held.get(sessionId), () => loadHistorySettled(sessionId));
  }

  async function loadHistorySettled(sessionId: string): Promise<void> {
    const session = held.get(sessionId);
    if (session === undefined || !session.historyPending) {
      return;
    }
    // A missing profile reads nothing and leaves the history pending: its
    // restore notice says why.
    const profile = deps
      .profiles()
      .find((candidate) => candidate.name === session.state.profile);
    if (profile === undefined) {
      return;
    }
    const harness = requireHarness();
    if (isUnheld(session)) {
      const settled = await settleUnheld(session, harness, profile);
      if (!settled.readsHistory || held.get(sessionId) !== session) {
        return;
      }
    }
    await historyReadOf(session, profile, harness);
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
    const profile = profileNamed(profileName);
    const harness = requireHarness();
    const [saved, archivedIds] = await Promise.all([
      harness.listSessions(projectDir, profileDirOf(profile)),
      archivedIdsOrNone(),
    ]);
    return saved
      .filter((past) => !isOpenOnOtherRow(past.sessionId))
      .map((past) => ({
        hostSessionId: past.sessionId,
        title: past.title,
        modified: past.modified,
        archived: archivedIds.has(past.sessionId),
      }));
  }

  async function resumeSections(): Promise<ResumeSectionRows[]> {
    const archivedIds = await archivedIdsOrNone();
    const isResumable = (hostSessionId: string) =>
      !archivedIds.has(hostSessionId) &&
      holding(hostSessionId) === undefined &&
      !isOpenOnOtherRow(hostSessionId);
    const answers = await Promise.all(
      [...resumeSectionRegistrations].map(async ({ section }) => {
        try {
          return {
            title: section.title,
            rows: await section.rows(isResumable),
          };
        } catch (error) {
          log(`resume section ${section.title} not read: ${errorText(error)}`);
          return { title: section.title, rows: [] };
        }
      }),
    );
    return answers.filter((answer) => answer.rows.length > 0);
  }

  async function resume(request: ResumeRequest): Promise<string> {
    const profile = profileNamed(request.profile);
    const harness = requireHarness();
    const { hostSessionId, projectDir } = request;
    const rowAtStart = activateRowOf(hostSessionId);
    if (rowAtStart !== null) {
      return rowAtStart;
    }
    const titles = {
      ...NO_TITLES,
      firstMessage: firstMessageTitleOf(request.title),
    };
    const runningOfSession = (await listHost()).filter(
      (hosted) => hosted.running && hosted.id.startsWith(`${hostSessionId}-`),
    );
    const rowAfterList = activateRowOf(hostSessionId);
    if (rowAfterList !== null) {
      return rowAfterList;
    }
    const runningHere = runningOfSession.find((hosted) => hosted.current);
    if (runningHere !== undefined) {
      const attached = openAndAttach(harness, profile, projectDir, {
        hostId: hostSessionId,
        titles,
        hosted: runningHere,
      });
      return attached.state.sessionId;
    }
    if (runningOfSession.length > 0) {
      throw new Error(OLDER_HOST_REFUSAL_TEXT);
    }
    const profileDir = profileDirOf(profile);
    const [entries, usage] = await Promise.all([
      readHistory(harness, hostSessionId, projectDir, profileDir, null),
      readSavedUsage(harness, hostSessionId, projectDir, profileDir),
    ]);
    const rowAfterRead = activateRowOf(hostSessionId);
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
      },
      { select: true },
    );
    if (usage !== null) {
      emitSavedUsage(session, profileDir, usage);
    }
    return session.state.sessionId;
  }

  function askPermission(
    session: HeldSession,
    request: PermissionRequest,
    args: unknown,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    session.permissionCount += 1;
    const entry: PermissionEntry = {
      kind: 'permission',
      id: `permission-${session.permissionCount}`,
      at: deps.clock.now(),
      toolName: request.toolName,
      input: request.input,
      answer: null,
      raw: [args],
    };
    return new Promise<ToolResult>((resolve) => {
      const pending: PendingPermission = {
        entry,
        resolve: (text) => resolve(textResult(text)),
        signal,
        onAbort: () =>
          settlePermission(session, pending, {
            allowed: false,
            reason: CANCELLED_REASON,
          }),
      };
      session.pending.set(entry.id, pending);
      signal.addEventListener('abort', pending.onAbort, { once: true });
      sendEntry(session, entry);
      updateActivity(session);
    });
  }

  async function permissionCall(
    sessionId: string,
    name: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const session = held.get(sessionId);
    if (!session) {
      return errorResult(NOT_OWNED_TEXT);
    }
    if (name !== PERMISSION_TOOL_NAME) {
      throw new Error(`chat has no tool "${name}"`);
    }
    let request: PermissionRequest;
    try {
      request = readPermissionRequest(args);
    } catch (error) {
      return errorResult(errorText(error));
    }
    if (signal.aborted || !session.state.running) {
      return textResult(
        permissionReplyText(
          { allowed: false, reason: CANCELLED_REASON },
          request.input,
        ),
      );
    }
    return askPermission(session, request, args, signal);
  }

  function settleAllAsAborted(session: HeldSession) {
    // Each `onAbort` deletes its own entry, which a Map's iteration allows.
    for (const pending of session.pending.values()) {
      pending.onAbort();
    }
  }

  // Ends the session's process, interrupting its turn first, and rests the
  // row with no exit notice and no alert; the process's later events are no
  // longer live. Does nothing for a resting session.
  function endForClear(session: HeldSession) {
    const { process } = session;
    if (process === null) {
      return;
    }
    const { sessionId } = session.state;
    if (session.state.activity !== 'idle') {
      process.interrupt();
    }
    process
      .end()
      .catch((error: unknown) =>
        log(`session ${sessionId} end failed: ${errorText(error)}`),
      );
    session.state.running = false;
    session.process = null;
    showRestingIdle(session);
  }

  function clear(sessionId: string) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log(`clear for unknown session ${sessionId} ignored`);
      return;
    }
    if (isDetached) {
      log(`clear for session ${sessionId} ignored: chat is stopping`);
      return;
    }
    if (session.attaching !== null) {
      throw new Error(`session ${sessionId} is still attaching`);
    }
    const profile = profileNamed(session.state.profile);
    const harness = requireHarness();
    if (session.unheldProcessId !== null) {
      log(
        `session ${sessionId} cleared; process ${session.unheldProcessId} left running on the session host`,
      );
      session.unheldProcessId = null;
    }
    endForClear(session);
    session.state.activeTime = NO_ACTIVE_TIME;
    sendActiveTime(session);
    clearCompaction(session, profileDirOf(profile));
    cancelPending(session);
    returnAllHeld(session);
    const oldHostId = session.hostId;
    const wasSent = session.sent;
    const newHostId = deps.randomUuid();
    session.owned.setHostSessionId(newHostId);
    session.hostId = newHostId;
    session.sent = false;
    session.historyPending = false;
    session.historyBefore = null;
    if (selectedHostId === oldHostId) {
      selectedHostId = newHostId;
    }
    session.state.entries = [
      nextNotice(session, 'Conversation cleared', 'info'),
    ];
    send('entries', { sessionId, entries: [...session.state.entries] });
    deps.emit('sessionCleared', {
      sessionId,
      oldHostSessionId: oldHostId,
      newHostSessionId: newHostId,
      projectDir: session.state.projectDir,
      profile: session.state.profile,
      titles: sessions.titles(sessionId) ?? NO_TITLES,
      sent: wasSent,
    });
    try {
      startProcess(session, harness, profile, false);
    } catch (error) {
      send('sessionRested', { sessionId, error: null });
      throw error;
    } finally {
      save();
    }
    log(`conversation cleared in ${path.basename(session.state.projectDir)}`);
  }

  // Today's end of a closed row: its process's, then the owned session's.
  function endClosed(session: HeldSession) {
    const { sessionId } = session.state;
    if (session.unheldProcessId !== null) {
      log(
        `session ${sessionId} closed; process ${session.unheldProcessId} left running on the session host`,
      );
    }
    if (!session.state.running) {
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
    sessions: () =>
      [...held.values()].map((session) => copyState(session.state)),
    hostSessionIdOf: (sessionId) => held.get(sessionId)?.hostId ?? null,
    start: (request) =>
      startNew(request, 'new', { select: true }).state.sessionId,
    launch,
    restore,
    loadHistory,
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
      selectedHostId = session.hostId;
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
      const pulled = session.state.queued.find(
        (queued) => queued.id === queuedId,
      );
      if (pulled === undefined) {
        log(`queued message ${queuedId} no longer queued`);
        return;
      }
      if (!isUnsent(pulled)) {
        log(`queued message ${queuedId} already sent`);
        return;
      }
      session.state.queued = session.state.queued.filter(
        (queued) => queued !== pulled,
      );
      sendQueued(session);
      returnToBox(session, [pulled]);
    },
    returnedPlaced(sessionId, returnedIds) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`returnedPlaced for unknown session ${sessionId} ignored`);
        return;
      }
      session.state.returned = session.state.returned.filter(
        (message) => !returnedIds.includes(message.id),
      );
      save();
    },
    sendNow(sessionId, queuedId) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log(`sendNow for unknown session ${sessionId} ignored`);
        return;
      }
      const row = session.state.queued.find((queued) => queued.id === queuedId);
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
        sendQueued(session);
      }
    },
    sendAllNow,
    setControl(sessionId, controlId, value) {
      const session = held.get(sessionId);
      if (session === undefined || !session.state.running) {
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
      settlePermission(session, pending, answer);
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
          log(
            `session ${session.state.sessionId} still attaching; not stopped`,
          );
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
      const heldProcesses = new Set<AgentProcess>();
      for (const session of held.values()) {
        if (session.process !== null) {
          heldProcesses.add(session.process);
          session.process.detach();
        }
      }
      for (const process of running) {
        if (!heldProcesses.has(process)) {
          process.kill();
        }
      }
      return lastSave;
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
      return {
        dispose() {
          instructionRegistrations.delete(registration);
        },
      };
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
    // The chat state is looked up on every call: sessions builds the tool
    // session inside `open`, before `openRow` stores the state.
    permissionToolSession(agentSession) {
      return {
        async call(name, args, { signal }) {
          return afterAttach(held.get(agentSession.id), () =>
            permissionCall(agentSession.id, name, args, signal),
          );
        },
        end() {
          const session = held.get(agentSession.id);
          if (session) {
            settleAllAsAborted(session);
          }
        },
      };
    },
  };
}
