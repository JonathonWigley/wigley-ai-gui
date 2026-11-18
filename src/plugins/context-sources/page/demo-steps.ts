import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { ChatPageExports } from '../../chat/contract';
import type { SessionsPageExports } from '../../sessions/contract';

export interface ContextSourcesDemoPageDeps {
  activate: SessionsPageExports['activate'];
  showHubForNow: ChatPageExports['showHubForNow'];
}

// The Context step: the session hub, held shown with the Context section
// expanded, over a session whose agent reported its context breakdown.
export function registerDemoSteps(
  services: PageServices,
  deps: ContextSourcesDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'context-sources.context',
    section: 'sessions',
    order: 160,
    title: 'Context',
    caption: 'The session hub breaks the context window down by source.',
    files: [
      'src/plugins/context-sources/page/context-section.ts',
      'src/plugins/context-sources/page/breakdown-input.ts',
    ],
    async enter(context) {
      const session = context.sessions.session;
      const hub = deps.showHubForNow('context-sources.breakdown');
      return {
        beats: [{ name: 'sources', show: () => deps.activate(session) }],
        dispose: () => hub.dispose(),
      };
    },
  });
}
