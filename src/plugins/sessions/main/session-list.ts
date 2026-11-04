import path from 'node:path';
import type { Clock, RandomHex } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PluginEvents } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { createListeners } from '../../../shared/listeners';
import type {
  AgentSession,
  ConnectedSession,
  OwnedSession,
  SessionInfo,
  SessionsMainEvents,
  SessionsMainExports,
  SessionRow,
  SessionsState,
  SessionTitles,
  ToolCallContext,
  ToolDefinition,
  ToolResult,
  ToolSession,
} from '../contract';
import { normalizedTitle, titleProblem } from '../session-title';

export interface SessionListDeps {
  randomHex: RandomHex;
  clock: Clock;
  log: PluginLog;
  emit: PluginEvents<SessionsMainEvents>['emit'];
  stateChanged(state: SessionsState): void;
  // The user activated a session; called before the state it changes is sent.
  activated(sessionId: string): void;
}

// The session list and its rows. `tools` lists every contributed tool in
// contribution order; `onToolsChanged` hears each contribution added and each
// one disposed, once each.
export interface SessionList extends SessionsMainExports {
  tools(): ToolDefinition[];
  onToolsChanged(listener: () => void): Disposable;
  state(): SessionsState;
  // The user's close, which every close guard must allow; returns whether the
  // row is closed, true for a row already closed, emitting `closed` only for a
  // row it closes. The session stays connected.
  closeSession(sessionId: string): boolean;
  // The user's rename at `maxLength`: a title that normalizes to empty, or
  // null, clears the user title; one with a `titleProblem` throws its text.
  setUserTitle(
    sessionId: string,
    title: string | null,
    maxLength: number,
  ): void;
  // Ends every session the list holds, connected and owned, each as its own
  // `end()` does, a throw not skipping the rest, then throws the first error.
  endAll(): void;
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
  toolSessions: Map<Contribution, ToolSession>;
  toolRoutes: Map<string, ToolSession>;
  // Started by `open`; `joinedBy` names the relay handle holding the join,
  // null while no relay is joined.
  owned: boolean;
  joinedBy: symbol | null;
  // Host ids an owned session moved away from; a relay saying hello with one
  // is refused.
  retiredHostIds: Set<string>;
  // The source of the row's titles, kept while the row is closed.
  titles: SessionTitles;
}

// A mark this soon after `release` closed the session's selected row is a
// back-to-back round, not one arriving after the user moved on.
export const RESELECT_WINDOW_MS = 30_000;

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
    titles: { ...entry.titles },
  };
}

function endEach(toolSessions: readonly ToolSession[]): void {
  callEach(toolSessions, (toolSession) => toolSession.end());
}

// One tool session per item; a start that throws ends the tool sessions already
// started, each whatever another's `end` throws, then rethrows that start's
// error.
function startAllOrNone<Item>(
  items: Iterable<Item>,
  start: (item: Item) => ToolSession,
): Map<Item, ToolSession> {
  const started = new Map<Item, ToolSession>();
  try {
    for (const item of items) {
      started.set(item, start(item));
    }
  } catch (error) {
    try {
      endEach([...started.values()]);
    } catch {
      // The start's error is the one thrown.
    }
    throw error;
  }
  return started;
}

function routeTools(
  toolRoutes: Map<string, ToolSession>,
  contribution: Contribution,
  toolSession: ToolSession,
) {
  for (const tool of contribution.tools) {
    toolRoutes.set(tool.name, toolSession);
  }
}

function startToolSessions(
  contributions: Contribution[],
  session: AgentSession,
): Pick<SessionEntry, 'toolSessions' | 'toolRoutes'> {
  const toolSessions = startAllOrNone(contributions, (contribution) =>
    contribution.start(session),
  );
  const toolRoutes = new Map<string, ToolSession>();
  for (const [contribution, toolSession] of toolSessions) {
    routeTools(toolRoutes, contribution, toolSession);
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
    const names = [...entry.toolRoutes.keys()];
    return Promise.reject(
      new Error(`Unknown tool: ${name}. Valid tools are ${names.join(', ')}.`),
    );
  }
  return toolSession.call(name, args, context);
}

