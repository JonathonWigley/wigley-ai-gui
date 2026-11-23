// The declared actions main runs: `send`, `clearAndSend`, `launch` and
// `event`, by their short command ids, and the countdown's `cancelCountdown`.

import type { UserMessage } from '../../../contracts/agent';
import type { ActionDecl } from '../../../contracts/contributions';
import type { PluginLog } from '../../../contracts/log';
import type { ChatMainExports } from '../../chat/contract';
import {
  actionCommandShortId,
  type DeclaredWorkflow,
  type SessionFlow,
  type WorkflowSignal,
} from '../contract';
import { renderTemplate, templateVariables } from './templates';
import { allHold } from './triggers';

export const CANCEL_COUNTDOWN_ACTION = 'cancelCountdown';

export interface DeclaredActionsDeps {
  chat: Pick<
    ChatMainExports,
    'send' | 'clear' | 'launch' | 'profileOf' | 'isHeadless'
  >;
  log: PluginLog;
  // The declared workflows whose actions run.
  workflows(): readonly DeclaredWorkflow[];
  flowOf(sessionId: string): SessionFlow | null;
  // Folds a live signal into the session's flow.
  signal(sessionId: string, signal: WorkflowSignal): void;
  cancelCountdown(sessionId: string): void;
  // Whether the part that runs the actions has stopped.
  isStopped(): boolean;
}

export interface DeclaredActions {
  // Rejects, with the text the page toasts, for an unknown short id, a session
  // with no flow, a launch from a session with no profile, and a chat call
  // that rejects. Resolves true once the action ran; an action whose `enabled`
  // fails, or whose text needs a plan the flow lacks, is logged and resolves
  // false having done nothing. Nothing runs after a chat call that settles
  // once the part stopped.
  run(sessionId: string, action: string): Promise<boolean>;
}

export function createDeclaredActions(
  deps: DeclaredActionsDeps,
): DeclaredActions {
  const { chat } = deps;

  const runDeclared = async (
    sessionId: string,
    flow: SessionFlow,
    action: ActionDecl,
  ): Promise<void> => {
    const text = renderTemplate(action.text ?? '', flow);
    switch (action.kind) {
      case 'send':
        await chat.send(sessionId, message(text));
        return;
      case 'clearAndSend':
        await chat.clear(sessionId);
        if (!deps.isStopped()) {
          await chat.send(sessionId, message(text));
        }
        return;
      case 'launch':
        await launch(sessionId, flow, text, action.then);
        return;
      case 'event':
        deps.signal(sessionId, { type: 'event', event: action.event ?? '' });
        return;
      case 'openPlan':
        throw new Error('openPlan runs in the page');
    }
  };

  const launch = async (
    sessionId: string,
    flow: SessionFlow,
    text: string,
    then: string | undefined,
  ): Promise<void> => {
    const profile = chat.profileOf(sessionId);
    if (profile === null) {
      throw new Error('The session is not a chat session');
    }
    await chat.launch({
      projectDir: flow.projectDir,
      profile,
      message: message(text),
      headless: chat.isHeadless(sessionId),
    });
    if (then !== undefined && !deps.isStopped()) {
      deps.signal(sessionId, { type: 'event', event: then });
    }
  };

  return {
    async run(sessionId, shortId) {
      const action =
        shortId === CANCEL_COUNTDOWN_ACTION
          ? null
          : findAction(deps.workflows(), shortId);
      if (shortId !== CANCEL_COUNTDOWN_ACTION && action === null) {
        throw new Error(`Unknown workflow action ${shortId}`);
      }
      const flow = deps.flowOf(sessionId);
      if (flow === null) {
        throw new Error(`No workflow flow for session ${sessionId}`);
      }
      if (action === null) {
        deps.cancelCountdown(sessionId);
        return true;
      }
      if (!allHold(action.enabled, flow)) {
        deps.log(`${shortId} not run in session ${sessionId}: not enabled`);
        return false;
      }
      const lacksPlan =
        templateVariables(action.text ?? '').includes('plan') &&
        (flow.plan?.dir ?? null) === null;
      if (lacksPlan) {
        deps.log('no plan to make');
        return false;
      }
      await runDeclared(sessionId, flow, action);
      return true;
    },
  };
}

// The action whose short command id is `shortId`, in any of `workflows`.
function findAction(
  workflows: readonly DeclaredWorkflow[],
  shortId: string,
): ActionDecl | null {
  for (const workflow of workflows) {
    for (const [actionId, action] of Object.entries(
      workflow.decl.actions ?? {},
    )) {
      if (actionCommandShortId(workflow.id, actionId) === shortId) {
        return action;
      }
    }
  }
  return null;
}

function message(text: string): UserMessage {
  return { text, images: [] };
}
