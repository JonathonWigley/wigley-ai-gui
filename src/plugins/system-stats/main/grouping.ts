import type { ProcessSample } from '../../../contracts/system-stats';
import type { ChatSessionInfo } from '../../chat/contract';
import { editableTitle, type SessionRow } from '../../sessions/contract';
import type { StatsProcessRow } from '../contract';
import type { ProcessRate, SessionProcess } from './snapshot';

const APP_BUNDLE = '.app';
const OTHER_ROW_NAME = 'Other (exited processes, system)';

// The app a process belongs to: the outermost `.app` bundle in its path, else its own name.
export function appKeyOf(process: Pick<ProcessSample, 'name' | 'path'>): {
  id: string;
  name: string;
} {
  const bundle = process.path
    .split(/[/\\]/)
    .find((segment) => segment.endsWith(APP_BUNDLE));
  return bundle === undefined
    ? { id: `app:${process.name}`, name: process.name }
    : { id: `app:${bundle}`, name: bundle.slice(0, -APP_BUNDLE.length) };
}

// One row per session holding a process, in `sessions` order, then one per app key in the order of its first
// process: a group for two or more processes, a lone row for one. A process belongs to the session whose pid is its
// own or its nearest ancestor's; a pid two sessions hold goes to the first.
export function groupProcesses(
  processes: readonly ProcessRate[],
  sessions: readonly SessionProcess[],
): StatsProcessRow[] {
  const sessionByPid = new Map<number, SessionProcess>();
  for (const session of sessions) {
    if (!sessionByPid.has(session.pid)) {
      sessionByPid.set(session.pid, session);
    }
  }
  const processByPid = new Map(
    processes.map((process) => [process.pid, process]),
  );
  const sessionMembers = new Map<SessionProcess, ProcessRate[]>();
  const appMembers = new Map<
    string,
    { name: string; members: ProcessRate[] }
  >();
  for (const process of processes) {
    const session = owningSession(process, processByPid, sessionByPid);
    if (session !== undefined) {
      const members = sessionMembers.get(session) ?? [];
      members.push(process);
      sessionMembers.set(session, members);
      continue;
    }
    const key = appKeyOf(process);
    const app = appMembers.get(key.id) ?? { name: key.name, members: [] };
    app.members.push(process);
    appMembers.set(key.id, app);
  }
  const sessionRows = sessions.flatMap((session) => {
    const members = sessionMembers.get(session);
    return members === undefined
      ? []
      : [
          groupRow(
            `session:${session.sessionId}`,
            `claude · ${session.title}`,
            'session',
            members,
          ),
        ];
  });
  const appRows = [...appMembers].map(([id, { name, members }]) =>
    members.length === 1
      ? processRow(members[0])
      : groupRow(id, name, 'app', members),
  );
  return [...sessionRows, ...appRows];
}

// The CPU meter's share no top-level row holds: kernel and system time, and the CPU of every process that exited
// before the later sample. It has no RAM or GPU reading and never opens.
export function otherRow(
  cpuPercent: number,
  rows: readonly StatsProcessRow[],
): StatsProcessRow {
  const rowsCpu = sum(rows.map((row) => row.cpuPercent));
  return {
    id: 'other',
    name: OTHER_ROW_NAME,
    kind: 'other',
    cpuPercent: Math.max(0, cpuPercent - rowsCpu),
    rssBytes: null,
    gpuPercent: null,
    children: [],
  };
}

// One entry per Chat session with a running process and a sidebar row, titled as its row is.
export function sessionProcesses(
  chat: Iterable<ChatSessionInfo>,
  rows: ReadonlyMap<string, SessionRow>,
): SessionProcess[] {
  const entries: SessionProcess[] = [];
  for (const session of chat) {
    const row = rows.get(session.sessionId);
    if (session.pid === null || row === undefined) {
      continue;
    }
    entries.push({
      sessionId: session.sessionId,
      pid: session.pid,
      title: editableTitle(row.titles) || row.label,
    });
  }
  return entries;
}

// The session whose pid is the process's own or its nearest ancestor's, walking `ppid` until a pid outside the
// sample or as many steps as the sample has processes.
function owningSession(
  process: ProcessRate,
  processByPid: ReadonlyMap<number, ProcessRate>,
  sessionByPid: ReadonlyMap<number, SessionProcess>,
): SessionProcess | undefined {
  let current: ProcessRate | undefined = process;
  for (
    let steps = 0;
    current !== undefined && steps <= processByPid.size;
    steps++
  ) {
    const session = sessionByPid.get(current.pid);
    if (session !== undefined) {
      return session;
    }
    current = processByPid.get(current.ppid);
  }
  return undefined;
}

function processRow(process: ProcessRate): StatsProcessRow {
  return {
    id: `pid:${process.pid}`,
    name: process.name,
    kind: 'process',
    cpuPercent: process.cpuPercent,
    rssBytes: process.rssBytes,
    gpuPercent: process.gpuPercent,
    children: [],
  };
}

function groupRow(
  id: string,
  name: string,
  kind: 'app' | 'session',
  members: readonly ProcessRate[],
): StatsProcessRow {
  const gpuValues = members.flatMap(({ gpuPercent }) =>
    gpuPercent === null ? [] : [gpuPercent],
  );
  return {
    id,
    name,
    kind,
    cpuPercent: sum(members.map(({ cpuPercent }) => cpuPercent)),
    rssBytes: sum(members.map(({ rssBytes }) => rssBytes)),
    gpuPercent: gpuValues.length === 0 ? null : sum(gpuValues),
    children: members.map(processRow),
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
