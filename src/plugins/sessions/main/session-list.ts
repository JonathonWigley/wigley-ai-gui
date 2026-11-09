import path from 'node:path';
import type { Clock, RandomHex } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PluginEvents } from '../../../contracts/plugin';
import type { KeyedSlotWriter, SlotWriter } from '../../../contracts/state';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import { createListeners } from '../../../shared/listeners';
import {
  type AgentSession,
  type ConnectedSession,
  type OwnedSession,
  type SessionInfo,
  type SessionsMainEvents,
  type SessionsMainExports,
  type SessionRow,
  type SessionsState,
  type SessionTitles,
  type ToolCallContext,
  type ToolCallGuard,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
  textResult,
} from '../contract';
import { normalizedTitle, titleProblem } from '../session-title';

export interface SessionListDeps {
  randomHex: RandomHex;
  clock: Clock;
  log: PluginLog;
  emit: PluginEvents<SessionsMainEvents>['emit'];
  rows: KeyedSlotWriter<SessionRow>;
  selection: SlotWriter<string | null>;
  // The user activated a session; called before the writes it causes.
  activated(sessionId: string): void;
  // The project of a session in `projectDir`; null when the folder has none.
  projectName(projectDir: string): Promise<string | null>;
  // The name the session's harness shows for it; null when it has none.
  hostSessionName(info: SessionInfo): Promise<string | null>;
  // The session's config folder as its harness resolves it; null when the app
  // runs no such harness.
  configFolder(info: SessionInfo): string | null;
}

// The session list and its rows. `tools` lists every contributed tool in
// contribution order; `onToolsChanged` hears each contribution added and each
// one disposed, once each.
export interface SessionList extends Omit<
  SessionsMainExports,
  'holdConnects' | 'activate'
> {
  // `SessionsMainExports.activate`; true when it wrote the rows or the selection.
  activate(sessionId: string): boolean;
  tools(): ToolDefinition[];
  onToolsChanged(listener: () => void): Disposable;
  state(): SessionsState;
  // The user's close, which every close guard must allow; with `atOnce` it
  // first runs every guard's `cancelHold`. Returns the first guard's reason
  // for keeping the row, or null for a row it closes, a row already closed
  // (a cancel's `release` may have closed it) and an unknown session, emitting
  // `closed` only for a row it closes. The session stays connected.
  closeSession(sessionId: string, atOnce: boolean): string | null;
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
  // The plugin's stop: a project lookup landing after it changes nothing.
  stop(): void;
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
  // Starts as `group` and takes the folder's project name when its lookup
  // lands, kept while the row is closed.
  project: string;
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
  // Fixed at connect.
  profileDir: string | null;
  // The plugin the session's row belongs to, fixed at `open`; null for a
  // connected session and an `open` with no owner.
  owner: string | null;
}

// A mark this soon after `release` closed the session's selected row is a
// back-to-back round, not one arriving after the user moved on.
export const RESELECT_WINDOW_MS = 30_000;

const NO_FOLDER_LABEL = 'session';
const CODEX_NO_FOLDER_LABEL = 'Codex session';

function groupOf(info: SessionInfo): string {
  if (info.label !== undefined) {
    return info.label;
  }
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
    project: entry.project,
    harness: info.harness,
    marked: false,
    markToast: null,
    projectDir: info.projectDir,
    hostSessionId: info.sessionId,
    titles: { ...entry.titles },
    profileDir: entry.profileDir,
    owner: entry.owner,
  };
}

function endEach(toolSessions: readonly ToolSession[]): void {
  callEach(toolSessions, (toolSession) => toolSession.end());
}

