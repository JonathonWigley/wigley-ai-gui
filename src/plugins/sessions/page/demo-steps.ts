import type { DemoPageContext } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { SplitAxis } from '../../../shared/page/pane-tree/pane-tree';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../contract';
import type { SessionPanes } from './sessions-view';

export interface SessionsDemoPageDeps {
  activate: SessionsPageExports['activate'];
  panes: Pick<SessionPanes, 'split' | 'load' | 'close'>;
  // Ends the restore's waits, as a pane key does.
  closeWaiting(): void;
}

// The session card and pane steps. The card step shows every card's state at
// once, its pane on the `waiting` session, since viewing a session clears the
// `done` and `error` words. The pane step splits the panes a pane key would,
// with no picker, and closes every pane it split, newest first, before its
// beat and at dispose.
export function registerDemoSteps(
  services: PageServices,
  deps: SessionsDemoPageDeps,
): Disposable {
  const { activate, panes } = deps;
  const { log } = services;
  const registrations = createRegistrations();
  registrations.track(
    services.demoSteps.register({
      id: 'sessions.cards',
      section: 'sessions',
      order: 10,
      title: 'Session cards',
      caption:
        'Every agent session has a card in the side bar showing what it is doing.',
      files: [
        'src/plugins/sessions/page/sidebar-view.ts',
        'src/plugins/chat/page/chat-state.ts',
        'src/plugins/sessions/layouts/default/layout.js',
      ],
      async enter({ sessions }: DemoPageContext) {
        return {
          beats: [
            { name: 'every state', show: () => activate(sessions.waiting) },
          ],
          dispose() {},
        };
      },
    }),
  );
  registrations.track(
    services.demoSteps.register({
      id: 'sessions.panes',
      section: 'sessions',
      order: 20,
      title: 'Panes',
      caption:
        'Sessions split into panes, side by side or stacked, each pane with its own tabs.',
      files: [
        'src/plugins/sessions/page/pane-sessions.ts',
        'src/shared/page/pane-tree/pane-tree.ts',
      ],
      async enter({ sessions }: DemoPageContext) {
        const splitPanes: string[] = [];
        const closeSplitPanes = () => {
          for (const paneId of splitPanes.splice(0).reverse()) {
            panes.close(paneId);
          }
        };
        // Splits the focused pane and shows `sessionId` in the new pane; false
        // when the pane is too small to split.
        const splitTo = (axis: SplitAxis, sessionId: string): boolean => {
          const paneId = panes.split(axis);
          if (paneId === null) {
            log('demo panes: pane too small to split');
            return false;
          }
          splitPanes.push(paneId);
          panes.load(paneId, sessionId);
          activate(sessionId);
          deps.closeWaiting();
          return true;
        };
        return {
          beats: [
            {
              name: 'side by side and stacked',
              show() {
                closeSplitPanes();
                activate(sessions.first);
                if (splitTo('row', sessions.second)) {
                  splitTo('column', sessions.third);
                }
              },
            },
          ],
          dispose: closeSplitPanes,
        };
      },
    }),
  );
  return registrations;
}
