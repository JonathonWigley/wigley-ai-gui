import '../../../shared/page/dialog.css';
import './keys.css';
import type { PageApi, PagePart, PushedScope } from '../../../contracts/plugin';
import { qualify } from '../../../shared/plugin-manifests';
import { keysManifest } from '../manifest';
import { helpSections } from './help-sections';
import { mountHelpView } from './help-view';
import { barHints } from './key-bar';
import { mountKeyBarView } from './key-bar-view';
import { whichKeyModel } from './which-key';
import { startWhichKey } from './which-key-controller';
import { mountWhichKeyView } from './which-key-view';

// The keys plugin has no main part, so its channel carries nothing.
type KeysApi = PageApi<
  typeof keysManifest,
  { invoke: Record<never, never>; messages: Record<never, never> }
>;

// Shows which-key over every pending key sequence, on the page and in a box;
// the help overlay over the `help` scope while it is open, closing when the
// scope under it changes; and the keys that fire now, leader sequences aside,
// in the status bar.
export const keysPagePart: PagePart<typeof keysManifest> = {
  manifest: keysManifest,
  start(api: KeysApi) {
    const { keys, services, settings } = api;
    startWhichKey({
      onPending: (listener) => keys.onPending(listener),
      holdPending: () => keys.holdPending(),
      cancelPending: () => keys.cancelPending(),
      model: (pending) =>
        whichKeyModel(pending, keys.keymap, keys.command, keys.label),
      view: mountWhichKeyView(api.areas.overlay),
      timers: services.timers,
      delayMs: settings.whichKeyDelayMs,
      timeoutMs: settings.whichKeyTimeoutMs,
      log: services.log,
    });

    const help = mountHelpView(
      api.areas.overlay,
      helpSections(keys.keymap, keys.scopes, keys.label),
      () => api.commands.run(qualify(keysManifest.id, 'closeHelp')),
    );
    // The pushed `help` scope while help is open, `null` while it is closed.
    let helpScope: PushedScope | null = null;
    const closeHelp = () => {
      helpScope?.pop();
      helpScope = null;
      help.hide();
    };

    mountKeyBarView(api.areas.statusBar, {
      hints: (isInBox) =>
        barHints(keys.keymap, keys.scope(), isInBox, keys.label),
      isInBox: (element) => services.editor.contains(element),
      onScopeChanged: (listener) => keys.onScopeChanged(listener),
      openHelp: () => api.commands.run(qualify(keysManifest.id, 'toggleHelp')),
    });

    return {
      commands: {
        toggleHelp(context) {
          if (helpScope !== null) {
            closeHelp();
            return;
          }
          helpScope = keys.pushScope('help');
          // A view that changes under help, such as a prompt opening, shows at
          // once rather than behind help's backdrop.
          helpScope.onBaseChanged(closeHelp);
          context.editor?.blur();
          help.show();
        },
        closeHelp,
      },
    };
  },
};
