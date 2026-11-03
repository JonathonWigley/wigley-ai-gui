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
import type { Log } from '../../../contracts/log';
import type { MainChannel, PluginEvents } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { refusalOf } from '../image-rules';
import {
  type AgentSession,
  type OpenOptions,
  type OwnedSession,
  type SessionsMainExports,
  type SessionTitles,
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
  type QueuedMessage,
  type ResumeRequest,
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
  log: Log;
  // Stamps the `at` of the notices and permission entries chat makes itself.
  clock: Clock;
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
  // Opens a resting row for each saved session in order, unselected, with its
  // saved titles, skipping one already open in the app, then activates the
  // saved selection. Saving starts here: nothing is saved before it runs.
  restore(saved: SavedSessions): void;
  // Reads a restored session's earlier conversation once and puts it before
  // the entries held so far; does nothing for a session with none pending,
  // and reads nothing while its profile is missing, leaving it pending.
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
  setArchived(hostSessionId: string, archived: boolean): Promise<void>;
  // Opens a row for a saved session, its earlier conversation as the first
  // entries and the request's title as its first-message title, and resumes
  // its process; resolves to the row's sessionId. A
  // session chat holds a row for has that row activated instead; one open in
  // the app on any other row rejects, as does any after `killAll`.
  resume(request: ResumeRequest): Promise<string>;
  // Starts a resting session's process first, rejecting when its profile is
  // missing or the start fails; the row then stays resting. A restored row
  // whose earlier conversation is still pending has it read before the start,
  // so the read holds none of this turn. After `killAll` a resting session
  // starts no process and the message is dropped. While the harness reports
  // its turn running the message is queued instead, and each `idle` the
  // harness reports writes the oldest queued message not sent now until none
  // is left; a permission call left waiting after the turn ended queues
  // nothing. A written message is held until its entry arrives, and returned
  // when the harness reports it dropped. The first message written in a row
  // with no first-message title sets it.
  send(sessionId: string, message: UserMessage): Promise<void>;
  // Adds an app notice to the session's entries and sends it as harness
  // entries travel, so `sessions()` keeps it.
  notice(sessionId: string, text: string, tone: 'info' | 'error'): void;
  // Returns every queued message not sent now, then interrupts the process;
  // messages sent now stay queued.
  interrupt(sessionId: string): void;
  // Ends the session's process, interrupting a running turn first, and starts a
  // fresh one at once under a new host session id with the row's held mode and
  // the model and effort the user picked that a report confirmed. Waiting
  // permission calls are cancelled, and messages written but not taken in
  // and every queued message returned in the order written; the old
  // process raises no exit notice and no turn-finished alert. The entries
  // become one `Conversation cleared` notice. A resting session just starts its
  // fresh process. Throws before changing anything when the profile or harness
  // is missing; a fresh start that throws leaves the row resting under the new
  // id, then rethrows. Logs and does nothing for a session chat does not hold,
  // or after `killAll`.
  clear(sessionId: string): void;
  // Takes the queued message out of the queue and returns it; logs and sends
  // nothing for one no longer queued or already sent now.
  pullBack(sessionId: string, queuedId: string): void;
  // Writes the queued message at once and keeps its row, marked with the
  // entry id the write returned, until that entry arrives; logs and sends
  // nothing for one no longer queued or already sent now, and a write that
  // throws leaves the row unsent.
  sendNow(sessionId: string, queuedId: string): void;
  // While the harness reports the turn running, writes every queued message
  // not sent now, oldest first, then `message` as a new last row, each as
  // `sendNow` does, stopping at a write that throws. Otherwise sends
  // `message` as `send` does, and a null `message` does nothing.
  sendAllNow(sessionId: string, message: UserMessage | null): Promise<void>;
  // Throws for a session chat no longer holds or that has no running process,
  // as the process's own `setControl` throws for a value it refuses, so the
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
  // The sessions plugin's `closed` event for `sessionId`: drops its saved
  // record, ends the process, then the owned session, which drops its row; a
  // resting session has its owned session ended at once.
  closed(sessionId: string): void;
  // Kills every process not yet exited, a closed session's still ending
  // included, for an app quit or a chat plugin reload, which does not wait
  // for `end`; nothing is saved or started after it.
  killAll(): void;
  // The sessions plugin's `connected` event: records the session's host id
  // as open in the app.
  sessionConnected(session: AgentSession): void;
  // The sessions plugin's `ended` event: the session's host id is no longer
  // open.
  sessionEnded(sessionId: string): void;
  // The `start` chat hands `sessions.contributeTools` with PERMISSION_TOOLS.
  permissionToolSession(session: AgentSession): ToolSession;
  // Registers `text` for every process start from now on, in registration
  // order; a running process keeps what it started with. Disposing the
  // registration drops it from later starts; a second dispose does nothing.
  addInstructions(text: string): Disposable;
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
// `start` runs.
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
  // Ids of the controls whose pick in this row a report confirmed; a start
  // passes their held values and no other model or effort.
  userSetControls: Set<string>;
  // Control id → the value the user picked that the running process has not
  // reported yet.
  pendingPicks: Map<string, string>;
  // How the process exited, once its `ended` arrives; a user close logs it.
  exit: { code: number | null; error: string | null } | null;
  // Branch reads started in this row, numbering them; only the latest applies.
  branchReads: number;
}

