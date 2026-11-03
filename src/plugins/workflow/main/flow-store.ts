import type { Clock } from '../../../contracts/ambient';
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
// `put`, `putKeepingSavedAt`, `rekey`, `drop`, `open` and `forgetFlows` each
// write the whole file, one write after another in call order; a write that
// fails is logged and the next change writes again. `rekey`, `put`,
// `putKeepingSavedAt` and `drop` ignore a session the store does not hold. A
// saved entry no open session took stays in the file.
export interface FlowStore {
  load(): Promise<void>;
  // Open sessions only.
  get(sessionId: string): SessionFlow | null;
  // The host session id the session's flow is held under now; null for a
  // session the store does not hold.
  hostIdOf(sessionId: string): string | null;
  // When `put` last stamped the session's flow, epoch ms: a replayed event at
  // or before it is already in the flow. 0 for a flow never stamped or a session
  // the store does not hold. An entry saved without the time reads as the load's.
  savedAtOf(sessionId: string): number;
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
  // Holds the flow and stamps its save time.
  put(flow: SessionFlow): void;
  // Holds the flow under the save time it has: a change that says nothing of
  // what the session's log has reached.
  putKeepingSavedAt(flow: SessionFlow): void;
  // Forgets the session's flow and its saved entry.
  drop(sessionId: string): void;
  // Forgets every flow in `projectDir`, open and saved alike; returns the
  // session ids of the open ones forgotten.
  forgetFlows(projectDir: string): string[];
}

interface OpenFlow {
  hostSessionId: string;
  flow: SessionFlow;
}

interface SavedFlow {
  flow: SessionFlow;
  savedAt: number;
}

// `savedAt` is left out of a file written before the field.
interface SavedEntry {
  hostSessionId: string;
  flow: SessionFlow;
  savedAt?: number;
}

// `files` is workflow's data folder.
export function createFlowStore(deps: {
  files: Files;
  log: Log;
  paths: Paths;
  clock: Clock;
}): FlowStore {
  const { files, log, paths, clock } = deps;
  // Every entry `flows.json` holds, open sessions' included, by host id.
  const saved = new Map<string, SavedFlow>();
  const opened = new Map<string, OpenFlow>();
  let lastWrite: Promise<void> = Promise.resolve();

  const write = () => {
    const entries: SavedEntry[] = [...saved].map(
      ([hostSessionId, { flow, savedAt }]) => ({
        hostSessionId,
        flow,
        savedAt,
      }),
    );
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
    savedAt: number,
  ) => {
    opened.set(sessionId, { hostSessionId, flow });
    saved.set(hostSessionId, { flow, savedAt });
  };

  const savedAtOfHost = (hostSessionId: string) =>
    saved.get(hostSessionId)?.savedAt ?? 0;

  const putAt = (
    flow: SessionFlow,
    savedAt: (hostSessionId: string) => number,
  ) => {
    const held = opened.get(flow.sessionId);
    if (held === undefined) {
      return;
    }
    const { hostSessionId } = held;
    hold(flow.sessionId, hostSessionId, flow, savedAt(hostSessionId));
    write();
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
      for (const { hostSessionId, flow, savedAt } of entries) {
        saved.set(hostSessionId, {
          flow: {
            ...flow,
            turnRunning: false,
            runningSubagents: [],
            countdownEndsAt: null,
          },
          savedAt: savedAt ?? clock.now(),
        });
      }
    },
    get: (sessionId) => opened.get(sessionId)?.flow ?? null,
    hostIdOf: (sessionId) => opened.get(sessionId)?.hostSessionId ?? null,
    savedAtOf(sessionId) {
      const held = opened.get(sessionId);
      return held === undefined ? 0 : savedAtOfHost(held.hostSessionId);
    },
    all: () => [...opened.values()].map(({ flow }) => flow),
    open(sessionId, hostSessionId, projectDir) {
      const savedFlow = saved.get(hostSessionId)?.flow;
      const flow =
        savedFlow === undefined
          ? newFlow(sessionId, projectDir)
          : { ...savedFlow, sessionId, projectDir };
      hold(sessionId, hostSessionId, flow, savedAtOfHost(hostSessionId));
      write();
      return flow;
    },
    rekey(sessionId, hostSessionId) {
      const held = opened.get(sessionId);
      if (held === undefined) {
        return;
      }
      const savedAt = savedAtOfHost(held.hostSessionId);
      saved.delete(held.hostSessionId);
      hold(sessionId, hostSessionId, held.flow, savedAt);
      write();
    },
    put: (flow) => putAt(flow, () => clock.now()),
    putKeepingSavedAt: (flow) => putAt(flow, savedAtOfHost),
    drop(sessionId) {
      const held = opened.get(sessionId);
      if (held === undefined) {
        return;
      }
      opened.delete(sessionId);
      saved.delete(held.hostSessionId);
      write();
    },
    forgetFlows(projectDir) {
      const inFolder = (flow: SessionFlow) =>
        paths.samePath(flow.projectDir, projectDir);
      const forgotten: string[] = [];
      for (const [sessionId, held] of opened) {
        if (inFolder(held.flow)) {
          opened.delete(sessionId);
          saved.delete(held.hostSessionId);
          forgotten.push(sessionId);
        }
      }
      for (const [hostSessionId, { flow }] of saved) {
        if (inFolder(flow)) {
          saved.delete(hostSessionId);
        }
      }
      write();
      return forgotten;
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
      isSessionFlow(entry.flow) &&
      (entry.savedAt === undefined || typeof entry.savedAt === 'number');
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
    (value.reviewRoundsAtMake === undefined ||
      isNumberOrNull(value.reviewRoundsAtMake)) &&
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
