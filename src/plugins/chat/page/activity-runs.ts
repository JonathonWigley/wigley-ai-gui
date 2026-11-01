import type { ChatEntry } from '../../../contracts/agent';

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

// One row of a session's list: an entry shown on its own, or a run of steps.
// A run starts at the entry before it (its first step when it opens the list)
// and ends at the entry after it; a live run has no end yet, and a finished
// run with nothing after it ends at its last step.
export type ListRow =
  | { kind: 'entry'; entry: ChatEntry }
  | {
      kind: 'run';
      runId: string;
      steps: StepEntry[];
      live: boolean;
      startedAt: number;
      endedAt: number | null;
    };

// One place the entry cursor can stop: an entry, or a run's activity line.
export type ListStop =
  | { kind: 'entry'; entry: ChatEntry }
  | { kind: 'activity'; runId: string; steps: readonly StepEntry[] };

export function runIdOf(firstStepId: string): string {
  return `activity:${firstStepId}`;
}

// The cursor stop a row is drawn as: its entry's id, or its run's.
export function rowId(row: ListRow): string {
  return row.kind === 'entry' ? row.entry.id : row.runId;
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
      startedAt: previousAt ?? steps[0].at,
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

// The ids the entry cursor steps through: an entry's id, a run's id, and each
// step's id after its run's when `openRuns` holds the run.
export function cursorStops(
  rows: readonly ListRow[],
  openRuns: ReadonlySet<string>,
): string[] {
  const stops: string[] = [];
  for (const row of rows) {
    stops.push(rowId(row));
    if (row.kind === 'run' && openRuns.has(row.runId)) {
      for (const step of row.steps) {
        stops.push(step.id);
      }
    }
  }
  return stops;
}
