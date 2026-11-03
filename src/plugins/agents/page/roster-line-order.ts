import type { Roster, RunningAgent, RunningTask } from '../contract';

// One line under a session row: a running subagent, or a running task, nested
// when it sits under the subagent that started it.
export type RosterLine =
  | { kind: 'agent'; agent: RunningAgent }
  | { kind: 'task'; task: RunningTask; isNested: boolean };

// The lines a roster draws, in start order: every subagent and every task no
// listed subagent started, each listed subagent's own tasks right after its
// line, in their start order, nested. Equal start times keep roster order,
// subagents before tasks. Subagents stay flat whatever started them.
export function orderRosterLines(roster: Roster): RosterLine[] {
  const agentIds = new Set(roster.agents.map((agent) => agent.agentId));
  const topLevel: { startedAt: number; line: RosterLine }[] = [
    ...roster.agents.map((agent) => ({
      startedAt: agent.startedAt,
      line: { kind: 'agent', agent } as const,
    })),
    ...roster.tasks
      .filter((task) => !agentIds.has(task.agentId))
      .map((task) => ({
        startedAt: task.startedAt,
        line: { kind: 'task', task, isNested: false } as const,
      })),
  ];
  const nested = roster.tasks
    .filter((task) => agentIds.has(task.agentId))
    .sort(byStartedAt);
  return topLevel
    .sort(byStartedAt)
    .flatMap<RosterLine>(({ line }) =>
      line.kind === 'agent'
        ? [
            line,
            ...nested
              .filter((task) => task.agentId === line.agent.agentId)
              .map((task) => ({ kind: 'task', task, isNested: true }) as const),
          ]
        : [line],
    );
}

// Array sort is stable, so equal start times keep their given order.
function byStartedAt(
  a: { startedAt: number },
  b: { startedAt: number },
): number {
  return a.startedAt - b.startedAt;
}