const QUIT_DURING_TURN_TEXT =
  'The app quit during this turn. Your next message resumes this session.';

function missingProfileText(name: string): string {
  return `Profile ${name} is not in chat's profiles setting; add it back to resume this session.`;
}

function exitNoticeText(code: number | null, error: string | null): string {
  const exitCode = code === null ? 'unknown' : String(code);
  const reason = error === null ? '' : `: ${error}`;
  return `Claude stopped (exit code ${exitCode})${reason}. Your next message resumes this session.`;
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
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
  };
}

// A held mode narrows nothing, so a start passes it whoever set it.
const MODE_CONTROL_ID = 'mode';

// The launch values a process starts with: the held mode, and each other held
// control the user set, all with a value.
function controlValuesOf(
  controls: readonly SessionControl[],
  userSetControls: ReadonlySet<string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const isPassed =
      control.id === MODE_CONTROL_ID || userSetControls.has(control.id);
    if (control.value !== null && isPassed) {
      values[control.id] = control.value;
    }
  }
  return values;
}

// Moves each pending pick whose control `controls` holds at the picked value
// into `userSetControls`.
function confirmPicks(
  controls: readonly SessionControl[],
  pendingPicks: Map<string, string>,
  userSetControls: Set<string>,
) {
  for (const control of controls) {
    const isConfirmed =
      control.value !== null && pendingPicks.get(control.id) === control.value;
    if (isConfirmed) {
      pendingPicks.delete(control.id);
      userSetControls.add(control.id);
    }
  }
}

