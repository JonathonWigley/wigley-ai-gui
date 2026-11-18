import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';

export interface AgentLinesDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The agent lines step: the working line under a session running subagents.
export function registerDemoSteps(
  services: PageServices,
  deps: AgentLinesDemoPageDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'agent-lines.lines',
      section: 'sessions',
      order: 100,
      title: 'Agent lines',
      caption:
        'A working line under each session card names the subagents and tasks it runs.',
      files: [
        'src/plugins/agent-lines/page/working-lines.ts',
        'src/plugins/agent-lines/layouts/default/layout.js',
      ],
      enter: async ({ sessions }: DemoPageContext) => ({
        beats: [
          { name: 'working line', show: () => deps.activate(sessions.agents) },
        ],
        dispose() {},
      }),
    }),
  );
  return registrations;
}
