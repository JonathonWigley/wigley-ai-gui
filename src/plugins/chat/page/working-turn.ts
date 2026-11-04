import { type ChatEntry, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { SessionCompaction } from '../contract';
import type {
  DoneWorkingInput,
  LiveWorkingInput,
  WorkingState,
} from '../layouts/layout';
import { isStep, type StepEntry } from './activity-runs';

type ResultEntry = Extract<ChatEntry, { kind: 'result' }>;

// The activity dock's input while the session works. The turn starts at the
// later of the last `user` entry and the first entry after the last `result`
// entry; with neither, it is every entry. A turn with no entries starts at
// `now`. Steps leave out subagents' tool calls. While `compaction` is not null
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

// A step the dock shows: every step but a subagent's tool call.
function isDockStep(entry: ChatEntry): entry is StepEntry {
  return (
    isStep(entry) && (entry.kind !== 'tool' || entry.agentId === MAIN_AGENT_ID)
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
