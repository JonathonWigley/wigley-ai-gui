import type { UserMessage } from '../../../contracts/agent';
import type { Log } from '../../../contracts/log';
import type { ChatMainExports } from '../../chat/contract';
import { isBusy, type SessionFlow, type WorkflowSignal } from '../contract';

export interface WorkflowActionsDeps {
  chat: Pick<ChatMainExports, 'send' | 'clear' | 'launch' | 'profileOf'>;
  log: Log;
  flowOf(sessionId: string): SessionFlow | null;
  signal(sessionId: string, signal: WorkflowSignal): void;
  cancelCountdown(sessionId: string): void;
}

type Action = (sessionId: string, flow: SessionFlow) => Promise<void>;

// The commands that never run while the flow is busy.
const IDLE_ONLY_COMMANDS = new Set(['clearAndMake', 'resumeMake', 'retro']);

// The main-side workflow commands. `run` rejects, with the text the page
// toasts, for an unknown command, a session with no flow, a plan command on a
// flow with no plan, and a chat call that rejects; a plan command checks the
// plan before any chat call. An idle-only command on a busy flow is logged and
// resolves having done nothing.
export function createWorkflowActions(deps: WorkflowActionsDeps): {
  run(sessionId: string, command: string): Promise<void>;
} {
  const { chat } = deps;

  const clearAndMake: Action = async (sessionId, flow) => {
    const planDir = requirePlanDir(flow);
    await chat.clear(sessionId);
    await chat.send(sessionId, message(makeText(planDir)));
  };

  const actions: Record<string, Action> = {
    clearAndMake,
    resumeMake: clearAndMake,
    makeInNewSession: async (sessionId, flow) => {
      const planDir = requirePlanDir(flow);
      const profile = chat.profileOf(sessionId);
      if (profile === null) {
        throw new Error('The session is not a chat session');
      }
      await chat.launch({
        projectDir: flow.projectDir,
        profile,
        message: message(makeText(planDir)),
      });
      deps.signal(sessionId, { type: 'handedOff' });
    },
    retro: (sessionId) => chat.send(sessionId, message('/wigley:retro')),
    dismiss: async (sessionId) => {
      deps.signal(sessionId, { type: 'dismissed' });
    },
    cancelCountdown: async (sessionId) => {
      deps.cancelCountdown(sessionId);
    },
  };

  return {
    async run(sessionId, command) {
      const action = Object.hasOwn(actions, command) ? actions[command] : null;
      if (action === null) {
        throw new Error(`Unknown workflow command ${command}`);
      }
      const flow = deps.flowOf(sessionId);
      if (flow === null) {
        throw new Error(`No workflow flow for session ${sessionId}`);
      }
      if (IDLE_ONLY_COMMANDS.has(command) && isBusy(flow)) {
        deps.log(
          'workflow',
          `${command} not run in session ${sessionId}: the session is busy`,
        );
        return;
      }
      await action(sessionId, flow);
    },
  };
}

function requirePlanDir(flow: SessionFlow): string {
  if (flow.planDir === null) {
    throw new Error('The session has no plan');
  }
  return flow.planDir;
}

// The plan folder goes unquoted, as the user types it.
function makeText(planDir: string): string {
  return `/wigley:make ${planDir}`;
}

function message(text: string): UserMessage {
  return { text, images: [] };
}