// Connected and owned sessions and the sidebar rows main holds for them. A
// connected session has no row until `mark` or `activate` adds it at the end,
// and `release` closes that row again; an owned session gets its row at open,
// selected unless opened with `select` false, is joined by each relay carrying
// its host id without a row of its own, a newer relay taking the join from an
// older one, moves to a new host id by its `setHostSessionId()`, which retires
// the old id and its relay, and ends only by its `end()`. Each session keeps
// its label while it lasts; a closed row comes back at the end with the
// session's next mark or activate. A row `release` closed while selected
// comes back selected when the session's next mark comes within
// RESELECT_WINDOW_MS of the release, unless in between the user activated a
// row, a row was opened selected, a mark selected another session from none,
// or `release` closed another selected row. `activateExistingRow` selects
// only a row the session holds and logs and ignores one with none. `mark`,
// `activate`, `activateExistingRow`, `release` and `closeSession` send the
// whole state only when it changed; `mark`, `activate`, `activateExistingRow`
// and `closeSession` log and ignore an unknown session, `release` silently
// ignores a session it cannot act on. `release` and `closeSession` log and
// keep a row a close guard refuses, and emit `closed` for a row they close;
// `closeSession` returns true for a row it closes and for a known session
// whose row is already closed, false otherwise. Every state sent with a
// selection other than the last sent emits `selected` after it. Each session's
// titles live on its entry, copied onto its row while it has one, and last
// while the session does.
export function createSessionList(deps: SessionListDeps): SessionList {
  const contributions: Contribution[] = [];
  // Each registration its own object, so one function added twice is two.
  const closeGuards = new Set<{ mayClose(sessionId: string): boolean }>();
  const toolNames = new Set<string>();
  const toolsChanged = createListeners<void>();
  const entries = new Map<string, SessionEntry>();
  const rows: SessionRow[] = [];
  let selectedSessionId: string | null = null;
  // The session whose selected row `release` closed, and when: its next mark
  // selects the row again within RESELECT_WINDOW_MS. Null after that mark, an
  // activate or activateExistingRow, a selecting open, the session's end, or a
  // mark that selects another session from none; a release of another
  // selected row replaces it.
  let reselectOnReturn: { sessionId: string; releasedAt: number } | null = null;

  const state = (): SessionsState => ({
    rows: rows.map((row) => ({ ...row, titles: { ...row.titles } })),
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

  // Every step runs whatever an earlier one throws; the first error is rethrown
  // after them.
  const end = (entry: SessionEntry) => {
    if (!entries.delete(entry.session.id)) {
      return;
    }
    if (reselectOnReturn?.sessionId === entry.session.id) {
      reselectOnReturn = null;
    }
    callEach<() => void>(
      [
        () => endEach([...entry.toolSessions.values()]),
        () => {
          const index = rowIndex(entry.session.id);
          if (index !== -1) {
            removeRow(index);
            sendState();
          }
        },
        () => deps.emit('ended', { sessionId: entry.session.id }),
      ],
      (step) => step(),
    );
  };

  // The index of the session's row, adding it at the end when it has none.
  const rowIndexAdding = (entry: SessionEntry): number => {
    const index = rowIndex(entry.session.id);
    return index === -1 ? rows.push(rowOf(entry)) - 1 : index;
  };

  const everyGuardAllows = (sessionId: string) =>
    [...closeGuards].every((guard) => guard.mayClose(sessionId));

  // The user's pick of the row at `index`: reports `activated`, then selects
  // it and clears its mark.
  const activateRow = (sessionId: string, index: number) => {
    deps.activated(sessionId);
    reselectOnReturn = null;
    const row = rows[index];
    if (sessionId === selectedSessionId && !row.marked) {
      return;
    }
    select(row);
    sendState();
  };

  // Removes the row, sends the state, then emits `closed`.
  const closeRow = (index: number, sessionId: string) => {
    removeRow(index);
    sendState();
    deps.emit('closed', { sessionId });
  };

  // Builds and holds the session's entry, adding no row; a throwing
  // contribution start leaves no entry.
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
      retiredHostIds: new Set(),
      titles: { user: null, agent: null, firstMessage: null },
    };
    entries.set(session.id, entry);
    return entry;
  };

  const entriesHolding = (hostId: string): SessionEntry[] =>
    [...entries.values()].filter(
      (entry) => entry.session.info.sessionId === hostId,
    );

  // Ends the contribution's tool session in every live entry, each whatever
  // another's `end` throws, and frees its tool names.
  const withdrawContribution = (contribution: Contribution) => {
    contributions.splice(contributions.indexOf(contribution), 1);
    for (const tool of contribution.tools) {
      toolNames.delete(tool.name);
    }
    callEach([...entries.values()], (entry) => {
      const toolSession = entry.toolSessions.get(contribution);
      entry.toolSessions.delete(contribution);
      for (const tool of contribution.tools) {
        entry.toolRoutes.delete(tool.name);
      }
      toolSession?.end();
    });
  };

  // Changes `sessionId` inside the session's one info object, so every holder
  // of it sees the new id. The relay joined under the old id loses its join.
  const setHostSessionId = (entry: SessionEntry, newHostId: string) => {
    const appId = entry.session.id;
    if (!entries.has(appId)) {
      return;
    }
    const oldHostId = entry.session.info.sessionId;
    const isHeldElsewhere = entriesHolding(newHostId).some(
      (holder) => holder !== entry,
    );
    if (isHeldElsewhere) {
      throw new Error(
        `Host session ${newHostId} is already open; owned session ${appId} keeps host ${String(oldHostId)}`,
      );
    }
    entry.session.info.sessionId = newHostId;
    entry.retiredHostIds.delete(newHostId);
    if (oldHostId !== null && oldHostId !== newHostId) {
      entry.retiredHostIds.add(oldHostId);
      entry.joinedBy = null;
    }
    const index = rowIndex(appId);
    if (index !== -1) {
      rows[index].hostSessionId = newHostId;
      sendState();
    }
    deps.log(`owned session ${appId} now host ${newHostId}`);
    deps.emit('hostSessionChanged', entry.session);
  };

  const setTitle: SessionsMainExports['setTitle'] = (
    sessionId,
    source,
    title,
  ) => {
    const entry = entries.get(sessionId);
    if (entry === undefined) {
      deps.log(`setTitle for unknown session ${sessionId} ignored`);
      return;
    }
    const value = title === null ? null : normalizedTitle(title) || null;
    if (entry.titles[source] === value) {
      return;
    }
    entry.titles[source] = value;
    const index = rowIndex(sessionId);
    if (index !== -1) {
      rows[index].titles = { ...entry.titles };
      sendState();
    }
    deps.emit('titleChanged', { sessionId, titles: { ...entry.titles } });
  };

  // The relay's handle on an owned session, taking the join from any older
  // relay still holding it: a harness restarting its MCP connection can say
  // hello on the new socket before the old one closes. The handle's `end`
  // only clears the join, and only while this handle still holds it; its
  // calls are refused once the session moves off the host id it joined under.
  const join = (entry: SessionEntry): ConnectedSession => {
    const appId = entry.session.id;
    const joinedHostId = entry.session.info.sessionId;
    const handle = Symbol(appId);
    const isTakingOver = entry.joinedBy !== null;
    entry.joinedBy = handle;
    deps.log(
      isTakingOver
        ? `newer relay took over session ${appId}`
        : `relay joined session ${appId}`,
    );
    return {
      session: entry.session,
      call: (name, args, context) => {
        const hostId = entry.session.info.sessionId;
        if (hostId !== joinedHostId) {
          deps.log(
            `call ${name} from relay of retired host ${String(joinedHostId)} on session ${appId} refused`,
          );
          return Promise.reject(
            new Error(
              `Session ${appId} moved from host ${String(joinedHostId)} to ${String(hostId)}`,
            ),
          );
        }
        return routeCall(entry, name, args, context);
      },
      end: () => {
        if (entry.joinedBy !== handle || !entries.has(appId)) {
          return;
        }
        entry.joinedBy = null;
        deps.log(`relay left session ${appId}`);
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
      const contribution: Contribution = { tools, start };
      const started = startAllOrNone(entries.values(), (entry) =>
        contribution.start(entry.session),
      );
      for (const tool of tools) {
        toolNames.add(tool.name);
      }
      contributions.push(contribution);
      for (const [entry, toolSession] of started) {
        entry.toolSessions.set(contribution, toolSession);
        routeTools(entry.toolRoutes, contribution, toolSession);
      }
      toolsChanged.tell();
      let isDisposed = false;
      return {
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          callEach<() => void>(
            [
              () => withdrawContribution(contribution),
              () => toolsChanged.tell(),
            ],
            (step) => step(),
          );
        },
      };
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
      const retiringEntry =
        hostId === null
          ? undefined
          : [...entries.values()].find((entry) =>
              entry.retiredHostIds.has(hostId),
            );
      if (retiringEntry !== undefined) {
        const appId = retiringEntry.session.id;
        deps.log(
          `connect for retired host ${hostId} of session ${appId} refused`,
        );
        throw new Error(
          `Host session ${hostId} was retired by session ${appId}`,
        );
      }
      const entry = addEntry(info, false);
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
      rows.push(rowOf(entry));
      if (options?.select !== false) {
        select(rows.at(-1));
        reselectOnReturn = null;
      }
      sendState();
      deps.emit('connected', entry.session);
      return {
        session: entry.session,
        end: () => end(entry),
        setHostSessionId: (newHostId) => setHostSessionId(entry, newHostId),
      };
    },
    mark(sessionId) {
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log(`mark for unknown session ${sessionId} ignored`);
        return;
      }
      // A connected session with no row, or a row the user closed, gets its
      // row at the end, then is selected or marked like any other.
      const row = rows[rowIndexAdding(entry)];
      const releasedSelected =
        reselectOnReturn?.sessionId === sessionId ? reselectOnReturn : null;
      const isReturningToSelection =
        releasedSelected !== null &&
        deps.clock.now() - releasedSelected.releasedAt <= RESELECT_WINDOW_MS;
      if (releasedSelected !== null) {
        reselectOnReturn = null;
      }
      if (sessionId === selectedSessionId) {
        return;
      }
      if (selectedSessionId === null || isReturningToSelection) {
        reselectOnReturn = null;
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
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log(`activate for unknown session ${sessionId} ignored`);
        return;
      }
      // A connected session with no row, or a row the user closed, gets its
      // row at the end, then is selected like any other.
      activateRow(sessionId, rowIndexAdding(entry));
    },
    activateExistingRow(sessionId) {
      if (!entries.has(sessionId)) {
        deps.log(
          `activateExistingRow for unknown session ${sessionId} ignored`,
        );
        return;
      }
      const index = rowIndex(sessionId);
      if (index === -1) {
        deps.log(
          `activateExistingRow for session ${sessionId} with no row ignored`,
        );
        return;
      }
      activateRow(sessionId, index);
    },
    release(sessionId) {
      const entry = entries.get(sessionId);
      const index = rowIndex(sessionId);
      const isReleasable = entry !== undefined && !entry.owned && index !== -1;
      if (!isReleasable) {
        return;
      }
      if (!everyGuardAllows(sessionId)) {
        deps.log(`release for session ${sessionId} kept by a close guard`);
        return;
      }
      if (sessionId === selectedSessionId) {
        reselectOnReturn = { sessionId, releasedAt: deps.clock.now() };
      }
      closeRow(index, sessionId);
    },
    addCloseGuard(mayClose) {
      const guard = { mayClose };
      closeGuards.add(guard);
      return {
        dispose: () => {
          closeGuards.delete(guard);
        },
      };
    },
    closeSession(sessionId) {
      if (!entries.has(sessionId)) {
        deps.log(`closeSession for unknown session ${sessionId} ignored`);
        return false;
      }
      const index = rowIndex(sessionId);
      if (index === -1) {
        return true;
      }
      if (!everyGuardAllows(sessionId)) {
        deps.log(`closeSession for session ${sessionId} kept by a close guard`);
        return false;
      }
      closeRow(index, sessionId);
      return true;
    },
    selectedSessionId: () => selectedSessionId,
    label(sessionId) {
      const entry = entries.get(sessionId);
      return entry === undefined ? null : labelOf(entry);
    },
    setTitle,
    titles(sessionId) {
      const entry = entries.get(sessionId);
      return entry === undefined ? null : { ...entry.titles };
    },
    setUserTitle(sessionId, title, maxLength) {
      const isClearing = title === null || normalizedTitle(title) === '';
      const problem = isClearing ? null : titleProblem(title, maxLength);
      if (problem !== null) {
        throw new Error(problem);
      }
      setTitle(sessionId, 'user', title);
    },
    tools: () => contributions.flatMap((contribution) => contribution.tools),
    onToolsChanged: (listener) => toolsChanged.add(listener),
    state,
    endAll() {
      callEach([...entries.values()], end);
    },
  };
}
