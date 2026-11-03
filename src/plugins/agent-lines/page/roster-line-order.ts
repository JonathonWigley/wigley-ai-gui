import type { Roster, RosterAgent, RosterTask } from '../contract';

// One line under a session row: a running subagent, or a running task, nested
// when it sits under the subagent that started it.
export type RosterLine =
  | { kind: 'agent'; agent: RosterAgent }
  | { kind: 'task'; task: RosterTask; isNested: boolean };

// The lines a roster draws, running items only, in start order: every running
// subagent and every running task no running subagent started, each running
// subagent's own running tasks right after its line, in their start order,
// nested. Equal start times keep roster order, subagents before tasks.
// Subagents stay flat whatever started them.
export function orderRosterLines(roster: Roster): RosterLine[] {
  const agents = roster.agents.filter((agent) => agent.outcome === 'running');
  const tasks = roster.tasks.filter((task) => task.outcome === 'running');
  const agentIds = new Set(agents.map((agent) => agent.agentId));
  const topLevel: { startedAt: number; line: RosterLine }[] = [
    ...agents.map((agent) => ({
      startedAt: agent.startedAt,
      line: { kind: 'agent', agent } as const,
    })),
    ...tasks
      .filter((task) => !agentIds.has(task.agentId))
      .map((task) => ({
        startedAt: task.startedAt,
        line: { kind: 'task', task, isNested: false } as const,
      })),
  ];
  const nested = tasks
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
