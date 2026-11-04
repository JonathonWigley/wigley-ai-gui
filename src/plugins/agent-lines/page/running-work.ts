import type { Roster } from '../../agents/contract';

// A session's running work: when its earliest running subagent or task
// started, epoch milliseconds, and how many of each run.
export interface RunningWork {
  startedAt: number;
  agentCount: number;
  taskCount: number;
}

// The roster's running work, null while no subagent or task runs.
export function runningWork(roster: Roster): RunningWork | null {
  const startTimes = [...roster.agents, ...roster.tasks].map(
    (item) => item.startedAt,
  );
  if (startTimes.length === 0) {
    return null;
  }
  return {
    startedAt: Math.min(...startTimes),
    agentCount: roster.agents.length,
    taskCount: roster.tasks.length,
  };
}
