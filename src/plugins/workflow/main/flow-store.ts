import { type Files, readIfPresent } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import type { PlanProgress, PlanTaskLine } from '../plan-reader';

export const FLOWS_FILE = 'flows.json';

// The open sessions' flows, and every flow saved in `flows.json`, keyed by
// host session id (a row id is fresh on each launch). `load` reads the file
// once; a flow read from it runs no turn, no subagent and no countdown.
// `put`, `rekey`, `drop`, `open` and `resetFlows` each write the whole file,
// one write after another in call order; a write that fails is logged and the
// next change writes again. `rekey`, `put` and `drop` ignore a session the
// store does not hold. A saved entry no open session took stays in the file.
export interface FlowStore {
  load(): Promise<void>;
  // Open sessions only.
  get(sessionId: string): SessionFlow | null;
  // The host session id the session's flow is held under now; null for a
  // session the store does not hold.
  hostIdOf(sessionId: string): string | null;
  // Open sessions' flows, in `open` order.
  all(): SessionFlow[];
  // The saved flow for `hostSessionId` with the call's `sessionId` and
  // `projectDir`, or a new flow when none is saved.
  open(
    sessionId: string,
    hostSessionId: string,
    projectDir: string,
  ): SessionFlow;
  // Moves the session's saved key to its new host session id (a clear).
  rekey(sessionId: string, hostSessionId: string): void;
  put(flow: SessionFlow): void;
  // Forgets the session's flow and its saved entry.
  drop(sessionId: string): void;
  // Every open flow in `projectDir` becomes a new flow, and every saved entry
  // in it no open session holds is removed.
  resetFlows(projectDir: string): void;
}

interface OpenFlow {
  hostSessionId: string;
  flow: SessionFlow;
}

interface SavedEntry {
  hostSessionId: string;
  flow: SessionFlow;
}

// `files` is workflow's data folder.
export function createFlowStore(deps: {
  files: Files;
  log: Log;
  paths: Paths;
}): FlowStore {
  const { files, log, paths } = deps;
  // Every entry `flows.json` holds, open sessions' included, by host id.
  const saved = new Map<string, SessionFlow>();
  const opened = new Map<string, OpenFlow>();
  let lastWrite: Promise<void> = Promise.resolve();

  const write = () => {
    const entries: SavedEntry[] = [...saved].map(([hostSessionId, flow]) => ({
      hostSessionId,
      flow,
    }));
    const text = JSON.stringify({ flows: entries }, null, 2);
    lastWrite = lastWrite
      .then(() => files.write(FLOWS_FILE, text))
      .catch((error: unknown) => {
        log('workflow', `${FLOWS_FILE} not written: ${errorText(error)}`);
      });
  };

  const hold = (
    sessionId: string,
    hostSessionId: string,
    flow: SessionFlow,
  ) => {
    opened.set(sessionId, { hostSessionId, flow });
    saved.set(hostSessionId, flow);
  };

  return {
    async load() {
      const text = await readIfPresent(files, FLOWS_FILE);
      if (text === null) {
        return;
      }
      const entries = parseFlowsFile(text);
      if (entries === null) {
        log('workflow', `${FLOWS_FILE} unreadable; starting with no flows`);
        return;
      }
      for (const { hostSessionId, flow } of entries) {
        saved.set(hostSessionId, {
          ...flow,
          turnRunning: false,
          runningSubagents: [],
          countdownEndsAt: null,
        });
      }
    },
    get: (sessionId) => opened.get(sessionId)?.flow ?? null,
    hostIdOf: (sessionId) => opened.get(sessionId)?.hostSessionId ?? null,
    all: () => [...opened.values()].map(({ flow }) => flow),
    open(sessionId, hostSessionId, projectDir) {
      const savedFlow = saved.get(hostSessionId);
      const flow =
        savedFlow === undefined
          ? newFlow(sessionId, projectDir)
          : { ...savedFlow, sessionId, projectDir };
      hold(sessionId, hostSessionId, flow);
      write();
      return flow;
    },
    rekey(sessionId, hostSessionId) {
      const held = opened.get(sessionId);
      if (held === undefined) {
        return;
      }
      saved.delete(held.hostSessionId);
      hold(sessionId, hostSessionId, held.flow);
      write();
    },
    put(flow) {
      const held = opened.get(flow.sessionId);
      if (held === undefined) {
        return;
      }
      hold(flow.sessionId, held.hostSessionId, flow);
      write();
    },
    drop(sessionId) {
      const held = opened.get(sessionId);
      if (held === undefined) {
        return;
      }
      opened.delete(sessionId);
      saved.delete(held.hostSessionId);
      write();
    },
    resetFlows(projectDir) {
      const inFolder = (flow: SessionFlow) =>
        paths.samePath(flow.projectDir, projectDir);
      const openHostIds = new Set<string>();
      for (const [sessionId, held] of opened) {
        openHostIds.add(held.hostSessionId);
        if (inFolder(held.flow)) {
          hold(
            sessionId,
            held.hostSessionId,
            newFlow(sessionId, held.flow.projectDir),
          );
        }
      }
      for (const [hostSessionId, flow] of saved) {
        if (!openHostIds.has(hostSessionId) && inFolder(flow)) {
          saved.delete(hostSessionId);
        }
      }
      write();
    },
  };
}

// The entries of a `flows.json`, checked field by field; null when the text
// is not JSON or not that shape.
function parseFlowsFile(text: string): SavedEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.flows)) {
    return null;
  }
  const entries: SavedEntry[] = [];
  for (const entry of parsed.flows as unknown[]) {
    const isEntry =
      isRecord(entry) &&
      typeof entry.hostSessionId === 'string' &&
      isSessionFlow(entry.flow);
    if (!isEntry) {
      return null;
    }
    entries.push(entry as unknown as SavedEntry);
  }
  return entries;
}

function isSessionFlow(value: unknown): value is SessionFlow {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.projectDir === 'string' &&
    typeof value.stage === 'string' &&
    isStringOrNull(value.planDir) &&
    (value.progress === null || isPlanProgress(value.progress)) &&
    typeof value.turnRunning === 'boolean' &&
    isStringList(value.runningSubagents) &&
    isNumberOrNull(value.countdownEndsAt) &&
    typeof value.hasLeftIdle === 'boolean'
  );
}

function isPlanProgress(value: unknown): value is PlanProgress {
  return (
    isRecord(value) &&
    typeof value.checked === 'number' &&
    typeof value.total === 'number' &&
    isNumberOrNull(value.wave) &&
    typeof value.reviewRounds === 'number' &&
    typeof value.title === 'string' &&
    Array.isArray(value.tasks) &&
    (value.tasks as unknown[]).every(isPlanTaskLine)
  );
}

function isPlanTaskLine(value: unknown): value is PlanTaskLine {
  return (
    isRecord(value) &&
    isNumberOrNull(value.wave) &&
    typeof value.text === 'string' &&
    typeof value.done === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === 'number';
}

function isStringList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every((item) => typeof item === 'string')
  );
}
