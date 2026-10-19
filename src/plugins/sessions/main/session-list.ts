import path from 'node:path';
import type { RandomHex } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { PluginEvents } from '../../../contracts/plugin';
import type {
  AgentSession,
  ConnectedSession,
  SessionInfo,
  SessionsMainEvents,
  SessionsMainExports,
  SessionsState,
  SessionTab,
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
}

// The session list and its tabs. `tools` lists every contributed tool in contribution order.
export interface SessionList extends SessionsMainExports {
  tools(): ToolDefinition[];
  state(): SessionsState;
  // The user's close, which every close guard must allow; returns whether the
  // tab closed.
  closeTab(sessionId: string): boolean;
}

interface Contribution {
  tools: ToolDefinition[];
  start(session: AgentSession): ToolSession;
}

// One connected session: one tool session per contribution, and each tool
// name routed to the tool session that serves it.
interface SessionEntry {
  session: AgentSession;
  // Fixed at connect: the project folder's last segment, or `session`.
  group: string;
  // 1 for the first of its group, which reads without a number.
  number: number;
  toolSessions: ToolSession[];
  toolRoutes: Map<string, ToolSession>;
}

const NO_FOLDER_LABEL = 'session';

function groupOf(info: SessionInfo): string {
  return info.projectDir === null
    ? NO_FOLDER_LABEL
    : path.basename(info.projectDir) || NO_FOLDER_LABEL;
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

// Connected sessions and the tab strip main holds for them. A session keeps its
// label while connected; a closed tab comes back at the end when shown again.
// `showTab`, `activate` and `closeTab` send the whole state only when it
// changed, and log and ignore a session they cannot act on; `closeTab` logs
// and keeps a tab a close guard refuses, returning false for every tab it
// leaves open.
export function createSessionList(deps: SessionListDeps): SessionList {
  const contributions: Contribution[] = [];
  const closeGuards: ((sessionId: string) => boolean)[] = [];
  const toolNames = new Set<string>();
  const entries = new Map<string, SessionEntry>();
  const tabs: SessionTab[] = [];
  let activeSessionId: string | null = null;

  const state = (): SessionsState => ({
    tabs: tabs.map((tab) => ({ ...tab })),
    activeSessionId,
  });
  const sendState = () => deps.stateChanged(state());
  const tabIndex = (sessionId: string) =>
    tabs.findIndex((tab) => tab.sessionId === sessionId);

  const makeActive = (tab: SessionTab | undefined) => {
    activeSessionId = tab?.sessionId ?? null;
    if (tab !== undefined) {
      tab.marked = false;
    }
  };

  // The right neighbour takes over from a closed active tab, else the left.
  const removeTab = (index: number) => {
    const [removed] = tabs.splice(index, 1);
    if (removed.sessionId === activeSessionId) {
      makeActive(tabs[index] ?? tabs[index - 1]);
    }
  };

  // The index of the session's tab, or null after logging why it was ignored.
  const knownTab = (method: string, sessionId: string): number | null => {
    if (!entries.has(sessionId)) {
      deps.log(
        'sessions',
        `${method} for unknown session ${sessionId} ignored`,
      );
      return null;
    }
    const index = tabIndex(sessionId);
    if (index === -1) {
      deps.log(
        'sessions',
        `${method} for session ${sessionId} with no tab ignored`,
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
    const index = tabIndex(entry.session.id);
    if (index !== -1) {
      removeTab(index);
      sendState();
    }
    deps.emit('ended', { sessionId: entry.session.id });
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
      const session: AgentSession = { id: deps.randomHex(), info };
      const group = groupOf(info);
      const entry: SessionEntry = {
        session,
        group,
        number: freeNumber(entries.values(), group),
        ...startToolSessions(contributions, session),
      };
      entries.set(session.id, entry);
      deps.emit('connected', session);
      return {
        session,
        call: (name, args, context) => routeCall(entry, name, args, context),
        end: () => end(entry),
      };
    },
    showTab(sessionId) {
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        deps.log(
          'sessions',
          `showTab for unknown session ${sessionId} ignored`,
        );
        return;
      }
      const index = tabIndex(sessionId);
      if (index === -1) {
        tabs.push({
          sessionId,
          label: labelOf(entry),
          marked: activeSessionId !== null,
        });
        activeSessionId ??= sessionId;
        sendState();
        return;
      }
      const tab = tabs[index];
      if (sessionId === activeSessionId || tab.marked) {
        return;
      }
      tab.marked = true;
      sendState();
    },
    activate(sessionId) {
      const index = knownTab('activate', sessionId);
      if (index === null) {
        return;
      }
      const tab = tabs[index];
      if (sessionId === activeSessionId && !tab.marked) {
        return;
      }
      makeActive(tab);
      sendState();
    },
    addCloseGuard(mayClose) {
      closeGuards.push(mayClose);
    },
    closeTab(sessionId) {
      const index = knownTab('closeTab', sessionId);
      if (index === null) {
        return false;
      }
      if (!closeGuards.every((mayClose) => mayClose(sessionId))) {
        deps.log(
          'sessions',
          `closeTab for session ${sessionId} kept by a close guard`,
        );
        return false;
      }
      removeTab(index);
      sendState();
      return true;
    },
    tools: () => contributions.flatMap((contribution) => contribution.tools),
    state,
  };
}