// One tool session per item; a start that throws ends the tool sessions already
// started, each whatever another's `end` throws, then rethrows that start's
// error. A throw from those ends is logged, so it cannot hide the start's.
function startAllOrNone<Item>(
  items: Iterable<Item>,
  start: (item: Item) => ToolSession,
  log: PluginLog,
): Map<Item, ToolSession> {
  const started = new Map<Item, ToolSession>();
  try {
    for (const item of items) {
      started.set(item, start(item));
    }
  } catch (error) {
    try {
      endEach([...started.values()]);
    } catch (endError) {
      log(
        `ending tool sessions after a failed start failed: ${errorText(endError)}`,
      );
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
  log: PluginLog,
): Pick<SessionEntry, 'toolSessions' | 'toolRoutes'> {
  const toolSessions = startAllOrNone(
    contributions,
    (contribution) => contribution.start(session),
    log,
  );
  const toolRoutes = new Map<string, ToolSession>();
  for (const [contribution, toolSession] of toolSessions) {
    routeTools(toolRoutes, contribution, toolSession);
  }
  return { toolSessions, toolRoutes };
}

function unknownToolError(entry: SessionEntry, name: string): Error {
  const names = [...entry.toolRoutes.keys()];
  return new Error(
    `Unknown tool: ${name}. Valid tools are ${names.join(', ')}.`,
  );
}

// Connected and owned sessions and the sidebar rows main holds for them. A
// connected session has no row until `mark` or `activate` adds it at the end,
// and `release` closes that row again; an owned session gets its row at open,
// under the `rowId` it was opened with, else a new id, selected unless opened
// with `select` false or with an `owner`, is joined by each relay carrying
// its host id without a row of its own, a newer relay taking the join from an
// older one, moves to a new host id by its `setHostSessionId()`, which retires
// the old id and its relay, and ends only by its `end()`. Each session keeps
// its label while it lasts; a closed row comes back at the end with the
// session's next mark or activate. A row `release` closed while selected
// comes back selected when the session's next mark comes within
// RESELECT_WINDOW_MS of the release, unless the release came from a guard's
// `cancelHold` inside an at-once `closeSession`, or in between the user
// activated a row, a row was opened selected, a mark selected another session
// from none, or `release` closed another selected row. A mark that reaches a
// row not selected stores its options as the row's `markToast` unless the row
// is still marked, so a toast left on a row a mark selected never outlives the
// next mark; an activate clears it. `activateExistingRow` selects
// only a row the session holds and logs and ignores one with none. `mark`,
// `activate` and `activateExistingRow` log and ignore a session opened with an
// `owner`, and a closed selected row passes the selection to the nearest row
// with no owner, right then left, so main never selects a row with an owner.
// `mark`, `activate`, `activateExistingRow`, `release` and `closeSession` write
// only what changed; `mark`, `activate`, `activateExistingRow`
// and `closeSession` log and ignore an unknown session, `release` silently
// ignores a session it cannot act on. `release` and `closeSession` log and
// keep a row a close guard refuses, and emit `closed` for a row they close;
// `closeSession` returns the refusing guard's reason, else null. A guard's
// `cancelHold` that throws is logged, and its `mayClose` then decides. Each session's
// titles live on its entry, copied onto its row while it has one, and last
// while the session does; so does its project, which starts as the group and
// writes the row when its lookup changes the project of a session with a row,
// until `stop`. Each `mark` and `activate` of a connected session reads its
// harness's name for it into its `firstMessage` title, until `stop`.
// The rows and the selection live in the writers, whose slots outlive a stop, so
// creation clears them. One operation runs in one synchronous block: every row
// write, then the selection write, then its events, with `activated` before them
// all. A row value is never changed in place.
export function createSessionList(deps: SessionListDeps): SessionList {
  const contributions: Contribution[] = [];
  // Each registration its own object, so one function added twice is two.
  const closeGuards = new Set<{
    mayClose(sessionId: string): string | null;
    cancelHold?(sessionId: string): void;
  }>();
  // Each contributed tool name, mapped to its main-agent-only mark.
  const mainAgentOnlyByTool = new Map<string, boolean>();
  // Each registration its own object, so one function added twice is two.
  const toolCallGuards = new Set<{ guard: ToolCallGuard }>();
  const toolsChanged = createListeners<void>();
  const entries = new Map<string, SessionEntry>();
  const { rows, selection } = deps;
  // The session whose selected row `release` closed, and when: its next mark
  // selects the row again within RESELECT_WINDOW_MS. Null after that mark, an
  // activate or activateExistingRow, a selecting open, the session's end, or a
  // mark that selects another session from none; a release of another
  // selected row replaces it.
  let reselectOnReturn: { sessionId: string; releasedAt: number } | null = null;
  let isStopped = false;

  const selectedSessionId = () => selection.get() ?? null;

  const state = (): SessionsState => ({
    rows: [...rows.all().values()].map((row) => ({
      ...row,
      titles: { ...row.titles },
    })),
    selectedSessionId: selectedSessionId(),
  });

  const writeSelection = (sessionId: string | null) => {
    if (selection.get() !== sessionId) {
      selection.set(sessionId);
    }
  };

  // A slot holding rows from an earlier stop would read on the page as live, and
  // its selection as a write still on its way.
  for (const sessionId of rows.all().keys()) {
    rows.delete(sessionId);
  }
  writeSelection(null);

  // Writes `row` unmarked unless it is already held so, then selects it.
  const selectRow = (row: SessionRow) => {
    if (row.marked || rows.get(row.sessionId) !== row) {
      rows.set(row.sessionId, { ...row, marked: false });
    }
    writeSelection(row.sessionId);
  };

  // The nearest row with no owner to the right takes over from a closed
  // selected row, else the nearest to the left.
  const removeRow = (sessionId: string) => {
    const held = [...rows.all().values()];
    const position = held.findIndex((row) => row.sessionId === sessionId);
    rows.delete(sessionId);
    if (sessionId !== selectedSessionId()) {
      return;
    }
    const hasNoOwner = (row: SessionRow) => row.owner === null;
    const neighbour =
      held.slice(position + 1).find(hasNoOwner) ??
      held.slice(0, position).findLast(hasNoOwner);
    if (neighbour === undefined) {
      writeSelection(null);
    } else {
      selectRow(neighbour);
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
          if (rows.get(entry.session.id) !== undefined) {
            removeRow(entry.session.id);
          }
        },
        () => deps.emit('ended', { sessionId: entry.session.id }),
      ],
      (step) => step(),
    );
  };

  // The first guard's reason for keeping the row, null when every one allows.
  const firstRefusal = (sessionId: string): string | null => {
    for (const guard of closeGuards) {
      const reason = guard.mayClose(sessionId);
      if (reason !== null) {
        return reason;
      }
    }
    return null;
  };

  // The user's pick of the entry's row, adding it at the end when it has none:
  // reports `activated`, then selects it and clears its mark and mark toast.
  // True when that wrote anything.
  const activateRow = (entry: SessionEntry) => {
    const sessionId = entry.session.id;
    deps.activated(sessionId);
    reselectOnReturn = null;
    const row = rows.get(sessionId) ?? rowOf(entry);
    const isAnswered = !row.marked && row.markToast === null;
    if (sessionId === selectedSessionId() && isAnswered) {
      return false;
    }
    selectRow(row.markToast === null ? row : { ...row, markToast: null });
    return true;
  };

  // Runs every guard's `cancelHold`, a throw not skipping the rest; each throw
  // is logged, and that guard's `mayClose` then decides.
  const cancelHolds = (sessionId: string) => {
    for (const guard of closeGuards) {
      try {
        guard.cancelHold?.(sessionId);
      } catch (error) {
        deps.log(
          `cancelling what holds session ${sessionId} failed: ${errorText(error)}`,
        );
      }
    }
  };

  // Removes the row, then emits `closed`.
  const closeRow = (sessionId: string) => {
    removeRow(sessionId);
    deps.emit('closed', { sessionId });
  };

  // Asks for the project of the entry's folder; a null, a rejection or a landing
  // after `stop` keeps the fallback.
  const lookUpProject = (entry: SessionEntry, projectDir: string) => {
    const appId = entry.session.id;
    deps.projectName(projectDir).then(
      (name) => {
        if (isStopped) {
          return;
        }
        const isNewProject = name !== null && name !== entry.project;
        if (!isNewProject) {
          return;
        }
        entry.project = name;
        const row = rows.get(appId);
        if (row !== undefined) {
          rows.set(appId, { ...row, project: name });
        }
      },
      (error: unknown) =>
        deps.log(`project of ${projectDir} not read: ${errorText(error)}`),
    );
  };

  // Builds and holds the session's entry under `id`, else a new id, and starts
  // its project lookup, adding no row; a throwing contribution start leaves no
  // entry.
  const addEntry = (
    info: SessionInfo,
    owned: boolean,
    owner: string | null,
    id: string = deps.randomHex(),
  ): SessionEntry => {
    const session: AgentSession = { id, info };
    const group = groupOf(info);
    const entry: SessionEntry = {
      session,
      group,
      number: freeNumber(entries.values(), group),
      project: group,
      ...startToolSessions(contributions, session, deps.log),
      owned,
      joinedBy: null,
      retiredHostIds: new Set(),
      titles: { user: null, agent: null, firstMessage: null },
      profileDir: deps.configFolder(info),
      owner,
    };
    entries.set(session.id, entry);
    if (info.projectDir !== null) {
      lookUpProject(entry, info.projectDir);
    }
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
      mainAgentOnlyByTool.delete(tool.name);
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

  // Asks each guard registered when the call came, in order, then calls the
  // tool's handler; `SessionsMainExports.addToolCallGuard` states the rules.
  // `callerRefusal` returns the error refusing the caller, or null; it is asked
  // before the guards and again after a guard wait. The ended, refusal and
  // abort checks follow only a guard wait: with no guard the handler is called
  // in the same tick.
  const routeCall = async (
    entry: SessionEntry,
    name: string,
    args: unknown,
    context: ToolCallContext,
    callerRefusal: () => Error | null = () => null,
  ): Promise<ToolResult> => {
    const refusalBeforeGuards = callerRefusal();
    if (refusalBeforeGuards !== null) {
      throw refusalBeforeGuards;
    }
    if (!entry.toolRoutes.has(name)) {
      throw unknownToolError(entry, name);
    }
    const call = {
      sessionId: entry.session.id,
      tool: name,
      toolUseId: context.toolUseId,
      mainAgentOnly: mainAgentOnlyByTool.get(name) ?? false,
    };
    const registrations = [...toolCallGuards];
    for (const registration of registrations) {
      if (!toolCallGuards.has(registration)) {
        continue;
      }
      const verdict = await registration.guard(call);
      if (verdict.kind === 'skip') {
        return textResult(verdict.text);
      }
    }
    if (registrations.length > 0) {
      if (!entries.has(entry.session.id)) {
        throw new Error('Session ended');
      }
      const refusalAfterGuards = callerRefusal();
      if (refusalAfterGuards !== null) {
        throw refusalAfterGuards;
      }
      context.signal.throwIfAborted();
    }
    const toolSession = entry.toolRoutes.get(name);
    if (toolSession === undefined) {
      throw unknownToolError(entry, name);
    }
    return toolSession.call(name, args, context);
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
    const row = rows.get(appId);
    if (row !== undefined) {
      rows.set(appId, { ...row, hostSessionId: newHostId });
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
    const row = rows.get(sessionId);
    if (row !== undefined) {
      rows.set(sessionId, { ...row, titles: { ...entry.titles } });
    }
    deps.emit('titleChanged', { sessionId, titles: { ...entry.titles } });
  };

  // Titles a connected session with the name its harness shows for it; a null,
  // a rejection, or a landing after the session's end or `stop` changes nothing.
  // An owned session's titles are its owner's.
  const lookUpHostName = (entry: SessionEntry) => {
    if (entry.owned) {
      return;
    }
    const appId = entry.session.id;
    deps.hostSessionName(entry.session.info).then(
      (name) => {
        if (name !== null && !isStopped && entries.has(appId)) {
          setTitle(appId, 'firstMessage', name);
        }
      },
      (error: unknown) =>
        deps.log(`name of session ${appId} not read: ${errorText(error)}`),
    );
  };

  // The relay's handle on an owned session, taking the join from any older
  // relay still holding it: a harness restarting its MCP connection can say
  // hello on the new socket before the old one closes. The handle's `end`
  // only clears the join, and only while this handle still holds it; its
  // calls are refused once the session moves off the host id it joined under,
  // a move during a call's guard wait included.
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
      call: (name, args, context) =>
        routeCall(entry, name, args, context, () => {
          const hostId = entry.session.info.sessionId;
          if (hostId === joinedHostId) {
            return null;
          }
          deps.log(
            `call ${name} from relay of retired host ${String(joinedHostId)} on session ${appId} refused`,
          );
          return new Error(
            `Session ${appId} moved from host ${String(joinedHostId)} to ${String(hostId)}`,
          );
        }),
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
    contributeTools(tools, start, options) {
      const namesInThisContribution = new Set<string>();
      for (const tool of tools) {
        if (mainAgentOnlyByTool.has(tool.name)) {
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
      const started = startAllOrNone(
        entries.values(),
        (entry) => contribution.start(entry.session),
        deps.log,
      );
      for (const tool of tools) {
        mainAgentOnlyByTool.set(tool.name, options?.mainAgentOnly === true);
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
      const entry = addEntry(info, false, null);
      deps.emit('connected', { ...entry.session, owned: false });
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
      const rowId = options?.rowId;
      if (rowId !== undefined && entries.has(rowId)) {
        throw new Error(`Session ${rowId} is already open`);
      }
      const entry = addEntry(info, true, options?.owner ?? null, rowId);
      rows.set(entry.session.id, rowOf(entry));
      if (options?.select !== false && entry.owner === null) {
        writeSelection(entry.session.id);
        reselectOnReturn = null;
      }
      deps.emit('connected', { ...entry.session, owned: true });
      return {
        session: entry.session,
        end: () => end(entry),
        setHostSessionId: (newHostId) => setHostSessionId(entry, newHostId),
      };
    },
    mark(sessionId, options) {
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log(`mark for unknown session ${sessionId} ignored`);
        return;
      }
      if (entry.owner !== null) {
        deps.log(`mark for session ${sessionId} with an owner ignored`);
        return;
      }
      lookUpHostName(entry);
      const releasedSelected =
        reselectOnReturn?.sessionId === sessionId ? reselectOnReturn : null;
      const isReturningToSelection =
        releasedSelected !== null &&
        deps.clock.now() - releasedSelected.releasedAt <= RESELECT_WINDOW_MS;
      if (releasedSelected !== null) {
        reselectOnReturn = null;
      }
      if (sessionId === selectedSessionId()) {
        return;
      }
      // A connected session with no row, or a row the user closed, gets its
      // row at the end, then is selected or marked like any other.
      const held = rows.get(sessionId) ?? rowOf(entry);
      const row = held.marked ? held : { ...held, markToast: options };
      if (selectedSessionId() === null || isReturningToSelection) {
        reselectOnReturn = null;
        selectRow(row);
        return;
      }
      if (!row.marked || row !== held) {
        rows.set(sessionId, { ...row, marked: true });
      }
    },
    activate(sessionId) {
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log(`activate for unknown session ${sessionId} ignored`);
        return false;
      }
      if (entry.owner !== null) {
        deps.log(`activate for session ${sessionId} with an owner ignored`);
        return false;
      }
      lookUpHostName(entry);
      return activateRow(entry);
    },
    activateExistingRow(sessionId) {
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log(
          `activateExistingRow for unknown session ${sessionId} ignored`,
        );
        return;
      }
      if (entry.owner !== null) {
        deps.log(
          `activateExistingRow for session ${sessionId} with an owner ignored`,
        );
        return;
      }
      if (rows.get(sessionId) === undefined) {
        deps.log(
          `activateExistingRow for session ${sessionId} with no row ignored`,
        );
        return;
      }
      activateRow(entry);
    },
    release(sessionId) {
      const entry = entries.get(sessionId);
      const isReleasable =
        entry !== undefined &&
        !entry.owned &&
        rows.get(sessionId) !== undefined;
      if (!isReleasable) {
        return;
      }
      if (firstRefusal(sessionId) !== null) {
        deps.log(`release for session ${sessionId} kept by a close guard`);
        return;
      }
      if (sessionId === selectedSessionId()) {
        reselectOnReturn = { sessionId, releasedAt: deps.clock.now() };
      }
      closeRow(sessionId);
    },
    addCloseGuard(mayClose, cancelHold) {
      const guard = { mayClose, cancelHold };
      closeGuards.add(guard);
      return {
        dispose: () => {
          closeGuards.delete(guard);
        },
      };
    },
    addToolCallGuard(guard) {
      const registration = { guard };
      toolCallGuards.add(registration);
      return {
        dispose: () => {
          toolCallGuards.delete(registration);
        },
      };
    },
    closeSession(sessionId, atOnce) {
      if (!entries.has(sessionId)) {
        deps.log(`closeSession for unknown session ${sessionId} ignored`);
        return null;
      }
      if (rows.get(sessionId) === undefined) {
        return null;
      }
      if (atOnce) {
        cancelHolds(sessionId);
        // A hold's cancel may `release` the row, which is the user's close here.
        if (reselectOnReturn?.sessionId === sessionId) {
          reselectOnReturn = null;
        }
      }
      if (rows.get(sessionId) === undefined) {
        return null;
      }
      const refusal = firstRefusal(sessionId);
      if (refusal !== null) {
        deps.log(`closeSession for session ${sessionId} kept by a close guard`);
        return refusal;
      }
      closeRow(sessionId);
      return null;
    },
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
    stop() {
      isStopped = true;
    },
  };
}