function userMessageOf(queued: QueuedMessage): UserMessage {
  return { text: queued.text, images: queued.images };
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

function sameNames(held: readonly string[], names: readonly string[]): boolean {
  return (
    held.length === names.length &&
    held.every((name, index) => name === names[index])
  );
}

function shownActivity(held: HeldSession): ProcessActivity {
  return held.pending.size > 0 ? 'waiting' : held.harnessActivity;
}

function savedSessionOf(
  session: HeldSession,
  titles: SessionTitles,
): SavedSession {
  return {
    hostSessionId: session.hostId,
    projectDir: session.state.projectDir,
    profile: session.state.profile,
    sent: session.sent,
    busy: session.state.activity !== 'idle',
    titles,
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
// calls waiting on the user, the messages queued behind its running turn, and
// the messages written to the agent it has not taken in yet;
// the folder's saved sessions it can resume; and
// the open sessions it saves and restores across a relaunch. Every state
// change reaches the page over `send`.
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
  // before they are read; it stops for good at `killAll`.
  let isRestored = false;
  let isKilled = false;
  // One object per `addInstructions` call, in registration order.
  const instructionRegistrations = new Set<{ text: string }>();

  function snapshot(): SavedSessions {
    const records = [...held.values()].map((session) =>
      savedSessionOf(
        session,
        sessions.titles(session.state.sessionId) ?? NO_TITLES,
      ),
    );
    const selectionHeld = records.some(
      (record) => record.hostSessionId === selectedHostId,
    );
    return {
      sessions: records,
      selectedHostSessionId: selectionHeld ? selectedHostId : null,
    };
  }

  function save() {
    if (!isRestored || isKilled) {
      return;
    }
    deps.saved
      .save(snapshot())
      .catch((error: unknown) =>
        log('chat', `open sessions not saved: ${errorText(error)}`),
      );
  }

  // Held, and `processStart` is its running process.
  function isLive(session: HeldSession, processStart: number): boolean {
    return (
      held.get(session.state.sessionId) === session &&
      session.state.running &&
      session.processStarts === processStart
    );
  }

  // The harness reports the turn running, so a message sent now waits.
  function isTurnRunning(session: HeldSession): boolean {
    return session.state.running && session.harnessActivity !== 'idle';
  }

  // The session's held state while its process runs, or null after logging
  // that the call was ignored.
  function liveFor(method: string, sessionId: string): HeldSession | null {
    const session = held.get(sessionId) ?? null;
    if (session === null) {
      log('chat', `${method} for unknown session ${sessionId} ignored`);
      return null;
    }
    if (!session.state.running) {
      log('chat', `${method} for resting session ${sessionId} ignored`);
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
  }

  function updateActivity(session: HeldSession) {
    const previous = session.state.activity;
    const activity = shownActivity(session);
    if (activity === previous) {
      return;
    }
    session.state.activity = activity;
    const { sessionId } = session.state;
    send('activity', { sessionId, activity });
    const turnFinished = activity === 'idle' && previous !== 'idle';
    const turnStarted = activity !== 'idle' && previous === 'idle';
    const userIsElsewhere =
      !deps.window.isFocused() || sessions.selectedSessionId() !== sessionId;
    const workIsOver = session.backgroundIds.size === 0;
    if (turnFinished && userIsElsewhere && workIsOver) {
      announceTurnFinished(session);
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
      send('returned', { sessionId: session.state.sessionId, messages });
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
    send('returned', {
      sessionId: session.state.sessionId,
      messages: unsent.map(userMessageOf),
    });
  }

  // Writes the oldest queued message not sent now to the agent; false when
  // none is queued or the write throws, which puts it back at its place.
  function writeNextQueued(session: HeldSession): boolean {
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
      log('chat', `queued message ${next.id} not sent: ${errorText(error)}`);
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
      log('chat', `queued message ${row.id} not sent: ${errorText(error)}`);
      return false;
    }
    const sentRow = { ...row, sentEntryId };
    session.rowOrders.set(sentRow, rowOrderOf(session, row));
    session.state.queued = session.state.queued.map((queued) =>
      queued === row ? sentRow : queued,
    );
    return true;
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

  // The agent dropped the message written under `entryId` without taking it
  // in: its sent row leaves the queue, and the message goes back to the page.
  function returnDropped(session: HeldSession, entryId: string) {
    const { sessionId } = session.state;
    const row = session.state.queued.find(
      (queued) => queued.sentEntryId === entryId,
    );
    const written = session.writtenMessages.get(entryId);
    if (row !== undefined) {
      session.state.queued = session.state.queued.filter(
        (queued) => queued !== row,
      );
      sendQueued(session);
      send('returned', { sessionId, messages: [userMessageOf(row)] });
    } else if (written !== undefined) {
      session.writtenMessages.delete(entryId);
      send('returned', { sessionId, messages: [written.message] });
    } else {
      log('chat', `dropped message ${entryId} not held`);
      return;
    }
    log('chat', `sent message ${entryId} returned: never taken in`);
  }

  // The state is dropped first, so every later event for the session is
  // ignored; its queue goes with it, returned nowhere.
  function drop(session: HeldSession) {
    held.delete(session.state.sessionId);
    cancelPending(session);
  }

  // The harness emits `ended` before `end()` resolves, so the exit is known here.
  function logCloseExit(session: HeldSession) {
    const { sessionId } = session.state;
    if (session.exit === null) {
      log('chat', `session ${sessionId} closed; no exit reported`);
      return;
    }
    const { code, error } = session.exit;
    log(
      'chat',
      `session ${sessionId} closed (code ${code}${error === null ? '' : `, error: ${error}`})`,
    );
  }

  function settlePermission(
    session: HeldSession,
    pending: PendingPermission,
    answer: PermissionAnswer,
  ) {
    pending.signal.removeEventListener('abort', pending.onAbort);
    session.pending.delete(pending.entry.id);
    const entry: PermissionEntry = {
      ...pending.entry,
      answer: { allowed: answer.allowed, reason: answer.reason },
    };
    sendEntry(session, entry);
    pending.resolve(permissionReplyText(answer, pending.entry.input));
    updateActivity(session);
  }

  // The events of the row's `processStart`th process, started under
  // `profileDir`; `started.process` is that process once the harness's `start`
  // returns.
  function processEvents(
    session: HeldSession,
    processStart: number,
    started: { process: AgentProcess | null },
    profileDir: string,
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
          confirmPicks(controls, session.pendingPicks, session.userSetControls);
          send('controls', { sessionId, controls });
        }
      },
      activity(activity) {
        if (!isLive(session, processStart)) {
          return;
        }
        // A queued message starts the next turn, so the session shows no idle
        // in between and the turn-finished alert waits for the last one.
        if (activity === 'idle' && writeNextQueued(session)) {
          return;
        }
        session.harnessActivity = activity;
        updateActivity(session);
      },
      commands(names) {
        if (
          !isLive(session, processStart) ||
          sameNames(session.state.commands, names)
        ) {
          return;
        }
        session.state.commands = [...names];
        send('commands', { sessionId, names: [...names] });
      },
      planUsage(update) {
        if (isLive(session, processStart)) {
          deps.emit('planUsage', { profileDir, update });
        }
      },
      agentEvent(event) {
        // A closed row's process still ends, and its log and roster close on
        // its `sessionEnded`.
        const endsTheSession = event.type === 'sessionEnded';
        const isLiveEvent = isLive(session, processStart);
        if (isLiveEvent || endsTheSession) {
          deps.emit('agentEvent', {
            sessionId,
            profileDir,
            hostSessionId,
            event,
            replayed: false,
          });
        }
        if (isLiveEvent) {
          trackBackground(session, event);
        }
        if (isLiveEvent && event.type === 'turnEnded') {
          readBranch(session);
        }
      },
      // Returns a written message the agent let go without taking it in.
      messageDropped(entryId) {
        if (isLive(session, processStart)) {
          returnDropped(session, entryId);
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
        log('chat', `session ${sessionId} ended (code ${code})`);
        if (error !== null) {
          log('chat', `session ${sessionId} failed: ${error}`);
        }
        // The row and its state stay, resting, until the user closes the row.
        session.state.running = false;
        session.process = null;
        showPendingCancelled(session);
        cancelPending(session);
        returnAllHeld(session);
        const isCleanExit = code === 0 && error === null;
        addNotice(
          session,
          exitNoticeText(code, error),
          isCleanExit ? 'info' : 'error',
        );
        send('sessionRested', { sessionId, error });
        clearBackground(session);
        showRestingIdle(session);
        save();
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
        controls: [],
        activity: 'idle',
        background: 0,
        commands: [],
        running: false,
        queued: [],
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
      heldCount: 0,
      rowOrders: new WeakMap(),
      writtenMessages: new Map(),
      processStarts: 0,
      userSetControls: new Set(),
      pendingPicks: new Map(),
      exit: null,
      branchReads: 0,
    };
    held.set(sessionId, session);
    if (profileDir !== null) {
      deps.emit('sessionOpened', { sessionId, profileDir });
    }
    // The sessions plugin emits `selected` inside `open`, before the row is
    // held, so `selected` cannot record it.
    if (options.select) {
      selectedHostId = hostId;
    }
    send('sessionStarted', copyState(session.state));
    readBranch(session);
    return session;
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
        log('chat', `branch not read in ${folderName}: ${errorText(error)}`),
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

  // Starts the session's process with the held mode and the confirmed picks,
  // and records the folder; a throw from the harness leaves the session
  // resting. A pick still pending and the background work belong to the old
  // process and are dropped.
  function startProcess(
    session: HeldSession,
    harness: AgentHarness,
    profile: ChatProfile,
    resume: boolean,
  ) {
    const { sessionId, projectDir } = session.state;
    session.processStarts += 1;
    session.pendingPicks.clear();
    clearBackground(session);
    const started: { process: AgentProcess | null } = { process: null };
    const profileDir = profileDirOf(profile);
    const process = harness.start(
      {
        processId: `${session.hostId}:${session.processStarts}`,
        sessionId: session.hostId,
        resume,
        projectDir,
        profileDir,
        controls: controlValuesOf(
          session.state.controls,
          session.userSetControls,
        ),
        instructions: [...instructionRegistrations].map(
          (registration) => registration.text,
        ),
      },
      processEvents(session, session.processStarts, started, profileDir),
    );
    started.process = process;
    session.process = process;
    session.exit = null;
    running.add(process);
    session.state.running = true;
    send('sessionRunning', { sessionId });
    log('chat', `session ${sessionId} process started (resume ${resume})`);
    deps.recent
      .record(projectDir, profile.name)
      .catch((error: unknown) =>
        log('chat', `recent folders not saved: ${errorText(error)}`),
      );
  }

  // Opens the row for `hostId` and starts its process; a start that throws
  // drops the session, then ends the owned session. After `killAll` it throws
  // and opens nothing.
  function openAndStart(
    harness: AgentHarness,
    profile: ChatProfile,
    projectDir: string,
    opening: {
      hostId: string;
      resume: boolean;
      entries: ChatEntry[];
      titles: SessionTitles;
    },
    options: OpenOptions,
  ): HeldSession {
    if (isKilled) {
      throw new Error(
        `session ${opening.hostId} not started: chat is stopping`,
      );
    }
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
      },
      options,
    );
    try {
      startProcess(session, harness, profile, opening.resume);
    } catch (error) {
      drop(session);
      session.owned.end();
      throw error;
    }
    save();
    return session;
  }

  // A new session in the folder, its row selected as `options` says.
  function startNew(request: StartRequest, options: OpenOptions): HeldSession {
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
      },
      options,
    );
  }

  async function sendMessage(sessionId: string, message: UserMessage) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log('chat', `send for unknown session ${sessionId} ignored`);
      return;
    }
    if (isTurnRunning(session)) {
      queue(session, message);
      return;
    }
    await writeAtIdle(session, message);
  }

  // Writes `message` to a session whose harness runs no turn, starting a
  // resting session's process first.
  async function writeAtIdle(session: HeldSession, message: UserMessage) {
    const { sessionId } = session.state;
    if (!session.state.running) {
      const profile = profileNamed(session.state.profile);
      const harness = requireHarness();
      const reading = historyReadOf(session, profile, harness);
      if (reading !== null) {
        await reading;
        if (held.get(sessionId) !== session) {
          log(
            'chat',
            `send for session ${sessionId} closed while reading ignored`,
          );
          return;
        }
      }
      if (isKilled) {
        log('chat', `send for session ${sessionId} ignored: chat is stopping`);
        return;
      }
      if (!session.state.running) {
        startProcess(session, harness, profile, session.sent);
      }
    }
    deliverWritten(session, message);
  }

  async function sendAllNow(sessionId: string, message: UserMessage | null) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log('chat', `sendAllNow for unknown session ${sessionId} ignored`);
      return;
    }
    if (!isTurnRunning(session)) {
      if (message !== null) {
        await writeAtIdle(session, message);
      }
      return;
    }
    const hasUnsent = session.state.queued.some(isUnsent);
    if (!hasUnsent && message === null) {
      log('chat', `nothing to send now in ${sessionId}`);
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
    log('chat', `queued a message in session ${session.state.sessionId}`);
  }

  function appendQueued(session: HeldSession, message: UserMessage) {
    session.queuedCount += 1;
    const row = {
      ...message,
      id: `queued-${session.queuedCount}`,
      sentEntryId: null,
    };
    session.rowOrders.set(row, nextHeldOrder(session));
    session.state.queued = [...session.state.queued, row];
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
    const session = startNew(request, { select: false });
    deliverWritten(session, request.message);
    const { sessionId } = session.state;
    log('chat', `launched session ${sessionId} in ${request.projectDir}`);
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

  function restoreRecord(record: SavedSession) {
    const { hostSessionId } = record;
    if (
      holding(hostSessionId) !== undefined ||
      isOpenOnOtherRow(hostSessionId)
    ) {
      log('chat', `session ${hostSessionId} already open; not restored`);
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
        },
        { select: false },
      );
    } catch (error) {
      log('chat', `session ${hostSessionId} not restored: ${errorText(error)}`);
      return;
    }
    if (record.busy) {
      addNotice(session, QUIT_DURING_TURN_TEXT, 'info');
    }
    if (profile === undefined) {
      addNotice(session, missingProfileText(record.profile), 'error');
    }
    if (record.sent && profile !== undefined) {
      restoreSavedUsage(session, profile).catch((error: unknown) =>
        log(
          'chat',
          `saved usage of ${hostSessionId} not read: ${errorText(error)}`,
        ),
      );
    }
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
    if (event === null || isKilled) {
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
      log(
        'chat',
        `saved usage of ${hostSessionId} not read: ${errorText(error)}`,
      );
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

  function restore(saved: SavedSessions) {
    if (isKilled) {
      log('chat', 'open sessions not restored: chat is stopping');
      return;
    }
    for (const record of saved.sessions) {
      restoreRecord(record);
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
  ): Promise<ChatEntry[]> {
    try {
      return await harness.history(hostSessionId, projectDir, profileDir, null);
    } catch (error) {
      const reason = errorText(error);
      log('chat', `history of ${hostSessionId} not read: ${reason}`);
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
    );
    if (isClosedOrCleared(session, sessionId, hostId)) {
      return;
    }
    session.state.entries = [...history, ...session.state.entries];
    send('entries', { sessionId, entries: [...session.state.entries] });
  }

  async function loadHistory(sessionId: string): Promise<void> {
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
    await historyReadOf(session, profile, requireHarness());
  }

  // A file that cannot be read marks no row archived, so every saved session
  // can still be resumed.
  async function archivedIdsOrNone(): Promise<ReadonlySet<string>> {
    try {
      return await deps.archived.ids();
    } catch (error) {
      log('chat', `archived sessions not read: ${errorText(error)}`);
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

  async function resume(request: ResumeRequest): Promise<string> {
    const profile = profileNamed(request.profile);
    const harness = requireHarness();
    const { hostSessionId, projectDir } = request;
    const existing = holding(hostSessionId);
    if (existing !== undefined) {
      sessions.activate(existing.state.sessionId);
      return existing.state.sessionId;
    }
    if (isOpenOnOtherRow(hostSessionId)) {
      throw new Error(`session ${hostSessionId} is already open in the app`);
    }
    const profileDir = profileDirOf(profile);
    const [entries, usage] = await Promise.all([
      readHistory(harness, hostSessionId, projectDir, profileDir),
      readSavedUsage(harness, hostSessionId, projectDir, profileDir),
    ]);
    const session = openAndStart(
      harness,
      profile,
      projectDir,
      {
        hostId: hostSessionId,
        resume: true,
        entries,
        titles: {
          ...NO_TITLES,
          firstMessage: firstMessageTitleOf(request.title),
        },
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
        log('chat', `session ${sessionId} end failed: ${errorText(error)}`),
      );
    session.state.running = false;
    session.process = null;
    showRestingIdle(session);
  }

  function clear(sessionId: string) {
    const session = held.get(sessionId);
    if (session === undefined) {
      log('chat', `clear for unknown session ${sessionId} ignored`);
      return;
    }
    if (isKilled) {
      log('chat', `clear for session ${sessionId} ignored: chat is stopping`);
      return;
    }
    const profile = profileNamed(session.state.profile);
    const harness = requireHarness();
    endForClear(session);
    cancelPending(session);
    returnAllHeld(session);
    const oldHostId = session.hostId;
    const newHostId = deps.randomUuid();
    session.owned.setHostSessionId(newHostId);
    session.hostId = newHostId;
    session.sent = false;
    session.historyPending = false;
    if (selectedHostId === oldHostId) {
      selectedHostId = newHostId;
    }
    session.state.entries = [
      nextNotice(session, 'Conversation cleared', 'info'),
    ];
    send('entries', { sessionId, entries: [...session.state.entries] });
    try {
      startProcess(session, harness, profile, false);
    } catch (error) {
      send('sessionRested', { sessionId, error: null });
      throw error;
    } finally {
      save();
    }
    log(
      'chat',
      `conversation cleared in ${path.basename(session.state.projectDir)}`,
    );
  }

  return {
    sessions: () =>
      [...held.values()].map((session) => copyState(session.state)),
    hostSessionIdOf: (sessionId) => held.get(sessionId)?.hostId ?? null,
    start: (request) => startNew(request, { select: true }).state.sessionId,
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
    setArchived: (hostSessionId, archived) =>
      deps.archived.set(hostSessionId, archived),
    resume,
    send: sendMessage,
    notice(sessionId, text, tone) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log('chat', `notice for unknown session ${sessionId} ignored`);
        return;
      }
      addNotice(session, text, tone);
    },
    // A resting session's queue is always empty, so `liveFor` skipping it
    // returns nothing.
    interrupt(sessionId) {
      const session = liveFor('interrupt', sessionId);
      if (session === null) {
        return;
      }
      returnUnsent(session);
      session.process?.interrupt();
    },
    clear,
    pullBack(sessionId, queuedId) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log('chat', `pullBack for unknown session ${sessionId} ignored`);
        return;
      }
      const pulled = session.state.queued.find(
        (queued) => queued.id === queuedId,
      );
      if (pulled === undefined) {
        log('chat', `queued message ${queuedId} no longer queued`);
        return;
      }
      if (!isUnsent(pulled)) {
        log('chat', `queued message ${queuedId} already sent`);
        return;
      }
      session.state.queued = session.state.queued.filter(
        (queued) => queued !== pulled,
      );
      sendQueued(session);
      send('returned', { sessionId, messages: [userMessageOf(pulled)] });
    },
    sendNow(sessionId, queuedId) {
      const session = held.get(sessionId);
      if (session === undefined) {
        log('chat', `sendNow for unknown session ${sessionId} ignored`);
        return;
      }
      const row = session.state.queued.find((queued) => queued.id === queuedId);
      if (row === undefined) {
        log('chat', `queued message ${queuedId} no longer queued`);
        return;
      }
      if (!isUnsent(row)) {
        log('chat', `queued message ${queuedId} already sent`);
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
        log('chat', `answerPermission for unknown entry ${entryId} ignored`);
        return;
      }
      settlePermission(session, pending, answer);
    },
    closed(sessionId) {
      const session = held.get(sessionId);
      if (!session) {
        return;
      }
      drop(session);
      save();
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
          log('chat', `session ${sessionId} end failed: ${errorText(error)}`);
          session.owned.end();
        },
      );
    },
    killAll() {
      isKilled = true;
      for (const process of running) {
        process.kill();
      }
    },
    sessionConnected(session) {
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
    // The chat state is looked up on every call: sessions builds the tool
    // session inside `open`, before `openRow` stores the state.
    permissionToolSession(agentSession) {
      return {
        async call(name, args, { signal }) {
          const session = held.get(agentSession.id);
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
