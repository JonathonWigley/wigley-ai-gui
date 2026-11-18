import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SessionsPageExports } from '../../sessions/contract';

export interface UsageTabLineDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The tab line step: a session's usage line in its tab bar.
export function registerDemoSteps(
  services: PageServices,
  deps: UsageTabLineDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'usage-tab-line.line',
    section: 'sessions',
    order: 180,
    title: 'Usage in the tab bar',
    caption: "Each session's usage line can also sit in its tab bar.",
    files: [
      'src/plugins/usage-tab-line/page/start.ts',
      'src/plugins/usage/page/session-line-parts.ts',
    ],
    async enter(context) {
      const session = context.sessions.session;
      return {
        beats: [{ name: 'tab line', show: () => deps.activate(session) }],
        dispose() {},
      };
    },
  });
}
