import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { ChatPageExports } from '../../chat/contract';
import type { SessionsPageExports } from '../../sessions/contract';

export interface LiveViewDemoPageDeps {
  activate: SessionsPageExports['activate'];
  showHubForNow: ChatPageExports['showHubForNow'];
}

// The Live view step: the session hub, held shown with the Live section
// expanded, streaming the window main picked for the step's session.
export function registerDemoSteps(
  services: PageServices,
  deps: LiveViewDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'live-view.stream',
    section: 'live',
    order: 10,
    title: 'Live view',
    caption:
      'The session hub streams a window live, such as the Unity editor while an agent plays the game.',
    files: [
      'src/plugins/live-view/page/live-section.ts',
      'src/plugins/live-view/window-pick.ts',
    ],
    async enter(context) {
      const session = context.sessions.session;
      const hub = deps.showHubForNow('live-view.section');
      return {
        beats: [
          {
            name: 'stream',
            dwellSeconds: 8,
            show: () => deps.activate(session),
          },
        ],
        dispose: () => hub.dispose(),
      };
    },
  });
}
