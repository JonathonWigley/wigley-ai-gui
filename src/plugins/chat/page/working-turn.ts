import { type ChatEntry, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { SessionCompaction } from '../contract';
import type {
  DoneWorkingInput,
  LiveWorkingInput,
  WorkingInput,
  WorkingState,
} from '../layouts/layout';
import { isStep, type StepEntry } from './activity-runs';

type ResultEntry = Extract<ChatEntry, { kind: 'result' }>;

// The activity dock's input while the session works. The turn starts at the
// later of the last `user` entry and the first entry after the last `result`
// entry; with neither, it is every entry. A turn with no entries starts at
// `now`. Steps leave out subagents' steps. While `compaction` is not null
// the state is `compacting` and the time counts from the compaction's start,
// whatever the turn does.
export function workingInput(
  entries: readonly ChatEntry[],
  now: number,
  compaction: SessionCompaction | null,
): LiveWorkingInput {
  const turn = entries.slice(turnStart(entries));
  const steps = turn.filter(isDockStep);
  if (compaction !== null) {
    return {
      state: 'compacting',
      steps,
      startedAt: compaction.startedAt,
      now,
      compaction: compactionLabel(compaction),
    };
  }
  return {
    state: turnState(turn),
    steps,
    startedAt: turn.length > 0 ? turn[0].at : now,
    now,
    compaction: null,
  };
}

// What started the compaction, as the dock reads it.
export function compactionLabel(compaction: SessionCompaction): string {
  switch (compaction.trigger) {
    case 'app':
      return compaction.reason ?? 'auto';
    case 'manual':
      return '/compact';
    case 'harness':
      return 'autocompact';
  }
}

// Whether the running turn holds no entries: the last entry is a `result`,
// or there are none.
export function isTurnEmpty(entries: readonly ChatEntry[]): boolean {
  return turnStart(entries) >= entries.length;
}

// The activity dock's finished line once the session is idle: the turn is
// every entry from the last `user` entry on (every entry with none), results
// before the last one included. Null when the turn holds no `result`.
export function doneInput(
  entries: readonly ChatEntry[],
): DoneWorkingInput | null {
  const lastUser = entries.findLastIndex((entry) => entry.kind === 'user');
  const turn = entries.slice(Math.max(lastUser, 0));
  const results = turn.filter(
    (entry): entry is ResultEntry => entry.kind === 'result',
  );
  const lastResult = results.at(-1);
  if (lastResult === undefined) {
    return null;
  }
  return {
    state: 'done',
    steps: turn.filter(isDockStep),
    startedAt: turn[0].at,
    endedAt: lastResult.at,
    stopReason: lastResult.stopReason,
    costUsd: costOf(results),
  };
}

// How many steps the turn ending at result `resultId` took: the dock's steps from
// that turn's start, the later of the last `user` entry and the previous result.
export function resultStepCount(
  entries: readonly ChatEntry[],
  resultId: string,
): number {
  const before = entries.slice(
    0,
    entries.findIndex((entry) => entry.id === resultId),
  );
  return before.slice(turnStart(before)).filter(isDockStep).length;
}

// The Main agent section's summary: a live dock's time as `m:ss`, `h:mm:ss` from
// one hour, a negative span reading `0:00`; null for a finished turn or no turn.
export function dockSummary(input: WorkingInput | null): string | null {
  if (input === null || input.state === 'done') {
    return null;
  }
  const total = Math.floor(Math.max(0, input.now - input.startedAt) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  if (hours === 0) {
    return `${minutes}:${seconds}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
}

function turnStart(entries: readonly ChatEntry[]): number {
  const lastUser = entries.findLastIndex((entry) => entry.kind === 'user');
  const lastResult = entries.findLastIndex((entry) => entry.kind === 'result');
  return Math.max(lastUser, lastResult + 1);
}

function turnState(turn: readonly ChatEntry[]): WorkingState {
  if (
    turn.some((entry) => entry.kind === 'permission' && entry.answer === null)
  ) {
    return 'waiting';
  }
  if (
    turn.some(
      (entry) =>
        entry.kind === 'tool' &&
        entry.agentId === MAIN_AGENT_ID &&
        entry.result === null,
    )
  ) {
    return 'working';
  }
  const last = turn.at(-1);
  if (last?.kind === 'assistant' && last.streaming) {
    return 'writing';
  }
  return 'thinking';
}

// A step the dock shows: every step but a subagent's.
function isDockStep(entry: ChatEntry): entry is StepEntry {
  return (
    isStep(entry) && (entry.kind === 'raw' || entry.agentId === MAIN_AGENT_ID)
  );
}

// The sum of the results' non-null costs; null when none has one.
function costOf(results: readonly ResultEntry[]): number | null {
  return results.reduce<number | null>(
    (sum, result) =>
      result.costUsd === null ? sum : (sum ?? 0) + result.costUsd,
    null,
  );
}
