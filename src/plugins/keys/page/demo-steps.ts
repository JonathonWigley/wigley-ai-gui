import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageServices } from '../../../contracts/plugin';
import type { WhichKeyModel } from './which-key';
import type { WhichKeyView } from './which-key-controller';

// `whichKey` is the one view the which-key controller draws in;
// `whichKeyModel` reads the leader prefix's model now, null when no bind
// continues the leader. `openLeaderSearch` opens the picker over the leader
// actions with its filter not focused, so the demo's keys still reach the page.
export interface KeysDemoDeps {
  whichKey: WhichKeyView;
  whichKeyModel(): WhichKeyModel | null;
  openHelp(): void;
  closeHelp(): void;
  isHelpOpen(): boolean;
  openLeaderSearch(): void;
  closeLeaderSearch(): void;
}

// The Key hints step: the which-key panel for the leader prefix, help, then
// the leader search. Leaving it closes only what the stage opened.
export function registerDemoSteps(
  services: PageServices,
  deps: KeysDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'keys.hints',
    section: 'shell',
    order: 1,
    title: 'Key hints',
    caption:
      'Every action has a key, and the app shows the keys as they are typed.',
    files: [
      'src/plugins/keys/page/start.ts',
      'src/plugins/keys/page/which-key.ts',
      'src/plugins/keys/page/help-sections.ts',
      'src/plugins/keys/page/leader-search.ts',
      'src/plugins/keys/layouts/default/layout.js',
    ],
    enter: async () => keysStage(deps, services.log),
  });
}

function keysStage(deps: KeysDemoDeps, log: PluginLog): DemoStage {
  // What the stage showed, so leaving it closes those and keeps help the user
  // had open.
  let didShowWhichKey = false;
  let didOpenHelp = false;
  let didOpenSearch = false;

  const hideWhichKey = () => {
    if (didShowWhichKey) {
      deps.whichKey.hide();
      didShowWhichKey = false;
    }
  };
  const closeHelp = () => {
    if (didOpenHelp && deps.isHelpOpen()) {
      deps.closeHelp();
    }
    didOpenHelp = false;
  };
  const closeSearch = () => {
    if (didOpenSearch) {
      deps.closeLeaderSearch();
      didOpenSearch = false;
    }
  };

  return {
    beats: [
      {
        name: 'Which-key',
        show() {
          closeHelp();
          closeSearch();
          const model = deps.whichKeyModel();
          if (model === null) {
            log('which-key: no leader binds');
            return;
          }
          deps.whichKey.show(model);
          didShowWhichKey = true;
        },
      },
      {
        name: 'Help',
        show() {
          hideWhichKey();
          closeSearch();
          if (!deps.isHelpOpen()) {
            deps.openHelp();
            didOpenHelp = true;
          }
        },
      },
      {
        name: 'Leader search',
        show() {
          hideWhichKey();
          closeHelp();
          deps.openLeaderSearch();
          didOpenSearch = true;
        },
      },
    ],
    dispose() {
      hideWhichKey();
      closeHelp();
      closeSearch();
    },
  };
}
