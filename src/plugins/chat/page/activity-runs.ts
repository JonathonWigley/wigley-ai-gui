import { type ChatEntry, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { StepInput } from '../layouts/layout';
import { blockStopId } from './entry-focus';

// A step is a tool call, a thinking block or a raw entry; a run is a maximal
// sequence of consecutive steps, ended by any other kind of entry.
export type StepEntry = Extract<
  ChatEntry,
  { kind: 'tool' | 'thinking' | 'raw' }
>;

export function isStep(entry: ChatEntry): entry is StepEntry {
  return (
    entry.kind === 'tool' || entry.kind === 'thinking' || entry.kind === 'raw'
  );
}

// Whether any step is replaced, added or gone, by identity.
export function isStepsChanged(
  last: readonly StepInput[],
  next: readonly StepInput[],
): boolean {
  return (
    last.length !== next.length ||
    last.some((step, index) => step !== next[index])
  );
}

// One row of a session's list: an entry shown on its own, or a run of steps.
// A run starts at the entry before it (its first step when it opens the list)
// and ends at the entry after it; a live run has no end yet, and a finished
// run with nothing after it ends at its last step. An `at` of 0 is an entry
// restored from a line with no time: a run whose entry before it and first
// step are both untimed has a null start.
export type ListRow =
  | { kind: 'entry'; entry: ChatEntry }
  | {
      kind: 'run';
      runId: string;
      steps: StepEntry[];
      live: boolean;
      startedAt: number | null;
      endedAt: number | null;
    };

// One place the entry cursor can stop: an entry, or a run's activity line.
export type ListStop =
  | { kind: 'entry'; entry: ChatEntry }
  | { kind: 'activity'; runId: string; steps: readonly StepEntry[] };

export function runIdOf(firstStepId: string): string {
  return `activity:${firstStepId}`;
}

// A row's id: its entry's, or its run's.
function rowId(row: ListRow): string {
  return row.kind === 'entry' ? row.entry.id : row.runId;
}

// The stops a row is drawn as, a run's steps aside: one per block of an entry
// `blockCounts` gives blocks, else the row's id.
export function rowStops(
  row: ListRow,
  blockCounts: ReadonlyMap<string, number>,
): string[] {
  const id = rowId(row);
  const blockCount = blockCounts.get(id) ?? 0;
  return blockCount === 0
    ? [id]
    : Array.from({ length: blockCount }, (_, index) => blockStopId(id, index));
}

// The entries in order, each run of steps folded into one row. Only a run
// that is the last row while the session is `working` is live.
export function listRows(
  entries: readonly ChatEntry[],
  working: boolean,
): ListRow[] {
  const rows: ListRow[] = [];
  let steps: StepEntry[] = [];
  let previousAt: number | null = null;
  const closeRun = (endedAt: number | null, live: boolean): void => {
    rows.push({
      kind: 'run',
      runId: runIdOf(steps[0].id),
      steps,
      live,
      startedAt: knownAt(previousAt || steps[0].at),
      endedAt,
    });
    steps = [];
  };
  for (const entry of entries) {
    if (isStep(entry)) {
      steps.push(entry);
      continue;
    }
    if (steps.length > 0) {
      closeRun(entry.at, false);
    }
    rows.push({ kind: 'entry', entry });
    previousAt = entry.at;
  }
  if (steps.length > 0) {
    closeRun(working ? null : steps[steps.length - 1].at, working);
  }
  return rows;
}

// How long the step at `index` of `entries` took: from its `at` to the next
// entry that is not another agent's. A raw step is the main agent's. Null when
// nothing after it ends it, or when either time is unknown.
export function stepDurationMs(
  entries: readonly ChatEntry[],
  index: number,
): number | null {
  const step = entries[index];
  const agentId = agentIdOf(step) ?? MAIN_AGENT_ID;
  for (let next = index + 1; next < entries.length; next++) {
    const nextAgentId = agentIdOf(entries[next]);
    if (nextAgentId !== null && nextAgentId !== agentId) {
      continue;
    }
    const startedAt = knownAt(step.at);
    const endedAt = knownAt(entries[next].at);
    return startedAt === null || endedAt === null ? null : endedAt - startedAt;
  }
  return null;
}

// The agent that wrote `entry`; null for an entry no agent wrote.
function agentIdOf(entry: ChatEntry): string | null {
  return 'agentId' in entry ? entry.agentId : null;
}

// An entry's time; null for an `at` of 0, an entry restored from a line with
// no time.
function knownAt(at: number): number | null {
  return at === 0 ? null : at;
}

// Whether the entry cursor stops on `row`: every row but a turn or compaction
// divider.
export function isCursorRow(row: ListRow): boolean {
  return (
    row.kind !== 'entry' ||
    (row.entry.kind !== 'result' && row.entry.kind !== 'compaction')
  );
}

// The ids the entry cursor steps through: each block of an entry `blockCounts`
// gives blocks, any other entry's id, a run's id, and each step's id after its
// run's when `openRuns` holds the run. A divider has none.
export function cursorStops(
  rows: readonly ListRow[],
  openRuns: ReadonlySet<string>,
  blockCounts: ReadonlyMap<string, number>,
): string[] {
  const stops: string[] = [];
  for (const row of rows.filter(isCursorRow)) {
    stops.push(...rowStops(row, blockCounts));
    if (row.kind === 'run' && openRuns.has(row.runId)) {
      for (const step of row.steps) {
        stops.push(step.id);
      }
    }
  }
  return stops;
}
