import path from 'node:path';
import type { RandomHex } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { PluginEvents } from '../../../contracts/plugin';
import type {
  AgentSession,
  ConnectedSession,
  OwnedSession,
  SessionInfo,
  SessionsMainEvents,
  SessionsMainExports,
  SessionRow,
  SessionsState,
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../contract';

export interface SessionListDeps {
  randomHex: RandomHex;
  log: Log;
  emit: PluginEvents<SessionsMainEvents>['emit'];
  stateChanged(state: SessionsState): void;
  // The user activated a session; called before the state it changes is sent.
  activated(sessionId: string): void;
}

// The session list and its rows. `tools` lists every contributed tool in contribution order.
export interface SessionList extends SessionsMainExports {
  tools(): ToolDefinition[];
  state(): SessionsState;
  // The user's close, which every close guard must allow; returns whether the
  // row closed, emitting `closed` when it did. The session stays connected.
  closeSession(sessionId: string): boolean;
}

interface Contribution {
  tools: ToolDefinition[];
  start(session: AgentSession): ToolSession;
}

// One connected or owned session: one tool session per contribution, and each
// tool name routed to the tool session that serves it.
interface SessionEntry {
  session: AgentSession;
  // Fixed at connect: the project folder's last segment, else `Codex session`
  // for a Codex session or `session`.
  group: string;
  // 1 for the first of its group, which reads without a number.
  number: number;
  toolSessions: ToolSession[];
  toolRoutes: Map<string, ToolSession>;
  // Started by `open`; `joinedBy` names the relay handle holding the join,
  // null while no relay is joined.
  owned: boolean;
  joinedBy: symbol | null;
}

const NO_FOLDER_LABEL = 'session';
const CODEX_NO_FOLDER_LABEL = 'Codex session';

function groupOf(info: SessionInfo): string {
  const noFolderLabel =
    info.harness === 'codex' ? CODEX_NO_FOLDER_LABEL : NO_FOLDER_LABEL;
  return info.projectDir === null
    ? noFolderLabel
    : path.basename(info.projectDir) || noFolderLabel;
}

// The lowest number no connected session of the group holds.
function freeNumber(entries: Iterable<SessionEntry>, group: string): number {
  const taken = new Set<number>();
  for (const entry of entries) {
    if (entry.group === group) {
      taken.add(entry.number);
    }
  }
  let number = 1;
  while (taken.has(number)) {
    number++;
  }
  return number;
}

function labelOf(entry: SessionEntry): string {
  return entry.number === 1 ? entry.group : `${entry.group} ${entry.number}`;
}

function rowOf(entry: SessionEntry): SessionRow {
  const { id, info } = entry.session;
  return {
    sessionId: id,
    label: labelOf(entry),
    harness: info.harness,
    marked: false,
    projectDir: info.projectDir,
    hostSessionId: info.sessionId,
  };
}

// A start that throws ends the tool sessions already started, then rethrows.
function startToolSessions(
  contributions: Contribution[],
  session: AgentSession,
): Pick<SessionEntry, 'toolSessions' | 'toolRoutes'> {
  const toolSessions: ToolSession[] = [];
  const toolRoutes = new Map<string, ToolSession>();
  try {
    for (const contribution of contributions) {
      const toolSession = contribution.start(session);
      toolSessions.push(toolSession);
      for (const tool of contribution.tools) {
        toolRoutes.set(tool.name, toolSession);
      }
    }
  } catch (error) {
    for (const started of toolSessions) {
      started.end();
    }
    throw error;
  }
  return { toolSessions, toolRoutes };
}

function routeCall(
  entry: SessionEntry,
  name: string,
  args: unknown,
  context: ToolCallContext,
): Promise<ToolResult> {
  const toolSession = entry.toolRoutes.get(name);
  if (toolSession === undefined) {
    return Promise.reject(
      new Error(`No plugin contributed the tool "${name}"`),
    );
  }
  return toolSession.call(name, args, context);
}

// Connected and owned sessions and the sidebar rows main holds for them. A
// connected session gets its row at connect, unselected; an owned session gets
// its row at open, selected unless opened with `select` false, is joined by
// each relay carrying its host id without a row of its own, a newer relay
// taking the join from an older one, and ends only by its `end()`. Each
// session keeps its label while it lasts; a closed row comes back at the end
// with the session's next mark. `mark`, `activate` and `closeSession` send the
// whole state only when it changed, and log and ignore a session they cannot
// act on; `closeSession` logs and keeps a row a close guard refuses, returning
// false for every row it leaves open, and emits `closed` for a row it closes.
// Every state sent with a selection other than the last sent emits `selected`
// after it.
export function createSessionList(deps: SessionListDeps): SessionList {
  const contributions: Contribution[] = [];
  const closeGuards: ((sessionId: string) => boolean)[] = [];
  const toolNames = new Set<string>();
  const entries = new Map<string, SessionEntry>();
  const rows: SessionRow[] = [];
  let selectedSessionId: string | null = null;

  const state = (): SessionsState => ({
    rows: rows.map((row) => ({ ...row })),
    selectedSessionId,
  });
  // The selected id the last `selected` carried; null before any.
  let sentSelectedSessionId: string | null = null;
  // Sends the state, then `selected` when the selection differs from the last sent.
  const sendState = () => {
    deps.stateChanged(state());
    if (selectedSessionId === sentSelectedSessionId) {
      return;
    }
    sentSelectedSessionId = selectedSessionId;
    deps.emit('selected', { sessionId: selectedSessionId });
  };
  const rowIndex = (sessionId: string) =>
    rows.findIndex((row) => row.sessionId === sessionId);

  const select = (row: SessionRow | undefined) => {
    selectedSessionId = row?.sessionId ?? null;
    if (row !== undefined) {
      row.marked = false;
    }
  };

  // The right neighbour takes over from a closed selected row, else the left.
  const removeRow = (index: number) => {
    const [removed] = rows.splice(index, 1);
    if (removed.sessionId === selectedSessionId) {
      select(rows[index] ?? rows[index - 1]);
    }
  };

  // The index of the session's row, or null after logging why it was ignored.
  const knownRow = (method: string, sessionId: string): number | null => {
    if (!entries.has(sessionId)) {
      deps.log(
        'sessions',
        `${method} for unknown session ${sessionId} ignored`,
      );
      return null;
    }
    const index = rowIndex(sessionId);
    if (index === -1) {
      deps.log(
        'sessions',
        `${method} for session ${sessionId} with no row ignored`,
      );
      return null;
    }
    return index;
  };

  const end = (entry: SessionEntry) => {
    if (!entries.delete(entry.session.id)) {
      return;
    }
    for (const toolSession of entry.toolSessions) {
      toolSession.end();
    }
    const index = rowIndex(entry.session.id);
    if (index !== -1) {
      removeRow(index);
      sendState();
    }
    deps.emit('ended', { sessionId: entry.session.id });
  };

  // Builds the session's entry and adds its row at the end; a throwing
  // contribution start leaves neither.
  const addEntry = (info: SessionInfo, owned: boolean): SessionEntry => {
    const session: AgentSession = { id: deps.randomHex(), info };
    const group = groupOf(info);
    const entry: SessionEntry = {
      session,
      group,
      number: freeNumber(entries.values(), group),
      ...startToolSessions(contributions, session),
      owned,
      joinedBy: null,
    };
    entries.set(session.id, entry);
    rows.push(rowOf(entry));
    return entry;
  };

  const entriesHolding = (hostId: string): SessionEntry[] =>
    [...entries.values()].filter(
      (entry) => entry.session.info.sessionId === hostId,
    );

  // The relay's handle on an owned session, taking the join from any older
  // relay still holding it: a harness restarting its MCP connection can say
  // hello on the new socket before the old one closes. The handle's `end`
  // only clears the join, and only while this handle still holds it.
  const join = (entry: SessionEntry): ConnectedSession => {
    const appId = entry.session.id;
    const handle = Symbol(appId);
    const isTakingOver = entry.joinedBy !== null;
    entry.joinedBy = handle;
    deps.log(
      'sessions',
      isTakingOver
        ? `newer relay took over session ${appId}`
        : `relay joined session ${appId}`,
    );
    return {
      session: entry.session,
      call: (name, args, context) => routeCall(entry, name, args, context),
      end: () => {
        if (entry.joinedBy !== handle || !entries.has(appId)) {
          return;
        }
        entry.joinedBy = null;
        deps.log('sessions', `relay left session ${appId}`);
      },
    };
  };

  return {
    contributeTools(tools, start) {
      const namesInThisContribution = new Set<string>();
      for (const tool of tools) {
        if (toolNames.has(tool.name)) {
          throw new Error(
            `Two tool contributions both name the tool "${tool.name}"`,
          );
        }
        if (namesInThisContribution.has(tool.name)) {
          throw new Error(
            `One tool contribution names the tool "${tool.name}" twice`,
          );
        }
        namesInThisContribution.add(tool.name);
      }
      for (const tool of tools) {
        toolNames.add(tool.name);
      }
      contributions.push({ tools, start });
    },
    connect(info): ConnectedSession {
      const hostId = info.sessionId;
      const ownedEntry =
        hostId === null
          ? undefined
          : entriesHolding(hostId).find((entry) => entry.owned);
      if (ownedEntry !== undefined) {
        return join(ownedEntry);
      }
      const entry = addEntry(info, false);
      sendState();
      deps.emit('connected', entry.session);
      return {
        session: entry.session,
        call: (name, args, context) => routeCall(entry, name, args, context),
        end: () => end(entry),
      };
    },
    open(info, options): OwnedSession {
      const hostId = info.sessionId;
      if (hostId === null) {
        throw new Error('open needs a host session id');
      }
      if (entriesHolding(hostId).length > 0) {
        throw new Error(`Host session ${hostId} is already open`);
      }
      const entry = addEntry(info, true);
      if (options?.select !== false) {
        select(rows.at(-1));
      }
      sendState();
      deps.emit('connected', entry.session);
      return { session: entry.session, end: () => end(entry) };
    },
    mark(sessionId) {
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log('sessions', `mark for unknown session ${sessionId} ignored`);
        return;
      }
      // A row the user closed comes back at the end, then is selected or
      // marked like any other.
      let index = rowIndex(sessionId);
      if (index === -1) {
        index = rows.push(rowOf(entry)) - 1;
      }
      const row = rows[index];
      if (sessionId === selectedSessionId) {
        return;
      }
      if (selectedSessionId === null) {
        select(row);
        sendState();
        return;
      }
      if (row.marked) {
        return;
      }
      row.marked = true;
      sendState();
    },
    activate(sessionId) {
      const index = knownRow('activate', sessionId);
      if (index === null) {
        return;
      }
      deps.activated(sessionId);
      const row = rows[index];
      if (sessionId === selectedSessionId && !row.marked) {
        return;
      }
      select(row);
      sendState();
    },
    addCloseGuard(mayClose) {
      closeGuards.push(mayClose);
    },
    closeSession(sessionId) {
      const index = knownRow('closeSession', sessionId);
      if (index === null) {
        return false;
      }
      if (!closeGuards.every((mayClose) => mayClose(sessionId))) {
        deps.log(
          'sessions',
          `closeSession for session ${sessionId} kept by a close guard`,
        );
        return false;
      }
      removeRow(index);
      sendState();
      deps.emit('closed', { sessionId });
      return true;
    },
    selectedSessionId: () => selectedSessionId,
    tools: () => contributions.flatMap((contribution) => contribution.tools),
    state,
  };
}
