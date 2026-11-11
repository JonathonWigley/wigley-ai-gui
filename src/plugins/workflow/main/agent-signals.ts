import { type AgentEvent, MAIN_AGENT_ID } from '../../../contracts/agent';
import type { Paths } from '../../../contracts/paths';
import type { SessionFlow, WorkflowSignal } from '../contract';

// The signals one agent event gives the session's flow, in fold order; [] for
// none. `fromCurrentHost` is true when the event came from the host session
// the flow is held under now: a `sessionEnded` from an earlier host (the
// process a clear replaced) ends nothing.
export function signalOf(
  event: AgentEvent,
  flow: SessionFlow,
  fromCurrentHost: boolean,
  paths: Pick<Paths, 'isAbsolute' | 'join'>,
): WorkflowSignal[] {
  switch (event.type) {
    case 'skillStarted':
      return event.agentId === MAIN_AGENT_ID
        ? [
            {
              type: 'skillStarted',
              skill: event.skill,
              args: event.args,
              argsPath: argsPathOf(event.args, flow.projectDir, paths),
            },
          ]
        : [];
    case 'fileWritten':
      // Every agent's: a workflow decides which paths it reads.
      return [{ type: 'fileWritten', path: event.path }];
    case 'turnStarted':
      return [{ type: 'turnStarted' }];
    case 'turnEnded':
      return [{ type: 'turnEnded' }];
    case 'agentSpawned':
      // Any agent's, a subagent's own included: the flow is busy while a
      // subagent at any depth runs.
      return [{ type: 'subagentStarted', agentId: event.agentId }];
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
function argsPathOf(
  args: string,
  projectDir: string,
  paths: Pick<Paths, 'isAbsolute' | 'join'>,
): string | null {
  const trimmed = args.trim();
  if (trimmed === '') {
    return null;
  }
  return paths.isAbsolute(trimmed) ? trimmed : paths.join(projectDir, trimmed);
}
