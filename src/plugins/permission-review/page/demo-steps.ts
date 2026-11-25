import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SessionsPageExports } from '../../sessions/contract';

export interface PermissionReviewDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The verdict step: the Chat tab of a session whose permission card carries
// the reviewer's verdict.
export function registerDemoSteps(
  services: PageServices,
  deps: PermissionReviewDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'permission-review.verdict',
    section: 'sessions',
    order: 75,
    title: 'Permission review',
    caption:
      'A second model reviews each approval and shows its verdict on the card.',
    files: [
      'src/plugins/permission-review/page/verdict-part.ts',
      'src/plugins/permission-review/main/review-requests.ts',
      'src/plugins/permission-review/layouts/default/layout.js',
    ],
    async enter(context) {
      const session = context.sessions.session;
      return {
        beats: [{ name: 'verdict', show: () => deps.activate(session) }],
        dispose() {},
      };
    },
  });
}
