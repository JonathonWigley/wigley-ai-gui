import '../../../shared/page/dialog.css';
import './keys.css';
import type { PageApi, PagePart, PushedScope } from '../../../contracts/plugin';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../contract';
import { keysManifest } from '../manifest';
import { helpSections } from './help-sections';
import { mountHelpView } from './help-view';
import { barHints } from './key-bar';
import { mountKeyBarView } from './key-bar-view';
import { keysFor } from './keys-for';
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
// in the status bar. Each reads the keymap and settings as they are now, and
// help and the key bar redraw when the keymap changes. Exports the keys bound
// to a command, for a view that shows them beside its control.
export const keysPagePart: PagePart<typeof keysManifest> = {
  manifest: keysManifest,
  start(api: KeysApi) {
    const { keys, services, platform } = api;
    startWhichKey({
      onPending: (listener) => keys.onPending(listener),
      holdPending: () => keys.holdPending(),
      cancelPending: () => keys.cancelPending(),
      model: (pending) =>
        whichKeyModel(
          pending,
          keys.keymap(),
          keys.command,
          keys.label,
          platform,
        ),
      view: mountWhichKeyView(api.areas.overlay),
      timers: services.timers,
      delayMs: () => api.settings().whichKeyDelayMs,
      timeoutMs: () => api.settings().whichKeyTimeoutMs,
      log: services.log,
    });

    const currentHelpSections = () =>
      helpSections(keys.keymap(), keys.scopes, keys.label, platform);
    const help = mountHelpView(api.areas.overlay, currentHelpSections(), () =>
      api.commands.run(qualify(keysManifest.id, 'closeHelp')),
    );
    // The pushed `help` scope while help is open, `null` while it is closed.
    let helpScope: PushedScope | null = null;
    const closeHelp = () => {
      helpScope?.pop();
      helpScope = null;
      help.hide();
    };

    const keyBar = mountKeyBarView(api.areas.statusBar, {
      hints: (isInBox) =>
        barHints(keys.keymap(), keys.scope(), isInBox, keys.label, platform),
      isInBox: (element) => services.editor.contains(element),
      onScopeChanged: (listener) => keys.onScopeChanged(listener),
      openHelp: () => api.commands.run(qualify(keysManifest.id, 'toggleHelp')),
    });
    keys.onKeymapChanged(() => {
      help.setSections(currentHelpSections());
      keyBar.render();
    });

    const exports: KeysPageExports = {
      keysFor: (command, scope) =>
        keysFor(keys.keymap(), command, scope, platform),
    };
    return {
      exports,
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
