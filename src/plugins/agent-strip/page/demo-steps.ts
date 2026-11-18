import type { CommandKey } from '../../../contracts/commands';
import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';
import { agentStripToggleBoxAtCommand } from '../contract';

export interface AgentStripDemoPageDeps {
  activate: SessionsPageExports['activate'];
  runCommand<A>(key: CommandKey<A>, arg: A): Promise<void>;
  // The first agent's box key in the session's roster; null with no agent.
  firstAgentKey(sessionId: string): string | null;
}

// The agent strip step: the strip of a session running subagents, then its
// first agent's box open. The stage closes the box it opened, and only that.
export function registerDemoSteps(
  services: PageServices,
  deps: AgentStripDemoPageDeps,
): Disposable {
  const { activate } = deps;
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'agent-strip.strip',
      section: 'sessions',
      order: 80,
      title: 'Agent strip',
      caption:
        'The agent strip above the message box shows each running subagent and task.',
      files: [
        'src/plugins/agent-strip/page/agent-strip.ts',
        'src/plugins/agent-strip/layouts/default/layout.js',
      ],
      async enter({ sessions }: DemoPageContext) {
        const sessionId = sessions.agents;
        let openKey: string | null = null;
        const toggleBox = (key: string) =>
          void deps.runCommand(agentStripToggleBoxAtCommand, {
            sessionId,
            key,
          });
        const closeOwnBox = () => {
          if (openKey !== null) {
            toggleBox(openKey);
            openKey = null;
          }
        };
        return {
          beats: [
            {
              name: 'boxes',
              show() {
                activate(sessionId);
                closeOwnBox();
              },
            },
            {
              name: 'box open',
              show() {
                activate(sessionId);
                if (openKey !== null) {
                  return;
                }
                const key = deps.firstAgentKey(sessionId);
                if (key === null) {
                  services.log('demo strip: no agent box yet');
                  return;
                }
                toggleBox(key);
                openKey = key;
              },
            },
          ],
          dispose: closeOwnBox,
        };
      },
    }),
  );
  return registrations;
}
