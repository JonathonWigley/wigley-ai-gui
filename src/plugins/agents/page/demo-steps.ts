import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';

export interface AgentsDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The roster step: the session whose roster the main half set to the sample.
export function registerDemoSteps(
  services: PageServices,
  deps: AgentsDemoPageDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'agents.roster',
      section: 'sessions',
      order: 90,
      title: 'Subagents and tasks',
      caption:
        'Each session keeps a roster of its subagents and background tasks, with their tools, models and spend.',
      files: ['src/plugins/agents/roster.ts', 'src/plugins/agents/main/preview.ts'],
      enter: async ({ sessions }: DemoPageContext) => ({
        beats: [{ name: 'roster', show: () => deps.activate(sessions.session) }],
        dispose() {},
      }),
    }),
  );
  return registrations;
}
