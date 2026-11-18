import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';

export interface AgentStripDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The agent strip step: the strip of a session running subagents.
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
      enter: async ({ sessions }: DemoPageContext) => ({
        beats: [{ name: 'boxes', show: () => activate(sessions.agents) }],
        dispose() {},
      }),
    }),
  );
  return registrations;
}
