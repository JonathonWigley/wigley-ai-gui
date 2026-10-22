import path from 'node:path';
import type {
  AgentHarness,
  AgentProcess,
  AgentProcessEvents,
  ChatEntry,
  ProcessActivity,
} from '../../../contracts/agent';
import type { Alerts } from '../../../contracts/alerts';
import type { RandomUuid } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type {
  AgentSession,
  OwnedSession,
  SessionsMainExports,
  ToolResult,
  ToolSession,
} from '../../sessions/contract';
import type {
  ChatChannel,
  ChatProfile,
  ChatSessionState,
  PastSessionRow,
  PermissionAnswer,
  ResumeRequest,
  StartRequest,
} from '../contract';
import type { ArchivedSessions } from './archived-sessions';
import {
  CANCELLED_REASON,
  NOT_OWNED_TEXT,
  PERMISSION_TOOL_NAME,
  type PermissionRequest,
  permissionReplyText,
  readPermissionRequest,
} from './permission-tool';
import type { RecentFolders } from './recent-folders';

export const CHAT_HARNESS_ID = 'claude';
export const TURN_FINISHED_TITLE = 'Turn finished';

export interface ChatSessionsDeps {
  harnesses: readonly AgentHarness[];
  sessions: Pick<
    SessionsMainExports,
    'open' | 'mark' | 'activate' | 'selectedSessionId'
  >;
  // Read at each session start.
  profiles(): readonly ChatProfile[];
  randomUuid: RandomUuid;
  recent: RecentFolders;
  archived: ArchivedSessions;
  send: MainChannel<ChatChannel>['send'];
  alerts: Pick<Alerts, 'announce'>;
  window: { show(): void; isFocused(): boolean };
  log: Log;
}

