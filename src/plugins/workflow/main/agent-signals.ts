import path from 'node:path';
import { type AgentEvent, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { SessionFlow, WorkflowSignal } from '../contract';
import { isPlanFile } from '../flow';

// The signals one agent event gives the session's flow, in fold order; [] for
// none. `fromCurrentHost` is true when the event came from the host session
// the flow is held under now: a `sessionEnded` from an earlier host (the
// process a clear replaced) ends nothing.
export function signalOf(
  event: AgentEvent,
  flow: SessionFlow,
  fromCurrentHost: boolean,
): WorkflowSignal[] {
  switch (event.type) {
    case 'skillStarted':
      return event.agentId === MAIN_AGENT_ID
        ? [
            {
              type: 'skillStarted',
              skill: event.skill,
              args: event.args,
              argsPath: argsPathOf(event.args, flow.projectDir),
            },
          ]
        : [];
    case 'fileWritten': {
      // wigley:feature drafts plan.md in a subagent.
      const countsAsSignal =
        event.agentId === MAIN_AGENT_ID || isPlanFile(event.path);
      return countsAsSignal ? [{ type: 'fileWritten', path: event.path }] : [];
    }
    case 'turnStarted':
      return [{ type: 'turnStarted' }];
    case 'turnEnded':
      return [{ type: 'turnEnded' }];
    case 'agentSpawned':
      return event.parentAgentId === MAIN_AGENT_ID
        ? [{ type: 'subagentStarted', agentId: event.agentId }]
        : [];
    case 'agentFinished':
      return flow.runningSubagents.includes(event.agentId)
        ? [{ type: 'subagentFinished', agentId: event.agentId }]
        : [];
    case 'sessionEnded':
      // A process that exits mid-turn sends no turn end and no agentFinished.
      return fromCurrentHost
        ? [
            ...flow.runningSubagents.map((agentId): WorkflowSignal => ({
              type: 'subagentFinished',
              agentId,
            })),
            { type: 'turnEnded' },
          ]
        : [];
    default:
      return [];
  }
}

// `args` read as a path: null when empty, kept when absolute, otherwise
// resolved against the project folder.
function argsPathOf(args: string, projectDir: string): string | null {
  const trimmed = args.trim();
  if (trimmed === '') {
    return null;
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(projectDir, trimmed);
}
