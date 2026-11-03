import type { ChatEntry } from '../../../contracts/agent';
import type { WorkingInput, WorkingState } from '../layouts/layout';
import { isStep } from './activity-runs';

// The running turn's block input. The turn starts at the later of the last
// `user` entry and the first entry after the last `result` entry; with
// neither, it is every entry. A turn with no entries starts at `now`.
export function workingInput(
  entries: readonly ChatEntry[],
  now: number,
): WorkingInput {
  const turn = entries.slice(turnStart(entries));
  return {
    state: turnState(turn),
    steps: turn.filter(isStep),
    startedAt: turn.length > 0 ? turn[0].at : now,
    now,
  };
}

// Whether the running turn holds no entries: the last entry is a `result`,
// or there are none.
export function isTurnEmpty(entries: readonly ChatEntry[]): boolean {
  return turnStart(entries) >= entries.length;
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
  if (turn.some((entry) => entry.kind === 'tool' && entry.result === null)) {
    return 'working';
  }
  const last = turn.at(-1);
  if (last?.kind === 'assistant' && last.streaming) {
    return 'writing';
  }
  return 'thinking';
}
