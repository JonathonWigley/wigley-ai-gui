import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SessionsPageExports } from '../../sessions/contract';

export interface TerminalDemoPageDeps {
  activate: SessionsPageExports['activate'];
}

// The Terminal step: the demo session shown with its drawer open and the
// typed command waiting at the prompt, its row marked as needing the user.
export function registerDemoSteps(
  services: PageServices,
  deps: TerminalDemoPageDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'terminal.drawer',
    section: 'sessions',
    order: 200,
    title: 'Terminal',
    caption:
      'Each session has its own terminal; an agent types a command there for you to run with Enter.',
    files: [
      'src/plugins/terminal/page/start.ts',
      'src/plugins/terminal/layouts/default/layout.js',
    ],
    async enter(context) {
      const session = context.sessions.session;
      return {
        beats: [{ name: 'typed', show: () => deps.activate(session) }],
        dispose() {},
      };
    },
  });
}
