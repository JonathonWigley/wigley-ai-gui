import type { DemoStage } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { PageServices } from '../../../contracts/plugin';
import type { WhichKeyModel } from './which-key';
import type { WhichKeyView } from './which-key-controller';

// `whichKey` is the one view the which-key controller draws in;
// `whichKeyModel` reads the leader prefix's model now, null when no bind
// continues the leader.
export interface KeysDemoDeps {
  whichKey: WhichKeyView;
  whichKeyModel(): WhichKeyModel | null;
}

// The Key hints step: the which-key panel for the leader prefix. Leaving it
// hides the panel when the stage showed it.
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
      'src/plugins/keys/layouts/default/layout.js',
    ],
    enter: async () => keysStage(deps, services.log),
  });
}

function keysStage(deps: KeysDemoDeps, log: PluginLog): DemoStage {
  let didShowWhichKey = false;
  return {
    beats: [
      {
        name: 'Which-key',
        show() {
          const model = deps.whichKeyModel();
          if (model === null) {
            log('which-key: no leader binds');
            return;
          }
          deps.whichKey.show(model);
          didShowWhichKey = true;
        },
      },
    ],
    dispose() {
      if (didShowWhichKey) {
        deps.whichKey.hide();
      }
    },
  };
}
