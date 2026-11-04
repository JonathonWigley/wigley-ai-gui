import type { Roster, RosterAgent, RosterTask } from '../../agents/contract';

// One box of the strip: a subagent, keyed by its agentId, or a task, keyed by
// its taskId.
export type StripBox =
  | { kind: 'agent'; key: string; agent: RosterAgent }
  | { kind: 'task'; key: string; task: RosterTask };

type StartedAt = { startedAt: number };

// Every subagent by start time, then every task by start time: equal times
// keep roster order.
export function orderStripBoxes(roster: Roster): StripBox[] {
  const byStart = (first: StartedAt, second: StartedAt) =>
    first.startedAt - second.startedAt;
  return [
    ...roster.agents
      .toSorted(byStart)
      .map((agent) => ({ kind: 'agent', key: agent.agentId, agent }) as const),
    ...roster.tasks
      .toSorted(byStart)
      .map((task) => ({ kind: 'task', key: task.taskId, task }) as const),
  ];
}

// The box `j` selects on entering the strip: the first; null for no box.
export function entryIndex(boxes: readonly StripBox[]): number | null {
  return boxes.length === 0 ? null : 0;
}

// `index` moved by `delta`, held inside `0 … count - 1`.
export function stepIndex(index: number, delta: -1 | 1, count: number): number {
  return Math.min(count - 1, Math.max(0, index + delta));
}

// The selection's index after the boxes changed: where its box now sits; when
// its box is gone, `lastIndex` held to the last box; null for no box.
export function reselect(
  selectedKey: string,
  lastIndex: number,
  boxes: readonly StripBox[],
): number | null {
  if (boxes.length === 0) {
    return null;
  }
  const index = boxes.findIndex((box) => box.key === selectedKey);
  return index === -1 ? Math.min(lastIndex, boxes.length - 1) : index;
}
