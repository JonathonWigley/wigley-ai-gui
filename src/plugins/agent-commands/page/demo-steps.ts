import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SessionsPageExports } from '../../sessions/contract';

export interface AgentCommandsPageDemoDeps {
  activate: SessionsPageExports['activate'];
}

// The page half of `agent-commands.confirm`: its one beat shows the demo
// session, whose confirm is the forms page's own confirm view.
export function registerDemoSteps(
  services: PageServices,
  deps: AgentCommandsPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'agent-commands.confirm',
    section: 'forms',
    order: 40,
    title: 'Agent commands',
    caption:
      "Agent commands: an agent runs app commands, and a risky one waits on the user's Allow",
    files: [
      'src/plugins/agent-commands/main/tools.ts',
      'src/plugins/agent-commands/main/start.ts',
      'src/plugins/forms/main/confirm.ts',
      'src/plugins/forms/page/forms-view.ts',
    ],
    enter: (context) =>
      Promise.resolve({
        beats: [
          {
            name: 'Allow or Deny',
            show: () => deps.activate(context.sessions.session),
          },
        ],
        dispose() {},
      }),
  });
}
