import type { ProcessActivity } from '../../contracts/agent';

// Whether a session's agent has work running: its turn is working, or a subagent
// or background task runs.
export function isWorkRunning(state: {
  activity: ProcessActivity;
  background: number;
}): boolean {
  return state.activity === 'working' || state.background > 0;
}
