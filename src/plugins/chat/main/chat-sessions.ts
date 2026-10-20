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
import { expandHome } from '../../../shared/expand-home';
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
  PermissionAnswer,
  StartRequest,
} from '../contract';
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
  profiles: readonly ChatProfile[];
  homeDir: string;
  randomUuid: RandomUuid;
  recent: RecentFolders;
  send: MainChannel<ChatChannel>['send'];
  alerts: Pick<Alerts, 'announce'>;
  window: { show(): void; isFocused(): boolean };
  log: Log;
}

export interface ChatSessions {
  sessions(): ChatSessionState[];
  start(request: StartRequest): string;
  send(sessionId: string, text: string): void;
  interrupt(sessionId: string): void;
  setControl(sessionId: string, controlId: string, value: string): void;
  answerPermission(
    sessionId: string,
    entryId: string,
    answer: PermissionAnswer,
  ): void;
  // The sessions plugin's `closed` event for `sessionId`.
  closed(sessionId: string): void;
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
  };
}

function shownActivity(held: HeldSession): ProcessActivity {
  return held.pending.size > 0 ? 'waiting' : held.harnessActivity;
}

// Chat's owned sessions: each one's agent process, its chat entries and
// controls, the activity it shows, and the permission calls waiting on the
// user. Every state change reaches the page over `send`.
export function createChatSessions(deps: ChatSessionsDeps): ChatSessions {
  const { sessions, send, log } = deps;
  // Insertion order is start order.
  const held = new Map<string, HeldSession>();

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
      // Plan B reads the session's commands.
      commands() {},
      ended({ code, error }) {
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
    const profile = deps.profiles.find((held) => held.name === name);
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

  function start(request: StartRequest): string {
    const profile = requireProfile(request.profile);
    const harness = requireHarness();
    const hostId = deps.randomUuid();
    const owned = sessions.open({
      sessionId: hostId,
      projectDir: request.projectDir,
      deadlineSeconds: null,
      harness: CHAT_HARNESS_ID,
    });
    const sessionId = owned.session.id;
    const session: HeldSession = {
      state: {
        sessionId,
        projectDir: request.projectDir,
        profile: request.profile,
        entries: [],
        controls: [],
        activity: 'idle',
      },
      owned,
      process: null,
      harnessActivity: 'idle',
      pending: new Map(),
      permissionCount: 0,
    };
    held.set(sessionId, session);
    send('sessionStarted', copyState(session.state));
    try {
      session.process = harness.start(
        {
          sessionId: hostId,
          resume: false,
          projectDir: request.projectDir,
          profileDir: expandHome(profile.configDir, deps.homeDir),
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
      .record(request.projectDir, request.profile)
      .catch((error: unknown) =>
        log('chat', `recent folders not saved: ${errorText(error)}`),
      );
    return sessionId;
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
    send(sessionId, text) {
      heldFor('send', sessionId)?.process?.send(text);
    },
    interrupt(sessionId) {
      heldFor('interrupt', sessionId)?.process?.interrupt();
    },
    setControl(sessionId, controlId, value) {
      heldFor('setControl', sessionId)?.process?.setControl(controlId, value);
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
        () => session.owned.end(),
        (error: unknown) => {
          log('chat', `session ${sessionId} end failed: ${errorText(error)}`);
          session.owned.end();
        },
      );
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
