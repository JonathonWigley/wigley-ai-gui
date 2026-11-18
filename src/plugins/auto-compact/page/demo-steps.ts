import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../../sessions/contract';

export interface AutoCompactDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The auto compact step: a cold session, one compacting before its message,
// and one that compacted and then sent it.
export function registerDemoSteps(
  services: PageServices,
  deps: AutoCompactDemoPageDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'auto-compact.compact',
      section: 'sessions',
      order: 120,
      title: 'Auto compact',
      caption:
        'A session whose prompt cache went cold compacts before the next message.',
      files: [
        'src/plugins/auto-compact/main/send-gate.ts',
        'src/plugins/auto-compact/main/start.ts',
      ],
      enter: async ({ sessions }: DemoPageContext) => ({
        beats: [
          { name: 'cold cache', show: () => deps.activate(sessions.cold) },
          { name: 'compacting', show: () => deps.activate(sessions.held) },
          { name: 'compacted', show: () => deps.activate(sessions.compacted) },
        ],
        dispose() {},
      }),
    }),
  );
  return registrations;
}
