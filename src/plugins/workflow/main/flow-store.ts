import type { Clock } from '../../../contracts/ambient';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, isStringArray } from '../../../shared/json';
import type { ChecklistItem, SessionFlow } from '../contract';
import { newFlow } from '../flow';

export const FLOWS_FILE = 'flows.json';

// The open sessions' flows, and every flow saved in `flows.json`, keyed by
// host session id (a row id is fresh on each launch). `load` reads the file
// once; a flow read from it runs no turn and no subagent.
// `put`, `putKeepingSavedAt`, `rekey`, `drop`, `open` and `forgetFlows` each
// write the whole file, one write after another in call order; a write that
// fails is logged and the next change writes again. `flushed` resolves once
// every write asked so far has settled, so a store stopped before a restart
// leaves the file current for the next store's `load`. `rekey`, `put`,
// `putKeepingSavedAt` and `drop` ignore a session the store does not hold. A
// saved entry no open session took stays in the file. An open session's flow
// sits in the `flows` slot, keyed by session id, and only there: each change sets
// or deletes that session's key. The file is the truth across a restart, so
// creating a store deletes every key the slot still holds.
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
  // Resolves once every write asked so far has settled, written or logged.
  flushed(): Promise<void>;
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
  flows: KeyedSlotWriter<SessionFlow>;
  files: Files;
  log: PluginLog;
  paths: Paths;
  clock: Clock;
}): FlowStore {
  const { flows, files, log, paths, clock } = deps;
  // Every entry `flows.json` holds, open sessions' included, by host id.
  const saved = new Map<string, SavedFlow>();
  // Each open session's host session id, in `open` order.
  const opened = new Map<string, string>();
  let lastWrite: Promise<void> = Promise.resolve();

  for (const sessionId of flows.all().keys()) {
    flows.delete(sessionId);
  }

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
        log(`${FLOWS_FILE} not written: ${errorText(error)}`);
      });
  };

  const hold = (
    sessionId: string,
    hostSessionId: string,
    flow: SessionFlow,
    savedAt: number,
  ) => {
    opened.set(sessionId, hostSessionId);
    saved.set(hostSessionId, { flow, savedAt });
    flows.set(sessionId, flow);
  };

  const savedAtOfHost = (hostSessionId: string) =>
    saved.get(hostSessionId)?.savedAt ?? 0;

  const putAt = (
    flow: SessionFlow,
    savedAt: (hostSessionId: string) => number,
  ) => {
    const hostSessionId = opened.get(flow.sessionId);
    if (hostSessionId === undefined) {
      return;
    }
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
        log(`${FLOWS_FILE} unreadable; starting with no flows`);
        return;
      }
      for (const { hostSessionId, flow, savedAt } of entries) {
        saved.set(hostSessionId, {
          flow: {
            ...flow,
            turnRunning: false,
            runningSubagents: [],
          },
          savedAt: savedAt ?? clock.now(),
        });
      }
    },
    get: (sessionId) =>
      opened.has(sessionId) ? (flows.get(sessionId) ?? null) : null,
    hostIdOf: (sessionId) => opened.get(sessionId) ?? null,
    savedAtOf(sessionId) {
      const hostSessionId = opened.get(sessionId);
      return hostSessionId === undefined ? 0 : savedAtOfHost(hostSessionId);
    },
    all: () => [...opened.keys()].flatMap((id) => flows.get(id) ?? []),
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
      const heldHostId = opened.get(sessionId);
      const flow = flows.get(sessionId);
      if (heldHostId === undefined || flow === undefined) {
        return;
      }
      const savedAt = savedAtOfHost(heldHostId);
      saved.delete(heldHostId);
      hold(sessionId, hostSessionId, flow, savedAt);
      write();
    },
    put: (flow) => putAt(flow, () => clock.now()),
    putKeepingSavedAt: (flow) => putAt(flow, savedAtOfHost),
    drop(sessionId) {
      const hostSessionId = opened.get(sessionId);
      if (hostSessionId === undefined) {
        return;
      }
      opened.delete(sessionId);
      saved.delete(hostSessionId);
      flows.delete(sessionId);
      write();
    },
    forgetFlows(projectDir) {
      const inFolder = (flow: SessionFlow) =>
        paths.samePath(flow.projectDir, projectDir);
      const forgotten: string[] = [];
      for (const [sessionId, hostSessionId] of opened) {
        const flow = flows.get(sessionId);
        if (flow !== undefined && inFolder(flow)) {
          opened.delete(sessionId);
          saved.delete(hostSessionId);
          flows.delete(sessionId);
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
    flushed: () => lastWrite,
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
  if (!isJsonObject(parsed) || !Array.isArray(parsed.flows)) {
    return null;
  }
  const entries: SavedEntry[] = [];
  for (const entry of parsed.flows as unknown[]) {
    const isEntry =
      isJsonObject(entry) &&
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
    isJsonObject(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.projectDir === 'string' &&
    typeof value.stage === 'string' &&
    isStringOrNull(value.workflow) &&
    isStringOrNull(value.movedUpFrom) &&
    (value.checklist === null || isChecklist(value.checklist)) &&
    'state' in value &&
    typeof value.missedLevel === 'boolean' &&
    typeof value.turnRunning === 'boolean' &&
    isStringArray(value.runningSubagents)
  );
}

function isChecklist(value: unknown): boolean {
  return Array.isArray(value) && (value as unknown[]).every(isChecklistItem);
}

export function isChecklistItem(value: unknown): value is ChecklistItem {
  return (
    isJsonObject(value) &&
    typeof value.text === 'string' &&
    typeof value.done === 'boolean'
  );
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}
