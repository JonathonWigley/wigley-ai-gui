import type { Disposable } from '../../../contracts/disposable';
import type { CommandInfo, MainServices } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { FormsMainExports } from '../../forms/contract';
import { type AgentCommandToolDeps, confirmRequest } from './tools';

// The risky command whose confirm the step shows; it never runs.
const SAMPLE_COMMAND = 'sessions.closeSession';

// Chat's sender names, the command catalog, forms' sample confirm and the log.
export interface AgentCommandsMainDemoDeps {
  senderName: AgentCommandToolDeps['senderName'];
  list(): readonly CommandInfo[];
  forms: Pick<FormsMainExports, 'confirmSample'>;
  log: (line: string) => void;
}

// The main half of `agent-commands.confirm`: a demo session showing the
// Allow or Deny a real `run_command` of `sessions.closeSession` shows, asked
// through forms' sample service. The answer runs nothing and is only logged.
// Leaving the step aborts an unanswered confirm; the demo closes the session.
export function registerDemoSteps(
  services: MainServices,
  deps: AgentCommandsMainDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'agent-commands.confirm',
    async enter(context) {
      const sessionId = await context.launchSession(
        'A sample session for the agent commands step.',
      );
      const asking = new AbortController();
      const info = deps.list().find((each) => each.id === SAMPLE_COMMAND);
      if (info === undefined) {
        deps.log(`demo confirm: ${SAMPLE_COMMAND} not listed`);
      } else {
        const request = confirmRequest(
          deps,
          sessionId,
          info,
          sessionId,
          undefined,
        );
        deps.forms.confirmSample(sessionId, request, asking.signal).then(
          (isAllowed) => {
            if (!asking.signal.aborted) {
              deps.log(
                `sample confirm answered: ${isAllowed ? 'allow' : 'deny'}`,
              );
            }
          },
          (error: unknown) => {
            if (!asking.signal.aborted) {
              deps.log(`sample confirm failed: ${errorText(error)}`);
            }
          },
        );
      }
      return {
        sessions: { session: sessionId },
        dispose: () => asking.abort(),
      };
    },
  });
}