export interface ChatSessions {
  sessions(): ChatSessionState[];
  start(request: StartRequest): string;
  // The folder's saved sessions under the profile, newest first, leaving out
  // every session open in the app. When the archived-sessions file cannot be
  // read, every row lists as not archived and the failure is logged; the
  // file is left as it is.
  pastSessions(projectDir: string, profile: string): Promise<PastSessionRow[]>;
  setArchived(hostSessionId: string, archived: boolean): Promise<void>;
  // Opens a row for a saved session, its earlier conversation as the first
  // entries, and resumes its process; resolves to the row's sessionId.
  resume(request: ResumeRequest): Promise<string>;
  send(sessionId: string, text: string): void;
  interrupt(sessionId: string): void;
  // Throws for a session chat no longer holds, as the process's own
  // `setControl` throws for a value it refuses, so the caller learns the
  // change was not made.
  setControl(sessionId: string, controlId: string, value: string): void;
  answerPermission(
    sessionId: string,
    entryId: string,
    answer: PermissionAnswer,
  ): void;
  // The sessions plugin's `closed` event for `sessionId`.
  closed(sessionId: string): void;
  // The sessions plugin's `connected` event: records the session's host id
  // as open in the app.
  sessionConnected(session: AgentSession): void;
  // The sessions plugin's `ended` event: the session's host id is no longer
  // open.
  sessionEnded(sessionId: string): void;
  // The `start` chat hands `sessions.contributeTools` with PERMISSION_TOOLS.
  permissionToolSession(session: AgentSession): ToolSession;
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

// `process` is null only while the harness's `start` runs.
interface HeldSession {
  state: ChatSessionState;
  owned: OwnedSession;
  process: AgentProcess | null;
  harnessActivity: ProcessActivity;
  pending: Map<string, PendingPermission>;
  permissionCount: number;
  // How the process exited, once its `ended` arrives; a user close logs it.
  exit: { code: number | null; error: string | null } | null;
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

function copyState(state: ChatSessionState): ChatSessionState {
  return {
    ...state,
    entries: [...state.entries],
    controls: [...state.controls],
    commands: [...state.commands],
  };
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

// Chat's owned sessions: each one's agent process, its chat entries, controls
// and commands, the activity it shows, and the permission calls waiting on the
// user; and the folder's saved sessions it can resume. Every state change
// reaches the page over `send`.
export function createChatSessions(deps: ChatSessionsDeps): ChatSessions {
  const { sessions, send, log } = deps;
  // Insertion order is start order.
  const held = new Map<string, HeldSession>();
  // Row id → host session id of every session open in the app, owned or not.
  const openHostIds = new Map<string, string>();

  function isHeld(session: HeldSession): boolean {
    return held.get(session.state.sessionId) === session;
  }

  // The session's held state, or null after logging that the call was ignored.
  function heldFor(method: string, sessionId: string): HeldSession | null {
    const session = held.get(sessionId) ?? null;
    if (session === null) {
      log('chat', `${method} for unknown session ${sessionId} ignored`);
    }
    return session;
  }

  function sendEntry(session: HeldSession, entry: ChatEntry) {
    session.state.entries = upsertEntry(session.state.entries, entry);
    send('entry', { sessionId: session.state.sessionId, entry });
  }

  function announceTurnFinished(session: HeldSession) {
    const { sessionId, projectDir } = session.state;
    deps.alerts.announce(TURN_FINISHED_TITLE, path.basename(projectDir), () => {
      sessions.activate(sessionId);
      deps.window.show();
    });
    sessions.mark(sessionId);
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
    const userIsElsewhere =
      !deps.window.isFocused() || sessions.selectedSessionId() !== sessionId;
    if (turnFinished && userIsElsewhere) {
      announceTurnFinished(session);
    }
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

  // The state is dropped first, so every later event for the session is
  // ignored.
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

  function processEvents(session: HeldSession): AgentProcessEvents {
    const { sessionId } = session.state;
    return {
      entry(entry) {
        if (isHeld(session)) {
          sendEntry(session, entry);
        }
      },
      controls(controls) {
        if (isHeld(session)) {
          session.state.controls = controls;
          send('controls', { sessionId, controls });
        }
      },
      activity(activity) {
        if (isHeld(session)) {
          session.harnessActivity = activity;
          updateActivity(session);
        }
      },
      commands(names) {
        if (!isHeld(session) || sameNames(session.state.commands, names)) {
          return;
        }
        session.state.commands = [...names];
        send('commands', { sessionId, names: [...names] });
      },
      ended({ code, error }) {
        session.exit = { code, error };
        if (!isHeld(session)) {
          return;
        }
        log('chat', `session ${sessionId} ended (code ${code})`);
        if (error !== null) {
          log('chat', `session ${sessionId} failed: ${error}`);
        }
        drop(session);
        send('sessionEnded', { sessionId, error });
        session.owned.end();
      },
    };
  }

  function requireProfile(name: string): ChatProfile {
    const profile = deps.profiles().find((held) => held.name === name);
    if (!profile) {
      throw new Error(`chat has no profile "${name}"`);
    }
    return profile;
  }

  function requireHarness(): AgentHarness {
    const harness = deps.harnesses.find(
      (candidate) => candidate.id === CHAT_HARNESS_ID,
    );
    if (!harness) {
      throw new Error(`no agent harness "${CHAT_HARNESS_ID}"`);
    }
    return harness;
  }

  function profileDirOf(profile: ChatProfile): string {
    return profile.configDir;
  }

  // Opens the row for `hostId`, stores its state with `entries`, starts its
  // process and records the folder; returns the row's sessionId.
  function openSession(
    harness: AgentHarness,
    profile: ChatProfile,
    projectDir: string,
    opening: { hostId: string; resume: boolean; entries: ChatEntry[] },
  ): string {
    const { hostId } = opening;
    const owned = sessions.open({
      sessionId: hostId,
      projectDir,
      deadlineSeconds: null,
      harness: CHAT_HARNESS_ID,
    });
    const sessionId = owned.session.id;
    const session: HeldSession = {
      state: {
        sessionId,
        projectDir,
        profile: profile.name,
        entries: opening.entries,
        controls: [],
        activity: 'idle',
        commands: [],
      },
      owned,
      process: null,
      harnessActivity: 'idle',
      pending: new Map(),
      permissionCount: 0,
      exit: null,
    };
    held.set(sessionId, session);
    send('sessionStarted', copyState(session.state));
    try {
      session.process = harness.start(
        {
          sessionId: hostId,
          resume: opening.resume,
          projectDir,
          profileDir: profileDirOf(profile),
        },
        processEvents(session),
      );
    } catch (error) {
      owned.end();
      drop(session);
      send('sessionEnded', { sessionId, error: errorText(error) });
      throw error;
    }
    deps.recent
      .record(projectDir, profile.name)
      .catch((error: unknown) =>
        log('chat', `recent folders not saved: ${errorText(error)}`),
      );
    return sessionId;
  }

  function start(request: StartRequest): string {
    const profile = requireProfile(request.profile);
    const harness = requireHarness();
    return openSession(harness, profile, request.projectDir, {
      hostId: deps.randomUuid(),
      resume: false,
      entries: [],
    });
  }

  function isHostIdOpen(hostSessionId: string): boolean {
    return [...openHostIds.values()].includes(hostSessionId);
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
    const profile = requireProfile(profileName);
    const harness = requireHarness();
    const [saved, archivedIds] = await Promise.all([
      harness.listSessions(projectDir, profileDirOf(profile)),
      archivedIdsOrNone(),
    ]);
    return saved
      .filter((past) => !isHostIdOpen(past.sessionId))
      .map((past) => ({
        hostSessionId: past.sessionId,
        title: past.title,
        modified: past.modified,
        archived: archivedIds.has(past.sessionId),
      }));
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
      return await harness.history(hostSessionId, projectDir, profileDir);
    } catch (error) {
      const reason = errorText(error);
      log('chat', `history of ${hostSessionId} not read: ${reason}`);
      return [
        {
          kind: 'notice',
          id: 'history:unread',
          text: `Earlier conversation not read: ${reason}`,
          tone: 'error',
          raw: [],
        },
      ];
    }
  }

  async function resume(request: ResumeRequest): Promise<string> {
    const profile = requireProfile(request.profile);
    const harness = requireHarness();
    const { hostSessionId, projectDir } = request;
    if (isHostIdOpen(hostSessionId)) {
      throw new Error(`session ${hostSessionId} is already open in the app`);
    }
    const entries = await readHistory(
      harness,
      hostSessionId,
      projectDir,
      profileDirOf(profile),
    );
    return openSession(harness, profile, projectDir, {
      hostId: hostSessionId,
      resume: true,
      entries,
    });
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

  return {
    sessions: () =>
      [...held.values()].map((session) => copyState(session.state)),
    start,
    pastSessions,
    setArchived: (hostSessionId, archived) =>
      deps.archived.set(hostSessionId, archived),
    resume,
    send(sessionId, text) {
      heldFor('send', sessionId)?.process?.send(text);
    },
    interrupt(sessionId) {
      heldFor('interrupt', sessionId)?.process?.interrupt();
    },
    setControl(sessionId, controlId, value) {
      const session = held.get(sessionId);
      if (session === undefined) {
        throw new Error(`session ${sessionId} has ended`);
      }
      session.process?.setControl(controlId, value);
    },
    answerPermission(sessionId, entryId, answer) {
      const session = heldFor('answerPermission', sessionId);
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
    sessionConnected(session) {
      if (session.info.sessionId !== null) {
        openHostIds.set(session.id, session.info.sessionId);
      }
    },
    sessionEnded(sessionId) {
      openHostIds.delete(sessionId);
    },
    // The chat state is looked up on every call: sessions builds the tool
    // session inside `open`, before `start` stores the state.
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
          if (signal.aborted) {
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
