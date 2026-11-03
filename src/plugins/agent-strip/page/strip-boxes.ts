import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  Roster,
  RosterAgent,
  RosterOutcome,
  RosterTask,
} from '../../agents/contract';

// One box of the strip: a subagent, keyed by its agentId, or a task, keyed by
// its taskId.
export type StripBox =
  | { kind: 'agent'; key: string; agent: RosterAgent }
  | { kind: 'task'; key: string; task: RosterTask };

// Every subagent, then every task, stable-sorted by start time: equal times
// keep the subagent first.
export function orderStripBoxes(roster: Roster): StripBox[] {
  const boxes: { startedAt: number; box: StripBox }[] = [
    ...roster.agents.map((agent) => ({
      startedAt: agent.startedAt,
      box: { kind: 'agent', key: agent.agentId, agent } as const,
    })),
    ...roster.tasks.map((task) => ({
      startedAt: task.startedAt,
      box: { kind: 'task', key: task.taskId, task } as const,
    })),
  ];
  return boxes
    .sort((first, second) => first.startedAt - second.startedAt)
    .map(({ box }) => box);
}

// The box `j` selects on entering the strip: the first running one, else the
// first; null for no box.
export function entryIndex(boxes: readonly StripBox[]): number | null {
  if (boxes.length === 0) {
    return null;
  }
  const running = boxes.findIndex((box) => outcomeOf(box) === 'running');
  return running === -1 ? 0 : running;
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

// A running box shows a running dot; a finished one dims, its dot saying how it
// ended.
export function boxLook(outcome: RosterOutcome): {
  dot: 'running' | 'success' | 'error';
  isDimmed: boolean;
} {
  switch (outcome) {
    case 'running':
      return { dot: 'running', isDimmed: false };
    case 'done':
      return { dot: 'success', isDimmed: true };
    case 'failed':
      return { dot: 'error', isDimmed: true };
  }
}

// `model · effort · $cost`, each unknown one left out; '' when none is known.
export function agentMeta(agent: RosterAgent): string {
  const cost = agent.spendUsd === null ? null : `$${agent.spendUsd.toFixed(2)}`;
  return [agent.model, agent.effort, cost]
    .filter((part) => part !== null)
    .join(' · ');
}

// The agent that started `task`: `main`, the name of the subagent among
// `agents` that started it, else `subagent` (a finished subagent a message
// dropped while its task runs on).
export function taskOwner(
  task: RosterTask,
  agents: readonly RosterAgent[],
): string {
  if (task.agentId === MAIN_AGENT_ID) {
    return 'main';
  }
  return (
    agents.find((agent) => agent.agentId === task.agentId)?.name ?? 'subagent'
  );
}

// Whether the box's subagent or task runs, or how it ended.
export function outcomeOf(box: StripBox): RosterOutcome {
  return box.kind === 'agent' ? box.agent.outcome : box.task.outcome;
}
